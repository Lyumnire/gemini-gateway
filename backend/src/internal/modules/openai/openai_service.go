package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"gemini-web-to-api/internal/commons/models"
	"gemini-web-to-api/internal/commons/utils"
	"gemini-web-to-api/internal/modules/openai/dto"
	"gemini-web-to-api/internal/modules/providers"

	"go.uber.org/zap"
)

var imagePlaceholderRegex = regexp.MustCompile(`(?i)https?://googleusercontent\.com/image_generation_content/\d+`)

type OpenAIService struct {
	client *providers.Client
	log    *zap.Logger
}

func NewOpenAIService(client *providers.Client, log *zap.Logger) *OpenAIService {
	return &OpenAIService{
		client: client,
		log:    log,
	}
}

func (s *OpenAIService) ListModels() []providers.ModelInfo {
	return s.client.ListModels()
}

// metadataString safely extracts a string from metadata map
func metadataString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// extractLatestUserMessage returns the content of the last user message
func extractLatestUserMessage(messages []models.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" && messages[i].Content != "" {
			return messages[i].Content
		}
	}
	return ""
}

// extractLatestUserAttachments returns attachments from the last user message
func extractLatestUserAttachments(messages []models.Message) []models.Attachment {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" && len(messages[i].Attachments) > 0 {
			return messages[i].Attachments
		}
	}
	return nil
}

func (s *OpenAIService) CreateChatCompletion(ctx context.Context, req dto.ChatCompletionRequest) (*dto.ChatCompletionResponse, error) {
	modelMessages := req.ToModelMessages()

	// Logic: Validate messages
	if err := utils.ValidateMessages(modelMessages); err != nil {
		return nil, err
	}

	// Logic: Validate generation parameters
	if err := utils.ValidateGenerationRequest(req.Model, req.MaxTokens, req.Temperature); err != nil {
		return nil, err
	}

	opts := []providers.GenerateOption{}
	if req.Model != "" {
		opts = append(opts, providers.WithModel(req.Model))
	}

	hasContext := req.ConversationID != "" && req.ChoiceID != ""
	var prompt string
	var inputFiles []providers.InputFile

	if hasContext {
		// 继续对话：只发最新用户消息，Gemini 通过 CID/RID/RCID 找到上下文
		latestMsg := extractLatestUserMessage(modelMessages)
		if latestMsg == "" {
			return nil, fmt.Errorf("no valid user message found")
		}
		if req.HasToolsEnabled() {
			latestMsg = s.buildToolBridgePrompt(req, latestMsg)
		}
		prompt = latestMsg
		latestAttachments := extractLatestUserAttachments(modelMessages)
		inputFiles, _ = providers.InputFilesFromAttachmentList(latestAttachments)
		s.log.Info("[CHAT] continuation (latest only)",
			zap.String("cid", req.ConversationID),
			zap.String("rid", req.ResponseID),
			zap.String("rcid", req.ChoiceID),
			zap.Int("promptLen", len(prompt)),
		)
		opts = append(opts, providers.WithMetadata(&providers.SessionMetadata{
			ConversationID: req.ConversationID,
			ResponseID:     req.ResponseID,
			ChoiceID:       req.ChoiceID,
		}))
	} else {
		// 新对话：发完整历史
		prompt = utils.BuildPromptFromMessages(modelMessages, "")
		if prompt == "" {
			return nil, fmt.Errorf("no valid content in messages")
		}
		if req.HasToolsEnabled() {
			prompt = s.buildToolBridgePrompt(req, prompt)
		}
		inputFiles, _ = providers.InputFilesFromAttachments(modelMessages)
		s.log.Info("[CHAT] new conversation",
			zap.Int("msgCount", len(modelMessages)),
			zap.Int("promptLen", len(prompt)),
		)
	}

	if len(inputFiles) > 0 {
		opts = append(opts, providers.WithInputFiles(inputFiles))
	}

	// Logic: Call Provider
	response, err := s.client.GenerateContent(ctx, prompt, opts...)
	if err != nil {
		return nil, err
	}

	message := dto.ChatCompletionResponseMessage{Role: "assistant"}
	finishReason := "stop"

	if req.HasToolsEnabled() {
		toolCalls, content := s.parseToolBridgeOutput(req, response.Text)
		if len(toolCalls) == 0 {
			fallback := s.buildFallbackToolCalls(req)
			if len(fallback) > 0 && (req.ToolChoiceMode() == "required" || req.ToolChoiceMode() == "function") {
				toolCalls = fallback
			}
		}

		if len(toolCalls) > 0 {
			message.ToolCalls = toolCalls
			finishReason = "tool_calls"
		} else {
			message.Content = content
		}
	} else {
		content := imagePlaceholderRegex.ReplaceAllString(response.Text, "")
		content = strings.TrimSpace(content)
		if len(response.Images) > 0 {
			var imgMarkdowns []string
			for _, img := range response.Images {
				imgMarkdowns = append(imgMarkdowns, fmt.Sprintf("![image](%s)", img.URL))
			}
			if content != "" {
				content += "\n\n"
			}
			content += strings.Join(imgMarkdowns, "\n")
		}
		message.Content = content
	}

	message.ReasoningContent = response.ReasoningText

	// Logic: Construct Response
	return &dto.ChatCompletionResponse{
		ID:      fmt.Sprintf("chatcmpl-%d", time.Now().Unix()),
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   req.Model,
		Choices: []dto.Choice{
			{
				Index:        0,
				Message:      message,
				FinishReason: finishReason,
			},
		},
		Usage: models.Usage{
			PromptTokens:     0,
			CompletionTokens: 0,
			TotalTokens:      0,
		},
		// Gemini 对话上下文（前端保存，下次请求带上）
		ConversationID: metadataString(response.Metadata, "cid"),
		ResponseID:     metadataString(response.Metadata, "rid"),
		ChoiceID:       metadataString(response.Metadata, "rcid"),
	}, nil
}

