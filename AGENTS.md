# CLAUDE.md — Gemini Web Gateway 项目上下文

> 本文件供 AI Agent（如 Claude Code、Gemini、Cursor 等）在接手项目前阅读，快速了解架构、
> 文件职责、构建方式、已知陷阱与开发约定，避免重复踩坑。

---

## 项目一句话

把 gemini.google.com 网页版封装为 OpenAI 兼容 API + 多用户 Web 聊天界面，
通过浏览器 Cookie 鉴权，无需官方 API Key，所有上游流量走代理。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4 + Radix UI + PWA |
| 后端 | Go 1.25 + Fiber v3 + modernc.org/sqlite（纯 Go，无 CGO）+ uber/fx 依赖注入 |
| 认证 | JWT（golang-jwt/v5，HS256）+ bcrypt(12) + 邀请码注册 |
| 部署 | Docker Compose（gemini-api + Caddy 反代 + Cloudflare Tunnel 可选） |
| Cookie 同步 | 浏览器扩展（MV3，Chrome/Edge）→ 本机 Python 接收服务 → 后端热加载 |

---

## 目录结构与文件职责

```
gemini-gateway/
├── AGENTS.md                       ← 本文件（项目上下文）
├── README.md                       中文说明
├── README.en.md                    English 说明
├── LICENSE                         MIT
├── .env.example                    环境变量模板（真实 .env 不入库）
├── .gitignore
├── docker-compose.yml              主 compose 文件
├── docker-compose.named-tunnel.yml Cloudflare 命名隧道 override
│
├── backend/src/                    Go 后端源码（基于 ntthanh2603/gemini-web-to-api 二次开发）
│   ├── SOURCE-VERSION              上游基线 commit（abfc0d7），本地补丁全在工作区
│   ├── go.mod / go.sum
│   ├── Dockerfile                  多阶段构建（builder → scratch + Alpine rootfs）
│   ├── cmd/server/main.go          入口
│   └── internal/
│       ├── commons/
│       │   ├── configs/configs.go  全部环境变量解析 + 默认值；JWT secret 自动生成逻辑
│       │   ├── models/             公共数据结构
│       │   └── utils/              BuildPromptFromMessages（只取最后一条消息）、SSE 工具等
│       ├── modules/
│       │   ├── auth/               用户系统：JWT、bcrypt、SQLite 迁移（users/conversations/messages）
│       │   │   ├── database.go     数据库初始化 + 迁移（含 title_source 字段）
│       │   │   ├── handlers.go     /auth/register, /auth/login, /auth/me, PATCH /auth/profile
│       │   │   ├── middleware.go   JWT 中间件（跳过 /auth/*、/health、/proxy-image/*、/docs）
│       │   │   └── models.go       请求/响应 DTO
│       │   ├── conversations/      会话 CRUD
│       │   │   └── handlers.go     /conversations（POST/GET/DELETE）、PATCH（重命名+title_source）、/conversations/:id/messages
│       │   ├── openai/             OpenAI 兼容 API
│       │   │   ├── openai_service.go    核心：chat completions + 图片生成 + 标题生成
│       │   │   ├── openai_controller.go 路由：/chat/completions, /images/generations, /titles
│       │   │   └── dto/openai_dto.go    所有 OpenAI 相关 DTO
│       │   ├── providers/          Gemini Web 协议实现（核心！改动需格外小心）
│       │   │   ├── gemini_service.go     StreamGenerate、Session 初始化、模型刷新、Cookie 管理
│       │   │   ├── gemini_upload.go      Resumable Upload（文件上传）
│       │   │   ├── provider_interface.go GenerateOption/GenerateConfig、WithMetadata/WithTemporary/WithModel
│       │   │   └── provider_models.go    ModelInfo 结构体
│       │   ├── gemini/             原生 Gemini API 适配（非核心，不活跃）
│       │   └── claude/             Claude API 适配（非核心，不活跃）
│       └── server/
│           ├── server.go           Fiber 初始化、CORS、限流、JWT 中间件、proxy-image 端点
│           └── module.go           fx 生命周期
│
├── frontend/src/
│   ├── App.tsx                     根组件：认证网关 + 用户/模型缓存 + 会话管理
│   ├── components/
│   │   ├── ChatView.tsx            核心聊天组件：消息发送、流式接收、标题触发、会话双写
│   │   ├── Layout.tsx              响应式布局：侧边栏（会话列表+原地重命名+删除）、Header、移动端适配
│   │   ├── Composer.tsx            输入框：附件上传、工具切换、textarea 自适应
│   │   ├── LoginPage.tsx           登录页
│   │   ├── RegisterPage.tsx        注册页
│   │   ├── SettingsPage.tsx        用户设置（头像/用户名/密码修改）
│   │   ├── MarkdownRenderer.tsx    Markdown 渲染（KaTeX 数学公式、代码高亮）
│   │   └── ui/                     shadcn 风格基础组件（avatar/button/dialog/select 等）
│   ├── hooks/
│   │   └── useModels.ts            模型列表拉取（stale-while-revalidate 缓存策略）
│   ├── lib/
│   │   ├── api_client.ts           HTTP 客户端 + 会话双写 + 标题 API + 用户资料缓存
│   │   ├── think_parser.ts         思考内容解析
│   │   └── utils.ts                cn() 工具函数
│   └── types/index.ts              全局类型
│
├── caddy/
│   ├── Caddyfile                   反向代理 + 静态文件托管（/auth → backend，其余 → SPA）
│   └── proxy_image.py              图片代理脚本（已被 server.go 内置端点替代，保留备用）
│
├── cookie-sync/
│   ├── README.md                   Cookie 同步系统说明
│   ├── extension/                  MV3 浏览器扩展源码（background.js、relay.js、manifest.json）
│   ├── extension-dist/             烘焙后的扩展（含真实 Token，不入库）
│   ├── receiver.py                 本机 Python HTTP 服务（127.0.0.1:8799），接收扩展推送
│   ├── auto-cookie.py              自动从 Edge cookie DB 读取并推送（替代方案）
│   ├── cdp-cookie-sync.py          CDP 方式同步（替代方案）
│   ├── cookie-sync.html            书签工具页模板（__TOKEN__ 占位符，install 时烘焙）
│   ├── ensure-receiver.sh          launchd 保活脚本
│   └── ensure-edge-extension.sh    Edge 扩展保活脚本
│
├── scripts/
│   ├── build-backend.sh            构建后端 arm64 镜像（buildx + 代理）
│   ├── prepare-vendor.sh           预下载 vendor（离线构建用）
│   ├── install-cookie-sync.sh      一键安装 Cookie 同步（生成 Token + 烘焙扩展 + 注册 launchd）
│   ├── build-cloudflared-proxy.sh  构建 Cloudflare Tunnel 透明代理镜像
│   ├── verify.sh                   自检脚本
│   ├── url.sh                      显示当前公网地址
│   ├── logs.sh                     日志查看
│   └── update.sh                   更新后端上游
│
├── docs/
│   ├── deploy-guide.md             中文部署手册
│   ├── deploy-guide.en.md          English 部署手册
│   ├── design.md                   设计文档
│   └── original-requirements.md    原始需求
│
└── data/                           运行时数据（不入库）
    ├── cookies/                    Cookie 缓存 + debug dump
    └── db/                         SQLite 数据库（gateway.db）
```

