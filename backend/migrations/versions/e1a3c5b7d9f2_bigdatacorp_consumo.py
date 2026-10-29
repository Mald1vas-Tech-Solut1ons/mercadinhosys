"""BigDataCorp: contador mensal (consumo_api_externa), limite por serviço (config_api_externa) e resposta bruta no catálogo.

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
    if 'config_api_externa' not in insp.get_table_names():
        op.create_table(
            'config_api_externa',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('provedor', sa.String(60), nullable=False, unique=True),
            sa.Column('limite_mensal', sa.Integer(), nullable=False, server_default='500'),
            sa.Column('ativo', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('atualizado_por', sa.Integer(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
    existentes = {c['name'] for c in insp.get_columns('catalogo_mestre')}
    with op.batch_alter_table('catalogo_mestre') as lote:
        if 'payload_bigdatacorp' not in existentes:
            lote.add_column(sa.Column('payload_bigdatacorp', sa.Text(), nullable=True))
        if 'familia_produto' not in existentes:
            lote.add_column(sa.Column('familia_produto', sa.String(40), nullable=True))
    indices = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('catalogo_mestre')}
    if 'ix_catalogo_mestre_familia_produto' not in indices:
        op.create_index('ix_catalogo_mestre_familia_produto', 'catalogo_mestre', ['familia_produto'])


def downgrade():
    insp = sa.inspect(op.get_bind())
    existentes = {c['name'] for c in insp.get_columns('catalogo_mestre')}
    indices = {i['name'] for i in insp.get_indexes('catalogo_mestre')}
    if 'ix_catalogo_mestre_familia_produto' in indices:
        op.drop_index('ix_catalogo_mestre_familia_produto', table_name='catalogo_mestre')
    with op.batch_alter_table('catalogo_mestre') as lote:
        for coluna in ('familia_produto', 'payload_bigdatacorp'):
            if coluna in existentes:
                lote.drop_column(coluna)
    for tabela in ('config_api_externa', 'consumo_api_externa'):
        if tabela in insp.get_table_names():
            op.drop_table(tabela)
