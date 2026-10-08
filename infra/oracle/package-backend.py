"""Package local source and seed code without credentials or generated data."""
from pathlib import Path
import os
import tarfile

root = Path(__file__).resolve().parents[2]
excluded_dirs = {'.git', '__pycache__', '.pytest_cache', 'venv', '.venv',
                 'instance', 'uploads', 'backups', 'logs', 'certs', 'tmp', 'node_modules'}
excluded_suffixes = {'.env', '.key', '.pem', '.p12', '.pfx', '.db', '.sqlite', '.sqlite3', '.log', '.pyc'}
with tarfile.open(root / 'scratch/oracle-backend.tar.gz', 'w:gz') as archive:
    for directory, dirs, names in os.walk(root / 'backend'):
        dirs[:] = [name for name in dirs if name not in excluded_dirs]
        for name in names:
            path = Path(directory) / name
            if name.startswith('.env') or path.suffix.lower() in excluded_suffixes:
                continue
            archive.add(path, arcname=path.relative_to(root), recursive=False)
    archive.add(root / 'infra/oracle/compose.demo.yml', arcname='infra/oracle/compose.demo.yml')
print('Created scratch/oracle-backend.tar.gz')