---

## 构建命令

```bash
# 后端镜像（arm64，需要 buildx）
./scripts/build-backend.sh

# 前端（Node.js ≥ 18）
cd frontend && npm install && npm run build

# 重启
docker compose up -d --force-recreate gemini-api caddy

# 前端开发模式（热更新）
cd frontend && npm run dev
```

### 后端 Dockerfile 特殊说明

- 基于 `golang:1.25-alpine` + `scratch` 最终镜像
- 使用 `--network=none` 离线构建（依赖已通过 `prepare-vendor.sh` 预下载）
- 使用 scripts/buildkitd.toml 配置的 buildx 构建器（解决国内 DNS 污染问题）
- `scripts/build-backend.sh` 会自动下载 Alpine minirootfs（清华镜像）

---

## 环境变量（.env）

| 变量 | 说明 | 默认值 |
|---|---|---|
| `GEMINI_1PSID` | Gemini 会话 Cookie（必填） | — |
| `GEMINI_1PSIDTS` | Gemini 会话 Cookie（必填） | — |
| `GEMINI_GOOGLE_COOKIES` | 完整 Google Cookie（可选，竖线分隔） | — |
| `GEMINI_REFRESH_INTERVAL` | Cookie 自动刷新间隔（分钟） | 5 |
| `GEMINI_MAX_RETRIES` | 上游请求重试次数 | 3 |
| `GEMINI_TEMPORARY` | 无痕模式（不保存到官网历史） | false |
| `GEMINI_MODEL_ALIASES` | 模型别名映射（name=token,...） | — |
| `GEMINI_USER_AGENT` | 自定义上游 UA（对齐会话浏览器可降低误拒率） | Chrome/146 |
| `GEMINI_DEBUG` | 调试模式（dump 生图请求/响应） | false |
| `GATEWAY_JWT_SECRET` | JWT 签名密钥（留空自动生成随机值持久化到数据目录） | — |
| `GATEWAY_JWT_EXPIRE_DAYS` | JWT 有效期（天） | 30 |
| `GATEWAY_INVITE_CODE` | 注册邀请码（公网部署必须设置） | — |
| `GATEWAY_DB_PATH` | SQLite 路径 | /data/gateway.db |
| `GATEWAY_PROXY_URL` | 上游代理地址 | http://host.docker.internal:7890 |
| `TUNNEL_TOKEN` | Cloudflare 命名隧道 Token | — |
| `COOKIE_SYNC_TOKEN` | 扩展同步 Token（install-cookie-sync.sh 自动生成） | — |
| `RATE_LIMIT_ENABLED` | 限流开关 | true |
| `RATE_LIMIT_WINDOW_MS` | 限流窗口 | 60000 |
| `RATE_LIMIT_MAX_REQUESTS` | 每窗口最大请求数 | 30 |
| `PORT` | 后端监听端口 | 4981 |
| `LOG_LEVEL` | 日志级别 | info |

