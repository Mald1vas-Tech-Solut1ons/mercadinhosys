"""Produção própria (fábrica): ficha técnica e ordem de produção.

Estudo: ESTUDO-ARTIGOS-RELIGIOSOS-E-PRODUCAO.md, fases P1 (custo) e P2 (OP).
- Produto.papel_producao diz o papel do item (fabricado, matéria-prima, embalagem...).
- FichaTecnica: receita de UM lote (ex.: tacho de 50 kg rende 190 velas), com perda % por insumo,
  mão de obra (minutos x custo/hora), custo indireto % e markup -> custo padrão e preço sugerido.
- OrdemProducao: copia a receita no momento da criação (mudar a ficha depois não altera OP antiga),
  baixa os insumos pelo estoque_service (FIFO dos lotes, com rastro) e dá entrada no acabado com
  lote próprio e custo real. Quantidades na unidade de estoque do insumo (kg, L, un, m).
"""
from app import db
from app.models import AuditMixin, MultiTenantMixin, TenantID

PAPEIS_PRODUCAO = ("revenda", "fabricado", "semiacabado", "materia_prima", "embalagem")
PAPEIS_FORA_DO_PDV = ("materia_prima", "embalagem")
STATUS_OP = ("planejada", "em_producao", "encerrada", "cancelada", "estornada")


class FichaTecnica(db.Model, MultiTenantMixin, AuditMixin):
    __tablename__ = "fichas_tecnicas"
    __table_args__ = (db.UniqueConstraint("estabelecimento_id", "produto_id", name="uq_ficha_estab_produto"),)

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    rendimento = db.Column(db.Numeric(14, 3), nullable=False)          # unidades boas por receita
    minutos_mao_de_obra = db.Column(db.Numeric(10, 2), nullable=False, default=0)  # por receita
    custo_hora_mao_de_obra = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    custo_indireto_percentual = db.Column(db.Numeric(6, 2), nullable=False, default=0)
    markup_percentual = db.Column(db.Numeric(7, 2), nullable=False, default=100)
    validade_dias = db.Column(db.Integer, nullable=True)  # prazo de validade do lote produzido
    observacoes = db.Column(db.Text)
    ativa = db.Column(db.Boolean, nullable=False, default=True)
    versao = db.Column(db.Integer, nullable=False, default=1)  # sobe a cada edição (histórico em FichaTecnicaVersao)

    produto = db.relationship("Produto", foreign_keys=[produto_id])
    itens = db.relationship("FichaTecnicaItem", backref="ficha", cascade="all, delete-orphan",
                            order_by="FichaTecnicaItem.id")


class FichaTecnicaItem(db.Model):
    __tablename__ = "ficha_tecnica_itens"

    id = db.Column(db.Integer, primary_key=True)
    ficha_id = db.Column(db.Integer, db.ForeignKey("fichas_tecnicas.id", ondelete="CASCADE"), nullable=False, index=True)
    insumo_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    quantidade = db.Column(db.Numeric(14, 4), nullable=False)          # por receita, unidade DE ESTOQUE do insumo
    perda_percentual = db.Column(db.Numeric(6, 2), nullable=False, default=0)
    # Como foi digitado (ex.: 20 g de essência num insumo estocado em kg). `quantidade` é a conversão.
    quantidade_receita = db.Column(db.Numeric(14, 4))
    unidade_receita = db.Column(db.String(10))

    insumo = db.relationship("Produto", foreign_keys=[insumo_id])


class FichaTecnicaVersao(db.Model, MultiTenantMixin, AuditMixin):
    """Foto da ficha em cada versão: quem mudou, quando e como era (auditoria de custo)."""
    __tablename__ = "ficha_tecnica_versoes"
    __table_args__ = (db.UniqueConstraint("ficha_id", "versao", name="uq_ficha_versao"),)

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    ficha_id = db.Column(db.Integer, db.ForeignKey("fichas_tecnicas.id", ondelete="CASCADE"), nullable=False, index=True)
    versao = db.Column(db.Integer, nullable=False)
    dados = db.Column(db.Text, nullable=False)  # JSON: cabeçalho + itens + custo padrão da época
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True)


