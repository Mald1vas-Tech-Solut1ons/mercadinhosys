"""Contagem cíclica de estoque — "O que sumiu" (FASE 3.1).

Spec: docs/SPEC_O_QUE_SUMIU_CONTAGEM_CICLICA_2026-10-31.md (escopo fechado).
Duas tabelas: a contagem (uma por seção/semana) e seus itens. A decisão "sumiu"
NÃO cria tabela paralela de perdas: grava MovimentacaoEstoque com motivo
"Contagem cíclica — <seção>", que o DRE e o relatório de perdas já sabem ler.

Este módulo existe separado de app/models.py apenas por tamanho: models.py importa
estes nomes no final, então o registry do SQLAlchemy e o Alembic enxergam tudo.
"""
from datetime import datetime
from decimal import Decimal

from app import db
from app.models import AuditMixin, MultiTenantMixin, SerializableMixin, TenantID, utcnow


class ContagemCiclica(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    """Uma seção contada pelo dono numa semana ("Gôndola 3 — Higiene")."""

    __tablename__ = "contagem_ciclica"

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(80), nullable=False)
    # aberta -> conferida -> aplicada. "aberta" é a única que aceita bip.
    status = db.Column(db.String(20), nullable=False, default="aberta")
    data_abertura = db.Column(db.DateTime, nullable=False, default=utcnow)
    data_aplicacao = db.Column(db.DateTime, nullable=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False)

    funcionario = db.relationship("Funcionario", foreign_keys=[funcionario_id])
    itens = db.relationship(
        "ContagemCiclicaItem", backref="contagem", lazy=True,
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        db.Index("ix_contagem_estab_status", "estabelecimento_id", "status"),
        # Uma seção não pode ter duas contagens abertas ao mesmo tempo (spec §4).
        db.Index(
            "uq_contagem_aberta", "estabelecimento_id", "nome", unique=True,
            postgresql_where=db.text("status = 'aberta'"),
            sqlite_where=db.text("status = 'aberta'"),
        ),
    )

    def to_dict(self, include_itens=False):
        dados = super().to_dict()
        if include_itens:
            dados["itens"] = [item.to_dict() for item in self.itens]
        return dados


class ContagemCiclicaItem(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    """Uma linha por produto da seção — e por produto bipado fora dela."""

    __tablename__ = "contagem_ciclica_itens"

    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    contagem_id = db.Column(db.Integer, db.ForeignKey("contagem_ciclica.id"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    # Congelada na abertura: se o café vender enquanto o dono anda pela gôndola,
    # a divergência é legítima e ele decide de olho nela (spec §4).
    quantidade_esperada = db.Column(db.Numeric(10, 3), nullable=False, default=Decimal("0"))
    quantidade_contada = db.Column(db.Numeric(10, 3), nullable=False, default=Decimal("0"))
    divergencia = db.Column(db.Numeric(10, 3), nullable=True)
    # sumiu | recontar | ajustar | ok
    decisao = db.Column(db.String(20), nullable=True)
    movimentacao_id = db.Column(db.Integer, db.ForeignKey("movimentacoes_estoque.id"), nullable=True)
    # Bipou item que não estava na lista da seção: aceita (a prateleira erra, não o sistema).
    fora_da_secao = db.Column(db.Boolean, nullable=False, default=False)

    produto = db.relationship("Produto", foreign_keys=[produto_id])
    movimentacao = db.relationship("MovimentacaoEstoque", foreign_keys=[movimentacao_id])

    __table_args__ = (
        db.Index("ix_contagem_item_contagem", "contagem_id", "produto_id"),
    )
