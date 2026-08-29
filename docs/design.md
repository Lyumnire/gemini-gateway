# Gemini Web Gateway — 设计文档

> 状态：已实施 · 2026-08-29 · 原始需求见 [original-requirements.md](original-requirements.md)

## 1. 目标与动机

Mac mini（M2）上的 Clash Verge 可以稳定访问 `gemini.google.com` 并保持 Google
账号登录态；手机等设备开 VPN 不可靠。本项目让手机通过任意浏览器访问部署在
Mac 上的 Web 聊天界面，**借用 Mac 的网络与登录会话**使用 Gemini 网页版能力。

硬性约束（来自需求文档）：

- 不使用 VNC / RDP / 远程桌面 / 画面串流，必须是真正的 Web 应用
- 不调用 Google Gemini API（`generativelanguage.googleapis.com`），零 API 费用
- 所有上游请求必须经过 Clash Verge（`127.0.0.1:7897`）
- 登录状态持久化，Mac 重启后自动恢复
- 全链路私有：访问需认证，不泄露 Cookie

## 2. 总体架构

```
手机 / 电脑浏览器
   │  HTTPS（密码认证）
   ▼
Cloudflare 边缘节点
   │  Cloudflare Tunnel（cloudflared 容器，出站连接，无需公网端口映射）
   ▼
Caddy 容器（:80，容器网络内）
   │  basic_auth 认证 → 静态文件（React 构建产物）
   │                → 反向代理 API
   ▼
gemini-web-to-api 容器（Go，:4981，仅容器网络内）
   │  HTTPS_PROXY=http://host.orb.internal:7897  ← 强制经 Clash，代码零改动
   ▼
Clash Verge（宿主机 7897 混合端口） → gemini.google.com（复用浏览器 Cookie）
```

**信任边界**：公网入口只有 Cloudflare 隧道一个；后端容器不发布任何端口；
局域网入口 `:8080` 同样经过 Caddy 认证。Cookie 只存在于 `.env` 与
`data/cookies/`（容器内 `/home/appuser/.cookies`），二者均被 `.gitignore` 排除。

## 3. 关键决策与依据

### 3.1 后端：选用 `ntthanh2603/gemini-web-to-api`（而非自研）

| 候选 | 调研结论 |
|---|---|
| **ntthanh2603/gemini-web-to-api** | ✅ Go · 439★ · 2026-08 仍在维护 · 官方镜像 · Cookie 自动轮换 · OpenAI/Claude/Gemini 三协议 · 支持图片输入/生图/Deep Research |
| Lutiancheng1/gemini-webapi-proxy | 仅 2026-06 创建、5★、issue 全是 dependabot，无真实用户验证 |
| HanaokaYuzu/Gemini-API | 3445★ 活跃但是 Python 库（需自写服务层），列为 Plan B |

源码审查（vendor 于 `backend/src`，commit `abfc0d7`）确认：

- `req` 库默认 Transport 设 `http.ProxyFromEnvironment`；核心 StreamGenerate
  请求用 `&http.Client{}`（Transport nil → `http.DefaultTransport`，同样遵循环境变量）。
  → **设 `HTTPS_PROXY` 即可强制全量流量走 Clash，无需修改上游代码。**
- Cookie 持久化：仅 `__Secure-1PSID` 即可自动轮换取到 `__Secure-1PSIDTS`，
  有效值落盘 `.cookies`，重启不丢，后台定时刷新。
- 镜像构建：官方 GHCR 镜像仅 `linux/amd64`，故用 vendor 源码本机构建原生
  `arm64`（上游唯一改动是 Dockerfile 顶部的 `ARG GOPROXY` 两行）。

### 3.2 已知限制：伪流式（如实向用户披露）

后端把上游 `StreamGenerate` 的**完整回复**按 30 字符切块以 SSE 下发，即
首字延迟 ≈ Gemini 完整生成时间。缓解：前端在整个等待期显示三点"思考中"
动效，收到后仍以流式打字机呈现；如返回包含思考过程（reasoning），会先在
"思考过程"折叠框中流出。

### 3.3 认证：Caddy basic_auth（应用层无认证）

后端自身无鉴权，因此不能直接暴露。Caddy 统一拦截：浏览器首次访问弹
账号密码框，之后同源请求自动携带凭据；前端因此不需要自己的登录页。
若后续想升级双因素，可叠加 Cloudflare Access（免费 50 用户内，邮箱 OTP）。

### 3.4 隧道：临时域名起步，一键升级固定域名

