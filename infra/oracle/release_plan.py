"""Regras puras de release: prova de CI, manifesto da imagem e plano de migração.

Sem Docker, sem rede e sem Flask. É importado pelo release.py (VM de produção), pelo
ensaio de migração e pelo workflow de build (GitHub Actions), então a mesma regra vale
nos três lugares e pode ser testada em qualquer máquina.

CLI (usado só no Actions):
    python release_plan.py manifest --sha SHA --digest sha256:... --ci-proof ci-proof.json \
        --versions backend/migrations/versions --out release-manifest.json
    python release_plan.py attach-rehearsal --manifest release-manifest.json --rehearsal rehearsal.json
"""
import argparse
import ast
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
from pathlib import Path
import re

REPOSITORY_URL = 'https://github.com/Mald1vas-Tech-Solut1ons/mercadinhosys'
CI_RUN_URL_PREFIX = REPOSITORY_URL + '/actions/runs/'
CI_WORKFLOW_PATH = '.github/workflows/ci.yml'
# Repositório da imagem: o manifesto só vale para este nome (nunca para outro registro).
IMAGE_REPOSITORY = 'ghcr.io/mald1vas-tech-solut1ons/mercadinhosys-backend'
MANIFEST_VERSION = 1
SCHEMA_SOURCE_PRODUCTION = 'production-schema-only'
# O ensaio vale para o schema que existia quando foi tirado o retrato. Mais velho que isso,
# a produção pode ter mudado (hotfix manual) e o ensaio deixa de provar o que importa.
REHEARSAL_MAX_AGE_HOURS = 72

_SHA = re.compile(r'[0-9a-f]{40}')
_DIGEST = re.compile(r'sha256:[0-9a-f]{64}')
_REVISION = re.compile(r'[0-9A-Za-z_]{1,40}')
_DESTRUCTIVE_ATTRS = {'drop_table', 'drop_column'}
_DESTRUCTIVE_SQL = re.compile(r'\b(DROP|TRUNCATE|DELETE)\b', re.IGNORECASE)
_SQL_ATTRS = {'execute', 'bulk_insert'}


class ReleaseRefused(Exception):
    """A release não cumpre uma regra: nada em produção foi alterado."""


# --------------------------------------------------------------------------- prova de CI

def validate_ci_proof(proof, sha, release):
    """Confere que o CI do ci.yml terminou verde para o SHA EXATO. Devolve a URL do run."""
    if not isinstance(proof, dict):
        raise ReleaseRefused('Prova de CI inválida (não é um objeto JSON)')
    if proof.get('status') != 'completed' or proof.get('conclusion') != 'success':
        raise ReleaseRefused('CI não está concluído com sucesso para esta release')
    if proof.get('head_sha') != sha:
        raise ReleaseRefused('Prova de CI é de outro commit (head_sha diverge do SHA da imagem)')
    if not sha or sha[:12] != release:
        raise ReleaseRefused('Prova de CI não identifica a release informada')
    if proof.get('path') != CI_WORKFLOW_PATH:
        raise ReleaseRefused('Prova de CI não é do workflow de testes (ci.yml)')
    if not str(proof.get('html_url', '')).startswith(CI_RUN_URL_PREFIX):
        raise ReleaseRefused('Prova de CI fora do repositório autorizado')
    if 'event' in proof and proof['event'] != 'push':
        raise ReleaseRefused('Prova de CI precisa ser de um push (o run do PR tem outro head_sha)')
    if 'head_branch' in proof and proof['head_branch'] not in ('master', 'main'):
        raise ReleaseRefused('Prova de CI não é da branch de produção')
    return proof['html_url']


# --------------------------------------------------------------------------- migrações

def _literal(node):
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return None


