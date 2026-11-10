# Backup

A Central tem duas camadas de cópia.

| Camada | Onde | Quando | Guarda |
|---|---|---|---|
| Interna | `dados/backup/central-AAAA-MM-DD.sqlite3` | na subida e a cada 24 h (`src/manutencao.ts`) | 7 dias |
| Externa | Google Drive, pasta `central-backup/` | 04:10, cron do servidor (`deploy/backup-externo.sh`) | 14 dias no servidor; no Drive, sem apagar |

A interna protege contra erro no banco. A externa protege contra perder a VPS.

## O que vai no pacote externo

- `central.sqlite3`: cópia nova feita com `VACUUM INTO` (`node src/admin.ts backup`), conferida com `PRAGMA integrity_check`.
- `config/local.json` e `central.env`.
- `whatsapp/`: a sessão, que já é cifrada com a chave do WhatsApp.

O pacote é cifrado com GPG para `backup@central.local`. O servidor tem só a chave
pública: quem lê o servidor não lê o backup. A chave privada fica fora dele.

**A chave do cofre não vai no pacote** (`segredos/chave`, `segredos/whatsapp-chave`).
Sem ela, o banco restaurado abre tudo menos os segredos (senha do e-mail, TOTP,
sessão do WhatsApp). Guarde uma cópia dela em lugar separado do backup.

## Instalar no servidor

```sh
install -m 700 deploy/backup-externo.sh /root/central-backup/backup-diario.sh
mkdir -p /root/backups/central/{gnupg,rclone,pacotes} && chmod 700 /root/backups/central/*
GNUPGHOME=/root/backups/central/gnupg gpg --import central-backup-publica.asc
# rclone.conf com o remoto "centraldrive" (type=drive, scope=drive.file),
# autorizado num computador com navegador: rclone config create centraldrive drive scope=drive.file
install -m 600 rclone.conf /root/backups/central/rclone/rclone.conf
echo '10 4 * * * root /root/central-backup/backup-diario.sh' > /etc/cron.d/central-backup
```

Aviso por e-mail (opcional): `deploy/enviar-alerta.sh` e `deploy/vigia-central.sh`
em `/root/central-alertas/`, com `alertas.env` (`SMTP_URL SMTP_USER SMTP_PASS ALERTA_PARA`, 600)
e cron a cada 10 min. Avisa se não houver backup novo há 26 h ou se o último terminou com pendência.

Log: `/var/log/central-backup.log` (e `central-backup-rclone.log`).

## Restaurar

```sh
gpg -d central_AAAAMMDD_HHMMSS.tar.gz.gpg | tar xzf -
# → central.sqlite3, config/local.json, central.env, whatsapp/
```

1. Pare só o contêiner `central` (e `central-whatsapp`, se for restaurar a sessão).
2. Coloque `central.sqlite3` em `/opt/central/dados/` (apague `-wal` e `-shm` antigos), dono 10777, modo 600.
3. Ponha a chave do cofre em `/opt/central/segredos/chave`.
4. Suba de novo com o compose de sempre.

Nunca restaure um banco com o serviço escrevendo nele.
