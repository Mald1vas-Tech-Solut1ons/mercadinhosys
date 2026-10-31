"""consultor telemetria (tokens e custo), opt-in lgpd (ai_consultor_ativo) e largura de produtos.subcategoria

Revision ID: c2e4f8a1b9d0
Revises: a4c8f1b2d6e9
Create Date: 2026-10-31 15:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'c2e4f8a1b9d0'
down_revision = 'a4c8f1b2d6e9'
branch_labels = None
depends_on = None


def _colunas(tabela):
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table(tabela):
        return {}
    return {c['name']: c for c in insp.get_columns(tabela)}


def upgrade():
    cols_interacao = _colunas('consultor_interacoes')
    if cols_interacao:
        with op.batch_alter_table('consultor_interacoes', schema=None) as batch_op:
            if 'prompt_tokens' not in cols_interacao:
                batch_op.add_column(sa.Column('prompt_tokens', sa.Integer(), nullable=False, server_default='0'))
            if 'completion_tokens' not in cols_interacao:
                batch_op.add_column(sa.Column('completion_tokens', sa.Integer(), nullable=False, server_default='0'))
            if 'custo_estimado_usd' not in cols_interacao:
                batch_op.add_column(sa.Column('custo_estimado_usd', sa.Numeric(10, 6), nullable=False, server_default='0'))

    cols_cfg = _colunas('configuracoes')
    if cols_cfg and 'ai_consultor_ativo' not in cols_cfg:
        with op.batch_alter_table('configuracoes', schema=None) as batch_op:
            batch_op.add_column(sa.Column('ai_consultor_ativo', sa.Boolean(), nullable=False, server_default=sa.true()))

    cols_prod = _colunas('produtos')
    sub_col = cols_prod.get('subcategoria')
    if sub_col is not None:
        atual = getattr(sub_col.get('type'), 'length', None)
        if atual is not None and atual < 80:
            op.alter_column(
                'produtos',
                'subcategoria',
                existing_type=sa.String(atual),
                type_=sa.String(80),
                existing_nullable=sub_col.get('nullable', True),
            )


def downgrade():
    cols_cfg = _colunas('configuracoes')
    if 'ai_consultor_ativo' in cols_cfg:
        with op.batch_alter_table('configuracoes', schema=None) as batch_op:
            batch_op.drop_column('ai_consultor_ativo')

    cols_interacao = _colunas('consultor_interacoes')
    if cols_interacao:
        with op.batch_alter_table('consultor_interacoes', schema=None) as batch_op:
            if 'custo_estimado_usd' in cols_interacao:
                batch_op.drop_column('custo_estimado_usd')
            if 'completion_tokens' in cols_interacao:
                batch_op.drop_column('completion_tokens')
            if 'prompt_tokens' in cols_interacao:
                batch_op.drop_column('prompt_tokens')
