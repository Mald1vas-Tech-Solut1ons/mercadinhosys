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
