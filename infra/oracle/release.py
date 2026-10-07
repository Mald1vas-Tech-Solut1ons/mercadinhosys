"""Release Oracle com ensaio PostgreSQL, backup e rollback da imagem.

Execute no host Oracle: python3 release.py stage|deploy|rollback --release SHA12.
Não roda seed, não restaura o banco operacional e não imprime credenciais.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import time
import urllib.request
from urllib.parse import quote

parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['stage', 'deploy', 'rollback'])
parser.add_argument('--release', required=True)
parser.add_argument('--expected-image')
args = parser.parse_args()
if not re.fullmatch(r'[0-9a-f]{12}', args.release):
    raise SystemExit('Release deve ser SHA de 12 caracteres')
os.umask(0o077)
LIVE = Path('/home/ubuntu/mercadinhosys')
ROOT = Path('/home/ubuntu/mercadinhosys-releases') / args.release
if not ROOT.is_dir() or not (ROOT / 'backend').is_dir():
    raise SystemExit('Pacote da release não encontrado')
IMAGE = 'mercadinhosys-backend:' + args.release
LOG = ROOT / (args.action + '.log')
PG = 'oracle-postgres-1'
USER = 'mercadinho_user'
CONTAINER = 'mercadinhosys-release-stage-' + args.release


def docker(*command, data=None):
    result = subprocess.run(['sudo', 'docker', *command], input=data, capture_output=True)
    # Inspect contém ambientes; dumps e SQL podem conter dados. Nunca copiar ao log.
    if command[0] != 'inspect' and 'pg_dump' not in command and 'psql' not in command:
        with LOG.open('ab') as log:
            log.write(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f'Operação Docker falhou; consultar {LOG.name} no host, exit={result.returncode}')
    return result.stdout


def info(name):
    return json.loads(docker('inspect', name))[0]


def env_of(container):
    return dict(row.split('=', 1) for row in container['Config']['Env'] if '=' in row)


def counts(database='mercadinhosys'):
    sql = "SELECT json_build_object('estabelecimentos',(SELECT count(*) FROM estabelecimentos),'funcionarios',(SELECT count(*) FROM funcionarios),'produtos',(SELECT count(*) FROM produtos),'vendas',(SELECT count(*) FROM vendas),'contas_pagar',(SELECT count(*) FROM contas_pagar))"
    return json.loads(docker('exec', PG, 'psql', '-U', USER, '-d', database, '-tAc', sql))


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2), encoding='utf-8')


def request(base, path, payload=None, token=None):
    headers = {'Origin': 'https://mercadinhosys.vercel.app'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def smoke(base):
    deadline = time.monotonic() + 150
    while True:
        try:
            health = request(base, '/health')
            if health.get('status') != 'healthy' or health.get('database', {}).get('status') != 'connected':
                raise RuntimeError('Health não confirmou banco conectado')
            break
        except Exception:
            if time.monotonic() >= deadline:
                raise RuntimeError('API não ficou saudável dentro do prazo') from None
            time.sleep(3)
    password = (LIVE / 'infra/oracle/.admin.env').read_text().strip().split('=', 1)[1]
    login = request(base, '/auth/login', {'username': 'maldivas', 'password': password})
    if not login.get('success') or not login.get('access_token'):
        raise RuntimeError('Login administrativo falhou')
    token = login['access_token']
    paths = ['/super-admin/health', '/fornecedores/?estabelecimento_id=2', '/produtos/?estabelecimento_id=2', '/produtos/?estabelecimento_id=2&busca=agua']
    for path in paths:
        body = request(base, path, token=token)
        if isinstance(body, dict) and body.get('success') is False:
            raise RuntimeError('Smoke autenticado falhou: ' + path)
    print(json.dumps({'smoke_ok': True, 'paths': ['/health', '/auth/login', *paths]}), flush=True)


def compose(override, *command):
    folder = LIVE / 'infra/oracle'
    return docker('compose', '-p', 'oracle', '--project-directory', str(folder),
                  '--env-file', str(folder / '.env.demo'), '-f', str(folder / 'compose.demo.yml'),
                  '-f', str(folder / 'compose.https.yml'), '-f', str(override), *command)


def override(name, image):
    path = ROOT / name
    path.write_text('services:\n  backend:\n    image: ' + image + '\n', encoding='utf-8')
    return path


def stage():
    pg = info(PG)
    network = next(iter(pg['NetworkSettings']['Networks']))
    password = env_of(pg)['POSTGRES_PASSWORD']
    databases = ['audit_security_pg_' + args.release, 'audit_security_clone_' + args.release]
    env_path = ROOT / '.stage.env'
    created = []
    stage_started = False
    def environment(database, testing=False):
        url = f'postgresql://{USER}:{quote(password, safe="")}@postgres:5432/{database}?sslmode=disable'
        settings = {'DATABASE_URL': url, 'AUDIT_DATABASE_URL': url, 'AUDIT_REDIS_URL': '',
                    'FLASK_ENV': 'production', 'SKIP_DB_SETUP': 'true', 'SKIP_SCHEMA_SYNC': 'true',
                    'SECRET_KEY': secrets.token_hex(32), 'JWT_SECRET_KEY': secrets.token_hex(32),
                    'DB_POOL_SIZE': '2', 'DB_MAX_OVERFLOW': '1', 'REDIS_URL': '',
                    'SYNC_ENABLED': 'false', 'SYNC_AUTO_PUSH': 'false', 'SENTRY_DSN': '',
                    'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1',
                    'CORS_ORIGINS': 'https://mercadinhosys.vercel.app'}
        env_path.write_text(''.join(k + '=' + v + '\n' for k, v in settings.items()), encoding='utf-8')
    def run(*command, detach=False):
        options = ['run', '--rm', '--network', network, '--memory', '256m', '--env-file', str(env_path)]
        if detach:
            options += ['-d', '--name', CONTAINER, '-p', '127.0.0.1:5002:5000']
        return docker(*options, IMAGE, *command)
    try:
        for database in databases:
            if not re.fullmatch(r'audit_security_(pg|clone)_[0-9a-f]{12}', database):
                raise RuntimeError('Banco fora do escopo descartável')
            docker('exec', PG, 'createdb', '-U', USER, database)
            created.append(database)
        environment(databases[0], testing=True)
        tests = ['test_postgres_checkout_concurrency.py', 'test_finance_postgres_concurrency.py',
                 'test_finance_release.py', 'test_devops_finance_review.py', 'test_fin01_boleto_payments.py',
                 'test_security_audit.py', 'test_tenant_isolation.py', 'test_routes_multi_tenant_guard.py',
                 'test_fornecedores_listing_response.py', 'test_busca_produto_acento.py']
        output = run('python', '-m', 'pytest', *['tests/' + t for t in tests], '-q', '--tb=short', '--disable-warnings')
        summary = output.decode(errors='replace').strip().splitlines()[-1]
        print('POSTGRES_TESTS ' + summary, flush=True)
        dump = docker('exec', PG, 'pg_dump', '-U', USER, '--no-owner', '--no-acl', 'mercadinhosys')
        docker('exec', '-i', PG, 'psql', '-U', USER, '-d', databases[1], '-v', 'ON_ERROR_STOP=1', data=dump)
        before = counts(databases[1])
        environment(databases[1])
        run('flask', 'db', 'upgrade')
        after = counts(databases[1])
        if before != after:
            raise RuntimeError('Migration alterou contagens operacionais no ensaio')
        run('gunicorn', 'run:app', '--bind', '0.0.0.0:5000', '--workers', '1', '--threads', '4',
            '--timeout', '120', '--worker-tmp-dir', '/dev/shm', detach=True)
        stage_started = True
        smoke('http://127.0.0.1:5002/api')
        result = {'release': args.release, 'image': IMAGE, 'stage_passed': True,
                  'postgres_tests': summary, 'migration_preserved_counts': after,
                  'production_image_at_stage': info('oracle-backend-1')['Image']}
        save('stage-result.json', result)
        print(json.dumps(result), flush=True)
    finally:
        if stage_started:
            docker('rm', '-f', CONTAINER)
        for database in created:
            docker('exec', PG, 'dropdb', '-U', USER, '--if-exists', database)
        env_path.unlink(missing_ok=True)


def deploy():
    result = json.loads((ROOT / 'stage-result.json').read_text())
    previous = info('oracle-backend-1')['Image']
    if not result.get('stage_passed') or result['release'] != args.release:
        raise RuntimeError('Ensaio obrigatório ausente')
    if not args.expected_image or previous != args.expected_image or previous != result['production_image_at_stage']:
        raise RuntimeError('Imagem ativa divergiu do ensaio; release recusada')
    baseline = counts()
    dump = docker('exec', PG, 'pg_dump', '-U', USER, '--format=custom', 'mercadinhosys')
    (ROOT / 'database-before.dump').write_bytes(dump)
    docker('exec', '-i', PG, 'pg_restore', '--list', data=dump)
    save('rollback.json', {'previous_image': previous, 'counts_before': baseline})
    old = override('rollback-image.yml', previous)
    new = override('release-image.yml', IMAGE)
    docker('tag', previous, 'oracle-backend:rollback-' + args.release)
    compose(new, 'config', '--quiet')
    compose(new, 'run', '--rm', '--no-deps', '-T', 'backend', 'flask', 'db', 'upgrade')
    if counts() != baseline:
        raise RuntimeError('Migration alterou contagens; não foi feita troca de imagem')
    try:
        compose(new, 'up', '-d', '--no-deps', '--no-build', 'backend')
        smoke('http://127.0.0.1:5000/api')
        smoke('https://mercadinhosys-api.144.22.151.18.sslip.io/api')
        if counts() != baseline:
            raise RuntimeError('Contagens divergiram na troca; revisar atividade antes de aprovação')
        # Atualiza somente arquivos do pacote Git; ambientes e dados locais não entram no pacote.
        destination_root = (LIVE / 'backend').resolve()
        for source in (ROOT / 'backend').rglob('*'):
            if not source.is_file():
                continue
            destination = destination_root / source.relative_to(ROOT / 'backend')
            if not destination.resolve().is_relative_to(destination_root):
                raise RuntimeError('Destino de fonte fora da aplicação')
            if destination.is_file():
                backup_source = ROOT / 'source-before' / source.relative_to(ROOT / 'backend')
                backup_source.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(destination, backup_source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        docker('tag', IMAGE, 'oracle-backend:latest')
        result = {'release': args.release, 'deployed_image': info('oracle-backend-1')['Image'],
                  'rollback_image': previous, 'counts': baseline, 'backup_validated': True}
        save('deploy-result.json', result)
        (LIVE / '.release.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result), flush=True)
    except Exception:
        compose(old, 'up', '-d', '--no-deps', '--no-build', 'backend')
        smoke('http://127.0.0.1:5000/api')
        raise RuntimeError('Smoke falhou; imagem anterior restaurada; migration aditiva mantida') from None


if args.action == 'stage':
    stage()
elif args.action == 'deploy':
    deploy()
else:
    result = json.loads((ROOT / 'rollback.json').read_text())
    compose(override('rollback-image.yml', result['previous_image']), 'up', '-d', '--no-deps', '--no-build', 'backend')
    smoke('http://127.0.0.1:5000/api')
    print('ROLLBACK_OK: imagem anterior; banco/volumes preservados')
