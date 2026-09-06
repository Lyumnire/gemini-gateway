<div align="center">

# Gemini Web Gateway

**把 gemini.google.com 网页版封装为 OpenAI 兼容 API 与多用户 Web 聊天界面**

[English](README.en.md) | 简体中文

</div>

---

> ⚠️ **项目性质声明**：本项目通过 Gemini **网页端**（gemini.google.com）的非官方接口工作，
> 使用你已登录的浏览器会话（Cookie）鉴权，**不是** Google 官方 Gemini API，与 Google 无关。
> 能力、额度与可用性完全取决于你的 Google 账号、所在地区与 Google 服务端策略，随时可能变动或失效。
> 请仅将本项目用于个人学习研究，遵守 Google 服务条款。

---

## 功能特性

- **OpenAI 兼容 API**：`/openai/v1/chat/completions`（流式/非流式）、`/openai/v1/images/generations`、`/openai/v1/models`
- **Web 聊天界面**：React + Vite 前端，桌面/移动端自适应，PWA
- **多用户系统**：JWT 认证 + SQLite 存储 + 邀请码注册，bcrypt(12) 密码哈希
- **真·多轮对话**：通过 Gemini 会话 ID（CID/RID/RCID）在官网**同一对话**内继续，而非每次拼接全部历史
- **图片生成**：与文字对话同一会话，SSE 心跳保活避免长任务被反向代理超时中断
- **文件上传**：支持图片/PDF 等多模态输入（Gemini Web Resumable Upload 协议）
- **Cookie 自动保活**：后台会话刷新 + 可选浏览器扩展自动同步 Cookie（几乎零人工维护）
- **网络代理**：所有上游流量强制走 HTTPS_PROXY（Clash 等），支持国内网络环境

## 架构

```
浏览器 / 任意 OpenAI 客户端
        │  HTTPS
        ▼
┌─────────────────────────────┐
│  Caddy（静态前端 + 反向代理）  │
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│  Go Gateway（本项目后端）      │
│  · JWT 多用户认证             │
│  · OpenAI 兼容 API           │
│  · SQLite 会话存储           │
└──────────┬──────────────────┘
           │  HTTPS_PROXY（可选，如 Clash）
           ▼
   gemini.google.com（网页协议）
```

公网访问可选叠加 Cloudflare Tunnel（出站隧道，无需公网端口）。
注意：**Tunnel 是入站链路，HTTPS_PROXY 是出站链路**，二者方向相反、互不替代。

## 仓库结构

```
gemini-gateway/
├── backend/src/          # Go 后端（基于 ntthanh2603/gemini-web-to-api 二次开发）
│   └── SOURCE-VERSION    # 记录上游基线 commit
├── frontend/             # React + TypeScript + Vite 前端
├── caddy/                # Caddyfile（静态 + 反代）
├── cookie-sync/          # Cookie 自动同步：浏览器扩展 + 本机接收服务
├── scripts/              # 构建 / 部署 / 自检脚本
├── docs/                 # 设计文档与部署手册
├── docker-compose.yml
└── .env.example          # 配置模板（复制为 .env 使用）
```

## 环境要求

| 依赖 | 说明 |
|---|---|
| Docker + Docker Compose | 推荐部署方式 |
| 可访问 Gemini 的网络出口 | 直接可达，或本机代理（Clash/Surge 等，默认混合端口 7890） |
| Google 账号 | 需能正常使用 gemini.google.com 网页版 |
| Node.js ≥ 18 + Go ≥ 1.24 | 仅从源码构建时需要 |

## 快速开始（Docker Compose）

```bash
# 1. 克隆并配置
git clone <your-repo-url> gemini-gateway
cd gemini-gateway
cp .env.example .env

# 2. 编辑 .env：至少填写 GEMINI_1PSID / GEMINI_1PSIDTS
#    获取方式见下文「Gemini 网页版鉴权」

# 3. 构建并启动
docker compose build
docker compose up -d

# 4. 打开 http://localhost:8080 注册账号（需 .env 中的邀请码）后即可使用
```

## Gemini 网页版鉴权

