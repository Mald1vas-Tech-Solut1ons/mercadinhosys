#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/mercadinhosys/infra/oracle
umask 077
if [ ! -f .admin.env ]; then
  printf 'SEED_SUPERADMIN_PASSWORD=%s\n' "$(openssl rand -hex 16)" > .admin.env
fi
. ./.admin.env
sudo docker compose --env-file .env.demo -f compose.demo.yml run --rm -T -e SEED_SUPERADMIN_PASSWORD="$SEED_SUPERADMIN_PASSWORD" backend python seed_simulation_master.py --months 4 > /home/ubuntu/seed-oracle.log 2>&1
# Seed catches exceptions without propagating an exit code: verify its actual log.
if grep -q 'Traceback (most recent call last)' /home/ubuntu/seed-oracle.log; then
  echo 'SEED_FAILED: inspect /home/ubuntu/seed-oracle.log'
  exit 1
fi
sudo docker compose --env-file .env.demo -f compose.demo.yml up -d backend
sudo docker compose --env-file .env.demo -f compose.demo.yml -f compose.https.yml up -d caddy
sudo docker compose --env-file .env.demo -f compose.demo.yml exec -T postgres psql -U mercadinho_user -d mercadinhosys -c 'SELECT (SELECT count(*) FROM estabelecimentos) AS estabelecimentos, (SELECT count(*) FROM funcionarios) AS funcionarios, (SELECT count(*) FROM produtos) AS produtos, (SELECT count(*) FROM vendas) AS vendas;'
echo 'APP_STARTED: validate health and login before publishing frontend.'
