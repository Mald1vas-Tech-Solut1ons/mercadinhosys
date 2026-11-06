"""tabela sync_heartbeat (observabilidade da replicação local→nuvem; removida em f2b4d6a8c0e1)

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa


revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade():
    if "sync_heartbeat" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "sync_heartbeat",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("total_registros", sa.Integer(), nullable=True),
        sa.Column("duracao_segundos", sa.Numeric(10, 2), nullable=True),
        sa.Column("erro", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("sync_heartbeat")