def _string_constants(node):
    return [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def scan_migration_file(path):
    """Lê UMA migração sem importá-la: revisão, pais e operações perigosas do upgrade."""
    tree = ast.parse(Path(path).read_text(encoding='utf-8'), filename=str(path))
    found = {}
    for node in tree.body:
        targets = []
        if isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            value = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            targets, value = [node.target.id], node.value
        else:
            continue
        for name in targets:
            if name in ('revision', 'down_revision') and value is not None:
                found[name] = _literal(value)
    revision = found.get('revision')
    if not isinstance(revision, str) or not _REVISION.fullmatch(revision):
        raise ValueError(f'{Path(path).name}: revisão ausente ou inválida')
    down = found.get('down_revision')
    if down is None:
        down = []
    elif isinstance(down, str):
        down = [down]
    elif isinstance(down, (tuple, list)):
        down = [str(item) for item in down]
    else:
        raise ValueError(f'{Path(path).name}: down_revision inválida')
    destructive, data_ops = set(), set()
    for node in tree.body:
        # O downgrade existe para desfazer: dropar lá é esperado e não conta como perigo.
        if isinstance(node, ast.FunctionDef) and node.name == 'downgrade':
            continue
        for call in (n for n in ast.walk(node) if isinstance(n, ast.Call)):
            attr = call.func.attr if isinstance(call.func, ast.Attribute) else None
            if attr in _DESTRUCTIVE_ATTRS:
                destructive.add(attr)
            elif attr in _SQL_ATTRS:
                texts = [text for arg in call.args for text in _string_constants(arg)]
                if any(_DESTRUCTIVE_SQL.search(text) for text in texts):
                    destructive.add('sql_destrutivo')
                else:
                    data_ops.add('sql_dados' if attr == 'execute' else attr)
            elif attr == 'alter_column' and any(kw.arg == 'type_' for kw in call.keywords):
                data_ops.add('alter_column_tipo')
    return {'revision': revision, 'down': down, 'file': Path(path).name,
            'destructive_ops': sorted(destructive), 'data_ops': sorted(data_ops)}


def scan_migrations(versions_dir):
    """Grafo completo das migrações: {head, graph:{revisão:{down,destructive_ops,data_ops}}}."""
    graph = {}
    for path in sorted(Path(versions_dir).glob('*.py')):
        if path.name.startswith('__'):
            continue
        item = scan_migration_file(path)
        if item['revision'] in graph:
            raise ValueError('Revisão duplicada: ' + item['revision'])
        graph[item['revision']] = {'down': item['down'], 'destructive_ops': item['destructive_ops'],
                                   'data_ops': item['data_ops'], 'file': item['file']}
    parents = {parent for item in graph.values() for parent in item['down']}
    unknown = parents - set(graph)
    if unknown:
        raise ValueError('Migração aponta para revisão inexistente: ' + ', '.join(sorted(unknown)))
    heads = sorted(set(graph) - parents)
    if len(heads) != 1:
        raise ValueError('A cadeia de migrações precisa de exatamente 1 head; encontrado: ' + ', '.join(heads))
    return {'head': heads[0], 'graph': graph}


def _ancestors(graph, revision):
    seen, stack = set(), list(graph[revision]['down'])
    while stack:
        current = stack.pop()
        if current not in seen:
            seen.add(current)
            stack.extend(graph[current]['down'])
    return seen


def pending_revisions(migrations, production_revision):
    """Revisões que a produção ainda não aplicou, da mais antiga para a mais nova."""
    graph = migrations['graph']
    if production_revision not in graph:
        raise ReleaseRefused(
            f'A revisão do banco de produção ({production_revision}) não pertence à cadeia desta release: '
            'a release é mais antiga que o banco ou o schema derivou. Nada foi alterado.')
    pending = [rev for rev in graph if rev != production_revision and production_revision in _ancestors(graph, rev)]
    # Ordem topológica: pais antes dos filhos.
    ordered = []
    while pending:
        # Pronta = nenhum pai dela ainda espera na fila (pais fora da fila já estão aplicados).
        ready = sorted(rev for rev in pending if not set(graph[rev]['down']) & set(pending))
        if not ready:
            raise ReleaseRefused('Cadeia de migrações com ciclo ou ramificação sem merge')
        ordered.extend(ready)
        pending = [rev for rev in pending if rev not in ready]
    return ordered


# --------------------------------------------------------------------------- manifesto

def build_manifest(sha, digest, ci_proof, versions_dir, repository=IMAGE_REPOSITORY, built_at=None):
    if not _SHA.fullmatch(sha or ''):
        raise ReleaseRefused('SHA precisa ter 40 caracteres hexadecimais')
    if not _DIGEST.fullmatch(digest or ''):
        raise ReleaseRefused('Digest da imagem inválido')
    validate_ci_proof(ci_proof, sha, sha[:12])
    return {'manifest_version': MANIFEST_VERSION, 'release': sha[:12], 'sha': sha,
            'image': {'repository': repository, 'digest': digest, 'ref': f'{repository}@{digest}'},
            'ci_run': ci_proof['html_url'],
            'built_at': built_at or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'migrations': scan_migrations(versions_dir), 'rehearsal': None}


def validate_manifest(manifest, release):
    if not isinstance(manifest, dict) or manifest.get('manifest_version') != MANIFEST_VERSION:
        raise ReleaseRefused('Manifesto da release ausente ou de versão desconhecida')
    sha = manifest.get('sha', '')
    if not _SHA.fullmatch(sha) or sha[:12] != release or manifest.get('release') != release:
        raise ReleaseRefused('Manifesto não corresponde à release informada')
    image = manifest.get('image') or {}
    if image.get('repository') != IMAGE_REPOSITORY:
        raise ReleaseRefused('Imagem fora do registro autorizado')
    if not _DIGEST.fullmatch(image.get('digest', '')) or image.get('ref') != f"{IMAGE_REPOSITORY}@{image['digest']}":
        raise ReleaseRefused('Digest da imagem inválido no manifesto')
    migrations = manifest.get('migrations') or {}
    if migrations.get('head') not in (migrations.get('graph') or {}):
        raise ReleaseRefused('Manifesto sem grafo de migrações')
    return manifest


def attach_rehearsal(manifest, rehearsal):
    updated = dict(manifest)
    updated['rehearsal'] = rehearsal
    return updated


# --------------------------------------------------------------------------- plano

@dataclass
class Plan:
    kind: str                       # 'no-migration' | 'migrate'
    production_revision: str
    head_revision: str
    pending: list = field(default_factory=list)
    destructive: bool = False
    data_migration: bool = False
    reversible: object = None       # None quando não há migração; bool vindo do ensaio
    auto_downgrade: bool = False    # rollback automático pode rodar `flask db downgrade`
    rehearsal_required: bool = False

    def to_dict(self):
        return asdict(self)


def _parse_time(value):
    return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)


