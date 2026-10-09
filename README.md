# 🛡️ ScadenzApp — Gestione Abbonamenti, Disdette (1 Mese), Bollette & Bollo Auto

Applicazione Web Progressiva (**PWA**) progettata per:
1. **Non dimenticare più di disdire gli abbonamenti** (anche quelli sottoscritti solo per **1 mese** o in prova gratuita, come Netflix, Disney+, Prime, DAZN, ChatGPT, ecc.).
2. **Tenere sotto controllo Bollette, Bollo Auto e Pagamenti Ricorrenti** (Luce, Gas, Acqua, Fibra, Bollo Auto, Assicurazione RCA, TARI, Affitto/Mutuo).
3. **Ricevere notifiche sul browser/dispositivo** prima del rinnovo automatico o della scadenza, con link diretto alla pagina di disdetta o pagamento.
4. **Salvataggio Dati Doppio (Locale + GitHub)**:
   - **Salvataggio Locale istantaneo** (`localStorage` + Export/Import `.json`).
   - **Sincronizzazione Cloud con GitHub** tramite GitHub Gist privato (per sincronizzare i dati tra PC e smartphone senza database esterni a pagamento).

---

## 🚀 Come avviare l'applicazione in Locale

### Metodo 1: Doppio click su `Avvia_ScadenzApp.bat` (Consigliato su Windows)
Fai doppio click sul file **`Avvia_ScadenzApp.bat`**:
- Avvierà un leggerissimo server locale su `http://localhost:8080/` (senza bisogno di installare Node.js o altro)
- Aprirà automaticamente il browser con **Notifiche Web** e **Installazione PWA** abilitate.

### Metodo 2: Apertura diretta
Puoi anche aprire direttamente il file **`index.html`** con qualsiasi browser (Chrome, Edge, Safari, Firefox).

---

## 🐙 Come salvare e pubblicare su GitHub e VPS

1. Il repository GitHub collegato è: `https://github.com/StefanDs01/app_reminder_abonamenti`
2. Per inviare gli aggiornamenti su GitHub dal terminale:
   ```bash
   git remote set-url origin https://github.com/StefanDs01/app_reminder_abonamenti.git
   git branch -M main
   git push -u origin main
   ```
3. **Pubblicazione su VPS (Multi-Utente IT 🇮🇹 / RO 🇷🇴)**:
   - Segui passo-passo il file **[GUIDA_VPS.md](./GUIDA_VPS.md)** per clonare `app_reminder_abonamenti` sulla tua VPS e collegarlo al tuo dominio `inimaaiassist`.
4. **Attiva GitHub Pages** (opzionale):
   - Vai su **Settings → Pages** del tuo repository `app_reminder_abonamenti`
   - Sotto **Source**, seleziona `Deploy from a branch` → branch `main` → cartella `/ (root)` e clicca **Save**.
