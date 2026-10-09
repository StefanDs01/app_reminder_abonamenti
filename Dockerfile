FROM python:3.12-alpine

WORKDIR /app

# Copia i file dell'applicazione
COPY index.html styles.css i18n.js data-presets.js app.js sw.js icon.svg manifest.webmanifest server.py ./

# Crea la directory persistente per i profili utenti
RUN mkdir -p /app/data/users

EXPOSE 8080

ENV PORT=8080

CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "8080"]