---

## 数据库 Schema（SQLite）

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    model TEXT,
    title_source TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    thinking TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

---

## API 端点一览

### 公开（无需 JWT）
- `POST /auth/register` — 注册（需邀请码）
- `POST /auth/login` — 登录，返回 JWT
- `GET /health` — 健康检查
- `GET /proxy-image/g?src=` — Google CDN 图片代理（白名单域名校验）
- `GET /proxy-image/b64?src=` — 图片转 base64
- `GET /docs` — API 文档（Scalar UI）
- `GET /openapi.json` — OpenAPI spec

### 需 JWT
- `GET /auth/me` — 当前用户信息
- `PATCH /auth/profile` — 修改头像/用户名/密码
- `GET /openai/v1/models` — 模型列表
- `POST /openai/v1/chat/completions` — 聊天（支持 stream）
- `POST /openai/v1/images/generations` — 生图（SSE 流式 + 心跳保活）
- `POST /openai/v1/titles` — 标题生成（独立临时会话，不污染主对话）
- `POST /conversations` — 创建会话
- `GET /conversations` — 列出会话
- `GET /conversations/:id` — 获取会话详情 + 消息
- `PATCH /conversations/:id` — 重命名 / 更新 title_source
- `DELETE /conversations/:id` — 删除会话
- `POST /conversations/:id/messages` — 追加消息

---

## 核心机制说明

### 对话延续（CID/RID/RCID）

从 Gemini 响应中提取三个字段，在 OpenAI 响应中原样返回：

- `conversation_id`（CID）：对话标识，全程不变
- `response_id`（RID）：每轮更新
- `choice_id`（RCID）：每轮更新

调用方回传这三个字段 → 后端注入 `inner[2]`（Gemini Web 协议的元数据位置）→ Gemini 在官网同一对话继续。

