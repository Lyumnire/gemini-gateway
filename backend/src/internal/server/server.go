package server

import (
	"context"
	"fmt"
	"time"

	"gemini-web-to-api/internal/commons/configs"
	"gemini-web-to-api/internal/modules/auth"
	"net/http"
	"os"
	"net/url"
	"encoding/base64"
	"io"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/limiter"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"go.uber.org/fx"
	"go.uber.org/zap"
)

// trustedGeminiCDNHost reports whether the host is a Google CDN image host.
// Used by the /proxy-image endpoints to prevent SSRF into internal networks
// and to avoid sending gateway cookies to non-Google redirect targets.
func trustedGeminiCDNHost(host string) bool {
	host = strings.ToLower(host)
	return host == "lh3.googleusercontent.com" ||
		host == "lh3.ggpht.com" ||
		host == "work.fife.usercontent.google.com" ||
		strings.HasSuffix(host, ".googleusercontent.com") ||
		strings.HasSuffix(host, ".usercontent.google.com")
}

// New creates a new Fiber app instance
func NewGeminiWebToAPI(log *zap.Logger, cfg *configs.Config) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:   "Gemini Web To API",
		BodyLimit: 50 * 1024 * 1024, // 50MB，支持大文件上传
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With", "x-api-key", "anthropic-version"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowCredentials: false,
	}))

	app.Use(recover.New())

	if cfg.RateLimit.Enabled {
		app.Use(limiter.New(limiter.Config{
			Max:        cfg.RateLimit.MaxRequests,
			Expiration: time.Duration(cfg.RateLimit.WindowMs) * time.Millisecond,
		}))
	}

	// JWT authentication middleware (skips /auth/*, /health, /proxy-image/*, /docs, /openapi.json)
	app.Use(auth.JWTMiddleware(&cfg.Auth))

	app.Get("/docs", ScalarUI)
	app.Get("/openapi.json", OpenAPISpec)

	app.Get("/health", HealthCheck)

	// /proxy-image/g — 图片代理：通过 HTTPS_PROXY 转发 Google CDN 图片
	// CDN 多层重定向(lh3→work.fife→实际图片)，需跟随+带完整Cookie
	app.Get("/proxy-image/g", func(c fiber.Ctx) error {
		src := c.Query("src")
		if src == "" { return c.Status(400).JSON(fiber.Map{"error": "missing src"}) }
		parsed, err := url.Parse(src)
		if err != nil || parsed.Scheme != "https" { return c.Status(400).JSON(fiber.Map{"error": "invalid url"}) }
		if !trustedGeminiCDNHost(parsed.Hostname()) { return c.Status(403).JSON(fiber.Map{"error": "untrusted host"}) }

		googleCookies := strings.ReplaceAll(os.Getenv("GEMINI_GOOGLE_COOKIES"), "|", ";")
		if googleCookies == "" {
			psid := os.Getenv("GEMINI_1PSID"); psidts := os.Getenv("GEMINI_1PSIDTS")
			if psid != "" { googleCookies = "__Secure-1PSID=" + psid; if psidts != "" { googleCookies += "; __Secure-1PSIDTS=" + psidts } }
		}

		client := &http.Client{
			Timeout: 30 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 8 { return fmt.Errorf("too many redirects") }
				// 每一跳都校验目标域名，Cookie 绝不发送到白名单以外的主机
				if !trustedGeminiCDNHost(req.URL.Hostname()) { return fmt.Errorf("redirect to untrusted host blocked") }
				req.Header.Set("Referer", "https://gemini.google.com/")
				req.Header.Set("User-Agent", "Mozilla/5.0 Chrome/120")
				if googleCookies != "" { req.Header.Set("Cookie", googleCookies) }
				return nil
			},
		}

		req2, err := http.NewRequestWithContext(c.Context(), "GET", src, nil)
		if err != nil { return c.Status(500).JSON(fiber.Map{"error": "invalid upstream request"}) }
		req2.Header.Set("Referer", "https://gemini.google.com/")
		req2.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")
		if googleCookies != "" { req2.Header.Set("Cookie", googleCookies) }

		resp, err := client.Do(req2)
		if err != nil { return c.Status(502).JSON(fiber.Map{"error": "upstream fetch failed"}) }
		defer resp.Body.Close()
		// 限制下载体积，防止超大响应耗尽内存
		data, err := io.ReadAll(io.LimitReader(resp.Body, 25*1024*1024))
		if err != nil { return c.Status(500).JSON(fiber.Map{"error": "read upstream failed"}) }
		ct := strings.ToLower(resp.Header.Get("Content-Type"))
		if resp.StatusCode != 200 || (!strings.HasPrefix(ct, "image/") && len(data) < 2048) {
			return c.Status(502).JSON(fiber.Map{"error": "upstream error"})
		}
		c.Set("Content-Type", ct)
		c.Set("Cache-Control", "public, max-age=86400")
		return c.Status(200).Send(data)
	})
	// /proxy-image/b64 — 下载图片转 base64（用于前端显示 Google CDN 图片）
	app.Get("/proxy-image/b64", func(c fiber.Ctx) error {
		src := c.Query("src")
		if src == "" { return c.Status(400).JSON(fiber.Map{"error": "missing src"}) }
		parsed, err := url.Parse(src)
		if err != nil || parsed.Scheme != "https" { return c.Status(400).JSON(fiber.Map{"error": "invalid url"}) }
		if !trustedGeminiCDNHost(parsed.Hostname()) { return c.Status(403).JSON(fiber.Map{"error": "untrusted host"}) }

		googleCookies := strings.ReplaceAll(os.Getenv("GEMINI_GOOGLE_COOKIES"), "|", ";")
		if googleCookies == "" {
			psid := os.Getenv("GEMINI_1PSID"); psidts := os.Getenv("GEMINI_1PSIDTS")
			if psid != "" { googleCookies = "__Secure-1PSID=" + psid; if psidts != "" { googleCookies += "; __Secure-1PSIDTS=" + psidts } }
		}

		client := &http.Client{
			Timeout: 30 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 8 { return fmt.Errorf("too many redirects") }
				if !trustedGeminiCDNHost(req.URL.Hostname()) { return fmt.Errorf("redirect to untrusted host blocked") }
				req.Header.Set("Referer", "https://gemini.google.com/")
				req.Header.Set("User-Agent", "Mozilla/5.0 Chrome/120")
				if googleCookies != "" { req.Header.Set("Cookie", googleCookies) }
				return nil
			},
		}
		req2, err := http.NewRequestWithContext(c.Context(), "GET", src, nil)
		if err != nil { return c.Status(500).JSON(fiber.Map{"error": "invalid upstream request"}) }
		req2.Header.Set("Referer", "https://gemini.google.com/")
		req2.Header.Set("User-Agent", "Mozilla/5.0 Chrome/120")
		if googleCookies != "" { req2.Header.Set("Cookie", googleCookies) }
		resp, err := client.Do(req2)
		if err != nil { return c.Status(502).JSON(fiber.Map{"error": "upstream fetch failed"}) }
		defer resp.Body.Close()
		ct := strings.ToLower(resp.Header.Get("Content-Type"))
		data, err := io.ReadAll(io.LimitReader(resp.Body, 25*1024*1024))

		if err != nil || resp.StatusCode != 200 || !strings.HasPrefix(ct, "image/") { return c.Status(502).JSON(fiber.Map{"error": "not an image"}) }
		b64 := base64.StdEncoding.EncodeToString(data)
		return c.JSON(fiber.Map{"b64": b64, "content_type": ct})
	})

	return app

}

func HealthCheck(c fiber.Ctx) error {
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "ok",
		"service": "gemini-web-to-api",
	})
}

// Register404Handler registers the 404 handler for unmatched routes
// This must be called AFTER all other routes are registered
func Register404Handler(app *fiber.App) {
	app.All("*", func(c fiber.Ctx) error {
		method := c.Method()
		path := c.Path()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"status":  fiber.StatusNotFound,
			"error":   "Not Found",
			"message": fmt.Sprintf("Cannot %s %s", method, path),
		})
	})
}

// RegisterFiberLifecycle registers the Fiber app lifecycle hooks
func RegisterFiberLifecycle(lc fx.Lifecycle, app *fiber.App, cfg *configs.Config, log *zap.Logger) {
	port := cfg.Server.Port
	address := fmt.Sprintf(":%s", port)

	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			Register404Handler(app)
			log.Info("Starting server", zap.String("address", address))
			// Start server in a goroutine to not block
			go func() {
				if err := app.Listen(address); err != nil {
					log.Error("Server error", zap.Error(err))
				}
			}()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			log.Info("Shutting down server")
			return app.ShutdownWithContext(ctx)
		},
	})
}

