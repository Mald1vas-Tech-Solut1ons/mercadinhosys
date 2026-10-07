"""Create a verified baseline for an empty PostgreSQL database only.

Historical migrations retrofit an existing schema and cannot construct a fresh
database. Current SQLAlchemy metadata constructs the baseline; future changes
remain managed by Alembic. This script refuses databases with existing tables.
"""
import os
os.environ['SKIP_DB_SETUP'] = 'true'
os.environ['SKIP_SCHEMA_SYNC'] = 'true'
os.environ['SKIP_SYNC_LISTENERS'] = '1'
from app import create_app
from app.models import db
from sqlalchemy import inspect
from flask_migrate import stamp

app = create_app('production')
with app.app_context():
    if db.engine.dialect.name != 'postgresql':
        raise RuntimeError('Expected PostgreSQL; refusing another database.')
    existing = inspect(db.engine).get_table_names()
    if existing:
        raise RuntimeError(f'Database is not empty: {len(existing)} tables. Refusing baseline.')
    db.create_all()
    inspector = inspect(db.engine)
    for table in db.metadata.sorted_tables:
        actual = {column['name'] for column in inspector.get_columns(table.name)}
        expected = {column.name for column in table.columns}
        if expected - actual:
            raise RuntimeError(f'Missing columns in {table.name}: {expected - actual}')
    stamp(revision='head')
    print(f'BASELINE_OK: {len(db.metadata.tables)} tables; columns verified; Alembic stamped at head.')
