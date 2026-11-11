#!/bin/bash
# Prepara o CouchDB do LiveSync, uma vez (pode rodar de novo sem estragar nada):
#   - bancos de sistema;
#   - um banco por vault ("vault" = principal, "cofre" = credenciais, cifrado no aparelho);
#   - um usuário comum para o Obsidian, dono só desses bancos (não é o administrador);
#   - o leitor "central", membro só do "vault" (a senha vai para segredos/notas/senha).
# As senhas ficam em arquivos 600 no servidor e nunca aparecem na tela.
set -euo pipefail

SYNC_DIR=${SYNC_DIR:-/opt/central/sync}
URL=http://127.0.0.1:5984
BANCOS=${BANCOS:-vault cofre}
USUARIO=${USUARIO:-obsidian}
# Leitor da Central: membro só do banco "vault" (nunca do "cofre"). A Central só faz GET/_changes.
LEITOR=${LEITOR:-central}
LEITOR_SENHA_ARQ=${LEITOR_SENHA_ARQ:-/opt/central/segredos/notas/senha}
CENTRAL_UID=${CENTRAL_UID:-10777}

# shellcheck disable=SC1091
set -a; source "$SYNC_DIR/couchdb.env"; set +a
adm() { curl -fsS -u "$COUCHDB_USER:$COUCHDB_PASSWORD" -H 'Content-Type: application/json' "$@"; }
existe() { [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$COUCHDB_USER:$COUCHDB_PASSWORD" "$1")" = 200 ]; }

for i in $(seq 1 30); do curl -fs "$URL/_up" -u "$COUCHDB_USER:$COUCHDB_PASSWORD" >/dev/null && break; sleep 1; done

# Cria o banco; 412 quer dizer "já existe" (o single_node cria os de sistema sozinho).
criar() {
  local c; c=$(curl -s -o /dev/null -w '%{http_code}' -u "$COUCHDB_USER:$COUCHDB_PASSWORD" -X PUT "$URL/$1")
  case "$c" in 201|202|412) ;; *) echo "não criou o banco $1: HTTP $c" >&2; return 1 ;; esac
}

for b in _users _replicator; do criar "$b"; done

SENHA_ARQ="$SYNC_DIR/obsidian-senha"
if [ ! -s "$SENHA_ARQ" ]; then (umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$SENHA_ARQ"); fi
SENHA=$(cat "$SENHA_ARQ")
if ! existe "$URL/_users/org.couchdb.user:$USUARIO"; then
  adm -X PUT "$URL/_users/org.couchdb.user:$USUARIO" \
    -d "{\"name\":\"$USUARIO\",\"password\":\"$SENHA\",\"roles\":[],\"type\":\"user\"}" >/dev/null
fi

mkdir -p "$(dirname "$LEITOR_SENHA_ARQ")"
if [ ! -s "$LEITOR_SENHA_ARQ" ]; then (umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$LEITOR_SENHA_ARQ"); fi
chown -R "$CENTRAL_UID:$CENTRAL_UID" "$(dirname "$LEITOR_SENHA_ARQ")"; chmod 700 "$(dirname "$LEITOR_SENHA_ARQ")"; chmod 600 "$LEITOR_SENHA_ARQ"
LEITOR_SENHA=$(cat "$LEITOR_SENHA_ARQ")
if ! existe "$URL/_users/org.couchdb.user:$LEITOR"; then
  adm -X PUT "$URL/_users/org.couchdb.user:$LEITOR" \
    -d "{\"name\":\"$LEITOR\",\"password\":\"$LEITOR_SENHA\",\"roles\":[],\"type\":\"user\"}" >/dev/null
fi

for b in $BANCOS; do
  criar "$b"
  membros="\"$USUARIO\""
  [ "$b" = vault ] && membros="$membros,\"$LEITOR\""
  adm -X PUT "$URL/$b/_security" \
    -d "{\"admins\":{\"names\":[\"$USUARIO\"],\"roles\":[]},\"members\":{\"names\":[$membros],\"roles\":[]}}" >/dev/null
done

echo "bancos: $(adm "$URL/_all_dbs")"
echo "usuário do Obsidian: $USUARIO (senha em $SENHA_ARQ)"
echo "sem login: HTTP $(curl -s -o /dev/null -w '%{http_code}' "$URL/vault")"
echo "com o usuário do Obsidian: HTTP $(curl -s -o /dev/null -w '%{http_code}' -u "$USUARIO:$SENHA" "$URL/vault")"
echo "leitor da Central no vault: HTTP $(curl -s -o /dev/null -w '%{http_code}' -u "$LEITOR:$LEITOR_SENHA" "$URL/vault")"
echo "leitor da Central no cofre (tem que ser 403): HTTP $(curl -s -o /dev/null -w '%{http_code}' -u "$LEITOR:$LEITOR_SENHA" "$URL/cofre")"