**关键格式**：`inner[2]` 是 10 元素数组，metadata 注入前三个位置：
```go
inner[2] = []interface{}{CID, RID, RCID, nil, nil, nil, nil, nil, nil, ""}
```
⚠️ 不能改变数组长度（之前尝试过只传3个元素，导致 Gemini 返回 400）。

### 会话标题系统

- 新会话创建时标题 = 首条消息截断（fallback）
- 第一轮回答完成后，前端异步调用 `POST /openai/v1/titles` 生成智能标题
- 标题生成走独立临时会话（`WithTemporary(true)`），不污染主对话 CID 链，不进官网历史
- `title_source=auto` 且 `titleGenerated=false` 时才触发生成，成功后锁定
- 用户手动重命名 → `title_source=manual`，永不覆盖
- 双写 localStorage + SQLite，刷新/重登保持

### 前端缓存策略（stale-while-revalidate）

- **模型列表**：localStorage 缓存，回访秒出，后台静默刷新
- **用户资料**：localStorage 缓存，回访秒出头像/用户名
- **登出时**：清除用户资料缓存，防止闪现上一账号

### 会话双写

前端 localStorage 是主存储（即时响应），SQLite 是持久化存储（跨设备/重装）：
- 创建/修改 → 先写 localStorage，异步 POST/PATCH 到服务端
- 登录/同步 → 从服务端拉取合并到 localStorage
- 离线 → localStorage 独立工作

---

## 开发约定

### 前端

- 组件文件：PascalCase（`ChatView.tsx`），工具/类型文件：camelCase（`api_client.ts`）
- 状态管理：纯 React useState/useRef/useCallback，无外部状态库
- CSS：Tailwind CSS 4（`@tailwindcss/vite` 插件），组件内联 style 对象
- shadcn 风格组件在 `components/ui/`
- 所有 API 调用通过 `lib/api_client.ts` 的 `api` 对象
- 前端构建产物在 `frontend/dist/`（Caddy 从这里托管静态文件）
- 消息气泡交互：用户和助手气泡均支持悬停复制（`Bubble` 组件 `onCopy`）；助手气泡另有重试/报告下载

### 后端

- Go 模块：`gemini-web-to-api`
- 依赖注入：uber/fx（各模块在 `module.go` 中声明 Provider/Invoke）
- 路由注册：controller 的 `Register(group fiber.Router)` 方法
- 日志：zap（生产用 JSON 格式，开发可改 LOG_LEVEL=debug）
- 数据库：`modernc.org/sqlite`（纯 Go 实现，无需 CGO，适合 Docker scratch 镜像）
- Cookie 敏感字段在日志中恒为 `[REDACTED]`

### 代码风格

- Go：标准 gofmt，无额外 linter 强制
- TypeScript：ESLint + TypeScript strict
- 提交信息：中文，简明描述改动内容

---

## 重要陷阱与已知问题

### 1. 上游风控与 User-Agent
Gemini 会话 Cookie 来自用户真实浏览器，网关请求的 UA 若过旧（如 Chrome/120）或与
会话浏览器差异过大，会触发上游风控——正常问题也被误拒。UA 已抽象为
`BrowserUserAgent` 变量（默认 Chrome/146），可用 `GEMINI_USER_AGENT` 环境变量覆盖。
纯文本请求也必须携带 `hl/_reqid/rt/bl/f.sid` 查询参数（对齐真实网页端形态）。

### 2. 长文本截断（checkStreamComplete）
StreamGenerate 的每一行是完整 JSON chunk（累积文本）。连接中途被切断时，末行是
残缺 JSON——若静默跳过会回退到较早 chunk（半截回答）。`checkStreamComplete` 校验
末行必须为完整 JSON，失败则重试（`gemini_service.go`，单测见 gemini_service_test.go）。

### 3. proxy-image 下载大小限制
`io.ReadAll` 已加 25MB LimitReader，但重定向链中每一跳都会校验域名（白名单机制）。

### 4. 生图超时
生图通常需要 1-3 分钟，超过 Cloudflare 免费版 100s 限制。
解决方案：后端改为 SSE 流式响应 + 每 15 秒心跳注释保活。