func (s *OpenAIService) CreateImageGeneration(ctx context.Context, req dto.ImageGenerationRequest) (*dto.ImageGenerationResponse, error) {
	reqID := fmt.Sprintf("IMG-%s", time.Now().Format("01150405"))
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("prompt is required")
	}

	n := req.N
	if n <= 0 {
		n = 1
	}
	if n > 10 {
		return nil, fmt.Errorf("n must be between 1 and 10")
	}

	imagePrompt := buildImageGenerationPrompt(prompt, req.Size)
	wantB64 := strings.EqualFold(req.ResponseFormat, "b64_json")
	opts := []providers.GenerateOption{}
	if req.Model != "" {
		opts = append(opts, providers.WithModel(req.Model))
	}
	if wantB64 {
		opts = append(opts, providers.WithGeneratedImageDownload(true))
	}
	// 如果有对话元数据，注入以在同一对话内生图
	if req.ConversationID != "" && req.ChoiceID != "" {
		opts = append(opts, providers.WithMetadata(&providers.SessionMetadata{
			ConversationID: req.ConversationID,
			ResponseID:     req.ResponseID,
			ChoiceID:       req.ChoiceID,
		}))
		s.log.Info("[IMG] continuation mode",
			zap.String("cid", req.ConversationID),
		)
	}

	s.log.Info("[IMG] start",
		zap.String("req_id", reqID),
		zap.String("model", req.Model),
		zap.String("prompt", prompt[:min(len(prompt), 80)]),
		zap.Bool("b64", wantB64),
	)

	data := make([]dto.ImageGenerationData, 0, n)
	var lastResponse *providers.Response
	for len(data) < n {
		response, err := s.client.GenerateContent(ctx, imagePrompt, opts...)
		lastResponse = response
		if err != nil {
			s.log.Error("[IMG] GenerateContent failed",
				zap.String("req_id", reqID),
				zap.Error(err),
			)
			return nil, fmt.Errorf("[%s] upstream error: %w", reqID, err)
		}

		// 诊断：记录 response 概况
		allImages := len(response.Images)
		generatedImages := make([]providers.Image, 0, allImages)
		for _, image := range response.Images {
			if image.Generated {
				generatedImages = append(generatedImages, image)
			}
		}
		s.log.Info("[IMG] response received",
			zap.String("req_id", reqID),
			zap.Int("total_images", allImages),
			zap.Int("generated_images", len(generatedImages)),
			zap.Int("text_len", len(response.Text)),
			zap.String("conv_id", response.ConversationID),
		)

		if len(generatedImages) == 0 {
			// 诊断：记录 response 文本（Gemini 可能返回了拒绝消息）
			snippet := response.Text
			if len(snippet) > 300 {
				snippet = snippet[:300]
			}
			s.log.Warn("[IMG] no generated images",
				zap.String("req_id", reqID),
				zap.Int("all_images", allImages),
				zap.String("response_text", snippet),
				zap.Int("candidates", len(response.Candidates)),
			)
			return nil, fmt.Errorf("[%s] provider returned no generated images (text: %s)", reqID, snippet)
		}

		for _, image := range generatedImages {
			if len(data) >= n {
				break
			}
			s.log.Info("[IMG] image extracted",
				zap.String("req_id", reqID),
				zap.String("url_host", hostOf(image.URL)),
				zap.Int("b64_len", len(image.B64JSON)),
				zap.Bool("generated", image.Generated),
				zap.String("mime", image.MimeType),
			)
			item := dto.ImageGenerationData{RevisedPrompt: prompt}
			if wantB64 {
				if image.B64JSON == "" {
					s.log.Error("[IMG] image has no bytes",
						zap.String("req_id", reqID),
						zap.String("url", image.URL),
					)
					return nil, fmt.Errorf("[%s] provider returned image metadata without image bytes", reqID)
				}
				item.B64JSON = image.B64JSON
			} else {
				item.URL = image.URL
			}
			data = append(data, item)
		}
	}

	s.log.Info("[IMG] success",
		zap.String("req_id", reqID),
		zap.Int("count", len(data)),
	)
	resp := &dto.ImageGenerationResponse{
		Created: time.Now().Unix(),
		Data:    data,
	}
	if lastResponse != nil {
		resp.ConversationID = metadataString(lastResponse.Metadata, "cid")
		resp.ResponseID = metadataString(lastResponse.Metadata, "rid")
		resp.ChoiceID = metadataString(lastResponse.Metadata, "rcid")
	}
	return resp, nil
}

