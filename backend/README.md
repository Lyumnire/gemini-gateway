# 后端：gemini-web-to-api

后端**没有自研代码**，直接使用社区成熟开源项目
[ntthanh2603/gemini-web-to-api](https://github.com/ntthanh2603/gemini-web-to-api)
（Go，439+ star，2026-08 仍在活跃维护）。

> **为什么本地构建？** 官方 GHCR 镜像只发布 `linux/amd64` 架构。上游源码已
> vendor 到本目录的 `src/`（保留 git 仓库），由 docker-compose 在本机构建原生
> `arm64` 镜像。对上游源码唯一的改动是 `src/Dockerfile` 顶部的 2 行构建参数
> （`GOPROXY`），业务代码零改动。当前版本见 `SOURCE-VERSION`。
>
> 更新后端：`cd backend/src && git pull && docker compose build gemini-api && docker compose up -d gemini-api`

它把 `gemini.google.com` 网页版协议逆向封装成 **OpenAI 兼容 API**，
复用你浏览器里的登录 Cookie，不需要任何 API Key、不产生 Google API 费用。

## 选型过程

| 候选 | 结论 |
|---|---|
| **ntthanh2603/gemini-web-to-api** | ✅ 选定：439 star、官方 GHCR 多架构镜像、cookie 自动轮换持久化、支持 OpenAI/Claude/Gemini 三协议、支持图片输入与生图 |
| Lutiancheng1/gemini-webapi-proxy | 2026-06 新项目，5 star，无真实用户验证，风险高 |
| HanaokaYuzu/Gemini-API（Python 库） | 3445 star 活跃，但是库不是服务，需要自写 FastAPI 封装，作为 Plan B |

源码审查确认的关键点：

- `req` 库默认 Transport 使用 `http.ProxyFromEnvironment`，核心请求用标准 `http.Client`
  （Transport 为 nil 时回退 `http.DefaultTransport`，同样遵循环境变量）——
  因此设置 `HTTPS_PROXY` 环境变量即可**强制所有请求走 Clash Verge**，无需改代码。
- Cookie 持久化：只给 `__Secure-1PSID` 也能自动轮换获取 `__Secure-1PSIDTS`，
  有效 cookie 会缓存到 `/home/appuser/.cookies`（本项目的 `data/cookies/`），重启不丢。
- 流式输出为**伪流式**：拿到完整回复后按 30 字符切块以 SSE 下发；
  首字延迟 ≈ Gemini 完整生成时间。前端已做"思考中"动效适配。

## 主要端点（经 Caddy 认证后暴露）

- `POST /openai/v1/chat/completions` — OpenAI 兼容（本项目前端使用）
- `POST /claude/v1/messages` — Claude 协议
- `POST /gemini/v1beta/models/{model}:generateContent` / `:streamGenerateContent` — Gemini 原生协议
- `GET /health` — 健康检查；`GET /docs` — Scalar 交互文档
- `GET /openai/v1/models` — 模型列表（如 `gemini-advanced`）

## 环境变量

见项目根目录 `.env.example`，逐项有注释。完整列表以
[官方 README](https://github.com/ntthanh2603/gemini-web-to-api#configuration) 为准。

## Plan B（若上游协议变更导致失效）

前端只依赖 OpenAI 兼容的 `/openai/v1/chat/completions`，切换后端不影响前端：

1. 首选等待 `gemini-web-to-api` 更新（该项目维护活跃，历史上响应快）；
2. 或用 `HanaokaYuzu/Gemini-API`（Python，`gemini_webapi` 包，显式支持 `proxy` 参数）
   自写一个 FastAPI 薄封装实现相同端点；
3. 兜底：官方 Gemini API 免费额度（需要 API Key，与本项目"零费用、复用网页版"目标冲突，
   仅在逆向方案彻底失效时考虑）。
