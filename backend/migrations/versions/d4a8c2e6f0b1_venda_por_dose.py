"""Venda por dose: doses do produto, garrafas abertas, razão de ml (aditiva: só cria tabelas e colunas).

Revision ID: d4a8c2e6f0b1
Revises: c3e9a5f1b7d2
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4a8c2e6f0b1'
down_revision = 'c3e9a5f1b7d2'
branch_labels = None
depends_on = None


def _colunas(tabela):
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(tabela)}


def _tabelas():
    return set(sa.inspect(op.get_bind()).get_table_names())


def _adicionar(tabela, colunas):
    existentes = _colunas(tabela)
    novas = [c for c in colunas if c.name not in existentes]
    if novas:
        with op.batch_alter_table(tabela) as lote:
            for coluna in novas:
                lote.add_column(coluna)


def _auditoria():
    return [
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('sync_uuid', sa.String(36), nullable=False),
    ]


def upgrade():
    _adicionar('produtos', [
        sa.Column('vende_por_dose', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('volume_embalagem_ml', sa.Numeric(10, 2), nullable=True),
        sa.Column('validade_aberta_dias', sa.Integer(), nullable=True),
        sa.Column('perda_esperada_pct', sa.Numeric(5, 2), nullable=True),
    ])
    _adicionar('venda_itens', [
        sa.Column('dose_id', sa.Integer(), nullable=True),
        sa.Column('dose_nome', sa.String(60), nullable=True),
        sa.Column('dose_volume_ml', sa.Numeric(10, 2), nullable=True),
        sa.Column('ml_total', sa.Numeric(14, 2), nullable=True),
        sa.Column('qtd_base', sa.Numeric(14, 6), nullable=True),
    ])
    _adicionar('configuracoes', [
        sa.Column('doses_padrao', sa.Text(), nullable=True),
        sa.Column('margem_alvo_dose_pct', sa.Numeric(5, 2), nullable=True),
        sa.Column('perda_esperada_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('alerta_garrafa_aberta_dias', sa.Integer(), nullable=True),
        sa.Column('alerta_rendimento_pct', sa.Numeric(5, 2), nullable=True),
    ])
    if 'dose_id' in _colunas('venda_itens'):
        indices = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('venda_itens')}
        if 'ix_venda_itens_dose_id' not in indices:
            op.create_index('ix_venda_itens_dose_id', 'venda_itens', ['dose_id'])
    # Contador de vendidos em garrafas equivalentes (dose = fração de garrafa): 6 casas, não 3.
    with op.batch_alter_table('produtos') as lote:
        lote.alter_column('quantidade_vendida', existing_type=sa.Numeric(10, 3), type_=sa.Numeric(14, 6),
                          existing_nullable=True)

    tabelas = _tabelas()
    if 'produto_doses' not in tabelas:
        op.create_table(
            'produto_doses',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('produto_id', sa.Integer(), sa.ForeignKey('produtos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('nome', sa.String(60), nullable=False),
            sa.Column('volume_ml', sa.Numeric(10, 2), nullable=False),
            sa.Column('preco_venda', sa.Numeric(19, 4), nullable=False),
            sa.Column('padrao', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('ativa', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('ordem', sa.Integer(), nullable=False, server_default='0'),
            *_auditoria(),
            sa.UniqueConstraint('sync_uuid', name='uq_produto_doses_sync_uuid'),
        )
        op.create_index('ix_produto_doses_estabelecimento_id', 'produto_doses', ['estabelecimento_id'])
        op.create_index('ix_dose_produto', 'produto_doses', ['produto_id'])
    if 'garrafas_abertas' not in tabelas:
        op.create_table(
            'garrafas_abertas',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('produto_id', sa.Integer(), sa.ForeignKey('produtos.id'), nullable=False),
            sa.Column('lote_id', sa.Integer(), sa.ForeignKey('produto_lotes.id'), nullable=True),
            sa.Column('movimento_abertura_id', sa.Integer(), sa.ForeignKey('movimentacoes_estoque.id'), nullable=True),
            sa.Column('venda_origem_id', sa.Integer(), sa.ForeignKey('vendas.id'), nullable=True),
            sa.Column('volume_inicial_ml', sa.Numeric(10, 2), nullable=False),
            sa.Column('saldo_ml', sa.Numeric(12, 2), nullable=False),
            sa.Column('custo_garrafa', sa.Numeric(19, 4), nullable=False),
            sa.Column('status', sa.String(12), nullable=False, server_default='aberta'),
            sa.Column('aberta_em', sa.DateTime(), nullable=False),
            sa.Column('aberta_por_id', sa.Integer(), sa.ForeignKey('funcionarios.id'), nullable=True),
            sa.Column('validade_aberta', sa.Date(), nullable=True),
            sa.Column('encerrada_em', sa.DateTime(), nullable=True),
            sa.Column('encerrada_por_id', sa.Integer(), sa.ForeignKey('funcionarios.id'), nullable=True),
            *_auditoria(),
            sa.UniqueConstraint('sync_uuid', name='uq_garrafas_abertas_sync_uuid'),
        )
        op.create_index('ix_garrafas_abertas_estabelecimento_id', 'garrafas_abertas', ['estabelecimento_id'])
        op.create_index('ix_garrafas_abertas_produto_id', 'garrafas_abertas', ['produto_id'])
        op.create_index('ix_garrafa_produto_status', 'garrafas_abertas', ['estabelecimento_id', 'produto_id', 'status'])
    if 'dose_movimentos' not in tabelas:
        op.create_table(
            'dose_movimentos',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'), nullable=False),
            sa.Column('garrafa_id', sa.Integer(), sa.ForeignKey('garrafas_abertas.id'), nullable=False),
            sa.Column('produto_id', sa.Integer(), sa.ForeignKey('produtos.id'), nullable=False),
            sa.Column('tipo', sa.String(12), nullable=False),
            sa.Column('ml', sa.Numeric(12, 2), nullable=False),
            sa.Column('custo', sa.Numeric(19, 4), nullable=True),
            sa.Column('dose_id', sa.Integer(), nullable=True),
            sa.Column('venda_id', sa.Integer(), sa.ForeignKey('vendas.id'), nullable=True),
            sa.Column('venda_item_id', sa.Integer(), sa.ForeignKey('venda_itens.id'), nullable=True),
            sa.Column('estorno_de_id', sa.Integer(), sa.ForeignKey('dose_movimentos.id'), nullable=True),
            sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id'), nullable=True),
            sa.Column('motivo', sa.String(120), nullable=True),
            *_auditoria(),
            sa.UniqueConstraint('sync_uuid', name='uq_dose_movimentos_sync_uuid'),
            sa.UniqueConstraint('estorno_de_id', name='uq_dose_movimentos_estorno_de'),
        )
        op.create_index('ix_dose_movimentos_estabelecimento_id', 'dose_movimentos', ['estabelecimento_id'])
        op.create_index('ix_dose_movimentos_produto_id', 'dose_movimentos', ['produto_id'])
        op.create_index('ix_dose_mov_garrafa', 'dose_movimentos', ['garrafa_id'])
        op.create_index('ix_dose_mov_venda', 'dose_movimentos', ['estabelecimento_id', 'venda_id'])
        op.create_index('ix_dose_mov_data', 'dose_movimentos', ['estabelecimento_id', 'created_at'])


def downgrade():
    with op.batch_alter_table('produtos') as lote:
        lote.alter_column('quantidade_vendida', existing_type=sa.Numeric(14, 6), type_=sa.Numeric(10, 3),
                          existing_nullable=True)
    tabelas = _tabelas()
    for tabela in ('dose_movimentos', 'garrafas_abertas', 'produto_doses'):
        if tabela in tabelas:
            op.drop_table(tabela)
    if 'dose_id' in _colunas('venda_itens'):
        indices = {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('venda_itens')}
        if 'ix_venda_itens_dose_id' in indices:
            op.drop_index('ix_venda_itens_dose_id', table_name='venda_itens')
    for tabela, colunas in (
        ('configuracoes', ('alerta_rendimento_pct', 'alerta_garrafa_aberta_dias', 'perda_esperada_pct',
                           'margem_alvo_dose_pct', 'doses_padrao')),
        ('venda_itens', ('qtd_base', 'ml_total', 'dose_volume_ml', 'dose_nome', 'dose_id')),
        ('produtos', ('perda_esperada_pct', 'validade_aberta_dias', 'volume_embalagem_ml', 'vende_por_dose')),
    ):
        existentes = _colunas(tabela)
        presentes = [c for c in colunas if c in existentes]
        if presentes:
            with op.batch_alter_table(tabela) as lote:
                for coluna in presentes:
                    lote.drop_column(coluna)
