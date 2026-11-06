"""alarga sync_queue.operacao para varchar(50)

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-24

A coluna era varchar(10), dimensionada só para 'insert/update/delete'. O endpoint
A replicação gravava um código de operação de 18 caracteres no log de sync,
estourando o limite (StringDataRightTruncation) e causando 500 — o que impedia o
a replicação local→nuvem de rodar (removida em f2b4d6a8c0e1). Idempotente.
"""
from alembic import op
import sqlalchemy as sa


revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    col = next((c for c in sa.inspect(bind).get_columns("sync_queue") if c["name"] == "operacao"), None)
    if col is not None and getattr(col["type"], "length", None) != 50:
        op.alter_column(
            "sync_queue", "operacao",
            type_=sa.String(length=50), existing_type=sa.String(length=10),
            existing_nullable=False,
        )


def downgrade():
    # Não reduz de volta: truncaria valores existentes. No-op seguro.
    pass
