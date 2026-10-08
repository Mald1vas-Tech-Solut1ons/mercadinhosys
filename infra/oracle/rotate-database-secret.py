"""Rotação local na Oracle, com dump e rollback privado. Não imprime segredos."""
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/home/ubuntu/mercadinhosys').resolve()
ENV_FILE = ROOT / 'infra/oracle/.env.demo'
COMPOSE = ['sudo', 'docker', 'compose', '--project-name', 'oracle', '--env-file', str(ENV_FILE),
           '-f', str(ROOT / 'infra/oracle/compose.demo.yml'), '-f', str(ROOT / 'infra/oracle/compose.https.yml')]

def run(command, data=None, binary=False):
    result = subprocess.run(command, input=data, capture_output=True, text=not binary)
    if result.returncode:
        raise RuntimeError('Operação falhou; comando, stderr e ambiente omitidos')
    return result.stdout

def docker(*args, **kwargs):
    return run(['sudo', 'docker', *args], **kwargs)

def change_password(value):
    escaped = value.replace("'", "''")
    docker('exec', '-i', 'oracle-postgres-1', 'psql', '-U', 'mercadinho_user', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
           data=f"ALTER ROLE mercadinho_user PASSWORD '{escaped}';\n")

def healthy(timeout=180):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen('http://127.0.0.1:5000/api/health', timeout=5) as response:
                if response.status == 200 and json.load(response).get('status') == 'healthy':
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False

if not ENV_FILE.is_file() or ENV_FILE.resolve().parent != ROOT / 'infra/oracle':
    raise SystemExit('Arquivo de implantação não corresponde ao caminho verificado')
old_text = ENV_FILE.read_text()
matches = re.findall(r'^DB_PASSWORD=(.*)$', old_text, flags=re.MULTILINE)
if len(matches) != 1:
    raise SystemExit('DB_PASSWORD deve existir exatamente uma vez; conteúdo omitido')
old_password = matches[0].strip().strip('"\'')
metadata = json.loads(docker('inspect', 'oracle-postgres-1'))[0]
settings = dict(row.split('=', 1) for row in metadata['Config']['Env'] if '=' in row)
if settings.get('POSTGRES_PASSWORD') != old_password or settings.get('POSTGRES_USER') != 'mercadinho_user':
    raise SystemExit('Ambiente e container divergentes; nenhuma alteração realizada')
run(COMPOSE + ['config', '--quiet'])
if '--apply' not in sys.argv:
    print(json.dumps({'preflight': 'ok', 'target': 'oracle', 'apply_required': True}))
    raise SystemExit(0)

stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup_root = ROOT / 'security-backups' / f'credential-rotation-{stamp}'
backup_root.mkdir(parents=True, mode=0o700)
os.chmod(backup_root, 0o700)
snapshot = backup_root / 'deployment.env'
snapshot.write_text(old_text)
os.chmod(snapshot, 0o600)
dump = backup_root / 'mercadinhosys.dump'
dump.write_bytes(docker('exec', 'oracle-postgres-1', 'pg_dump', '-U', 'mercadinho_user', '-d', 'mercadinhosys', '-Fc', binary=True))
os.chmod(dump, 0o600)
if not dump.stat().st_size:
    raise SystemExit('Dump vazio; rotação não iniciada')

new_password = secrets.token_hex(32)
new_text = re.sub(r'^DB_PASSWORD=.*$', lambda _: f'DB_PASSWORD={new_password}', old_text, flags=re.MULTILINE)
try:
    ENV_FILE.write_text(new_text)
    os.chmod(ENV_FILE, 0o600)
    run(COMPOSE + ['config', '--quiet'])
    change_password(new_password)
    run(COMPOSE + ['up', '-d', '--no-deps', '--force-recreate', 'postgres', 'backend'])
    if not healthy():
        raise RuntimeError('Health não recuperou')
    print(json.dumps({'rotated': True, 'health': 'healthy', 'backup': str(backup_root)}))
except Exception:
    ENV_FILE.write_text(old_text)
    os.chmod(ENV_FILE, 0o600)
    rollback_ok = False
    try:
        change_password(old_password)
        run(COMPOSE + ['up', '-d', '--no-deps', '--force-recreate', 'postgres', 'backend'])
        rollback_ok = healthy()
    except Exception:
        pass
    print(json.dumps({'rotated': False, 'rollback_healthy': rollback_ok, 'backup': str(backup_root)}))
    raise SystemExit(1)
