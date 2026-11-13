"""Release Oracle: a VM só baixa a imagem por digest, faz backup, migra, troca, confere e reverte.

A imagem é construída e a migração é ensaiada no GitHub Actions (release-image.yml e
migration-rehearsal.yml). Nada de build nem de ensaio na VM: ela é pequena e divide memória
com a loja em produção.

Execute no host Oracle (precisa de release-manifest.json e ci-proof.json em
/home/ubuntu/mercadinhosys-releases/<sha12>/, vindos do artefato do Actions):

    python3 release.py plan     --release SHA12   # só lê: diz o que a release exige
    python3 release.py prepare  --release SHA12   # plan + baixa a imagem por digest e confere
    python3 release.py deploy   --release SHA12 [--expected-image sha256:...] [--accept-destructive]
    python3 release.py rollback --release SHA12 [--downgrade]

Não roda seed, não restaura o banco operacional e não imprime credenciais.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_plan  # noqa: E402
from release_plan import ReleaseRefused  # noqa: E402

LIVE = Path('/home/ubuntu/mercadinhosys')
RELEASES = Path('/home/ubuntu/mercadinhosys-releases')
PG = 'oracle-postgres-1'
BACKEND = 'oracle-backend-1'
USER = 'mercadinho_user'
REVISION_LABEL = 'org.opencontainers.image.revision'
LOCAL_URL = 'http://127.0.0.1:5000/api'
PUBLIC_URL = os.environ.get('RELEASE_PUBLIC_API', 'https://mercadinhosys-api.144.22.151.18.sslip.io/api')
# VM pequena e disputada: com swap alto uma resposta leva dezenas de segundos (medido em 13/11/2026).
REQUEST_TIMEOUT = int(os.environ.get('RELEASE_REQUEST_TIMEOUT', '90'))
HEALTH_DEADLINE = int(os.environ.get('RELEASE_HEALTH_DEADLINE', '300'))
MIN_FREE_DISK = 2 * 1024 ** 3


def load_json(path):
    # utf-8-sig: o ci-proof.json gerado no PowerShell chega com BOM e já quebrou um deploy.
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


class Host:
    """Todo contato com o sistema (Docker, HTTP, relógio) fica aqui; os testes trocam esta classe."""

    def __init__(self, log_path):
        self.log_path = Path(log_path)

    def docker(self, *command, data=None, stdin_path=None, stdout_path=None):
        stdin = open(stdin_path, 'rb') if stdin_path else None
        stdout = open(stdout_path, 'wb') if stdout_path else subprocess.PIPE
        try:
            result = subprocess.run(['sudo', 'docker', *command], input=data, stdin=stdin, stdout=stdout,
                                    stderr=subprocess.PIPE)
        finally:
            for handle in (stdin, stdout if stdout_path else None):
                if handle:
                    handle.close()
        out = b'' if stdout_path else result.stdout
        # Inspect contém ambientes; dumps, restore e SQL podem conter dados. Nunca copiar ao log.
        if command[0] != 'inspect' and not {'pg_dump', 'pg_restore', 'psql'} & set(command):
            with self.log_path.open('ab') as log:
                log.write(out + result.stderr)
        if result.returncode:
            raise RuntimeError(f'Operação Docker falhou; consultar {self.log_path.name} no host, exit={result.returncode}')
        return out

    def http(self, base, path, payload=None, token=None, scope=None):
        headers = {'Origin': 'https://mercadinhosys.vercel.app'}
        if scope is not None:
            headers['X-Establishment-ID'] = str(scope)
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(base + path, data=json.dumps(payload).encode() if payload is not None else None,
                                     headers=headers)
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
            return json.load(response)

    def sleep(self, seconds):
        time.sleep(seconds)

    def monotonic(self):
        return time.monotonic()

    def disk_free(self):
        return shutil.disk_usage('/var/lib/docker').free

    def sha256(self, path):
        digest = hashlib.sha256()
        with open(path, 'rb') as handle:
            for block in iter(lambda: handle.read(1 << 20), b''):
                digest.update(block)
        return digest.hexdigest()


class Releaser:
    def __init__(self, host, release, root, live, contracts=None, manifest_path=None, proof_path=None,
                 local_url=LOCAL_URL, public_url=PUBLIC_URL, health_deadline=HEALTH_DEADLINE,
                 accept_destructive=False, expected_image=None, log=print):
        self.host, self.release, self.root, self.live = host, release, Path(root), Path(live)
        self.contracts = contracts
        self.manifest_path = Path(manifest_path) if manifest_path else self.root / 'release-manifest.json'
        self.proof_path = Path(proof_path) if proof_path else self.root / 'ci-proof.json'
        self.local_url, self.public_url, self.health_deadline = local_url, public_url, health_deadline
        self.accept_destructive, self.expected_image, self.log = accept_destructive, expected_image, log
        self.image = 'mercadinhosys-backend:' + release

    # ---- utilidades -----------------------------------------------------------------
    def docker(self, *command, **kwargs):
        return self.host.docker(*command, **kwargs)

    def info(self, name):
        return json.loads(self.docker('inspect', name))[0]

    def save(self, name, value):
        (self.root / name).write_text(json.dumps(value, indent=2), encoding='utf-8')

    def psql(self, sql, database='mercadinhosys'):
        return self.docker('exec', PG, 'psql', '-U', USER, '-d', database, '-tAc', sql).decode().strip()

    def counts(self):
        sql = ("SELECT json_build_object('estabelecimentos',(SELECT count(*) FROM estabelecimentos),"
               "'funcionarios',(SELECT count(*) FROM funcionarios),'produtos',(SELECT count(*) FROM produtos),"
               "'vendas',(SELECT count(*) FROM vendas),'contas_pagar',(SELECT count(*) FROM contas_pagar))")
        return json.loads(self.psql(sql))

    def production_revision(self):
        rows = [row for row in self.psql('SELECT version_num FROM alembic_version').split() if row]
        if len(rows) != 1:
            raise ReleaseRefused(f'alembic_version da produção deveria ter 1 linha; tem {len(rows)}')
        return rows[0]

    def compose(self, override, *command):
        folder = self.live / 'infra/oracle'
        split = folder / 'compose.db-split.yml'
        # A presença do marcador confirma o corte para o PostgreSQL privado.
        database_args = ['-f', str(split)] if (folder / '.db-split-active').is_file() else []
        return self.docker('compose', '-p', 'oracle', '--project-directory', str(folder),
                           '--env-file', str(folder / '.env.demo'), '-f', str(folder / 'compose.demo.yml'),
                           '-f', str(folder / 'compose.https.yml'), *database_args, '-f', str(override), *command)

    def override(self, name, image):
        path = self.root / name
        config = 'services:\n  backend:\n    image: ' + image + '\n'
        if image == self.image:
            revision = self.info(self.image)['Config'].get('Labels', {}).get(REVISION_LABEL, self.release)
            config += '    environment:\n      SENTRY_ENVIRONMENT: production\n      SENTRY_RELEASE: ' + revision + '\n'
        path.write_text(config, encoding='utf-8')
        return path

    @contextlib.contextmanager
    def lock(self, action):
        """Uma operação de release por vez: dois deploys simultâneos já derrubaram a API."""
        path = self.root.parent / '.release.lock'
        for attempt in (1, 2):
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                break
            except FileExistsError:
                if attempt == 1 and self._stale(path):
                    path.unlink(missing_ok=True)
                    continue
                raise ReleaseRefused('Outra operação de release está em andamento (' + path.name + '): aguarde ela terminar')
        try:
            os.write(fd, f'{os.getpid()} {action} {self.release}\n'.encode())
            os.close(fd)
            yield
        finally:
            path.unlink(missing_ok=True)

    @staticmethod
    def _stale(path):
        if os.name != 'posix':
            return False
        try:
            os.kill(int(path.read_text().split()[0]), 0)  # sinal 0 só testa se o processo existe
        except (ValueError, IndexError):
            return True
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        return False

    # ---- smoke ----------------------------------------------------------------------
    def smoke(self, base, database='mercadinhosys', strict=True):
        c = self.contracts
        deadline = self.host.monotonic() + self.health_deadline
        while True:
            try:
                health = self.host.http(base, '/health')
                if health.get('status') != 'healthy' or health.get('database', {}).get('status') != 'connected':
                    raise RuntimeError('Health não confirmou banco conectado')
                break
            except Exception:
                if self.host.monotonic() >= deadline:
                    raise RuntimeError('API não ficou saudável dentro do prazo') from None
                self.host.sleep(3)
        password = (self.live / 'infra/oracle/.admin.env').read_text().strip().split('=', 1)[1]
        login = self.host.http(base, '/auth/login', {'username': 'maldivas', 'password': password})
        if not login.get('success') or not login.get('access_token'):
            raise RuntimeError('Login administrativo falhou')
        token = login['access_token']
        if not strict:
            print(json.dumps({'smoke_ok': True, 'level': 'health-login'}), flush=True)
            return
        # Metadados e contagens, sem conteúdo pessoal. SQL não é copiado para os logs.
        sql = ("SELECT COALESCE(json_agg(json_build_object('id',f.id,'estabelecimento_id',f.estabelecimento_id,"
               "'produtos_ativos',(SELECT count(*) FROM produtos p WHERE p.fornecedor_id=f.id AND "
               "p.estabelecimento_id=f.estabelecimento_id AND p.ativo=true AND p.deleted_at IS NULL))), '[]'::json) "
               "FROM fornecedores f WHERE f.deleted_at IS NULL")
        expected_all = json.loads(self.psql(sql, database))
        order_sql = ("SELECT COALESCE(json_agg(json_build_object('id',p.id,'fornecedor_id',p.fornecedor_id,"
                     "'estabelecimento_id',p.estabelecimento_id,'total',p.total,'quantidade_itens',"
                     "(SELECT count(*) FROM pedido_compra_itens i WHERE i.pedido_id=p.id))), '[]'::json) FROM pedidos_compra p")
        expected_orders = json.loads(self.psql(order_sql, database))
        checked = []
        for tenant in [None, 2, 3]:
            expected = expected_all if tenant is None else [r for r in expected_all if r['estabelecimento_id'] == tenant]
            listing = self.host.http(base, '/fornecedores/?por_pagina=200', token=token, scope=tenant)
            c.validate_suppliers(listing, expected)
            checked.append({'path': '/fornecedores/', 'scope': tenant or 'all', 'total': len(expected)})
            stats = self.host.http(base, '/fornecedores/estatisticas', token=token, scope=tenant)
            c.require_success(stats)
            if stats.get('estatisticas', {}).get('total') != len(expected):
                raise RuntimeError('Estatísticas de fornecedores divergiram do escopo')
            if expected:
                first = expected[0]
                detail = self.host.http(base, '/fornecedores/' + str(first['id']), token=token, scope=tenant)
                c.require_success(detail)
                if detail.get('fornecedor', {}).get('estabelecimento_id') != first['estabelecimento_id'] \
                        or detail.get('metricas', {}).get('total_produtos') != first['produtos_ativos']:
                    raise RuntimeError('Detalhe de fornecedor divergiu do banco')
                orders = [r for r in expected_orders if r['fornecedor_id'] == first['id']
                          and r['estabelecimento_id'] == first['estabelecimento_id']]
                c.validate_orders(self.host.http(base, '/fornecedores/' + str(first['id']) + '/pedidos',
                                                 token=token, scope=tenant), orders)
            for path in ['/produtos/', '/produtos/?busca=agua']:
                c.validate_products(self.host.http(base, path, token=token, scope=tenant), tenant)
        print(json.dumps({'smoke_ok': True, 'level': 'contracts-scope-db', 'supplier_scopes': checked,
                          'checks': ['health', 'login', 'suppliers', 'statistics', 'detail', 'orders', 'products',
                                     'search']}), flush=True)

    # ---- etapas ---------------------------------------------------------------------
    def decide(self):
        """Valida manifesto e prova de CI e decide o que a release exige. Só lê; não muda nada."""
        manifest = release_plan.validate_manifest(load_json(self.manifest_path), self.release)
        proof_url = release_plan.validate_ci_proof(load_json(self.proof_path), manifest['sha'], self.release)
        production = self.production_revision()
        plan = release_plan.plan_migration(production, manifest, self.accept_destructive)
        return manifest, plan, proof_url

    def _already_prepared(self, manifest):
        """`deploy` repete o `prepare`: reaproveita a imagem que ESTE pacote já trouxe e verificou."""
        try:
            done = load_json(self.root / 'prepare-result.json')
            image = self.info(self.image)
        except (OSError, ValueError, RuntimeError):
            return None
        labels = (image.get('Config') or {}).get('Labels') or {}
        if done.get('prepared') and done.get('image_digest') == manifest['image']['digest'] \
                and done.get('image_id') == image['Id'] and labels.get(REVISION_LABEL) == manifest['sha']:
            return image
        return None

    def pull(self, manifest):
        """Baixa por DIGEST (imutável) ou carrega image.tar.gz verificado pelo SHA-256 do manifesto."""
        ref = manifest['image']['ref']
        if self.host.disk_free() < MIN_FREE_DISK:
            raise ReleaseRefused('Menos de 2 GB livres em /var/lib/docker: libere espaço antes de baixar a imagem')
        reused = self._already_prepared(manifest)
        if reused:
            return reused
        archive = self.root / 'image.tar.gz'
        from_archive = archive.is_file()
        if from_archive:
            expected = manifest['image'].get('archive_sha256')
            if not expected or self.host.sha256(archive) != expected:
                raise ReleaseRefused('image.tar.gz não confere com o SHA-256 do manifesto: arquivo corrompido ou de outra build')
            self.docker('load', '-i', str(archive))
            self.docker('tag', 'mercadinhosys-backend:local', self.image)
            archive.unlink()
        else:
            self.docker('pull', ref)
            self.docker('tag', ref, self.image)
        image = self.info(self.image)
        if not from_archive and manifest['image']['digest'] not in ' '.join(image.get('RepoDigests') or []):
            raise ReleaseRefused('A imagem local não vem do digest do manifesto')
        revision = (image.get('Config') or {}).get('Labels', {}).get(REVISION_LABEL)
        if revision != manifest['sha']:
            raise ReleaseRefused('A imagem baixada não declara a revisão do manifesto (label ' + REVISION_LABEL + ')')
        return image

    def prepare(self):
        manifest, plan, proof_url = self.decide()
        image = self.pull(manifest)
        result = {'release': self.release, 'sha': manifest['sha'], 'image_digest': manifest['image']['digest'],
                  'image_id': image['Id'], 'ci_run': proof_url, 'plan': plan.to_dict(), 'prepared': True,
                  'production_image_at_prepare': self.info(BACKEND)['Image']}
        self.save('prepare-result.json', result)
        print(json.dumps(result), flush=True)
        return manifest, plan, result

    def backup(self):
        """Dump em disco (não em memória: a VM tem 1 GB) e validado com pg_restore --list."""
        path = self.root / 'database-before.dump'
        self.docker('exec', PG, 'pg_dump', '-U', USER, '--format=custom', 'mercadinhosys', stdout_path=path)
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError('Backup vazio; troca abortada')
        self.docker('exec', '-i', PG, 'pg_restore', '--list', stdin_path=path)
        return path

    def deploy(self):
        manifest, plan, result = self.prepare()
        previous = self.info(BACKEND)['Image']
        if self.expected_image and previous != self.expected_image:
            raise ReleaseRefused('Imagem ativa divergiu da esperada; release recusada')
        if previous == result['image_id'] and plan.kind == 'no-migration':
            print(json.dumps({'release': self.release, 'ja_no_ar': True}), flush=True)
            return {'status': 'already-deployed'}
        baseline = self.counts()
        self.backup()
        self.save('rollback.json', {'release': self.release, 'previous_image': previous, 'counts_before': baseline,
                                    'from_revision': plan.production_revision, 'plan': plan.to_dict()})
        old = self.override('rollback-image.yml', previous)
        new = self.override('release-image.yml', self.image)
        self.docker('tag', previous, 'oracle-backend:rollback-' + self.release)
        self.compose(new, 'config', '--quiet')
        try:
            if plan.kind == 'migrate':
                self.compose(new, 'run', '--rm', '--no-deps', '-T', 'backend', 'flask', 'db', 'upgrade')
                if self.production_revision() != plan.head_revision:
                    raise RuntimeError('Migração não terminou no head esperado')
                self.check_counts(baseline, 'Migração reduziu contagens; troca de imagem não feita')
            self.compose(new, 'up', '-d', '--no-deps', '--no-build', 'backend')
            self.smoke(self.local_url)
            self.smoke(self.public_url)
            self.check_counts(baseline, 'Contagens caíram na troca')
        except BaseException as falha:  # inclui Ctrl+C/SIGTERM: o rollback precisa rodar mesmo assim
            # A causa vai para o log antes do rollback: sem ela, cada falha vira tentativa às cegas.
            print(json.dumps({'deploy_falhou': type(falha).__name__, 'motivo': str(falha)[:500]}), flush=True)
            outcome = self.restore(plan, old, new, downgrade=True)
            self.save('deploy-result.json', {'release': self.release, 'status': 'rolled-back',
                                             'reason': type(falha).__name__, 'restore': outcome})
            raise RuntimeError('Deploy falhou; imagem anterior restaurada (' + outcome['schema'] + ')') from None
        result = {'release': self.release, 'status': 'deployed', 'deployed_image': self.info(BACKEND)['Image'],
                  'image_digest': manifest['image']['digest'], 'rollback_image': previous, 'counts': baseline,
                  'backup_validated': True, 'plan': plan.to_dict(), 'ci_run': result['ci_run']}
        self.save('deploy-result.json', result)
        # Metadados e tag: se falharem (arquivo de root, por exemplo), a release continua no ar.
        for name, action in (('.release.json', lambda: (self.live / '.release.json').write_text(
                json.dumps(result, indent=2), encoding='utf-8')),
                             ('tag latest', lambda: self.docker('tag', self.image, 'oracle-backend:latest'))):
            try:
                action()
            except (OSError, RuntimeError) as aviso:
                print(json.dumps({'aviso': name + ' não gravado', 'motivo': str(aviso)[:200]}), flush=True)
        print(json.dumps(result), flush=True)
        return result

    def check_counts(self, baseline, message):
        # A loja vende durante a troca: contagem pode subir, nunca cair.
        regressed = release_plan.counts_regressed(baseline, self.counts())
        if regressed:
            raise RuntimeError(message + ': ' + ', '.join(regressed))

    def restore(self, plan, old, new, downgrade):
        """Volta a imagem anterior; desfaz o schema só quando o ensaio provou que é seguro."""
        outcome = {'schema': 'inalterado', 'downgrade': False}
        try:
            current = self.production_revision()
            if current != plan.production_revision:
                if downgrade and plan.kind == 'migrate' and plan.auto_downgrade:
                    self.compose(new, 'stop', 'backend')
                    self.compose(new, 'run', '--rm', '--no-deps', '-T', 'backend', 'flask', 'db', 'downgrade',
                                 plan.production_revision)
                    done = self.production_revision() == plan.production_revision
                    outcome = {'schema': 'revertido' if done else 'downgrade-incompleto', 'downgrade': done}
                else:
                    outcome['schema'] = 'migrado-mantido'
                    print(json.dumps({'aviso': 'schema permanece em ' + current, 'motivo':
                                      'migração não é reversível automaticamente; backup em database-before.dump'}),
                          flush=True)
        except Exception as erro:  # a imagem anterior volta mesmo se o banco não responder
            outcome['schema'] = 'nao-verificado:' + type(erro).__name__
        self.compose(old, 'up', '-d', '--no-deps', '--no-build', 'backend')
        self.smoke(self.local_url, strict=False)
        return outcome

    def rollback(self, downgrade=False):
        data = load_json(self.root / 'rollback.json')
        # rollback.json de releases antigas não tem 'plan': só a imagem volta, como sempre foi.
        plan = release_plan.Plan(**data['plan']) if data.get('plan') else release_plan.Plan(
            'no-migration', data.get('from_revision', ''), data.get('from_revision', ''))
        if downgrade and not (plan.kind == 'migrate' and plan.auto_downgrade):
            raise ReleaseRefused('Esta migração não é reversível automaticamente (ensaio/classificação); '
                                 'restaure o backup database-before.dump manualmente se necessário')
        old = self.override('rollback-image.yml', data['previous_image'])
        outcome = self.restore(plan, old, self.root / 'release-image.yml', downgrade=downgrade)
        print('ROLLBACK_OK: imagem anterior; schema ' + outcome['schema'] + '; volumes preservados')
        return outcome


def load_contracts(root):
    # Carrega contratos puros do pacote Git sem importar Flask no host de operação.
    spec = importlib.util.spec_from_file_location('release_contracts',
                                                  root / 'backend/app/utils/release_smoke_contracts.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['plan', 'prepare', 'deploy', 'rollback', 'stage'])
    parser.add_argument('--release', required=True)
    parser.add_argument('--manifest', help='release-manifest.json (padrão: na pasta da release)')
    parser.add_argument('--ci-proof', help='ci-proof.json (padrão: na pasta da release)')
    parser.add_argument('--expected-image', help='ID da imagem ativa que o operador espera substituir')
    parser.add_argument('--accept-destructive', action='store_true', help='aceita migração com DROP (release próprio)')
    parser.add_argument('--downgrade', action='store_true', help='no rollback manual, também desfaz a migração')
    args = parser.parse_args(argv)
    if args.action == 'stage':
        raise SystemExit('O ensaio (stage) saiu da VM: roda no GitHub Actions (migration-rehearsal.yml). '
                         'Use plan/prepare/deploy; veja infra/oracle/RELEASE.md.')
    if not re.fullmatch(r'[0-9a-f]{12}', args.release):
        raise SystemExit('Release deve ser SHA de 12 caracteres')
    os.umask(0o077)
    root = RELEASES / args.release
    if not root.is_dir():
        raise SystemExit('Pasta da release não encontrada')
    # SIGTERM vira exceção para o rollback do deploy rodar (kill/ssh caindo no meio da troca).
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    releaser = Releaser(Host(root / (args.action + '.log')), args.release, root, LIVE,
                        contracts=load_contracts(root) if args.action in ('deploy', 'prepare') else None,
                        manifest_path=args.manifest, proof_path=args.ci_proof,
                        accept_destructive=args.accept_destructive, expected_image=args.expected_image)
    try:
        with releaser.lock(args.action):
            if args.action == 'plan':
                manifest, plan, proof_url = releaser.decide()
                print(json.dumps({'release': args.release, 'ci_run': proof_url, 'plan': plan.to_dict()}, indent=2))
            elif args.action == 'prepare':
                releaser.prepare()
            elif args.action == 'deploy':
                releaser.deploy()
            else:
                releaser.rollback(args.downgrade)
    except ReleaseRefused as recusa:
        raise SystemExit('RECUSADA: ' + str(recusa))


if __name__ == '__main__':
    main()
