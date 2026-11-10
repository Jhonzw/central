#!/usr/bin/env bash
# Vigia da Central, a cada 10 min (/etc/cron.d/central-vigia). Só avisa por e-mail.
#   backup externo sem rodar há mais de 26h, ou o último terminou com pendência.
set -uo pipefail
BASE=${ALERTAS_BASE:-/root/central-alertas}
exec 9>"$BASE/.vigia.lock"; flock -n 9 || exit 0
A="$BASE/enviar-alerta.sh"; agora=$(date +%s)
LOG_BACKUP=/var/log/central-backup.log

ult=$(ls -t /root/backups/central/pacotes/central_*.gpg 2>/dev/null | head -1)
fim=$(grep "backup concluído" "$LOG_BACKUP" 2>/dev/null | tail -1)
if [ -z "$ult" ] || [ $(( agora - $(stat -c %Y "$ult") )) -gt $((26 * 3600)) ]; then
  "$A" problema backup "backup NÃO rodou" "Nenhum backup novo há mais de 26h. Roda às 04:10 (/etc/cron.d/central-backup). Log: $LOG_BACKUP"
elif [[ "$fim" != *OK* ]]; then
  "$A" problema backup "backup incompleto" "$fim
$(grep -E '❌|⚠️|🚧' "$LOG_BACKUP" | tail -4)"
else
  "$A" resolvido backup "backup OK" "$fim"
fi
