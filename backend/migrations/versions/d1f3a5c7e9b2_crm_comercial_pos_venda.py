"""CRM comercial e pós-venda: leads, oportunidades, atividades, consentimento, campanhas, comissão,
chamados e devolução parcial de venda por lote.

Migração expansiva: só cria tabelas novas; nenhuma coluna existente muda e a versão anterior da
aplicação continua funcionando com o esquema novo. Idempotente (confere o que já existe).
O downgrade recusa apagar dados: só remove as tabelas se estiverem vazias.
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1f3a5c7e9b2'
down_revision = 'c8e0a2d4f6b1'
branch_labels = None
depends_on = None

DINHEIRO = sa.Numeric(19, 4)
QTD = sa.Numeric(10, 3)


def _tenant():
    return sa.Column('estabelecimento_id', sa.Integer(), sa.ForeignKey('estabelecimentos.id', ondelete='CASCADE'),
                     nullable=False)


def _fk(nome, alvo, nullable=True, ondelete=None):
    return sa.Column(nome, sa.Integer(), sa.ForeignKey(alvo, ondelete=ondelete), nullable=nullable)


def _indices(tabela, colunas):
    for coluna in colunas:
        op.create_index(f'ix_{tabela}_{coluna}', tabela, [coluna])


TABELAS = (
    'devolucao_venda_itens', 'devolucoes_venda', 'crm_comissao_fechamentos', 'crm_regras_comissao',
    'crm_campanha_envios', 'crm_campanhas', 'crm_consentimentos', 'crm_atividades', 'crm_chamados',
    'crm_oportunidades', 'crm_leads',
)


def upgrade():
    existentes = set(sa.inspect(op.get_bind()).get_table_names())

    if 'crm_leads' not in existentes:
        op.create_table(
            'crm_leads',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            sa.Column('nome', sa.String(150), nullable=False), sa.Column('empresa', sa.String(150)),
            sa.Column('documento', sa.String(18)), sa.Column('telefone', sa.String(30)),
            sa.Column('email', sa.String(120)), sa.Column('cidade', sa.String(100)), sa.Column('estado', sa.String(2)),
            sa.Column('origem', sa.String(40), nullable=False, server_default='manual'),
            sa.Column('status', sa.String(20), nullable=False, server_default='novo'),
            _fk('responsavel_id', 'funcionarios.id', nullable=False), _fk('cliente_id', 'clientes.id'),
            sa.Column('motivo_descarte', sa.String(255)), sa.Column('observacoes', sa.Text()),
            sa.Column('convertido_em', sa.DateTime()), sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime()), sa.Column('deleted_at', sa.DateTime()),
        )
        _indices('crm_leads', ['estabelecimento_id', 'status', 'responsavel_id', 'cliente_id'])

    if 'crm_oportunidades' not in existentes:
        op.create_table(
            'crm_oportunidades',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            sa.Column('titulo', sa.String(150), nullable=False),
            _fk('cliente_id', 'clientes.id'), _fk('lead_id', 'crm_leads.id'),
            _fk('responsavel_id', 'funcionarios.id', nullable=False),
            sa.Column('etapa', sa.String(20), nullable=False, server_default='prospeccao'),
            sa.Column('valor_estimado', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('probabilidade', sa.Integer()), sa.Column('data_prevista_fechamento', sa.Date()),
            _fk('pedido_venda_id', 'pedidos_venda.id'), sa.Column('valor_ganho', DINHEIRO),
            sa.Column('motivo_perda', sa.String(255)), sa.Column('concorrente', sa.String(100)),
            sa.Column('fechada_em', sa.DateTime()), sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime()), sa.Column('deleted_at', sa.DateTime()),
            sa.CheckConstraint('cliente_id IS NOT NULL OR lead_id IS NOT NULL', name='ck_oportunidade_conta'),
        )
        _indices('crm_oportunidades', ['estabelecimento_id', 'cliente_id', 'lead_id', 'responsavel_id', 'etapa',
                                       'pedido_venda_id'])

    if 'crm_chamados' not in existentes:
        op.create_table(
            'crm_chamados',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            sa.Column('numero', sa.String(20), nullable=False), _fk('cliente_id', 'clientes.id', nullable=False),
            _fk('venda_id', 'vendas.id'),
            sa.Column('tipo', sa.String(20), nullable=False, server_default='reclamacao'),
            sa.Column('prioridade', sa.String(10), nullable=False, server_default='media'),
            sa.Column('status', sa.String(25), nullable=False, server_default='aberto'),
            sa.Column('assunto', sa.String(150), nullable=False), sa.Column('descricao', sa.Text()),
            _fk('responsavel_id', 'funcionarios.id'), _fk('aberto_por_id', 'funcionarios.id'),
            sa.Column('sla_vencimento', sa.DateTime(), nullable=False), sa.Column('primeira_resposta_em', sa.DateTime()),
            sa.Column('resolvido_em', sa.DateTime()), sa.Column('fechado_em', sa.DateTime()),
            sa.Column('resolucao', sa.Text()), sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime()),
            sa.UniqueConstraint('estabelecimento_id', 'numero', name='uq_chamado_estab_numero'),
        )
        _indices('crm_chamados', ['estabelecimento_id', 'cliente_id', 'venda_id', 'status', 'responsavel_id'])

    if 'crm_atividades' not in existentes:
        op.create_table(
            'crm_atividades',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            sa.Column('tipo', sa.String(20), nullable=False, server_default='tarefa'),
            sa.Column('assunto', sa.String(150), nullable=False), sa.Column('descricao', sa.Text()),
            sa.Column('vencimento', sa.DateTime()), sa.Column('concluida_em', sa.DateTime()),
            sa.Column('resultado', sa.String(255)), _fk('responsavel_id', 'funcionarios.id', nullable=False),
            _fk('criado_por_id', 'funcionarios.id'), _fk('cliente_id', 'clientes.id'), _fk('lead_id', 'crm_leads.id'),
            _fk('oportunidade_id', 'crm_oportunidades.id'), _fk('chamado_id', 'crm_chamados.id'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
        _indices('crm_atividades', ['estabelecimento_id', 'vencimento', 'responsavel_id', 'cliente_id', 'lead_id',
                                    'oportunidade_id', 'chamado_id'])

    if 'crm_consentimentos' not in existentes:
        op.create_table(
            'crm_consentimentos',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            _fk('cliente_id', 'clientes.id'), _fk('lead_id', 'crm_leads.id'),
            sa.Column('canal', sa.String(20), nullable=False),
            sa.Column('finalidade', sa.String(30), nullable=False, server_default='marketing'),
            sa.Column('concedido', sa.Boolean(), nullable=False), sa.Column('origem', sa.String(40), nullable=False),
            sa.Column('evidencia', sa.String(255)), _fk('registrado_por_id', 'funcionarios.id'),
            sa.Column('registrado_em', sa.DateTime(), nullable=False),
            sa.CheckConstraint('cliente_id IS NOT NULL OR lead_id IS NOT NULL', name='ck_consentimento_titular'),
        )
        _indices('crm_consentimentos', ['estabelecimento_id', 'cliente_id', 'lead_id', 'registrado_em'])

    if 'crm_campanhas' not in existentes:
        op.create_table(
            'crm_campanhas',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            sa.Column('nome', sa.String(150), nullable=False),
            sa.Column('canal', sa.String(20), nullable=False, server_default='whatsapp'),
            sa.Column('mensagem', sa.Text(), nullable=False), sa.Column('filtros', sa.JSON()),
            sa.Column('janela_conversao_dias', sa.Integer(), nullable=False, server_default='7'),
            sa.Column('status', sa.String(20), nullable=False, server_default='rascunho'),
            _fk('criado_por_id', 'funcionarios.id'), sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('iniciada_em', sa.DateTime()), sa.Column('encerrada_em', sa.DateTime()),
        )
        _indices('crm_campanhas', ['estabelecimento_id'])

    if 'crm_campanha_envios' not in existentes:
        op.create_table(
            'crm_campanha_envios',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            _fk('campanha_id', 'crm_campanhas.id', nullable=False, ondelete='CASCADE'),
            _fk('cliente_id', 'clientes.id', nullable=False), sa.Column('destino', sa.String(120), nullable=False),
            sa.Column('status', sa.String(20), nullable=False, server_default='pendente'),
            sa.Column('enviado_em', sa.DateTime()), sa.Column('respondido_em', sa.DateTime()),
            _fk('registrado_por_id', 'funcionarios.id'), sa.Column('observacao', sa.String(255)),
            sa.UniqueConstraint('campanha_id', 'cliente_id', name='uq_campanha_envio_cliente'),
        )
        _indices('crm_campanha_envios', ['estabelecimento_id', 'campanha_id', 'cliente_id'])

    if 'crm_regras_comissao' not in existentes:
        op.create_table(
            'crm_regras_comissao',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(), _fk('vendedor_id', 'funcionarios.id'),
            sa.Column('percentual', sa.Numeric(5, 2), nullable=False),
            sa.Column('ativo', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=False), sa.Column('updated_at', sa.DateTime()),
        )
        _indices('crm_regras_comissao', ['estabelecimento_id', 'vendedor_id'])

    if 'crm_comissao_fechamentos' not in existentes:
        op.create_table(
            'crm_comissao_fechamentos',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            _fk('vendedor_id', 'funcionarios.id', nullable=False), sa.Column('competencia', sa.String(7), nullable=False),
            sa.Column('base_vendas', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('base_cancelamentos', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('base_devolucoes', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('base_liquida', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('percentual', sa.Numeric(5, 2), nullable=False), sa.Column('valor_comissao', DINHEIRO, nullable=False),
            sa.Column('detalhes', sa.JSON()), _fk('fechado_por_id', 'funcionarios.id'),
            sa.Column('fechado_em', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('estabelecimento_id', 'vendedor_id', 'competencia', name='uq_comissao_vendedor_competencia'),
        )
        _indices('crm_comissao_fechamentos', ['estabelecimento_id', 'vendedor_id'])

    if 'devolucoes_venda' not in existentes:
        op.create_table(
            'devolucoes_venda',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            _fk('venda_id', 'vendas.id', nullable=False), _fk('chamado_id', 'crm_chamados.id'),
            sa.Column('tipo', sa.String(10), nullable=False, server_default='devolucao'),
            sa.Column('motivo', sa.String(255), nullable=False),
            sa.Column('destino', sa.String(15), nullable=False, server_default='reintegrar'),
            sa.Column('forma_reembolso', sa.String(20), nullable=False),
            sa.Column('valor_total', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('custo_total', DINHEIRO, nullable=False, server_default='0'),
            sa.Column('custo_reposicao', DINHEIRO, nullable=False, server_default='0'),
            _fk('funcionario_id', 'funcionarios.id', nullable=False), _fk('caixa_id', 'caixas.id'),
            sa.Column('idempotency_key', sa.String(64)), sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('estabelecimento_id', 'idempotency_key', name='uq_devolucao_idempotencia'),
        )
        _indices('devolucoes_venda', ['estabelecimento_id', 'venda_id', 'chamado_id', 'created_at'])

    if 'devolucao_venda_itens' not in existentes:
        op.create_table(
            'devolucao_venda_itens',
            sa.Column('id', sa.Integer(), primary_key=True), _tenant(),
            _fk('devolucao_id', 'devolucoes_venda.id', nullable=False, ondelete='CASCADE'),
            _fk('venda_item_id', 'venda_itens.id', nullable=False), _fk('produto_id', 'produtos.id', nullable=False),
            _fk('lote_id', 'produto_lotes.id'), sa.Column('quantidade', QTD, nullable=False),
            sa.Column('valor_unitario', DINHEIRO, nullable=False), sa.Column('valor_total', DINHEIRO, nullable=False),
            sa.Column('custo_unitario', DINHEIRO, nullable=False, server_default='0'),
        )
        _indices('devolucao_venda_itens', ['estabelecimento_id', 'devolucao_id', 'venda_item_id', 'produto_id', 'lote_id'])


def downgrade():
    bind = op.get_bind()
    existentes = set(sa.inspect(bind).get_table_names())
    com_dados = [t for t in TABELAS if t in existentes and bind.execute(sa.text(f'SELECT 1 FROM {t} LIMIT 1')).first()]
    if com_dados:
        raise RuntimeError(f'Downgrade recusado: há dados em {", ".join(com_dados)}. Volte a imagem; o esquema é compatível.')
    for tabela in TABELAS:
        if tabela in existentes:
            op.drop_table(tabela)
