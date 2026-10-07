"""Executa a nova aplicação em container separado e banco descartável na Oracle.

Nunca imprime variáveis de ambiente nem modifica o banco mercadinhosys.
Execute no host após extrair o pacote de auditoria em /home/ubuntu/mercadinhosys-audit.
"""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

DB = 'audit_security_20261006'
ROOT = Path('/home/ubuntu/mercadinhosys-audit/backend')
IMAGE = 'oracle-backend:security-20261006' if '--new-image' in sys.argv else 'oracle-backend:latest'
def run(args, **kw):
    result = subprocess.run(['sudo', 'docker', *args], **kw)
    if result.returncode:
        # CalledProcessError exibiria todo o comando, inclusive variáveis secretas.
        raise SystemExit(f'Operação Docker falhou (exit={result.returncode}); comando omitido')
    return result
env = json.loads(run(['inspect', 'oracle-backend-1'], capture_output=True, text=True).stdout)[0]['Config']['Env']
settings = dict(row.split('=', 1) for row in env if '=' in row)
pg = json.loads(run(['inspect', 'oracle-postgres-1'], capture_output=True, text=True).stdout)[0]
pg_env = dict(row.split('=', 1) for row in pg['Config']['Env'] if '=' in row)
password = pg_env['POSTGRES_PASSWORD']
network = next(iter(pg['NetworkSettings']['Networks']))
exists = run(['exec', 'oracle-postgres-1', 'psql', '-U', 'mercadinho_user', '-d', 'postgres', '-tAc', f"SELECT 1 FROM pg_database WHERE datname='{DB}'"], capture_output=True, text=True).stdout.strip()
if not exists:
    run(['exec', 'oracle-postgres-1', 'createdb', '-U', 'mercadinho_user', DB])
audit_env = {'AUDIT_DATABASE_URL': f'postgresql://mercadinho_user:{quote(password, safe="")}@postgres:5432/{DB}',
             'AUDIT_REDIS_URL': 'redis://redis:6379/3', 'DATABASE_URL': f'postgresql://mercadinho_user:{quote(password, safe="")}@postgres:5432/{DB}',
             'SKIP_SCHEMA_SYNC': 'true', 'SKIP_DB_SETUP': 'true', 'SENTRY_DSN': '', 'SYNC_ENABLED': 'false',
             'DB_POOL_SIZE': '2', 'DB_MAX_OVERFLOW': '1', 'PYTHONPATH': '/app', 'OPENBLAS_NUM_THREADS': '1'}
for key in ('AUDIT_DATABASE_URL', 'DATABASE_URL'):
    audit_env[key] += '?sslmode=disable'
command = ['run', '--rm', '--name', 'mercadinhosys-security-audit', '--network', network, '--memory', '256m',
           '-v', f'{ROOT}:/app', '-w', '/app']
for key, value in audit_env.items():
    command.extend(['-e', f'{key}={value}'])
if '--full-regression' in sys.argv:
    # Sem AUDIT_DATABASE_URL: a suíte completa usa SQLite em memória. Os locks
    # são verificados separadamente com --postgres-critical no banco isolado.
    command.extend(['-e', 'AUDIT_DATABASE_URL=sqlite:///:memory:', IMAGE, 'python', '-m', 'pytest',
                    'tests', '-q', '--disable-warnings', '--maxfail=1'])
elif '--postgres-critical' in sys.argv:
    command.extend([IMAGE, 'python', '-m', 'pytest', 'tests/test_postgres_checkout_concurrency.py',
                    'tests/test_security_audit.py', '-k',
                    'parallel or earliest_lots or sfa or payment_notification or payment_event_migration or private_document or cancellation_multiple',
                    '-q', '--disable-warnings', '--maxfail=1'])
elif '--benchmark' in sys.argv or '--benchmark-seed' in sys.argv:
    seed_size = '--benchmark-seed' in sys.argv
    command.extend([IMAGE, 'python', 'scripts/benchmark_security.py', '--output',
                    '/app/audit-load-seed-output.json' if seed_size else '/app/audit-load-output.json',
                    '--products', '101' if seed_size else '5000', '--requests', '100', '--concurrency', '1,4,8'])
elif '--final-regression' in sys.argv:
    command.extend([IMAGE, 'python', '-m', 'pytest', 'tests/test_security_audit.py', '-k',
                    'payment_notification or payment_event_migration or logo_rejects or logo_accepts or xml_rejects or excel_rejects or raw_product_helper or employee_helper or private_document or cancellation_multiple', '-q', '--disable-warnings', '--maxfail=1'])
else:
    command.extend([IMAGE, 'python', '-m', 'pytest', 'tests/test_postgres_checkout_concurrency.py', 'tests/test_security_audit.py', '-q', '--disable-warnings', '--maxfail=1'])
try:
    run(command)
finally:
    # O nome constante começa com audit_security_; nenhuma operação no banco principal.
    run(['exec', 'oracle-postgres-1', 'dropdb', '-U', 'mercadinho_user', '--if-exists', DB])
