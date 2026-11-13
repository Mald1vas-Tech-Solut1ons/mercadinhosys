"""Testes do release: regras puras, orquestração da VM (host falso) e ensaio de migração.

Nenhum teste toca produção, Docker ou rede: `FakeHost` simula Docker/Postgres/compose da VM e
`FakeRehearsal` simula o PostgreSQL do ensaio.
    python -m unittest discover -s infra/oracle -p "test_release*.py" -v
"""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import io
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import migration_rehearsal as mr  # noqa: E402
import release_plan as rp  # noqa: E402

_spec = importlib.util.spec_from_file_location('release_vm', HERE / 'release.py')
vm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vm)

SHA = 'b' * 40
RELEASE = SHA[:12]
DIGEST = 'sha256:' + 'a' * 64
REF = f'{rp.IMAGE_REPOSITORY}@{DIGEST}'
NEW_ID = 'sha256:' + '1' * 64
OLD_ID = 'sha256:' + '2' * 64
NOW = datetime(2026, 11, 13, 12, 0, 0, tzinfo=timezone.utc)
FRESH = (NOW - timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')


def graph(**flags):
    """A -> B -> C (head). flags: ops por revisão, ex. B_destructive=['drop_table']."""
    return {'head': 'C', 'graph': {
        'A': {'down': [], 'destructive_ops': [], 'data_ops': []},
        'B': {'down': ['A'], 'destructive_ops': flags.get('B_destructive', []), 'data_ops': flags.get('B_data', [])},
        'C': {'down': ['B'], 'destructive_ops': [], 'data_ops': []}}}


def rehearsal(**over):
    base = {'ok': True, 'sha': SHA, 'release': RELEASE, 'image_digest': DIGEST, 'schema_source': rp.SCHEMA_SOURCE_PRODUCTION,
            'snapshot_taken_at': FRESH, 'from_revision': 'A', 'head_revision': 'C', 'pending': ['B', 'C'],
            'reversible': True}
    base.update(over)
    return base


def manifest(rehearsal_data=None, **flags):
    return {'manifest_version': 1, 'release': RELEASE, 'sha': SHA,
            'image': {'repository': rp.IMAGE_REPOSITORY, 'digest': DIGEST, 'ref': REF},
            'ci_run': rp.CI_RUN_URL_PREFIX + '1', 'built_at': FRESH, 'migrations': graph(**flags),
            'rehearsal': rehearsal_data}


def ci_proof(**over):
    base = {'path': rp.CI_WORKFLOW_PATH, 'head_sha': SHA, 'head_branch': 'master', 'event': 'push',
            'status': 'completed', 'conclusion': 'success', 'html_url': rp.CI_RUN_URL_PREFIX + '42'}
    base.update(over)
    return base


class CiProof(unittest.TestCase):
    def test_accepts_exact_sha_green_push_on_master(self):
        self.assertTrue(rp.validate_ci_proof(ci_proof(), SHA, RELEASE).endswith('/42'))

    def test_accepts_proof_without_optional_fields_like_old_format(self):
        proof = {k: v for k, v in ci_proof().items() if k not in ('head_branch', 'event')}
        rp.validate_ci_proof(proof, SHA, RELEASE)

    def test_refuses_each_violation(self):
        cases = {'outro commit': ci_proof(head_sha='c' * 40), 'não concluído': ci_proof(status='in_progress'),
                 'vermelho': ci_proof(conclusion='failure'), 'outro workflow': ci_proof(path='.github/workflows/x.yml'),
                 'outro repositório': ci_proof(html_url='https://github.com/evil/repo/actions/runs/1'),
                 'run de PR': ci_proof(event='pull_request'), 'outra branch': ci_proof(head_branch='feature')}
        for name, proof in cases.items():
            with self.subTest(name), self.assertRaises(rp.ReleaseRefused):
                rp.validate_ci_proof(proof, SHA, RELEASE)

    def test_refuses_release_that_is_not_the_sha_prefix(self):
        with self.assertRaises(rp.ReleaseRefused):
            rp.validate_ci_proof(ci_proof(), SHA, 'cccccccccccc')


class MigrationScan(unittest.TestCase):
    def write(self, folder, name, body):
        (Path(folder) / name).write_text(body, encoding='utf-8')

    def test_real_repository_chain_has_one_head_and_flags_known_destructive_migrations(self):
        scan = rp.scan_migrations(HERE.parents[1] / 'backend/migrations/versions')
        self.assertIn(scan['head'], scan['graph'])
        self.assertEqual(scan['graph']['f2b4d6a8c0e1']['destructive_ops'], ['drop_table'])  # incidente de 06/11
        self.assertEqual(scan['graph']['f8efae926d7f']['destructive_ops'], ['drop_column'])
        self.assertEqual(scan['graph']['d4a8c2e6f0b1']['destructive_ops'], [])  # venda por dose é aditiva

    def test_scan_sees_drops_inside_batch_ops_and_raw_sql_but_not_in_downgrade(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, 'a.py', "revision = 'a1'\ndown_revision = None\n"
                       "def upgrade():\n    with op.batch_alter_table('t') as b:\n        b.drop_column('x')\n"
                       "    op.execute('DELETE FROM t')\n"
                       "def downgrade():\n    op.drop_table('t')\n")
            self.write(folder, 'b.py', "revision: str = 'b1'\ndown_revision = 'a1'\n"
                       "def upgrade():\n    op.add_column('t', None)\n    op.execute(\"UPDATE t SET x = 1\")\n"
                       "    op.alter_column('t', 'x', type_=None)\n"
                       "def downgrade():\n    op.drop_column('t', 'x')\n")
            self.write(folder, 'c.py', "revision = 'c1'\ndown_revision = 'b1'\n"
                       "def upgrade():\n    op.create_table('n')\n    op.create_index('i', 'n', ['a'])\n"
                       "def downgrade():\n    op.drop_table('n')\n")
            scan = rp.scan_migrations(folder)
        self.assertEqual(scan['head'], 'c1')
        self.assertEqual(scan['graph']['a1']['destructive_ops'], ['drop_column', 'sql_destrutivo'])
        self.assertEqual(scan['graph']['b1']['destructive_ops'], [])
        self.assertEqual(scan['graph']['b1']['data_ops'], ['alter_column_tipo', 'sql_dados'])
        self.assertEqual(scan['graph']['c1'], {'down': ['b1'], 'destructive_ops': [], 'data_ops': [], 'file': 'c.py'})

    def test_two_heads_or_dangling_parent_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, 'a.py', "revision = 'a1'\ndown_revision = None\n")
            self.write(folder, 'b.py', "revision = 'b1'\ndown_revision = 'a1'\n")
            self.write(folder, 'c.py', "revision = 'c1'\ndown_revision = 'a1'\n")
            with self.assertRaises(ValueError):
                rp.scan_migrations(folder)
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, 'a.py', "revision = 'a1'\ndown_revision = 'zz'\n")
            with self.assertRaises(ValueError):
                rp.scan_migrations(folder)

    def test_pending_order_with_merge_revision(self):
        migrations = {'head': 'M', 'graph': {
            'A': {'down': [], 'destructive_ops': [], 'data_ops': []},
            'L': {'down': ['A'], 'destructive_ops': [], 'data_ops': []},
            'R': {'down': ['A'], 'destructive_ops': [], 'data_ops': []},
            'M': {'down': ['L', 'R'], 'destructive_ops': [], 'data_ops': []}}}
        self.assertEqual(rp.pending_revisions(migrations, 'A'), ['L', 'R', 'M'])
        self.assertEqual(rp.pending_revisions(migrations, 'L'), ['M'])


