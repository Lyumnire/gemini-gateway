package auth

import (
	"strings"

	"gemini-web-to-api/internal/commons/configs"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

var skipPaths = map[string]bool{
	"/health":         true,
	"/proxy-image":    true,
	"/docs":           true,
	"/openapi.json":   true,
}

var skipExact = map[string]bool{
	"/auth/register": true,
	"/auth/login":    true,
}

func JWTMiddleware(cfg *configs.AuthConfig) fiber.Handler {
	return func(c fiber.Ctx) error {
		path := c.Path()

		if skipExact[path] {
			return c.Next()
		}
		for prefix := range skipPaths {
			if strings.HasPrefix(path, prefix) {
				return c.Next()
			}
		}

		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(401).JSON(fiber.Map{"error": "missing authorization header"})
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return c.Status(401).JSON(fiber.Map{"error": "invalid authorization format"})
		}

		token, err := jwt.Parse(parts[1], func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			return c.Status(401).JSON(fiber.Map{"error": "invalid or expired token"})
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "invalid token claims"})
		}

		userIDFloat, ok := claims["user_id"].(float64)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "invalid user_id in token"})
		}

		c.Locals("userID", int64(userIDFloat))
		return c.Next()
	}
}
