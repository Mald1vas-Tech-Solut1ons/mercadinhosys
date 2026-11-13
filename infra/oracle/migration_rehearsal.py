"""Ensaio da migração no GitHub Actions: schema (só schema) da produção + `flask db upgrade`.

Roda no runner, contra um PostgreSQL descartável. Nunca recebe dados de cliente: o retrato é
um `pg_dump --schema-only` (veja schema-export.sh) e qualquer linha de dados nele aborta o ensaio.

    python migration_rehearsal.py --image IMG --snapshot snapshot.sql --versions backend/migrations/versions \
        --sha SHA40 --image-digest sha256:... --out rehearsal.json

Prova: o schema carrega; a(s) migração(ões) pendente(s) sobem até o head; a API da própria imagem
sobe e responde saudável com o banco migrado; e, quando há migração, se `flask db downgrade`
devolve o schema idêntico ao de antes (reversível) — o release.py só faz downgrade automático
nesse caso.
"""
import argparse
from datetime import datetime, timezone
import difflib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

import release_plan

PG_IMAGE = 'postgres:15-alpine'   # mesma imagem do compose de produção
_HEADER_TIME = re.compile(r'^-- SNAPSHOT_TAKEN_AT: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s*$', re.MULTILINE)
_HEADER_REV = re.compile(r'^-- ALEMBIC_VERSION: ([0-9A-Za-z_]{1,40})\s*$', re.MULTILINE)
# pg_dump --schema-only não emite nada disso; se aparecer, o arquivo não é só schema.
_DATA_LINE = re.compile(r'^(COPY\s+\S+.*\s+FROM\s+stdin;|INSERT\s+INTO\s|\\\.$)', re.MULTILINE | re.IGNORECASE)
MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024


class RehearsalFailed(Exception):
    pass


def parse_snapshot(text):
    """(quando foi tirado, revisão do alembic) do cabeçalho do retrato."""
    taken, revision = _HEADER_TIME.search(text), _HEADER_REV.search(text)
    if not taken or not revision:
        raise RehearsalFailed('Retrato sem cabeçalho SNAPSHOT_TAKEN_AT/ALEMBIC_VERSION válido')
    return taken.group(1), revision.group(1)


def assert_schema_only(text):
    if len(text.encode('utf-8')) > MAX_SNAPSHOT_BYTES:
        raise RehearsalFailed('Retrato grande demais para ser só schema')
    match = _DATA_LINE.search(text)
    if match:
        raise RehearsalFailed('O retrato contém dados (' + match.group(0)[:20].strip() + '...); ensaio abortado')


def normalize_schema(text):
    """Remove o que muda a cada dump sem mudar o schema (comentários, tokens de \\restrict)."""
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('--') or stripped.startswith('\\restrict') \
                or stripped.startswith('\\unrestrict'):
            continue
        lines.append(line.rstrip())
    return '\n'.join(lines)


def schema_diff(before, after, limit=20):
    diff = [line for line in difflib.unified_diff(before.splitlines(), after.splitlines(), lineterm='', n=0)
            if not line.startswith(('---', '+++', '@@'))]
    return diff[:limit]