def validate_rehearsal(rehearsal, manifest, production_revision, head, now=None):
    where = 'Ensaio de migração ausente: esta release traz migração nova e ela só entra depois de ensaiada ' \
            'no schema da produção (workflow migration-rehearsal)'
    if not isinstance(rehearsal, dict):
        raise ReleaseRefused(where)
    if rehearsal.get('ok') is not True:
        raise ReleaseRefused('Ensaio de migração não passou')
    if rehearsal.get('schema_source') != SCHEMA_SOURCE_PRODUCTION:
        raise ReleaseRefused('Ensaio não usou o schema da produção (schema_source diverge)')
    if rehearsal.get('sha') != manifest['sha'] or rehearsal.get('image_digest') != manifest['image']['digest']:
        raise ReleaseRefused('Ensaio é de outra imagem/commit')
    if rehearsal.get('head_revision') != head:
        raise ReleaseRefused('Ensaio terminou em outra revisão (head diverge)')
    if rehearsal.get('from_revision') != production_revision:
        raise ReleaseRefused(
            f"Ensaio partiu da revisão {rehearsal.get('from_revision')} e a produção está em {production_revision}: "
            'refaça o ensaio com um retrato atual do schema')
    if not isinstance(rehearsal.get('reversible'), bool):
        raise ReleaseRefused('Ensaio não informa se a migração é reversível')
    try:
        age = (now or datetime.now(timezone.utc)) - _parse_time(rehearsal['snapshot_taken_at'])
    except (KeyError, ValueError, TypeError):
        raise ReleaseRefused('Ensaio sem data do retrato do schema') from None
    if age.total_seconds() > REHEARSAL_MAX_AGE_HOURS * 3600:
        raise ReleaseRefused(f'Retrato do schema tem mais de {REHEARSAL_MAX_AGE_HOURS} h: refaça o ensaio')


