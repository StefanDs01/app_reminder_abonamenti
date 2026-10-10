#!/usr/bin/env python3
"""
ScadenzApp — Server Web + Autenticazione Utenti + Auto-Import Gmail (Google Play, Netflix, Disney+, ecc.)
Ogni utente accede con il proprio Username e Password scelti in fase di registrazione,
vede esclusivamente i propri abbonamenti reali e può collegare Gmail per importare in automatico
i nuovi abbonamenti sottoscritti su Google Play, Netflix, Disney+, Spotify, Prime, Bollette, ecc.
"""

import argparse
import email
import email.header
import email.utils
import hashlib
import html
import imaplib
import json
import mimetypes
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "users"
DATA_DIR.mkdir(parents=True, exist_ok=True)

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/vnd.android.package-archive", ".apk")

# Catalogo intelligente dei servizi riconosciuti dalle email (Google Play, Streaming, Bollette, Auto)
KNOWN_EMAIL_SERVICES = [
    {
        "id": "netflix",
        "name": "Netflix",
        "keywords": ["netflix"],
        "sender_keywords": ["netflix.com"],
        "category": "streaming",
        "type": "subscription",
        "icon": "🎬",
        "color": "#E50914",
        "defaultPriceEUR": 13.99,
        "defaultPriceRON": 49.90,
        "cancelUrl": "https://www.netflix.com/youraccount"
    },
    {
        "id": "disneyplus",
        "name": "Disney+",
        "keywords": ["disney+", "disney plus", "disneyplus"],
        "sender_keywords": ["disneyplus", "disney.com"],
        "category": "streaming",
        "type": "subscription",
        "icon": "🏰",
        "color": "#0063E5",
        "defaultPriceEUR": 9.99,
        "defaultPriceRON": 36.99,
        "cancelUrl": "https://www.disneyplus.com/account"
    },
    {
        "id": "spotify",
        "name": "Spotify",
        "keywords": ["spotify"],
        "sender_keywords": ["spotify.com"],
        "category": "streaming",
        "type": "subscription",
        "icon": "🎵",
        "color": "#1DB954",
        "defaultPriceEUR": 10.99,
        "defaultPriceRON": 24.00,
        "cancelUrl": "https://www.spotify.com/account"
    },
    {
        "id": "prime",
        "name": "Amazon Prime",
        "keywords": ["amazon prime", "prime video", "iscrizione prime"],
        "sender_keywords": ["amazon.it", "amazon.com", "primevideo"],
        "category": "streaming",
        "type": "subscription",
        "icon": "📦",
        "color": "#00A8E1",
        "defaultPriceEUR": 4.99,
        "defaultPriceRON": 13.99,
        "cancelUrl": "https://www.amazon.it/mc"
    },
    {
        "id": "youtube",
        "name": "YouTube Premium",
        "keywords": ["youtube premium", "youtube music", "abbonamento youtube"],
        "sender_keywords": ["youtube.com"],
        "category": "streaming",
        "type": "subscription",
        "icon": "▶️",
        "color": "#FF0000",
        "defaultPriceEUR": 11.99,
        "defaultPriceRON": 26.00,
        "cancelUrl": "https://www.youtube.com/paid_memberships"
    },
    {
        "id": "dazn",
        "name": "DAZN",
        "keywords": ["dazn"],
        "sender_keywords": ["dazn.com"],
        "category": "streaming",
        "type": "subscription",
        "icon": "⚽",
        "color": "#F7A600",
        "defaultPriceEUR": 34.99,
        "defaultPriceRON": 99.00,
        "cancelUrl": "https://www.dazn.com/myaccount"
    },
    {
        "id": "chatgpt",
        "name": "ChatGPT Plus (OpenAI)",
        "keywords": ["chatgpt", "openai"],
        "sender_keywords": ["openai.com", "tm.openai.com"],
        "category": "software",
        "type": "subscription",
        "icon": "🤖",
        "color": "#10A37F",
        "defaultPriceEUR": 22.00,
        "defaultPriceRON": 110.00,
        "cancelUrl": "https://chatgpt.com/#settings/Subscription"
    },
    {
        "id": "google_one",
        "name": "Google One",
        "keywords": ["google one", "spazio di archiviazione google"],
        "sender_keywords": ["google.com"],
        "category": "software",
        "type": "subscription",
        "icon": "☁️",
        "color": "#4285F4",
        "defaultPriceEUR": 1.99,
        "defaultPriceRON": 9.99,
        "cancelUrl": "https://play.google.com/store/account/subscriptions"
    },
    {
        "id": "icloud",
        "name": "Apple / iCloud+",
        "keywords": ["icloud+", "icloud", "apple media services", "fattura apple"],
        "sender_keywords": ["apple.com", "email.apple.com"],
        "category": "software",
        "type": "subscription",
        "icon": "🍎",
        "color": "#38BDF8",
        "defaultPriceEUR": 2.99,
        "defaultPriceRON": 14.99,
        "cancelUrl": "https://support.apple.com/it-it/HT202039"
    },
    {
        "id": "psplus",
        "name": "PlayStation Plus",
        "keywords": ["playstation plus", "ps plus", "playstation network"],
        "sender_keywords": ["playstation.com", "sonyentertainmentnetwork"],
        "category": "software",
        "type": "subscription",
        "icon": "🎮",
        "color": "#00439C",
        "defaultPriceEUR": 8.99,
        "defaultPriceRON": 45.00,
        "cancelUrl": "https://store.playstation.com"
    },
    {
        "id": "xbox",
        "name": "Xbox Game Pass",
        "keywords": ["xbox game pass", "game pass"],
        "sender_keywords": ["xbox.com", "microsoft.com"],
        "category": "software",
        "type": "subscription",
        "icon": "🕹️",
        "color": "#107C10",
        "defaultPriceEUR": 11.99,
        "defaultPriceRON": 59.00,
        "cancelUrl": "https://account.microsoft.com/services"
    },
    {
        "id": "max",
        "name": "Max (HBO)",
        "keywords": ["hbo max", "abbonamento max", "abonament max"],
        "sender_keywords": ["max.com", "hbomax.com"],
        "category": "streaming",
        "type": "subscription",
        "icon": "🎭",
        "color": "#6366F1",
        "defaultPriceEUR": 9.99,
        "defaultPriceRON": 34.90,
        "cancelUrl": "https://www.max.com/account"
    },
    {
        "id": "voyo",
        "name": "VOYO",
        "keywords": ["voyo"],
        "sender_keywords": ["voyo.ro", "protv.ro"],
        "category": "streaming",
        "type": "subscription",
        "icon": "📺",
        "color": "#E11D48",
        "defaultPriceEUR": 4.99,
        "defaultPriceRON": 24.90,
        "cancelUrl": "https://voyo.protv.ro"
    },
    {
        "id": "canva",
        "name": "Canva Pro",
        "keywords": ["canva pro", "canva"],
        "sender_keywords": ["canva.com"],
        "category": "software",
        "type": "subscription",
        "icon": "🎨",
        "color": "#8B5CF6",
        "defaultPriceEUR": 11.99,
        "defaultPriceRON": 59.00,
        "cancelUrl": "https://www.canva.com/settings/billing-and-teams"
    },
    {
        "id": "enel_luce",
        "name": "Bolletta Luce / Energia",
        "keywords": ["enel energia", "hidroelectrica", "bolletta luce", "factura energie"],
        "sender_keywords": ["enel.com", "enel.it", "hidroelectrica.ro", "eon.ro"],
        "category": "bills",
        "type": "bill",
        "icon": "💡",
        "color": "#F59E0B",
        "defaultPriceEUR": 65.00,
        "defaultPriceRON": 180.00,
        "cancelUrl": "https://www.enel.it"
    },
    {
        "id": "gas_bill",
        "name": "Bolletta Gas (Eni / Engie)",
        "keywords": ["eni plenitude", "engie", "bolletta gas", "factura gaze"],
        "sender_keywords": ["eniplenitude.com", "engie.ro", "engie.it"],
        "category": "bills",
        "type": "bill",
        "icon": "🔥",
        "color": "#EA580C",
        "defaultPriceEUR": 55.00,
        "defaultPriceRON": 210.00,
        "cancelUrl": "https://eniplenitude.com"
    },
    {
        "id": "digi_internet",
        "name": "Internet & Mobile (DIGI / TIM / Iliad)",
        "keywords": ["digi.ro", "digi mobil", "rcs & rds", "fattura tim", "iliad", "vodafone"],
        "sender_keywords": ["digi.ro", "rcs-rds.ro", "iliad.it", "tim.it", "vodafone"],
        "category": "bills",
        "type": "bill",
        "icon": "🌐",
        "color": "#0284C7",
        "defaultPriceEUR": 24.90,
        "defaultPriceRON": 65.00,
        "cancelUrl": "https://www.digi.ro/my-account"
    }
]

