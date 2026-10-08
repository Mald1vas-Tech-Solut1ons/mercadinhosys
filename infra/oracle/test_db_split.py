"""Garantias de corte: preservar origem e nunca voltar para dados obsoletos."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('split_database', Path(__file__).with_name('split-database.py'))
split = importlib.util.module_from_spec(spec)
spec.loader.exec_module(split)


class CutoverSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.folder = self.root / 'infra'
        self.folder.mkdir()
        self.source = {'vendas': {'count': 10, 'hash': 'original'}}
        self.calls = []
        self.restored = False
        self.patches = [patch.object(split, 'ROOT', self.root), patch.object(split, 'FOLDER', self.folder),
                        patch.object(split, 'info', return_value={'Image': 'sha256:validated', 'Config': {'Env': []}, 'State': {'Health': {'Status': 'healthy'}}}),
                        patch.object(split, 'sql', return_value='0'), patch.object(split, 'docker', side_effect=self.docker),
                        patch.object(split, 'compose', side_effect=self.compose),
                        patch.object(split, 'fingerprint', side_effect=self.fingerprint)]
        for p in self.patches:
            p.start()
        (self.root / 'stage-result.json').write_text(json.dumps({'stage_passed': True, 'backend_image': 'sha256:validated'}))

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def docker(self, *a, data=None):
        self.calls.append(('docker', *a))
        if 'pg_restore' in a and '--list' not in a:
            self.restored = True
        return b'validated-dump'

    def compose(self, mode, *a):
        self.calls.append(('compose', mode, *a))
        return b''

    def fingerprint(self, container, database=split.DATABASE):
        if container == split.CANDIDATE and not self.restored:
            return {}
        return self.source

    def test_different_image_refuses_cutover_before_stopping_traffic(self):
        (self.root / 'stage-result.json').write_text(json.dumps({'stage_passed': True, 'backend_image': 'sha256:other'}))
        with self.assertRaises(RuntimeError):
            split.cutover()
        self.assertEqual(self.calls, [])

    def test_existing_candidate_data_is_never_overwritten(self):
        self.restored = True
        with self.assertRaises(RuntimeError):
            split.cutover()
        self.assertEqual(self.calls, [])

    def test_local_failure_restores_origin_before_reopening_traffic(self):
        with patch.object(split, 'smoke', side_effect=[RuntimeError('local failed'), None]):
            with self.assertRaises(RuntimeError):
                split.cutover()
        rollback = [c for c in self.calls if c[0] == 'compose' and c[1] is False]
        self.assertEqual([c[-1] for c in rollback], ['postgres', 'backend'])
        self.assertFalse((self.folder / '.db-split-active').exists())
        self.assertEqual(self.calls[-1], ('docker', 'start', 'oracle-caddy-1'))
        self.assertTrue((self.root / 'database-before.dump').exists())

    def test_public_failure_after_reopening_preserves_new_database(self):
        with patch.object(split, 'smoke', side_effect=[None, RuntimeError('public failed')]):
            with self.assertRaises(RuntimeError):
                split.cutover()
        self.assertFalse(any(c[0] == 'compose' and c[1] is False for c in self.calls))
        self.assertTrue((self.folder / '.db-split-active').exists())
        self.assertTrue(json.loads((self.root / 'cutover-result.json').read_text())['traffic_reopened'])


if __name__ == '__main__':
    unittest.main()
