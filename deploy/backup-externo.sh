#!/bin/bash
# Backup externo da Central: uma cópia por dia fora da VPS, no Google Drive.
#
# A Central já guarda 7 cópias do banco em dados/backup, mas na mesma máquina.
# Este script, rodado pelo cron do servidor, faz:
#   1. cópia consistente do banco agora (VACUUM INTO pelo admin.ts) e confere a integridade;
#   2. pacote com banco + config/local.json + central.env + sessão do WhatsApp (já cifrada);
#   3. cifra com GPG para uma chave própria (o servidor só tem a pública);
#   4. envia para o Google Drive (rclone próprio, escopo drive.file, pasta central-backup/).
#
# A chave do cofre (segredos/) NÃO entra no pacote: sem ela, o banco não abre os
# segredos, e ela tem de ser guardada em outro lugar (ver a nota do vault).
#
# Pastas no servidor (BASE, padrão /root/backups/central):
#   gnupg/    chaveiro só com a chave pública de backup@central.local
#   rclone/   rclone.conf do remoto "centraldrive"
#   pacotes/  pacotes cifrados dos últimos 14 dias
# Log: /var/log/central-backup.log. Restaurar: ver docs/backup.md.
set -uo pipefail

CENTRAL_DIR=${CENTRAL_DIR:-/opt/central}
BASE=${BASE:-/root/backups/central}
LOG=${LOG:-/var/log/central-backup.log}
DEST_GPG=backup@central.local
REMOTO=centraldrive:central-backup/
MANTER_DIAS=14
RCLONE_IMG=rclone/rclone:1.71.1

mkdir -p "$BASE/pacotes"
exec 9>"$BASE/.backup.lock"; flock -n 9 || exit 0
registrar() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
DATA=$(date +%Y%m%d_%H%M%S); TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
registrar "=== backup iniciado ==="
falhas=0

# ── 1. banco: cópia nova e consistente ────────────────────────────────────────
# O admin.ts abre o banco de dentro do contêiner e faz VACUUM INTO em
# /dados/backup/central-AAAA-MM-DD.sqlite3 (o mesmo arquivo do backup interno do dia).
if arq=$(docker exec central node src/admin.ts backup 2>"$TMP/admin.err" | tail -1) && [ -n "$arq" ]; then
  host="$CENTRAL_DIR/dados/${arq#/dados/}"
  ok=$(docker exec central node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(db.prepare('PRAGMA integrity_check').get().integrity_check);" "$arq" 2>&1)
  if [ "$ok" = ok ] && [ -s "$host" ]; then
    cp "$host" "$TMP/central.sqlite3"
    registrar "✅ banco OK ($(du -h "$TMP/central.sqlite3" | cut -f1), integrity_check=ok)"
  else
    registrar "❌ FALHOU a conferência do banco: $ok"; falhas=$((falhas+1))
  fi
else
  registrar "❌ FALHOU a cópia do banco: $(head -c 300 "$TMP/admin.err" | tr '\n' ' ')"; falhas=$((falhas+1))
fi

# Sem banco não adianta mandar o resto.
if [ ! -s "$TMP/central.sqlite3" ]; then
  registrar "=== backup concluído com falha ==="; exit 1
fi

# ── 2. pacote ─────────────────────────────────────────────────────────────────
if ! tar czf "$TMP/pacote.tar.gz" \
      -C "$TMP" central.sqlite3 \
      -C "$CENTRAL_DIR" config/local.json central.env whatsapp \
      2>>"$LOG"; then
  registrar "❌ FALHOU o pacote."; registrar "=== backup concluído com falha ==="; exit 1
fi

# ── 3. cifra ──────────────────────────────────────────────────────────────────
SAIDA="$BASE/pacotes/central_$DATA.tar.gz.gpg"
if GNUPGHOME="$BASE/gnupg" gpg --batch --yes --quiet --trust-model always -e -r "$DEST_GPG" -o "$SAIDA" "$TMP/pacote.tar.gz" \
   && [ -s "$SAIDA" ]; then
  chmod 600 "$SAIDA"
  registrar "🔒 pacote cifrado: $(basename "$SAIDA") ($(du -h "$SAIDA" | cut -f1))"
else
  rm -f "$SAIDA"; registrar "❌ FALHOU a cifra do pacote."; registrar "=== backup concluído com falha ==="; exit 1
fi

# ── 4. Google Drive ───────────────────────────────────────────────────────────
if [ -f "$BASE/rclone/rclone.conf" ]; then
  if docker run --rm --network bridge --memory 256m --cpus 0.5 \
       -e RCLONE_CONFIG=/config/rclone.conf -e RCLONE_RETRIES=3 \
       -v "$BASE/rclone":/config -v "$BASE/pacotes":/pacotes:ro "$RCLONE_IMG" \
       copy "/pacotes/$(basename "$SAIDA")" "$REMOTO" --checksum >> "${LOG%.log}-rclone.log" 2>&1; then
    registrar "☁️  enviado ao Drive: central-backup/$(basename "$SAIDA")"
  else
    registrar "⚠️  envio ao Drive FALHOU — a cópia local continua válida."; falhas=$((falhas+1))
  fi
else
  registrar "🚧 Drive DESLIGADO: falta autorizar o Google Drive ($BASE/rclone/rclone.conf)."; falhas=$((falhas+1))
fi

APAG=$(find "$BASE/pacotes" -maxdepth 1 -name 'central_*.gpg' -mtime +$MANTER_DIAS -print -delete | wc -l)
[ "$APAG" -gt 0 ] && registrar "🧹 $APAG pacote(s) local(is) com mais de $MANTER_DIAS dias removido(s)."
registrar "=== backup concluído $([ $falhas -eq 0 ] && echo OK || echo "com $falhas pendência(s)") ==="
[ $falhas -eq 0 ]
