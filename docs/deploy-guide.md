# 部署与运维指南

日常只需要记住三条命令：

```bash
./scripts/verify.sh   # 一键自检（代理/容器/网关/隧道）
./scripts/url.sh      # 查看当前公网访问地址
./scripts/logs.sh     # 看日志（可跟服务名，如 gemini-api）
```

---

## 一、首次部署（已完成的部分可以跳过）

1. **安装**（本机已就绪）：OrbStack、cloudflared、Node、Clash Verge(7897)。
2. **生成配置**：`python3 scripts/gen_env.py` → 生成 `.env` 与随机访问密码
   （改密码：`python3 scripts/gen_env.py --reset-pw`，会打印新密码）。
3. **获取 Cookie**（见下节）填入 `.env` 的 `GEMINI_1PSID` / `GEMINI_1PSIDTS`。
4. **构建后端镜像**：`./scripts/build-backend.sh`（官方镜像无 arm64，本机构建）。
5. **构建前端**：`cd frontend && npm install && npm run build`。
6. **启动全部服务**：`docker compose up -d`。
7. **查看地址**：`./scripts/url.sh` → `https://xxxx.trycloudflare.com`，
   账号 `admin` + 生成的密码。

## 二、获取 Cookie（唯一需要手工做的步骤）

1. Mac 浏览器打开并登录 <https://gemini.google.com>（走 Clash，确认能正常对话）。
2. 按 `F12` 打开开发者工具 → **应用 / Application** → 存储 → **Cookie** →
   选中 `https://gemini.google.com`。
3. 找到并复制两行的**值**（Value）：
   - `__Secure-1PSID`
   - `__Secure-1PSIDTS`
4. 粘贴进项目根目录 `.env` 对应字段，保存。
5. 重启后端：`docker compose up -d gemini-api`，然后
   `docker compose logs gemini-api` 应看到 `✅ Gemini client initialized successfully`。

> 安全提示：这两个 Cookie 等同于你 Google 账号的登录凭据，不要发给任何人、
> 不要截图、不要提交到 git（`.env` 已被 `.gitignore` 排除）。
> 若怀疑泄露：在 Google 账号安全页面退出所有会话即可使其失效。

## 三、日常使用

| 操作 | 命令 |
|---|---|
| 启动全部服务 | `docker compose up -d` |
| 停止 | `docker compose down`（数据都在卷/目录里，不会丢） |
| 重启某个服务 | `docker compose restart gemini-api` |
| 看当前公网地址 | `./scripts/url.sh` |
| 自检 | `./scripts/verify.sh` |
| 更新后端上游 | `scripts/update.sh` |
| 改访问密码 | `python3 scripts/gen_env.py --reset-pw` 后 `docker compose up -d caddy` |

**局域网直连**（手机连家里 WiFi，不走隧道也能用）：访问
`http://<Mac的局域网IP>:8080`，同样需要账号密码。Mac 的 IP 在
系统设置 → Wi-Fi → 详细信息里查看。

## 四、开机自启（重启后自动恢复）

1. **OrbStack 随登录启动**：OrbStack 菜单栏图标 → 设置 → 勾选
   "Start at Login"（以及 "Start Docker automatically"）。
2. `docker-compose.yml` 中所有服务已设 `restart: unless-stopped`，
   Docker 起来后容器自动恢复。
3. **Clash Verge** 需要开机自启并保持 7897 混合端口开启（其设置里有
   "开机自启动"开关）。⚠️ 这是整条链路的前提。
4. Mac 本身：系统设置 → 节能 → 开机后自动启动；如需防止睡眠可执行
   `sudo pmset -a sleep 0 disksleep 0`（或插电使用）。

注意：临时隧道（trycloudflare）在重启后地址会变，重新执行
`./scripts/url.sh` 获取新地址。

## 五、升级为固定域名（当你有了 Cloudflare 托管的域名）

1. 域名 NS 托管到 Cloudflare（免费计划即可）。
2. Cloudflare Dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel**
   → 选 Cloudflared → 命名如 `gemini-gateway` → 创建后复制 **Token**。
3. 在 Tunnels 的 **Public Hostname** 里添加：
   子域如 `gemini`，域选你的域名，Service 选 `http://caddy:80`。
