"""Vínculo documental de NF-e ao pedido; sem reprocessar estoque ou títulos legados."""
from alembic import op
import sqlalchemy as sa

revision = 'f9b2c4d6e8a0'
down_revision = 'f7a9c1e3b5d8'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {c['name'] for c in inspector.get_columns('notas_fiscais_entrada')}
    fks = {c['name'] for c in inspector.get_foreign_keys('notas_fiscais_entrada')}
    uniques = {c['name'] for c in inspector.get_unique_constraints('notas_fiscais_entrada')}
    with op.batch_alter_table('notas_fiscais_entrada') as batch:
        if 'pedido_compra_id' not in columns:
            batch.add_column(sa.Column('pedido_compra_id', sa.Integer(), nullable=True))
        if 'fk_nfe_entrada_pedido' not in fks:
            batch.create_foreign_key('fk_nfe_entrada_pedido', 'pedidos_compra', ['pedido_compra_id'], ['id'])
        if 'uq_nfe_entrada_pedido' not in uniques:
            batch.create_unique_constraint('uq_nfe_entrada_pedido', ['pedido_compra_id'])


def downgrade():
    # Não apagar o vínculo silenciosamente: voltar a imagem antiga é compatível
    # com esta expansão. Remover schema com vínculos ativos exige reconciliação.
    bind = op.get_bind()
    if bind.execute(sa.text('SELECT count(*) FROM notas_fiscais_entrada WHERE pedido_compra_id IS NOT NULL')).scalar():
        raise RuntimeError('Há NF-e vinculada a pedido; reconcilie antes de remover o vínculo')
    with op.batch_alter_table('notas_fiscais_entrada') as batch:
        batch.drop_constraint('uq_nfe_entrada_pedido', type_='unique')
        batch.drop_constraint('fk_nfe_entrada_pedido', type_='foreignkey')
        batch.drop_column('pedido_compra_id')