func hostOf(u string) string {
	if u == "" {
		return ""
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}

func buildImageGenerationPrompt(prompt, size string) string {
	var b strings.Builder
	b.WriteString("Generate an image from this prompt. Return the generated image, not only a text description.\n\nPrompt: ")
	b.WriteString(prompt)
	if strings.TrimSpace(size) != "" {
		b.WriteString("\nRequested size/aspect: ")
		b.WriteString(strings.TrimSpace(size))
	}
	return b.String()
}

// CreateChatCompletionStream handles OpenAI streaming logic within the service layer.
func (s *OpenAIService) CreateChatCompletionStream(ctx context.Context, req dto.ChatCompletionRequest, onEvent func(dto.ChatCompletionChunk) bool) error {
	response, err := s.CreateChatCompletion(ctx, req)
	if err != nil {
		return err
	}

	chunkID := response.ID
	created := response.Created
	choice := response.Choices[0]

	// Case 1: Tool Calls
	if len(choice.Message.ToolCalls) > 0 {
		for i, tc := range choice.Message.ToolCalls {
			delta := dto.ChatCompletionChunkDelta{}
			if i == 0 {
				delta.Role = "assistant"
			}
			delta.ToolCalls = []dto.ChatCompletionChunkDeltaToolCall{
				{
					Index: i,
					ID:    tc.ID,
					Type:  "function",
					Function: dto.ChatCompletionChunkDeltaToolFunction{
						Name:      tc.Function.Name,
						Arguments: tc.Function.Arguments,
					},
				},
			}

			if !onEvent(dto.ChatCompletionChunk{
				ID:      chunkID,
				Object:  "chat.completion.chunk",
				Created: created,
				Model:   req.Model,
				Choices: []dto.ChunkChoice{{Index: 0, Delta: delta}},
			}) {
				return nil
			}
		}

		// Final tool_calls chunk
		onEvent(dto.ChatCompletionChunk{
			ID:      chunkID,
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   req.Model,
			Choices: []dto.ChunkChoice{{Index: 0, FinishReason: "tool_calls"}},
		})
		return nil
	}

	// 发送对话元数据（前端保存，下次请求带上）
	if response.ConversationID != "" || response.ChoiceID != "" {
		metadataChunk := dto.ChatCompletionChunk{
			ID:             chunkID,
			Object:         "chat.completion.chunk",
			Created:        created,
			Model:          req.Model,
			Choices:        []dto.ChunkChoice{},
			ConversationID: response.ConversationID,
			ResponseID:     response.ResponseID,
			ChoiceID:       response.ChoiceID,
		}
		onEvent(metadataChunk)
	}

	// Case 2: Regular Text
	if choice.Message.ReasoningContent != "" {
		reasoningChunks := utils.SplitResponseIntoChunks(choice.Message.ReasoningContent, 30)
		for _, content := range reasoningChunks {
			if !onEvent(dto.ChatCompletionChunk{
				ID:      chunkID,
				Object:  "chat.completion.chunk",
				Created: created,
				Model:   req.Model,
				Choices: []dto.ChunkChoice{{
					Index: 0,
					Delta: dto.ChatCompletionChunkDelta{ReasoningContent: content},
				}},
			}) {
				return nil
			}
			if !utils.SleepWithCancel(ctx, 30*time.Millisecond) {
				return nil
			}
		}
	}

	chunks := utils.SplitResponseIntoChunks(choice.Message.Content, 30)
	for _, content := range chunks {
		if !onEvent(dto.ChatCompletionChunk{
			ID:      chunkID,
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   req.Model,
			Choices: []dto.ChunkChoice{{Index: 0, Delta: dto.ChatCompletionChunkDelta{Content: content}}},
		}) {
			return nil
		}
		if !utils.SleepWithCancel(ctx, 30*time.Millisecond) {
			return nil
		}
	}

	// Final text chunk
	onEvent(dto.ChatCompletionChunk{
		ID:      chunkID,
		Object:  "chat.completion.chunk",
		Created: created,
		Model:   req.Model,
		Choices: []dto.ChunkChoice{{Index: 0, FinishReason: choice.FinishReason}},
	})

	return nil
}

type toolBridgePayload struct {
	ToolCalls []toolBridgeCall `json:"tool_calls"`
	Content   string           `json:"content"`
}

type toolBridgeCall struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func (s *OpenAIService) buildToolBridgePrompt(req dto.ChatCompletionRequest, basePrompt string) string {
	var b strings.Builder
	b.WriteString("You are an OpenAI-compatible assistant running behind a bridge to Gemini web.\n")
	b.WriteString("You MUST respond with JSON only. Do not output markdown code fences.\n")
	b.WriteString("Output schema:\n")
	b.WriteString("{\"tool_calls\":[{\"name\":\"<tool_name>\",\"arguments\":{}}]} OR {\"content\":\"<assistant_text>\"}\n")
	b.WriteString("Rules:\n")
	b.WriteString("- Use only tool names listed below.\n")
	b.WriteString("- arguments must be valid JSON object.\n")

	toolChoiceMode := req.ToolChoiceMode()
	if toolChoiceMode == "required" {
		b.WriteString("- You must return at least one tool call.\n")
	}
	if toolChoiceMode == "function" {
		forced := req.ForcedToolName()
		if forced != "" {
			b.WriteString("- You must return exactly one tool call with name: ")
			b.WriteString(forced)
			b.WriteString("\n")
		}
	}
	if toolChoiceMode == "none" {
		b.WriteString("- Tool calling disabled. Return only {\"content\":\"...\"}.\n")
	}

	b.WriteString("Available tools:\n")
	for _, t := range req.Tools {
		if !strings.EqualFold(t.Type, "function") || strings.TrimSpace(t.Function.Name) == "" {
			continue
		}
		b.WriteString("- name: ")
		b.WriteString(strings.TrimSpace(t.Function.Name))
		if strings.TrimSpace(t.Function.Description) != "" {
			b.WriteString(" | description: ")
			b.WriteString(strings.TrimSpace(t.Function.Description))
		}
		if len(t.Function.Parameters) > 0 {
			b.WriteString(" | parameters: ")
			b.Write(t.Function.Parameters)
		}
		b.WriteString("\n")
	}

	b.WriteString("\nConversation:\n")
	b.WriteString(basePrompt)
	return b.String()
}

func (s *OpenAIService) parseToolBridgeOutput(req dto.ChatCompletionRequest, text string) ([]dto.ChatCompletionToolCall, string) {
	cleaned := utils.StripCodeFence(text)
	if cleaned == "" {
		return nil, ""
	}

	payload, ok := decodeToolBridgePayload(cleaned)
	if !ok {
		return nil, strings.TrimSpace(text)
	}

	allowed := make(map[string]struct{}, len(req.Tools))
	for _, t := range req.Tools {
		if strings.EqualFold(t.Type, "function") {
			name := strings.TrimSpace(t.Function.Name)
			if name != "" {
				allowed[name] = struct{}{}
			}
		}
	}

	forcedName := req.ForcedToolName()
	calls := make([]dto.ChatCompletionToolCall, 0, len(payload.ToolCalls))
	for i, tc := range payload.ToolCalls {
		name := strings.TrimSpace(tc.Name)
		if name == "" {
			continue
		}
		if len(allowed) > 0 {
			if _, ok := allowed[name]; !ok {
				continue
			}
		}
		if forcedName != "" && name != forcedName {
			continue
		}

		calls = append(calls, dto.ChatCompletionToolCall{
			ID:   fmt.Sprintf("call_%d_%d", time.Now().UnixNano(), i),
			Type: "function",
			Function: dto.ChatCompletionToolCallFunction{
				Name:      name,
				Arguments: normalizeArguments(tc.Arguments),
			},
		})
	}

	content := strings.TrimSpace(payload.Content)
	if content == "" && len(calls) == 0 {
		content = strings.TrimSpace(text)
	}
	return calls, content
}

func (s *OpenAIService) buildFallbackToolCalls(req dto.ChatCompletionRequest) []dto.ChatCompletionToolCall {
	forced := req.ForcedToolName()
	if forced != "" {
		return []dto.ChatCompletionToolCall{
			{
				ID:   fmt.Sprintf("call_%d_0", time.Now().UnixNano()),
				Type: "function",
				Function: dto.ChatCompletionToolCallFunction{
					Name:      forced,
					Arguments: "{}",
				},
			},
		}
	}

	if req.ToolChoiceMode() == "required" {
		for _, t := range req.Tools {
			if strings.EqualFold(t.Type, "function") && strings.TrimSpace(t.Function.Name) != "" {
				return []dto.ChatCompletionToolCall{
					{
						ID:   fmt.Sprintf("call_%d_0", time.Now().UnixNano()),
						Type: "function",
						Function: dto.ChatCompletionToolCallFunction{
							Name:      strings.TrimSpace(t.Function.Name),
							Arguments: "{}",
						},
					},
				}
			}
		}
	}

	return nil
}

func decodeToolBridgePayload(text string) (toolBridgePayload, bool) {
	var payload toolBridgePayload
	if err := json.Unmarshal([]byte(text), &payload); err == nil {
		return payload, true
	}

	obj := extractFirstJSONObject(text)
	if obj == "" {
		return toolBridgePayload{}, false
	}
	if err := json.Unmarshal([]byte(obj), &payload); err != nil {
		return toolBridgePayload{}, false
	}
	return payload, true
}

func extractFirstJSONObject(text string) string {
	start := strings.Index(text, "{")
	if start < 0 {
		return ""
	}

	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(text); i++ {
		ch := text[i]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = false
			}
			continue
		}

		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return strings.TrimSpace(text[start : i+1])
			}
		}
	}
	return ""
}

