<div align="center">

# Gemini Web Gateway

**An OpenAI-compatible API and multi-user web UI on top of gemini.google.com**

English | [简体中文](README.md)

</div>

---

> ⚠️ **Project nature**: This project talks to the **Gemini web interface**
> (gemini.google.com) using your logged-in browser session (cookies) for auth.
> It is **NOT** the official Google Gemini API and is not affiliated with Google.
> Capabilities, quota and availability depend entirely on your Google account,
> region and Google's server-side policies, and may change or break at any time.
> For personal study and research only; respect Google's Terms of Service.

---

## Features

- **OpenAI-compatible API**: `/openai/v1/chat/completions` (streaming), `/openai/v1/images/generations`, `/openai/v1/models`
- **Web chat UI**: React + Vite, responsive desktop/mobile, PWA
- **Multi-user**: JWT auth + SQLite + invite-code registration, bcrypt(12) hashing
- **True multi-turn conversations**: continues the **same conversation** on gemini.google.com via session IDs (CID/RID/RCID) instead of replaying concatenated history
- **Image generation**: shares the same conversation; SSE keepalive prevents reverse-proxy timeouts on long generations
- **File upload**: multimodal input (images, PDF, …) via Gemini's resumable upload protocol
- **Cookie keepalive**: background session refresh + optional browser extension auto-sync
- **Proxy support**: all upstream traffic forced through `HTTPS_PROXY` (Clash etc.)

## Architecture

```
Browser / any OpenAI client
        │  HTTPS
        ▼
┌──────────────────────────────┐
│  Caddy (static UI + reverse  │
│         proxy)               │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│  Go Gateway (this backend)   │
│  · JWT multi-user auth       │
│  · OpenAI-compatible API     │
│  · SQLite conversation store │
└──────────┬───────────────────┘
           │  HTTPS_PROXY (optional, e.g. Clash)
           ▼
   gemini.google.com (web protocol)
```

Optional public access via Cloudflare Tunnel (outbound, no open ports).
Note: the **tunnel is your inbound path**, while **HTTPS_PROXY is the outbound
path** — they are independent and do not replace each other.

## Repository layout

```
gemini-gateway/
├── backend/src/          # Go backend (based on ntthanh2603/gemini-web-to-api)
│   └── SOURCE-VERSION    # upstream baseline commit
├── frontend/             # React + TypeScript + Vite UI
├── caddy/                # Caddyfile (static + reverse proxy)
├── cookie-sync/          # Cookie auto-sync: browser extension + local receiver
├── scripts/              # build / deploy / self-check scripts
├── docs/                 # design docs & deployment guide
├── docker-compose.yml
└── .env.example          # config template (copy to .env)
```

## Requirements

| Requirement | Notes |
|---|---|
| Docker + Compose | Recommended |
| Network path to Gemini | Direct, or a local proxy (Clash etc., default mixed port 7890) |
| Google account | With working gemini.google.com web access |
| Node.js ≥ 18, Go ≥ 1.24 | Only for building from source |

## Quick start (Docker Compose)

```bash
git clone <your-repo-url> gemini-gateway
cd gemini-gateway
cp .env.example .env
# Edit .env: set GEMINI_1PSID / GEMINI_1PSIDTS (see below)
docker compose build
docker compose up -d
# Open http://localhost:8080, register with your invite code
```

## Gemini web authentication

This project uses your **logged-in browser session** — there is no official API key involved:

1. Log in to <https://gemini.google.com> in your browser
2. DevTools (`F12`) → Application → Cookies → `https://gemini.google.com`
3. Copy the values of `__Secure-1PSID` and `__Secure-1PSIDTS` into `.env`
4. `docker compose up -d gemini-api`

**Auto-sync (recommended)**: run `./scripts/install-cookie-sync.sh` and load the
generated `cookie-sync/extension-dist` into Chrome/Edge (developer mode). Cookies
are pushed to the gateway automatically whenever you visit gemini.google.com.

> 🔐 **Security warning**: session cookies are equivalent to your Google login
> credentials. Never commit or share them. If compromised, sign out of all
> sessions from your Google Account security page.

## Proxy configuration

All upstream requests are forced through `GATEWAY_PROXY_URL`:

```env
# Generic (Docker Desktop / Linux host)
GATEWAY_PROXY_URL=http://host.docker.internal:7890
# OrbStack (macOS)
GATEWAY_PROXY_URL=http://host.orb.internal:7890
```

## Manual deployment (macOS / Linux)

```bash
# Backend
cd backend/src
go build -o gateway ./cmd/server/main.go
PORT=4981 GEMINI_1PSID=xxx GEMINI_1PSIDTS=yyy ./gateway

# Frontend
cd frontend
npm install
npm run build   # serve dist/ with any static server or Caddy
```

Docker Compose remains the recommended production path.

## Cloudflare Tunnel (optional)

```bash
# Quick tunnel (ephemeral URL)
docker compose --profile tunnel up cloudflared

# Named tunnel: create in Cloudflare Zero Trust → Tunnels, then set in .env
# TUNNEL_TOKEN=<YOUR_TUNNEL_TOKEN>
docker compose -f docker-compose.yml -f docker-compose.named-tunnel.yml up -d cloudflared
```