本项目使用你已登录的浏览器会话，**没有也不需要官方 API Key**：

1. 本机浏览器（建议与网关同机）登录 <https://gemini.google.com>
2. `F12` → Application → Cookies → `https://gemini.google.com`
3. 复制 `__Secure-1PSID` 与 `__Secure-1PSIDTS` 的值，填入 `.env`
4. `docker compose up -d gemini-api` 重启后端

**Cookie 自动同步（推荐）**：运行 `./scripts/install-cookie-sync.sh`，把生成的
`cookie-sync/extension-dist` 以开发者模式加载进 Chrome/Edge。之后打开
gemini.google.com 时 Cookie 自动推送到网关，过期后重新登录一次即可自动恢复。

> 🔐 **安全警告**：会话 Cookie 等同于 Google 账号登录凭据。
> 不要提交到 Git、不要截图分享；怀疑泄露时到 Google 账号安全页面退出所有会话。

## 代理配置

所有到 Gemini 的上游请求强制经过 `GATEWAY_PROXY_URL`（HTTP(S)_PROXY）：

```env
# 通用（Docker Desktop / Linux 宿主机）
GATEWAY_PROXY_URL=http://host.docker.internal:7890
# OrbStack (macOS)
GATEWAY_PROXY_URL=http://host.orb.internal:7890
```

## 手动部署（macOS / Linux）

```bash
# 后端
cd backend/src
go build -o gateway ./cmd/server/main.go
PORT=4981 GEMINI_1PSID=xxx GEMINI_1PSIDTS=yyy ./gateway

# 前端
cd frontend
npm install
npm run build        # 产物在 dist/，用任意静态服务器或 Caddy 托管
```

生产建议仍使用 Docker Compose（env 注入、自愈重启、健康检查齐全）。

## Cloudflare Tunnel（可选，公网访问）

```bash
# 免费临时域名（地址随重启变化）
docker compose --profile tunnel up cloudflared

# 固定域名：Cloudflare Zero Trust → Tunnels 创建后，把 Token 填入 .env
# TUNNEL_TOKEN=<YOUR_TUNNEL_TOKEN>
docker compose -f docker-compose.yml -f docker-compose.named-tunnel.yml up -d cloudflared
```

在 Tunnel 的 Public Hostname 中将子域指向 `http://caddy:80`。

## API 兼容性

OpenAI **部分**兼容（非 100%）。已实现：

| 端点 | 说明 |
|---|---|
| `POST /openai/v1/chat/completions` | 聊天补全，支持 `stream: true`（SSE）、视觉输入 |
| `POST /openai/v1/images/generations` | 文生图，支持 `response_format: b64_json` |
| `GET /openai/v1/models` | 模型列表（来自官网会话动态刷新） |

扩展字段（非 OpenAI 标准）：请求/响应中的 `conversation_id` / `response_id` /
`choice_id` 用于跨请求延续 Gemini 会话——**前端已自动处理**，直连 API 的调用方
如需多轮上下文请回传这三个字段。

```bash
curl http://localhost:8080/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## 对话延续机制

网关从每次 Gemini 响应中提取会话三元组并在响应中返回：

```
Round 1  请求（无元数据）        → 新建官网对话，返回 C1/R1/RC1
Round 2  请求（带 C1/R1/RC1）    → 官网同一对话继续，返回 C1/R2/RC2
Round 3  请求（带 C1/R2/RC2）    → 官网同一对话继续，返回 C1/R3/RC3
```

特性：CID 全程不变（官网只产生一个对话）；RID/RCID 每轮更新；带元数据时仅发送
最新一条用户消息，官网用户气泡中不会出现手工拼接的历史文本。

## 用户系统

- 注册需邀请码（`GATEWAY_INVITE_CODE`，公网部署**必须**设置）
- 密码 bcrypt(12) 哈希存储；JWT 有效期默认 30 天
- 每个用户只能访问自己的会话记录（服务端按 user_id 过滤）
- 会话双写：SQLite 持久化 + 浏览器 localStorage 缓存

## 配置项

| 变量 | 必填 | 说明 |
|---|---|---|
| `GEMINI_1PSID` / `GEMINI_1PSIDTS` | ✅ | Gemini 网页版会话 Cookie |
| `GATEWAY_JWT_SECRET` | 建议 | JWT 密钥；留空自动生成并持久化 |
| `GATEWAY_INVITE_CODE` | 公网必填 | 注册邀请码 |
| `GATEWAY_PROXY_URL` | 视网络 | 上游代理，如 `http://host.docker.internal:7890` |
| `GEMINI_GOOGLE_COOKIES` | 可选 | 完整 Google Cookie（生图 CDN 下载用） |
| `GEMINI_MODEL_ALIASES` | 可选 | 官网模型别名 → 动态令牌 |
| `GEMINI_DEBUG` | — | `true` 时 dump 生图请求/响应（含对话内容，仅排查用） |
| `TUNNEL_TOKEN` | 可选 | Cloudflare 命名隧道 |
| `RATE_LIMIT_MAX_REQUESTS` | — | 每分钟请求数上限（默认 30） |
| `GATEWAY_DB_PATH` | — | SQLite 路径（默认 `/data/gateway.db`） |

