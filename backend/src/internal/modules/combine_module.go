package modules

import (
	"gemini-web-to-api/internal/modules/auth"
	"gemini-web-to-api/internal/modules/claude"
	"gemini-web-to-api/internal/modules/conversations"
	"gemini-web-to-api/internal/modules/gemini"
	"gemini-web-to-api/internal/modules/openai"
	"gemini-web-to-api/internal/modules/providers"
	"go.uber.org/fx"
)

var Module = fx.Options(
	auth.Module,
	conversations.Module,
	gemini.Module,
	claude.Module,
	openai.Module,
	providers.Module,
)
