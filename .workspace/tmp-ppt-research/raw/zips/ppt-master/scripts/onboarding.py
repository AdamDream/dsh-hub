#!/usr/bin/env python3
"""Local onboarding page for PPT大师. Python 3.10+ standard library only."""
import argparse
from datetime import datetime, timezone
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

from billing_client import (
    ClientError,
    account_urls,
    api_key_status,
    base_url,
    credential_dir,
    preference_file,
    request,
    save_api_key,
    validate_api_key,
)


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
HTML_FILE = SKILL_ROOT / "assets" / "onboarding.html"
SHOWCASE_FILE = SKILL_ROOT / "assets" / "ppt-master-showcase.svg"
MAX_SERVER_SECONDS = 30 * 60


def state_file():
    return credential_dir() / "onboarding.json"


def log_file():
    return credential_dir() / "onboarding.log"


def write_private_json(path, payload):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    os.replace(temporary, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def read_state():
    try:
        return json.loads(state_file().read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeError, ValueError, json.JSONDecodeError):
        return None


def mark_welcome_seen():
    path = preference_file()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            payload = {}
    except (FileNotFoundError, OSError, UnicodeError, ValueError, json.JSONDecodeError):
        payload = {}
    if payload.get("welcome_seen") is True:
        return
    payload["welcome_seen"] = True
    payload["welcome_seen_at"] = datetime.now(timezone.utc).isoformat()
    write_private_json(path, payload)


def server_is_ready(state):
    url = str((state or {}).get("url", "")).rstrip("/")
    if not url.startswith("http://127.0.0.1:"):
        return False
    try:
        with urllib.request.urlopen(url + "/health", timeout=0.5) as response:
            return response.status == 200
    except Exception:
        return False


def start_server(open_page=False):
    existing = read_state()
    if server_is_ready(existing):
        result = {"url": existing["url"], "status": "already_running", **api_key_status()}
        if open_page:
            webbrowser.open(existing["url"])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    credential_dir().mkdir(mode=0o700, parents=True, exist_ok=True)
    log_handle = log_file().open("a", encoding="utf-8")
    kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": log_handle,
        "stderr": log_handle,
        "cwd": str(SKILL_ROOT),
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve"], **kwargs)
    log_handle.close()

    deadline = time.monotonic() + 6
    current = None
    while time.monotonic() < deadline:
        current = read_state()
        if current and current.get("pid") == process.pid and server_is_ready(current):
            break
        if process.poll() is not None:
            raise ClientError("PPT大师连接向导未能启动，请查看本机 onboarding.log。")
        time.sleep(0.1)
    else:
        process.terminate()
        raise ClientError("PPT大师连接向导启动超时，请稍后重试。")

    if open_page:
        webbrowser.open(current["url"])
    print(json.dumps({"url": current["url"], "status": "started", **api_key_status()}, ensure_ascii=False, indent=2))
    return 0


def safe_balance_label(payload):
    for key in ("available_balance", "available", "balance", "credits", "points"):
        value = payload.get(key) if isinstance(payload, dict) else None
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f"，当前可用点数：{value:g}"
    return ""


def handler_factory(csrf_token, register_url, keys_url, server_ref):
    page_source = HTML_FILE.read_text(encoding="utf-8")
    rendered_page = (page_source
        .replace("__PPT_MASTER_REGISTER_URL__", html.escape(register_url, quote=True))
        .replace("__PPT_MASTER_KEYS_URL__", html.escape(keys_url, quote=True))
        .replace("__PPT_MASTER_CSRF_TOKEN__", csrf_token))

    class OnboardingHandler(BaseHTTPRequestHandler):
        server_version = "PPTMasterOnboarding/1.0"

        def log_message(self, _format, *_args):
            return

        def security_headers(self, content_type):
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")

        def send_bytes(self, status, payload, content_type):
            self.send_response(status)
            self.security_headers(content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def send_json(self, status, payload):
            self.send_bytes(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def valid_local_request(self):
            host = self.headers.get("Host", "")
            if not (host.startswith("127.0.0.1:") or host.startswith("localhost:")):
                return False
            origin = self.headers.get("Origin", "")
            if not origin:
                return True
            parsed = urllib.parse.urlparse(origin)
            return parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}

        def do_GET(self):
            if not self.valid_local_request():
                self.send_json(403, {"error": "仅允许本机访问。"})
                return
            path = urllib.parse.urlparse(self.path).path
            if path in {"/", "/index.html"}:
                mark_welcome_seen()
                self.send_bytes(200, rendered_page.encode("utf-8"), "text/html; charset=utf-8")
            elif path == "/showcase.svg":
                self.send_bytes(200, SHOWCASE_FILE.read_bytes(), "image/svg+xml; charset=utf-8")
            elif path == "/health":
                self.send_json(200, {"ok": True})
            elif path == "/api/status":
                self.send_json(200, api_key_status())
            else:
                self.send_json(404, {"error": "页面不存在。"})

        def do_POST(self):
            if not self.valid_local_request():
                self.send_json(403, {"error": "仅允许本机访问。"})
                return
            if urllib.parse.urlparse(self.path).path != "/api/connect":
                self.send_json(404, {"error": "接口不存在。"})
                return
            if self.headers.get("X-PPT-Master-Token", "") != csrf_token:
                self.send_json(403, {"error": "页面已失效，请刷新后重试。"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                size = 0
            if not 1 <= size <= 4096:
                self.send_json(400, {"error": "请求内容不正确。"})
                return
            try:
                payload = json.loads(self.rfile.read(size).decode("utf-8"))
                api_key = validate_api_key(payload.get("api_key", ""))
                account = request(base_url(), "/api/me", api_key=api_key)
                save_api_key(api_key)
                self.send_json(200, {"ok": True, "message": "连接成功，可以回到对话开始制作 PPT" + safe_balance_label(account) + "。"})
                threading.Timer(5, server_ref[0].shutdown).start()
            except ClientError as exc:
                self.send_json(400, {"error": str(exc)})
            except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
                self.send_json(400, {"error": "连接失败，请检查密钥后重试。"})

    return OnboardingHandler


def serve():
    csrf_token = secrets.token_urlsafe(32)
    keys_url, register_url = account_urls(base_url())
    server_ref = [None]
    placeholder_handler = handler_factory(csrf_token, register_url, keys_url, server_ref)
    server = ThreadingHTTPServer(("127.0.0.1", 0), placeholder_handler)
    server_ref[0] = server
    server.timeout = 1
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    state = {
        "pid": os.getpid(),
        "url": url,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    write_private_json(state_file(), state)
    timer = threading.Timer(MAX_SERVER_SECONDS, server.shutdown)
    timer.daemon = True
    timer.start()
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        timer.cancel()
        server.server_close()
        current = read_state()
        if current and current.get("pid") == os.getpid():
            try:
                state_file().unlink()
            except OSError:
                pass
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="PPT大师本机账号连接向导")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--start", action="store_true", help="后台启动本机连接向导")
    mode.add_argument("--serve", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--open", action="store_true", help="同时在默认浏览器打开")
    args = parser.parse_args(argv)
    try:
        return serve() if args.serve else start_server(open_page=args.open)
    except (ClientError, OSError, UnicodeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