完整清单见 [.env.example](.env.example)。

## 安全

本项目与 Gemini 交互使用的是**已认证浏览器会话**，请像保管密码一样保管以下内容：

- Google/Gemini Cookie 与会话令牌
- `GATEWAY_JWT_SECRET` / `TUNNEL_TOKEN` / `COOKIE_SYNC_TOKEN`
- `data/` 目录（用户数据库、Cookie 缓存、调试产物）
- 用户密码、聊天记录、上传文件

已内置的防护：JWT 中间件（注册/登录/健康检查/图片代理白名单除外）、按用户隔离的
会话存储、bcrypt 密码哈希、请求限流、图片代理域名白名单 + 重定向逐跳校验 +
下载体积上限、上传体积限制（50MB）、日志中 Cookie 恒为 `[REDACTED]`。
CORS 为 `*` 但**不允许 credentials**（JWT 走 Authorization 头，不依赖 Cookie）。

## 故障排查

| 症状 | 处理 |
|---|---|
| 启动即退出 / 模型列表为空 | Cookie 失效或未填；看 `docker compose logs gemini-api` |
| 请求 502 / 连接上游失败 | `GATEWAY_PROXY_URL` 不通；确认代理进程与端口 |
| 回复出现 "Session error" | 会话令牌过期；重启后端或重抄 Cookie |
| 生图失败 | 受账号/地区/速率限制影响；确认官网同账号可生图 |
| 文件上传失败 | 检查文件大小（≤50MB）与 Cookie 有效性 |
| 多轮对话不连续 | 确认调用方回传了响应中的 `conversation_id` 等三字段 |

更多见 [docs/deploy-guide.md](docs/deploy-guide.md)。

## 局限性

- 依赖 Gemini 网页端私有协议，Google 改版可能导致功能失效
- 可用模型、生图额度、速率由账号与地区决定，**不保证无限额度或固定模型**
- 音频（TTS）等端点未完整适配
- 长耗时请求（如深度研究）依赖反向代理超时配置（Caddy 默认足够；Cloudflare 免费版 100s，生图已用 SSE 心跳规避）

## 开发

```bash
# 后端单测/构建
cd backend/src && go build ./...
# 前端开发
cd frontend && npm install && npm run dev
# 后端镜像（arm64）
./scripts/build-backend.sh
```

后端基于 [ntthanh2603/gemini-web-to-api](https://github.com/ntthanh2603/gemini-web-to-api)
（MIT License）二次开发，基线 commit 见 `backend/SOURCE-VERSION`，感谢原作者。

## 贡献

欢迎 Issue / PR。提交前请确认：不包含任何 Cookie、Token、真实域名或用户数据。

## 许可证

[MIT](LICENSE)。上游依赖 `backend/src` 遵循其自身 [MIT 许可](backend/src/LICENSE)（Copyright (c) 2025 Nguyễn Tuấn Thành）。

> ⚠️ 本项目与 Google 无关，"Gemini" 是 Google LLC 的商标，此处仅作描述性使用。
