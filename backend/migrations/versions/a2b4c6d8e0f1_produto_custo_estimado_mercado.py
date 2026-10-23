"""Custo estimado + precificação pelo mercado (Fase A).

Colunas novas:
- produtos.origem_custo (informado|estimado|rateio_lote), preco_referencia_mercado,
  fonte_referencia_mercado, referencia_mercado_em;
- configuracoes.desconto_mercado_padrao_pct (15.00) e margem_alvo_venda_pct (50.00),
  por loja;
- venda_itens.custo_estimado: snapshot — True quando, na venda, o produto tinha
  origem_custo != "informado".

Princípio: custo estimado nunca se passa por custo real.
Idempotente e reversível; server_default nas NOT NULL novas para não quebrar
tabelas já populadas.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a2b4c6d8e0f1'
down_revision = 'd1f3b5c7e9a2'
branch_labels = None
depends_on = None


def _colunas(tabela):
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(tabela)}


def upgrade():
    cols = _colunas('produtos')
    if not {'origem_custo', 'preco_referencia_mercado', 'fonte_referencia_mercado',
            'referencia_mercado_em'} <= cols:
        with op.batch_alter_table('produtos') as lote:
            if 'origem_custo' not in cols:
                lote.add_column(sa.Column('origem_custo', sa.String(20), nullable=False,
                                          server_default='informado'))
            if 'preco_referencia_mercado' not in cols:
                lote.add_column(sa.Column('preco_referencia_mercado', sa.Numeric(19, 4), nullable=True))
            if 'fonte_referencia_mercado' not in cols:
                lote.add_column(sa.Column('fonte_referencia_mercado', sa.String(20), nullable=True))
            if 'referencia_mercado_em' not in cols:
                lote.add_column(sa.Column('referencia_mercado_em', sa.Date(), nullable=True))

    cols_cfg = _colunas('configuracoes')
    if 'desconto_mercado_padrao_pct' not in cols_cfg or 'margem_alvo_venda_pct' not in cols_cfg:
        with op.batch_alter_table('configuracoes') as lote:
            if 'desconto_mercado_padrao_pct' not in cols_cfg:
                lote.add_column(sa.Column('desconto_mercado_padrao_pct',
                                          sa.Numeric(5, 2), nullable=False,
                                          server_default='15.00'))
            if 'margem_alvo_venda_pct' not in cols_cfg:
                lote.add_column(sa.Column('margem_alvo_venda_pct',
                                          sa.Numeric(5, 2), nullable=False,
                                          server_default='50.00'))

    if 'custo_estimado' not in _colunas('venda_itens'):
        with op.batch_alter_table('venda_itens') as lote:
            lote.add_column(sa.Column('custo_estimado', sa.Boolean(), nullable=False,
                                      server_default=sa.false()))


def downgrade():
    with op.batch_alter_table('venda_itens') as lote:
        lote.drop_column('custo_estimado')
    with op.batch_alter_table('configuracoes') as lote:
        lote.drop_column('margem_alvo_venda_pct')
        lote.drop_column('desconto_mercado_padrao_pct')
    with op.batch_alter_table('produtos') as lote:
        lote.drop_column('referencia_mercado_em')
        lote.drop_column('fonte_referencia_mercado')
        lote.drop_column('preco_referencia_mercado')
        lote.drop_column('origem_custo')