Point the tunnel's Public Hostname to `http://caddy:80`.

## API compatibility

**Partially** OpenAI-compatible (not 100%). Implemented endpoints:

| Endpoint | Notes |
|---|---|
| `POST /openai/v1/chat/completions` | Chat, `stream: true` (SSE), vision input |
| `POST /openai/v1/images/generations` | Image generation, `response_format: b64_json` |
| `GET /openai/v1/models` | Model list (refreshed from the web session) |

Non-standard extension: `conversation_id` / `response_id` / `choice_id` fields
carry the Gemini session across requests. The bundled frontend handles this
automatically; direct API callers should echo them back for multi-turn context.

```bash
curl http://localhost:8080/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{"model": "gemini-2.5-flash", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Conversation continuation

The gateway extracts a session triple from every Gemini response and returns it:

```
Round 1  request (no metadata)      → new conversation, returns C1/R1/RC1
Round 2  request (with C1/R1/RC1)   → same conversation continues, C1/R2/RC2
Round 3  request (with C1/R2/RC2)   → same conversation continues, C1/R3/RC3
```

The CID never changes (exactly one conversation on gemini.google.com), RID/RCID
rotate every round, and with metadata present only the latest user message is
sent — no "User:/Model:" history concatenation in the upstream message bubble.

## User system

- Registration requires the invite code (`GATEWAY_INVITE_CODE` — **required for public deployments**)
- bcrypt(12) password hashing; JWT valid 30 days by default
- Strict per-user conversation isolation (server-side `user_id` filtering)
- Dual-write storage: SQLite + browser localStorage cache

## Configuration

| Variable | Required | Description |
|---|---|---|
| `GEMINI_1PSID` / `GEMINI_1PSIDTS` | ✅ | Gemini web session cookies |
| `GATEWAY_JWT_SECRET` | Recommended | JWT secret; random one generated & persisted if empty |
| `GATEWAY_INVITE_CODE` | Public deploys | Registration invite code |
| `GATEWAY_PROXY_URL` | Depends | Outbound proxy, e.g. `http://host.docker.internal:7890` |
| `GEMINI_GOOGLE_COOKIES` | Optional | Full Google cookies (image CDN downloads) |
| `GEMINI_MODEL_ALIASES` | Optional | Web UI model alias → dynamic token map |
| `GEMINI_DEBUG` | — | `true` dumps image request/response to disk (contains chat text) |
| `TUNNEL_TOKEN` | Optional | Cloudflare named tunnel |
| `RATE_LIMIT_MAX_REQUESTS` | — | Requests per minute (default 30) |
| `GATEWAY_DB_PATH` | — | SQLite path (default `/data/gateway.db`) |

Full list in [.env.example](.env.example).

## Security

This project authenticates to Gemini with a **live browser session**. Treat the
following as highly sensitive credentials:

- Google/Gemini cookies and session tokens
- `GATEWAY_JWT_SECRET` / `TUNNEL_TOKEN` / `COOKIE_SYNC_TOKEN`
- The `data/` directory (user database, cookie cache, debug dumps)
- User passwords, chat history, uploaded files

Built-in protections: JWT middleware, per-user data isolation, bcrypt hashing,
rate limiting, image-proxy host allowlist with per-redirect validation and
download size caps, 50MB upload limit, cookies always `[REDACTED]` in logs.
CORS is `*` but **disallows credentials** (JWT travels in the Authorization header).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Container exits / empty model list | Invalid or missing cookies — check `docker compose logs gemini-api` |
| 502 / upstream connect errors | `GATEWAY_PROXY_URL` unreachable — verify proxy port |
| "Session error" in replies | Session token expired — restart backend or re-sync cookies |
| Image generation fails | Account/region/rate limits — try the same prompt on gemini.google.com |
| File upload fails | Check size (≤50MB) and cookie validity |
| Context lost between turns | Caller must echo back `conversation_id` / `response_id` / `choice_id` |

See [docs/deploy-guide.md](docs/deploy-guide.md) (Chinese) for the full ops manual.

## Limitations

- Depends on Gemini's private web protocol; Google changes can break it
- Models, image quota and rate limits are account/region dependent — **no guarantee of unlimited usage**
- Audio endpoints (TTS) are not fully wired up
- Long-running requests depend on reverse proxy timeouts (image generation already uses SSE keepalive)

## Development

```bash
cd backend/src && go build ./...     # backend
cd frontend && npm install && npm run dev   # frontend dev server
./scripts/build-backend.sh           # arm64 backend image
```

Based on [ntthanh2603/gemini-web-to-api](https://github.com/ntthanh2603/gemini-web-to-api)
(MIT License); baseline commit pinned in `backend/SOURCE-VERSION`. Many thanks
to the original author.

## Contributing

Issues and PRs welcome. Please ensure no cookies, tokens, real hostnames or user
data are included in your contribution.

## License

[MIT](LICENSE). Upstream `backend/src` keeps its own [MIT license](backend/src/LICENSE) (Copyright (c) 2025 Nguyễn Tuấn Thành).

> ⚠️ Not affiliated with Google. "Gemini" is a trademark of Google LLC, used here descriptively.
