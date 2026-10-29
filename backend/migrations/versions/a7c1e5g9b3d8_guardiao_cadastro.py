"""guardiao_cadastro — revisao de cadastro e origem

Travas do guardião do cadastro (qualidade sempre; fiscal depende do add-on):
- Produto.cadastro_pendente_revisao: produto salvo com estoque 0 por exceção
  consciente ("Entrar sem estoque agora") — Lista de Revisão no dashboard.
- Produto.origem_cadastro: como o produto entrou (bipagem BDC, bases abertas,
  catálogo, palavra, pallet/manual, importação) — métrica de qualidade e suporte.

Revision ID: a7c1e5g9b3d8
Revises: e1a3c5b7d9f2
Create Date: 2026-10-29

"""
from alembic import op
import sqlalchemy as sa

revision = 'a7c1e5g9b3d8'
down_revision = 'e1a3c5b7d9f2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('produtos', sa.Column('cadastro_pendente_revisao', sa.Boolean(), nullable=True,
                                        server_default=sa.text('false')))
    op.add_column('produtos', sa.Column('origem_cadastro', sa.String(20), nullable=True))
    op.create_index('ix_produtos_pendente_revisao', 'produtos', ['cadastro_pendente_revisao'])


def downgrade():
    op.drop_index('ix_produtos_pendente_revisao', table_name='produtos')
    op.drop_column('produtos', 'origem_cadastro')
    op.drop_column('produtos', 'cadastro_pendente_revisao')