func normalizeArguments(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return "{}"
	}

	if strings.HasPrefix(trimmed, "\"") {
		var asString string
		if err := json.Unmarshal(raw, &asString); err == nil {
			trimmed = strings.TrimSpace(asString)
			if trimmed == "" {
				return "{}"
			}
		}
	}

	var compact bytes.Buffer
	if err := json.Compact(&compact, []byte(trimmed)); err != nil {
		return "{}"
	}
	return compact.String()
}

// ---------------------------------------------------------------------------
// 会话标题自动生成（独立临时会话，不污染主对话的 CID/RID/RCID 链）
// ---------------------------------------------------------------------------

// pickTitleModel chooses a fast text model for title generation.
func (s *OpenAIService) pickTitleModel() string {
	ids := s.client.ListModelsIDs()
	for _, pref := range []string{"gemini-2.5-flash", "gemini-2.0-flash", "gemini-3-flash-preview"} {
		for _, id := range ids {
			if id == pref {
				return pref
			}
		}
	}
	for _, id := range ids {
		// 避开图像/TTS 等非文本模型
		if !strings.Contains(id, "image") && !strings.Contains(id, "tts") {
			return id
		}
	}
	return "gemini-2.5-flash"
}

// sanitizeTitle cleans up model output into a usable title: strips quotes,
// markdown decoration and surrounding whitespace, clamps to 24 runes.
func sanitizeTitle(raw string) string {
	t := strings.TrimSpace(raw)
	// 去掉模型可能加的包裹符号与 markdown 修饰
	for _, pair := range [][2]string{
		{"「", "」"}, {"『", "』"}, {"“", "”"}, {"『", "』"},
		{"\"", "\""}, {"'", "'"}, {"#", ""}, {"*", ""},
	} {
		t = strings.TrimPrefix(t, pair[0])
		t = strings.TrimSuffix(t, pair[1])
		t = strings.TrimSpace(t)
	}
	// 取第一行（防止输出解释文字）
	if idx := strings.IndexAny(t, "\n。；;"); idx > 0 {
		t = t[:idx]
	}
	t = strings.TrimSpace(t)
	// rune 安全截断到 24 字（sidebar 负责进一步 ellipsis）
	runes := []rune(t)
	if len(runes) > 24 {
		t = string(runes[:24])
	}
	return t
}

