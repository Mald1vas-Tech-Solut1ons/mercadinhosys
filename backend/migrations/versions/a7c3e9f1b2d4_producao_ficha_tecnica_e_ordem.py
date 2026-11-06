"""Produção própria: papel do produto, ficha técnica e ordem de produção (aditiva: só cria).

Revision ID: a7c3e9f1b2d4
Revises: f2b4d6a8c0e1
"""
from alembic import op
import sqlalchemy as sa

revision = 'a7c3e9f1b2d4'
down_revision = 'f2b4d6a8c0e1'
branch_labels = None
depends_on = None


def _tabelas():
    return set(sa.inspect(op.get_bind()).get_table_names())


def _audit():
    return [sa.Column('created_at', sa.DateTime()), sa.Column('updated_at', sa.DateTime()),
            sa.Column('sync_uuid', sa.String(36), nullable=False, unique=True)]


def _loja():
    return sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'),
                     nullable=False, index=True)


def upgrade():
    colunas = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('produtos')}
    if 'papel_producao' not in colunas:
        with op.batch_alter_table('produtos') as lote:
            lote.add_column(sa.Column('papel_producao', sa.String(20), nullable=True))
    tabelas = _tabelas()
    if 'fichas_tecnicas' not in tabelas:
        op.create_table(
            'fichas_tecnicas',
            sa.Column('id', sa.Integer(), primary_key=True),
            _loja(),
            sa.Column('produto_id', sa.Integer(), sa.ForeignKey('produtos.id'), nullable=False, index=True),
            sa.Column('rendimento', sa.Numeric(14, 3), nullable=False),
            sa.Column('minutos_mao_de_obra', sa.Numeric(10, 2), nullable=False, server_default='0'),
            sa.Column('custo_hora_mao_de_obra', sa.Numeric(12, 2), nullable=False, server_default='0'),
            sa.Column('custo_indireto_percentual', sa.Numeric(6, 2), nullable=False, server_default='0'),
            sa.Column('markup_percentual', sa.Numeric(7, 2), nullable=False, server_default='100'),
            sa.Column('observacoes', sa.Text()),
            sa.Column('ativa', sa.Boolean(), nullable=False, server_default=sa.true()),
            *_audit(),
            sa.UniqueConstraint('estabelecimento_id', 'produto_id', name='uq_ficha_estab_produto'),
        )
    if 'ficha_tecnica_itens' not in tabelas:
        op.create_table(
            'ficha_tecnica_itens',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('ficha_id', sa.Integer(), sa.ForeignKey('fichas_tecnicas.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('insumo_id', sa.Integer(), sa.ForeignKey('produtos.id'), nullable=False, index=True),
            sa.Column('quantidade', sa.Numeric(14, 4), nullable=False),
            sa.Column('perda_percentual', sa.Numeric(6, 2), nullable=False, server_default='0'),
        )
    if 'ordens_producao' not in tabelas:
        op.create_table(
            'ordens_producao',
            sa.Column('id', sa.Integer(), primary_key=True),
            _loja(),
            sa.Column('numero', sa.String(30), nullable=False),
            sa.Column('ficha_id', sa.Integer(), sa.ForeignKey('fichas_tecnicas.id'), nullable=False, index=True),
            sa.Column('produto_id', sa.Integer(), sa.ForeignKey('produtos.id'), nullable=False, index=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='planejada'),
            sa.Column('quantidade_planejada', sa.Numeric(14, 3), nullable=False),
            sa.Column('quantidade_produzida', sa.Numeric(14, 3)),
            sa.Column('quantidade_refugo', sa.Numeric(14, 3)),
            sa.Column('motivo_refugo', sa.String(200)),
            sa.Column('rendimento_ficha', sa.Numeric(14, 3), nullable=False),
            sa.Column('minutos_mao_de_obra', sa.Numeric(12, 2), nullable=False, server_default='0'),
            sa.Column('custo_hora_mao_de_obra', sa.Numeric(12, 2), nullable=False, server_default='0'),
            sa.Column('custo_indireto_percentual', sa.Numeric(6, 2), nullable=False, server_default='0'),
            sa.Column('custo_unitario_padrao', sa.Numeric(19, 4)),
            sa.Column('custo_material_real', sa.Numeric(19, 4)),
            sa.Column('custo_mao_de_obra_real', sa.Numeric(19, 4)),
            sa.Column('custo_indireto_real', sa.Numeric(19, 4)),
            sa.Column('custo_unitario_real', sa.Numeric(19, 4)),
            sa.Column('lote_id', sa.Integer(), sa.ForeignKey('produto_lotes.id')),
            sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id')),
            sa.Column('data_inicio', sa.DateTime()),
            sa.Column('data_encerramento', sa.DateTime()),
            sa.Column('observacoes', sa.Text()),
            *_audit(),
            sa.UniqueConstraint('estabelecimento_id', 'numero', name='uq_op_estab_numero'),
        )
    if 'ordem_producao_itens' not in tabelas:
        op.create_table(
            'ordem_producao_itens',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('ordem_id', sa.Integer(), sa.ForeignKey('ordens_producao.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('insumo_id', sa.Integer(), sa.ForeignKey('produtos.id'), nullable=False, index=True),
            sa.Column('quantidade_prevista', sa.Numeric(14, 4), nullable=False),
            sa.Column('quantidade_consumida', sa.Numeric(14, 4)),
            sa.Column('custo_unitario', sa.Numeric(19, 4)),
            sa.Column('movimentacao_id', sa.Integer(), sa.ForeignKey('movimentacoes_estoque.id')),
        )


def downgrade():
    tabelas = _tabelas()
    for nome in ('ordem_producao_itens', 'ordens_producao', 'ficha_tecnica_itens', 'fichas_tecnicas'):
        if nome in tabelas:
            op.drop_table(nome)
    colunas = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('produtos')}
    if 'papel_producao' in colunas:
        with op.batch_alter_table('produtos') as lote:
            lote.drop_column('papel_producao')
