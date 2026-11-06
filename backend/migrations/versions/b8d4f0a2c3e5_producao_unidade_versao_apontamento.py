"""Produção profissional: unidade da receita, versões da ficha, apontamento parcial e estorno (aditiva).

Revision ID: b8d4f0a2c3e5
Revises: a7c3e9f1b2d4
"""
from alembic import op
import sqlalchemy as sa

revision = 'b8d4f0a2c3e5'
down_revision = 'a7c3e9f1b2d4'
branch_labels = None
depends_on = None


def _tabelas():
    return set(sa.inspect(op.get_bind()).get_table_names())


def _colunas(tabela):
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(tabela)}


def _audit():
    return [sa.Column('created_at', sa.DateTime()), sa.Column('updated_at', sa.DateTime()),
            sa.Column('sync_uuid', sa.String(36), nullable=False, unique=True)]


def _loja():
    return sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'),
                     nullable=False, index=True)


def upgrade():
    if 'versao' not in _colunas('fichas_tecnicas'):
        with op.batch_alter_table('fichas_tecnicas') as lote:
            lote.add_column(sa.Column('versao', sa.Integer(), nullable=False, server_default='1'))
    colunas = _colunas('ficha_tecnica_itens')
    with op.batch_alter_table('ficha_tecnica_itens') as lote:
        if 'quantidade_receita' not in colunas:
            lote.add_column(sa.Column('quantidade_receita', sa.Numeric(14, 4), nullable=True))
        if 'unidade_receita' not in colunas:
            lote.add_column(sa.Column('unidade_receita', sa.String(10), nullable=True))
    if 'ficha_versao' not in _colunas('ordens_producao'):
        with op.batch_alter_table('ordens_producao') as lote:
            lote.add_column(sa.Column('ficha_versao', sa.Integer(), nullable=True))

    tabelas = _tabelas()
    if 'ficha_tecnica_versoes' not in tabelas:
        op.create_table(
            'ficha_tecnica_versoes',
            sa.Column('id', sa.Integer(), primary_key=True),
            _loja(),
            sa.Column('ficha_id', sa.Integer(), sa.ForeignKey('fichas_tecnicas.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('versao', sa.Integer(), nullable=False),
            sa.Column('dados', sa.Text(), nullable=False),
            sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id'), nullable=True),
            *_audit(),
            sa.UniqueConstraint('ficha_id', 'versao', name='uq_ficha_versao'),
        )
    if 'apontamentos_producao' not in tabelas:
        op.create_table(
            'apontamentos_producao',
            sa.Column('id', sa.Integer(), primary_key=True),
            _loja(),
            sa.Column('ordem_id', sa.Integer(), sa.ForeignKey('ordens_producao.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('sequencia', sa.Integer(), nullable=False),
            sa.Column('final', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('quantidade_boa', sa.Numeric(14, 3), nullable=False, server_default='0'),
            sa.Column('quantidade_refugo', sa.Numeric(14, 3), nullable=False, server_default='0'),
            sa.Column('motivo_refugo', sa.String(200)),
            sa.Column('minutos_mao_de_obra', sa.Numeric(12, 2), nullable=False, server_default='0'),
            sa.Column('custo_material', sa.Numeric(19, 4), nullable=False, server_default='0'),
            sa.Column('custo_mao_de_obra', sa.Numeric(19, 4), nullable=False, server_default='0'),
            sa.Column('custo_indireto', sa.Numeric(19, 4), nullable=False, server_default='0'),
            sa.Column('custo_unitario', sa.Numeric(19, 4)),
            sa.Column('lote_id', sa.Integer(), sa.ForeignKey('produto_lotes.id'), nullable=True),
            sa.Column('movimentacao_id', sa.Integer(), sa.ForeignKey('movimentacoes_estoque.id'), nullable=True),
            sa.Column('consumo', sa.Text()),
            sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id'), nullable=True),
            sa.Column('estornado', sa.Boolean(), nullable=False, server_default=sa.false()),
            *_audit(),
            sa.UniqueConstraint('ordem_id', 'sequencia', name='uq_apontamento_ordem_seq'),
        )


def downgrade():
    tabelas = _tabelas()
    for nome in ('apontamentos_producao', 'ficha_tecnica_versoes'):
        if nome in tabelas:
            op.drop_table(nome)
    if 'ficha_versao' in _colunas('ordens_producao'):
        with op.batch_alter_table('ordens_producao') as lote:
            lote.drop_column('ficha_versao')
    colunas = _colunas('ficha_tecnica_itens')
    with op.batch_alter_table('ficha_tecnica_itens') as lote:
        for nome in ('unidade_receita', 'quantidade_receita'):
            if nome in colunas:
                lote.drop_column(nome)
    if 'versao' in _colunas('fichas_tecnicas'):
        with op.batch_alter_table('fichas_tecnicas') as lote:
            lote.drop_column('versao')
