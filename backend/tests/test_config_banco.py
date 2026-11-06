"""Banco de dados: UMA fonte (DATABASE_URL). Sem nuvem implícita, sem fallback calado em produção.

O config.py lê o ambiente no import, então cada caso roda num processo Python próprio.
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _uri(env_extra: dict) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items()
           if k not in ("DATABASE_URL", "AIVEN_DATABASE_URL", "DB_PRIMARY", "DATABASE_URL_TARGET", "POSTGRES_URL")}
    env.update(env_extra)
    return subprocess.run([sys.executable, "-c", "import config; print(config.Config.SQLALCHEMY_DATABASE_URI)"],
                          cwd=BACKEND, env=env, capture_output=True, text=True, timeout=60)


def test_producao_sem_database_url_nao_sobe():
    r = _uri({"FLASK_ENV": "production", "SECRET_KEY": "x", "JWT_SECRET_KEY": "y", "DATABASE_URL": ""})
    assert r.returncode != 0
    assert "DATABASE_URL" in r.stderr


def test_variaveis_de_nuvem_antigas_sao_ignoradas():
    r = _uri({"FLASK_ENV": "development", "DATABASE_URL": "",
              "AIVEN_DATABASE_URL": "postgresql://u:p@nuvem.example/db",
              "DB_PRIMARY": "postgresql://u:p@outro.example/db"})
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip().startswith("sqlite:///")


def test_database_url_e_a_fonte_e_normaliza_postgres():
    r = _uri({"FLASK_ENV": "development", "DATABASE_URL": "postgres://u:p@localhost:5432/db"})
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "postgresql://u:p@localhost:5432/db?sslmode=disable"


def test_postgres_da_rede_docker_nao_ganha_sslmode():
    r = _uri({"FLASK_ENV": "production", "SECRET_KEY": "x", "JWT_SECRET_KEY": "y",
              "DATABASE_URL": "postgresql://u:p@postgres:5432/mercadinhosys"})
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "postgresql://u:p@postgres:5432/mercadinhosys"
