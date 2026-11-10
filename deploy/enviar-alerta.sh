#!/usr/bin/env bash
# Alerta por e-mail da Central. Separado dos outros projetos do servidor:
# estado, log e assunto próprios. As credenciais SMTP ficam em alertas.env (600, fora do git).
#   enviar-alerta.sh problema  <chave> "<assunto>" "<texto>"  → avisa (no máx. 1x a cada 6h por chave)
#   enviar-alerta.sh resolvido <chave> "<assunto>" "<texto>"  → só se havia problema aberto
#   enviar-alerta.sh teste
set -uo pipefail
BASE=${ALERTAS_BASE:-/root/central-alertas}; ESTADO="$BASE/estado"; REPETIR_SEG=$((6 * 3600))
LOG=${ALERTAS_LOG:-/var/log/central-alertas.log}
# alertas.env: SMTP_URL SMTP_USER SMTP_PASS ALERTA_PARA
# shellcheck disable=SC1091
source "$BASE/alertas.env"
mkdir -p "$ESTADO"
registrar() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
mandar() {
  local msg; msg=$(mktemp)
  {
    echo "From: Central <$SMTP_USER>"; echo "To: $ALERTA_PARA"
    echo "Subject: =?UTF-8?B?$(printf '%s' "$1" | base64 -w0)?="; echo "Date: $(LC_ALL=C date -R)"
    echo "MIME-Version: 1.0"; echo "Content-Type: text/plain; charset=UTF-8"; echo "Content-Transfer-Encoding: 8bit"; echo
    printf '%s\n\n' "$2"; echo "—"; echo "Central (Contabo) · $(date '+%d/%m/%Y %H:%M')"
    echo "Alerta automático: o mesmo problema só é repetido a cada 6h; quando resolver, chega um e-mail de 'normalizou'."
  } > "$msg"
  if curl -sS --max-time 30 --ssl-reqd --url "$SMTP_URL" --user "$SMTP_USER:$SMTP_PASS" \
       --mail-from "$SMTP_USER" --mail-rcpt "$ALERTA_PARA" --upload-file "$msg" 2>>"$LOG"; then
    registrar "📧 enviado: $1"; rm -f "$msg"; return 0
  fi
  registrar "❌ falhou o envio do e-mail: $1"; rm -f "$msg"; return 1
}
acao="${1:-}"; chave="${2:-}"; chave="${chave//[^a-zA-Z0-9_.-]/_}"
case "$acao" in
  problema)  arq="$ESTADO/$chave"
             if [ -f "$arq" ] && [ $(( $(date +%s) - $(stat -c %Y "$arq") )) -lt $REPETIR_SEG ]; then exit 0; fi
             mandar "🔴 Central: $3" "$4" && touch "$arq" ;;
  resolvido) arq="$ESTADO/$chave"; [ -f "$arq" ] || exit 0
             mandar "🟢 Central: $3" "$4" && rm -f "$arq" ;;
  teste)     mandar "✅ Central: alertas por e-mail configurados" "Teste. A partir de agora o servidor avisa por aqui se o backup da Central falhar ou não rodar." ;;
  *) echo "uso: $0 problema|resolvido|teste <chave> <assunto> <texto>"; exit 2 ;;
esac
