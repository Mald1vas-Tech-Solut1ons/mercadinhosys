#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/mercadinhosys"
tar -xzf "$HOME/oracle-backend.tar.gz" -C "$HOME/mercadinhosys"
cd "$HOME/mercadinhosys/infra/oracle"
umask 077
if [ ! -f .env.demo ]; then
  printf 'DB_PASSWORD=%s\nSECRET_KEY=%s\nJWT_SECRET_KEY=%s\nCORS_ORIGINS=https://mercadinhosys.vercel.app\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env.demo
fi
sudo docker compose --env-file .env.demo -f compose.demo.yml config --quiet
sudo docker compose --env-file .env.demo -f compose.demo.yml build backend
sudo docker compose --env-file .env.demo -f compose.demo.yml up -d postgres redis