class MigrationRule(unittest.TestCase):
    """Regra 4: sem migração nova = sem ensaio, mas CI verde no SHA exato e imagem por digest."""

    def test_no_new_migration_needs_no_rehearsal(self):
        plan = rp.plan_migration('C', manifest(None), now=NOW)
        self.assertEqual((plan.kind, plan.pending, plan.rehearsal_required, plan.auto_downgrade),
                         ('no-migration', [], False, False))

    def test_no_new_migration_ignores_a_stale_or_failed_rehearsal(self):
        plan = rp.plan_migration('C', manifest(rehearsal(ok=False)), now=NOW)
        self.assertEqual(plan.kind, 'no-migration')

    def test_new_migration_without_rehearsal_is_refused(self):
        with self.assertRaisesRegex(rp.ReleaseRefused, 'Ensaio de migração ausente'):
            rp.plan_migration('A', manifest(None), now=NOW)

    def test_new_migration_with_valid_rehearsal_is_planned(self):
        plan = rp.plan_migration('A', manifest(rehearsal()), now=NOW)
        self.assertEqual((plan.kind, plan.pending, plan.reversible, plan.auto_downgrade),
                         ('migrate', ['B', 'C'], True, True))

    def test_rehearsal_must_match_exact_image_commit_revision_and_source(self):
        for name, over in {'falhou': {'ok': False}, 'sintético': {'schema_source': 'synthetic-create-all'},
                           'outra imagem': {'image_digest': 'sha256:' + 'f' * 64}, 'outro commit': {'sha': 'c' * 40},
                           'outro head': {'head_revision': 'B'}, 'outra origem': {'from_revision': 'B'},
                           'sem reversível': {'reversible': None}, 'sem data': {'snapshot_taken_at': None}}.items():
            with self.subTest(name), self.assertRaises(rp.ReleaseRefused):
                rp.plan_migration('A', manifest(rehearsal(**over)), now=NOW)

    def test_old_schema_snapshot_is_refused(self):
        old = (NOW - timedelta(hours=rp.REHEARSAL_MAX_AGE_HOURS + 1)).strftime('%Y-%m-%dT%H:%M:%SZ')
        with self.assertRaisesRegex(rp.ReleaseRefused, 'refaça'):
            rp.plan_migration('A', manifest(rehearsal(snapshot_taken_at=old)), now=NOW)

    def test_production_ahead_of_or_unknown_to_the_image_is_refused(self):
        with self.assertRaisesRegex(rp.ReleaseRefused, 'não pertence à cadeia'):
            rp.plan_migration('Z', manifest(rehearsal()), now=NOW)

    def test_destructive_requires_explicit_acceptance_and_never_auto_downgrades(self):
        data = manifest(rehearsal(), B_destructive=['drop_table'])
        with self.assertRaisesRegex(rp.ReleaseRefused, 'destrutiva'):
            rp.plan_migration('A', data, now=NOW)
        plan = rp.plan_migration('A', data, accept_destructive=True, now=NOW)
        self.assertTrue(plan.destructive)
        self.assertFalse(plan.auto_downgrade)

    def test_data_migration_and_irreversible_do_not_auto_downgrade(self):
        self.assertFalse(rp.plan_migration('A', manifest(rehearsal(), B_data=['sql_dados']), now=NOW).auto_downgrade)
        self.assertFalse(rp.plan_migration('A', manifest(rehearsal(reversible=False)), now=NOW).auto_downgrade)

    def test_counts_may_grow_but_never_shrink(self):
        self.assertEqual(rp.counts_regressed({'vendas': 10, 'produtos': 5}, {'vendas': 12, 'produtos': 5}), [])
        self.assertEqual(rp.counts_regressed({'vendas': 10, 'produtos': 5}, {'vendas': 10, 'produtos': 4}), ['produtos'])


