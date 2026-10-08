"""Valida o Compose e um dump/restauro através do encaminhamento PostgreSQL."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

folder = Path(__file__).resolve().parent
suffix = secrets.token_hex(5)
network = 'db-split-check-' + suffix
server = 'db-split-server-' + suffix
client = 'db-split-client-' + suffix
image = 'db-split-client-check:' + suffix
password = secrets.token_hex(24)


def docker(*args, data=None):
    r = subprocess.run(['docker', *args], input=data, capture_output=True)
    if r.returncode:
        raise RuntimeError('Docker reprovou: ' + args[0])
    return r.stdout


created = []
try:
    with tempfile.TemporaryDirectory() as tmp:
        env = Path(tmp) / 'test.env'
        env.write_text('DB_PASSWORD=' + password + '\nSECRET_KEY=ci-only\nJWT_SECRET_KEY=ci-only\nCORS_ORIGINS=https://example.invalid\nDB_TUNNEL_HOST=' + server + '\n')
        env.chmod(0o600)
        config = json.loads(docker('compose', '--env-file', str(env), '-f', str(folder / 'compose.demo.yml'),
                                  '-f', str(folder / 'compose.db-split.yml'), 'config', '--format', 'json'))
        pg = config['services']['postgres']
        if pg.get('volumes') or pg.get('ports') or int(pg.get('mem_limit', 0)) != 48 * 1024 * 1024:
            raise RuntimeError('Forwarder montou volume/porta ou excedeu limite de memória')
        if '${PGHOST}' not in pg['command'][0] or '${PGPORT}' not in pg['command'][0]:
            raise RuntimeError('Compose consumiu as variáveis do comando antes do container')
        docker('build', '-f', str(folder / 'Dockerfile.db-forwarder'), '-t', image, str(folder))
        docker('network', 'create', network)
        docker('run', '-d', '--name', server, '--network', network, '--memory', '256m',
               '-e', 'POSTGRES_PASSWORD=' + password, '-e', 'POSTGRES_USER=mercadinho_user', 'postgres:15-alpine')
        created.append(server)
        deadline = time.monotonic() + 60
        while subprocess.run(['docker', 'exec', server, 'pg_isready', '-U', 'mercadinho_user'], capture_output=True).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError('PostgreSQL CI não ficou pronto')
            time.sleep(1)
        docker('run', '-d', '--name', client, '--network', network, '--memory', '48m',
               '-e', 'PGHOST=' + server, '-e', 'PGPORT=5432', '-e', 'PGPASSWORD=' + password, image)
        created.append(client)
        docker('exec', client, 'createdb', '-U', 'mercadinho_user', 'split_source')
        docker('exec', client, 'psql', '-U', 'mercadinho_user', '-d', 'split_source', '-v', 'ON_ERROR_STOP=1', '-c',
               "CREATE TABLE proof(id integer primary key, amount numeric(12,2)); INSERT INTO proof SELECT i,i*10.25 FROM generate_series(1,50) i")
        dump = docker('exec', client, 'pg_dump', '-U', 'mercadinho_user', '-d', 'split_source', '-Fc')
        docker('exec', client, 'createdb', '-U', 'mercadinho_user', 'split_restore')
        docker('exec', '-i', client, 'pg_restore', '-U', 'mercadinho_user', '-d', 'split_restore', '--exit-on-error', data=dump)
        # Outro cliente entra pela porta socat, reproduzindo a conexão da API.
        answer = docker('run', '--rm', '--network', network, '-e', 'PGHOST=' + client,
                        '-e', 'PGPASSWORD=' + password, '--entrypoint', 'psql', image,
                        '-U', 'mercadinho_user', '-d', 'split_restore', '-tAc', 'SELECT count(*),sum(amount) FROM proof').decode().strip()
        if answer != '50|13068.75':
            raise RuntimeError('Restauro/encaminhamento perdeu linhas ou precisão monetária')
        print('DB_SPLIT_CI_OK: Compose sem volume operacional; encaminhamento TCP e dump/restauro preservaram 50 linhas e valores Decimal.')
finally:
    for name in reversed(created):
        subprocess.run(['docker', 'rm', '-fv', name], capture_output=True)
    subprocess.run(['docker', 'network', 'rm', network], capture_output=True)
