"""Permissões configuráveis por ação (configuracoes.politica_acoes, JSON) e local da loja
para validar o raio do ponto (configuracoes_horario.latitude_loja/longitude_loja).

Migração expansiva e idempotente: coluna nula = loja usa os padrões de
app/services/politica_acoes.py; a versão anterior da aplicação ignora a coluna.
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4f6a8b0c2e4'
down_revision = 'c3e5a7b9d1f2'
branch_labels = None
depends_on = None


def upgrade():
    existentes = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('configuracoes')}
    if 'politica_acoes' not in existentes:
        with op.batch_alter_table('configuracoes') as lote:
            lote.add_column(sa.Column('politica_acoes', sa.Text(), nullable=True))
    existentes = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('configuracoes_horario')}
    with op.batch_alter_table('configuracoes_horario') as lote:
        for nome in ('latitude_loja', 'longitude_loja'):
            if nome not in existentes:
                lote.add_column(sa.Column(nome, sa.Float(), nullable=True))


def downgrade():
    existentes = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('configuracoes_horario')}
    with op.batch_alter_table('configuracoes_horario') as lote:
        for nome in ('latitude_loja', 'longitude_loja'):
            if nome in existentes:
                lote.drop_column(nome)
    existentes = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('configuracoes')}
    if 'politica_acoes' in existentes:
        with op.batch_alter_table('configuracoes') as lote:
            lote.drop_column('politica_acoes')
