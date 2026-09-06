package auth

import (
	"github.com/gofiber/fiber/v3"
	"go.uber.org/fx"
)

var Module = fx.Options(
	fx.Provide(InitDB),
	fx.Provide(NewAuthHandler),
	fx.Invoke(RegisterAuthRoutes),
)

func RegisterAuthRoutes(app *fiber.App, h *AuthHandler) {
	group := app.Group("")
	h.Register(group)
}
