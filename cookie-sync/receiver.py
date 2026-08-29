#!/usr/bin/env python3
"""Cookie 自动同步接收服务（仅监听 127.0.0.1）。

接收浏览器扩展推送的 Gemini 登录 Cookie，校验 Token 后：
  1. 原子更新项目 .env 中的 GEMINI_1PSID / GEMINI_1PSIDTS；
  2. 仅在值变化时重启后端容器（gg-gemini-api）。

由 LaunchAgent (com.geminigateway.cookie-sync) 常驻运行。
"""
import json
import os
import subprocess
import tempfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HOME = Path.home()
ROOT = HOME / "Projects" / "gemini-gateway"
ENV_FILE = ROOT / ".env"
LOG_FILE = HOME / "Library" / "Logs" / "gemini-gateway-cookie-sync.log"
TOKEN = os.environ.get("COOKIE_SYNC_TOKEN", "")
BACKEND_CONTAINER = "gg-gemini-api"
DOCKER = "/usr/local/bin/docker"
LISTEN_PORT = 8799


def log(msg: str) -> None:
    line = f"{datetime.now().isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def set_env_value(text: str, key: str, value: str) -> str:
    lines, found = [], False
    for line in text.splitlines():
        if line.startswith(f"{key}="):
            lines.append(f"{key}={value}")
            found = True
        else:
            lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def update_env(psid: str, psidts: str) -> bool:
    """更新 .env；返回是否发生变化。"""
    orig = ENV_FILE.read_text()
    new = set_env_value(orig, "GEMINI_1PSID", psid)
    new = set_env_value(new, "GEMINI_1PSIDTS", psidts)
    if new == orig:
        return False
    # 原子写入
    fd, tmp = tempfile.mkstemp(dir=str(ENV_FILE.parent))
    with os.fdopen(fd, "w") as f:
        f.write(new)
    os.replace(tmp, ENV_FILE)
    os.chmod(ENV_FILE, 0o600)
    return True


def restart_backend() -> None:
    # 注意：docker restart 不会重新读取 .env（环境变量在容器创建时固化），
    # 必须用 compose force-recreate 才能让新 Cookie 生效
    try:
        subprocess.run(["/usr/local/bin/docker", "compose", "-f", str(ROOT / "docker-compose.yml"),
                        "up", "-d", "--force-recreate", BACKEND_CONTAINER],
                       check=True, timeout=120, capture_output=True, cwd=str(ROOT))
        log("后端容器已重建（新 Cookie 生效）")
    except Exception as e:  # noqa: BLE001
        log(f"重启后端失败: {e}")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "cookie-sync"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/cookies":
            return self._json(404, {"error": "not found"})
        if not TOKEN or self.headers.get("X-Token", "") != TOKEN:
            return self._json(403, {"error": "forbidden"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length))
            cookies = data.get("cookies") or {}
            psid = str(cookies.get("__Secure-1PSID", "")).strip()
            psidts = str(cookies.get("__Secure-1PSIDTS", "")).strip()
        except Exception as e:  # noqa: BLE001
            return self._json(400, {"error": f"bad request: {e}"})

        if len(psid) < 30 or len(psidts) < 20:
            return self._json(400, {"error": "cookie 格式不符合预期"})

        changed = update_env(psid, psidts)
        log(f"收到推送: psid={psid[:10]}… psidts={psidts[:10]}… 变化={changed}")
        if changed:
            restart_backend()
        self._json(200, {"ok": True, "changed": changed})

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 静默默认访问日志
        pass


if __name__ == "__main__":
    log(f"cookie-sync 接收服务启动，监听 127.0.0.1:{LISTEN_PORT}")
    HTTPServer(("127.0.0.1", LISTEN_PORT), Handler).serve_forever()
