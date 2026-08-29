# Gemini Web Gateway

在 Mac mini（M2）上部署的**私人 Gemini 网页网关**：手机、平板、电脑浏览器直接
访问一个网址，就能使用与你 Mac 上登录状态一致的 Gemini 网页版能力——手机
**无需 VPN**，全部上游流量复用 Mac 的 Clash Verge 稳定代理。

> 需求原始文档：[docs/original-requirements.md](docs/original-requirements.md)
> 设计与选型依据：[docs/design.md](docs/design.md)
> 部署与运维手册：[docs/deploy-guide.md](docs/deploy-guide.md)

## 架构一图流

```
手机/电脑浏览器
   │  https://xxxx.trycloudflare.com（密码认证）
   ▼
Cloudflare Tunnel（出站隧道，无需公网端口映射/无 VNC/无串流）
   ▼
Caddy ── 密码认证 + React 前端静态文件 + API 反向代理
   ▼
gemini-web-to-api（Go，开源项目，把 gemini.google.com 网页协议
   │                封装为 OpenAI 兼容接口；只需浏览器 Cookie，
   │                不用 API Key、不产生 Google API 费用）
   │  HTTPS_PROXY 强制走 Clash，代码零改动
   ▼
Clash Verge (127.0.0.1:7897) → gemini.google.com（你的登录会话）
```

## 项目结构

```
gemini-gateway/
├── docker-compose.yml            # 三个服务：gemini-api / caddy / cloudflared
├── docker-compose.named-tunnel.yml  # 升级固定域名时的 override
├── .env.example / .env           # 配置模板 / 实际配置（含 Cookie，绝不提交）
├── caddy/Caddyfile               # basic_auth + 静态 + 反代
├── backend/
│   ├── README.md                 # 后端选型说明与 Plan B
│   ├── SOURCE-VERSION            # vendor 的上游 commit
│   └── src/                      # ntthanh2603/gemini-web-to-api 源码（保留 git）
├── frontend/                     # React 19 + TS + Vite + Tailwind v4 + PWA
│   ├── src/                      # 聊天 UI 源码
│   └── dist/                     # 构建产物（Caddy 挂载）
├── scripts/
│   ├── gen_env.py                # 生成 .env / 重置访问密码
│   ├── build-backend.sh          # 构建 arm64 后端镜像（带代理的 buildx）
│   ├── verify.sh                 # 一键自检（代理→容器→后端→网关→隧道）
│   ├── url.sh / logs.sh / update.sh
├── data/cookies/                 # 上游 Cookie 缓存（登录态持久化，重启不丢）
└── docs/                         # 设计文档 / 部署指南 / 原始需求
```

## 功能对照（需求 → 现状）

| 需求 | 实现 |
|---|---|
| 真 Web 应用（非串流） | React SPA，手机浏览器/PWA 可安装 |
| 不用 Gemini API、零费用 | 复用网页版会话 Cookie，逆向协议由开源项目承担 |
| OpenAI 兼容接口 | `POST /openai/v1/chat/completions`（另有 Claude/Gemini 协议） |
| 流式输出 | SSE；注意后端为"伪流式"（见下） |
| Markdown / 代码高亮 / LaTeX | react-markdown + highlight.js + KaTeX |
| 手机触摸优化 | 100dvh 布局、安全区适配、触屏 Enter 换行、底部回弹按钮 |
| 深色模式 | 跟随系统 + 手动三态切换 |
| 多轮上下文 | 每次请求携带完整历史（可跨设备） |
| 图片输入 | 聊天框附图（转为 data URL，上游支持图片理解/生图） |
| 全部请求走 Clash | `HTTPS_PROXY=http://host.orb.internal:7897` 强制注入 |
| 登录态持久化 | Cookie 自动轮换 + 落盘缓存；`restart: unless-stopped` |
| 访问认证 | Caddy basic_auth（admin + 随机密码，`gen_env.py --reset-pw` 重置） |
| Mac 重启自动恢复 | OrbStack 随登录启动 + compose 自动重启策略 |

## 已知限制（务必了解）

1. **伪流式**：上游项目把完整回复切块下发，首字延迟 ≈ Gemini 完整生成时间
   （长回复需等待 10-60 秒，期间前端显示思考动效）。
2. **公网隧道需要非 Cloudflare 系节点**：国内网络对 CF 隧道边缘有干扰，
   本项目已通过自制镜像（按域名经 Clash 转发）解决连通性，但 Clash 当前
   节点不能是 CF Workers/WARP 自建类型（判断方法见部署指南第六节）；
   trycloudflare 免费临时域名还存在 CF 侧 1000 拒绝的问题——**固定域名
   （命名隧道）是可靠的公网方案**。局域网模式不受任何影响，立即可用。
3. **ToS 风险**：网页协议逆向不符合 Google 服务条款，个人低频使用是社区
   普遍实践，但存在账号风控的小概率风险，请自行权衡。
4. 后端依赖上游开源项目维护；若协议变更导致失效，Plan B 见 `backend/README.md`。

## 快速开始

```bash
# 1) 生成配置与访问密码（改密码加 --reset-pw）
python3 scripts/gen_env.py

# 2) 把浏览器里的两个 Cookie 填进 .env（步骤见 docs/deploy-guide.md 第二节）

# 3) 构建（首次）
./scripts/build-backend.sh
cd frontend && npm install && npm run build && cd ..

# 4) 启动并自检
docker compose up -d
./scripts/verify.sh

# 5) 获取访问地址（手机浏览器打开，账号 admin）
./scripts/url.sh
```

局域网内也可直接访问 `http://<Mac IP>:8080`（同样需要密码）。

## 对需求文档的完善点（相对原始版本）

- 需求中的两个候选后端经过调研后**明确选型**：`gemini-web-to-api`（理由与
  源码级验证见 design.md），避免"盲目开发"。
- `trycloudflare` 随机域名与"重启自动恢复"的诉求存在天然矛盾，已明确
  折中方案并预留固定域名升级路径。
- 补齐了需求未覆盖但实际必须的环节：访问认证实现方式、Cookie 获取与
  轮换机制、被墙环境下的镜像构建方案（BuildKit 代理）、局域网备用入口、
  上游失效的 Plan B、安全清单。
