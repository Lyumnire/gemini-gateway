package providers

import (
	"context"

	"go.uber.org/fx"
	"go.uber.org/zap"
)

var Module = fx.Options(
	fx.Provide(NewProviderManager),
	fx.Invoke(RegisterProvider),
)

func RegisterProvider(pm *ProviderManager, c *Client, log *zap.Logger) {
	pm.Register("gemini", c)

	// Initialize specifically this provider
	initErr := c.Init(context.Background())
	if initErr != nil {
		log.Error("Gemini provider initialization failed (will retry in background)", zap.Error(initErr))
	}

	// Select Gemini as the active provider（即使 init 失败也要注册，否则后续请求全部 500）
	if selErr := pm.SelectProvider("gemini"); selErr != nil {
		log.Error("Failed to select Gemini provider", zap.Error(selErr))
	}

	// ⚠️ 必须在 Init 之外单独启动自动刷新循环。
	// Init() 失败时 startAutoRefresh 未启动（在 Init 内部的 if err==nil 分支），
	// 导致缓存后续被扩展更新后，后端永远不会重试——即使 PSIDTS 已恢复。
	// 单独启动可确保：init 失败 → autoRefresh 5 分钟后重试 → 缓存有新值则自动恢复。
	c.mu.RLock()
	running := c.autoRefresh
	c.mu.RUnlock()
	if running && initErr != nil {
		go c.startAutoRefresh()
		log.Info("Started auto-refresh in background (will retry when extension pushes fresh cookies)")
	}
}
