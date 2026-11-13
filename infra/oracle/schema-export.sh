#!/usr/bin/env bash
# Retrato SÓ DO SCHEMA da produção, para o ensaio de migração (migration-rehearsal.yml).
# Somente leitura, sem nenhum dado de cliente: pg_dump --schema-only + a revisão do Alembic.
#
# Uso direto (operador):   ssh ubuntu@VM /home/ubuntu/mercadinhosys/infra/oracle/schema-export.sh > snapshot.sql
# Uso pelo GitHub Actions: chave SSH dedicada, presa a ESTE comando em ~/.ssh/authorized_keys:
#   command="/home/ubuntu/mercadinhosys/infra/oracle/schema-export.sh",restrict ssh-ed25519 AAAA... gha-schema-ensaio
# Com `command=` + `restrict`, quem tiver a chave só consegue rodar este script (nada de shell, túnel ou scp).
set -euo pipefail
umask 077
PG=oracle-postgres-1
USER_DB=mercadinho_user
DB=mercadinhosys

revision=$(sudo -n docker exec "$PG" psql -U "$USER_DB" -d "$DB" -tAc 'SELECT version_num FROM alembic_version' | paste -sd, -)
# Mais de uma linha (head dividido) vira "a,b" e o ensaio recusa: melhor parar do que ensaiar errado.
echo "-- SNAPSHOT_TAKEN_AT: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "-- ALEMBIC_VERSION: ${revision}"
sudo -n docker exec "$PG" pg_dump -U "$USER_DB" -d "$DB" --schema-only --no-owner --no-acl