class OrdemProducao(db.Model, MultiTenantMixin, AuditMixin):
    __tablename__ = "ordens_producao"
    __table_args__ = (db.UniqueConstraint("estabelecimento_id", "numero", name="uq_op_estab_numero"),)

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    numero = db.Column(db.String(30), nullable=False)
    ficha_id = db.Column(db.Integer, db.ForeignKey("fichas_tecnicas.id"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default="planejada")
    quantidade_planejada = db.Column(db.Numeric(14, 3), nullable=False)
    quantidade_produzida = db.Column(db.Numeric(14, 3))
    quantidade_refugo = db.Column(db.Numeric(14, 3))
    motivo_refugo = db.Column(db.String(200))
    # Snapshot da ficha na criação: mão de obra e indireto valem para a OP inteira.
    rendimento_ficha = db.Column(db.Numeric(14, 3), nullable=False)
    minutos_mao_de_obra = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    custo_hora_mao_de_obra = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    custo_indireto_percentual = db.Column(db.Numeric(6, 2), nullable=False, default=0)
    custo_unitario_padrao = db.Column(db.Numeric(19, 4))
    custo_material_real = db.Column(db.Numeric(19, 4))
    custo_mao_de_obra_real = db.Column(db.Numeric(19, 4))
    custo_indireto_real = db.Column(db.Numeric(19, 4))
    custo_unitario_real = db.Column(db.Numeric(19, 4))
    lote_id = db.Column(db.Integer, db.ForeignKey("produto_lotes.id"), nullable=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True)
    ficha_versao = db.Column(db.Integer)
    data_inicio = db.Column(db.DateTime)
    data_encerramento = db.Column(db.DateTime)
    observacoes = db.Column(db.Text)
    # Estorno de OP encerrada por apontamento errado: devolve insumos e retira o acabado.
    data_estorno = db.Column(db.DateTime)
    motivo_estorno = db.Column(db.String(200))
    estornada_por_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True)

    produto = db.relationship("Produto", foreign_keys=[produto_id])
    itens = db.relationship("OrdemProducaoItem", backref="ordem", cascade="all, delete-orphan",
                            order_by="OrdemProducaoItem.id")
    apontamentos = db.relationship("ApontamentoProducao", backref="ordem", cascade="all, delete-orphan",
                                   order_by="ApontamentoProducao.sequencia")


class OrdemProducaoItem(db.Model):
    __tablename__ = "ordem_producao_itens"

    id = db.Column(db.Integer, primary_key=True)
    ordem_id = db.Column(db.Integer, db.ForeignKey("ordens_producao.id", ondelete="CASCADE"), nullable=False, index=True)
    insumo_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    quantidade_prevista = db.Column(db.Numeric(14, 4), nullable=False)
    quantidade_consumida = db.Column(db.Numeric(14, 4))
    custo_unitario = db.Column(db.Numeric(19, 4))
    movimentacao_id = db.Column(db.Integer, db.ForeignKey("movimentacoes_estoque.id"), nullable=True)

    insumo = db.relationship("Produto", foreign_keys=[insumo_id])


class ApontamentoProducao(db.Model, MultiTenantMixin, AuditMixin):
    """Uma entrega da ordem: produção parcial (turno, fornada) ou a final que encerra a OP.

    Cada apontamento baixa o próprio consumo, gera o próprio lote do acabado e guarda o que
    moveu (consumo JSON com o movimento de cada insumo) para o estorno devolver exatamente.
    """
    __tablename__ = "apontamentos_producao"
    __table_args__ = (db.UniqueConstraint("ordem_id", "sequencia", name="uq_apontamento_ordem_seq"),)

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    ordem_id = db.Column(db.Integer, db.ForeignKey("ordens_producao.id", ondelete="CASCADE"), nullable=False, index=True)
    sequencia = db.Column(db.Integer, nullable=False)
    final = db.Column(db.Boolean, nullable=False, default=False)
    quantidade_boa = db.Column(db.Numeric(14, 3), nullable=False, default=0)
    quantidade_refugo = db.Column(db.Numeric(14, 3), nullable=False, default=0)
    motivo_refugo = db.Column(db.String(200))
    minutos_mao_de_obra = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    custo_material = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    custo_mao_de_obra = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    custo_indireto = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    custo_unitario = db.Column(db.Numeric(19, 4))
    lote_id = db.Column(db.Integer, db.ForeignKey("produto_lotes.id"), nullable=True)
    movimentacao_id = db.Column(db.Integer, db.ForeignKey("movimentacoes_estoque.id"), nullable=True)
    consumo = db.Column(db.Text)  # JSON [{insumo_id, quantidade, custo_unitario, movimentacao_id}]
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True)
    estornado = db.Column(db.Boolean, nullable=False, default=False)