4. 把 Token 填入 `.env` 的 `TUNNEL_TOKEN=`。
5. 启动：
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.named-tunnel.yml up -d cloudflared
   ```
6. 以后固定访问 `https://gemini.你的域名.com`，重启不变，还可叠加
   Cloudflare Access（Zero Trust 免费版）做邮箱验证码二次认证。

## 六、公网隧道：前提与现状（重要，请先读）

本项目对隧道做了**专用改造**（`scripts/build-cloudflared-proxy.sh` 构建的
`gg-cloudflared-proxy:local` 镜像）：因为国内网络对 Cloudflare 隧道边缘端点
（argotunnel, 7844）有针对性干扰，容器内会把这部分流量**按域名**透明转发给
宿主机 Clash。这意味着：

> **前提 1：Clash 必须在运行（隧道与后端 Gemini 请求都依赖它）。**
> **前提 2：Clash 当前选中的节点必须是非 Cloudflare 系节点。**
> 判断方法：`curl -x http://127.0.0.1:7897 https://www.cloudflare.com/cdn-cgi/trace`
> 看 `ip=`——若是 `104.16~31.x / 104.28.x / 172.64~71.x` 等 CF 段，
> 说明节点是 CF Workers/WARP 自建类型，**无法用于隧道**（能上 Gemini，
> 但隧道边缘握手会被限制）。换成普通 VPS/机场直连节点即可。

**现状（2026-08-29 实测）**：换非 CF 节点后，隧道边缘连接已打通
（TCP 连通性双区域 PASS、边缘注册成功），但 trycloudflare **免费临时域名**
被 Cloudflare 以 "DNS points to prohibited IP"(1000) 拒绝——免费服务对部分
链路视角的限制，超出本端控制。因此：

- ✅ **局域网模式立即可用**：手机连家里 WiFi 访问 `http://Mac IP:8080`
- ⏳ **公网访问**：推荐直接上**固定域名（命名隧道，第五节）**——它复用同一套
  改造基础设施，且是 Cloudflare 官方支持的方式，不受 trycloudflare 的限制；
  若没有域名，也可考虑 Tailscale Funnel 等替代方案
- 隧道排错：`docker compose logs cloudflared` 看 CONNECTIVITY PRE-CHECKS 表格
  （TCP Connectivity 应为 PASS；UDP/QUIC FAIL 属预期，已强制 http2）

## 七、故障排查

| 症状 | 处理 |
|---|---|
| 手机打不开隧道地址 | `./scripts/verify.sh` 逐项看；重点第 5 步隧道是否建立 |
| 隧道地址每次都变 | 临时隧道特性；升级固定域名见第五节 |
| 公网 403 "DNS points to prohibited IP" | trycloudflare 免费服务限制；用固定域名（第五节） |
| 公网 530 | 边缘连接没建立：确认 Clash 节点非 CF 系（见第六节前提 2），`docker compose restart cloudflared` |
| 消息一直"思考中"后报错 | `./scripts/logs.sh gemini-api`：多为 cookie 失效（重新抄 Cookie）或 Clash 断了 |
| 后端容器一直重启 | 正常现象（未填/填错 cookie）；看日志确认错误类型 |
| 网页弹出两次密码框 | 浏览器记住凭据即可；若频繁出现清一次浏览器站点数据 |
| 回复出现 "Session error" | 上游会话令牌过期，后端会自动轮换重试；持续出现则重抄 Cookie |
| 出口 IP 想确认走没走 Clash | `curl -x http://127.0.0.1:7897 https://api.ipify.org` 与后端日志比对 |
| API 请求经 Caddy 挂起/超时 | **OrbStack 会随 macOS 系统代理向所有容器注入 `HTTP(S)_PROXY`**，反代到内部容器名的请求会被误发给 Clash。已在 compose 中用 `NO_PROXY=…gemini-api` 豁免；若改动服务名，记得同步更新 caddy 的 NO_PROXY |

## 八、安全清单

- [x] 后端不发布端口，仅容器网络可达；入口必须过 Caddy 认证
- [x] `.env`（含 Cookie 与密码哈希）被 `.gitignore` 排除
- [x] Cookie 缓存目录 `data/cookies/` 同样排除
- [x] 全链路 HTTPS（隧道 TLS 由 Cloudflare 终结）
- [x] 后端自带限流（默认 30 次/分钟，可在 `.env` 调整）
- [ ] 建议：有条件后升级固定域名 + Cloudflare Access 邮箱验证
- [ ] 建议：不要把隧道地址分享给他人（地址+密码=你账号的使用权）