class Manifest(unittest.TestCase):
    def test_build_attach_and_validate_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'a.py').write_text("revision = 'a1'\ndown_revision = None\n")
            built = rp.build_manifest(SHA, DIGEST, ci_proof(), folder, built_at=FRESH)
        self.assertEqual(built['image']['ref'], REF)
        attached = rp.attach_rehearsal(built, rehearsal())
        self.assertEqual(rp.validate_manifest(attached, RELEASE)['rehearsal']['from_revision'], 'A')

    def test_build_refuses_bad_digest_sha_or_proof(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'a.py').write_text("revision = 'a1'\ndown_revision = None\n")
            for sha, digest, proof in [('x', DIGEST, ci_proof()), (SHA, 'latest', ci_proof()),
                                       (SHA, DIGEST, ci_proof(conclusion='failure'))]:
                with self.assertRaises(rp.ReleaseRefused):
                    rp.build_manifest(sha, digest, proof, folder)

    def test_cli_attach_accepts_matching_rehearsal_and_refuses_other_image(self):
        with tempfile.TemporaryDirectory() as folder:
            path, rehearsal_path = Path(folder, 'm.json'), Path(folder, 'r.json')
            path.write_text(json.dumps(manifest()))
            rehearsal_path.write_text(json.dumps(rehearsal()))
            rp.main(['attach-rehearsal', '--manifest', str(path), '--rehearsal', str(rehearsal_path)])
            self.assertEqual(json.loads(path.read_text())['rehearsal']['from_revision'], 'A')
            for over in ({'image_digest': 'sha256:' + 'f' * 64}, {'ok': False}, {'sha': 'c' * 40}):
                rehearsal_path.write_text(json.dumps(rehearsal(**over)))
                with self.assertRaises(SystemExit):
                    rp.main(['attach-rehearsal', '--manifest', str(path), '--rehearsal', str(rehearsal_path)])

    def test_validate_manifest_refuses_foreign_registry_and_wrong_release(self):
        data = manifest()
        data['image'] = {'repository': 'docker.io/evil/img', 'digest': DIGEST, 'ref': 'docker.io/evil/img@' + DIGEST}
        with self.assertRaises(rp.ReleaseRefused):
            rp.validate_manifest(data, RELEASE)
        with self.assertRaises(rp.ReleaseRefused):
            rp.validate_manifest(manifest(), 'cccccccccccc')


