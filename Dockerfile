FROM python:3.12-alpine

WORKDIR /app

# Copia tutti i file dell'applicazione (inclusi icon-192.png, icon-512.png ed eventuale ScadenzApp.apk)
COPY . ./

# Crea la directory persistente per i profili utenti
RUN mkdir -p /app/data/users

EXPOSE 8080

ENV PORT=8080

CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "8080"]
