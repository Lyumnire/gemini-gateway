#!/usr/bin/env python3
"""通过 Chrome DevTools Protocol (CDP) 自动从 Edge 读取 Gemini cookie 并推送。
不需要浏览器扩展，不依赖 Keychain，完全自动化。"""
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
import websocket
import os

RECEIVER_URL = "http://127.0.0.1:8799/cookies"
TOKEN = os.environ.get("COOKIE_SYNC_TOKEN", "")
CDP_PORT = 9222

def find_edge_debug_port():
    """检查 Edge 是否开启了 CDP 调试端口"""
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=3)
        return json.loads(resp.read())
    except Exception:
        return None

def restart_edge_with_debug():
    """重启 Edge 并开启 CDP"""
    print("[CDP] Restarting Edge with remote debugging...")
    # 优雅关闭 Edge
    subprocess.run(["osascript", "-e", 'tell application "Microsoft Edge" to quit'], timeout=10)
    time.sleep(3)
    # 带调试端口重启
    subprocess.Popen([
        "open", "-a", "Microsoft Edge",
        "--args", f"--remote-debugging-port={CDP_PORT}"
    ])
    time.sleep(8)

def get_gemini_target():
    """找到 gemini.google.com 的 tab"""
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=5)
        targets = json.loads(resp.read())
        for t in targets:
            if "gemini.google.com" in t.get("url", ""):
                return t
        # 如果没有 gemini tab，打开一个
        return None
    except Exception:
        return None

def read_cookies_via_cdp():
    """通过 CDP 读取 Gemini cookies"""
    version = find_edge_debug_port()
    if not version:
        print("[CDP] Edge not running with debug port, restarting...")
        restart_edge_with_debug()
        version = find_edge_debug_port()
        if not version:
            print("[CDP] Failed to start Edge with debug port")
            return None

    # 获取 WebSocket 调试 URL
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=5)
        targets = json.loads(resp.read())
    except Exception as e:
        print(f"[CDP] Failed to list targets: {e}")
        return None

    if not targets:
        print("[CDP] No targets found")
        return None

    # 使用第一个 tab 的 WebSocket
    ws_url = targets[0]["webSocketDebuggerUrl"]
    
    import websocket
    ws = websocket.create_connection(ws_url, timeout=10)
    
    # 发送 Network.getAllCookies 命令
    ws.send(json.dumps({
        "id": 1,
        "method": "Network.getAllCookies"
    }))
    
    result = None
    for _ in range(10):
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            result = msg.get("result", {})
            break
    
    ws.close()
    
    if not result:
        return None
    
    cookies = {}
    for c in result.get("cookies", []):
        if "google.com" in c.get("domain", ""):
            if c["name"] == "__Secure-1PSID":
                cookies["__Secure-1PSID"] = c["value"]
            elif c["name"] == "__Secure-1PSIDTS":
                cookies["__Secure-1PSIDTS"] = c["value"]
    
    if cookies.get("__Secure-1PSID") and cookies.get("__Secure-1PSIDTS"):
        return cookies
    return None

def push_cookies(cookies):
    """推送 cookies 到 receiver"""
    req = urllib.request.Request(
        RECEIVER_URL,
        data=json.dumps({"cookies": cookies, "reason": "cdp-auto"}).encode(),
        headers={"Content-Type": "application/json", "X-Token": TOKEN},
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=10)
    return json.loads(resp.read())

def main():
    cookies = read_cookies_via_cdp()
    if not cookies:
        print("[CDP] Failed to read cookies")
        return False
    
    print(f"[CDP] Got PSID: {cookies['__Secure-1PSID'][:20]}...")
    result = push_cookies(cookies)
    print(f"[CDP] Push result: {result}")
    return result.get("ok", False)

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
