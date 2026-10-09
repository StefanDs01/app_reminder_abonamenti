# 🖥️ Guida Rapida: Come pubblicare ScadenzApp sulla tua VPS (per Te e la tua Amica in Romania 🇷🇴)

L'applicazione ora include:
1. **Server Multi-Utente (`server.py` + `Docker`)**: tu e la tua amica avete **profili completamente separati protetti da PIN**.
   - Esempio: tu usi il profilo `daniel` con il tuo PIN segreto; lei usa il profilo con il suo nome (es. `maria` / `elena`) e il suo PIN segreto.
   - I dati vengono salvati sulla tua VPS in `data/users/<nome>.json` (con PIN protetto da hash SHA-256).
2. **Supporto completo Romania 🇷🇴**:
   - Bottone in alto **`🇮🇹 IT` / `🇷🇴 RO`** per cambiare tutta l'app in **Rumeno** o **Italiano** con 1 click.
   - Supporto **Multi-Valuta `€ EUR` e `lei RON`** (sia per singola scadenza sia per i totali).
   - Catalogo già pronto con i servizi rumeni: **DIGI (RCS & RDS), PPC/Enel/Hidroelectrica, Engie/E.ON, Întreținere Bloc, Orange/Vodafone/YOXO, Rovinietă (CNAIR), Asigurare RCA, Impozit Auto (Ghișeul.ro), ITP Auto, VOYO.ro, Max (HBO)**.

---

## 🚀 Passo 1: Carica il progetto su GitHub e scaricalo sulla tua VPS

Sul tuo PC (in questa cartella):
```bash
git remote add origin https://github.com/TUO-USERNAME/scadenzapp.git
git branch -M main
git push -u origin main
```

Poi collegati via SSH alla tua **VPS** (`ssh root@IP_DELLA_TUA_VPS`) e clona il repository:
```bash
git clone https://github.com/TUO-USERNAME/scadenzapp.git
cd scadenzapp
```

---

## 🐳 Passo 2: Avvia il Server sulla VPS (Scegli Opzione A oppure Opzione B)

### Opzione A: Con Docker (Consigliata — 1 solo comando!)
Se sulla VPS hai Docker installato:
```bash
docker compose up -d --build
```
Fatto! L'app sarà subito attiva sulla porta `8080` (`http://IP_DELLA_TUA_VPS:8080`) e ripartirà da sola anche se riavvii la VPS.

### Opzione B: Senza Docker (Direttamente con Python 3, già preinstallato su Ubuntu/Debian)
Puoi avviarla subito con:
```bash
python3 server.py --port 8080
```
Per farla girare **sempre in background 24/7** con `systemd`, esegui questi comandi sulla VPS:
```bash
cat << 'EOF' > /etc/systemd/system/scadenzapp.service
[Unit]
Description=ScadenzApp PWA & Multi-User Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/scadenzapp
ExecStart=/usr/bin/python3 /root/scadenzapp/server.py --port 8080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now scadenzapp
```
*(Se il tuo progetto non è in `/root/scadenzapp`, sostituisci il percorso in `WorkingDirectory` e `ExecStart`).*

---

## 🔒 Passo 3 (Consigliato per Smartphone): Attivare HTTPS con Dominio o Sottodominio

> **Nota importante per le Notifiche sul Telefono**: I browser moderni (Chrome su Android e Safari su iPhone) attivano le **Notifiche Web Push** e l'**Installazione PWA** solo se il sito è in **HTTPS** (oppure `localhost`).

Se hai un dominio o sottodominio puntato all'IP della tua VPS (es. `scadenze.tuodominio.com` oppure un dominio gratuito come DuckDNS), il modo più veloce in assoluto per avere **HTTPS automatico gratuito** è usare **Caddy** o **Nginx + Certbot**:

### Con Caddy (2 righe di configurazione, certificato SSL automatico):
```bash
apt install -y caddy
```
Nel file `/etc/caddy/Caddyfile` aggiungi:
```caddyfile
scadenze.tuodominio.com {
    reverse_proxy localhost:8080
}
```
E riavvia Caddy:
```bash
systemctl reload caddy
```

### Oppure con Nginx (se usi già Nginx sulla VPS):
```nginx
server {
    server_name scadenze.tuodominio.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
Poi lancia `certbot --nginx -d scadenze.tuodominio.com`.

---

## 👩‍💻 Passo 4: Come usarla tu e la tua amica in Romania

1. **Manda il link della tua VPS alla tua amica** (es. `https://scadenze.tuodominio.com` o `http://IP_VPS:8080`).
2. **Per la tua amica in Romania**:
   - Appena apre il link, può cliccare in alto su **`🇮🇹 IT`** per passare a **`🇷🇴 RO` (Română)** e su **`💶 EUR`** per passare a **`🇷🇴 RON (lei)`** (oppure tenere entrambe le valute!).
   - Clicca su **`👤 Contul Meu & Cloud`** (in alto a destra), inserisce il suo nome (es. `maria`) e sceglie un suo **PIN segreto**, poi preme **`🔐 Accedi / Salva`**.
   - Da quel momento, tutte le sue scadenze sono salvate sul tuo server VPS nel suo profilo privato e sincronizzate automaticamente tra il suo telefono e il suo PC!
3. **Per te**:
   - Fai la stessa cosa dal tuo dispositivo usando il tuo nome utente (es. `daniel`) e il tuo PIN personale. I tuoi abbonamenti e le tue bollette resteranno completamente separati dai suoi!
