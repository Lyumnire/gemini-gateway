你需要在我的 Mac mini M2 上部署一个私人 Gemini Web Gateway。

## 项目目标

我希望通过 Cloudflare Tunnel 提供的免费公网域名访问：

```
https://xxxx.trycloudflare.com
```

然后在手机和电脑浏览器中均获得类似 ChatGPT/Gemini 官方网页的体验。

要求：

- 不使用 VNC
- 不使用 RDP
- 不使用远程桌面
- 不使用浏览器画面串流

手机端必须是真正的 Web 应用：

- HTML
- CSS
- JavaScript
- React UI

而不是视频流。


---

# 核心架构

最终架构：

```
手机浏览器、电脑浏览器
      |
      |
Cloudflare Tunnel 免费域名
      |
      |
Mac mini M2
      |
      |
React Gemini Web UI
      |
      |
Gemini Gateway Backend
      |
      |
Gemini Web Protocol
      |
      |
Clash Verge Proxy
      |
      |
Google Gemini
```


---

# 核心原则

不要调用：

```
Google Gemini API
```

不要使用：

```
generativelanguage.googleapis.com
```

不要产生 API Key 费用。

目标是：

复用 Gemini 网页版能力。

即：

```
gemini.google.com
```

通过已有 Google 登录 Session 使用。


---

# 后端方案

优先评估并使用成熟开源项目：

候选：

1.

gemini-webapi-proxy

https://github.com/Lutiancheng1/gemini-webapi-proxy


2.

gemini-web-to-api

https://github.com/ntthanh2603/gemini-web-to-api


3.

其他成熟 Gemini Web reverse engineering 项目


不要从零逆向 Gemini 协议。


要求：

后端提供：

OpenAI-compatible API：

例如：

```
POST /v1/chat/completions
```

支持：

- streaming
- conversation context
- markdown
- image input（如果底层支持）


---

# 前端

创建一个移动端友好的 Gemini UI。


技术：

```
React
TypeScript
Vite
TailwindCSS
PWA
```


功能：

必须支持：

- 聊天窗口
- Markdown
- 代码高亮
- LaTeX
- SSE 流式输出
- 自动滚动
- 手机触摸优化
- 深色模式


目标：

手机访问：

```
xxxx.trycloudflare.com
```

体验类似：

```
gemini.google.com
```

而不是：

```
远程桌面
```


---

# 网络代理

Mac mini 已安装：

```
Clash Verge
```

并且：

```
Mac mini -> Clash Verge -> Gemini
```

已经正常。


所有 Gemini 请求必须：

经过 Clash Verge。


禁止：

Gemini Gateway 绕过 Clash 直接访问公网。


需要验证：

出口 IP。


---

# Google 登录

第一次部署：

允许人工登录。


不要：

- 导出密码
- 破解 OAuth
- 修改 Cookie


允许：

- 浏览器 Cookie
- Session 文件
- 安全保存的 token


必须：

持久化登录状态。


重启后：

```
Mac mini
 ↓
Docker
 ↓
Gateway
 ↓
Gemini
```

仍然可用。


---

# Docker部署

优先：

Docker Compose。


目录：

```
gemini-gateway/

├── docker-compose.yml

├── backend/

├── frontend/

├── data/

├── .env

└── README.md
```


要求：

所有服务：

```
restart: unless-stopped
```


---

# Cloudflare Tunnel

不要使用：

公网端口映射。


使用：

cloudflared。


目标：

```
手机
 |
 HTTPS
 |
Cloudflare
 |
Tunnel
 |
Mac mini localhost
```


---

# 安全

必须：

- 不公开 API
- 添加访问认证
- 不泄露 Gemini Cookie
- 不提交 .env
- 不输出 Session


---

# 开发流程

严格分阶段。


## Phase 1

检查环境：

确认：

- macOS版本
- ARM架构
- Docker
- Clash Verge
- 网络


## Phase 2

部署 Gemini Gateway。


测试：

本地：

```
curl localhost
```


确认：

可以调用 Gemini。


## Phase 3

开发 React 前端。


确认：

手机局域网访问。


## Phase 4

接入 Cloudflare Tunnel。


## Phase 5

优化：

- PWA
- 手机体验
- 自动启动
- 日志


---

# 最终验收

必须达到：

1.

手机访问 Cloudflare 免费域名。


2.

看到真正 Web UI。



5.

Gemini 可以正常回答。


6.

支持流式输出。


7.

请求经过 Clash Verge。


8.

不需要 Gemini API Key。


9.

不产生 Google API 费用。


10.

Mac mini 重启后自动恢复。


请先分析现有开源 Gemini Web API 项目的可行性，再选择最稳定方案，不要盲目开发。