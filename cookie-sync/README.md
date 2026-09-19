# Cookie 自动同步（零人工维护）

解决"Gemini Cookie 轮换导致网关失效"的问题：浏览器扩展把最新登录 Cookie
自动推送到本机接收服务，接收服务直写后端缓存并按需重建容器。
**你唯一需要做的：装一次扩展（3 次点击）。之后无论 Cookie 怎么轮换、
甚至彻底过期后重新登录，网关都会自动恢复。**

## 工作原理（三层保活）

```
第一层  扩展（主动推送）
  chrome.alarms 每 3 分钟推送一次（Service Worker 挂起也会被 alarm 唤醒）
  + Cookie 变化时即时推送 + gemini.google.com 页面加载时推送
  → chrome.cookies API 读取 __Secure-1PSID / __Secure-1PSIDTS
    （HttpOnly Cookie，普通脚本读不到，扩展有 host 授权可以）
  → POST http://127.0.0.1:8799（Token 校验）

第二层  接收服务 receiver.py（LaunchAgent 看门脚本保活）
  · 1PSID（长效）→ 写入 .env；PSIDTS（短命）→ 直写后端缓存文件
    data/cookies/<sha256(1PSID)>.txt（后端每分钟热加载，无需重启）
  · 值确实变化时自动 docker force-recreate 后端
  · 每次成功推送都刷新心跳文件 data/cookies/.last-push
  · com.gemini-gateway.receiver-monitor：每 60s 健康检查，挂了自动拉起

第三层  看门狗 ensure-edge-extension.sh（launchd 每 10 分钟）
  · 检查心跳文件新鲜度
  · 心跳 < 10 分钟 → 静默退出，Edge 完全无感（健康态永远走这里）
  · 心跳 ≥ 10 分钟 → 推送链路已死（扩展挂了/Edge 未运行/receiver 不可达）：
    启动 Edge（若未运行）→ 开一次 Gemini 标签唤醒扩展推送 → 关标签
  · 最坏恢复时间 ≈ 20 分钟（PSIDTS 有效期数小时，安全）
```

安全边界：接收服务只监听 `127.0.0.1`（局域网/公网不可达）；推送需携带
Token（存于 `.env` 的 `COOKIE_SYNC_TOKEN`，与扩展内一致）；Cookie 只落在本机。

## 安装（一次性）

```bash
./scripts/install-cookie-sync.sh
```

然后按脚本末尾提示把 `cookie-sync/extension-dist` 目录加载进 Chrome/Edge
（chrome://extensions → 开发者模式 → 加载已解压的扩展程序）。
脚本会自动注册两个 LaunchAgent（receiver 看门 + 推送看门狗），并清理
旧版 launchd 条目。

## 日常

- 无任何维护动作。健康状态下 Edge 完全无感（无标签闪烁）；
  仅当推送链路停滞超过 10 分钟时，看门狗才会开一次标签唤醒扩展。
- 接收服务日志：`/tmp/cookie-receiver.log`
- 推送心跳：`data/cookies/.last-push` 的 mtime（`stat -f %m`）
- 扩展推送情况：扩展详情页 → service worker → Console

## 注意

- 看门狗会在推送链路停滞时自动启动 Edge——这是保活的必要条件
  （Cookie 推送依赖浏览器运行）。若希望 Edge 夜间关闭，网关会在
  最迟 20 分钟内重新拉起它。
- 如果在别的电脑/浏览器登录 Gemini，本机扩展只在打开过 gemini.google.com
  的浏览器里生效。
