#!/usr/bin/env python3
"""Cookie 与模型令牌自动同步接收服务（仅监听 127.0.0.1）。

两个入口（均需 X-Token 校验）：
  POST /cookies        浏览器扩展推送的登录 Cookie → 更新 .env → 重启后端
  POST /models-config  页面捕获的模型配置片段 → 提取 标签→令牌 → 更新 GEMINI_MODEL_ALIASES → 重启后端

由 LaunchAgent (com.geminigateway.cookie-sync) 常驻运行。
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile
from typing import Optional
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


def write_env(new_text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(ENV_FILE.parent))
    with os.fdopen(fd, "w") as f:
        f.write(new_text)
    os.replace(tmp, ENV_FILE)
    os.chmod(ENV_FILE, 0o600)


_last_restart = 0.0


def backend_cache_path(psid: str) -> Path:
    """后端读取的会话缓存文件：.cookies/<sha256(1PSID)>.txt，内容为 1PSIDTS。"""
    h = hashlib.sha256(psid.encode()).hexdigest()
    return ROOT / "data" / "cookies" / f"{h}.txt"


def write_backend_cookie_cache(psid: str, psidts: str) -> bool:
    """把浏览器最新 PSIDTS 直写进后端缓存；返回是否变化。"""
    path = backend_cache_path(psid)
    old = path.read_text().strip() if path.exists() else ""
    if old == psidts:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(psidts)
    return True


def restart_backend() -> None:
    # 注意：docker restart 不会重新读取 .env（环境变量在容器创建时固化），
    # 必须用 compose force-recreate 才能让新配置生效
    global _last_restart
    if time.time() - _last_restart < 15:
        log("距上次重建不足 15 秒，跳过（下一次推送会再触发）")
        return
    _last_restart = time.time()
    last_err = ""
    for attempt in range(1, 4):
        try:
            r = subprocess.run(["/usr/local/bin/docker", "compose", "-f", str(ROOT / "docker-compose.yml"),
                                "up", "-d", "--force-recreate", BACKEND_CONTAINER],
                               capture_output=True, text=True, timeout=120, cwd=str(ROOT))
            if r.returncode == 0:
                log("后端容器已重建（新配置生效）")
                return
            last_err = f"exit {r.returncode}: {(r.stderr or r.stdout)[-300:]}"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        log(f"重建第 {attempt}/3 次失败: {last_err}")
        time.sleep(5)
    log(f"重建三次均失败: {last_err}")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "cookie-sync"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path == "/cookies":
            return self.handle_cookies()
        if self.path == "/models-config":
            return self.handle_models_config()
        self._json(404, {"error": "not found"})

    def _authed_body(self) -> Optional[dict]:
        if not TOKEN or self.headers.get("X-Token", "") != TOKEN:
            self._json(403, {"error": "forbidden"})
            return None
        try:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length))
        except Exception as e:  # noqa: BLE001
            self._json(400, {"error": f"bad request: {e}"})
            return None

    def handle_cookies(self):
        """新协议：1PSID 写入 .env（长效）；1PSIDTS 直写后端缓存文件（短命，由后端轮换接管）。"""
        data = self._authed_body()
        if data is None:
            return
        cookies = data.get("cookies") or {}
        psid = str(cookies.get("__Secure-1PSID", "")).strip().strip('"').strip("'")
        psidts = str(cookies.get("__Secure-1PSIDTS", "")).strip().strip('"').strip("'")
        if len(psid) < 30 or len(psidts) < 20:
            return self._json(400, {"error": "cookie 格式不符合预期"})

        orig = ENV_FILE.read_text()
        new = set_env_value(orig, "GEMINI_1PSID", psid)
        # PSIDTS 保持为空：由后端自动轮换 + 缓存文件管理，避免过期值覆盖缓存
        new = set_env_value(new, "GEMINI_1PSIDTS", "")
        env_changed = new != orig

        cache_changed = write_backend_cookie_cache(psid, psidts)
        log(f"收到 Cookie 推送: psid={psid[:10]}… env变化={env_changed} 缓存变化={cache_changed}")

        if env_changed or cache_changed:
            restart_backend()
        self._json(200, {"ok": True, "changed": env_changed or cache_changed})

    def handle_models_config(self):
        data = self._authed_body()
        if data is None:
            return
        chunks = [str(c) for c in (data.get("chunks") or [])]
        log(f"收到模型配置片段 {len(chunks)} 段")

        # 原始片段落盘，便于排查解析效果
        dump = ROOT / "data" / "model-config-latest.txt"
        dump.parent.mkdir(parents=True, exist_ok=True)
        with open(dump, "w", encoding="utf-8") as f:
            f.write("\n\n====\n\n".join(chunks))

        mapping = extract_model_aliases(chunks)
        log(f"解析出别名映射: {mapping or '无'}")

        changed = False
        if mapping:
            merged = dict(existing_aliases())
            merged.update(mapping)
            new_val = ",".join(f"{k}={v}" for k, v in sorted(merged.items()))
            orig = ENV_FILE.read_text()
            if f"GEMINI_MODEL_ALIASES={new_val}" not in orig:
                write_env(set_env_value(orig, "GEMINI_MODEL_ALIASES", new_val))
                changed = True
                restart_backend()
        self._json(200, {"ok": True, "aliases": list(mapping), "changed": changed})

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 静默默认访问日志
        pass


def existing_aliases() -> dict:
    """当前 .env 中已配置的别名映射。"""
    out = {}
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("GEMINI_MODEL_ALIASES="):
            for pair in line.split("=", 1)[1].split(","):
                kv = pair.strip().split("=", 1)
                if len(kv) == 2:
                    out[kv[0]] = kv[1]
    return out


def extract_model_aliases(chunks: list) -> dict:
    """从页面配置片段中提取 标签→令牌 对。

    令牌形如 "!" + 60 位以上 base64url；官网选择器条目的显示名形如
    "Gemini 3.1 Pro"。令牌与标签通常出现在同一配置片段内，取令牌附近
    （±500 字符）最近的标签作为其名字。
    """
    mapping = {}
    token_re = re.compile(r'\\?"(![A-Za-z0-9_\-]{60,})\\?"')
    label_re = re.compile(r"Gemini\s+3\.\d+(?:\s+[A-Za-z][A-Za-z\-]*){0,2}")

    for chunk in chunks:
        for m in token_re.finditer(chunk):
            token = m.group(1)
            near = chunk[max(0, m.start() - 500):m.end() + 500]
            labels = label_re.findall(near)
            if not labels:
                continue
            label = labels[-1]  # 取离令牌最近的一个
            slug = re.sub(r"[^a-z0-9.\-]", "", label.lower().replace(" ", "-"))
            if len(slug) >= 8:
                mapping[slug] = token
    return mapping


if __name__ == "__main__":
    log(f"cookie-sync 接收服务启动，监听 127.0.0.1:{LISTEN_PORT}")

    import threading

    def session_refresher():
        import time as _t
        while True:
            _t.sleep(12 * 3600)
            log("定时任务：刷新后端会话（每 12 小时）")
            try:
                restart_backend()
            except Exception as e:  # noqa: BLE001
                log(f"定时刷新失败: {e}")

    threading.Thread(target=session_refresher, daemon=True).start()
    HTTPServer(("127.0.0.1", LISTEN_PORT), Handler).serve_forever()
