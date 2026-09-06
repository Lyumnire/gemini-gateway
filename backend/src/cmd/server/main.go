package main

import (
	"gemini-web-to-api/internal/commons/configs"
	"gemini-web-to-api/internal/modules"
	"gemini-web-to-api/internal/server"
	"gemini-web-to-api/pkg/logger"

	"go.uber.org/fx"
)

func main() {
	cfg, err := configs.New()
	if err != nil {
		panic("config error: " + err.Error())
	}

	log, err := logger.New(cfg.LogLevel)
	if err != nil {
		panic("logger error: " + err.Error())
	}

	fx.New(
		fx.Supply(cfg),
		fx.Supply(log),
		server.Module,
		modules.Module,
		fx.NopLogger,
	).Run()
}
