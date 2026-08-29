# Cookie 自动同步（零人工维护）

解决"Gemini Cookie 轮换导致网关失效"的问题：浏览器扩展把最新登录 Cookie
自动推送到本机接收服务，接收服务更新 `.env` 并按需重启后端容器。
**你唯一需要做的：装一次扩展（3 次点击）。之后无论 Cookie 怎么轮换、
甚至彻底过期后重新登录，网关都会自动恢复。**

## 工作原理

```
你打开 gemini.google.com（或扩展每 30 分钟定时）
  → 扩展用 chrome.cookies API 读取 __Secure-1PSID / __Secure-1PSIDTS
    （HttpOnly Cookie，普通脚本读不到，扩展有 host 授权可以）
  → 仅在值变化时 POST 到 http://127.0.0.1:8799（带 Token 校验）
  → 接收服务（LaunchAgent 常驻）原子更新 .env
  → Cookie 确实变化时自动 docker restart gg-gemini-api
  → 后端用新 Cookie 重新初始化，网关恢复
```

安全边界：接收服务只监听 `127.0.0.1`（局域网/公网不可达）；推送需携带
Token（存于 `.env` 的 `COOKIE_SYNC_TOKEN`，与扩展内一致）；Cookie 只落在本机。

## 安装（一次性）

```bash
./scripts/install-cookie-sync.sh
```

然后按脚本末尾提示把 `cookie-sync/extension-dist` 目录加载进 Chrome/Edge
（chrome://extensions → 开发者模式 → 加载已解压的扩展程序）。

## 日常

- 无任何维护动作。扩展在打开 Gemini 页面时 + 每 30 分钟定时推送；
  接收服务开机自启（LaunchAgent）。
- 接收服务日志：`~/Library/Logs/gemini-gateway-cookie-sync.log`
- 扩展推送情况：扩展详情页 → service worker → Console

## 注意

- 扩展需浏览器保持运行才会定时推送；浏览器长期不开时，靠后端自身的
  30 分钟轮换 + `data/cookies/` 持久化兜底（两者互为冗余）。
- 如果在别的电脑/浏览器登录 Gemini，本机扩展只在打开过 gemini.google.com
  的浏览器里生效。
