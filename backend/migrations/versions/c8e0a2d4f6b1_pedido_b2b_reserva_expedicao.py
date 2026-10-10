"""Pedido B2B: reserva de estoque, atendimento por item e histórico de expedições.

Itens ganham quantidade reservada, atendida e cancelada (saldo = pedido - atendida - cancelada).
Cada saída de um pedido vira uma expedição ligada à venda que ela gerou, com as quantidades e valores
do que saiu, para o cancelamento da venda reabrir o saldo do pedido.

Migração expansiva e idempotente: a versão anterior da aplicação continua funcionando com o esquema
novo (colunas com padrão 0, tabelas novas não são lidas por ela).
"""
from alembic import op
import sqlalchemy as sa

revision = 'c8e0a2d4f6b1'
down_revision = 'f9b2c4d6e8a0'
branch_labels = None
depends_on = None

QTD = sa.Numeric(10, 3)
DINHEIRO = sa.Numeric(19, 4)


def _inspetor():
    return sa.inspect(op.get_bind())


def upgrade():
    existentes = {c['name'] for c in _inspetor().get_columns('pedido_venda_itens')}
    with op.batch_alter_table('pedido_venda_itens') as lote:
        for nome in ('quantidade_reservada', 'quantidade_atendida', 'quantidade_cancelada'):
            if nome not in existentes:
                lote.add_column(sa.Column(nome, QTD, nullable=False, server_default='0'))

    tabelas = set(_inspetor().get_table_names())
    if 'pedido_venda_expedicoes' not in tabelas:
        op.create_table(
            'pedido_venda_expedicoes',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('pedido_id', sa.Integer(), sa.ForeignKey('pedidos_venda.id', ondelete='CASCADE'), nullable=False),
            sa.Column('venda_id', sa.Integer(), sa.ForeignKey('vendas.id'), nullable=False),
            sa.Column('sequencia', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('subtotal', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('desconto', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('total', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id')),
            sa.Column('created_at', sa.DateTime()),
            sa.Column('cancelada_em', sa.DateTime()),
            sa.UniqueConstraint('venda_id', name='uq_pedido_venda_expedicoes_venda_id'),
            sa.UniqueConstraint('pedido_id', 'sequencia', name='uq_expedicao_pedido_sequencia'),
        )
        op.create_index('ix_pedido_venda_expedicoes_estabelecimento_id', 'pedido_venda_expedicoes', ['estabelecimento_id'])
        op.create_index('ix_pedido_venda_expedicoes_pedido_id', 'pedido_venda_expedicoes', ['pedido_id'])
    if 'pedido_venda_expedicao_itens' not in tabelas:
        op.create_table(
            'pedido_venda_expedicao_itens',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('expedicao_id', sa.Integer(), sa.ForeignKey('pedido_venda_expedicoes.id', ondelete='CASCADE'), nullable=False),
            sa.Column('pedido_item_id', sa.Integer(), sa.ForeignKey('pedido_venda_itens.id'), nullable=False),
            sa.Column('quantidade', QTD, nullable=False),
            sa.Column('total_item', DINHEIRO, nullable=False),
        )
        op.create_index('ix_pedido_venda_expedicao_itens_estabelecimento_id', 'pedido_venda_expedicao_itens', ['estabelecimento_id'])
        op.create_index('ix_pedido_venda_expedicao_itens_expedicao_id', 'pedido_venda_expedicao_itens', ['expedicao_id'])
        op.create_index('ix_pedido_venda_expedicao_itens_pedido_item_id', 'pedido_venda_expedicao_itens', ['pedido_item_id'])

    # Pedidos antigos já faturados: o que saiu foi tudo, para o saldo não reaparecer como pendente.
    op.execute("UPDATE pedido_venda_itens SET quantidade_atendida = quantidade "
               "WHERE pedido_id IN (SELECT id FROM pedidos_venda WHERE status = 'faturado') AND quantidade_atendida = 0")
    op.execute("UPDATE pedido_venda_itens SET quantidade_cancelada = quantidade "
               "WHERE pedido_id IN (SELECT id FROM pedidos_venda WHERE status = 'cancelado') AND quantidade_cancelada = 0")


def downgrade():
    tabelas = set(_inspetor().get_table_names())
    if 'pedido_venda_expedicao_itens' in tabelas:
        op.drop_table('pedido_venda_expedicao_itens')
    if 'pedido_venda_expedicoes' in tabelas:
        op.drop_table('pedido_venda_expedicoes')
    existentes = {c['name'] for c in _inspetor().get_columns('pedido_venda_itens')}
    with op.batch_alter_table('pedido_venda_itens') as lote:
        for nome in ('quantidade_cancelada', 'quantidade_atendida', 'quantidade_reservada'):
            if nome in existentes:
                lote.drop_column(nome)
