package openai

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"time"

	models "gemini-web-to-api/internal/commons/models"
	utils "gemini-web-to-api/internal/commons/utils"
	"gemini-web-to-api/internal/modules/openai/dto"

	"github.com/gofiber/fiber/v3"
	"go.uber.org/zap"
)

type OpenAIController struct {
	service *OpenAIService
	log     *zap.Logger
}

func NewOpenAIController(service *OpenAIService) *OpenAIController {
	return &OpenAIController{
		service: service,
		log:     zap.NewNop(),
	}
}

// SetLogger sets the logger for this handler
func (h *OpenAIController) SetLogger(log *zap.Logger) {
	h.log = log
}

// GetModelData returns raw model data for internal use (e.g. unified list)
func (h *OpenAIController) GetModelData() []models.ModelData {
	availableModels := h.service.ListModels()

	var data []models.ModelData
	for _, m := range availableModels {
		data = append(data, models.ModelData{
			ID:      m.ID,
			Object:  "model",
			Created: m.Created,
			OwnedBy: m.OwnedBy,
		})
	}
	return data
}

// HandleModels returns the list of supported models
// @Summary List OpenAI Models
// @Description Returns a list of models supported by the OpenAI-compatible API
// @Tags OpenAI
// @Accept json
// @Produce json
// @Success 200 {object} models.ModelListResponse
// @Router /openai/v1/models [get]
func (h *OpenAIController) HandleModels(c fiber.Ctx) error {
	data := h.GetModelData()

	return c.JSON(models.ModelListResponse{
		Object: "list",
		Data:   data,
	})
}

// HandleChatCompletions accepts requests in OpenAI format
// @Summary Chat Completions (OpenAI)
// @Description Generates a completion for the chat message. Supports both standard JSON and streaming (SSE) response.
// @Tags OpenAI
// @Accept json
// @Produce json
// @Produce text/event-stream
// @Param request body dto.ChatCompletionRequest true "Chat Completion Request"
// @Success 200 {object} dto.ChatCompletionResponse
// @Success 200 {string} string "SSE stream of dto.ChatCompletionChunk JSON objects"
// @Failure 400 {object} map[string]interface{}
// @Failure 500 {object} map[string]interface{}
// @Router /openai/v1/chat/completions [post]
func (h *OpenAIController) HandleChatCompletions(c fiber.Ctx) error {
	var req dto.ChatCompletionRequest
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorToResponse(fmt.Errorf("invalid request body: %w", err), "invalid_request_error"))
	}

	// Debug: log metadata received (fmt.Println ensures visible in docker logs)
	hasMeta := req.ConversationID != "" && req.ChoiceID != ""
	fmt.Printf("[CHAT-HANDLER] hasMeta=%v cid=%q rid=%q rcid=%q msgCount=%d\n",
		hasMeta, req.ConversationID, req.ResponseID, req.ChoiceID, len(req.Messages))

	if req.Stream {
		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("X-Accel-Buffering", "no")

		c.RequestCtx().SetBodyStreamWriter(func(w *bufio.Writer) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			err := h.service.CreateChatCompletionStream(ctx, req, func(chunk dto.ChatCompletionChunk) bool {
				return utils.SendSSEEvent(w, h.log, chunk)
			})
			if err != nil {
				h.log.Error("CreateChatCompletionStream failed", zap.Error(err), zap.String("model", req.Model))
				errChunk := dto.ChatCompletionChunk{
					ID:      fmt.Sprintf("chatcmpl-err-%d", time.Now().UnixNano()),
					Object:  "chat.completion.chunk",
					Created: time.Now().Unix(),
					Model:   req.Model,
					Choices: []dto.ChunkChoice{{
						Index:        0,
						Delta:        dto.ChatCompletionChunkDelta{Content: fmt.Sprintf("[ERROR] %s", err.Error())},
						FinishReason: "stop",
					}},
				}
				utils.SendSSEEvent(w, h.log, errChunk)
				_, _ = fmt.Fprintf(w, "data: [DONE]\n\n")
				_ = w.Flush()
				return
			}
			_, _ = fmt.Fprintf(w, "data: [DONE]\n\n")
			_ = w.Flush()
		})

		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	response, err := h.service.CreateChatCompletion(ctx, req)
	if err != nil {
		h.log.Error("CreateChatCompletion failed", zap.Error(err), zap.String("model", req.Model))
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorToResponse(err, "api_error"))
	}

	return c.JSON(response)
}

// HandleImageGenerations accepts image generation requests in OpenAI format
// @Summary Image Generations (OpenAI)
// @Description Generates images from a text prompt.
// @Tags OpenAI
// @Accept json
// @Produce json
// @Param request body dto.ImageGenerationRequest true "Image Generation Request"
// @Success 200 {object} dto.ImageGenerationResponse
// @Failure 400 {object} map[string]interface{}
// @Failure 500 {object} map[string]interface{}
// @Router /openai/v1/images/generations [post]
func (h *OpenAIController) HandleImageGenerations(c fiber.Ctx) error {
	var req dto.ImageGenerationRequest
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorToResponse(fmt.Errorf("invalid request body: %w", err), "invalid_request_error"))
	}

	// SSE 流式响应：定期发送心跳注释防止 Cloudflare 524 超时
	// （生图通常需要 1-3 分钟，超过 CF 的 100s 限制）
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	c.RequestCtx().SetBodyStreamWriter(func(w *bufio.Writer) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		// 心跳：每 15 秒发送一次 SSE 注释行
		heartbeatDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if _, err := fmt.Fprintf(w, ": keepalive\n\n"); err != nil {
						return
					}
					_ = w.Flush()
				case <-heartbeatDone:
					return
				}
			}
		}()

		response, err := h.service.CreateImageGeneration(ctx, req)
		close(heartbeatDone)
		if err != nil {
			h.log.Error("CreateImageGeneration failed", zap.Error(err), zap.String("model", req.Model))
			errMsg, _ := json.Marshal(map[string]string{"error": err.Error()})
			fmt.Fprintf(w, "data: %s\n\n", errMsg)
			fmt.Fprintf(w, "data: [DONE]\n\n")
			_ = w.Flush()
			return
		}

		// 发送结果
		resultJSON, _ := json.Marshal(response)
		fmt.Fprintf(w, "data: %s\n\n", resultJSON)
		fmt.Fprintf(w, "data: [DONE]\n\n")
		_ = w.Flush()
	})
	return nil
}

// HandleTitleGeneration generates a short conversation title from the first
// exchange. Runs in its own temporary Gemini chat — independent of any
// conversation continuation chain.
func (h *OpenAIController) HandleTitleGeneration(c fiber.Ctx) error {
	var req dto.TitleGenerationRequest
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorToResponse(fmt.Errorf("invalid request body: %w", err), "invalid_request_error"))
	}
	title, err := h.service.GenerateTitle(c.Context(), req.UserMessage, req.AssistantReply)
	if err != nil {
		h.log.Warn("GenerateTitle failed", zap.Error(err))
		return c.Status(fiber.StatusBadGateway).JSON(utils.ErrorToResponse(err, "api_error"))
	}
	return c.JSON(dto.TitleGenerationResponse{Title: title})
}

// Register registers the OpenAI routes onto the provided group
func (c *OpenAIController) Register(group fiber.Router) {
	group.Get("/models", c.HandleModels)
	group.Post("/chat/completions", c.HandleChatCompletions)
	group.Post("/images/generations", c.HandleImageGenerations)
	group.Post("/titles", c.HandleTitleGeneration)
}
