#!/usr/bin/env python3
"""Persistent localhost server for the Memory Manager GUI.

Serves the static GUI and ``inventory.json`` and brokers a *session* between the
browser and Claude Code in the terminal. The browser never writes files — this
server only translates HTTP to file drops and relays Claude's progress back.

Session flow (the server stays up across many submit/apply cycles):
  POST /decisions  browser submits the staged cart -> writes <run>/decisions.json
                   atomically and sets status ``submitted``. (No shutdown.)
  GET  /status     browser polls this; returns the current phase + message that
                   the skill writes to <run>/status.json as it works
                   (processing / awaiting_terminal / done), plus the apply
                   result once a cycle finishes.
  GET  /result     raw <run>/result.json (per-file written/skipped + backup).
  POST /close      browser's "Fertig" -> drops <run>/close.signal and stops the
                   server (the skill's loop sees the sentinel and exits too).

The skill updates status.json via ``serve.py --set-status PHASE [--message ...]``
(write-and-exit, no binding). An idle watchdog closes the session after
``--idle-timeout`` seconds of no requests (0 = never).

Binds 127.0.0.1 only. Stdlib only, Python 3.9 compatible.
"""

import argparse
import atexit
import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}

# The phases the status strip understands. The skill writes the middle three;
# the server writes the bookends.
_PHASES = {"curating", "submitted", "processing", "awaiting_terminal", "done", "closing"}


def _atomic_write(path, text):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(str(tmp), str(path))


def write_status(run_dir, phase, message=""):
    """Single source of truth for the browser's status strip. Atomic so the
    server thread and the skill (separate process) can both write it safely."""
    payload = {"phase": phase, "message": message}
    _atomic_write(Path(run_dir) / "status.json", json.dumps(payload, ensure_ascii=False))


def read_status(run_dir):
    f = Path(run_dir) / "status.json"
    if f.is_file():
        try:
            d = json.loads(f.read_text("utf-8"))
            if isinstance(d, dict) and d.get("phase") in _PHASES:
                return d
        except (ValueError, OSError):
            pass
    return {"phase": "curating", "message": ""}