# --------------------------------------------------------------------------- orquestração da VM

class FakeHost:
    """Simula a VM: containers, imagens, Postgres (revisão e contagens) e docker compose."""

    def __init__(self, revision='C'):
        self.revision, self.counts = revision, {'estabelecimentos': 3, 'funcionarios': 9, 'produtos': 100,
                                                'vendas': 500, 'contas_pagar': 7}
        self.active_image, self.commands, self.pulled = OLD_ID, [], False
        self.fail_upgrade = False
        self.free_disk = 10 * 1024 ** 3
        self.label = SHA
        self.digests = [REF]
        self.shrink_after_upgrade = False

    def sleep(self, seconds):
        pass

    def monotonic(self):
        return 0

    def disk_free(self):
        return self.free_disk

    def sha256(self, path):
        import hashlib
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()

    def names(self):
        return [c[0] for c in self.commands]

    def docker(self, *command, data=None, stdin_path=None, stdout_path=None):
        self.commands.append(command)
        if command[0] == 'inspect':
            if command[1] == vm.BACKEND:
                return json.dumps([{'Image': self.active_image}]).encode()
            if command[1] == 'mercadinhosys-backend:' + RELEASE and self.pulled:
                return json.dumps([{'Id': NEW_ID, 'RepoDigests': self.digests,
                                    'Config': {'Labels': {vm.REVISION_LABEL: self.label}}}]).encode()
            raise RuntimeError('inspect de algo inexistente: ' + command[1])
        if command[0] in ('pull', 'load'):
            self.pulled = True
            return b''
        if command[0] == 'tag' and command[1] == 'mercadinhosys-backend:local':
            self.pulled = True
            return b''
        if command[0] == 'exec':
            if 'psql' in command:
                sql = command[-1]
                if 'alembic_version' in sql:
                    return (self.revision + '\n').encode()
                return json.dumps(self.counts).encode()
            if 'pg_dump' in command:
                Path(stdout_path).write_bytes(b'PGDMP-fake-dump')
                return b''
            if 'pg_restore' in command:
                assert Path(stdin_path).read_bytes().startswith(b'PGDMP')
                return b''
        if command[0] == 'compose':
            files = [command[i + 1] for i, part in enumerate(command) if part == '-f']
            override = Path(files[-1])
            tail = command[command.index(str(override)) + 1:]
            if tail[:1] == ('up',):
                self.active_image = NEW_ID if 'image: mercadinhosys-backend:' + RELEASE in override.read_text() \
                    else OLD_ID
            elif 'upgrade' in tail:
                if self.fail_upgrade:
                    self.revision = 'B'  # falhou no meio: B aplicada, C não
                    raise RuntimeError('migração falhou')
                self.revision = 'C'
                if self.shrink_after_upgrade:
                    self.counts = dict(self.counts, produtos=1)
            elif 'downgrade' in tail:
                self.revision = tail[-1]
        return b''

    def http(self, *args, **kwargs):
        raise AssertionError('smoke deve estar substituído')


class ReleaserUnderTest(vm.Releaser):
    """Troca o smoke estrito por um roteiro: falha onde o teste mandar."""

    fail_on = ()

    def smoke(self, base, database='mercadinhosys', strict=True):
        self.host.commands.append(('smoke', base, strict))
        if base in self.fail_on and strict:
            raise self.fail_with
        return None

    fail_with = RuntimeError('API não ficou saudável dentro do prazo')


class VmCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root, self.live = base / 'releases' / RELEASE, base / 'live'
        self.root.mkdir(parents=True)
        (self.live / 'infra/oracle').mkdir(parents=True)
        (self.live / 'backend').mkdir()
        self.addCleanup(self.tmp.cleanup)
        quiet = mock.patch('sys.stdout', io.StringIO())  # o release.py imprime JSON de progresso
        quiet.start()
        self.addCleanup(quiet.stop)

    def releaser(self, host, data=None, proof=None, **kwargs):
        (self.root / 'release-manifest.json').write_text(json.dumps(data or manifest()), encoding='utf-8')
        # BOM de propósito: o PowerShell gera assim.
        (self.root / 'ci-proof.json').write_text('\ufeff' + json.dumps(proof or ci_proof()), encoding='utf-8')
        return ReleaserUnderTest(host, RELEASE, self.root, self.live, local_url='local', public_url='public', **kwargs)