当前（用户暂无自有域名）用 `cloudflared tunnel --url http://caddy:80` 的
免费临时隧道，`--protocol http2`（TCP 443）以规避国内 UDP QUIC 的不稳定。
代价：隧道/Mac 重启后 `xxxx.trycloudflare.com` 会变化。
升级路径已备好：`.env` 填 `TUNNEL_TOKEN` + 启动时叠加
`docker-compose.named-tunnel.yml`（覆盖 cloudflared 命令为命名隧道模式）。

### 3.5 网络细节（实测结论，非常重要）

- 容器 → 宿主机代理地址用 **`host.orb.internal:7897`**（实测连通；
  `host.docker.internal` 在部分场景不可靠）。
- Docker Hub 被墙的应对：OrbStack 已有国内镜像加速列表（保留），另为
  守护进程配了代理（`~/.orbstack/config/docker.json` 的 proxies）；
  BuildKit 默认构建器不吃该配置，因此 `scripts/build-backend.sh` 用
  docker-container 驱动的构建器并注入代理；Go 依赖预先 vendor（完全离线编译）；
  最终镜像基于清华镜像的 Alpine minirootfs 从零组装，不依赖 docker.io 的 alpine。
- **Cloudflare 隧道在国内的三个坑（全部实测踩过）**：
  1. argotunnel 边缘端点（7844）被针对性干扰：直连 TLS 返回 2020 年的过期证书，
     QUIC(UDP 7844) 直接超时；
  2. **Clash 节点类型有要求**：若节点是 Cloudflare 系自建（Workers/WARP，
     特征是出口 IP 属于 CF 段如 104.28.x），CF 代理回连 CF 隧道边缘被限制，
     同样拿到过期证书。**必须用非 Cloudflare 系节点**（普通 VPS/机场直连节点）；
  3. 即使按域名转发（修复了 IP 直连不命中分流规则的问题），trycloudflare 免费隧道
     仍可能被 CF 以 "DNS points to prohibited IP"(1000) 拒绝——免费临时域名在
     部分视角/链路下不稳定，**命名隧道（自有域名）是可靠路径**。
- 解决方案：自制 `gg-cloudflared-proxy:local` 镜像（`scripts/build-cloudflared-proxy.sh`）：
  容器内 /etc/hosts 劫持边缘域名 + iptables 按端口截获 7844 + Python 固定目标
  SOCKS5 转发器"按域名"转发给 Clash。边缘连接与 API 注册全部经 Clash。
  已验证：换非 CF 节点后 TCP 连通性双区域 PASS，边缘可注册。
- `go mod download` 走 `goproxy.cn`/`proxy.golang.org`（经代理）。

## 4. 组件与数据流

| 组件 | 形态 | 职责 |
|---|---|---|
| `frontend/` | React 19 + TS + Vite + Tailwind v4 + vite-plugin-pwa | 聊天 UI：SSE 流式渲染、Markdown/GFM/代码高亮/KaTeX、多会话（localStorage）、图片输入、深色模式、PWA 安装 |
| `caddy/Caddyfile` | Caddy 2 | basic_auth、静态托管 `frontend/dist`、`/openai /claude /gemini /health /docs` 反代 |
| `backend/src` | 上游 vendor 源码 | Gemini Web 协议 → OpenAI 兼容 API |
| `cloudflared` | 官方镜像 | 出站隧道 |
| `data/cookies/` | 卷 | 上游 cookie 缓存（登录态持久化） |
| `.env` | 本地文件 | Cookie、密码哈希、代理地址、隧道 Token |

前端会话上下文：每次请求携带完整历史（OpenAI messages 数组），后端按
`BuildPromptFromMessages` 拼接为一次上游请求 —— 无状态、可跨设备；
对话列表存 localStorage（每设备独立）。

## 5. 错误处理与降级

- 上游 401/会话失效：后端自动轮换 cookie 重试（`GEMINI_MAX_RETRIES`）；
  仍失败则前端气泡显示错误 + "重试"按钮。
- 前端 fetch 401（Caddy 认证过期）：提示刷新页面重新输入密码。
- Clash 未运行：后端请求全部失败，`scripts/verify.sh` 第 1 步即可定位。
- 后端未填 cookie：容器反复重启（预期行为），填好 `.env` 后 `docker compose up -d` 自愈。

## 6. 风险与 Plan B

- **合规风险**：网页协议逆向不符合 Google ToS，存在账号被风控的小概率
  事件；个人低频使用是社区普遍实践，但需用户知情。
- **协议变更风险**：上游失效时优先 `scripts/update.sh` 拉新重建；其次用
  `HanaokaYuzu/Gemini-API`（Python）自写薄封装；兜底为官方 API 免费额度
  （与"零费用"目标冲突，仅在彻底失效时考虑）。前端只依赖
  `/openai/v1/chat/completions`，切换后端无需改前端。