class Handler(BaseHTTPRequestHandler):
    # injected by make_server
    run_dir = None
    gui_dir = None
    httpd = None
    _activity_lock = threading.Lock()
    last_activity = 0.0  # time.monotonic() of the most recent request

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] " + (fmt % args) + "\n")

    def _touch_activity(self):
        with Handler._activity_lock:
            Handler.last_activity = time.monotonic()

    def _send(self, code, body, ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    # -- GET ---------------------------------------------------------------
    def do_GET(self):
        self._touch_activity()
        path = self.path.split("?", 1)[0]
        if path == "/inventory.json":
            inv = self.run_dir / "inventory.json"
            if inv.is_file():
                self._send(200, inv.read_bytes(), "application/json; charset=utf-8")
            else:
                self._send(404, "no inventory.json")
            return
        if path == "/status":
            self._send_json(200, self._status_payload())
            return
        if path == "/result":
            res = self.run_dir / "result.json"
            if res.is_file():
                self._send(200, res.read_bytes(), "application/json; charset=utf-8")
            else:
                self._send_json(404, {"error": "no result yet"})
            return
        self._serve_static(path)

    def _status_payload(self):
        st = read_status(self.run_dir)
        out = {"phase": st.get("phase", "curating"),
               "message": st.get("message", ""),
               "server": "closing" if (self.run_dir / "close.signal").is_file() else "running",
               "result": None}
        # surface the apply result only once a cycle has finished, so a stale
        # result.json from the previous cycle can't show during a new submit
        if out["phase"] == "done":
            res = self.run_dir / "result.json"
            if res.is_file():
                try:
                    out["result"] = json.loads(res.read_text("utf-8"))
                except (ValueError, OSError):
                    pass
        return out

    def _serve_static(self, path):
        rel = path.lstrip("/") or "index.html"
        target = (self.gui_dir / rel).resolve()
        root = self.gui_dir.resolve()
        # path-traversal guard
        if root != target and root not in target.parents:
            self._send(403, "forbidden")
            return
        if target.is_dir():
            target = target / "index.html"
        if target.is_file():
            ctype = _CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream")
            self._send(200, target.read_bytes(), ctype)
            return
        # SPA fallback: unknown non-asset route → index.html
        index = self.gui_dir / "index.html"
        if "." not in Path(rel).name and index.is_file():
            self._send(200, index.read_bytes(), "text/html; charset=utf-8")
            return
        self._send(404, "not found")

    # -- POST --------------------------------------------------------------
    def do_POST(self):
        self._touch_activity()
        path = self.path.split("?", 1)[0]
        if path == "/decisions":
            return self._post_decisions()
        if path == "/close":
            return self._post_close()
        self._send(404, "not found")

    def _post_decisions(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            self._send(400, "invalid JSON: " + str(exc))
            return
        if not isinstance(data, dict) or "operations" not in data:
            self._send(400, "expected {operations: [...]}")
            return

        out = self.run_dir / "decisions.json"
        tmp = self.run_dir / "decisions.json.tmp"
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(str(tmp), str(out))
        n = len(data.get("operations", []))
        # flip the strip to "submitted" immediately so the browser shows progress
        # even before the skill reacts; phase gating also hides any stale result
        write_status(self.run_dir, "submitted",
                     "Freigabe empfangen — Claude übernimmt im Terminal …")
        self._send_json(200, {"ok": True, "operations": n})
        sys.stderr.write("[serve] received {} operations -> {}\n".format(n, out))
        # NOTE: no shutdown — the session stays open for the next cycle.

    def _post_close(self):
        # the skill's loop watches for this sentinel and exits cleanly
        (self.run_dir / "close.signal").write_text("1", encoding="utf-8")
        write_status(self.run_dir, "closing", "Sitzung beendet — Server wird gestoppt.")
        self._send_json(200, {"ok": True, "closing": True})
        sys.stderr.write("[serve] close requested -> shutting down\n")
        threading.Timer(1.0, self.httpd.shutdown).start()


def _idle_watchdog(httpd, run_dir, timeout):
    """Close the session after `timeout` seconds with no requests (0 = never)."""
    if not timeout or timeout <= 0:
        return
    while True:
        time.sleep(min(5.0, timeout))
        with Handler._activity_lock:
            idle = time.monotonic() - Handler.last_activity
        if (run_dir / "close.signal").is_file():
            return
        if idle >= timeout:
            sys.stderr.write("[serve] idle {:.0f}s >= {}s — closing session\n".format(idle, timeout))
            try:
                (run_dir / "close.signal").write_text("1", encoding="utf-8")
                write_status(run_dir, "closing", "Sitzung wegen Inaktivität beendet.")
            except OSError:
                pass
            httpd.shutdown()
            return


def make_server(run_dir, gui_dir, port):
    Handler.run_dir = Path(run_dir)
    Handler.gui_dir = Path(gui_dir)
    Handler.last_activity = time.monotonic()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    Handler.httpd = httpd
    return httpd


def main(argv=None):
    parser = argparse.ArgumentParser(description="Memory Manager localhost server.")
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--gui-dir", default=None)
    parser.add_argument("--port", type=int, default=0, help="0 = OS-assigned free port")
    parser.add_argument("--pidfile", default=None)
    parser.add_argument("--idle-timeout", type=int, default=1800,
                        help="close session after N idle seconds (0 = never)")
    parser.add_argument("--set-status", default=None,
                        help="write status.json with this phase and exit (no server)")
    parser.add_argument("--message", default="", help="message for --set-status")
    args = parser.parse_args(argv)

    run_dir = Path(args.run_dir)

    # write-and-exit mode used by the skill to drive the browser's status strip
    if args.set_status:
        if args.set_status not in _PHASES:
            sys.stderr.write("unknown phase: {} (known: {})\n".format(
                args.set_status, ", ".join(sorted(_PHASES))))
            return 2
        run_dir.mkdir(parents=True, exist_ok=True)
        write_status(run_dir, args.set_status, args.message)
        return 0

    if not args.gui_dir:
        sys.stderr.write("--gui-dir is required to serve\n")
        return 2

    try:
        httpd = make_server(args.run_dir, args.gui_dir, args.port)
    except OSError as exc:
        sys.stderr.write("bind failed: {}\n".format(exc))
        return 1

    host, port = httpd.server_address[0], httpd.server_address[1]
    url = "http://{}:{}/".format(host, port)

    # fresh session starts in the curating phase; clear any stale signals
    run_dir.mkdir(parents=True, exist_ok=True)
    try:
        (run_dir / "close.signal").unlink()
    except OSError:
        pass
    write_status(run_dir, "curating", "")

    pidfile = Path(args.pidfile) if args.pidfile else None
    if pidfile:
        pidfile.write_text(str(os.getpid()), encoding="utf-8")

        def _cleanup():
            try:
                pidfile.unlink()
            except OSError:
                pass
        atexit.register(_cleanup)
        signal.signal(signal.SIGTERM, lambda *_: (_cleanup(), os._exit(0)))

    watchdog = threading.Thread(
        target=_idle_watchdog, args=(httpd, run_dir, args.idle_timeout), daemon=True)
    watchdog.start()

    # The URL line is what the skill greps from server.log.
    print("URL " + url, flush=True)
    sys.stderr.write("[serve] listening on {} (gui={}, run={}, idle={}s)\n".format(
        url, args.gui_dir, args.run_dir, args.idle_timeout))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    sys.stderr.write("[serve] stopped\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