class DeployWithoutMigration(VmCase):
    def test_pulls_by_digest_backs_up_swaps_and_never_builds_or_stages(self):
        host = FakeHost('C')
        result = self.releaser(host).deploy()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(host.active_image, NEW_ID)
        self.assertIn(('pull', REF), host.commands)
        self.assertNotIn('build', host.names())
        flat = ' '.join(' '.join(c) for c in host.commands if c[0] != 'smoke')
        self.assertNotIn('flask db upgrade', flat)
        self.assertNotIn('createdb', flat)  # nenhum clone do banco na VM
        self.assertIn(('smoke', 'local', True), host.commands)
        self.assertIn(('smoke', 'public', True), host.commands)
        self.assertTrue((self.root / 'database-before.dump').stat().st_size > 0)
        self.assertEqual(json.loads((self.root / 'deploy-result.json').read_text())['plan']['kind'], 'no-migration')
        self.assertEqual(json.loads((self.live / '.release.json').read_text())['status'], 'deployed')

    def test_stage_waived_marker_is_not_a_way_around_the_rehearsal(self):
        (self.root / 'stage-result.json').write_text(json.dumps({'stage_waived': True, 'stage_passed': True,
                                                                  'release': RELEASE}))
        host = FakeHost('A')  # banco atrasado: a release traz migração
        with self.assertRaisesRegex(rp.ReleaseRefused, 'Ensaio de migração ausente'):
            self.releaser(host).deploy()
        self.assertNotIn('pull', host.names())
        self.assertEqual(host.active_image, OLD_ID)

    def test_wrong_ci_proof_refuses_before_touching_anything(self):
        host = FakeHost('C')
        with self.assertRaises(rp.ReleaseRefused):
            self.releaser(host, proof=ci_proof(head_sha='c' * 40)).deploy()
        self.assertEqual([c for c in host.names() if c in ('pull', 'compose')], [])

    def test_image_with_other_revision_label_is_refused(self):
        host = FakeHost('C')
        host.label = 'c' * 40
        with self.assertRaisesRegex(rp.ReleaseRefused, 'revisão'):
            self.releaser(host).deploy()
        self.assertEqual(host.active_image, OLD_ID)

    def test_image_not_from_manifest_digest_is_refused(self):
        host = FakeHost('C')
        host.digests = [rp.IMAGE_REPOSITORY + '@sha256:' + 'e' * 64]
        with self.assertRaisesRegex(rp.ReleaseRefused, 'digest'):
            self.releaser(host).deploy()

    def test_low_disk_refuses_before_pull(self):
        host = FakeHost('C')
        host.free_disk = 1024
        with self.assertRaisesRegex(rp.ReleaseRefused, 'livres'):
            self.releaser(host).deploy()
        self.assertNotIn('pull', host.names())

    def test_expected_image_mismatch_refuses(self):
        host = FakeHost('C')
        with self.assertRaisesRegex(rp.ReleaseRefused, 'divergiu'):
            self.releaser(host, expected_image='sha256:' + '9' * 64).deploy()
        self.assertEqual(host.active_image, OLD_ID)

    def test_already_deployed_release_is_a_noop(self):
        host = FakeHost('C')
        host.active_image = NEW_ID
        self.assertEqual(self.releaser(host).deploy(), {'status': 'already-deployed'})
        self.assertFalse(any(c[0] == 'compose' and 'up' in c for c in host.commands))

    def test_public_smoke_failure_restores_old_image_without_touching_schema(self):
        host = FakeHost('C')
        releaser = self.releaser(host)
        releaser.fail_on = ('public',)
        with self.assertRaisesRegex(RuntimeError, 'imagem anterior restaurada'):
            releaser.deploy()
        self.assertEqual(host.active_image, OLD_ID)
        self.assertEqual(host.revision, 'C')
        self.assertFalse(any('downgrade' in c for c in host.commands))
        self.assertEqual(json.loads((self.root / 'deploy-result.json').read_text())['status'], 'rolled-back')

    def test_release_metadata_failure_does_not_roll_back(self):
        host = FakeHost('C')
        (self.live / '.release.json').mkdir()  # escrever vira OSError, como o arquivo de root de 30/10
        result = self.releaser(host).deploy()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(host.active_image, NEW_ID)

    def test_sigterm_during_swap_still_rolls_back(self):
        host = FakeHost('C')
        releaser = self.releaser(host)
        releaser.fail_on, releaser.fail_with = ('local',), KeyboardInterrupt()
        with self.assertRaisesRegex(RuntimeError, 'imagem anterior restaurada'):
            releaser.deploy()
        self.assertEqual(host.active_image, OLD_ID)

    def test_row_count_drop_after_swap_rolls_back(self):
        self.count_activity(drop=True)

    def test_row_count_growth_during_swap_is_normal_activity(self):
        host = self.count_activity(drop=False)
        self.assertEqual(host.active_image, NEW_ID)

    def count_activity(self, drop):
        host = FakeHost('C')
        releaser = self.releaser(host)
        calls = {'n': 0}
        original = host.docker

        def docker(*command, **kwargs):
            if command[0] == 'exec' and 'psql' in command and 'json_build_object' in command[-1]:
                calls['n'] += 1
                if calls['n'] == 2 and drop:  # 1ª leitura = baseline; 2ª = depois da troca
                    host.counts = dict(host.counts, vendas=1)
                else:
                    host.counts = dict(host.counts, vendas=host.counts['vendas'] + 1)
            return original(*command, **kwargs)
        host.docker = docker
        if not drop:
            self.assertEqual(releaser.deploy()['status'], 'deployed')
            return host
        with self.assertRaisesRegex(RuntimeError, 'imagem anterior restaurada'):
            releaser.deploy()
        self.assertEqual(host.active_image, OLD_ID)
        return host


