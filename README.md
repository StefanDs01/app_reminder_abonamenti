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

## 🐙 Come salvare e pubblicare su GitHub (e usare su Telefono)

1. Crea un nuovo repository su GitHub (es. `scadenzapp`).
2. Dal terminale nella cartella del progetto esegui:
   ```bash
   git remote add origin https://github.com/TUO-USERNAME/scadenzapp.git
   git branch -M main
   git push -u origin main
   ```
3. **Attiva GitHub Pages** (opzionale, per aprirla anche da smartphone):
   - Vai su **Settings → Pages** del tuo repository GitHub
   - Sotto **Source**, seleziona `Deploy from a branch` → branch `main` → cartella `/ (root)` e clicca **Save**.
4. **Sincronizza i tuoi dati tra PC e Telefono tramite GitHub Gist**:
   - Clicca in alto a destra nell'app su **`☁️ Locale & GitHub`**
   - Inserisci un **Personal Access Token GitHub** con permesso `gist`
   - Premi **`☁️⬆️ Salva ora su GitHub (Push)`** o attiva la sincronizzazione automatica!
