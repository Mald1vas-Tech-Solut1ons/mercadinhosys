"""Grade real: cada número/cor é um Produto vendável ligado a um modelo-pai.

- produtos.produto_pai_id: variação aponta para o modelo (nullable);
- produtos.atributos_variante: JSON {"numeracao": "38", "cor": "Preto"};
- produtos.eh_grade_modelo: o modelo não é vendido nem conta estoque (fica inativo).

Expansiva, idempotente e reversível: produto existente segue igual.
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3e5a7b9d1f2'
down_revision = 'b7d1e3f5a9c2'
branch_labels = None
depends_on = None


def upgrade():
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('produtos')}
    with op.batch_alter_table('produtos') as lote:
        if 'produto_pai_id' not in cols:
            lote.add_column(sa.Column('produto_pai_id', sa.Integer(), nullable=True))
            lote.create_foreign_key('fk_produto_pai', 'produtos', ['produto_pai_id'], ['id'])
            lote.create_index('ix_produto_pai', ['produto_pai_id'])
        if 'atributos_variante' not in cols:
            lote.add_column(sa.Column('atributos_variante', sa.Text(), nullable=True))
        if 'eh_grade_modelo' not in cols:
            lote.add_column(sa.Column('eh_grade_modelo', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table('produtos') as lote:
        lote.drop_column('eh_grade_modelo')
        lote.drop_column('atributos_variante')
        lote.drop_index('ix_produto_pai')
        lote.drop_constraint('fk_produto_pai', type_='foreignkey')
        lote.drop_column('produto_pai_id')