class DeployWithMigration(VmCase):
    def migrating(self, host, data):
        return self.releaser(host, data=data)

    def test_reversible_migration_is_applied_then_swapped(self):
        host = FakeHost('A')
        result = self.migrating(host, manifest(rehearsal())).deploy()
        self.assertEqual((result['status'], host.revision, host.active_image), ('deployed', 'C', NEW_ID))
        self.assertEqual(result['plan']['pending'], ['B', 'C'])
        # a migração roda ANTES da troca da imagem (expand-first)
        names = [' '.join(str(x) for x in c) for c in host.commands]
        self.assertLess(next(i for i, n in enumerate(names) if 'db upgrade' in n),
                        next(i for i, n in enumerate(names) if ' up -d' in n))

    def test_reversible_migration_failure_downgrades_automatically(self):
        host = FakeHost('A')
        releaser = self.migrating(host, manifest(rehearsal(reversible=True)))
        releaser.fail_on = ('public',)
        with self.assertRaisesRegex(RuntimeError, 'revertido'):
            releaser.deploy()
        self.assertEqual((host.revision, host.active_image), ('A', OLD_ID))
        downgrade = [c for c in host.commands if c[0] == 'compose' and 'downgrade' in c]
        self.assertEqual(len(downgrade), 1)
        self.assertEqual(downgrade[0][-1], 'A')
        # o novo backend para ANTES do downgrade e o antigo só sobe depois
        names = [' '.join(c) for c in host.commands if c[0] == 'compose']
        stop = next(i for i, n in enumerate(names) if n.endswith('stop backend'))
        down = next(i for i, n in enumerate(names) if 'downgrade' in n)
        last_up = max(i for i, n in enumerate(names) if ' up -d' in n)
        self.assertTrue(stop < down < last_up)

    def test_irreversible_migration_failure_restores_image_only(self):
        host = FakeHost('A')
        releaser = self.migrating(host, manifest(rehearsal(reversible=False)))
        releaser.fail_on = ('local',)
        with self.assertRaisesRegex(RuntimeError, 'migrado-mantido'):
            releaser.deploy()
        self.assertEqual((host.revision, host.active_image), ('C', OLD_ID))
        self.assertFalse(any('downgrade' in c for c in host.commands))

    def test_data_migration_is_never_auto_downgraded_even_if_reversible(self):
        host = FakeHost('A')
        releaser = self.migrating(host, manifest(rehearsal(reversible=True), B_data=['sql_dados']))
        releaser.fail_on = ('public',)
        with self.assertRaises(RuntimeError):
            releaser.deploy()
        self.assertFalse(any('downgrade' in c for c in host.commands))
        self.assertEqual(host.revision, 'C')

    def test_destructive_is_refused_before_any_change_without_acceptance(self):
        host = FakeHost('A')
        with self.assertRaisesRegex(rp.ReleaseRefused, 'destrutiva'):
            self.migrating(host, manifest(rehearsal(), B_destructive=['drop_table'])).deploy()
        self.assertEqual([c for c in host.names() if c in ('pull', 'compose')], [])
        self.assertFalse((self.root / 'database-before.dump').exists())

    def test_destructive_accepted_still_does_not_auto_downgrade(self):
        host = FakeHost('A')
        releaser = self.releaser(host, data=manifest(rehearsal(reversible=True), B_destructive=['drop_table']),
                                 accept_destructive=True)
        releaser.fail_on = ('public',)
        with self.assertRaisesRegex(RuntimeError, 'migrado-mantido'):
            releaser.deploy()
        self.assertFalse(any('downgrade' in c for c in host.commands))
        self.assertTrue((self.root / 'database-before.dump').exists())  # backup para restauração manual

    def test_migration_that_fails_midway_is_downgraded_when_reversible(self):
        host = FakeHost('A')
        host.fail_upgrade = True  # termina em B
        with self.assertRaisesRegex(RuntimeError, 'revertido'):
            self.migrating(host, manifest(rehearsal())).deploy()
        self.assertEqual((host.revision, host.active_image), ('A', OLD_ID))

    def test_migration_that_shrinks_counts_never_swaps_the_image(self):
        host = FakeHost('A')
        host.shrink_after_upgrade = True
        with self.assertRaisesRegex(RuntimeError, 'imagem anterior restaurada'):
            self.migrating(host, manifest(rehearsal())).deploy()
        self.assertEqual(host.active_image, OLD_ID)
        self.assertFalse(any(c[0] == 'compose' and ' '.join(c).endswith('up -d --no-deps --no-build backend')
                             and 'release-image.yml' in ' '.join(c) for c in host.commands))

    def test_rehearsal_from_other_revision_is_refused(self):
        host = FakeHost('B')  # produção avançou depois do ensaio (partia de A)
        with self.assertRaisesRegex(rp.ReleaseRefused, 'refaça o ensaio'):
            self.migrating(host, manifest(rehearsal())).deploy()


