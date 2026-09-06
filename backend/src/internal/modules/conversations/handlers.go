package conversations

import (
	"database/sql"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"go.uber.org/zap"
)

type Handler struct {
	db  *sql.DB
	log *zap.Logger
}

func NewHandler(db *sql.DB, log *zap.Logger) *Handler {
	return &Handler{db: db, log: log}
}

func (h *Handler) Register(group fiber.Router) {
	group.Post("/conversations", h.createConversation)
	group.Get("/conversations", h.listConversations)
	group.Get("/conversations/:id", h.getConversation)
	group.Patch("/conversations/:id", h.updateConversation)
	group.Delete("/conversations/:id", h.deleteConversation)
	group.Post("/conversations/:id/messages", h.appendMessages)
}

func (h *Handler) createConversation(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)

	var body struct {
		Title       string `json:"title"`
		Model       string `json:"model"`
		TitleSource string `json:"title_source"`
	}
	if err := c.Bind().JSON(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid body"})
	}
	if body.Title == "" {
		body.Title = "新对话"
	}
	if body.TitleSource != "manual" {
		body.TitleSource = "auto"
	}

	now := time.Now()
	result, err := h.db.Exec(
		"INSERT INTO conversations (user_id, title, model, title_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		userID, body.Title, body.Model, body.TitleSource, now, now,
	)
	if err != nil {
		h.log.Error("insert conversation", zap.Error(err))
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	convID, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{
		"id":           convID,
		"user_id":      userID,
		"title":        body.Title,
		"model":        body.Model,
		"title_source": body.TitleSource,
		"created_at":   now,
		"updated_at":   now,
	})
}

func (h *Handler) listConversations(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	if limit > 200 { limit = 200 }
	offset, _ := strconv.Atoi(c.Query("offset", "0"))

	rows, err := h.db.Query(
		"SELECT id, user_id, title, model, COALESCE(title_source, 'auto'), created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
		userID, limit, offset,
	)
	if err != nil {
		h.log.Error("list conversations", zap.Error(err))
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	defer rows.Close()

	type conv struct {
		ID          int64     `json:"id"`
		UserID      int64     `json:"user_id"`
		Title       string    `json:"title"`
		Model       string    `json:"model,omitempty"`
		TitleSource string    `json:"title_source"`
		CreatedAt   time.Time `json:"created_at"`
		UpdatedAt   time.Time `json:"updated_at"`
	}
	var conversations []conv
	for rows.Next() {
		var c conv
		if err := rows.Scan(&c.ID, &c.UserID, &c.Title, &c.Model, &c.TitleSource, &c.CreatedAt, &c.UpdatedAt); err != nil {
			continue
		}
		conversations = append(conversations, c)
	}
	if conversations == nil {
		conversations = []conv{}
	}
	return c.JSON(conversations)
}

func (h *Handler) getConversation(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)
	convID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid conversation id"})
	}

	var conv struct {
		ID          int64     `json:"id"`
		UserID      int64     `json:"user_id"`
		Title       string    `json:"title"`
		Model       string    `json:"model,omitempty"`
		TitleSource string    `json:"title_source"`
		CreatedAt   time.Time `json:"created_at"`
		UpdatedAt   time.Time `json:"updated_at"`
	}
	err = h.db.QueryRow(
		"SELECT id, user_id, title, model, COALESCE(title_source, 'auto'), created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?",
		convID, userID,
	).Scan(&conv.ID, &conv.UserID, &conv.Title, &conv.Model, &conv.TitleSource, &conv.CreatedAt, &conv.UpdatedAt)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "conversation not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	rows, err := h.db.Query(
		"SELECT id, role, content, thinking, image_url, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC",
		convID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	defer rows.Close()

	type msg struct {
		ID        int64     `json:"id"`
		Role      string    `json:"role"`
		Content   string    `json:"content,omitempty"`
		Thinking  string    `json:"thinking,omitempty"`
		ImageURL  string    `json:"image_url,omitempty"`
		CreatedAt time.Time `json:"created_at"`
	}
	var messages []msg
	for rows.Next() {
		var m msg
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.Thinking, &m.ImageURL, &m.CreatedAt); err != nil {
			continue
		}
		messages = append(messages, m)
	}
	if messages == nil {
		messages = []msg{}
	}

	return c.JSON(fiber.Map{
		"conversation": conv,
		"messages":     messages,
	})
}

