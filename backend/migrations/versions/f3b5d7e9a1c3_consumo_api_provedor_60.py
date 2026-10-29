"""consumo_api_externa.provedor de 30 para 60 caracteres.

"bigdatacorp:current_pricing_data" tem 32: o INSERT do contador falhava no Postgres (o SQLite
dos testes não aplica o tamanho) e a consulta à BigDataCorp não saía. Migração só amplia.
"""
from alembic import op
import sqlalchemy as sa

revision = 'f3b5d7e9a1c3'
down_revision = 'e1a3c5b7d9f2'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('consumo_api_externa') as lote:
        lote.alter_column('provedor', existing_type=sa.String(30), type_=sa.String(60), existing_nullable=False)


def downgrade():
    with op.batch_alter_table('consumo_api_externa') as lote:
        lote.alter_column('provedor', existing_type=sa.String(60), type_=sa.String(30), existing_nullable=False)