class Rehearsal:
    """As quatro primitivas (psql/dump/flask/boot_health) são o único contato com Docker."""

    def __init__(self, image, sha, image_digest, snapshot, migrations, db_host='127.0.0.1', db_port=5432,
                 db_user='postgres', db_password='', schema_source=release_plan.SCHEMA_SOURCE_PRODUCTION,
                 log=print):
        self.image, self.sha, self.image_digest = image, sha, image_digest
        self.snapshot, self.migrations = snapshot, migrations
        self.db_host, self.db_port, self.db_user, self.db_password = db_host, db_port, db_user, db_password
        self.schema_source, self.log = schema_source, log
        self.database = 'rehearsal_' + sha[:12]
        self._secret_key, self._jwt_key = secrets.token_hex(32), secrets.token_hex(32)

    # ---- primitivas -----------------------------------------------------------------
    def _docker(self, *args, data=None, timeout=900):
        result = subprocess.run(['docker', *args], input=data, capture_output=True, timeout=timeout)
        if result.returncode:
            tail = (result.stderr or result.stdout).decode(errors='replace').strip().splitlines()[-8:]
            raise RehearsalFailed('docker ' + args[0] + ' falhou: ' + ' | '.join(tail)[:900])
        return result.stdout.decode(errors='replace')

    def psql(self, database, sql=None, data=None):
        command = ['run', '--rm', '-i', '--network', 'host', '-e', 'PGPASSWORD=' + self.db_password, PG_IMAGE,
                   'psql', '-h', self.db_host, '-p', str(self.db_port), '-U', self.db_user, '-d', database,
                   '-v', 'ON_ERROR_STOP=1', '-tA']
        if sql is not None:
            command += ['-c', sql]
        else:
            command += ['--single-transaction', '-f', '-']
        return self._docker(*command, data=data.encode() if data is not None else None)

    def dump(self, database):
        return self._docker('run', '--rm', '--network', 'host', '-e', 'PGPASSWORD=' + self.db_password, PG_IMAGE,
                            'pg_dump', '-h', self.db_host, '-p', str(self.db_port), '-U', self.db_user,
                            '-d', database, '--schema-only', '--no-owner', '--no-acl')

    def _env_file(self):
        url = f'postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.database}'
        settings = {'DATABASE_URL': url, 'AUDIT_DATABASE_URL': url, 'FLASK_APP': 'run:app',
                    'FLASK_ENV': 'production', 'FLASK_DEBUG': '0', 'SKIP_DB_SETUP': 'true',
                    'SKIP_SCHEMA_SYNC': 'true', 'SECRET_KEY': self._secret_key, 'JWT_SECRET_KEY': self._jwt_key,
                    'DB_POOL_SIZE': '2', 'DB_MAX_OVERFLOW': '1', 'REDIS_URL': '', 'AUDIT_REDIS_URL': '',
                    'SENTRY_DSN': '', 'CORS_ORIGINS': 'https://mercadinhosys.vercel.app'}
        handle, path = tempfile.mkstemp(prefix='rehearsal-', suffix='.env')
        with os.fdopen(handle, 'w') as out:
            out.write(''.join(f'{key}={value}\n' for key, value in settings.items()))
        return path

    def flask(self, *args):
        env_file = self._env_file()
        try:
            return self._docker('run', '--rm', '--network', 'host', '--env-file', env_file, self.image,
                                'flask', *args)
        finally:
            os.unlink(env_file)

    def boot_health(self, port=5055, deadline=180):
        env_file, name = self._env_file(), 'rehearsal-api-' + self.sha[:12]
        try:
            self._docker('run', '-d', '--name', name, '--network', 'host', '--env-file', env_file, self.image,
                         'gunicorn', 'run:app', '--bind', f'127.0.0.1:{port}', '--workers', '1', '--threads', '2',
                         '--timeout', '120')
            end, last = time.monotonic() + deadline, 'sem resposta'
            while time.monotonic() < end:
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=10) as response:
                        health = json.load(response)
                    if health.get('database', {}).get('status') == 'connected':
                        return {'status': health.get('status'), 'database': 'connected'}
                    last = 'banco não conectado'
                except urllib.error.HTTPError as error:
                    last = f'HTTP {error.code}'
                except Exception as error:  # a API ainda está subindo
                    last = type(error).__name__
                time.sleep(3)
            tail = subprocess.run(['docker', 'logs', '--tail', '25', name], capture_output=True)
            self.log((tail.stdout + tail.stderr).decode(errors='replace'))  # banco descartável, sem dados reais
            raise RehearsalFailed('API da imagem não ficou saudável com o banco migrado: ' + last)
        finally:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
            os.unlink(env_file)

    # ---- lógica ---------------------------------------------------------------------
    def revision(self):
        rows = [row for row in self.psql(self.database, 'SELECT version_num FROM alembic_version').split() if row]
        if len(rows) != 1:
            raise RehearsalFailed(f'alembic_version deveria ter 1 linha; tem {len(rows)}')
        return rows[0]

    def run(self):
        started = time.monotonic()
        taken_at, from_revision = parse_snapshot(self.snapshot)
        assert_schema_only(self.snapshot)
        head = self.migrations['head']
        pending = release_plan.pending_revisions(self.migrations, from_revision) if from_revision != head else []
        result = {'ok': False, 'sha': self.sha, 'release': self.sha[:12], 'image_digest': self.image_digest,
                  'schema_source': self.schema_source, 'snapshot_taken_at': taken_at,
                  'from_revision': from_revision, 'head_revision': head, 'pending': pending,
                  'reversible': None, 'reversible_reason': None, 'reupgrade_ok': None}
        try:
            self.psql('postgres', f'CREATE DATABASE {self.database}')
            self.log(f'Carregando schema da produção (revisão {from_revision}) em banco descartável')
            self.psql(self.database, data=self.snapshot)
            self.psql(self.database, f"DELETE FROM alembic_version; INSERT INTO alembic_version VALUES ('{from_revision}')")
            if self.revision() != from_revision:
                raise RehearsalFailed('Não foi possível posicionar o alembic_version do ensaio')
            before = normalize_schema(self.dump(self.database))
            if pending:
                self.log('Aplicando: ' + ', '.join(pending))
                self.flask('db', 'upgrade')
                if self.revision() != head:
                    raise RehearsalFailed(f'Upgrade terminou em {self.revision()} e não no head {head}')
            result['health'] = self.boot_health()
            if pending:
                result['reversible'], result['reversible_reason'] = self._try_downgrade(from_revision, before)
                if result['reversible_reason'] != 'downgrade-falhou':
                    self.flask('db', 'upgrade')
                    result['reupgrade_ok'] = self.revision() == head
                    if not result['reupgrade_ok']:
                        raise RehearsalFailed('Reaplicar a migração depois do downgrade não chegou ao head')
            result['ok'] = True
        except (RehearsalFailed, release_plan.ReleaseRefused) as error:
            result['error'] = str(error)[:900]
        finally:
            try:
                self.psql('postgres', f'DROP DATABASE IF EXISTS {self.database} WITH (FORCE)')
            except RehearsalFailed:
                pass
        result['duration_s'] = round(time.monotonic() - started, 1)
        result['finished_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        return result

    def _try_downgrade(self, from_revision, before):
        """Reversível = o downgrade roda E devolve exatamente o schema anterior."""
        try:
            self.log('Testando reversibilidade (downgrade para ' + from_revision + ')')
            self.flask('db', 'downgrade', from_revision)
            if self.revision() != from_revision:
                return False, 'revisao-diferente'
            after = normalize_schema(self.dump(self.database))
        except RehearsalFailed:
            return False, 'downgrade-falhou'
        if after != before:
            for line in schema_diff(before, after):
                self.log('  diferença de schema: ' + line[:200])
            return False, 'schema-diferente'
        return True, 'schema-identico'


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--versions', required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--image-digest', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--schema-source', default=release_plan.SCHEMA_SOURCE_PRODUCTION)
    parser.add_argument('--db-host', default='127.0.0.1')
    parser.add_argument('--db-port', type=int, default=5432)
    parser.add_argument('--db-user', default='postgres')
    args = parser.parse_args(argv)
    engine = Rehearsal(args.image, args.sha, args.image_digest, Path(args.snapshot).read_text(encoding='utf-8'),
                       release_plan.scan_migrations(args.versions), args.db_host, args.db_port, args.db_user,
                       os.environ.get('PGPASSWORD', ''), args.schema_source)
    result = engine.run()
    Path(args.out).write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({k: result.get(k) for k in ('ok', 'from_revision', 'head_revision', 'pending', 'reversible',
                                                   'reversible_reason', 'health', 'error', 'duration_s')}))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
