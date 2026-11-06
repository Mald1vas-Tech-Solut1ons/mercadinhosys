"""remove a sincronização híbrida (local -> Aiven): tabelas sync_queue e sync_heartbeat

A replicação para a nuvem saiu do sistema (05/11/2026): produção é um PostgreSQL só, no Oracle.
`sync_queue` só acumulava cópias completas de registros (inclusive dados de cliente) que nenhum
processo consumia (todas "pendente"); `sync_heartbeat` nunca recebeu linha. O downgrade recria
as estruturas vazias.

Revision ID: f2b4d6a8c0e1
Revises: e1a3c5e7b9d2
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa


revision = "f2b4d6a8c0e1"
down_revision = "e1a3c5e7b9d2"
branch_labels = None
depends_on = None


def upgrade():
    tabelas = set(sa.inspect(op.get_bind()).get_table_names())
    if "sync_queue" in tabelas:
        op.drop_table("sync_queue")
    if "sync_heartbeat" in tabelas:
        op.drop_table("sync_heartbeat")


def downgrade():
    tabelas = set(sa.inspect(op.get_bind()).get_table_names())
    if "sync_queue" not in tabelas:
        op.create_table(
            "sync_queue",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("estabelecimento_id", sa.Integer(), sa.ForeignKey("estabelecimentos.id"), nullable=False),
            sa.Column("tabela", sa.String(length=50), nullable=False),
            sa.Column("registro_id", sa.Integer(), nullable=False),
            sa.Column("operacao", sa.String(length=50), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=True),
            sa.Column("tentativas", sa.Integer(), nullable=True),
            sa.Column("mensagem_erro", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("synced_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_sync_queue_status", "sync_queue", ["status"])
        op.create_index("ix_sync_queue_created", "sync_queue", ["created_at"])
    if "sync_heartbeat" not in tabelas:
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