class ManualRollbackAndLock(VmCase):
    def deployed_then_failed(self, reversible):
        host = FakeHost('A')
        releaser = self.releaser(host, data=manifest(rehearsal(reversible=reversible)))
        releaser.deploy()
        return host, releaser

    def test_manual_rollback_restores_image_only_by_default(self):
        host, releaser = self.deployed_then_failed(True)
        releaser.rollback()
        self.assertEqual((host.active_image, host.revision), (OLD_ID, 'C'))

    def test_manual_rollback_with_downgrade_only_when_reversible(self):
        host, releaser = self.deployed_then_failed(True)
        releaser.rollback(downgrade=True)
        self.assertEqual((host.active_image, host.revision), (OLD_ID, 'A'))

    def test_manual_downgrade_is_refused_for_irreversible_release(self):
        host, releaser = self.deployed_then_failed(False)
        with self.assertRaises(rp.ReleaseRefused):
            releaser.rollback(downgrade=True)
        self.assertEqual(host.active_image, NEW_ID)

    def test_legacy_rollback_json_without_plan_still_restores_the_image(self):
        host = FakeHost('C')
        host.active_image = NEW_ID
        (self.root / 'rollback.json').write_text(json.dumps({'previous_image': OLD_ID, 'counts_before': {}}))
        self.releaser(host).rollback()
        self.assertEqual(host.active_image, OLD_ID)

    def test_second_operation_is_refused_while_the_first_holds_the_lock(self):
        releaser = self.releaser(FakeHost('C'))
        with releaser.lock('deploy'):
            with self.assertRaisesRegex(rp.ReleaseRefused, 'em andamento'):
                with releaser.lock('deploy'):
                    pass
        with releaser.lock('deploy'):  # liberado ao sair
            pass

    @unittest.skipUnless(os.name == 'posix', 'detecção de lock órfão é só do host Linux')
    def test_stale_lock_of_dead_process_is_taken_over(self):
        releaser = self.releaser(FakeHost('C'))
        (self.root.parent / '.release.lock').write_text('999999999 deploy x\n')
        with releaser.lock('deploy'):
            pass


# --------------------------------------------------------------------------- ensaio de migração

SNAPSHOT = ('-- SNAPSHOT_TAKEN_AT: 2026-11-13T11:00:00Z\n-- ALEMBIC_VERSION: A\n'
            'CREATE TABLE alembic_version (version_num varchar(32) NOT NULL);\nCREATE TABLE produtos (id int);\n')


