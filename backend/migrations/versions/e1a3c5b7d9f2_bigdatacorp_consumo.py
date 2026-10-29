"""BigDataCorp: contador mensal de consultas (consumo_api_externa) e resposta bruta no catálogo.

Migração expansiva e idempotente: tabela nova e coluna nula; a versão anterior ignora as duas.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e1a3c5b7d9f2'
down_revision = 'd4f6a8b0c2e4'
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    if 'consumo_api_externa' not in insp.get_table_names():
        op.create_table(
            'consumo_api_externa',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('provedor', sa.String(30), nullable=False),
            sa.Column('mes', sa.String(7), nullable=False),
            sa.Column('consultas', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('encontrados', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('provedor', 'mes', name='uq_consumo_api_provedor_mes'),
        )
    existentes = {c['name'] for c in insp.get_columns('catalogo_mestre')}
    if 'payload_bigdatacorp' not in existentes:
        with op.batch_alter_table('catalogo_mestre') as lote:
            lote.add_column(sa.Column('payload_bigdatacorp', sa.Text(), nullable=True))


def downgrade():
    insp = sa.inspect(op.get_bind())
    existentes = {c['name'] for c in insp.get_columns('catalogo_mestre')}
    if 'payload_bigdatacorp' in existentes:
        with op.batch_alter_table('catalogo_mestre') as lote:
            lote.drop_column('payload_bigdatacorp')
    if 'consumo_api_externa' in insp.get_table_names():
        op.drop_table('consumo_api_externa')
