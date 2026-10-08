"""Histórico de baixas e deduplicação por tenant, sem reescrever títulos existentes."""
from alembic import op
import sqlalchemy as sa

revision = 'f5d7b9c1e3a6'
down_revision = 'f4c6a8b0d2e4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('contas_pagar_baixas',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
        sa.Column('conta_pagar_id', sa.Integer(), sa.ForeignKey('contas_pagar.id'), nullable=False),
        sa.Column('despesa_id', sa.Integer(), sa.ForeignKey('despesas.id'), nullable=False, unique=True),
        sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id'), nullable=False),
        sa.Column('valor', sa.Numeric(19, 4), nullable=False),
        sa.Column('data_pagamento', sa.Date(), nullable=False),
        sa.Column('idempotency_key', sa.String(128)),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('resposta_json', sa.JSON(), nullable=False),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('estabelecimento_id', 'idempotency_key', name='uq_baixa_tenant_key'))
    op.create_index('ix_contas_pagar_baixas_estabelecimento_id', 'contas_pagar_baixas', ['estabelecimento_id'])
    op.create_index('ix_contas_pagar_baixas_conta_pagar_id', 'contas_pagar_baixas', ['conta_pagar_id'])


def downgrade():
    op.drop_table('contas_pagar_baixas')
