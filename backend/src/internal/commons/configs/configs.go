package configs

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Gemini    GeminiConfig
	Claude    ClaudeConfig
	OpenAI    OpenAIConfig
	Server    ServerConfig
	RateLimit RateLimitConfig
	Auth      AuthConfig
	LogLevel  string
}

type AuthConfig struct {
	JWTSecret    string
	JWTExpireDays int
	InviteCode   string
	DBPath       string
}

type RateLimitConfig struct {
	Enabled     bool
	WindowMs    int
	MaxRequests int
}

type GeminiConfig struct {
	Secure1PSID     string
	Secure1PSIDTS   string
	RefreshInterval int
	MaxRetries      int
	Cookies         string
	Temporary       bool
}

type ClaudeConfig struct {
	APIKey  string
	Model   string
	Cookies string
}

type OpenAIConfig struct {
	APIKey  string
	Model   string
	Cookies string
}

type ServerConfig struct {
	Port     string
}

const (
	defaultServerPort            = "4981"
	defaultGeminiRefreshInterval = 5
	defaultGeminiMaxRetries      = 3
	defaultLogLevel              = "info"
)

func New() (*Config, error) {
	// Load .env file if it exists
	_ = godotenv.Load()

	var cfg Config

	// Server
	cfg.Server.Port = getEnv("PORT", defaultServerPort)
	
	// General
	cfg.LogLevel = getEnv("LOG_LEVEL", defaultLogLevel)

	// Rate Limit
	cfg.RateLimit.Enabled = getEnvBool("RATE_LIMIT_ENABLED", false)
	cfg.RateLimit.WindowMs = getEnvInt("RATE_LIMIT_WINDOW_MS", 60000)
	cfg.RateLimit.MaxRequests = getEnvInt("RATE_LIMIT_MAX_REQUESTS", 10)

	// Auth
	cfg.Auth.JWTSecret = getEnv("GATEWAY_JWT_SECRET", "")
	if cfg.Auth.JWTSecret == "" {
		// 未配置时生成随机 secret 并持久化，保证重启后已签发的 token 仍然有效。
		// 绝不使用可预测值（如 PID），否则 JWT 可被伪造。
		cfg.Auth.JWTSecret = loadOrCreateJWTSecretFile(cfg.Auth.DBPath)
	}
	cfg.Auth.JWTExpireDays = getEnvInt("GATEWAY_JWT_EXPIRE_DAYS", 30)
	cfg.Auth.InviteCode = getEnv("GATEWAY_INVITE_CODE", "")
	cfg.Auth.DBPath = getEnv("GATEWAY_DB_PATH", "/data/gateway.db")

	// Gemini
	cfg.Gemini.Secure1PSID = os.Getenv("GEMINI_1PSID")
	cfg.Gemini.Secure1PSIDTS = os.Getenv("GEMINI_1PSIDTS")
	cfg.Gemini.Cookies = os.Getenv("GEMINI_COOKIES")
	cfg.Gemini.RefreshInterval = getEnvInt("GEMINI_REFRESH_INTERVAL", defaultGeminiRefreshInterval)
	cfg.Gemini.MaxRetries = getEnvInt("GEMINI_MAX_RETRIES", defaultGeminiMaxRetries)
	cfg.Gemini.Temporary = getEnvBool("GEMINI_TEMPORARY", false)

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// Validate checks if the configuration has required values
func (c *Config) Validate() error {
	var missingVars []string

	// Check Gemini configuration - at least one of these should be present
	if c.Gemini.Secure1PSID == "" {
		missingVars = append(missingVars, "GEMINI_1PSID")
	}

	// 本机补丁：允许 GEMINI_1PSIDTS 为空 —— 空值时由后端缓存文件
	// (.cookies/<hash>.txt，由 cookie-sync 自动写入) 与自动轮换提供 PSIDTS，
	// 避免过期配置覆盖新鲜缓存导致 401。

	// Check Server port is valid
	if c.Server.Port == "" {
		c.Server.Port = defaultServerPort
	}

	if _, err := strconv.Atoi(c.Server.Port); err != nil {
		return fmt.Errorf("invalid PORT value: %q (must be a number)", c.Server.Port)
	}

	if len(missingVars) > 0 {
		return fmt.Errorf("missing required environment variables: %v. Please set them before running the application", missingVars)
	}

	return nil
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(valueStr)
	if err != nil {
		return defaultValue
	}
	return value
}

func getEnvBool(key string, defaultValue bool) bool {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.ParseBool(valueStr)
	if err != nil {
		return defaultValue
	}
	return value
}

// loadOrCreateJWTSecretFile returns a persistent random JWT secret stored
// next to the SQLite database. Used only when GATEWAY_JWT_SECRET is unset,
// so tokens survive restarts without a predictable fallback value.
func loadOrCreateJWTSecretFile(dbPath string) string {
	dir := filepath.Dir(dbPath)
	secretFile := filepath.Join(dir, "jwt-secret.key")

	if data, err := os.ReadFile(secretFile); err == nil {
		if secret := strings.TrimSpace(string(data)); len(secret) >= 32 {
			return secret
		}
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand 失败极其罕见；此时直接退出比使用弱 secret 更安全
		panic(fmt.Sprintf("generate JWT secret failed: %v (set GATEWAY_JWT_SECRET to avoid this)", err))
	}
	secret := hex.EncodeToString(buf)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		fmt.Printf("WARNING: GATEWAY_JWT_SECRET not set and cannot persist random secret: %v. Tokens will be invalidated on restart.\n", err)
		return secret
	}
	if err := os.WriteFile(secretFile, []byte(secret), 0o600); err != nil {
		fmt.Printf("WARNING: GATEWAY_JWT_SECRET not set and cannot persist random secret: %v. Tokens will be invalidated on restart.\n", err)
	}
	fmt.Println("WARNING: GATEWAY_JWT_SECRET not set. Generated a random secret at " + secretFile + " — set GATEWAY_JWT_SECRET for multi-instance deployments.")
	return secret
}
