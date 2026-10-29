#!/usr/bin/env bash
set -euo pipefail
umask 077
directory=/home/ubuntu/mercadinhosys/database-backups
mkdir -p "$directory"
destination="$directory/mercadinhosys-$(date -u +%Y%m%dT%H%M%SZ).dump"
sudo docker exec oracle-postgres-1 pg_dump -U mercadinho_user -d mercadinhosys --format=custom > "$destination.partial"
test -s "$destination.partial"
mv "$destination.partial" "$destination"
find "$directory" -maxdepth 1 -type f -name 'mercadinhosys-*.dump' -mtime +7 -delete
echo "BACKUP_OK: $destination"

# Cópia fora da VM: sem ela, perder o disco/instância perde todos os dados das lojas.
# Configure em /home/ubuntu/mercadinhosys/backup-remoto.env (fora do git):
#   BACKUP_REMOTE=meu-remoto:bucket/mercadinhosys      (destino do rclone: OCI Object Storage, B2, S3, Drive…)
#   BACKUP_REMOTE_DIAS=30                             (opcional: quantos dias manter lá)
# e rode `rclone config` uma vez com o nome do remoto.
remote_env=/home/ubuntu/mercadinhosys/backup-remoto.env
if [[ -f "$remote_env" ]]; then
    # shellcheck disable=SC1090
    source "$remote_env"
fi
if [[ -z "${BACKUP_REMOTE:-}" ]]; then
    echo "AVISO_BACKUP_EXTERNO: nao configurado ($remote_env). O backup existe so nesta VM." >&2
    exit 0
fi
command -v rclone >/dev/null || { echo "ERRO_BACKUP_EXTERNO: rclone nao instalado" >&2; exit 1; }
rclone copy "$destination" "$BACKUP_REMOTE" --immutable
remote_file="$BACKUP_REMOTE/$(basename "$destination")"
local_size=$(stat -c %s "$destination")
remote_size=$(rclone size "$remote_file" --json | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
[[ "$remote_size" == "$local_size" ]] || { echo "ERRO_BACKUP_EXTERNO: tamanho diverge ($local_size x ${remote_size:-?})" >&2; exit 1; }
rclone delete "$BACKUP_REMOTE" --min-age "${BACKUP_REMOTE_DIAS:-30}d" --include 'mercadinhosys-*.dump'
echo "BACKUP_EXTERNO_OK: $remote_file"
