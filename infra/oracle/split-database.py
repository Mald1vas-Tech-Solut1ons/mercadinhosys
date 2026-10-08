"""Ensaia e corta o PostgreSQL para a segunda Micro, a partir da VM da API.

Requer túnel systemd e cliente candidato preparados; nunca imprime ambientes.
O volume PostgreSQL original fica preservado. Não há rollback automático após
reabrir o tráfego, pois isso poderia perder novas gravações no banco privado.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request
from urllib.parse import quote

LIVE = Path('/home/ubuntu/mercadinhosys')
FOLDER = LIVE / 'infra/oracle'
ROOT = Path('/home/ubuntu/mercadinhosys-db-split')
USER = 'mercadinho_user'
DATABASE = 'mercadinhosys'
LOCAL = 'oracle-postgres-1'
CANDIDATE = 'mercadinhosys-db-candidate-client'


def docker(*command, data=None):
    r = subprocess.run(['sudo', 'docker', *command], input=data, capture_output=True)
    if r.returncode:
        # Inspect, SQL e dumps podem conter segredos ou dados pessoais.
        raise RuntimeError('Operação Docker reprovada: ' + command[0] + '; exit=' + str(r.returncode))
    return r.stdout


def info(name):
    return json.loads(docker('inspect', name))[0]


def env_of(container):
    return dict(row.split('=', 1) for row in container['Config']['Env'] if '=' in row)


def sql(container, query, database=DATABASE):
    return docker('exec', container, 'psql', '-U', USER, '-d', database,
                  '-v', 'ON_ERROR_STOP=1', '-tAc', query).decode().strip()


def fingerprint(container, database=DATABASE):
    tables = json.loads(sql(container, "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public'", database))
    result = {}
    for table in tables:
        quoted = '"' + table.replace('"', '""') + '"'
        value = sql(container, "SELECT json_build_object('count',count(*),'hash',md5(coalesce(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public." + quoted + ' t) s', database)
        result[table] = json.loads(value)
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2), encoding='utf-8')


def smoke(base, pg, database=DATABASE):
    # Reutiliza os mesmos contratos de smoke da release sem executar seu CLI.
    spec = importlib.util.spec_from_file_location('contracts', LIVE / 'backend/app/utils/release_smoke_contracts.py')
    contracts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contracts)
    source = ast.parse((FOLDER / 'release.py').read_text())
    functions = [n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in {'request', 'smoke'}]
    if len(functions) != 2:
        raise RuntimeError('Contrato de smoke da release indisponível')
    context = {'json': json, 'urllib': __import__('urllib'), 'time': time, 'LIVE': LIVE,
               'docker': docker, 'PG': pg, 'USER': USER,
               **{name: getattr(contracts, name) for name in ['require_success', 'validate_products', 'validate_suppliers', 'validate_orders']}}
    exec(compile(ast.Module(body=functions, type_ignores=[]), 'release-smoke', 'exec'), context)
    context['smoke'](base, database=database)


def compose(split, *command):
    files = ['-f', str(FOLDER / 'compose.demo.yml'), '-f', str(FOLDER / 'compose.https.yml')]
    if split:
        files += ['-f', str(FOLDER / 'compose.db-split.yml')]
    files += ['-f', str(ROOT / 'backend-image.yml')]
    return docker('compose', '-p', 'oracle', '--project-directory', str(FOLDER),
                  '--env-file', str(FOLDER / '.env.demo'), *files, *command)


def stage():
    backend = info('oracle-backend-1')
    source = fingerprint(LOCAL)
    database = 'audit_security_split_' + secrets.token_hex(6)
    env = env_of(info(CANDIDATE))
    stage_env = ROOT / '.stage.env'
    name = 'mercadinhosys-db-split-stage'
    stage_started = False
    docker('exec', CANDIDATE, 'createdb', '-U', USER, database)
    try:
        dump = docker('exec', LOCAL, 'pg_dump', '-U', USER, '-Fc', DATABASE)
        docker('exec', '-i', CANDIDATE, 'pg_restore', '-U', USER, '-d', database,
               '--exit-on-error', '--no-owner', '--no-acl', data=dump)
        restored = fingerprint(CANDIDATE, database)
        if source != restored:
            raise RuntimeError('Clone divergiu da origem; repetir ensaio em uma janela sem gravações')
        url = 'postgresql://' + USER + ':' + quote(env['PGPASSWORD'], safe='') + '@postgres-candidate:5432/' + database + '?sslmode=disable'
        settings = {'DATABASE_URL': url, 'FLASK_APP': 'run:app', 'FLASK_ENV': 'production',
                    'SKIP_DB_SETUP': 'true', 'SKIP_SCHEMA_SYNC': 'true', 'SECRET_KEY': secrets.token_hex(32),
                    'JWT_SECRET_KEY': secrets.token_hex(32), 'SENTRY_DSN': '', 'SENTRY_ENVIRONMENT': 'db-split-stage',
                    'DB_POOL_SIZE': '2', 'DB_MAX_OVERFLOW': '1', 'REDIS_URL': '',
                    'SYNC_ENABLED': 'false', 'SYNC_AUTO_PUSH': 'false',
                    'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1',
                    'CORS_ORIGINS': 'https://mercadinhosys.vercel.app'}
        stage_env.write_text(''.join(k + '=' + v + '\n' for k, v in settings.items()))
        options = ['run', '--rm', '--network', 'oracle_default', '--memory', '256m', '--env-file', str(stage_env)]
        docker(*options, backend['Image'], 'flask', 'db', 'upgrade')
        if fingerprint(CANDIDATE, database) != restored:
            raise RuntimeError('Migration alterou o clone na migração de infraestrutura')
        docker(*options, '-d', '--name', name, '-p', '127.0.0.1:5002:5000', backend['Image'],
               'gunicorn', 'run:app', '--bind', '0.0.0.0:5000', '--workers', '1', '--threads', '4',
               '--timeout', '120', '--worker-tmp-dir', '/dev/shm')
        stage_started = True
        smoke('http://127.0.0.1:5002/api', CANDIDATE, database)
        result = {'stage_passed': True, 'backend_image': backend['Image'],
                  'tables': len(restored), 'fingerprint': digest(restored),
                  'counts': {k: v['count'] for k, v in restored.items()},
                  'postgres_versions': [sql(c, 'SHOW server_version', 'postgres') for c in [LOCAL, CANDIDATE]]}
        save('stage-result.json', result)
        print(json.dumps(result), flush=True)
    finally:
        if stage_started:
            docker('rm', '-f', name)
        docker('exec', CANDIDATE, 'dropdb', '-U', USER, '--if-exists', database)
        stage_env.unlink(missing_ok=True)


def cutover():
    result = json.loads((ROOT / 'stage-result.json').read_text())
    backend = info('oracle-backend-1')
    if not result.get('stage_passed') or result['backend_image'] != backend['Image']:
        raise RuntimeError('Ensaio não corresponde à imagem em serviço')
    if (FOLDER / '.db-split-active').exists():
        raise RuntimeError('Corte já aplicado; executar verify')
    if fingerprint(CANDIDATE):
        raise RuntimeError('Banco candidato operacional já contém tabelas; recusado sobrescrever')
    environment = env_of(backend)
    config = 'services:\n  backend:\n    image: ' + backend['Image'] + '\n    environment:\n'
    for key in ['SENTRY_ENVIRONMENT', 'SENTRY_RELEASE']:
        config += '      ' + key + ': ' + json.dumps(environment.get(key, '')) + '\n'
    (ROOT / 'backend-image.yml').write_text(config)
    compose(True, 'config', '--quiet')
    opened = False
    try:
        # Caddy também é pausado: nenhum cliente externo grava durante o corte.
        docker('stop', '--time', '20', 'oracle-caddy-1', 'oracle-backend-1')
        source = fingerprint(LOCAL)
        active = int(sql(LOCAL, "SELECT count(*) FROM pg_stat_activity WHERE datname='mercadinhosys' AND pid<>pg_backend_pid() AND backend_type='client backend'", 'mercadinhosys'))
        if active:
            raise RuntimeError('Existem escritores/conexões externos ao backend pausado')
        dump = docker('exec', LOCAL, 'pg_dump', '-U', USER, '-Fc', DATABASE)
        (ROOT / 'database-before.dump').write_bytes(dump)
        docker('exec', '-i', CANDIDATE, 'pg_restore', '--list', data=dump)
        save('source-before.json', source)
        docker('exec', CANDIDATE, 'dropdb', '-U', USER, DATABASE)
        docker('exec', CANDIDATE, 'createdb', '-U', USER, DATABASE)
        docker('exec', '-i', CANDIDATE, 'pg_restore', '-U', USER, '-d', DATABASE,
               '--exit-on-error', '--no-owner', '--no-acl', data=dump)
        if fingerprint(CANDIDATE) != source or fingerprint(LOCAL) != source:
            raise RuntimeError('Conteúdo restaurado ou origem divergiu; corte recusado')
        docker('stop', '--time', '20', LOCAL)
        compose(True, 'up', '-d', '--no-deps', '--no-build', 'postgres')
        deadline = time.monotonic() + 90
        while info(LOCAL)['State'].get('Health', {}).get('Status') != 'healthy':
            if time.monotonic() >= deadline:
                raise RuntimeError('Cliente PostgreSQL não confirmou a saúde do túnel')
            time.sleep(2)
        if fingerprint(LOCAL) != source:
            raise RuntimeError('Alias da aplicação não aponta para o banco restaurado')
        (FOLDER / '.db-split-active').write_text('private-postgres-v1\n')
        compose(True, 'up', '-d', '--no-deps', '--no-build', 'backend')
        smoke('http://127.0.0.1:5000/api', LOCAL)
        if {k: v['count'] for k, v in fingerprint(LOCAL).items()} != {k: v['count'] for k, v in source.items()}:
            raise RuntimeError('Smoke alterou contagens; tráfego continua pausado')
        result.update({'cutover_passed': True, 'traffic_reopened': False,
                       'original_volume': 'oracle_postgres_data', 'backup_validated': True})
        save('cutover-result.json', result)
        # Após este ponto, qualquer reparo deve preservar as novas gravações.
        opened = True
        docker('start', 'oracle-caddy-1')
        result['traffic_reopened'] = True
        save('cutover-result.json', result)
        smoke('https://mercadinhosys-api.144.22.151.18.sslip.io/api', LOCAL)
        result['public_smoke_passed'] = True
        save('cutover-result.json', result)
        print(json.dumps(result), flush=True)
    except Exception:
        if not opened:
            (FOLDER / '.db-split-active').unlink(missing_ok=True)
            docker('stop', '--time', '20', 'oracle-backend-1')
            compose(False, 'up', '-d', '--no-deps', '--no-build', 'postgres')
            compose(False, 'up', '-d', '--no-deps', '--no-build', 'backend')
            smoke('http://127.0.0.1:5000/api', LOCAL)
            docker('start', 'oracle-caddy-1')
            print('ROLLBACK: origem e volume preservados; tráfego reaberto no banco original.', flush=True)
        else:
            print('CORTE MANTIDO: tráfego reaberto; reparar adiante preservando gravações.', flush=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['stage', 'cutover', 'verify'])
    args = parser.parse_args()
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    if args.action == 'stage':
        stage()
    elif args.action == 'cutover':
        cutover()
    else:
        smoke('http://127.0.0.1:5000/api', LOCAL)
        smoke('https://mercadinhosys-api.144.22.151.18.sslip.io/api', LOCAL)
        print(json.dumps({'tables': len(fingerprint(LOCAL)), 'tunnel_active': subprocess.run(['systemctl', 'is-active', '--quiet', 'mercadinhosys-db-tunnel']).returncode == 0}))