def plan_migration(production_revision, manifest, accept_destructive=False, now=None):
    """Decide o que a release exige, a partir do banco REAL de produção.

    Regra 1 (sem migração nova): revisão do banco == head da imagem. Não precisa de ensaio;
    o que garante a release é o CI verde no SHA exato (validado à parte) e a imagem por digest.
    Regra 2 (migração nova): exige ensaio aprovado no schema da produção, para o mesmo
    commit/digest, partindo da revisão atual. Migração destrutiva exige aceite explícito.
    Revisão desconhecida ou à frente da imagem: recusa.
    """
    migrations = manifest['migrations']
    head = migrations['head']
    if production_revision == head:
        return Plan('no-migration', production_revision, head)
    pending = pending_revisions(migrations, production_revision)
    graph = migrations['graph']
    destructive = any(graph[rev]['destructive_ops'] for rev in pending)
    data_migration = any(graph[rev]['data_ops'] for rev in pending)
    validate_rehearsal(manifest.get('rehearsal'), manifest, production_revision, head, now=now)
    if destructive and not accept_destructive:
        ops = sorted({op for rev in pending for op in graph[rev]['destructive_ops']})
        raise ReleaseRefused(
            'Migração destrutiva (' + ', '.join(ops) + '): só em release próprio, com o código antigo já tolerante, '
            'e com --accept-destructive. O rollback automático não desfaz dados apagados.')
    reversible = manifest['rehearsal']['reversible']
    return Plan('migrate', production_revision, head, pending, destructive, data_migration, reversible,
                auto_downgrade=reversible and not destructive and not data_migration, rehearsal_required=True)


def counts_regressed(before, after):
    """Contagens só podem crescer (a loja vende durante a troca); cair é perda de dados."""
    return sorted(table for table, value in before.items() if after.get(table, 0) < value)


# --------------------------------------------------------------------------- CLI (Actions)

def _load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    build = sub.add_parser('manifest')
    build.add_argument('--sha', required=True)
    build.add_argument('--digest', required=True)
    build.add_argument('--ci-proof', required=True)
    build.add_argument('--versions', required=True)
    build.add_argument('--out', required=True)
    attach = sub.add_parser('attach-rehearsal')
    attach.add_argument('--manifest', required=True)
    attach.add_argument('--rehearsal', required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'manifest':
            manifest = build_manifest(args.sha, args.digest, _load(args.ci_proof), args.versions)
            Path(args.out).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        else:
            manifest = validate_manifest(_load(args.manifest), _load(args.manifest)['release'])
            rehearsal = _load(args.rehearsal)
            if rehearsal.get('ok') is not True or rehearsal.get('sha') != manifest['sha']                     or rehearsal.get('image_digest') != manifest['image']['digest']:
                raise ReleaseRefused('Ensaio reprovado ou de outra imagem: não é anexado ao manifesto')
            Path(args.manifest).write_text(json.dumps(attach_rehearsal(manifest, rehearsal), indent=2),
                                           encoding='utf-8')
    except (ReleaseRefused, ValueError) as error:
        raise SystemExit('ERRO: ' + str(error))
    print(json.dumps({'ok': True, 'command': args.command}))


if __name__ == '__main__':
    main()
