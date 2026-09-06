# Deployment & Operations Guide (English)

> 中文版：[deploy-guide.md](deploy-guide.md)

Daily driver — three commands:

```bash
./scripts/verify.sh   # self-check (proxy / containers / gateway / tunnel)
./scripts/url.sh      # show current public URL
./scripts/logs.sh     # logs (optionally: ./scripts/logs.sh gemini-api)
```

## 1. First deployment

1. **Prereqs**: Docker (OrbStack / Docker Desktop), Node.js ≥ 18, a proxy able
   to reach Gemini (e.g. Clash mixed port 7890) — unless your network reaches
   Gemini directly.
2. **Configure**: `cp .env.example .env`, then edit. For public deployments you
   MUST set `GATEWAY_JWT_SECRET` (`openssl rand -hex 32`) and
   `GATEWAY_INVITE_CODE`.
3. **Cookies**: fill `GEMINI_1PSID` / `GEMINI_1PSIDTS` (see section 2).
4. **Build the backend image**: `./scripts/build-backend.sh` (local arm64 build;
   upstream publishes amd64 only).
5. **Build the frontend**: `cd frontend && npm install && npm run build`
   (served by the caddy container).
6. **Start everything**: `docker compose up -d`.
7. **Open** `http://localhost:8080` (or your tunnel URL) and register with the
   invite code.

## 2. Getting cookies (auto-sync recommended)

**Automatic (recommended)**: run `./scripts/install-cookie-sync.sh`, then load
`cookie-sync/extension-dist` into Chrome/Edge via developer mode. Cookies are
pushed to the gateway whenever gemini.google.com is open; after a full expiry,
one manual re-login restores everything.

**Manual**:

1. Log in to <https://gemini.google.com> in your browser.
2. `F12` → Application → Cookies → `https://gemini.google.com`.
3. Copy the **values** of `__Secure-1PSID` and `__Secure-1PSIDTS`.
4. Paste into `.env`, then `docker compose up -d gemini-api`.
5. Verify: `docker compose logs gemini-api` should show
   `✅ Gemini client initialized successfully`.

> 🔐 These cookies are equivalent to your Google login credentials. Never share
> or commit them. If leaked, sign out all sessions in Google Account settings.

## 3. Daily operations

| Task | Command |
|---|---|
| Start all | `docker compose up -d` |
| Stop | `docker compose down` (data persists in volumes/dirs) |
| Restart one service | `docker compose restart gemini-api` |
| Current public URL | `./scripts/url.sh` |
| Self-check | `./scripts/verify.sh` |

LAN access: `http://<host-LAN-IP>:8080` (register/login like usual).

## 4. Named tunnel (fixed domain)

1. Host your domain's DNS on Cloudflare (free plan is fine).
2. Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared) → copy the **Token**.
3. Add a Public Hostname: subdomain → your domain → Service `http://caddy:80`.
4. Put the token into `.env` (`TUNNEL_TOKEN=`).
5. `docker compose -f docker-compose.yml -f docker-compose.named-tunnel.yml up -d cloudflared`

Optional hardening: front the app with Cloudflare Access (Zero Trust free tier)
for email-OTP second factor.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Container restarts forever | Cookies missing/invalid — check logs |
| Empty model list | Cookie expired — re-sync |
| Requests hang through the proxy | Container-injected `HTTP(S)_PROXY` intercepting internal traffic; compose already sets `NO_PROXY=…gemini-api` |
| Replies contain "Session error" | Session token stale — backend rotates automatically; if persistent, refresh cookies |
| Public URL 530 | Tunnel edge not connected (proxy node must not be a Cloudflare-IP node) |
| Confirm egress path | `curl -x <proxy> https://api.ipify.org` and compare with backend logs |

## 6. Security checklist

- [x] Backend publishes no ports; only reachable on the compose network
- [x] `.env` (cookies, secrets) git-ignored; `data/` (DB, cookie cache, debug dumps) git-ignored
- [x] JWT middleware on all routes except register/login/health/image-proxy allowlist
- [x] Per-user conversation isolation; bcrypt(12) password hashing
- [x] Rate limiting (default 30 req/min)
- [x] Image proxy: host allowlist + per-redirect validation + 25MB download cap
- [ ] Recommended: named tunnel + Cloudflare Access email OTP
- [ ] Recommended: keep the public URL private (URL + account = your quota)
