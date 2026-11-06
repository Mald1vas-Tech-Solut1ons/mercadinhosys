"""Produção: prazo de validade na ficha e estorno de ordem encerrada (aditiva: só cria colunas).

Revision ID: b8d4f0a2c3e5
Revises: a7c3e9f1b2d4
"""
from alembic import op
import sqlalchemy as sa

revision = 'b8d4f0a2c3e5'
down_revision = 'a7c3e9f1b2d4'
branch_labels = None
depends_on = None


def _colunas(tabela):
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(tabela)}


def upgrade():
    if 'validade_dias' not in _colunas('fichas_tecnicas'):
        with op.batch_alter_table('fichas_tecnicas') as lote:
            lote.add_column(sa.Column('validade_dias', sa.Integer(), nullable=True))
    existentes = _colunas('ordens_producao')
    with op.batch_alter_table('ordens_producao') as lote:
        if 'data_estorno' not in existentes:
            lote.add_column(sa.Column('data_estorno', sa.DateTime(), nullable=True))
        if 'motivo_estorno' not in existentes:
            lote.add_column(sa.Column('motivo_estorno', sa.String(200), nullable=True))
        if 'estornada_por_id' not in existentes:
            lote.add_column(sa.Column('estornada_por_id', sa.Integer(), nullable=True))


def downgrade():
    existentes = _colunas('ordens_producao')
    with op.batch_alter_table('ordens_producao') as lote:
        for coluna in ('estornada_por_id', 'motivo_estorno', 'data_estorno'):
            if coluna in existentes:
                lote.drop_column(coluna)
    if 'validade_dias' in _colunas('fichas_tecnicas'):
        with op.batch_alter_table('fichas_tecnicas') as lote:
            lote.drop_column('validade_dias')
