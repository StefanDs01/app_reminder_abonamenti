#!/usr/bin/env python3
"""
ScadenzApp — Server Web + Autenticazione Utenti (Login/Registrazione) per VPS
Ogni utente accede con il proprio Username e Password scelti in fase di registrazione
e vede esclusivamente i propri abbonamenti e scadenze reali.
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
    clean = re.sub(r"[^a-z0-9_.-]", "", (username or "").strip().lower())
    return clean[:40]


def hash_password(username: str, password: str) -> str:
    salted = f"scadenzapp_v2::{username}::{password}".encode("utf-8")
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
                "service": "ScadenzApp VPS Auth Server",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        if self.path.startswith("/data/") or self.path == "/data":
            return self._send_json(403, {"ok": False, "error": "Accesso negato"})

        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/auth/register":
            return self._handle_register()
        if self.path == "/api/auth/login":
            return self._handle_login()
        if self.path == "/api/sync/pull":
            return self._handle_pull()
        if self.path == "/api/sync/push":
            return self._handle_push()
        return self._send_json(404, {"ok": False, "error": "Endpoint non trovato"})

    def _handle_register(self):
        try:
            body = self._read_json_body()
            raw_username = (body.get("username") or "").strip()
            username = sanitize_username(raw_username)
            password = str(body.get("password") or body.get("pin") or "").strip()
            lang = body.get("lang", "it")
            main_currency = body.get("mainCurrency", "EUR")

            if len(username) < 2:
                return self._send_json(400, {"ok": False, "error": "Lo username deve avere almeno 2 caratteri."})
            if len(password) < 3:
                return self._send_json(400, {"ok": False, "error": "La password deve avere almeno 3 caratteri."})

            user_file = DATA_DIR / f"{username}.json"
            if user_file.exists():
                return self._send_json(409, {
                    "ok": False,
                    "error": "Questo username esiste già! Vai su 'Accedi' per entrare con la tua password."
                })

            record = {
                "username": username,
                "displayName": raw_username,
                "pinHash": hash_password(username, password),
                "lang": lang,
                "mainCurrency": main_currency,
                "items": [],
                "history": [],
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }
            user_file.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")

            return self._send_json(200, {
                "ok": True,
                "username": username,
                "displayName": raw_username,
                "lang": lang,
                "mainCurrency": main_currency,
                "items": [],
                "history": []
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_login(self):
        try:
            body = self._read_json_body()
            username = sanitize_username(body.get("username", ""))
            password = str(body.get("password") or body.get("pin") or "").strip()

            if not username or not password:
                return self._send_json(400, {"ok": False, "error": "Inserisci username e password."})

            user_file = DATA_DIR / f"{username}.json"
            if not user_file.exists():
                return self._send_json(404, {
                    "ok": False,
                    "error": "Utente non trovato. Se è la prima volta che entri, clicca su 'Crea Account'!"
                })

            stored = json.loads(user_file.read_text(encoding="utf-8"))
            expected_hash = stored.get("pinHash", "")
            if expected_hash != hash_password(username, password):
                return self._send_json(401, {"ok": False, "error": "Password non corretta!"})

            return self._send_json(200, {
                "ok": True,
                "username": username,
                "displayName": stored.get("displayName", username),
                "lang": stored.get("lang", "it"),
                "mainCurrency": stored.get("mainCurrency", "EUR"),
                "items": stored.get("items", []),
                "history": stored.get("history", []),
                "updatedAt": stored.get("updatedAt")
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_pull(self):
        return self._handle_login()

    def _handle_push(self):
        try:
            body = self._read_json_body()
            username = sanitize_username(body.get("username", ""))
            password = str(body.get("password") or body.get("pin") or "").strip()

            if not username or not password:
                return self._send_json(400, {"ok": False, "error": "Username e Password obbligatori"})

            user_file = DATA_DIR / f"{username}.json"
            incoming_hash = hash_password(username, password)
            display_name = body.get("displayName", username)

            if user_file.exists():
                existing = json.loads(user_file.read_text(encoding="utf-8"))
                if existing.get("pinHash") and existing.get("pinHash") != incoming_hash:
                    return self._send_json(401, {"ok": False, "error": "Password errata!"})
                display_name = existing.get("displayName", display_name)

            record = {
                "username": username,
                "displayName": display_name,
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
