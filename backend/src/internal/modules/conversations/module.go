package conversations

import (
	"github.com/gofiber/fiber/v3"
	"go.uber.org/fx"
)

var Module = fx.Options(
	fx.Provide(NewHandler),
	fx.Invoke(RegisterRoutes),
)

func RegisterRoutes(app *fiber.App, h *Handler) {
	group := app.Group("")
	h.Register(group)
}
