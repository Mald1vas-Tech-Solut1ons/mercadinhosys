"""Clone seed data into an isolated PostgreSQL database and expose loopback only.

Run on the Oracle host. No payment/fiscal/mail/AI credentials are forwarded.
"""
import json
import secrets
import subprocess
from urllib.parse import quote

DB = 'audit_security_http_20261006'
CONTAINER = 'mercadinhosys-http-audit'
IMAGE = 'oracle-backend:security-20261006'

def docker(args, **kwargs):
    result = subprocess.run(['sudo', 'docker', *args], **kwargs)
    if result.returncode:
        raise SystemExit(f'Docker operation failed ({result.returncode}); arguments omitted')
    return result

pg = json.loads(docker(['inspect', 'oracle-postgres-1'], capture_output=True, text=True).stdout)[0]
settings = dict(item.split('=', 1) for item in pg['Config']['Env'] if '=' in item)
network = next(iter(pg['NetworkSettings']['Networks']))
exists = docker(['exec', 'oracle-postgres-1', 'psql', '-U', 'mercadinho_user', '-d', 'postgres',
                 '-tAc', f"SELECT 1 FROM pg_database WHERE datname='{DB}'"], capture_output=True, text=True).stdout.strip()
if exists:
    raise SystemExit('Audit HTTP database already exists; refusing to overwrite it')
docker(['exec', 'oracle-postgres-1', 'createdb', '-U', 'mercadinho_user', DB])
# Dump is retained only in memory. Source is read-only; restore target is fixed.
dump = docker(['exec', 'oracle-postgres-1', 'pg_dump', '-U', 'mercadinho_user',
               '--no-owner', '--no-acl', 'mercadinhosys'], capture_output=True).stdout
docker(['exec', '-i', 'oracle-postgres-1', 'psql', '-U', 'mercadinho_user', '-d', DB,
        '-v', 'ON_ERROR_STOP=1'], input=dump, stdout=subprocess.DEVNULL)
env = {
    'DATABASE_URL': f'postgresql://mercadinho_user:{quote(settings["POSTGRES_PASSWORD"], safe="")}@postgres:5432/{DB}?sslmode=disable',
    'FLASK_ENV': 'production', 'FLASK_DEBUG': '0', 'SKIP_DB_SETUP': 'true',
    'SKIP_SCHEMA_SYNC': 'true', 'SECRET_KEY': secrets.token_hex(32),
    'JWT_SECRET_KEY': secrets.token_hex(32), 'DB_POOL_SIZE': '2', 'DB_MAX_OVERFLOW': '1',
    'REDIS_URL': 'redis://redis:6379/3', 'RATELIMIT_STORAGE_URI': 'redis://redis:6379/3',
    'SYNC_ENABLED': 'false', 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1',
    'CORS_ORIGINS': 'http://localhost:5180', 'SENTRY_DSN': '',
}
base = ['run', '--rm', '--network', network, '--memory', '256m',
        '-v', '/home/ubuntu/mercadinhosys-audit/backend:/app', '-w', '/app']
for key, value in env.items():
    base += ['-e', f'{key}={value}']
migration = '''
from app import create_app, db
from alembic.migration import MigrationContext
from alembic.operations import Operations
import importlib.util
app = create_app('production')
with app.app_context():
    with db.engine.begin() as connection:
        spec = importlib.util.spec_from_file_location('audit_migration', 'migrations/versions/f4c6a8b0d2e4_efi_webhook_idempotency.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
print('Isolated restored seed migration passed')
'''
docker(base + [IMAGE, 'python', '-c', migration])
docker(base + ['-d', '--name', CONTAINER, '-p', '127.0.0.1:5001:5000', IMAGE,
               'gunicorn', 'run:app', '--bind', '0.0.0.0:5000', '--workers', '1',
               '--threads', '4', '--timeout', '120', '--worker-tmp-dir', '/dev/shm'],
       stdout=subprocess.DEVNULL)
print(json.dumps({'database': DB, 'container': CONTAINER, 'loopback_port': 5001,
                  'restored_seed': True, 'external_credentials_forwarded': False}))
