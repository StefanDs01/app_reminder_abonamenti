#!/usr/bin/env python3
"""
ScadenzApp — Server Web + API Multi-Utente (Zero Dipendenze) per VPS Linux / Windows
Serve i file statici della PWA e gestisce il salvataggio separato per ogni utente
(es. il tuo profilo e quello della tua amica in Romania) protetto da PIN (hash SHA-256).

Avvio rapido su VPS:
    python3 server.py --port 8080
"""

import argparse
import hashlib
import json
import mimetypes
import os
import re
from datetime import datetime, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "users"
DATA_DIR.mkdir(parents=True, exist_ok=True)

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/vnd.android.package-archive", ".apk")


def sanitize_username(username: str) -> str:
    clean = re.sub(r"[^a-z0-9_-]", "", (username or "").strip().lower())
    return clean[:40]


def hash_pin(username: str, pin: str) -> str:
    salted = f"scadenzapp_v2::{username}::{pin}".encode("utf-8")
    return hashlib.sha256(salted).hexdigest()


class ScadenzAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _send_json(self, status_code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 5 * 1024 * 1024:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def do_GET(self):
        if self.path == "/api/health":
            return self._send_json(200, {
                "ok": True,
                "service": "ScadenzApp VPS Server",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        # Non permettere mai l'accesso diretto via HTTP alla cartella /data/
        if self.path.startswith("/data/") or self.path == "/data":
            return self._send_json(403, {"ok": False, "error": "Accesso negato"})

        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/sync/pull":
            return self._handle_pull()
        if self.path == "/api/sync/push":
            return self._handle_push()
        return self._send_json(404, {"ok": False, "error": "Endpoint non trovato"})

    def _handle_pull(self):
        try:
            body = self._read_json_body()
            username = sanitize_username(body.get("username", ""))
            pin = str(body.get("pin", "")).strip()

            if not username or not pin:
                return self._send_json(400, {"ok": False, "error": "Username e PIN obbligatori"})

            user_file = DATA_DIR / f"{username}.json"
            if not user_file.exists():
                return self._send_json(200, {
                    "ok": True,
                    "isNewUser": True,
                    "username": username,
                    "items": [],
                    "history": []
                })

            stored = json.loads(user_file.read_text(encoding="utf-8"))
            expected_hash = stored.get("pinHash", "")
            if expected_hash != hash_pin(username, pin):
                return self._send_json(401, {"ok": False, "error": "PIN errato per questo profilo!"})

            return self._send_json(200, {
                "ok": True,
                "isNewUser": False,
                "username": username,
                "lang": stored.get("lang", "it"),
                "mainCurrency": stored.get("mainCurrency", "EUR"),
                "items": stored.get("items", []),
                "history": stored.get("history", []),
                "updatedAt": stored.get("updatedAt")
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_push(self):
        try:
            body = self._read_json_body()
            username = sanitize_username(body.get("username", ""))
            pin = str(body.get("pin", "")).strip()

            if not username or not pin:
                return self._send_json(400, {"ok": False, "error": "Username e PIN obbligatori"})

            user_file = DATA_DIR / f"{username}.json"
            incoming_hash = hash_pin(username, pin)

            if user_file.exists():
                existing = json.loads(user_file.read_text(encoding="utf-8"))
                if existing.get("pinHash") and existing.get("pinHash") != incoming_hash:
                    return self._send_json(401, {"ok": False, "error": "PIN errato per questo profilo!"})

            record = {
                "username": username,
                "pinHash": incoming_hash,
                "lang": body.get("lang", "it"),
                "mainCurrency": body.get("mainCurrency", "EUR"),
                "items": body.get("items", []),
                "history": body.get("history", []),
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }

            user_file.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
            return self._send_json(200, {
                "ok": True,
                "username": username,
                "updatedAt": record["updatedAt"]
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description="ScadenzApp VPS Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host di ascolto (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")), help="Porta HTTP (default: 8080)")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), ScadenzAppHandler)
    print("==========================================================")
    print(f"🚀 ScadenzApp Server VPS attivo su http://{args.host}:{args.port}")
    print(f"📂 Cartella profili utenti: {DATA_DIR}")
    print("==========================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArresto del server...")
        server.server_close()


if __name__ == "__main__":
    main()
