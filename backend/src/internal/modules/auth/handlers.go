package auth

import (
	"database/sql"
	"strings"
	"time"

	"gemini-web-to-api/internal/commons/configs"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db  *sql.DB
	cfg *configs.AuthConfig
	log *zap.Logger
}

func NewAuthHandler(db *sql.DB, cfg *configs.Config, log *zap.Logger) *AuthHandler {
	return &AuthHandler{db: db, cfg: &cfg.Auth, log: log}
}

func (h *AuthHandler) Register(group fiber.Router) {
	group.Post("/auth/register", h.handleRegister)
	group.Post("/auth/login", h.handleLogin)
	group.Get("/auth/me", h.handleMe)
	group.Patch("/auth/profile", h.handleProfile)
}

func (h *AuthHandler) handleRegister(c fiber.Ctx) error {
	var req RegisterRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || len(req.Username) < 2 {
		return c.Status(400).JSON(fiber.Map{"error": "username must be at least 2 characters"})
	}
	if len(req.Password) < 6 {
		return c.Status(400).JSON(fiber.Map{"error": "password must be at least 6 characters"})
	}
	if h.cfg.InviteCode != "" && req.InviteCode != h.cfg.InviteCode {
		return c.Status(403).JSON(fiber.Map{"error": "invalid invite code"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	result, err := h.db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", req.Username, string(hash))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return c.Status(409).JSON(fiber.Map{"error": "username already taken"})
		}
		h.log.Error("insert user", zap.Error(err))
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	userID, _ := result.LastInsertId()
	token, err := h.generateToken(userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	return c.Status(201).JSON(AuthResponse{
		Token: token,
		User:  User{ID: userID, Username: req.Username, CreatedAt: time.Now()},
	})
}

func (h *AuthHandler) handleLogin(c fiber.Ctx) error {
	var req LoginRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	if req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "username and password required"})
	}

	var user User
	var passwordHash string
	err := h.db.QueryRow("SELECT id, username, password_hash, created_at FROM users WHERE username = ?", req.Username).
		Scan(&user.ID, &user.Username, &passwordHash, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return c.Status(401).JSON(fiber.Map{"error": "invalid credentials"})
	}
	if err != nil {
		h.log.Error("query user", zap.Error(err))
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid credentials"})
	}

	token, err := h.generateToken(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	return c.JSON(AuthResponse{Token: token, User: user})
}

func (h *AuthHandler) handleMe(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)
	var user User
	var avatar sql.NullString
	err := h.db.QueryRow("SELECT id, username, avatar, created_at FROM users WHERE id = ?", userID).
		Scan(&user.ID, &user.Username, &avatar, &user.CreatedAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "user not found"})
	}
	if avatar.Valid {
		user.Avatar = avatar.String
	}
	return c.JSON(user)
}

func (h *AuthHandler) handleProfile(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)

	var req struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		OldPassword string `json:"old_password"`
		Avatar      string `json:"avatar"`
	}
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	// 如果要改密码，必须验证旧密码
	if req.Password != "" {
		if len(req.Password) < 6 {
			return c.Status(400).JSON(fiber.Map{"error": "password must be at least 6 characters"})
		}
		var currentHash string
		if err := h.db.QueryRow("SELECT password_hash FROM users WHERE id = ?", userID).Scan(&currentHash); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "internal error"})
		}
		if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.OldPassword)); err != nil {
			return c.Status(403).JSON(fiber.Map{"error": "incorrect current password"})
		}
		newHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "internal error"})
		}
		h.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", string(newHash), userID)
	}

	// 更新用户名
	if req.Username != "" {
		req.Username = strings.TrimSpace(req.Username)
		if len(req.Username) < 2 {
			return c.Status(400).JSON(fiber.Map{"error": "username must be at least 2 characters"})
		}
		_, err := h.db.Exec("UPDATE users SET username = ? WHERE id = ?", req.Username, userID)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				return c.Status(409).JSON(fiber.Map{"error": "username already taken"})
			}
			return c.Status(500).JSON(fiber.Map{"error": "internal error"})
		}
	}

	// 更新头像
	if req.Avatar != "" {
		h.db.Exec("UPDATE users SET avatar = ? WHERE id = ?", req.Avatar, userID)
	}

	// 返回更新后的用户信息
	var user User
	var avatar sql.NullString
	h.db.QueryRow("SELECT id, username, avatar, created_at FROM users WHERE id = ?", userID).
		Scan(&user.ID, &user.Username, &avatar, &user.CreatedAt)
	if avatar.Valid {
		user.Avatar = avatar.String
	}
	return c.JSON(user)
}

func (h *AuthHandler) generateToken(userID int64) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Duration(h.cfg.JWTExpireDays) * 24 * time.Hour).Unix(),
		"iat":     time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.cfg.JWTSecret))
}