// GenerateTitle creates a short conversation title from the first exchange.
// Runs as its own temporary Gemini chat — never touches the user's
// conversation continuation chain and never appears in gemini.google.com
// history.
func (s *OpenAIService) GenerateTitle(ctx context.Context, userMessage, assistantReply string) (string, error) {
	um := strings.TrimSpace(userMessage)
	ar := strings.TrimSpace(assistantReply)
	if um == "" {
		return "", fmt.Errorf("user message is required")
	}
	// 控制输入体积：标题只需要主题概要
	um = truncateRunes(um, 600)
	ar = truncateRunes(ar, 600)

	var b strings.Builder
	b.WriteString("你是一个标题生成器。根据下面的对话内容生成一个简短标题。\n")
	b.WriteString("要求：\n")
	b.WriteString("- 概括对话的核心主题\n")
	b.WriteString("- 中文对话必须使用中文标题\n")
	b.WriteString("- 长度5到15个字\n")
	b.WriteString("- 不要使用引号，结尾不要标点\n")
	b.WriteString("- 不要使用\"聊天\"\"对话\"\"问题\"\"求助\"等无意义词\n")
	b.WriteString("- 不要照抄用户原话，要提炼主题\n")
	b.WriteString("- 只返回标题本身，不要任何解释或前缀\n")
	b.WriteString("\n用户：")
	b.WriteString(um)
	b.WriteString("\n\n助手：")
	b.WriteString(ar)
	b.WriteString("\n\n标题：")

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	response, err := s.client.GenerateContent(ctx, b.String(),
		providers.WithModel(s.pickTitleModel()),
		providers.WithTemporary(true),
	)
	if err != nil {
		return "", err
	}
	title := sanitizeTitle(response.Text)
	if title == "" {
		return "", fmt.Errorf("empty title generated")
	}
	return title, nil
}

func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}