class FakeRehearsal(mr.Rehearsal):
    def __init__(self, downgrade='ok', health_ok=True, upgrade_ok=True, **kwargs):
        super().__init__('img', SHA, DIGEST, kwargs.pop('snapshot', SNAPSHOT), graph(), log=lambda *_: None, **kwargs)
        self.rev, self.extra, self.mode = None, '', downgrade
        self.health_ok, self.upgrade_ok, self.calls = health_ok, upgrade_ok, []

    def psql(self, database, sql=None, data=None):
        self.calls.append(('psql', sql))
        if sql and 'INSERT INTO alembic_version' in sql:
            self.rev = sql.split("VALUES ('")[1].split("'")[0]
        if sql and sql.startswith('SELECT version_num'):
            return (self.rev or '') + '\n'
        return ''

    def dump(self, database):
        return '-- header que muda\n\\restrict abc\n' + SNAPSHOT.split('\n', 2)[2] + self.extra

    def flask(self, *args):
        self.calls.append(('flask', *args))
        if args[:2] == ('db', 'upgrade'):
            if not self.upgrade_ok:
                raise mr.RehearsalFailed('upgrade quebrou')
            self.rev, self.extra = 'C', 'ALTER TABLE produtos ADD COLUMN x int;\n'
        elif args[:2] == ('db', 'downgrade'):
            if self.mode == 'falha':
                raise mr.RehearsalFailed('downgrade quebrou')
            self.rev = args[2]
            self.extra = '' if self.mode == 'ok' else 'ALTER TABLE produtos ADD COLUMN sobrou int;\n'
        return ''

    def boot_health(self, port=5055, deadline=180):
        if not self.health_ok:
            raise mr.RehearsalFailed('API da imagem não ficou saudável')
        return {'status': 'degraded', 'database': 'connected'}


class RehearsalEngine(unittest.TestCase):
    def test_reversible_migration_is_proven_by_identical_schema_after_downgrade(self):
        result = FakeRehearsal('ok').run()
        self.assertTrue(result['ok'])
        self.assertEqual((result['reversible'], result['reversible_reason'], result['reupgrade_ok']),
                         (True, 'schema-identico', True))
        self.assertEqual((result['from_revision'], result['head_revision'], result['pending']), ('A', 'C', ['B', 'C']))
        self.assertEqual(result['schema_source'], rp.SCHEMA_SOURCE_PRODUCTION)
        self.assertEqual(result['snapshot_taken_at'], '2026-11-13T11:00:00Z')

    def test_the_rehearsal_result_is_accepted_by_the_release_rule(self):
        result = FakeRehearsal('ok').run()
        result['snapshot_taken_at'] = FRESH
        plan = rp.plan_migration('A', manifest(result), now=NOW)
        self.assertTrue(plan.auto_downgrade)

    def test_downgrade_leaving_schema_different_is_not_reversible(self):
        result = FakeRehearsal('sobra').run()
        self.assertTrue(result['ok'])
        self.assertEqual((result['reversible'], result['reversible_reason']), (False, 'schema-diferente'))

    def test_failing_downgrade_is_not_reversible_but_does_not_fail_the_rehearsal(self):
        result = FakeRehearsal('falha').run()
        self.assertTrue(result['ok'])
        self.assertEqual((result['reversible'], result['reversible_reason']), (False, 'downgrade-falhou'))

    def test_upgrade_failure_fails_the_rehearsal_and_drops_the_scratch_database(self):
        engine = FakeRehearsal(upgrade_ok=False)
        result = engine.run()
        self.assertFalse(result['ok'])
        self.assertIn('upgrade quebrou', result['error'])
        self.assertTrue(any(c[0] == 'psql' and c[1] and c[1].startswith('DROP DATABASE') for c in engine.calls))

    def test_unhealthy_api_with_migrated_database_fails(self):
        self.assertFalse(FakeRehearsal(health_ok=False).run()['ok'])

    def test_snapshot_with_data_aborts_before_touching_the_database(self):
        for line in ('COPY produtos (id) FROM stdin;', "INSERT INTO produtos VALUES (1);"):
            engine = FakeRehearsal(snapshot=SNAPSHOT + line + '\n')
            with self.assertRaisesRegex(mr.RehearsalFailed, 'dados'):
                engine.run()
            self.assertEqual(engine.calls, [])

    def test_snapshot_without_header_is_rejected(self):
        with self.assertRaises(mr.RehearsalFailed):
            FakeRehearsal(snapshot='CREATE TABLE x (id int);\n').run()

    def test_already_at_head_only_proves_the_app_boots(self):
        engine = FakeRehearsal(snapshot=SNAPSHOT.replace('ALEMBIC_VERSION: A', 'ALEMBIC_VERSION: C'))
        result = engine.run()
        self.assertTrue(result['ok'])
        self.assertEqual((result['pending'], result['reversible']), ([], None))
        self.assertFalse(any(c[0] == 'flask' for c in engine.calls))

    def test_normalize_ignores_comments_and_restrict_tokens(self):
        self.assertEqual(mr.normalize_schema('-- a\n\\restrict x\nSELECT 1;\n\n'), mr.normalize_schema('\\restrict y\nSELECT 1;'))


if __name__ == '__main__':
    unittest.main()