SUBSCRIPTION_TRIGGER_WORDS = [
    "abbonamento", "rinnovo", "ricevuta", "conferma", "ordine", "fattura",
    "bolletta", "pagamento", "prova gratuita", "mese di prova", "benvenuto",
    "subscription", "receipt", "invoice", "renewal", "order confirmation", "free trial",
    "abonament", "chitanț", "chitant", "factur", "confirmare", "plată", "plata",
    "google play"
]

TRIAL_KEYWORDS = [
    "prova gratuita", "periodo di prova", "mese gratuito", "1 mese gratis",
    "free trial", "trial period", "perioadă de probă", "perioada de proba",
    "0,00 €", "€ 0,00", "0.00 eur", "0,00 lei", "0.00 ron"
]


def sanitize_username(username: str) -> str:
    clean = re.sub(r"[^a-z0-9_.-]", "", (username or "").strip().lower())
    return clean[:40]


def hash_password(username: str, password: str) -> str:
    salted = f"scadenzapp_v2::{username}::{password}".encode("utf-8")
    return hashlib.sha256(salted).hexdigest()


def decode_mime_str(value: str) -> str:
    if not value:
        return ""
    decoded_parts = []
    for part, enc in email.header.decode_header(value):
        if isinstance(part, bytes):
            try:
                decoded_parts.append(part.decode(enc or "utf-8", errors="replace"))
            except Exception:
                decoded_parts.append(part.decode("utf-8", errors="replace"))
        else:
            decoded_parts.append(str(part))
    return "".join(decoded_parts)