### 5. BuildPromptFromMessages 现状
当前只取最后一条用户消息内容（不含 User:/Model: 前缀）。
之前用 `User: ... Model: ...` 拼接全部历史会导致 Gemini 输出日语胡言乱语。

### 6. WithTemporary 选项
`GenerateOption` 中的 `Temporary` 字段会强制该请求为临时会话（不进官网历史）。
用于标题生成等内部辅助请求。注意：它会同时设置 `inner[45]=1` 和 `inner[67]=0`。

### 7. Cookie 自动同步扩展
源码中的 Token 是 `__TOKEN__` 占位符，真实 Token 由 `install-cookie-sync.sh` 烘焙到
`extension-dist/`（不入库）。如果手动改 Token，需重跑安装脚本。
保活分三层：扩展 3 分钟 alarm 推送 → receiver（心跳文件 `.last-push`）→
看门狗 `ensure-edge-extension.sh`（每 10 分钟检查心跳，停滞才开标签唤醒）。
**信号陷阱**：不能用 `.env` mtime（只在 1PSID 变化时写）或缓存文件 mtime
（值不变时跳写）判断链路存活——只有 `.last-push` 心跳代表推送链路健康。
receiver 只由 `com.gemini-gateway.receiver-monitor` 单一 launchd 条目管理。

### 8. 浏览器自动化测试（IAB）
Playwright 的 `press("Enter")` 和 `click()` 在 IAB 面板中可能超时（系统键盘焦点限制）。
替代方案：`evaluate()` + `dispatchEvent(new KeyboardEvent(...))` 或 CUA 坐标点击。

### 9. Docker 网络
Docker 内部通信使用 `NO_PROXY` 豁免（防止 OrbStack 注入的系统代理把内网请求发给 Clash）。
`.env` 中 `GATEWAY_PROXY_URL` 默认 `host.docker.internal:7890`（Docker Desktop / Linux），
OrbStack 用户需改为 `host.orb.internal:7890`。

### 10. 前端 PWA 缓存
Service Worker 会缓存前端资源。更新后用户可能看到旧版本，需强制刷新（Cmd+Shift+R）。
前端版本 hash 在 `vite.config.ts` 中的 `BUILD_ID` 定义。

### 11. 数据库迁移
`backend/src/internal/modules/auth/database.go` 中的 `migrate()` 函数使用
`ALTER TABLE ... ADD COLUMN` 增量迁移（SQLite 不支持 `IF NOT EXISTS` 在 ALTER 中，
靠 `Exec` 忽略 duplicate column 错误实现幂等）。

---

## 测试检查清单（改动后至少验证）

- [ ] `npm run build`（前端 TypeScript 编译）
- [ ] `./scripts/build-backend.sh`（后端镜像构建）
- [ ] `docker compose up -d`（服务启动）
- [ ] `curl http://localhost:8080/health`（健康检查）
- [ ] 浏览器打开 http://localhost:8080 → 登录 → 发消息 → 确认回答正常
- [ ] 侧边栏标题自动生成 + 手动重命名
- [ ] 生图功能（SSE 心跳保活）
- [ ] 多轮对话上下文延续（CID 不变）
- [ ] 刷新页面后会话/标题保持
- [ ] Cookie 过期后自动恢复（如装了扩展）

---

## 安全红线

- `.env`、`data/`、`cookie-sync/extension-dist/` 绝不入库
- Cookie、JWT secret、真实 IP/域名不出现在代码或日志明文中
- `GEMINI_DEBUG=true` 时的 dump 文件包含对话内容，仅限排查，用完即关
- 用户密码 bcrypt(12) 存储，绝不明文
- 会话归属严格按 user_id 过滤，不允许跨用户访问

---

## GitHub 仓库

- 地址：https://github.com/Lyumnire/gemini-gateway
- License：MIT
- 上游基线：ntthanh2603/gemini-web-to-api（MIT，commit abfc0d7）

---

*最后更新：2026-09-06*
