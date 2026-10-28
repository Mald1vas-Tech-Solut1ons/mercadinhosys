"""configuracoes.bloquear_venda_vencido: a loja decide se o caixa recusa produto vencido.

Default TRUE mantém o comportamento atual (lote vencido em quarentena) e passa a
recusar também o produto sem lote com data de validade vencida.
Idempotente e reversível.
"""
from alembic import op
import sqlalchemy as sa

revision = 'b7d1e3f5a9c2'
down_revision = 'a2b4c6d8e0f1'
branch_labels = None
depends_on = None


def upgrade():
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('configuracoes')}
    if 'bloquear_venda_vencido' not in cols:
        with op.batch_alter_table('configuracoes') as lote:
            lote.add_column(sa.Column('bloquear_venda_vencido', sa.Boolean(), nullable=False,
                                      server_default=sa.true()))


def downgrade():
    with op.batch_alter_table('configuracoes') as lote:
        lote.drop_column('bloquear_venda_vencido')
