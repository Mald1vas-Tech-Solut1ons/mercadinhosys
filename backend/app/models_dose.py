"""Venda por dose: a garrafa segue em estoque, a dose é um jeito de vendê-la.

- ProdutoDose: as doses que o lojista configura para um produto (nome, ml livre, preço).
- GarrafaAberta: a garrafa que está no balcão; guarda o saldo em ml e o custo do dia da abertura.
- DoseMovimento: razão de ml. Todo ml tem destino registrado e o saldo da garrafa é a soma do razão
  (``saldo_ml == soma(ml)``), a mesma ideia do razão de MovimentacaoEstoque para unidades.

Regras em services/dose_service.py. Plano: PLANO-VENDA-POR-DOSE.md.
"""
from app import db
from app.models import AuditMixin, MultiTenantMixin, TenantID

# Sinal de `DoseMovimento.ml`: abertura(+) venda(-) estorno(+) perda/cortesia/degustacao/descarte/desvio(-) ajuste(+/-)
TIPOS_DOSE_MOV = ("abertura", "venda", "estorno", "perda", "cortesia", "degustacao", "ajuste", "descarte", "desvio")
# Saídas de ml que não são venda: o lojista escolhe uma delas ao registrar baixa manual.
TIPOS_BAIXA_MANUAL = ("perda", "cortesia", "degustacao")
STATUS_GARRAFA = ("aberta", "vazia", "descartada")


class ProdutoDose(db.Model, MultiTenantMixin, AuditMixin):
    __tablename__ = "produto_doses"
    # Nome único só entre as doses ATIVAS: quem garante é o serviço (dose arquivada guarda o nome do histórico
    # e não pode travar a criação de uma nova com o mesmo nome).
    __table_args__ = (db.Index("ix_dose_produto", "produto_id"),)

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id", ondelete="CASCADE"), nullable=False)
    nome = db.Column(db.String(60), nullable=False)                      # "Dose", "Dupla", "Taça"
    volume_ml = db.Column(db.Numeric(10, 2), nullable=False)             # livre: 30, 50, 51,5, 100...
    preco_venda = db.Column(db.Numeric(19, 4), nullable=False)
    padrao = db.Column(db.Boolean, nullable=False, default=False)        # a que o PDV oferece primeiro
    ativa = db.Column(db.Boolean, nullable=False, default=True)          # dose vendida nunca se apaga: desativa
    ordem = db.Column(db.Integer, nullable=False, default=0)

    produto = db.relationship("Produto", foreign_keys=[produto_id], backref=db.backref("doses", lazy=True))

    def to_dict(self):
        return {
            "id": self.id, "produto_id": self.produto_id, "nome": self.nome,
            "volume_ml": float(self.volume_ml), "preco_venda": float(self.preco_venda),
            "padrao": bool(self.padrao), "ativa": bool(self.ativa), "ordem": self.ordem,
        }


class GarrafaAberta(db.Model, MultiTenantMixin, AuditMixin):
    __tablename__ = "garrafas_abertas"
    __table_args__ = (db.Index("ix_garrafa_produto_status", "estabelecimento_id", "produto_id", "status"),)

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    lote_id = db.Column(db.Integer, db.ForeignKey("produto_lotes.id"), nullable=True)       # rastro para recall
    movimento_abertura_id = db.Column(db.Integer, db.ForeignKey("movimentacoes_estoque.id"), nullable=True)
    venda_origem_id = db.Column(db.Integer, db.ForeignKey("vendas.id"), nullable=True)
    volume_inicial_ml = db.Column(db.Numeric(10, 2), nullable=False)
    saldo_ml = db.Column(db.Numeric(12, 2), nullable=False)
    custo_garrafa = db.Column(db.Numeric(19, 4), nullable=False)        # custo da unidade no dia da abertura
    status = db.Column(db.String(12), nullable=False, default="aberta")
    aberta_em = db.Column(db.DateTime, nullable=False)
    aberta_por_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True)
    validade_aberta = db.Column(db.Date, nullable=True)                 # depois disso não vende mais dessa garrafa
    encerrada_em = db.Column(db.DateTime, nullable=True)
    encerrada_por_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True)

    produto = db.relationship("Produto", foreign_keys=[produto_id])
    movimentos = db.relationship("DoseMovimento", backref="garrafa", order_by="DoseMovimento.id")

    @property
    def custo_por_ml(self):
        from decimal import Decimal
        return Decimal(str(self.custo_garrafa)) / Decimal(str(self.volume_inicial_ml))


class DoseMovimento(db.Model, MultiTenantMixin, AuditMixin):
    __tablename__ = "dose_movimentos"
    __table_args__ = (
        db.Index("ix_dose_mov_garrafa", "garrafa_id"),
        db.Index("ix_dose_mov_venda", "estabelecimento_id", "venda_id"),
        db.Index("ix_dose_mov_data", "estabelecimento_id", "created_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    garrafa_id = db.Column(db.Integer, db.ForeignKey("garrafas_abertas.id"), nullable=False)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    tipo = db.Column(db.String(12), nullable=False)
    ml = db.Column(db.Numeric(12, 2), nullable=False)                   # com sinal
    custo = db.Column(db.Numeric(19, 4), nullable=True)                 # ml x custo/ml da garrafa (sem sinal)
    dose_id = db.Column(db.Integer, nullable=True)
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id"), nullable=True)
    venda_item_id = db.Column(db.Integer, db.ForeignKey("venda_itens.id"), nullable=True)
    estorno_de_id = db.Column(db.Integer, db.ForeignKey("dose_movimentos.id"), nullable=True, unique=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True)
    motivo = db.Column(db.String(120), nullable=True)
