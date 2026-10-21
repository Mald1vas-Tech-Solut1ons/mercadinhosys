"""Produto: marca de ICMS recolhido por substituição tributária (ST).

Com a marca ligada a NFC-e sai com CSOSN 500 (Simples) ou CST 60 (regime normal),
CFOP 5405 e CEST obrigatório.

Migração expansiva e idempotente: só adiciona uma coluna booleana anulável com
padrão falso. A versão anterior da aplicação continua funcionando com o esquema
novo (não lê a coluna) e todo produto existente fica sem ST, como já era.
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1f3b5c7e9a2'
down_revision = 'c8e0a2d4f6b1'
branch_labels = None
depends_on = None


def _colunas_produtos():
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns('produtos')}


def upgrade():
    if 'icms_st' not in _colunas_produtos():
        with op.batch_alter_table('produtos') as lote:
            lote.add_column(sa.Column('icms_st', sa.Boolean(), nullable=True, server_default=sa.false()))


def downgrade():
    if 'icms_st' in _colunas_produtos():
        with op.batch_alter_table('produtos') as lote:
            lote.drop_column('icms_st')