def strip_html_tags(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_email_body(msg) -> str:
    plain_parts = []
    html_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            cdisp = str(part.get("Content-Disposition") or "")
            if "attachment" in cdisp.lower():
                continue
            try:
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if ctype == "text/plain":
                    plain_parts.append(decoded)
                elif ctype == "text/html":
                    html_parts.append(strip_html_tags(decoded))
            except Exception:
                continue
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if msg.get_content_type() == "text/html":
                    html_parts.append(strip_html_tags(decoded))
                else:
                    plain_parts.append(decoded)
        except Exception:
            pass
    combined = " ".join(plain_parts) if plain_parts else " ".join(html_parts)
    return combined[:12000]


def extract_price_and_currency(text: str, default_currency: str = "EUR"):
    """Estrae l'importo reale e la valuta dal testo dell'email."""
    patterns = [
        # € 13,99 o EUR 13.99
        (r"(?:€|EUR)\s*(\d{1,4}[.,]\d{2})", "EUR"),
        # 13,99 € o 13.99 EUR
        (r"(\d{1,4}[.,]\d{2})\s*(?:€|EUR)", "EUR"),
        # 49,90 lei o 49.90 RON
        (r"(\d{1,4}[.,]\d{2})\s*(?:lei|LEI|RON)", "RON"),
        (r"(?:RON|LEI)\s*(\d{1,4}[.,]\d{2})", "RON"),
    ]
    for pattern, curr in patterns:
        matches = re.findall(pattern, text, flags=re.IGNORECASE)
        for m in matches:
            try:
                val = float(m.replace(",", "."))
                if 0.50 <= val <= 2500.0:
                    return val, curr
            except ValueError:
                continue
    return None, default_currency


def compute_next_monthly_date(email_dt: datetime) -> str:
    """Calcola la prossima data di rinnovo partendo dalla data dell'email e portandola nel futuro."""
    now = datetime.now()
    target = email_dt.replace(tzinfo=None)
    # Aggiunge cicli di 1 mese finché la data è nel futuro (o almeno oggi)
    loops = 0
    while target.date() <= now.date() and loops < 36:
        year = target.year
        month = target.month + 1
        if month > 12:
            month = 1
            year += 1
        day = min(target.day, 28)
        target = target.replace(year=year, month=month, day=day)
        loops += 1
    return target.strftime("%Y-%m-%d")


def parse_single_email_to_subscription(
    subject: str,
    sender: str,
    body_text: str,
    email_date: datetime,
    user_currency: str = "EUR",
    user_email: str = ""
) -> dict | None:
    """Analizza oggetto, mittente e corpo di un'email e restituisce l'abbonamento/bolletta se rilevato."""
    full_text = f"{subject} {sender} {body_text}"
    full_lower = full_text.lower()
    subj_sender_lower = f"{subject} {sender}".lower()

    # Verifica che contenga almeno una parola chiave legata ad abbonamenti/ricevute/bollette
    if not any(trigger in full_lower for trigger in SUBSCRIPTION_TRIGGER_WORDS):
        return None

    matched_service = None
    is_google_play = "google play" in subj_sender_lower or "googleplay" in subj_sender_lower

    # 1. Cerca se corrisponde a uno dei servizi noti (Netflix, Disney+, Spotify, ecc.)
    for srv in KNOWN_EMAIL_SERVICES:
        if any(sk in subj_sender_lower for sk in srv["sender_keywords"]) or any(
            kw in subj_sender_lower for kw in srv["keywords"]
        ):
            matched_service = srv
            break

    # Se è una ricevuta Google Play e il nome del servizio è nel corpo dell'email
    if not matched_service and is_google_play:
        for srv in KNOWN_EMAIL_SERVICES:
            if any(kw in full_lower for kw in srv["keywords"]):
                matched_service = srv
                break

    # Se è una ricevuta di Google Play generica (es. un'app Android in abbonamento come Tinder, CapCut, Duolingo, ecc.)
    custom_google_play_name = None
    if not matched_service and is_google_play:
        # Prova a estrarre il nome dell'app dalla ricevuta Google Play
        gp_match = re.search(r"(?:Elemento|Articolo|Item|Produs|Abbonamento)\s*[:\-]?\s*([A-Za-z0-9 +._\-]{3,35})", body_text)
        app_title = gp_match.group(1).strip() if gp_match else "App Google Play"
        custom_google_play_name = f"Google Play ({app_title})"
        matched_service = {
            "id": f"googleplay_{re.sub(r'[^a-z0-9]', '', app_title.lower())[:16]}",
            "name": custom_google_play_name,
            "category": "software",
            "type": "subscription",
            "icon": "▶️",
            "color": "#34A853",
            "defaultPriceEUR": 9.99,
            "defaultPriceRON": 49.00,
            "cancelUrl": "https://play.google.com/store/account/subscriptions"
        }

    if not matched_service:
        return None

    # Estrai prezzo e valuta
    price, currency = extract_price_and_currency(full_text, user_currency)
    if price is None:
        price = matched_service["defaultPriceRON"] if user_currency == "RON" else matched_service["defaultPriceEUR"]
        currency = user_currency

    # Rileva se è un periodo di prova / 1 mese
    is_trial = any(tk in full_lower for tk in TRIAL_KEYWORDS)
    next_due_date = compute_next_monthly_date(email_date)

    payment_method = "Google Play" if is_google_play else "Email Auto-Import (Gmail)"
    cancel_url = (
        "https://play.google.com/store/account/subscriptions"
        if is_google_play
        else matched_service.get("cancelUrl", "")
    )

    return {
        "id": f"item_gmail_{matched_service['id']}_{int(time.time())}_{uuid.uuid4().hex[:4]}",
        "presetId": matched_service["id"],
        "name": matched_service["name"],
        "category": matched_service["category"],
        "itemType": matched_service["type"],
        "type": matched_service["type"],
        "icon": matched_service["icon"],
        "color": matched_service["color"],
        "price": round(float(price), 2),
        "currency": currency,
        "billingCycle": "monthly",
        "cycle": "monthly",
        "nextDate": next_due_date,
        "nextDueDate": next_due_date,
        "remindDaysBefore": 3 if matched_service["type"] == "subscription" else 5,
        "cancelBeforeRenewal": bool(is_trial),
        "accountEmail": user_email,
        "paymentMethod": payment_method,
        "cancelUrl": cancel_url,
        "notes": f"Importato in automatico da Gmail ({subject[:60]})",
        "status": "active",
        "importedFromGmail": True,
        "lastEmailDate": email_date.strftime("%Y-%m-%d")
    }


def scan_gmail_for_user(user_record: dict) -> tuple[list[dict], str]:
    """
    Si collega via IMAP SSL a imap.gmail.com:993, cerca le email di abbonamenti/ricevute
    degli ultimi 60 giorni e aggiorna gli abbonamenti dell'utente senza duplicati.
    Restituisce (lista_nuovi_abbonamenti, eventuale_errore).
    """
    gmail_cfg = user_record.get("gmailConfig") or {}
    gmail_address = (gmail_cfg.get("email") or "").strip()
    gmail_app_password = re.sub(r"\s+", "", (gmail_cfg.get("appPassword") or "").strip())

    if not gmail_address or not gmail_app_password:
        return [], "Inserisci indirizzo Gmail e Password per le App di Google."

    user_currency = user_record.get("mainCurrency", "EUR")
    existing_items = user_record.get("items", [])

    # Mappa dei nomi già presenti per evitare duplicati
    existing_names = {
        (item.get("name") or "").strip().lower()
        for item in existing_items
        if item.get("status") != "cancelled"
    }
    existing_presets = {
        (item.get("presetId") or "").strip().lower()
        for item in existing_items
        if item.get("presetId") and item.get("status") != "cancelled"
    }

    newly_added = []

    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mail.login(gmail_address, gmail_app_password)
        mail.select("INBOX", readonly=True)

        # Cerca email degli ultimi 60 giorni
        since_date = (datetime.now() - timedelta(days=60)).strftime("%d-%b-%Y")
        status, data = mail.search(None, f'(SINCE "{since_date}")')
        if status != "OK" or not data or not data[0]:
            mail.logout()
            return [], ""

        msg_ids = data[0].split()
        # Analizza le ultime 80 email più recenti
        recent_ids = msg_ids[-80:]
        recent_ids.reverse()

        for m_id in recent_ids:
            try:
                res, msg_data = mail.fetch(m_id, "(RFC822)")
                if res != "OK" or not msg_data or not msg_data[0]:
                    continue
                raw_bytes = msg_data[0][1]
                msg = email.message_from_bytes(raw_bytes)

                subject = decode_mime_str(msg.get("Subject", ""))
                sender = decode_mime_str(msg.get("From", ""))
                date_hdr = msg.get("Date", "")
                try:
                    email_dt = email.utils.parsedate_to_datetime(date_hdr)
                except Exception:
                    email_dt = datetime.now()

                # Filtra rapidamente prima di estrarre il corpo intero
                quick_check = f"{subject} {sender}".lower()
                is_candidate = (
                    "google play" in quick_check
                    or any(
                        any(sk in quick_check for sk in srv["sender_keywords"])
                        or any(kw in quick_check for kw in srv["keywords"])
                        for srv in KNOWN_EMAIL_SERVICES
                    )
                )
                if not is_candidate:
                    continue

                body_text = extract_email_body(msg)
                parsed_item = parse_single_email_to_subscription(
                    subject=subject,
                    sender=sender,
                    body_text=body_text,
                    email_date=email_dt,
                    user_currency=user_currency,
                    user_email=gmail_address
                )
                if not parsed_item:
                    continue

                norm_name = parsed_item["name"].strip().lower()
                norm_preset = (parsed_item.get("presetId") or "").strip().lower()
                if norm_name in existing_names or (norm_preset and norm_preset in existing_presets):
                    continue

                existing_names.add(norm_name)
                if norm_preset:
                    existing_presets.add(norm_preset)
                existing_items.insert(0, parsed_item)
                newly_added.append(parsed_item)
            except Exception:
                continue

        mail.logout()
        return newly_added, ""
    except imaplib.IMAP4.error as auth_err:
        err_msg = str(auth_err)
        if "Application-specific password" in err_msg or "Invalid credentials" in err_msg or "AUTHENTICATIONFAILED" in err_msg:
            return [], (
                "Credenziali rifiutate da Google. Assicurati di aver inserito la 'Password per le app' di Google "
                "(16 lettere generata da myaccount.google.com/apppasswords) e non la password normale dell'account."
            )
        return [], f"Errore autenticazione Gmail IMAP: {err_msg}"
    except Exception as exc:
        return [], f"Errore di connessione a Gmail: {str(exc)}"


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

    def _format_gmail_status(self, stored: dict) -> dict:
        cfg = stored.get("gmailConfig") or {}
        return {
            "enabled": bool(cfg.get("enabled") and cfg.get("email")),
            "email": cfg.get("email", ""),
            "lastScanAt": cfg.get("lastScanAt", "")
        }

    def do_GET(self):
        if self.path == "/api/health":
            return self._send_json(200, {
                "ok": True,
                "service": "ScadenzApp VPS Auth + Gmail Auto-Sync Server",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        if self.path.startswith("/api/calendar/") and ".ics" in self.path:
            return self._handle_calendar_ics_feed()

        if self.path.startswith("/data/") or self.path == "/data":
            return self._send_json(403, {"ok": False, "error": "Accesso negato"})

        return super().do_GET()

    def _handle_calendar_ics_feed(self):
        try:
            raw_part = self.path.split("/api/calendar/", 1)[1].split("?")[0]
            if raw_part.endswith(".ics"):
                raw_part = raw_part[:-4]
            username = sanitize_username(raw_part)
            user_file = DATA_DIR / f"{username}.json"
            if not username or not user_file.exists():
                return self._send_json(404, {"ok": False, "error": "Calendario utente non trovato"})

            stored = json.loads(user_file.read_text(encoding="utf-8"))
            items = [i for i in stored.get("items", []) if i.get("status") == "active"]

            lines = [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//ScadenzApp//Calendar Sync IT-RO//IT",
                "CALSCALE:GREGORIAN",
                "METHOD:PUBLISH",
                f"X-WR-CALNAME:ScadenzApp - {stored.get('displayName', username)}",
                "X-WR-TIMEZONE:Europe/Rome",
            ]

            now_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

            for item in items:
                next_date = (item.get("nextDate") or "").strip()
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", next_date):
                    continue
                d_clean = next_date.replace("-", "")
                event_time = (item.get("eventTime") or "").strip()
                item_type = item.get("itemType") or "subscription"
                icon = item.get("icon") or "📅"
                name = item.get("name") or "Promemoria"
                notes = item.get("notes") or ""
                price = float(item.get("price") or 0)
                curr = item.get("currency") or "EUR"

                summary = f"{icon} {name}"
                if item_type in ("subscription", "bill") and price > 0:
                    summary += f" ({price:.2f} {curr})"

                lines.append("BEGIN:VEVENT")
                lines.append(f"UID:{item.get('id', uuid.uuid4().hex)}@scadenzapp")
                lines.append(f"DTSTAMP:{now_stamp}")

                if event_time and re.match(r"^\d{2}:\d{2}$", event_time):
                    hh, mm = event_time.split(":")
                    dt_start = f"{d_clean}T{hh}{mm}00"
                    end_h = (int(hh) + 1) % 24
                    dt_end = f"{d_clean}T{end_h:02d}{mm}00"
                    lines.append(f"DTSTART:{dt_start}")
                    lines.append(f"DTEND:{dt_end}")
                else:
                    try:
                        dt_obj = datetime.strptime(next_date, "%Y-%m-%d") + timedelta(days=1)
                        d_next = dt_obj.strftime("%Y%m%d")
                    except Exception:
                        d_next = d_clean
                    lines.append(f"DTSTART;VALUE=DATE:{d_clean}")
                    lines.append(f"DTEND;VALUE=DATE:{d_next}")

                if item_type == "birthday" or item.get("billingCycle") == "yearly":
                    lines.append("RRULE:FREQ=YEARLY")
                elif item_type == "subscription" and item.get("billingCycle") == "monthly":
                    lines.append("RRULE:FREQ=MONTHLY")

                lines.append(f"SUMMARY:{summary}")
                if notes:
                    clean_notes = notes.replace("\n", " ").replace("\r", "")
                    lines.append(f"DESCRIPTION:{clean_notes}")

                # Allarme nativo sul telefono / Google Calendar
                remind_days = int(item.get("remindDaysBefore") or 1)
                lines.extend([
                    "BEGIN:VALARM",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:Promemoria ScadenzApp: {summary}",
                    f"TRIGGER:-P{max(1, remind_days)}D",
                    "END:VALARM",
                    "BEGIN:VALARM",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:Oggi: {summary}",
                    "TRIGGER:-PT1H",
                    "END:VALARM",
                    "END:VEVENT"
                ])

            lines.append("END:VCALENDAR")
            ics_bytes = "\r\n".join(lines).encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "text/calendar; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="scadenzapp-{username}.ics"')
            self.send_header("Content-Length", str(len(ics_bytes)))
            self.end_headers()
            self.wfile.write(ics_bytes)
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def do_POST(self):
        if self.path == "/api/auth/register":
            return self._handle_register()
        if self.path == "/api/auth/login":
            return self._handle_login()
        if self.path == "/api/sync/pull":
            return self._handle_pull()
        if self.path == "/api/sync/push":
            return self._handle_push()
        if self.path == "/api/gmail/connect":
            return self._handle_gmail_connect()
        if self.path == "/api/gmail/scan":
            return self._handle_gmail_scan()
        if self.path == "/api/gmail/disconnect":
            return self._handle_gmail_disconnect()
        if self.path == "/api/gmail/parse-text":
            return self._handle_parse_text()
        return self._send_json(404, {"ok": False, "error": "Endpoint non trovato"})

    def _authenticate_user(self, body: dict) -> tuple[Path | None, dict | None, str]:
        username = sanitize_username(body.get("username", ""))
        password = str(body.get("password") or body.get("pin") or "").strip()
        if not username or not password:
            return None, None, "Username e password obbligatori."
        user_file = DATA_DIR / f"{username}.json"
        if not user_file.exists():
            return None, None, "Utente non trovato."
        stored = json.loads(user_file.read_text(encoding="utf-8"))
        if stored.get("pinHash") != hash_password(username, password):
            return None, None, "Password non corretta."
        return user_file, stored, ""

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
                "gmailConfig": {"enabled": False, "email": "", "appPassword": "", "lastScanAt": ""},
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
                "history": [],
                "gmailStatus": self._format_gmail_status(record)
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
                "gmailStatus": self._format_gmail_status(stored),
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
            incoming_display = (body.get("displayName") or "").strip()
            display_name = incoming_display or username
            gmail_config = {"enabled": False, "email": "", "appPassword": "", "lastScanAt": ""}

            if user_file.exists():
                existing = json.loads(user_file.read_text(encoding="utf-8"))
                if existing.get("pinHash") and existing.get("pinHash") != incoming_hash:
                    return self._send_json(401, {"ok": False, "error": "Password errata!"})
                if not incoming_display:
                    display_name = existing.get("displayName", display_name)
                gmail_config = existing.get("gmailConfig", gmail_config)

            record = {
                "username": username,
                "displayName": display_name,
                "pinHash": incoming_hash,
                "lang": body.get("lang", "it"),
                "mainCurrency": body.get("mainCurrency", "EUR"),
                "items": body.get("items", []),
                "history": body.get("history", []),
                "gmailConfig": gmail_config,
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }

            user_file.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
            return self._send_json(200, {
                "ok": True,
                "username": username,
                "gmailStatus": self._format_gmail_status(record),
                "updatedAt": record["updatedAt"]
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_gmail_connect(self):
        try:
            body = self._read_json_body()
            user_file, stored, err = self._authenticate_user(body)
            if err:
                return self._send_json(401, {"ok": False, "error": err})

            gmail_email = (body.get("gmailEmail") or "").strip()
            gmail_app_password = re.sub(r"\s+", "", (body.get("gmailAppPassword") or "").strip())

            # Se l'utente ha già una password salvata e lascia il campo vuoto per ricollegare
            existing_cfg = stored.get("gmailConfig") or {}
            if not gmail_app_password and existing_cfg.get("appPassword"):
                gmail_app_password = existing_cfg.get("appPassword")

            if not gmail_email or "@" not in gmail_email:
                return self._send_json(400, {"ok": False, "error": "Inserisci un indirizzo Gmail valido."})
            if len(gmail_app_password) < 8:
                return self._send_json(400, {
                    "ok": False,
                    "error": "Inserisci la Password per le app di Google (16 caratteri)."
                })

            stored["gmailConfig"] = {
                "enabled": True,
                "email": gmail_email,
                "appPassword": gmail_app_password,
                "lastScanAt": datetime.now(timezone.utc).isoformat()
            }

            newly_added, scan_err = scan_gmail_for_user(stored)
            if scan_err:
                return self._send_json(400, {"ok": False, "error": scan_err})

            stored["gmailConfig"]["lastScanAt"] = datetime.now(timezone.utc).isoformat()
            stored["updatedAt"] = datetime.now(timezone.utc).isoformat()
            user_file.write_text(json.dumps(stored, indent=2, ensure_ascii=False), encoding="utf-8")

            return self._send_json(200, {
                "ok": True,
                "addedCount": len(newly_added),
                "addedItems": newly_added,
                "items": stored.get("items", []),
                "gmailStatus": self._format_gmail_status(stored)
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_gmail_scan(self):
        try:
            body = self._read_json_body()
            user_file, stored, err = self._authenticate_user(body)
            if err:
                return self._send_json(401, {"ok": False, "error": err})

            newly_added, scan_err = scan_gmail_for_user(stored)
            if scan_err:
                return self._send_json(400, {"ok": False, "error": scan_err})

            if "gmailConfig" in stored:
                stored["gmailConfig"]["lastScanAt"] = datetime.now(timezone.utc).isoformat()
            stored["updatedAt"] = datetime.now(timezone.utc).isoformat()
            user_file.write_text(json.dumps(stored, indent=2, ensure_ascii=False), encoding="utf-8")

            return self._send_json(200, {
                "ok": True,
                "addedCount": len(newly_added),
                "addedItems": newly_added,
                "items": stored.get("items", []),
                "gmailStatus": self._format_gmail_status(stored)
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_gmail_disconnect(self):
        try:
            body = self._read_json_body()
            user_file, stored, err = self._authenticate_user(body)
            if err:
                return self._send_json(401, {"ok": False, "error": err})

            stored["gmailConfig"] = {"enabled": False, "email": "", "appPassword": "", "lastScanAt": ""}
            stored["updatedAt"] = datetime.now(timezone.utc).isoformat()
            user_file.write_text(json.dumps(stored, indent=2, ensure_ascii=False), encoding="utf-8")

            return self._send_json(200, {
                "ok": True,
                "gmailStatus": self._format_gmail_status(stored)
            })
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_parse_text(self):
        """Analizza al volo il testo incollato di una ricevuta/email Google Play, Netflix, ecc."""
        try:
            body = self._read_json_body()
            raw_text = (body.get("text") or "").strip()
            user_currency = body.get("mainCurrency", "EUR")
            if not raw_text:
                return self._send_json(400, {"ok": False, "error": "Incolla il testo dell'email o della ricevuta."})

            parsed = parse_single_email_to_subscription(
                subject=raw_text[:200],
                sender="google play" if "google play" in raw_text.lower() else "",
                body_text=raw_text,
                email_date=datetime.now(),
                user_currency=user_currency,
                user_email=""
            )
            if not parsed:
                price, curr = extract_price_and_currency(raw_text, user_currency)
                parsed = {
                    "id": f"item_paste_{int(time.time())}",
                    "name": "Abbonamento da Ricevuta",
                    "category": "streaming",
                    "itemType": "subscription",
                    "type": "subscription",
                    "icon": "🧾",
                    "color": "#6366f1",
                    "price": round(float(price or 9.99), 2),
                    "currency": curr,
                    "billingCycle": "monthly",
                    "cycle": "monthly",
                    "nextDate": compute_next_monthly_date(datetime.now()),
                    "nextDueDate": compute_next_monthly_date(datetime.now()),
                    "remindDaysBefore": 3,
                    "cancelBeforeRenewal": any(tk in raw_text.lower() for tk in TRIAL_KEYWORDS),
                    "accountEmail": "",
                    "paymentMethod": "Google Play / Carta",
                    "cancelUrl": "https://play.google.com/store/account/subscriptions",
                    "notes": "Estratto da ricevuta incollata",
                    "status": "active"
                }

            return self._send_json(200, {"ok": True, "item": parsed})
        except Exception as exc:
            return self._send_json(500, {"ok": False, "error": str(exc)})


def background_gmail_sync_loop():
    """Controlla automaticamente ogni 10 minuti le caselle Gmail collegate dagli utenti."""
    while True:
        time.sleep(600)
        try:
            for user_file in DATA_DIR.glob("*.json"):
                try:
                    stored = json.loads(user_file.read_text(encoding="utf-8"))
                    cfg = stored.get("gmailConfig") or {}
                    if not cfg.get("enabled") or not cfg.get("email") or not cfg.get("appPassword"):
                        continue
                    newly_added, err = scan_gmail_for_user(stored)
                    if not err:
                        stored["gmailConfig"]["lastScanAt"] = datetime.now(timezone.utc).isoformat()
                        if newly_added:
                            stored["updatedAt"] = datetime.now(timezone.utc).isoformat()
                        user_file.write_text(json.dumps(stored, indent=2, ensure_ascii=False), encoding="utf-8")
                except Exception:
                    continue
        except Exception:
            continue


def main():
    parser = argparse.ArgumentParser(description="ScadenzApp VPS Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host di ascolto (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")), help="Porta HTTP (default: 8080)")
    args = parser.parse_args()

    # Avvia il thread in background per la scansione periodica automatica di Gmail
    worker = threading.Thread(target=background_gmail_sync_loop, daemon=True)
    worker.start()

    server = HTTPServer((args.host, args.port), ScadenzAppHandler)
    print("==========================================================")
    print(f"🚀 ScadenzApp Server VPS + Gmail Auto-Sync attivo su http://{args.host}:{args.port}")
    print(f"📂 Cartella profili utenti: {DATA_DIR}")
    print("==========================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArresto del server...")
        server.server_close()


if __name__ == "__main__":
    main()
