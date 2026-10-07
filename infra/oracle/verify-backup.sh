#!/usr/bin/env bash
set -euo pipefail
backup=$(find /home/ubuntu/mercadinhosys/database-backups -maxdepth 1 -name 'mercadinhosys-*.dump' -type f | sort | tail -1)
test -n "$backup"
database="mercadinhosys_restore_check_$(date +%s)"
sudo docker exec oracle-postgres-1 createdb -U mercadinho_user "$database"
trap 'sudo docker exec oracle-postgres-1 dropdb -U mercadinho_user "$database"' EXIT
sudo docker exec -i oracle-postgres-1 pg_restore --exit-on-error --no-owner -U mercadinho_user -d "$database" < "$backup"
live=$(sudo docker exec oracle-postgres-1 psql -U mercadinho_user -d mercadinhosys -tAc 'select count(*) from vendas')
restored=$(sudo docker exec oracle-postgres-1 psql -U mercadinho_user -d "$database" -tAc 'select count(*) from vendas')
test "$live" = "$restored"
echo "RESTORE_OK: $restored sales restored into a temporary database; source database untouched."