// updateConversation renames a conversation and/or flips its title_source.
// title_source=manual 锁定标题，此后自动标题生成永不覆盖。
func (h *Handler) updateConversation(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)
	convID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid conversation id"})
	}

	var body struct {
		Title       *string `json:"title"`
		TitleSource *string `json:"title_source"`
	}
	if err := c.Bind().JSON(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid body"})
	}
	if body.Title == nil && body.TitleSource == nil {
		return c.Status(400).JSON(fiber.Map{"error": "nothing to update"})
	}
	if body.Title != nil {
		*body.Title = strings.TrimSpace(*body.Title)
		if *body.Title == "" {
			return c.Status(400).JSON(fiber.Map{"error": "title cannot be empty"})
		}
	}
	if body.TitleSource != nil && *body.TitleSource != "auto" && *body.TitleSource != "manual" {
		return c.Status(400).JSON(fiber.Map{"error": "invalid title_source"})
	}

	// Verify ownership
	var ownerID int64
	err = h.db.QueryRow("SELECT user_id FROM conversations WHERE id = ?", convID).Scan(&ownerID)
	if err == sql.ErrNoRows || ownerID != userID {
		return c.Status(404).JSON(fiber.Map{"error": "conversation not found"})
	}

	if body.Title != nil {
		if _, err := h.db.Exec("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?", *body.Title, time.Now(), convID); err != nil {
			h.log.Error("rename conversation", zap.Error(err))
			return c.Status(500).JSON(fiber.Map{"error": "internal error"})
		}
	}
	if body.TitleSource != nil {
		if _, err := h.db.Exec("UPDATE conversations SET title_source = ?, updated_at = ? WHERE id = ?", *body.TitleSource, time.Now(), convID); err != nil {
			h.log.Error("update title_source", zap.Error(err))
			return c.Status(500).JSON(fiber.Map{"error": "internal error"})
		}
	}

	var title, titleSource string
	if err := h.db.QueryRow(
		"SELECT title, COALESCE(title_source, 'auto') FROM conversations WHERE id = ?", convID,
	).Scan(&title, &titleSource); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	return c.JSON(fiber.Map{"ok": true, "title": title, "title_source": titleSource})
}

func (h *Handler) deleteConversation(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)
	convID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid conversation id"})
	}

	result, err := h.db.Exec("DELETE FROM conversations WHERE id = ? AND user_id = ?", convID, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "conversation not found"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) appendMessages(c fiber.Ctx) error {
	userID := c.Locals("userID").(int64)
	convID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid conversation id"})
	}

	// Verify ownership
	var ownerID int64
	err = h.db.QueryRow("SELECT user_id FROM conversations WHERE id = ?", convID).Scan(&ownerID)
	if err == sql.ErrNoRows || ownerID != userID {
		return c.Status(404).JSON(fiber.Map{"error": "conversation not found"})
	}

	var body struct {
		Messages []struct {
			Role     string `json:"role"`
			Content  string `json:"content"`
			Thinking string `json:"thinking,omitempty"`
			ImageURL string `json:"image_url,omitempty"`
		} `json:"messages"`
	}
	if err := c.Bind().JSON(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid body"})
	}

	tx, err := h.db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO messages (conversation_id, role, content, thinking, image_url) VALUES (?, ?, ?, ?, ?)")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	defer stmt.Close()

	for _, m := range body.Messages {
		if _, err := stmt.Exec(convID, m.Role, m.Content, m.Thinking, m.ImageURL); err != nil {
			h.log.Error("insert message", zap.Error(err))
			return c.Status(500).JSON(fiber.Map{"error": "internal error"})
		}
	}

	tx.Exec("UPDATE conversations SET updated_at = ? WHERE id = ?", time.Now(), convID)
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	return c.JSON(fiber.Map{"ok": true, "count": len(body.Messages)})
}
