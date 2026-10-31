"""contagem ciclica: tabelas contagem_ciclica e contagem_ciclica_itens (FASE 3.1)

Feature "O que sumiu". Reusa movimentacoes_estoque para as perdas — a tabela nova
guarda só a contagem e a decisão do dono por divergência.

Índice único parcial (estabelecimento_id, nome) WHERE status='aberta': uma seção não
pode ter duas contagens abertas ao mesmo tempo. SQLite e Postgres aceitam o índice
parcial; a migração cria nas duas.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a4c8f1b2d6e9'
# A 9c4e1a7b6d20 (largura das chaves de categorias_produto) também saiu de
# f3b5d7e9a1c3: encadear nela mantém UMA cabeça de migração (o CI falha com duas).
down_revision = '9c4e1a7b6d20'
branch_labels = None
depends_on = None


def _tem_tabela(nome):
    return sa.inspect(op.get_bind()).has_table(nome)


def upgrade():
    if not _tem_tabela('contagem_ciclica'):
        op.create_table(
            'contagem_ciclica',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('estabelecimento_id', sa.Integer(),
                      sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('nome', sa.String(80), nullable=False),
            sa.Column('status', sa.String(20), nullable=False, server_default='aberta'),
            sa.Column('data_abertura', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('data_aplicacao', sa.DateTime(), nullable=True),
            sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id'), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.Column('sync_uuid', sa.String(36), nullable=True),
        )
        op.create_index('ix_contagem_ciclica_estabelecimento_id', 'contagem_ciclica', ['estabelecimento_id'])
        op.create_index('ix_contagem_estab_status', 'contagem_ciclica', ['estabelecimento_id', 'status'])

    colunas = [c['name'] for c in sa.inspect(op.get_bind()).get_columns('contagem_ciclica')]
    if 'sync_uuid' in colunas:
        # SQLite não aceita ADD CONSTRAINT depois do CREATE; o unique vira índice único.
        op.create_index('uq_contagem_ciclica_sync_uuid', 'contagem_ciclica', ['sync_uuid'], unique=True)

    if not _tem_tabela('contagem_ciclica_itens'):
        op.create_table(
            'contagem_ciclica_itens',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('estabelecimento_id', sa.Integer(),
                      sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('contagem_id', sa.Integer(),
                      sa.ForeignKey('contagem_ciclica.id'), nullable=False),
            sa.Column('produto_id', sa.Integer(), sa.ForeignKey('produtos.id'), nullable=False),
            sa.Column('quantidade_esperada', sa.Numeric(10, 3), nullable=False, server_default='0'),
            sa.Column('quantidade_contada', sa.Numeric(10, 3), nullable=False, server_default='0'),
            sa.Column('divergencia', sa.Numeric(10, 3), nullable=True),
            sa.Column('decisao', sa.String(20), nullable=True),
            sa.Column('movimentacao_id', sa.Integer(),
                      sa.ForeignKey('movimentacoes_estoque.id'), nullable=True),
            sa.Column('fora_da_secao', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.Column('sync_uuid', sa.String(36), nullable=True),
        )
        op.create_index('ix_contagem_ciclica_itens_estabelecimento_id', 'contagem_ciclica_itens',
                        ['estabelecimento_id'])
        op.create_index('ix_contagem_ciclica_itens_contagem_id', 'contagem_ciclica_itens', ['contagem_id'])
        op.create_index('ix_contagem_ciclica_itens_produto_id', 'contagem_ciclica_itens', ['produto_id'])
        op.create_index('ix_contagem_item_contagem', 'contagem_ciclica_itens', ['contagem_id', 'produto_id'])

    if 'sync_uuid' in [c['name'] for c in sa.inspect(op.get_bind()).get_columns('contagem_ciclica_itens')]:
        op.create_index('uq_contagem_ciclica_itens_sync_uuid', 'contagem_ciclica_itens', ['sync_uuid'], unique=True)

    # Uma seção aberta por vez. Parcial: só vale para status='aberta'.
    indices = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('contagem_ciclica')}
    if 'uq_contagem_aberta' not in indices:
        op.create_index(
            'uq_contagem_aberta', 'contagem_ciclica', ['estabelecimento_id', 'nome'],
            unique=True, postgresql_where=sa.text("status = 'aberta'"),
            sqlite_where=sa.text("status = 'aberta'"),
        )


def downgrade():
    if _tem_tabela('contagem_ciclica_itens'):
        op.drop_table('contagem_ciclica_itens')
    if _tem_tabela('contagem_ciclica'):
        op.drop_table('contagem_ciclica')
