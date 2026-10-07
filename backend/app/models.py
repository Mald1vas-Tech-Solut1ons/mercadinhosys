# app/models.py – REFATORAÇÃO PROFISSIONAL COMPLETA (1/4)
# CTO: Rafael Mello - Arquitetura Limpa, Multi‑tenant, Offline‑first, Pagamentos Flexíveis

import json
import os
import re
import threading
import uuid as uuid_module
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from flask import g, has_app_context, has_request_context, current_app
from flask_login import LoginManager, UserMixin
from flask_sqlalchemy import SQLAlchemy
from flask_sqlalchemy.query import Query as _BaseQuery
from sqlalchemy import MetaData, case, event, func, or_
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import declared_attr, validates
from werkzeug.security import check_password_hash, generate_password_hash

# ------------------------------------------------------------------------------
# Configuração
# ------------------------------------------------------------------------------
naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
# Opt-in EXPLÍCITO para acesso cross-tenant (fora de request): jobs de background,
# seeders, cálculo de métricas globais, sincronização. Thread-local porque workers
# rodam em threads separadas. FORA deste contexto e sem tenant concreto, a query
# falha FECHADA (não vaza dados de todas as lojas). Ver [isolamento-multi-tenant].
_tenant_bypass = threading.local()


def _is_tenant_bypass() -> bool:
    return getattr(_tenant_bypass, "active", False)


@contextmanager
def allow_all_tenants():
    """
    Habilita acesso cross-tenant DENTRO deste bloco, de forma explícita e auditável.
    Use SOMENTE em código de plataforma confiável (jobs agendados, sincronização,
    seeders, relatórios globais do super admin). Nunca em handlers de request de loja.

        with allow_all_tenants():
            for estab in Estabelecimento.query.all():
                ...  # consultas veem todas as lojas
    """
    anterior = getattr(_tenant_bypass, "active", False)
    _tenant_bypass.active = True
    try:
        yield
    finally:
        _tenant_bypass.active = anterior


def _tenant_atual():
    """
    Retorna o tenant a aplicar no filtro automático, ou None quando NÃO se deve filtrar.

    A fronteira de segurança real é o REQUEST HTTP — é ali que dados de um tenant
    poderiam vazar para o usuário de outro. Por isso:
      - None (sem filtro) nos casos seguros:
          * fora de app context (não há ORM ativo);
          * bypass explícito via allow_all_tenants() (plataforma confiável);
          * sentinela 'all' (super admin em visão GLOBAL);
          * rotas públicas de auth/onboarding/webhooks (sem tenant por design);
          * FORA de request (CLI/seeders/jobs/relatórios globais) — cross-tenant
            é legítimo nesse contexto; use allow_all_tenants() para deixar
            explícito quando quiser.
      - id concreto quando há g.estabelecimento_id — inclusive super admin
        IMPERSONANDO uma loja (modo espelho; escrita bloqueada na camada HTTP).
      - -1 (FAIL-CLOSED) quando estamos DENTRO de um request autenticado e o
        tenant não foi resolvido (ex.: bug/bypass do before_request). Assim a
        query não encontra nada em vez de despejar os dados de todas as lojas.
    """
    if not has_app_context():
        return None

    # Opt-in explícito de plataforma (jobs/seeders/sync) tem precedência.
    if _is_tenant_bypass():
        return None

    tid = getattr(g, "estabelecimento_id", None) if g else None

    if str(tid).lower() == "all":
        return None

    if tid is not None:
        return tid

    # Sem tenant concreto. Dentro de um request, falha fechado (a menos que seja
    # rota pública). Fora de request, cross-tenant é legítimo (fail-open).
    if has_request_context():
        from flask import request
        if request.path.startswith(("/api/auth", "/api/onboarding", "/api/saas/webhooks")):
            return None
        return -1

    return None


class TenantQuery(_BaseQuery):
    """
    Rede de segurança de isolamento multi-tenant (defense-in-depth).

    Quando há um tenant concreto em g.estabelecimento_id, TODA consulta via
    Model.query é automaticamente restrita àquele estabelecimento — mesmo que o
    desenvolvedor esqueça o .filter(estabelecimento_id==...) manual na rota.
    Também aplica o soft-delete (deleted_at IS NULL).
    """
    def _model(self):
        try:
            descs = self.column_descriptions
            if not descs:
                return None
            return descs[0].get("entity")
        except Exception:
            return None

    def _apply_filters(self):
        model = self._model()
        if model is None:
            return self
        # SQL posiciona WHERE antes de LIMIT/OFFSET. Desabilitar esta assertion
        # permite aplicar a fronteira de tenant também em consultas já fatiadas.
        q = self.enable_assertions(False)
        if hasattr(model, "estabelecimento_id"):
            tid = _tenant_atual()
            if tid is not None:
                q = q.filter(model.estabelecimento_id == tid)
        if hasattr(model, "deleted_at"):
            q = q.filter(model.deleted_at == None)  # noqa: E711
        return q

    def get(self, ident):
        # .get() não aceita critério prévio no SQLAlchemy 2.0; fazemos o lookup
        # por PK e validamos o tenant/soft-delete no objeto retornado.
        obj = super(TenantQuery, self).get(ident)
        if obj is None:
            return None
        if getattr(obj, "deleted_at", None) is not None:
            return None
        if hasattr(obj, "estabelecimento_id"):
            tid = _tenant_atual()
            if tid is not None and obj.estabelecimento_id != tid:
                return None
        return obj

    def all(self):
        return super(TenantQuery, self._apply_filters()).all()

    def first(self):
        return super(TenantQuery, self._apply_filters()).first()

    def first_or_404(self, *args, **kwargs):
        return super(TenantQuery, self._apply_filters()).first_or_404(*args, **kwargs)

    def one(self):
        return super(TenantQuery, self._apply_filters()).one()

    def one_or_none(self):
        return super(TenantQuery, self._apply_filters()).one_or_none()

    def count(self):
        return super(TenantQuery, self._apply_filters()).count()

    def scalar(self):
        return super(TenantQuery, self._apply_filters()).scalar()

    def __iter__(self):
        return super(TenantQuery, self._apply_filters()).__iter__()

    def paginate(self, *args, **kwargs):
        return super(TenantQuery, self._apply_filters()).paginate(*args, **kwargs)

    def update(self, *args, **kwargs):
        return super(TenantQuery, self._apply_filters()).update(*args, **kwargs)

    def delete(self, *args, **kwargs):
        return super(TenantQuery, self._apply_filters()).delete(*args, **kwargs)


# query_class=TenantQuery ativa a rede de segurança de isolamento em Model.query.
db = SQLAlchemy(query_class=TenantQuery, metadata=MetaData(naming_convention=naming_convention))

def utcnow() -> datetime:
    return datetime.utcnow()

def normalizar_documento(doc: str) -> str:
    if not doc: return ""
    return re.sub(r"[^\d]", "", str(doc))

def validar_cpf(cpf: str) -> bool:
    if os.environ.get("FLASK_ENV") == "simulation": return True
    cpf = normalizar_documento(cpf)
    if len(cpf) != 11 or len(set(cpf)) == 1: return False
    for i in range(9, 11):
        value = sum((int(cpf[num]) * ((i + 1) - num) for num in range(0, i)))
        if ((value * 10) % 11) % 10 != int(cpf[i]): return False
    return True

def validar_cnpj(cnpj: str) -> bool:
    if os.environ.get("FLASK_ENV") == "simulation": return True
    cnpj = normalizar_documento(cnpj)
    if len(cnpj) != 14 or len(set(cnpj)) == 1: return False
    def calc_digit(num_str, weights):
        total = sum(int(d) * w for d, w in zip(num_str, weights))
        rest = total % 11
        return 0 if rest < 2 else 11 - rest
    pesos1 = [5,4,3,2,9,8,7,6,5,4,3,2]
    pesos2 = [6,5,4,3,2,9,8,7,6,5,4,3,2]
    d1 = calc_digit(cnpj[:12], pesos1)
    d2 = calc_digit(cnpj[:12] + str(d1), pesos2)
    return d1 == int(cnpj[12]) and d2 == int(cnpj[13])

def is_offline_mode() -> bool:
    return os.environ.get("MERCADINHO_OFFLINE", "false").lower() == "true"

# ------------------------------------------------------------------------------
# Mixins (Clean Code)
# ------------------------------------------------------------------------------
class SoftDeleteMixin:
    deleted_at = db.Column(db.DateTime, nullable=True)
    def soft_delete(self): self.deleted_at = utcnow()
    def restore(self): self.deleted_at = None
    @property
    def is_deleted(self): return self.deleted_at is not None

class AuditMixin:
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    sync_uuid = db.Column(db.String(36), default=lambda: str(uuid_module.uuid4()), unique=True, nullable=False)

class SerializableMixin:
    def to_dict(self, include_relationships: bool = False, depth: int = 0) -> Dict:
        result = {}
        for col in self.__table__.columns:
            value = getattr(self, col.name)
            if isinstance(value, datetime):
                # Datas são gravadas em UTC (naive). Marca o fuso como UTC para o
                # cliente converter corretamente ao horário local (ex.: Brasília -03).
                if value is not None and value.tzinfo is None:
                    value = value.replace(tzinfo=timezone.utc).isoformat()
                else:
                    value = value.isoformat() if value else None
            elif isinstance(value, (date, time)): value = value.isoformat() if value else None
            elif isinstance(value, Decimal): value = float(value)
            elif isinstance(value, uuid_module.UUID): value = str(value)
            result[col.name] = value
        if include_relationships and depth < 1:
            for rel in self.__mapper__.relationships:
                if not rel.uselist:
                    rel_obj = getattr(self, rel.key)
                    if rel_obj:
                        try:
                            result[rel.key] = rel_obj.to_dict(depth=depth+1)
                        except TypeError:
                            result[rel.key] = rel_obj.to_dict()
                else:
                    rel_list = []
                    for o in getattr(self, rel.key):
                        try:
                            rel_list.append(o.to_dict(depth=depth+1))
                        except TypeError:
                            rel_list.append(o.to_dict())
                    result[rel.key] = rel_list
        return result

class EfiWebhookEvent(db.Model):
    """Eventos confirmados pela Efí; chave persistente impede reprocessamento."""
    __tablename__ = 'efi_webhook_events'
    event_key = db.Column(db.String(64), primary_key=True)
    charge_id = db.Column(db.String(50), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False)
    received_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class EnderecoMixin:
    cep = db.Column(db.String(9), nullable=False)
    logradouro = db.Column(db.String(200), nullable=False)
    numero = db.Column(db.String(10), nullable=False)
    complemento = db.Column(db.String(100))
    bairro = db.Column(db.String(100), nullable=False)
    cidade = db.Column(db.String(100), nullable=False)
    estado = db.Column(db.String(2), nullable=False)
    pais = db.Column(db.String(50), default="Brasil")
    def endereco_completo(self) -> str:
        try:
            log = getattr(self, "logradouro", "") or "Não Informado"
            num = getattr(self, "numero", "") or "S/N"
            comp = getattr(self, "complemento", "")
            bairro = getattr(self, "bairro", "") or ""
            cidade = getattr(self, "cidade", "") or ""
            estado = getattr(self, "estado", "") or ""
            cep = getattr(self, "cep", "") or ""
            end = f"{log}, {num}"
            if comp: end += f" - {comp}"
            end += f" - {bairro} - {cidade}/{estado} - {cep}"
            return end
        except: return "Endereço não disponível"

def TenantID():
    """Rafael, esta é a forma mais segura de injetar o ID sem falhas de mapeamento."""
    from sqlalchemy import Column, Integer, ForeignKey
    return Column(Integer, ForeignKey("estabelecimentos.id", ondelete="CASCADE"), nullable=False, index=True)

class MultiTenantMixin:
    """Mixin que garante o filtro automático e o relacionamento."""
    query_class = TenantQuery

    @declared_attr
    def estabelecimento(cls):
        from sqlalchemy.orm import relationship
        return relationship("Estabelecimento", foreign_keys=[cls.estabelecimento_id])

class Estabelecimento(db.Model, EnderecoMixin, SerializableMixin, AuditMixin):
    """Raiz do tenant. Não herda MultiTenantMixin."""
    __tablename__ = "estabelecimentos"
    id = db.Column(db.Integer, primary_key=True)
    nome_fantasia = db.Column(db.String(150), nullable=False)
    razao_social = db.Column(db.String(150), nullable=False)
    cnpj = db.Column(db.String(18), nullable=False)
    inscricao_estadual = db.Column(db.String(20))
    telefone = db.Column(db.String(30), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    regime_tributario = db.Column(db.String(30), default="SIMPLES NACIONAL")
    logotipo_url = db.Column(db.String(255))
    tema_principal = db.Column(db.String(50), default="blue")
    # Segmento de negócio (nível Tenant da cascata do view schema):
    # mercearia | vestuario | construcao | autopecas | generico
    segmento = db.Column(db.String(30), default="mercearia")
    configuracoes_json = db.Column(db.Text, default="{}")
    ativo = db.Column(db.Boolean, default=True)
    data_abertura = db.Column(db.Date, nullable=False, default=date.today)
    data_cadastro = db.Column(db.DateTime, default=utcnow)
    
    # Campos de Assinatura e Integração
    premium = db.Column(db.Boolean, default=False)
    plano = db.Column(db.String(50), default="Gratuito")
    plano_status = db.Column(db.String(20), default="experimental")
    vencimento_plano = db.Column(db.Date)
    vencimento_assinatura = db.Column(db.DateTime)
    gateway_customer_id = db.Column(db.String(100))
    gateway_subscription_id = db.Column(db.String(100))
    pagarme_id = db.Column(db.String(100))
    deleted_at = db.Column(db.DateTime, nullable=True)

    # ---- Configuração Fiscal (NFC-e / NF-e via gateway SEFAZ) ----
    fiscal_ambiente = db.Column(db.String(15), default="homologacao")  # homologacao | producao
    fiscal_gateway = db.Column(db.String(30), default="simulado")      # focusnfe | plugnotas | nfeio | simulado
    fiscal_token = db.Column(db.String(255))                            # token/credencial do gateway
    fiscal_csc = db.Column(db.String(64))                               # Código de Segurança do Contribuinte (NFC-e)
    fiscal_csc_id = db.Column(db.String(10))                            # Identificador do CSC (idToken)
    serie_nfce = db.Column(db.Integer, default=1)
    serie_nfe = db.Column(db.Integer, default=1)
    proximo_numero_nfce = db.Column(db.Integer, default=1)
    proximo_numero_nfe = db.Column(db.Integer, default=1)

    __table_args__ = (
        db.Index("ix_estabelecimento_cnpj", "cnpj"),
        db.UniqueConstraint("cnpj", name="uq_estabelecimento_cnpj"),
    )

    @validates("cnpj")
    def validate_cnpj(self, key, value):
        if not validar_cnpj(value): raise ValueError(f"CNPJ inválido: {value}")
        return normalizar_documento(value)

    @property
    def configuracoes(self):
        try: return json.loads(self.configuracoes_json or "{}")
        except: return {}

    @configuracoes.setter
    def configuracoes(self, value):
        self.configuracoes_json = json.dumps(value)

    def to_dict(self, depth=0):
        data = super().to_dict(depth=depth)
        data["endereco_completo"] = self.endereco_completo()
        if self.vencimento_assinatura:
            data["vencimento_assinatura"] = self.vencimento_assinatura.isoformat()
        return data

# ------------------------------------------------------------------------------
# Sincronização Unificada (Offline‑first)
# ------------------------------------------------------------------------------
class SyncQueue(db.Model, MultiTenantMixin):
    __tablename__ = "sync_queue"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    tabela = db.Column(db.String(50), nullable=False)
    registro_id = db.Column(db.Integer, nullable=False)
    operacao = db.Column(db.String(50), nullable=False)  # insert, update, delete, replicar_para_neon, etc.
    payload_json = db.Column(db.Text)
    status = db.Column(db.String(20), default="pendente")
    tentativas = db.Column(db.Integer, default=0)
    mensagem_erro = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)
    synced_at = db.Column(db.DateTime)
    __table_args__ = (db.Index("ix_sync_queue_status", "status"), db.Index("ix_sync_queue_created", "created_at"))

    def to_dict(self):
        return {"id": self.id, "tabela": self.tabela, "registro_id": self.registro_id, "operacao": self.operacao,
                "status": self.status, "created_at": self.created_at.isoformat() if self.created_at else None,
                "synced_at": self.synced_at.isoformat() if self.synced_at else None}

    def to_sync_payload(self):
        payload = {}
        if self.payload_json:
            try:
                payload = json.loads(self.payload_json)
            except Exception:
                payload = {}

        return {
            "tabela": self.tabela,
            "registro_id": self.registro_id,
            "operacao": (self.operacao or "").upper(),
            "estabelecimento_id": self.estabelecimento_id,
            "payload": payload,
            "timestamp": self.created_at.isoformat() if self.created_at else None,
        }

    @classmethod
    def registrar_mutacao(cls, estabelecimento_id, tabela, registro_id, operacao, payload):
        if not estabelecimento_id: return False
        try:
            nova = cls(estabelecimento_id=estabelecimento_id, tabela=tabela, registro_id=registro_id,
                       operacao=operacao, payload_json=json.dumps(payload, default=str))
            db.session.add(nova)
            return True
        except: return False

def _should_sync(instance) -> bool:
    if not is_offline_mode(): return False
    if isinstance(instance, SyncQueue): return False
    return True

@event.listens_for(db.session, "after_flush")
def after_flush_listener(session, flush_context):
    if not is_offline_mode(): return
    for obj in session.new:
        if _should_sync(obj) and hasattr(obj, "estabelecimento_id"):
            SyncQueue.registrar_mutacao(obj.estabelecimento_id, obj.__tablename__, obj.id, "insert",
                                        obj.to_dict() if hasattr(obj, "to_dict") else {})
    for obj in session.dirty:
        if _should_sync(obj) and hasattr(obj, "estabelecimento_id"):
            SyncQueue.registrar_mutacao(obj.estabelecimento_id, obj.__tablename__, obj.id, "update",
                                        obj.to_dict() if hasattr(obj, "to_dict") else {})
    for obj in session.deleted:
        if _should_sync(obj) and hasattr(obj, "estabelecimento_id"):
            SyncQueue.registrar_mutacao(obj.estabelecimento_id, obj.__tablename__, obj.id, "delete", {"id": obj.id})

# ==============================================================================
# MODELOS DE DADOS (Parte 2/4)
# ==============================================================================

# ------------------------------------------------------------------------------
# Modelos de Negócio
# ------------------------------------------------------------------------------

class Lead(db.Model):
    __tablename__ = "leads"
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    whatsapp = db.Column(db.String(30), nullable=False)
    origem = db.Column(db.String(100), default="landing_page")
    observacao = db.Column(db.Text)
    data_cadastro = db.Column(db.DateTime, default=utcnow)

    def to_dict(self):
        return {"id": self.id, "nome": self.nome, "email": self.email, "whatsapp": self.whatsapp,
                "origem": self.origem, "data_cadastro": self.data_cadastro.isoformat() if self.data_cadastro else None}

class Configuracao(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "configuracoes"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    logo_url = db.Column(db.String(500))
    logo_base64 = db.Column(db.Text)
    cor_principal = db.Column(db.String(7), default="#2563eb")
    tema_escuro = db.Column(db.Boolean, default=False)
    emitir_nfe = db.Column(db.Boolean, default=False)
    emitir_nfce = db.Column(db.Boolean, default=True)
    impressao_automatica = db.Column(db.Boolean, default=False)
    tipo_impressora = db.Column(db.String(20), default="termica_80mm")
    exibir_preco_tela = db.Column(db.Boolean, default=True)
    mostrar_foto_produto_pdv = db.Column(db.Boolean, default=False)
    permitir_venda_sem_estoque = db.Column(db.Boolean, default=False)
    desconto_maximo_percentual = db.Column(db.Numeric(5, 2), default=10.00)
    desconto_maximo_funcionario = db.Column(db.Numeric(5, 2), default=10.00)
    arredondamento_valores = db.Column(db.Boolean, default=True)
    formas_pagamento = db.Column(db.Text, default='["Dinheiro", "Cartão de Crédito", "Cartão de Débito", "PIX", "Vale Alimentação", "Vale Refeição", "Fiado"]')
    motivos_estorno = db.Column(db.Text, default='["Erro de digitação", "Desistência do cliente", "Produto avariado", "Cobrança duplicada", "Treinamento/Teste"]')
    controlar_validade = db.Column(db.Boolean, default=True)
    alerta_estoque_minimo = db.Column(db.Boolean, default=True)
    dias_alerta_validade = db.Column(db.Integer, default=30)
    estoque_minimo_padrao = db.Column(db.Integer, default=10)
    tempo_sessao_minutos = db.Column(db.Integer, default=30)
    tentativas_senha_bloqueio = db.Column(db.Integer, default=3)
    alertas_email = db.Column(db.Boolean, default=False)
    alertas_whatsapp = db.Column(db.Boolean, default=False)
    horas_extras_percentual = db.Column(db.Numeric(5, 2), default=50.00)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (db.UniqueConstraint("estabelecimento_id", name="uq_configuracao_estab"),)

    def to_dict(self, depth=0):
        data = super().to_dict(depth=depth)
        try: data["formas_pagamento"] = json.loads(self.formas_pagamento or "[]")
        except: data["formas_pagamento"] = ["Dinheiro", "Cartão de Crédito", "Cartão de Débito", "PIX", "Vale Alimentação", "Vale Refeição", "Fiado"]
        try: data["motivos_estorno"] = json.loads(self.motivos_estorno or "[]")
        except: data["motivos_estorno"] = ["Erro de digitação", "Desistência do cliente", "Produto avariado", "Cobrança duplicada", "Treinamento/Teste"]
        return data

class Funcionario(db.Model, MultiTenantMixin, UserMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "funcionarios"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(150), nullable=False)
    cpf = db.Column(db.String(14), nullable=False)
    rg = db.Column(db.String(20))
    data_nascimento = db.Column(db.Date, nullable=False)
    celular = db.Column(db.String(30), nullable=False)
    telefone = db.Column(db.String(30))
    email = db.Column(db.String(100), nullable=False)
    cargo = db.Column(db.String(50), nullable=False)
    data_admissao = db.Column(db.Date, nullable=False)
    data_demissao = db.Column(db.Date)
    salario_base = db.Column(db.Numeric(19, 4), default=0)
    salario = db.Column(db.Numeric(10, 2))
    observacoes = db.Column(db.Text)
    permissoes_json = db.Column(db.Text)
    username = db.Column(db.String(50), nullable=False)
    senha = db.Column(db.String(255), nullable=False)
    pin_cancelamento = db.Column(db.String(255))  # Hash do PIN numérico (4 a 6 dígitos) para cancelamentos/estornos
    foto_url = db.Column(db.String(500))
    role = db.Column(db.String(30), default="FUNCIONARIO")
    # nivel_acesso: 1=Admin, 2=Gerente, 3=RH, 4=Estoque/Caixa, 5=Vendedor, 6=Entregador
    nivel_acesso = db.Column(db.Integer, default=4)
    status = db.Column(db.String(20), default="ativo")
    is_super_admin = db.Column(db.Boolean, default=False)
    permissoes = db.Column(db.JSON, default=lambda: {"pdv": True, "estoque": True, "compras": False, "financeiro": False, "configuracoes": False})
    ativo = db.Column(db.Boolean, default=True)
    data_cadastro = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (
        db.Index("ix_funcionario_cpf", "cpf"),
        db.Index("ix_funcionario_estabelecimento", "estabelecimento_id"),
        db.UniqueConstraint("estabelecimento_id", "cpf", name="uq_funcionario_estab_cpf"),
        db.UniqueConstraint("estabelecimento_id", "username", name="uq_funcionario_estab_username"),
    )

    @validates("cpf")
    def validate_cpf(self, key, value):
        if not value: return value
        n = normalizar_documento(value)
        if not validar_cpf(n): raise ValueError("CPF inválido")
        return n

    @property
    def is_authenticated(self): return bool(self.ativo)
    @property
    def is_active(self): return bool(self.ativo)
    @property
    def is_anonymous(self): return False
    def get_id(self): return str(self.id)
    def get_username(self): return self.username
    def set_password(self, p): self.senha = generate_password_hash(p)
    def check_password(self, p): return check_password_hash(self.senha, p)
    set_senha = set_password
    check_senha = check_password

    def set_pin(self, pin):
        """Define o PIN de cancelamento/estorno (4 a 6 dígitos numéricos), armazenado com hash."""
        pin = str(pin or "").strip()
        if not pin:
            self.pin_cancelamento = None
            return
        if not (pin.isdigit() and 4 <= len(pin) <= 6):
            raise ValueError("PIN deve conter de 4 a 6 dígitos numéricos")
        self.pin_cancelamento = generate_password_hash(pin)

    def check_pin(self, pin):
        """Valida o PIN informado contra o hash armazenado."""
        if not self.pin_cancelamento or not pin:
            return False
        return check_password_hash(self.pin_cancelamento, str(pin).strip())

    @property
    def tem_pin(self):
        return bool(self.pin_cancelamento)

    def to_dict(self, depth=0):
        data = super().to_dict(depth=depth)
        # Security: Never expose password fields in API responses
        # Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
        data.pop("senha", None)
        data.pop("password", None)
        data.pop("password_hash", None)
        # Nunca expor o hash do PIN; expor apenas se está configurado
        data.pop("pin_cancelamento", None)
        data["tem_pin"] = self.tem_pin
        data["usuario"] = self.username
        # Compat: telas antigas leem "nivel_acesso" como string do cargo.
        # "nivel" é o número canônico (1=Admin … 6=Entregador) usado nos gates.
        data["nivel_acesso"] = self.role
        from app.decorators.rbac import nivel_do_role
        data["nivel"] = 0 if self.is_super_admin else nivel_do_role(self.role)
        data["salario"] = float(self.salario) if self.salario else (float(self.salario_base) if self.salario_base else 0.0)
        return data

class FuncionarioPreferencias(db.Model, MultiTenantMixin):
    __tablename__ = "funcionarios_preferencias"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), unique=True, nullable=False)
    tema_escuro = db.Column(db.Boolean, default=False)
    notificacoes_push = db.Column(db.Boolean, default=True)
    idioma = db.Column(db.String(10), default="pt-BR")
    sidebar_colapsada = db.Column(db.Boolean, default=False)
    filtros_salvos = db.Column(db.JSON, default=dict)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    funcionario = db.relationship("Funcionario", backref=db.backref("preferencias", uselist=False, cascade="all, delete-orphan"))

    def to_dict(self):
        return {"tema_escuro": bool(self.tema_escuro), "notificacoes_push": bool(self.notificacoes_push),
                "idioma": self.idioma, "sidebar_colapsada": bool(self.sidebar_colapsada), "filtros_salvos": self.filtros_salvos or {}}

class Beneficio(db.Model, MultiTenantMixin):
    __tablename__ = "beneficios"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(100), nullable=False)
    descricao = db.Column(db.String(200))
    valor_padrao = db.Column(db.Numeric(19, 4), default=0)
    ativo = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {"id": self.id, "nome": self.nome, "descricao": self.descricao,
                "valor_padrao": float(self.valor_padrao) if self.valor_padrao else 0.0, "ativo": self.ativo}

class FuncionarioBeneficio(db.Model, MultiTenantMixin):
    __tablename__ = "funcionario_beneficios"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), nullable=False, index=True)
    beneficio_id = db.Column(db.Integer, db.ForeignKey("beneficios.id", ondelete="CASCADE"), nullable=False, index=True)
    valor = db.Column(db.Numeric(19, 4), nullable=False)
    data_inicio = db.Column(db.Date, default=date.today)
    ativo = db.Column(db.Boolean, default=True)
    funcionario = db.relationship("Funcionario", backref=db.backref("beneficios_ativos", lazy=True))
    beneficio = db.relationship("Beneficio")

class BancoHoras(db.Model, MultiTenantMixin):
    __tablename__ = "banco_horas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), nullable=False, index=True)
    mes_referencia = db.Column(db.String(7), nullable=False)
    saldo_minutos = db.Column(db.Integer, default=0)
    valor_hora_extra = db.Column(db.Numeric(19, 4), default=0)
    horas_trabalhadas_minutos = db.Column(db.Integer, default=0)
    horas_esperadas_minutos = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    funcionario = db.relationship("Funcionario", backref=db.backref("banco_horas", lazy=True))
    __table_args__ = (db.UniqueConstraint("funcionario_id", "mes_referencia", name="uq_banco_func_mes"),)


class EspelhoAssinatura(db.Model, MultiTenantMixin):
    """Confirmação do funcionário de que conferiu seu espelho de ponto do período
    (Regra de Acesso: todo funcionário deve poder assinar seu próprio espelho)."""
    __tablename__ = "espelho_assinaturas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), nullable=False, index=True)
    data_inicio = db.Column(db.Date, nullable=False)
    data_fim = db.Column(db.Date, nullable=False)
    assinado_em = db.Column(db.DateTime, default=utcnow)
    funcionario = db.relationship("Funcionario", backref=db.backref("espelhos_assinados", lazy=True))
    __table_args__ = (db.UniqueConstraint("funcionario_id", "data_inicio", "data_fim", name="uq_espelho_func_periodo"),)


# Tipos de rescisão (CLT) — string simples p/ evitar enum nativo no Postgres
TIPOS_RESCISAO = ("PEDIDO", "S_JUSTA", "C_JUSTA", "ACORDO")


class Rescisao(db.Model, MultiTenantMixin, AuditMixin, SerializableMixin):
    """Rescisão de contrato com a memória de cálculo das verbas rescisórias.
    O `verbas_rescisorias_json` guarda o detalhamento verba a verba para o
    lojista entregar ao contador (estimativa — não substitui o TRCT oficial)."""
    __tablename__ = "rescisoes"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), nullable=False, index=True)
    despesa_id = db.Column(db.Integer, db.ForeignKey("despesas.id", ondelete="SET NULL"), nullable=True, index=True)
    data_demissao = db.Column(db.Date, nullable=False)
    tipo_rescisao = db.Column(db.String(20), nullable=False)  # ver TIPOS_RESCISAO
    verbas_rescisorias_json = db.Column(db.JSON, default=dict)
    total_proventos = db.Column(db.Numeric(19, 4), default=0)
    total_descontos = db.Column(db.Numeric(19, 4), default=0)
    total_liquido = db.Column(db.Numeric(19, 4), default=0)
    forma_pagamento = db.Column(db.String(50))
    funcionario = db.relationship("Funcionario", backref=db.backref("rescisoes", lazy=True))
    despesa = db.relationship("Despesa", backref=db.backref("rescisao", uselist=False))
    __table_args__ = (db.Index("ix_rescisao_funcionario", "funcionario_id"),)

    def to_dict(self, include_relationships: bool = False, depth: int = 0):
        data = super().to_dict(include_relationships=include_relationships, depth=depth)
        data["funcionario_nome"] = self.funcionario.nome if self.funcionario else None
        return data


class ProvisaoTrabalhista(db.Model, MultiTenantMixin, AuditMixin, SerializableMixin):
    """Provisão mensal (1/12 avos) de férias, 13º e encargos — permite exibir o
    'Custo Real' do funcionário, não apenas o salário nominal."""
    __tablename__ = "provisoes_trabalhistas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), nullable=False, index=True)
    ano_mes = db.Column(db.String(7), nullable=False)  # 'YYYY-MM'
    valor_ferias = db.Column(db.Numeric(19, 4), default=0)
    valor_decimo_terceiro = db.Column(db.Numeric(19, 4), default=0)
    encargos_provisionados = db.Column(db.Numeric(19, 4), default=0)
    custo_real = db.Column(db.Numeric(19, 4), default=0)
    funcionario = db.relationship("Funcionario", backref=db.backref("provisoes", lazy=True))
    __table_args__ = (db.UniqueConstraint("funcionario_id", "ano_mes", name="uq_provisao_func_mes"),)

    def to_dict(self, include_relationships: bool = False, depth: int = 0):
        data = super().to_dict(include_relationships=include_relationships, depth=depth)
        data["funcionario_nome"] = self.funcionario.nome if self.funcionario else None
        return data


# Defaults CLT (tabelas 2024/2025) — editáveis por tenant via ConfiguracaoFolha
INSS_FAIXAS_PADRAO = [
    {"ate": 1412.00, "aliquota": 7.5},
    {"ate": 2666.68, "aliquota": 9.0},
    {"ate": 4000.03, "aliquota": 12.0},
    {"ate": 7786.02, "aliquota": 14.0},
]
IRRF_FAIXAS_PADRAO = [
    {"ate": 2259.20, "aliquota": 0.0, "deducao": 0.0},
    {"ate": 2826.65, "aliquota": 7.5, "deducao": 169.44},
    {"ate": 3751.05, "aliquota": 15.0, "deducao": 381.44},
    {"ate": 4664.68, "aliquota": 22.5, "deducao": 662.77},
    {"ate": None, "aliquota": 27.5, "deducao": 896.00},
]


class ConfiguracaoFolha(db.Model, MultiTenantMixin, AuditMixin, SerializableMixin):
    """Parâmetros de folha 100% configuráveis por loja (nada hardcoded):
    hora extra, adicional noturno, divisor de horas, FGTS, multa rescisória,
    desconto de VT e as tabelas progressivas de INSS/IRRF."""
    __tablename__ = "configuracoes_folha"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    divisor_horas_mensais = db.Column(db.Integer, default=220)         # jornada mensal p/ valor-hora
    percentual_hora_extra = db.Column(db.Numeric(6, 2), default=50)    # % adicional de hora extra
    percentual_adicional_noturno = db.Column(db.Numeric(6, 2), default=20)
    fgts_percentual = db.Column(db.Numeric(6, 2), default=8)
    multa_fgts_dispensa = db.Column(db.Numeric(6, 2), default=40)
    multa_fgts_acordo = db.Column(db.Numeric(6, 2), default=20)
    desconto_vt_percentual = db.Column(db.Numeric(6, 2), default=6)    # teto legal de desconto de VT
    deducao_por_dependente = db.Column(db.Numeric(19, 4), default=189.59)  # IRRF
    inss_faixas = db.Column(db.JSON, default=lambda: list(INSS_FAIXAS_PADRAO))
    irrf_faixas = db.Column(db.JSON, default=lambda: list(IRRF_FAIXAS_PADRAO))
    __table_args__ = (db.UniqueConstraint("estabelecimento_id", name="uq_config_folha_estab"),)

    def to_dict(self, include_relationships: bool = False, depth: int = 0):
        data = super().to_dict(include_relationships=include_relationships, depth=depth)
        # Garante as tabelas mesmo em registros antigos
        data["inss_faixas"] = self.inss_faixas or list(INSS_FAIXAS_PADRAO)
        data["irrf_faixas"] = self.irrf_faixas or list(IRRF_FAIXAS_PADRAO)
        return data


class JustificativaPonto(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "justificativas_ponto"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), nullable=False, index=True)
    aprovador_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True, index=True)
    tipo = db.Column(db.String(30), nullable=False)
    data = db.Column(db.Date, nullable=False)
    motivo = db.Column(db.Text, nullable=False)
    observacao = db.Column(db.Text)
    documento_url = db.Column(db.String(500))
    status = db.Column(db.String(20), default="pendente")
    data_resposta = db.Column(db.DateTime)
    motivo_rejeicao = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    funcionario = db.relationship("Funcionario", foreign_keys=[funcionario_id], backref=db.backref("justificativas", lazy=True, cascade="all, delete-orphan"))
    aprovador = db.relationship("Funcionario", foreign_keys=[aprovador_id], backref=db.backref("justificativas_aprovadas", lazy=True))
    __table_args__ = (db.Index("ix_justificativa_funcionario", "funcionario_id"), db.Index("ix_justificativa_data", "data"), db.Index("ix_justificativa_status", "status"))

    def to_dict(self):
        return {"id": self.id, "funcionario_id": self.funcionario_id, "funcionario_nome": self.funcionario.nome if self.funcionario else None,
                "aprovador_id": self.aprovador_id, "aprovador_nome": self.aprovador.nome if self.aprovador else None,
                "tipo": self.tipo, "data": self.data.isoformat() if self.data else None, "motivo": self.motivo,
                "documento_url": self.documento_url,
                "status": self.status,
                "motivo_rejeicao": self.motivo_rejeicao,
                "data_resposta": self.data_resposta.isoformat() if self.data_resposta else None,
                "created_at": self.created_at.isoformat() if self.created_at else None}

class Cliente(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin, AuditMixin, EnderecoMixin):
    __tablename__ = "clientes"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(150), nullable=False)
    cpf = db.Column(db.String(14), nullable=False)
    rg = db.Column(db.String(20))
    data_nascimento = db.Column(db.Date)
    telefone = db.Column(db.String(30))
    celular = db.Column(db.String(30), nullable=False)
    email = db.Column(db.String(100))
    limite_credito = db.Column(db.Numeric(19, 4), default=0)
    saldo_devedor = db.Column(db.Numeric(19, 4), default=0)
    ultima_compra = db.Column(db.DateTime)
    total_compras = db.Column(db.Integer, default=0)
    valor_total_gasto = db.Column(db.Numeric(19, 4), default=0)
    ativo = db.Column(db.Boolean, default=True)
    tabela_preco_id = db.Column(db.Integer, db.ForeignKey("tabelas_preco.id"), nullable=True, index=True)
    rota_id = db.Column(db.Integer, db.ForeignKey("rotas.id"), nullable=True, index=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True, index=True)
    observacoes = db.Column(db.Text)
    data_cadastro = db.Column(db.DateTime, default=utcnow)
    data_atualizacao = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    deleted_at = db.Column(db.DateTime, nullable=True)
    
    # Inteligência de Crédito e CRM Avançado
    score_credito = db.Column(db.Integer, default=500) # 0 a 1000
    bom_pagador = db.Column(db.Boolean, default=True)
    risco_inadimplencia = db.Column(db.String(20), default="BAIXO") # BAIXO, MEDIO, ALTO
    atraso_medio_dias = db.Column(db.Float, default=0.0)

    __table_args__ = (db.Index("ix_cliente_cpf", "cpf"), db.Index("ix_cliente_nome", "nome"), db.UniqueConstraint("estabelecimento_id", "cpf", name="uq_cliente_estab_cpf"))

    @staticmethod
    def segmentar_rfm(recency_score: int, frequency_score: int, monetary_score: int) -> str:
        r, f, m = int(recency_score), int(frequency_score), int(monetary_score)
        if r >= 4 and f >= 4 and m >= 4: return "Campeão"
        if r >= 4 and f >= 3: return "Fiel"
        if r <= 2 and (f >= 3 or m >= 3): return "Risco"
        if r == 1 and f <= 2: return "Perdido"
        return "Regular"

    @classmethod
    def calcular_rfm(cls, estabelecimento_id, days: int = 180) -> Dict[str, Any]:
        from sqlalchemy import text
        from datetime import datetime, timezone

        estab_filter = ""
        venda_estab_filter = ""
        params = {}
        if str(estabelecimento_id).lower() != 'all':
            estab_filter = "AND c.estabelecimento_id = :estab_id"
            venda_estab_filter = "AND v.estabelecimento_id = :estab_id"
            params["estab_id"] = estabelecimento_id

        engine_name = str(db.engine.name).lower()
        if 'sqlite' in engine_name:
            dow_expr = "CAST(strftime('%w', v.data_venda) AS INTEGER)"
        else:
            dow_expr = "EXTRACT(DOW FROM v.data_venda)"

        # Query principal de inteligência (sem limite de 180 dias fixo, varre base ativa com compras)
        sql = f"""
        SELECT 
            c.id as cliente_id,
            c.nome,
            c.total_compras,
            c.valor_total_gasto,
            c.ultima_compra,
            c.saldo_devedor,
            c.score_credito,
            SUM(CASE WHEN {dow_expr} IN (0, 6) THEN 1 ELSE 0 END) as vendas_fds,
            SUM(CASE WHEN v.desconto > 0 THEN 1 ELSE 0 END) as vendas_promo
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id AND v.status = 'finalizada' {venda_estab_filter}
        WHERE c.ativo = true AND c.deleted_at IS NULL AND c.total_compras > 0
        {estab_filter}
        GROUP BY c.id, c.nome, c.total_compras, c.valor_total_gasto, c.ultima_compra, c.saldo_devedor, c.score_credito
        """
        
        rows = db.session.execute(text(sql), params).fetchall()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        
        metrics = []
        for r in rows:
            ultima = r.ultima_compra
            recency_days = (now - ultima).days if ultima else 999
            ticket_medio = float(r.valor_total_gasto) / int(r.total_compras) if r.total_compras else 0
            metrics.append({
                "cliente_id": r.cliente_id,
                "nome": r.nome,
                "recency_days": int(recency_days),
                "frequency": int(r.total_compras),
                "monetary": float(r.valor_total_gasto),
                "ticket_medio": ticket_medio,
                "saldo_devedor": float(r.saldo_devedor or 0),
                "score_credito": int(r.score_credito or 500),
                "vendas_fds": int(r.vendas_fds or 0),
                "vendas_promo": int(r.vendas_promo or 0)
            })

        if not metrics:
            return {"segments": {}, "customers": [], "consumidor_final": {}, "window_days": days}

        frequency_sorted = sorted(m["frequency"] for m in metrics)
        ticket_sorted = sorted(m["ticket_medio"] for m in metrics)

        # Limiares 75%
        freq_alta = frequency_sorted[int(len(frequency_sorted) * 0.75)] if len(frequency_sorted) > 3 else 3
        ticket_alto = ticket_sorted[int(len(ticket_sorted) * 0.75)] if len(ticket_sorted) > 3 else 100

        segments_count = {
            "VIP": 0, "Premium": 0, "Final de Semana": 0, 
            "Caçador de Promoções": 0, "Novo": 0, "Raro": 0, "Regular": 0
        }
        customers = []

        for m in metrics:
            f = m["frequency"]
            tm = m["ticket_medio"]
            r_days = m["recency_days"]
            fds = m["vendas_fds"]
            promo = m["vendas_promo"]

            seg = "Regular"
            if f == 1: seg = "Novo"
            elif r_days > 90 and f < freq_alta: seg = "Raro"
            elif f >= freq_alta and tm >= ticket_alto: seg = "VIP"
            elif f >= freq_alta or tm >= ticket_alto: seg = "Premium"
            elif fds > (f * 0.5): seg = "Final de Semana"
            elif promo > (f * 0.5): seg = "Caçador de Promoções"

            segments_count[seg] += 1
            
            risco = "BAIXO"
            if m["saldo_devedor"] > 0:
                if m["score_credito"] < 300: risco = "ALTO"
                elif m["score_credito"] < 700: risco = "MEDIO"

            bom_pagador = m["saldo_devedor"] == 0 or m["score_credito"] >= 700
            sugestao_limite = round(tm * f * 0.3, 2) if m["score_credito"] >= 600 else 0

            customers.append({
                **m,
                "segment": seg,
                "risco_inadimplencia": risco,
                "bom_pagador": bom_pagador,
                "sugestao_limite": sugestao_limite
            })

        cf_sql = f"""
        SELECT 
            COUNT(*) as total_vendas,
            SUM(CASE WHEN cliente_id IS NULL THEN 1 ELSE 0 END) as cf_vendas,
            SUM(CASE WHEN cliente_id IS NULL THEN total ELSE 0 END) as cf_valor
        FROM vendas
        WHERE status = 'finalizada'
        {estab_filter.replace('c.estabelecimento_id', 'estabelecimento_id')}
        """
        cf_row = db.session.execute(text(cf_sql), params).fetchone()
        
        consumidor_final = {
            "percentual_vendas": round((cf_row.cf_vendas / cf_row.total_vendas * 100) if cf_row.total_vendas else 0, 1),
            "valor_arrecadado": float(cf_row.cf_valor or 0)
        }

        return {
            "segments": segments_count,
            "customers": customers,
            "consumidor_final": consumidor_final,
            "window_days": days
        }

class Fornecedor(db.Model, MultiTenantMixin, EnderecoMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "fornecedores"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome_fantasia = db.Column(db.String(150), nullable=False)
    razao_social = db.Column(db.String(150), nullable=False)
    cnpj = db.Column(db.String(18), nullable=False)
    inscricao_estadual = db.Column(db.String(20))
    telefone = db.Column(db.String(30), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    contato_nome = db.Column(db.String(100))
    contato_telefone = db.Column(db.String(30))
    prazo_entrega = db.Column(db.Integer, default=7)
    forma_pagamento = db.Column(db.String(50), default="30 DIAS")
    classificacao = db.Column(db.String(20), default="REGULAR")
    total_compras = db.Column(db.Integer, default=0)
    valor_total_comprado = db.Column(db.Numeric(19, 4), default=0)
    
    # Inteligencia e Metricas
    score_geral = db.Column(db.Integer, default=50) # 0 a 100
    atraso_medio_dias = db.Column(db.Float, default=0.0)
    percentual_entregas_no_prazo = db.Column(db.Float, default=100.0)
    desconto_medio_percentual = db.Column(db.Float, default=0.0)
    prazo_pagamento_medio_dias = db.Column(db.Float, default=0.0)

    ativo = db.Column(db.Boolean, default=True)
    data_cadastro = db.Column(db.DateTime, default=utcnow)
    data_atualizacao = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (db.Index("ix_fornecedor_cnpj", "cnpj"), db.UniqueConstraint("estabelecimento_id", "cnpj", name="uq_fornecedor_estab_cnpj"))

    @validates("cnpj")
    def validate_cnpj(self, key, value):
        if not validar_cnpj(value): raise ValueError(f"CNPJ inválido: {value}")
        return normalizar_documento(value)

class CategoriaProduto(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin):
    __tablename__ = "categorias_produto"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(50), nullable=False)
    descricao = db.Column(db.Text)
    codigo = db.Column(db.String(20))
    ativo = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    deleted_at = db.Column(db.DateTime, nullable=True)
    __table_args__ = (db.Index("ix_categoria_nome", "nome"), db.UniqueConstraint("estabelecimento_id", "nome", name="uq_categoria_estab_nome"))

    @staticmethod
    def normalizar_nome_categoria(nome: str) -> str:
        if not nome: return ""
        return " ".join(nome.strip().split()).title()

    def to_dict(self):
        return {"id": self.id, "nome": self.nome, "descricao": self.descricao, "codigo": self.codigo, "ativo": self.ativo}

class Produto(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "produtos"
    


    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    categoria_id = db.Column(db.Integer, db.ForeignKey("categorias_produto.id"), nullable=False, index=True)
    fornecedor_id = db.Column(db.Integer, db.ForeignKey("fornecedores.id"), index=True)
    codigo_barras = db.Column(db.String(50))
    codigo_interno = db.Column(db.String(50))
    nome = db.Column(db.String(100), nullable=False)
    descricao = db.Column(db.Text)
    marca = db.Column(db.String(50))
    fabricante = db.Column(db.String(100))
    tipo = db.Column(db.String(50))
    subcategoria = db.Column(db.String(50))
    unidade_medida = db.Column(db.String(20), default="UN")
    quantidade = db.Column(db.Numeric(10, 3), default=0.0)
    quantidade_minima = db.Column(db.Numeric(10, 3), default=10.0)
    preco_custo = db.Column(db.Numeric(19, 4), nullable=False)
    preco_venda = db.Column(db.Numeric(19, 4), nullable=False)
    margem_lucro = db.Column(db.Numeric(19, 4), nullable=True)
    ncm = db.Column(db.String(8))
    origem = db.Column(db.Integer, default=0)
    # ---- Campos fiscais (NFC-e / NF-e) ----
    cest = db.Column(db.String(7))
    cfop_padrao = db.Column(db.String(4), default="5102")
    cst_icms = db.Column(db.String(3))          # usado no regime normal
    csosn = db.Column(db.String(3), default="102")  # usado no Simples Nacional
    unidade_tributavel = db.Column(db.String(6))
    icms_aliquota = db.Column(db.Numeric(5, 2), default=0)
    pis_aliquota = db.Column(db.Numeric(5, 2), default=0)
    cofins_aliquota = db.Column(db.Numeric(5, 2), default=0)
    total_vendido = db.Column(db.Numeric(19, 4), default=0.0)
    quantidade_vendida = db.Column(db.Numeric(10, 3), default=0.0)
    ultima_venda = db.Column(db.DateTime)
    classificacao_abc = db.Column(db.String(1))
    data_fabricacao = db.Column(db.Date)
    data_validade = db.Column(db.Date)
    data_compra = db.Column(db.Date)        # data do pedido de compra ao fornecedor
    data_recebimento = db.Column(db.Date)   # data em que a mercadoria chegou ao estoque
    lote = db.Column(db.String(50))
    imagem_url = db.Column(db.String(500))  # ampliado de 255 para suportar URLs longas
    controlar_validade = db.Column(db.Boolean, default=True)
    # ---- Motor de renderização contextual (nível Produto da cascata) ----
    tipo_item = db.Column(db.String(10), default="produto")   # produto | servico
    controlar_estoque = db.Column(db.Boolean, default=True)   # False p/ serviços: venda não movimenta estoque
    familia_produto = db.Column(db.String(40))
    perfil_fiscal = db.Column(db.String(40))
    atributos_json = db.Column(db.Text, default="{}")         # atributos dinâmicos por segmento (cor, tamanho, dimensões...)
    ativo = db.Column(db.Boolean, default=True)
    deleted_at = db.Column(db.DateTime, nullable=True)
    categoria = db.relationship("CategoriaProduto", backref=db.backref("produtos", lazy=True))
    fornecedor = db.relationship("Fornecedor", backref=db.backref("produtos", lazy=True))
    __table_args__ = (db.Index("ix_produto_nome", "nome"), db.Index("ix_produto_codigo", "codigo_interno"), db.Index("ix_produto_categoria", "categoria_id"),
                      db.UniqueConstraint("estabelecimento_id", "codigo_interno", name="uq_produto_estab_codigo"),
                      db.UniqueConstraint("estabelecimento_id", "codigo_barras", name="uq_produto_estab_codbar"))

    @hybrid_property
    def estoque_status(self):
        try:
            qtd = float(self.quantidade or 0); qtd_min = float(self.quantidade_minima or 0)
            if qtd <= 0: return "esgotado"
            if qtd <= qtd_min: return "critico"
            if qtd <= (qtd_min * 1.5): return "alerta"
            return "normal"
        except: return "normal"

    @estoque_status.expression
    def estoque_status(cls):
        return case((cls.quantidade <= 0, "esgotado"), (cls.quantidade <= cls.quantidade_minima, "critico"),
                    (cls.quantidade <= (cls.quantidade_minima * 1.5), "alerta"), else_="normal")

    def movimentar_estoque(self, quantidade: int, tipo: str, motivo: str, usuario_id: int, venda_id: int = None):
        if tipo == 'saida' and quantidade <= 0: raise ValueError("Quantidade de saída deve ser positiva")
        qtd_anterior = self.quantidade
        if tipo == 'entrada': self.quantidade += quantidade
        elif tipo == 'saida':
            novo_saldo = Decimal(str(self.quantidade or 0)) - Decimal(str(quantidade))
            self.quantidade = novo_saldo if novo_saldo > 0 else Decimal("0")
            self.quantidade_vendida += quantidade
            self.total_vendido += (self.preco_venda * quantidade)
            self.ultima_venda = utcnow()
        return MovimentacaoEstoque(estabelecimento_id=self.estabelecimento_id, produto_id=self.id, venda_id=venda_id,
                                   funcionario_id=usuario_id, tipo=tipo, quantidade=quantidade, quantidade_anterior=qtd_anterior,
                                   quantidade_atual=self.quantidade, custo_unitario=self.preco_custo,
                                   valor_total=self.preco_venda * quantidade if tipo == 'saida' else self.preco_custo * quantidade, motivo=motivo)

    def recalcular_preco_custo_ponderado(self, quantidade_entrada: int, custo_unitario_entrada, estoque_atual: int = None,
                                         registrar_historico: bool = True, funcionario_id: int = None, motivo: str = "Entrada de estoque - CMP",
                                         data_alteracao=None):
        if quantidade_entrada is None or int(quantidade_entrada) <= 0 or custo_unitario_entrada is None: return
        custo_entrada = Decimal(str(custo_unitario_entrada))
        if custo_entrada < 0: raise ValueError("Custo unitário não pode ser negativo")
        qtd_atual = int(self.quantidade or 0) if estoque_atual is None else int(estoque_atual)
        if qtd_atual < 0: qtd_atual = 0
        custo_anterior = Decimal(str(self.preco_custo or 0))
        margem_anterior = Decimal(str(self.margem_lucro or 0))
        qtd_entrada = int(quantidade_entrada)
        base = qtd_atual + qtd_entrada
        if base <= 0: self.preco_custo = custo_entrada
        else:
            novo_custo = ((Decimal(qtd_atual) * custo_anterior) + (Decimal(qtd_entrada) * custo_entrada)) / Decimal(base)
            self.preco_custo = novo_custo.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if self.preco_venda and self.preco_custo and self.preco_custo > 0:
            self.margem_lucro = (self.preco_venda - self.preco_custo) / self.preco_custo * 100
        else: self.margem_lucro = 0
        if registrar_historico and funcionario_id and abs(self.preco_custo - custo_anterior) > Decimal("0.01"):
            historico_kwargs = dict(
                estabelecimento_id=self.estabelecimento_id, produto_id=self.id, funcionario_id=funcionario_id,
                preco_custo_anterior=custo_anterior, preco_venda_anterior=self.preco_venda, margem_anterior=margem_anterior,
                preco_custo_novo=self.preco_custo, preco_venda_novo=self.preco_venda, margem_nova=self.margem_lucro,
                motivo=motivo, observacoes=f"CMP recalculado: entrada de {quantidade_entrada} unidades a R$ {custo_unitario_entrada}")
            if data_alteracao is not None:
                historico_kwargs["data_alteracao"] = data_alteracao
            db.session.add(HistoricoPrecos(**historico_kwargs))

    @staticmethod
    def calcular_preco_por_markup(preco_custo, markup_percentual):
        if preco_custo is None or markup_percentual is None: return Decimal("0")
        custo = Decimal(str(preco_custo)); markup = Decimal(str(markup_percentual))
        if custo < 0 or markup < 0: return Decimal("0")
        return (custo * (1 + markup / 100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @staticmethod
    def calcular_markup_de_preco(preco_custo, preco_venda):
        if preco_custo is None or preco_venda is None: return Decimal("0")
        custo = Decimal(str(preco_custo)); venda = Decimal(str(preco_venda))
        if custo <= 0: return Decimal("0")
        return ((venda - custo) / custo * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    # Janela padrão de análise de giro (varejo alimentar) — alinhada com a ABC.
    GIRO_JANELA_DIAS = 90

    @staticmethod
    def calcular_giro_metrica(quantidade_atual, qtd_janela, dias_ativos, janela_dias: int = 90):
        """FONTE ÚNICA da matemática de giro (VMD / cobertura / classe).

        Todos os consumidores (cards do dashboard, lista, modais e Hub) devem
        passar por aqui para nunca mais divergirem entre si.

        Parâmetros:
        - quantidade_atual: estoque atual em unidades.
        - qtd_janela: unidades vendidas na janela (agregadas do ledger venda_itens).
        - dias_ativos: dias em que o produto esteve vendendo dentro da janela
          (dias desde a 1ª venda, limitado à janela). Evita punir item novo de
          alto volume com um denominador de 90 dias que ele nunca teve.

        Retorna {vmd, cobertura_dias, classe}. classe ∈ {'rapido','normal','lento'}:
        rápido = cobertura ≤ 15d, normal = 16–60d, lento = > 60d ou sem venda.
        """
        try:
            estoque = float(quantidade_atual or 0)
            vendido = float(qtd_janela or 0)
            if vendido <= 0:
                return {"vmd": 0.0, "cobertura_dias": None, "classe": "lento"}
            # Denominador: dias ativos, com piso 1 e teto na janela. Se não
            # informado, usa a janela cheia (leitura conservadora).
            dias = int(dias_ativos or 0)
            if dias <= 0:
                dias = int(janela_dias or 90)
            dias = max(1, min(int(janela_dias or 90), dias))
            vmd = vendido / dias
            if vmd <= 0:
                return {"vmd": 0.0, "cobertura_dias": None, "classe": "lento"}
            cobertura = estoque / vmd
            if cobertura <= 15:
                classe = "rapido"
            elif cobertura <= 60:
                classe = "normal"
            else:
                classe = "lento"
            return {"vmd": round(vmd, 2), "cobertura_dias": round(cobertura, 1), "classe": classe}
        except Exception:
            return {"vmd": 0.0, "cobertura_dias": None, "classe": "lento"}

    @staticmethod
    def calcular_classificacao_abc_dinamica(estabelecimento_id: int, periodo_dias: int = 90):
        data_inicio = utcnow() - timedelta(days=periodo_dias)
        fat = db.session.query(VendaItem.produto_id, func.sum(VendaItem.total_item)).join(Venda)\
            .filter(Venda.estabelecimento_id == estabelecimento_id, Venda.status == 'finalizada', Venda.data_venda >= data_inicio)\
            .group_by(VendaItem.produto_id).order_by(func.sum(VendaItem.total_item).desc()).all()
        if not fat: return {}
        total = sum(Decimal(str(f[1] or 0)) for f in fat)
        if total == 0: return {}
        classificacoes = {}
        acum = Decimal('0')
        for pid, val in fat:
            acum += Decimal(str(val or 0))
            pct = acum / total * 100
            if pct <= 80: classificacoes[pid] = 'A'
            elif pct <= 95: classificacoes[pid] = 'B'
            else: classificacoes[pid] = 'C'
        return classificacoes

    @staticmethod
    def atualizar_classificacoes_abc(estabelecimento_id: int, periodo_dias: int = 90):
        classificacoes = Produto.calcular_classificacao_abc_dinamica(estabelecimento_id, periodo_dias)
        # Uma única query pelo tenant inteiro — antes era um Produto.query.get()
        # POR produto classificado (milhares de round-trips no banco remoto).
        produtos = Produto.query.filter(Produto.estabelecimento_id == estabelecimento_id).all()
        atualizados = 0
        sem = []
        for p in produtos:
            nova = classificacoes.get(p.id)
            if nova is None:
                if p.ativo:
                    sem.append(p)
                    nova = 'C'
                else:
                    continue
            if p.classificacao_abc != nova:
                p.classificacao_abc = nova
            atualizados += 1
        db.session.commit()
        return {'produtos_atualizados': atualizados, 'classe_a': sum(1 for c in classificacoes.values() if c == 'A'),
                'classe_b': sum(1 for c in classificacoes.values() if c == 'B'), 'classe_c': sum(1 for c in classificacoes.values() if c == 'C'),
                'sem_vendas': len(sem)}

    def demanda_media_diaria(self, days: int = 30) -> float:
        days = int(days) if days else 30
        if days <= 0: days = 30
        data_inicio = utcnow() - timedelta(days=days)
        total = db.session.query(func.coalesce(func.sum(VendaItem.quantidade), 0)).join(Venda)\
            .filter(Venda.estabelecimento_id == self.estabelecimento_id, Venda.data_venda >= data_inicio, Venda.status == "finalizada", VendaItem.produto_id == self.id).scalar() or 0
        return float(total) / float(days)

    def ponto_ressuprimento(self, lead_time_dias: int, days: int = 30, fator_seguranca: float = 1.5) -> float:
        if lead_time_dias <= 0: return 0.0
        return float(self.demanda_media_diaria(days)) * float(lead_time_dias) * float(fator_seguranca)

    def calcular_giro(self, days: int = 30) -> float:
        try:
            vendido = float(self.quantidade_vendida or 0); estoque = float(self.quantidade or 0)
            if estoque <= 0: return 0.0
            return vendido / estoque
        except: return 0.0

    def calcular_cobertura_dias(self, days: int = 30):
        try:
            dmd = self.demanda_media_diaria(days)
            if dmd <= 0: return "Indeterminado" if float(self.quantidade or 0) > 0 else "Sem Estoque"
            return round(float(self.quantidade or 0) / dmd, 1)
        except: return "---"

    def calcular_status_giro(self, days: int = 30) -> str:
        try:
            dmd = self.demanda_media_diaria(days)
            if dmd <= 0: return "Sem Vendas"
            if dmd < 1: return "Baixo Giro"
            if dmd < 5: return "Médio Giro"
            return "Alto Giro"
        except: return "Sem Vendas"

    def get_lotes_disponiveis(self):
        return ProdutoLote.query.filter_by(produto_id=self.id, estabelecimento_id=self.estabelecimento_id, ativo=True).filter(ProdutoLote.quantidade > 0).order_by(ProdutoLote.data_validade.asc(), ProdutoLote.id.asc()).with_for_update().all()

    def consumir_estoque_fifo(self, quantidade) -> List[Dict]:
        consumidos = []
        qtd_solicitada = Decimal(str(quantidade or 0))
        restante = qtd_solicitada
        for lote in self.get_lotes_disponiveis():
            if restante <= 0: break
            disponivel = Decimal(str(lote.quantidade or 0))
            qtd = min(restante, disponivel)
            lote.quantidade = disponivel - qtd
            restante -= qtd
            consumidos.append({'lote_id': lote.id, 'quantidade_consumida': qtd, 'lote': lote})
        # Nunca deixa o estoque agregado ficar negativo (piso em 0)
        novo_saldo = Decimal(str(self.quantidade or 0)) - qtd_solicitada
        self.quantidade = novo_saldo if novo_saldo > 0 else Decimal("0")
        return consumidos

    @property
    def atributos(self) -> Dict:
        try:
            return json.loads(self.atributos_json or "{}")
        except Exception:
            return {}

    @atributos.setter
    def atributos(self, value):
        self.atributos_json = json.dumps(value or {}, ensure_ascii=False, default=str)

    def to_dict(self, depth=0, include_metrics=False, include_relationships=False):
        data = super().to_dict(include_relationships=include_relationships, depth=depth)

        # Injetar categoria para o Frontend (que espera a string do nome)
        if hasattr(self, 'categoria') and getattr(self, 'categoria'):
            data["categoria"] = self.categoria.nome
        else:
            data["categoria"] = "Sem Categoria"

        # Garantir retorno correto de ativo
        data["ativo"] = bool(self.ativo)

        # Motor contextual: JSON cru sai, dict parseado entra; legado (None) = produto que controla estoque
        data.pop("atributos_json", None)
        data["atributos"] = self.atributos
        data["tipo_item"] = self.tipo_item or "produto"
        data["controlar_estoque"] = self.controlar_estoque is not False

        if include_metrics:
            # Fonte única: usa a métrica de giro pré-anexada (_giro_metrica) pelo
            # endpoint, que vem do ledger real. Sem fallbacks inventados (o antigo
            # giro=1.5/15 dias mentia quando não havia venda).
            metrica = getattr(self, "_giro_metrica", None)
            vmd = float(metrica["vmd"]) if metrica else 0.0
            cobertura = metrica.get("cobertura_dias") if metrica else None
            classe = metrica["classe"] if metrica else "lento"
            data["vmd"] = vmd
            data["cobertura_dias"] = cobertura
            data["giro_classe"] = classe
            data["metricas_gestao"] = {
                "vmd": vmd,
                "giro_classe": classe,
                "dias_estoque": cobertura,
                "cobertura_estoque": (f"{round(cobertura)} dias" if cobertura is not None else "Sem vendas"),
                "frequencia_venda": (
                    "Alta" if classe == "rapido" else ("Média" if classe == "normal" else "Baixa")
                ),
            }
            data["estoque_status"] = self.estoque_status

        return data


class ProdutoLote(db.Model, MultiTenantMixin):
    __tablename__ = "produto_lotes"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id", ondelete="CASCADE"), nullable=False, index=True)
    fornecedor_id = db.Column(db.Integer, db.ForeignKey("fornecedores.id"), index=True)
    pedido_compra_id = db.Column(db.Integer, db.ForeignKey("pedidos_compra.id"), index=True)
    numero_lote = db.Column(db.String(50), nullable=False)
    quantidade = db.Column(db.Numeric(10, 3), nullable=False)
    quantidade_inicial = db.Column(db.Numeric(10, 3), nullable=False)
    data_fabricacao = db.Column(db.Date, nullable=True)
    data_validade = db.Column(db.Date, nullable=False)
    data_entrada = db.Column(db.Date, default=date.today, nullable=False)
    preco_custo_unitario = db.Column(db.Numeric(19, 4), nullable=False)
    preco_venda = db.Column(db.Numeric(19, 4), nullable=True)
    ativo = db.Column(db.Boolean, default=True)
    motivo_inativacao = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    produto = db.relationship("Produto", backref=db.backref("lotes", lazy=True, cascade="all, delete-orphan"))
    fornecedor = db.relationship("Fornecedor", backref=db.backref("lotes_fornecidos", lazy=True))
    pedido_compra = db.relationship("PedidoCompra", backref=db.backref("lotes_recebidos", lazy=True))
    __table_args__ = (db.Index("ix_lote_produto", "produto_id"), db.Index("ix_lote_validade", "data_validade"),
                      db.Index("ix_lote_entrada", "data_entrada"), db.UniqueConstraint("estabelecimento_id", "numero_lote", name="uq_lote_estab_numero"))

    @property
    def dias_para_vencer(self) -> int:
        return (self.data_validade - date.today()).days

    @property
    def esta_vencido(self) -> bool:
        return self.dias_para_vencer < 0

    def to_dict(self):
        return {"id": self.id, "numero_lote": self.numero_lote, "produto_id": self.produto_id,
                "quantidade": float(self.quantidade) if self.quantidade else 0.0,
                "data_validade": self.data_validade.isoformat() if self.data_validade else None,
                "dias_para_vencer": self.dias_para_vencer, "esta_vencido": self.esta_vencido, "ativo": self.ativo}

class CatalogoMestre(db.Model):
    """
    Catálogo GLOBAL de produtos com EAN real (não pertence a nenhum tenant).
    Alimentado diariamente pelo harvester da API Cosmos (24/dia).
    Serve de base para o cadastro rápido por EAN e importação em massa.
    """
    __tablename__ = "catalogo_mestre"
    id = db.Column(db.Integer, primary_key=True)
    ean = db.Column(db.String(14), nullable=False, unique=True, index=True)
    nome = db.Column(db.String(200))
    marca = db.Column(db.String(100))
    fabricante = db.Column(db.String(150))
    ncm = db.Column(db.String(8))
    categoria = db.Column(db.String(60))
    unidade = db.Column(db.String(20), default="UN")
    preco_referencia = db.Column(db.Numeric(19, 4))
    imagem_url = db.Column(db.String(500))
    fonte = db.Column(db.String(20), default="cosmos")
    # status: 'encontrado' (Cosmos retornou dados) | 'nao_encontrado' (404, não reconsultar)
    status = db.Column(db.String(20), default="encontrado", index=True)
    payload_json = db.Column(db.Text)
    consultado_em = db.Column(db.DateTime, default=utcnow)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    # Rastreabilidade mínima de quem descobriu o item (fonte="tenant"): sem FK rígida
    # pois o catálogo é global e não deve quebrar se o estabelecimento for removido.
    descoberto_por_estabelecimento_id = db.Column(db.Integer, nullable=True)
    descoberto_via = db.Column(db.String(20), nullable=True)  # 'modal' | 'xml'
    __table_args__ = (db.Index("ix_catalogo_status", "status"), db.Index("ix_catalogo_categoria", "categoria"))

    def to_dict(self):
        return {
            "id": self.id, "ean": self.ean, "nome": self.nome, "marca": self.marca,
            "fabricante": self.fabricante, "ncm": self.ncm, "categoria": self.categoria,
            "unidade": self.unidade,
            "preco_referencia": float(self.preco_referencia) if self.preco_referencia else None,
            "imagem_url": self.imagem_url, "fonte": self.fonte, "status": self.status,
            "consultado_em": self.consultado_em.isoformat() if self.consultado_em else None,
            "descoberto_por_estabelecimento_id": self.descoberto_por_estabelecimento_id,
            "descoberto_via": self.descoberto_via,
        }


class ViewRegistry(db.Model):
    """
    Registro GLOBAL do Motor de Renderização Contextual (nível Sistema da cascata
    Global → Tenant → Produto). Cada linha define UM campo ou UMA métrica e para
    quais segmentos ela vale. Seed automático a partir do catálogo em
    app/services/view_schema_service.py; o banco é a fonte de verdade em runtime.
    """
    __tablename__ = "view_registry"
    id = db.Column(db.Integer, primary_key=True)
    escopo = db.Column(db.String(10), nullable=False)          # 'campo' | 'metrica'
    chave = db.Column(db.String(50), nullable=False)
    definicao_json = db.Column(db.Text, nullable=False, default="{}")
    segmentos_json = db.Column(db.Text, nullable=False, default='["*"]')
    ordem = db.Column(db.Integer, default=0)
    ativo = db.Column(db.Boolean, default=True)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (db.UniqueConstraint("escopo", "chave", name="uq_view_registry_escopo_chave"),
                      db.Index("ix_view_registry_escopo", "escopo"))

    @property
    def definicao(self) -> Dict:
        try:
            return json.loads(self.definicao_json or "{}")
        except Exception:
            return {}

    @property
    def segmentos(self) -> List[str]:
        try:
            return json.loads(self.segmentos_json or '["*"]')
        except Exception:
            return ["*"]


# ------------------------------------------------------------------------------
# SFA (Sales Force Automation) e Distribuidora
# ------------------------------------------------------------------------------
class ProdutoFoco(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "produtos_foco"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    data_inicio = db.Column(db.Date, nullable=False)
    data_fim = db.Column(db.Date, nullable=False)
    meta_quantidade = db.Column(db.Integer, default=0)
    ativo = db.Column(db.Boolean, default=True)
    produto = db.relationship("Produto")

    def to_dict(self, depth=0):
        data = super().to_dict(depth=depth)
        data["produto_nome"] = self.produto.nome if self.produto else None
        return data

class MetaVendedor(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "metas_vendedor"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    vendedor_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False, index=True)
    mes = db.Column(db.Integer, nullable=False)
    ano = db.Column(db.Integer, nullable=False)
    meta_faturamento = db.Column(db.Numeric(19, 4), default=0)
    meta_positivacao = db.Column(db.Integer, default=0) # numero de clientes a atender
    vendedor = db.relationship("Funcionario")

    def to_dict(self, depth=0):
        data = super().to_dict(depth=depth)
        data["meta_faturamento"] = float(self.meta_faturamento or 0)
        data["vendedor_nome"] = self.vendedor.nome if self.vendedor else None
        return data

class TabelaPreco(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "tabelas_preco"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(100), nullable=False)
    ativa = db.Column(db.Boolean, default=True)
    
    itens = db.relationship("TabelaPrecoItem", backref="tabela", cascade="all, delete-orphan", lazy=True)
    clientes = db.relationship("Cliente", backref="tabela_preco", lazy=True)

class TabelaPrecoItem(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "tabela_preco_itens"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    tabela_id = db.Column(db.Integer, db.ForeignKey("tabelas_preco.id", ondelete="CASCADE"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id", ondelete="CASCADE"), nullable=False, index=True)
    preco_venda = db.Column(db.Numeric(19, 4), nullable=False)
    preco_minimo = db.Column(db.Numeric(19, 4), nullable=False) # Para range de negociação do vendedor
    
    __table_args__ = (
        db.UniqueConstraint("tabela_id", "produto_id", name="uq_tabela_produto"),
    )

class Rota(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "rotas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(100), nullable=False) # ex: Rota Segunda-feira
    vendedor_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True, index=True)
    dia_semana = db.Column(db.Integer, nullable=True) # 0=Segunda, 6=Domingo
    ativa = db.Column(db.Boolean, default=True)
    
    clientes = db.relationship("Cliente", backref="rota", lazy=True)

class PedidoVenda(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "pedidos_venda"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    cliente_id = db.Column(db.Integer, db.ForeignKey("clientes.id"), nullable=False, index=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False, index=True)
    
    codigo = db.Column(db.String(50), nullable=False)
    status = db.Column(db.String(20), default="pendente") # pendente, aprovado, faturado, cancelado
    subtotal = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    desconto = db.Column(db.Numeric(19, 4), default=0)
    total = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    
    condicao_pagamento = db.Column(db.String(50)) # ex: 30 dias, a vista
    observacoes = db.Column(db.Text)
    data_emissao = db.Column(db.DateTime, default=utcnow)
    data_entrega_prevista = db.Column(db.Date)
    
    offline_uuid = db.Column(db.String(36)) # idempotencia
    
    itens = db.relationship("PedidoVendaItem", backref="pedido", cascade="all, delete-orphan", lazy=True)

class PedidoVendaItem(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "pedido_venda_itens"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    pedido_id = db.Column(db.Integer, db.ForeignKey("pedidos_venda.id", ondelete="CASCADE"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    
    quantidade = db.Column(db.Numeric(10, 3), nullable=False)
    preco_unitario = db.Column(db.Numeric(19, 4), nullable=False)
    desconto = db.Column(db.Numeric(19, 4), default=0)
    total_item = db.Column(db.Numeric(19, 4), nullable=False)


# ------------------------------------------------------------------------------
# Venda e Pagamentos Flexíveis
# ------------------------------------------------------------------------------
class Venda(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "vendas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    cliente_id = db.Column(db.Integer, db.ForeignKey("clientes.id"), index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False, index=True)
    caixa_id = db.Column(db.Integer, db.ForeignKey("caixas.id"), nullable=True, index=True)
    codigo = db.Column(db.String(50), nullable=False)
    subtotal = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    desconto = db.Column(db.Numeric(19, 4), default=0)
    total = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    valor_recebido = db.Column(db.Numeric(19, 4), default=0)
    troco = db.Column(db.Numeric(19, 4), default=0)
    status = db.Column(db.String(20), default="finalizada")
    quantidade_itens = db.Column(db.Integer, default=0)
    observacoes = db.Column(db.Text)
    tipo_venda = db.Column(db.String(20), default="balcao")
    offline_uuid = db.Column(db.String(36))  # idempotência de venda offline (PDV móvel)
    data_venda = db.Column(db.DateTime, default=utcnow)
    data_cancelamento = db.Column(db.DateTime)
    motivo_cancelamento = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow)
    deleted_at = db.Column(db.DateTime, nullable=True)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("vendas", lazy=True))
    cliente = db.relationship("Cliente", backref=db.backref("vendas", lazy=True))
    funcionario = db.relationship("Funcionario", backref=db.backref("vendas", lazy=True))
    itens = db.relationship("VendaItem", back_populates="venda", lazy=True, cascade="all, delete-orphan")
    pagamentos = db.relationship("Pagamento", back_populates="venda", lazy=True, cascade="all, delete-orphan")
    __table_args__ = (db.Index("ix_venda_codigo", "codigo"), db.Index("ix_venda_data", "data_venda"),
                      db.Index("ix_venda_tipo", "tipo_venda"), db.UniqueConstraint("estabelecimento_id", "codigo", name="uq_venda_estab_codigo"),
                      db.UniqueConstraint("estabelecimento_id", "offline_uuid", name="uq_venda_estab_offline_uuid"))

    def atualizar_totais(self):
        self.subtotal = sum(item.total_item for item in self.itens) if self.itens else Decimal("0")
        self.total = self.subtotal - (self.desconto or Decimal("0"))
        self.valor_recebido = sum(p.valor for p in self.pagamentos if p.status == "aprovado") if self.pagamentos else Decimal("0")
        self.troco = max(Decimal("0"), self.valor_recebido - self.total)

    def to_dict(self, depth=0):
        data = super().to_dict(depth=depth)
        data["cliente_nome"] = self.cliente.nome if self.cliente else "NÃO INFORMADO"
        data["funcionario_nome"] = self.funcionario.nome if self.funcionario else "NÃO INFORMADO"
        data["itens"] = [item.to_dict() for item in self.itens] if self.itens else []
        data["pagamentos"] = [p.to_dict() for p in self.pagamentos] if self.pagamentos else []
        return data

class VendaItem(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "venda_itens"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id", ondelete="CASCADE"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    produto_nome = db.Column(db.String(100), nullable=False)
    produto_codigo = db.Column(db.String(50))
    produto_unidade = db.Column(db.String(20))
    quantidade = db.Column(db.Numeric(10, 3), nullable=False)
    preco_unitario = db.Column(db.Numeric(19, 4), nullable=False)
    desconto = db.Column(db.Numeric(19, 4), default=0)
    total_item = db.Column(db.Numeric(19, 4), nullable=False)
    custo_unitario = db.Column(db.Numeric(19, 4))
    margem_item = db.Column(db.Numeric(19, 4))
    margem_lucro_real = db.Column(db.Numeric(19, 4))
    venda = db.relationship("Venda", back_populates="itens")
    produto = db.relationship("Produto", backref=db.backref("itens_venda", lazy=True))
    __table_args__ = (db.Index("ix_venda_item_venda", "venda_id"), db.Index("ix_venda_item_produto", "produto_id"),
                      db.UniqueConstraint("sync_uuid", name="uq_venda_itens_sync_uuid"))

    def to_dict(self, depth=0):
        data = super().to_dict(depth=depth)
        data["produto_nome"] = self.produto_nome
        return data

class Pagamento(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "pagamentos"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id", ondelete="CASCADE"), nullable=False, index=True)
    forma_pagamento = db.Column(db.String(30), nullable=False)
    valor = db.Column(db.Numeric(19, 4), nullable=False)
    bandeira = db.Column(db.String(20))
    ultimos_digitos = db.Column(db.String(4))
    parcelas = db.Column(db.Integer, default=1)
    codigo_voucher = db.Column(db.String(50))
    saldo_restante_voucher = db.Column(db.Numeric(19, 4))
    prazo_dias = db.Column(db.Integer)
    status = db.Column(db.String(20), default="aprovado")
    data_pagamento = db.Column(db.DateTime, default=utcnow)
    observacoes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    venda = db.relationship("Venda", back_populates="pagamentos")
    __table_args__ = (db.Index("ix_pagamento_venda", "venda_id"), db.Index("ix_pagamento_data", "data_pagamento"),
                      db.Index("ix_pagamento_forma", "forma_pagamento"))

    def to_dict(self, depth=0):
        return super().to_dict(depth=depth)

class MovimentacaoEstoque(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "movimentacoes_estoque"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id"), index=True)
    pedido_compra_id = db.Column(db.Integer, db.ForeignKey("pedidos_compra.id"), index=True)
    lote_id = db.Column(db.Integer, db.ForeignKey("produto_lotes.id"), index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), index=True)
    tipo = db.Column(db.String(20), nullable=False)
    quantidade = db.Column(db.Numeric(10, 3), nullable=False)
    quantidade_anterior = db.Column(db.Numeric(10, 3), nullable=False)
    quantidade_atual = db.Column(db.Numeric(10, 3), nullable=False)
    custo_unitario = db.Column(db.Numeric(19, 4))
    valor_total = db.Column(db.Numeric(19, 4))
    motivo = db.Column(db.String(100), nullable=False)
    observacoes = db.Column(db.Text)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("movimentacoes_estoque", lazy=True))
    produto = db.relationship("Produto", backref=db.backref("movimentacoes", lazy=True))
    venda = db.relationship("Venda", backref=db.backref("movimentacoes_estoque_venda", lazy=True))
    funcionario = db.relationship("Funcionario", backref=db.backref("movimentacoes", lazy=True))
    lote = db.relationship("ProdutoLote", backref=db.backref("movimentacoes_lote", lazy=True))
    __table_args__ = (db.Index("ix_mov_estoque_produto", "produto_id"), db.Index("ix_mov_estoque_data", "created_at"))

class HistoricoPrecos(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "historico_precos"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id", ondelete="CASCADE"), nullable=False, index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False, index=True)
    preco_custo_anterior = db.Column(db.Numeric(19, 4), nullable=False)
    preco_venda_anterior = db.Column(db.Numeric(19, 4), nullable=False)
    margem_anterior = db.Column(db.Numeric(19, 4), nullable=False)
    preco_custo_novo = db.Column(db.Numeric(19, 4), nullable=False)
    preco_venda_novo = db.Column(db.Numeric(19, 4), nullable=False)
    margem_nova = db.Column(db.Numeric(19, 4), nullable=False)
    motivo = db.Column(db.String(100), nullable=False)
    observacoes = db.Column(db.Text)
    data_alteracao = db.Column(db.DateTime, default=utcnow, nullable=False)
    produto = db.relationship("Produto", backref=db.backref("historico_precos", lazy=True))
    funcionario = db.relationship("Funcionario", backref=db.backref("alteracoes_precos", lazy=True))
    __table_args__ = (db.Index("ix_historico_produto", "produto_id"), db.Index("ix_historico_data", "data_alteracao"))

class CondicaoPagamento(db.Model, MultiTenantMixin, SoftDeleteMixin, SerializableMixin, AuditMixin):
    __tablename__ = "condicoes_pagamento"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(100), nullable=False) # Ex: "Boleto 30 Dias"
    tipo = db.Column(db.String(50), nullable=False, default="prazo") # "a_vista", "prazo", "parcelado"
    dias_prazo = db.Column(db.Integer, default=0) # Tempo de prazo médio para calcular pontuação
    ativo = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    
    __table_args__ = (
        db.Index("ix_condicao_pag_nome", "nome"),
        db.UniqueConstraint("estabelecimento_id", "nome", name="uq_condicao_pag_estab_nome")
    )

class PedidoCompra(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "pedidos_compra"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    fornecedor_id = db.Column(db.Integer, db.ForeignKey("fornecedores.id"), nullable=False, index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False, index=True)
    numero_pedido = db.Column(db.String(50), nullable=False)
    data_pedido = db.Column(db.DateTime, default=utcnow, nullable=False)
    data_previsao_entrega = db.Column(db.Date)
    horario_entrega = db.Column(db.String(30))  # janela de entrega, ex.: "08:00 - 12:00"
    data_recebimento = db.Column(db.Date)
    status = db.Column(db.String(20), default="pendente")
    subtotal = db.Column(db.Numeric(19, 4), default=0)
    desconto = db.Column(db.Numeric(19, 4), default=0)
    frete = db.Column(db.Numeric(19, 4), default=0)
    total = db.Column(db.Numeric(19, 4), default=0)
    condicao_pagamento = db.Column(db.String(50))
    numero_nota_fiscal = db.Column(db.String(50))
    serie_nota_fiscal = db.Column(db.String(10))
    observacoes = db.Column(db.Text)
    fornecedor = db.relationship("Fornecedor", backref=db.backref("pedidos_compra", lazy="dynamic"))
    funcionario = db.relationship("Funcionario", backref=db.backref("pedidos_compra", lazy=True))
    itens = db.relationship("PedidoCompraItem", back_populates="pedido", lazy=True, cascade="all, delete-orphan")
    __table_args__ = (db.Index("ix_pedido_numero", "numero_pedido"), db.UniqueConstraint("estabelecimento_id", "numero_pedido", name="uq_pedido_estab_numero"))

    def to_dict(self, include_relationships: bool = False, depth: int = 0) -> Dict:
        data = super().to_dict(include_relationships=include_relationships, depth=depth)
        # Pedido de compra usa "data do dia" na UI. Serializar só YYYY-MM-DD
        # evita deslocamento de fuso no navegador.
        if self.data_pedido:
            data["data_pedido"] = self.data_pedido.date().isoformat()
        return data

class PedidoCompraItem(db.Model, MultiTenantMixin, SerializableMixin):
    __tablename__ = "pedido_compra_itens"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    pedido_id = db.Column(db.Integer, db.ForeignKey("pedidos_compra.id", ondelete="CASCADE"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    produto_nome = db.Column(db.String(100), nullable=False)
    produto_unidade = db.Column(db.String(20), default="UN")
    quantidade_solicitada = db.Column(db.Numeric(10, 3), nullable=False)
    quantidade_recebida = db.Column(db.Numeric(10, 3), default=0)
    quantidade_avariada = db.Column(db.Numeric(10, 3), default=0)
    quantidade_faltante = db.Column(db.Numeric(10, 3), default=0)
    quantidade_bonificada = db.Column(db.Numeric(10, 3), default=0)
    preco_unitario = db.Column(db.Numeric(19, 4), nullable=False)
    desconto_percentual = db.Column(db.Numeric(5, 2), default=0)
    total_item = db.Column(db.Numeric(19, 4), nullable=False)
    status = db.Column(db.String(20), default="pendente")
    pedido = db.relationship("PedidoCompra", back_populates="itens")
    produto = db.relationship("Produto", backref=db.backref("itens_compra", lazy=True))
    __table_args__ = (db.Index("ix_pedido_item_pedido", "pedido_id"),)

class ContaPagar(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "contas_pagar"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    fornecedor_id = db.Column(db.Integer, db.ForeignKey("fornecedores.id"), nullable=False, index=True)
    pedido_compra_id = db.Column(db.Integer, db.ForeignKey("pedidos_compra.id"), index=True)
    numero_documento = db.Column(db.String(50), nullable=False)
    tipo_documento = db.Column(db.String(30), default="duplicata")
    valor_original = db.Column(db.Numeric(19, 4), nullable=False)
    valor_pago = db.Column(db.Numeric(19, 4), default=0)
    valor_atual = db.Column(db.Numeric(19, 4), nullable=False)
    data_emissao = db.Column(db.Date, nullable=False)
    data_vencimento = db.Column(db.Date, nullable=False)
    data_pagamento = db.Column(db.Date)
    status = db.Column(db.String(20), default="aberto")
    forma_pagamento = db.Column(db.String(30))
    observacoes = db.Column(db.Text)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("contas_pagar", lazy=True))
    fornecedor = db.relationship("Fornecedor", backref=db.backref("contas_pagar", lazy=True))
    pedido_compra = db.relationship("PedidoCompra", backref=db.backref("conta_pagar", uselist=False))
    __table_args__ = (db.Index("ix_conta_pagar_vencimento", "data_vencimento"), db.Index("ix_conta_pagar_status", "status"))

class ContaReceber(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "contas_receber"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    cliente_id = db.Column(db.Integer, db.ForeignKey("clientes.id"), index=True)
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id"), index=True)
    numero_documento = db.Column(db.String(50), nullable=False)
    tipo_documento = db.Column(db.String(30), default="duplicata")
    valor_original = db.Column(db.Numeric(19, 4), nullable=False)
    valor_recebido = db.Column(db.Numeric(19, 4), default=0)
    valor_atual = db.Column(db.Numeric(19, 4), nullable=False)
    data_emissao = db.Column(db.Date, nullable=False)
    data_vencimento = db.Column(db.Date, nullable=False)
    data_recebimento = db.Column(db.Date)
    status = db.Column(db.String(20), default="aberto")
    forma_recebimento = db.Column(db.String(30))
    observacoes = db.Column(db.Text)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("contas_receber", lazy=True))
    cliente = db.relationship("Cliente", backref=db.backref("contas_receber", lazy=True))
    venda = db.relationship("Venda", backref=db.backref("contas_receber", lazy=True))
    __table_args__ = (db.Index("ix_conta_receber_vencimento", "data_vencimento"), db.Index("ix_conta_receber_cliente", "cliente_id"))

class Despesa(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "despesas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    fornecedor_id = db.Column(db.Integer, db.ForeignKey("fornecedores.id"), index=True)
    descricao = db.Column(db.String(255), nullable=False)
    categoria = db.Column(db.String(50), default="geral")
    tipo = db.Column(db.String(20), default="variavel")
    valor = db.Column(db.Numeric(19, 4), nullable=False)
    data_despesa = db.Column(db.Date, nullable=False, default=date.today)
    data_emissao = db.Column(db.Date, nullable=True)
    data_vencimento = db.Column(db.Date, nullable=True)
    forma_pagamento = db.Column(db.String(50))
    recorrente = db.Column(db.Boolean, default=False)
    observacoes = db.Column(db.Text)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("despesas", lazy=True))
    fornecedor = db.relationship("Fornecedor", backref=db.backref("despesas", lazy=True))
    __table_args__ = (db.Index("ix_despesa_data", "data_despesa"), db.Index("ix_despesa_categoria", "categoria"))

class NotaFiscalEntrada(db.Model, MultiTenantMixin, SerializableMixin):
    """NF-e de compra (entrada) importada via XML do fornecedor.

    Guarda o XML original (obrigação legal de 5 anos) e garante idempotência
    pela chave de acesso (não importa a mesma nota duas vezes).
    """
    __tablename__ = "notas_fiscais_entrada"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    fornecedor_id = db.Column(db.Integer, db.ForeignKey("fornecedores.id"), index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), index=True)
    chave_acesso = db.Column(db.String(44), nullable=False)
    modelo = db.Column(db.String(2), default="55")
    numero = db.Column(db.String(15))
    serie = db.Column(db.String(5))
    natureza_operacao = db.Column(db.String(120))
    emitente_cnpj = db.Column(db.String(14))
    emitente_nome = db.Column(db.String(150))
    data_emissao = db.Column(db.DateTime)
    valor_total = db.Column(db.Numeric(19, 4), default=0)
    qtd_itens = db.Column(db.Integer, default=0)
    status = db.Column(db.String(20), default="importada")  # importada | cancelada
    xml_content = db.Column(db.Text)
    itens_json = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)
    fornecedor = db.relationship("Fornecedor", backref=db.backref("notas_entrada", lazy=True))
    __table_args__ = (
        db.Index("ix_nfe_entrada_chave", "chave_acesso"),
        db.Index("ix_nfe_entrada_data", "data_emissao"),
        db.UniqueConstraint("estabelecimento_id", "chave_acesso", name="uq_nfe_entrada_estab_chave"),
    )

    def to_dict(self, depth=0):
        return {
            "id": self.id, "chave_acesso": self.chave_acesso, "numero": self.numero, "serie": self.serie,
            "modelo": self.modelo, "natureza_operacao": self.natureza_operacao,
            "emitente_cnpj": self.emitente_cnpj, "emitente_nome": self.emitente_nome,
            "fornecedor_id": self.fornecedor_id,
            "fornecedor_nome": self.fornecedor.nome_fantasia if self.fornecedor else self.emitente_nome,
            "data_emissao": self.data_emissao.isoformat() if self.data_emissao else None,
            "valor_total": float(self.valor_total or 0), "qtd_itens": self.qtd_itens,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class DocumentoFiscal(db.Model, MultiTenantMixin, SerializableMixin):
    """Documento fiscal de SAÍDA emitido (NFC-e mod 65 / NF-e mod 55).

    Registra o ciclo de vida: processando → autorizado/rejeitado → cancelado.
    Guarda chave de acesso, protocolo, XML e URLs de DANFE para auditoria.
    """
    __tablename__ = "documentos_fiscais"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id"), index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), index=True)
    tipo = db.Column(db.String(10), default="nfce")        # nfce | nfe
    modelo = db.Column(db.String(2), default="65")          # 65 | 55
    ambiente = db.Column(db.String(15), default="homologacao")
    gateway = db.Column(db.String(30), default="simulado")
    referencia = db.Column(db.String(60), nullable=False)   # ref idempotente enviada ao gateway
    numero = db.Column(db.String(15))
    serie = db.Column(db.String(5))
    chave_acesso = db.Column(db.String(44))
    protocolo = db.Column(db.String(30))
    status = db.Column(db.String(20), default="processando")  # processando|autorizado|rejeitado|cancelado|erro|contingencia
    motivo_rejeicao = db.Column(db.Text)
    valor_total = db.Column(db.Numeric(19, 4), default=0)
    danfe_url = db.Column(db.String(500))
    xml_url = db.Column(db.String(500))
    xml_content = db.Column(db.Text)
    qr_code = db.Column(db.Text)
    justificativa_cancelamento = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow)
    autorizado_em = db.Column(db.DateTime)
    cancelado_em = db.Column(db.DateTime)
    venda = db.relationship("Venda", backref=db.backref("documentos_fiscais", lazy=True))
    __table_args__ = (
        db.Index("ix_docfiscal_venda", "venda_id"),
        db.Index("ix_docfiscal_status", "status"),
        db.Index("ix_docfiscal_chave", "chave_acesso"),
        db.UniqueConstraint("estabelecimento_id", "referencia", name="uq_docfiscal_estab_ref"),
    )

    def to_dict(self, depth=0):
        return {
            "id": self.id, "venda_id": self.venda_id, "tipo": self.tipo, "modelo": self.modelo,
            "ambiente": self.ambiente, "gateway": self.gateway, "referencia": self.referencia,
            "numero": self.numero, "serie": self.serie, "chave_acesso": self.chave_acesso,
            "protocolo": self.protocolo, "status": self.status, "motivo_rejeicao": self.motivo_rejeicao,
            "valor_total": float(self.valor_total or 0), "danfe_url": self.danfe_url,
            "xml_url": self.xml_url, "qr_code": self.qr_code,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "autorizado_em": self.autorizado_em.isoformat() if self.autorizado_em else None,
        }

class SyncHeartbeat(db.Model):
    """Batimento do sync local→Aiven (linha única id=1). Permite detectar sync parado."""
    __tablename__ = "sync_heartbeat"
    id = db.Column(db.Integer, primary_key=True)  # sempre 1
    last_run_at = db.Column(db.DateTime)
    status = db.Column(db.String(20))  # ok | erro
    total_registros = db.Column(db.Integer, default=0)
    duracao_segundos = db.Column(db.Numeric(10, 2))
    erro = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    def to_dict(self):
        return {
            "last_run_at": self.last_run_at.replace(tzinfo=timezone.utc).isoformat() if self.last_run_at else None,
            "status": self.status, "total_registros": self.total_registros,
            "duracao_segundos": float(self.duracao_segundos) if self.duracao_segundos is not None else None,
            "erro": self.erro,
        }

class LoginHistory(db.Model):
    __tablename__ = "login_history"
    id = db.Column(db.Integer, primary_key=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), index=True)
    username = db.Column(db.String(100), nullable=False)
    estabelecimento_id = db.Column(db.Integer, nullable=True)
    ip_address = db.Column(db.String(45), nullable=False)
    dispositivo = db.Column(db.String(200))
    user_agent = db.Column(db.Text)
    success = db.Column(db.Boolean, default=False)
    observacoes = db.Column(db.Text)
    token_hash = db.Column(db.Integer)
    data_cadastro = db.Column(db.DateTime, default=utcnow)
    funcionario = db.relationship("Funcionario", backref=db.backref("logins", lazy=True))
    __table_args__ = (db.Index("ix_login_history_user", "username"), db.Index("ix_login_history_data", "data_cadastro"))

    def to_dict(self):
        return {"id": self.id, "funcionario_id": self.funcionario_id, "username": self.username,
                "ip_address": self.ip_address, "dispositivo": self.dispositivo, "success": self.success,
                "created_at": self.data_cadastro.isoformat() if self.data_cadastro else None}

class Caixa(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "caixas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False, index=True)
    numero_caixa = db.Column(db.String(20), nullable=False)
    saldo_inicial = db.Column(db.Numeric(19, 4), nullable=False)
    saldo_final = db.Column(db.Numeric(19, 4))
    saldo_atual = db.Column(db.Numeric(19, 4))
    data_abertura = db.Column(db.DateTime, default=utcnow, nullable=False)
    data_fechamento = db.Column(db.DateTime)
    status = db.Column(db.String(20), default="aberto")
    observacoes = db.Column(db.Text)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("caixas", lazy=True))
    funcionario = db.relationship("Funcionario", backref=db.backref("caixas", lazy=True))
    __table_args__ = (db.Index("ix_caixa_status", "status"), db.Index("ix_caixa_data", "data_abertura"))

class MovimentacaoCaixa(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "movimentacoes_caixa"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    caixa_id = db.Column(db.Integer, db.ForeignKey("caixas.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo = db.Column(db.String(20), nullable=False)
    valor = db.Column(db.Numeric(19, 4), nullable=False)
    forma_pagamento = db.Column(db.String(50))
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id"), index=True)
    descricao = db.Column(db.String(255), nullable=False)
    observacoes = db.Column(db.Text)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("movimentacoes_caixa", lazy=True))
    caixa = db.relationship("Caixa", backref=db.backref("movimentacoes", lazy=True, cascade="all, delete-orphan"))
    venda = db.relationship("Venda", backref=db.backref("movimentacoes_caixa", lazy=True))
    __table_args__ = (db.Index("ix_mov_caixa_caixa", "caixa_id"), db.Index("ix_mov_caixa_tipo", "tipo"))


class DashboardMetrica(db.Model, MultiTenantMixin):
    __tablename__ = "dashboard_metricas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    data_referencia = db.Column(db.Date, nullable=False)
    total_vendas_dia = db.Column(db.Numeric(19, 4), default=0)
    quantidade_vendas_dia = db.Column(db.Integer, default=0)
    ticket_medio_dia = db.Column(db.Numeric(19, 4), default=0)
    clientes_atendidos_dia = db.Column(db.Integer, default=0)
    total_vendas_mes = db.Column(db.Numeric(19, 4), default=0)
    total_despesas_mes = db.Column(db.Numeric(19, 4), default=0)
    lucro_bruto_mes = db.Column(db.Numeric(19, 4), default=0)
    crescimento_vs_ontem = db.Column(db.Numeric(5, 2), default=0)
    crescimento_mensal = db.Column(db.Numeric(5, 2), default=0)
    tendencia_vendas = db.Column(db.String(20))
    top_produtos_json = db.Column(db.JSON)
    produtos_abc_json = db.Column(db.JSON)
    segmentacao_clientes_json = db.Column(db.JSON)
    top_clientes_json = db.Column(db.JSON)
    alertas_json = db.Column(db.JSON)
    insights_json = db.Column(db.JSON)
    data_calculo = db.Column(db.DateTime, default=utcnow)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("metricas", lazy=True))
    __table_args__ = (db.Index("ix_metrica_data", "data_referencia"),)

    def to_dict(self):
        return {"id": self.id, "estabelecimento_id": self.estabelecimento_id,
                "data_referencia": self.data_referencia.isoformat() if self.data_referencia else None,
                "total_vendas_dia": float(self.total_vendas_dia) if self.total_vendas_dia else 0.0,
                "quantidade_vendas_dia": self.quantidade_vendas_dia,
                "ticket_medio_dia": float(self.ticket_medio_dia) if self.ticket_medio_dia else 0.0,
                "total_vendas_mes": float(self.total_vendas_mes) if self.total_vendas_mes else 0.0,
                "lucro_bruto_mes": float(self.lucro_bruto_mes) if self.lucro_bruto_mes else 0.0,
                "crescimento_vs_ontem": float(self.crescimento_vs_ontem) if self.crescimento_vs_ontem else 0.0,
                "data_calculo": self.data_calculo.isoformat() if self.data_calculo else None}

class RelatorioAgendado(db.Model, MultiTenantMixin):
    __tablename__ = "relatorios_agendados"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(100), nullable=False)
    tipo = db.Column(db.String(50), nullable=False)
    formato = db.Column(db.String(10), nullable=False)
    frequencia = db.Column(db.String(20), nullable=False)
    horario_envio = db.Column(db.Time, nullable=False)
    destinatarios_email_json = db.Column(db.Text, default="[]")
    enviar_para_proprietario = db.Column(db.Boolean, default=True)
    parametros_json = db.Column(db.Text, default="{}")
    ativo = db.Column(db.Boolean, default=True)
    ultima_execucao = db.Column(db.DateTime)
    proxima_execucao = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("relatorios", lazy=True))

    @property
    def destinatarios_email(self):
        try: return json.loads(self.destinatarios_email_json)
        except: return []
    @destinatarios_email.setter
    def destinatarios_email(self, value):
        self.destinatarios_email_json = json.dumps(value)
    @property
    def parametros(self):
        try: return json.loads(self.parametros_json)
        except: return {}
    @parametros.setter
    def parametros(self, value):
        self.parametros_json = json.dumps(value)

    def to_dict(self):
        return {"id": self.id, "nome": self.nome, "tipo": self.tipo, "formato": self.formato,
                "frequencia": self.frequencia, "horario_envio": self.horario_envio.strftime("%H:%M") if self.horario_envio else None,
                "ativo": self.ativo, "ultima_execucao": self.ultima_execucao.isoformat() if self.ultima_execucao else None,
                "proxima_execucao": self.proxima_execucao.isoformat() if self.proxima_execucao else None}

class RegistroPonto(db.Model, MultiTenantMixin):
    __tablename__ = "registros_ponto"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id", ondelete="CASCADE"), nullable=False, index=True)
    data = db.Column(db.Date, nullable=False, default=date.today)
    hora = db.Column(db.Time, nullable=False)
    tipo_registro = db.Column(db.String(20), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    localizacao_endereco = db.Column(db.String(500))
    foto_url = db.Column(db.String(500))
    dispositivo = db.Column(db.String(200))
    ip_address = db.Column(db.String(50))
    observacao = db.Column(db.Text)
    status = db.Column(db.String(20), default='normal')
    minutos_atraso = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    funcionario = db.relationship("Funcionario", backref=db.backref("registros_ponto", lazy=True, cascade="all, delete-orphan"))
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("registros_ponto", lazy=True))
    __table_args__ = (db.Index("ix_ponto_funcionario_data", "funcionario_id", "data"),
                      db.Index("ix_ponto_estabelecimento", "estabelecimento_id"), db.Index("ix_ponto_data", "data"))

    def to_dict(self):
        return {'id': self.id, 'funcionario_id': self.funcionario_id,
                'funcionario_nome': self.funcionario.nome if self.funcionario else 'Desconhecido',
                'estabelecimento_id': self.estabelecimento_id,
                'data': self.data.isoformat() if self.data else None,
                'hora': self.hora.strftime('%H:%M:%S') if self.hora else None,
                'tipo': self.tipo_registro, 'tipo_registro': self.tipo_registro,
                'latitude': self.latitude, 'longitude': self.longitude,
                'localizacao_endereco': self.localizacao_endereco, 'foto_url': self.foto_url,
                'dispositivo': self.dispositivo, 'ip_address': self.ip_address,
                'observacao': self.observacao, 'status': self.status,
                'minutos_atraso': self.minutos_atraso, 'created_at': self.created_at.isoformat() if self.created_at else None}

class ConfiguracaoHorario(db.Model, MultiTenantMixin):
    __tablename__ = "configuracoes_horario"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    hora_entrada = db.Column(db.Time, nullable=False, default=time(8, 0))
    hora_saida_almoco = db.Column(db.Time, nullable=False, default=time(12, 0))
    hora_retorno_almoco = db.Column(db.Time, nullable=False, default=time(13, 0))
    hora_saida = db.Column(db.Time, nullable=False, default=time(18, 0))
    tolerancia_entrada = db.Column(db.Integer, default=10)
    tolerancia_saida_almoco = db.Column(db.Integer, default=5)
    tolerancia_retorno_almoco = db.Column(db.Integer, default=10)
    tolerancia_saida = db.Column(db.Integer, default=5)
    # Jornada normal diária (CLT: 8h/dia, 44h/semana). Horas trabalhadas ALÉM
    # deste limite viram hora extra — não apenas "saiu depois do horário
    # configurado", que subestima a extra quando a jornada configurada já
    # excede o limite legal (ex.: 07:30–19:00 com 1h de almoço = 10h30).
    jornada_diaria_minutos = db.Column(db.Integer, default=480)
    exigir_foto = db.Column(db.Boolean, default=True)
    exigir_localizacao = db.Column(db.Boolean, default=True)
    raio_permitido_metros = db.Column(db.Integer, default=100)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("configuracao_horario", uselist=False, cascade="all, delete-orphan"))
    __table_args__ = (db.UniqueConstraint("estabelecimento_id", name="uq_config_horario_estab"),)

    def to_dict(self):
        return {'id': self.id, 'estabelecimento_id': self.estabelecimento_id,
                'hora_entrada': self.hora_entrada.strftime('%H:%M') if self.hora_entrada else None,
                'hora_saida_almoco': self.hora_saida_almoco.strftime('%H:%M') if self.hora_saida_almoco else None,
                'hora_retorno_almoco': self.hora_retorno_almoco.strftime('%H:%M') if self.hora_retorno_almoco else None,
                'hora_saida': self.hora_saida.strftime('%H:%M') if self.hora_saida else None,
                'tolerancia_entrada': self.tolerancia_entrada, 'tolerancia_saida_almoco': self.tolerancia_saida_almoco,
                'tolerancia_retorno_almoco': self.tolerancia_retorno_almoco, 'tolerancia_saida': self.tolerancia_saida,
                'exigir_foto': self.exigir_foto, 'exigir_localizacao': self.exigir_localizacao,
                'raio_permitido_metros': self.raio_permitido_metros,
                'jornada_diaria_minutos': self.jornada_diaria_minutos or 480,
                'jornada_diaria_horas': round((self.jornada_diaria_minutos or 480) / 60, 2)}

class Auditoria(db.Model, MultiTenantMixin):
    __tablename__ = "auditoria"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    usuario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=True, index=True)
    tipo_evento = db.Column(db.String(50), nullable=False)
    descricao = db.Column(db.String(500), nullable=False)
    valor = db.Column(db.Numeric(19, 4), nullable=True)
    detalhes_json = db.Column(db.JSON, nullable=True)
    data_evento = db.Column(db.DateTime, default=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("auditoria", lazy=True, cascade="all, delete-orphan"))
    usuario = db.relationship("Funcionario", backref=db.backref("atividades", lazy=True))

    def to_dict(self):
        return {"id": self.id, "estabelecimento_id": self.estabelecimento_id,
                "estabelecimento_nome": self.estabelecimento.nome_fantasia if self.estabelecimento else "N/A",
                "usuario_id": self.usuario_id, "usuario_nome": self.usuario.nome if self.usuario else "Sistema",
                "tipo_evento": self.tipo_evento, "descricao": self.descricao,
                "valor": float(self.valor) if self.valor else 0.0, "data_evento": self.data_evento.isoformat(),
                "detalhes": self.detalhes_json if self.detalhes_json else {}}

    @classmethod
    def registrar_direto(cls, connection, estabelecimento_id, tipo_evento, descricao, usuario_id=None, valor=None, detalhes=None):
        import json
        from datetime import datetime
        try:
            connection.execute(
                cls.__table__.insert().values(
                    estabelecimento_id=estabelecimento_id,
                    tipo_evento=tipo_evento,
                    descricao=descricao,
                    usuario_id=usuario_id,
                    valor=valor,
                    detalhes_json=detalhes, # SQLAlchemy Core handles dict to JSON
                    data_evento=datetime.now()
                )
            )
        except Exception as e:
            pass

    @classmethod
    def registrar(cls, estabelecimento_id, tipo_evento, descricao, usuario_id=None, valor=None, detalhes=None):
        if not estabelecimento_id:
            if current_app: current_app.logger.warning(f"Auditoria rejeitada: estabelecimento_id nulo para evento {tipo_evento}")
            return False
        try:
            novo = cls(estabelecimento_id=estabelecimento_id, tipo_evento=tipo_evento, descricao=descricao,
                       usuario_id=usuario_id, valor=valor, detalhes_json=detalhes)
            db.session.add(novo)
            return True
        except Exception as e:
            if current_app: current_app.logger.error(f"Erro ao registrar auditoria: {str(e)}")
            return False

# ------------------------------------------------------------------------------
# Módulo de Entregas
# ------------------------------------------------------------------------------
class Motorista(db.Model, MultiTenantMixin):
    __tablename__ = "motoristas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(150), nullable=False)
    cpf = db.Column(db.String(14), nullable=False)
    rg = db.Column(db.String(20))
    cnh = db.Column(db.String(20), nullable=False)
    categoria_cnh = db.Column(db.String(2))
    validade_cnh = db.Column(db.Date)
    telefone = db.Column(db.String(30), nullable=False)
    celular = db.Column(db.String(30), nullable=False)
    email = db.Column(db.String(100))
    foto_url = db.Column(db.String(500))
    cnh_documento_url = db.Column(db.String(500))  # upload da CNH digitalizada
    tipo_vinculo = db.Column(db.String(20), default="terceirizado")
    percentual_comissao = db.Column(db.Numeric(5, 2), default=10.00)
    salario_fixo = db.Column(db.Numeric(10, 2), default=0)
    ativo = db.Column(db.Boolean, default=True)
    disponivel = db.Column(db.Boolean, default=True)
    total_entregas = db.Column(db.Integer, default=0)
    avaliacao_media = db.Column(db.Numeric(3, 2), default=0)
    data_cadastro = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("motoristas", lazy=True, cascade="all, delete-orphan"))
    __table_args__ = (db.Index("ix_motorista_cpf", "cpf"), db.Index("ix_motorista_disponivel", "disponivel"),
                      db.UniqueConstraint("estabelecimento_id", "cpf", name="uq_motorista_estab_cpf"))

    def to_dict(self):
        hoje = date.today()
        dias_cnh = (self.validade_cnh - hoje).days if self.validade_cnh else None
        return {"id": self.id, "nome": self.nome, "cpf": self.cpf, "rg": self.rg,
                "cnh": self.cnh, "categoria_cnh": self.categoria_cnh,
                "validade_cnh": self.validade_cnh.isoformat() if self.validade_cnh else None,
                "cnh_documento_url": self.cnh_documento_url,
                "cnh_dias_para_vencer": dias_cnh,
                "cnh_vencida": dias_cnh is not None and dias_cnh < 0,
                "telefone": self.telefone, "celular": self.celular, "email": self.email, "tipo_vinculo": self.tipo_vinculo,
                "percentual_comissao": float(self.percentual_comissao) if self.percentual_comissao else 0.0,
                "ativo": self.ativo, "disponivel": self.disponivel, "total_entregas": self.total_entregas,
                "avaliacao_media": float(self.avaliacao_media) if self.avaliacao_media else 0.0}

class Veiculo(db.Model, MultiTenantMixin):
    __tablename__ = "veiculos"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    motorista_id = db.Column(db.Integer, db.ForeignKey("motoristas.id"), index=True)
    placa = db.Column(db.String(8), nullable=False)
    renavam = db.Column(db.String(20))
    tipo = db.Column(db.String(30), nullable=False)
    marca = db.Column(db.String(50))
    modelo = db.Column(db.String(50))
    ano = db.Column(db.Integer)
    cor = db.Column(db.String(20))
    capacidade_kg = db.Column(db.Numeric(10, 2), default=0)
    capacidade_m3 = db.Column(db.Numeric(10, 3), default=0)
    proprietario = db.Column(db.String(20), default="motorista")
    valor_aluguel = db.Column(db.Numeric(10, 2), default=0)
    km_atual = db.Column(db.Numeric(10, 2), default=0)
    data_ultima_manutencao = db.Column(db.Date)
    data_proxima_manutencao = db.Column(db.Date)
    data_vencimento_licenciamento = db.Column(db.Date)
    data_vencimento_seguro = db.Column(db.Date)
    crlv_documento_url = db.Column(db.String(500))  # upload do CRLV (licenciamento) digitalizado
    consumo_medio = db.Column(db.Numeric(10, 2), default=15.0)
    ativo = db.Column(db.Boolean, default=True)
    disponivel = db.Column(db.Boolean, default=True)
    total_entregas = db.Column(db.Integer, default=0)
    data_cadastro = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("veiculos", lazy=True, cascade="all, delete-orphan"))
    motorista = db.relationship("Motorista", backref=db.backref("veiculos", lazy=True))
    __table_args__ = (db.Index("ix_veiculo_placa", "placa"), db.Index("ix_veiculo_tipo", "tipo"),
                      db.UniqueConstraint("estabelecimento_id", "placa", name="uq_veiculo_estab_placa"))

    def to_dict(self):
        hoje = date.today()
        dias_licenc = (self.data_vencimento_licenciamento - hoje).days if self.data_vencimento_licenciamento else None
        dias_seguro = (self.data_vencimento_seguro - hoje).days if self.data_vencimento_seguro else None
        return {"id": self.id, "placa": self.placa, "renavam": self.renavam, "tipo": self.tipo,
                "marca": self.marca, "modelo": self.modelo,
                "ano": self.ano, "cor": self.cor, "proprietario": self.proprietario,
                "motorista_id": self.motorista_id, "motorista_nome": self.motorista.nome if self.motorista else None,
                "km_atual": float(self.km_atual) if self.km_atual else 0.0,
                "consumo_medio": float(self.consumo_medio) if self.consumo_medio else 15.0,
                "data_vencimento_licenciamento": self.data_vencimento_licenciamento.isoformat() if self.data_vencimento_licenciamento else None,
                "data_vencimento_seguro": self.data_vencimento_seguro.isoformat() if self.data_vencimento_seguro else None,
                "data_ultima_manutencao": self.data_ultima_manutencao.isoformat() if self.data_ultima_manutencao else None,
                "data_proxima_manutencao": self.data_proxima_manutencao.isoformat() if self.data_proxima_manutencao else None,
                "crlv_documento_url": self.crlv_documento_url,
                "licenciamento_dias_para_vencer": dias_licenc,
                "licenciamento_vencido": dias_licenc is not None and dias_licenc < 0,
                "seguro_dias_para_vencer": dias_seguro,
                "seguro_vencido": dias_seguro is not None and dias_seguro < 0,
                "ativo": self.ativo, "disponivel": self.disponivel, "total_entregas": self.total_entregas if hasattr(self, 'total_entregas') else 0}

class AbastecimentoVeiculo(db.Model, MultiTenantMixin):
    __tablename__ = "abastecimentos_veiculos"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    veiculo_id = db.Column(db.Integer, db.ForeignKey("veiculos.id"), index=True, nullable=False)
    motorista_id = db.Column(db.Integer, db.ForeignKey("motoristas.id"), index=True, nullable=False)
    
    data_abastecimento = db.Column(db.DateTime, default=utcnow)
    km_atual = db.Column(db.Numeric(10, 2), nullable=False) # KM at the time of refuel
    litros = db.Column(db.Numeric(10, 2), nullable=False)
    valor_total = db.Column(db.Numeric(10, 2), nullable=False)
    preco_litro = db.Column(db.Numeric(10, 3), nullable=False)
    tipo_combustivel = db.Column(db.String(20), default="gasolina")
    
    # Inteligência de consumo
    km_rodados_desde_ultimo = db.Column(db.Numeric(10, 2), nullable=True) # Diferença do KM atual para o último
    consumo_real_kml = db.Column(db.Numeric(10, 2), nullable=True) # km_rodados_desde_ultimo / litros
    
    veiculo = db.relationship("Veiculo", backref=db.backref("abastecimentos", lazy=True, order_by="desc(AbastecimentoVeiculo.data_abastecimento)"))
    motorista = db.relationship("Motorista", backref=db.backref("abastecimentos", lazy=True))

    __table_args__ = (
        db.Index("ix_abast_veic_estab", "estabelecimento_id", "veiculo_id"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "veiculo_id": self.veiculo_id,
            "motorista_id": self.motorista_id,
            "data_abastecimento": self.data_abastecimento.isoformat() if self.data_abastecimento else None,
            "km_atual": float(self.km_atual) if self.km_atual else 0.0,
            "litros": float(self.litros) if self.litros else 0.0,
            "valor_total": float(self.valor_total) if self.valor_total else 0.0,
            "preco_litro": float(self.preco_litro) if self.preco_litro else 0.0,
            "tipo_combustivel": self.tipo_combustivel,
            "km_rodados_desde_ultimo": float(self.km_rodados_desde_ultimo) if self.km_rodados_desde_ultimo else None,
            "consumo_real_kml": float(self.consumo_real_kml) if self.consumo_real_kml else None,
        }


# Itens padrão do checklist de saída (o front pode enviar um subconjunto/extra,
# mas estes são sugeridos na UI — pneus, freios, seta, farol etc.)
ITENS_CHECKLIST_PADRAO = [
    "pneus", "freios", "setas", "farol", "lanterna_traseira", "buzina",
    "espelhos_retrovisores", "oleo_motor", "agua_radiador", "extintor",
]


class ChecklistVeiculo(db.Model, MultiTenantMixin, AuditMixin, SerializableMixin):
    """Checklist de saída do veículo (pneu, freios, seta, farol etc.) — o
    entregador confere antes de sair e o sistema registra aprovado/reprovado
    item a item, com a memória para auditoria de segurança da frota."""
    __tablename__ = "checklists_veiculo"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    veiculo_id = db.Column(db.Integer, db.ForeignKey("veiculos.id", ondelete="CASCADE"), nullable=False, index=True)
    motorista_id = db.Column(db.Integer, db.ForeignKey("motoristas.id"), index=True)
    km_atual = db.Column(db.Numeric(10, 2))
    itens_json = db.Column(db.JSON, default=list)  # [{"item": "pneus", "ok": true, "observacao": ""}]
    aprovado = db.Column(db.Boolean, default=True)  # False se algum item reprovado
    observacoes_gerais = db.Column(db.Text)
    veiculo = db.relationship("Veiculo", backref=db.backref("checklists", lazy=True, cascade="all, delete-orphan"))
    motorista = db.relationship("Motorista", backref=db.backref("checklists", lazy=True))
    __table_args__ = (db.Index("ix_checklist_veiculo", "veiculo_id"), db.Index("ix_checklist_created", "created_at"))

    def to_dict(self, include_relationships: bool = False, depth: int = 0):
        data = super().to_dict(include_relationships=include_relationships, depth=depth)
        data["veiculo_placa"] = self.veiculo.placa if self.veiculo else None
        data["motorista_nome"] = self.motorista.nome if self.motorista else None
        return data


class TaxaEntrega(db.Model, MultiTenantMixin):
    __tablename__ = "taxas_entrega"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome_regiao = db.Column(db.String(100), nullable=False)
    bairros = db.Column(db.Text)
    km_minimo = db.Column(db.Numeric(5, 2), default=0)
    km_maximo = db.Column(db.Numeric(5, 2), default=5)
    taxa_fixa = db.Column(db.Numeric(10, 2), default=0)
    taxa_por_km = db.Column(db.Numeric(10, 2), default=0)
    pedido_minimo = db.Column(db.Numeric(10, 2), default=0)
    taxa_gratis_acima = db.Column(db.Numeric(10, 2))
    tempo_estimado_minutos = db.Column(db.Integer, default=30)
    horario_inicio = db.Column(db.Time)
    horario_fim = db.Column(db.Time)
    ativo = db.Column(db.Boolean, default=True)
    data_cadastro = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("taxas_entrega", lazy=True, cascade="all, delete-orphan"))
    __table_args__ = (db.Index("ix_taxa_regiao", "nome_regiao"),)

    def to_dict(self):
        return {"id": self.id, "nome_regiao": self.nome_regiao, "bairros": json.loads(self.bairros) if self.bairros else [],
                "km_minimo": float(self.km_minimo) if self.km_minimo else 0.0, "km_maximo": float(self.km_maximo) if self.km_maximo else 0.0,
                "taxa_fixa": float(self.taxa_fixa) if self.taxa_fixa else 0.0, "taxa_por_km": float(self.taxa_por_km) if self.taxa_por_km else 0.0,
                "pedido_minimo": float(self.pedido_minimo) if self.pedido_minimo else 0.0,
                "taxa_gratis_acima": float(self.taxa_gratis_acima) if self.taxa_gratis_acima else None,
                "tempo_estimado_minutos": self.tempo_estimado_minutos, "ativo": self.ativo}

class Entrega(db.Model, MultiTenantMixin, SoftDeleteMixin):
    __tablename__ = "entregas"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    venda_id = db.Column(db.Integer, db.ForeignKey("vendas.id"), nullable=False, index=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey("clientes.id"), index=True)
    motorista_id = db.Column(db.Integer, db.ForeignKey("motoristas.id"), index=True)
    veiculo_id = db.Column(db.Integer, db.ForeignKey("veiculos.id"), index=True)
    taxa_entrega_id = db.Column(db.Integer, db.ForeignKey("taxas_entrega.id"), index=True)
    codigo_rastreamento = db.Column(db.String(20), unique=True)
    endereco_cep = db.Column(db.String(9), nullable=False)
    endereco_logradouro = db.Column(db.String(200), nullable=False)
    endereco_numero = db.Column(db.String(10), nullable=False)
    endereco_complemento = db.Column(db.String(100))
    endereco_bairro = db.Column(db.String(100), nullable=False)
    endereco_cidade = db.Column(db.String(100), nullable=False)
    endereco_estado = db.Column(db.String(2), nullable=False)
    endereco_referencia = db.Column(db.String(200))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    distancia_km = db.Column(db.Numeric(10, 2), default=0)
    km_percorridos = db.Column(db.Numeric(10, 2), default=0)
    taxa_entrega = db.Column(db.Numeric(10, 2), default=0)
    custo_entrega = db.Column(db.Numeric(10, 2), default=0)
    comissao_motorista = db.Column(db.Numeric(10, 2), default=0)
    custo_combustivel = db.Column(db.Numeric(10, 2), default=0)
    pagamento_tipo = db.Column(db.String(20), default="loja")
    pagamento_status = db.Column(db.String(20), default="pendente")
    status = db.Column(db.String(20), default="pendente")
    data_prevista = db.Column(db.DateTime, nullable=False)
    data_saida = db.Column(db.DateTime)
    data_entrega = db.Column(db.DateTime)
    data_cancelamento = db.Column(db.DateTime)
    motivo_cancelamento = db.Column(db.String(255))
    tempo_estimado_minutos = db.Column(db.Integer, default=30)
    tempo_real_minutos = db.Column(db.Integer)
    observacoes = db.Column(db.Text)
    observacoes_motorista = db.Column(db.Text)
    nota_cliente = db.Column(db.Integer)
    comentario_cliente = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)
    deleted_at = db.Column(db.DateTime, nullable=True)
    venda = db.relationship("Venda", backref=db.backref("entrega", uselist=False))
    cliente = db.relationship("Cliente", backref=db.backref("entregas", lazy=True))
    motorista = db.relationship("Motorista", backref=db.backref("entregas", lazy=True))
    veiculo = db.relationship("Veiculo", backref=db.backref("entregas", lazy=True))
    taxa_entrega_ref = db.relationship("TaxaEntrega", backref=db.backref("entregas", lazy=True))
    itens = db.relationship("EntregaItem", backref="entrega", lazy=True, cascade="all, delete-orphan")
    rastreamentos = db.relationship("RastreamentoEntrega", backref="entrega", lazy=True, cascade="all, delete-orphan")
    __table_args__ = (db.Index("ix_entrega_codigo", "codigo_rastreamento"), db.Index("ix_entrega_status", "status"),
                      db.Index("ix_entrega_data_prevista", "data_prevista"), db.Index("ix_entrega_bairro", "endereco_bairro"),
                      db.Index("ix_entrega_motorista", "motorista_id"))

    def to_dict(self):
        return {"id": self.id, "codigo_rastreamento": self.codigo_rastreamento, "venda_id": self.venda_id,
                "cliente_id": self.cliente_id, "cliente_nome": self.cliente.nome if self.cliente else None,
                "motorista_id": self.motorista_id, "motorista_nome": self.motorista.nome if self.motorista else None,
                "veiculo_id": self.veiculo_id, "veiculo_placa": self.veiculo.placa if self.veiculo else None,
                "endereco_completo": f"{self.endereco_logradouro}, {self.endereco_numero} - {self.endereco_bairro} - {self.endereco_cidade}/{self.endereco_estado}",
                "endereco_cep": self.endereco_cep, "endereco_bairro": self.endereco_bairro,
                "distancia_km": float(self.distancia_km) if self.distancia_km else 0.0,
                "km_percorridos": float(self.km_percorridos) if self.km_percorridos else 0.0,
                # Tempo real da entrega (da saída até a conclusão), em minutos
                "tempo_entrega_minutos": (
                    round((self.data_entrega - self.data_saida).total_seconds() / 60)
                    if self.data_saida and self.data_entrega else None
                ),
                "taxa_entrega": float(self.taxa_entrega) if self.taxa_entrega else 0.0,
                "custo_entrega": float(self.custo_entrega) if self.custo_entrega else 0.0,
                "custo_combustivel": float(self.custo_combustivel) if self.custo_combustivel else 0.0,
                "status": self.status, "data_prevista": self.data_prevista.isoformat() if self.data_prevista else None,
                "data_saida": self.data_saida.isoformat() if self.data_saida else None,
                "data_entrega": self.data_entrega.isoformat() if self.data_entrega else None,
                "tempo_estimado_minutos": self.tempo_estimado_minutos, "tempo_real_minutos": self.tempo_real_minutos,
                "nota_cliente": self.nota_cliente, "observacoes": self.observacoes}

class EntregaItem(db.Model):
    __tablename__ = "entrega_itens"
    id = db.Column(db.Integer, primary_key=True)
    entrega_id = db.Column(db.Integer, db.ForeignKey("entregas.id"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False, index=True)
    venda_item_id = db.Column(db.Integer, db.ForeignKey("venda_itens.id"), index=True)
    quantidade = db.Column(db.Numeric(10, 3), nullable=False)
    quantidade_entregue = db.Column(db.Numeric(10, 3), default=0)
    status = db.Column(db.String(20), default="pendente")
    observacao = db.Column(db.Text)
    produto = db.relationship("Produto", backref=db.backref("entrega_itens", lazy=True))
    venda_item = db.relationship("VendaItem", backref=db.backref("entrega_item", uselist=False))
    __table_args__ = (db.Index("ix_entrega_item_entrega", "entrega_id"), db.Index("ix_entrega_item_produto", "produto_id"))

    def to_dict(self):
        return {"id": self.id, "entrega_id": self.entrega_id, "produto_id": self.produto_id,
                "produto_nome": self.produto.nome if self.produto else None,
                "quantidade": float(self.quantidade) if self.quantidade else 0.0,
                "quantidade_entregue": float(self.quantidade_entregue) if self.quantidade_entregue else 0.0,
                "status": self.status, "observacao": self.observacao}

class RastreamentoEntrega(db.Model):
    __tablename__ = "rastreamento_entregas"
    id = db.Column(db.Integer, primary_key=True)
    entrega_id = db.Column(db.Integer, db.ForeignKey("entregas.id"), nullable=False, index=True)
    status = db.Column(db.String(30), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    observacao = db.Column(db.Text)
    data_hora = db.Column(db.DateTime, default=utcnow)
    foto_url = db.Column(db.String(500))
    assinatura_url = db.Column(db.String(500))
    __table_args__ = (db.Index("ix_rastreamento_entrega", "entrega_id"), db.Index("ix_rastreamento_data", "data_hora"))

    def to_dict(self):
        return {"id": self.id, "entrega_id": self.entrega_id, "status": self.status,
                "latitude": self.latitude, "longitude": self.longitude, "observacao": self.observacao,
                "data_hora": self.data_hora.isoformat() if self.data_hora else None,
                "foto_url": self.foto_url, "assinatura_url": self.assinatura_url}

class CustoEntrega(db.Model, MultiTenantMixin):
    __tablename__ = "custos_entrega"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    motorista_id = db.Column(db.Integer, db.ForeignKey("motoristas.id"), index=True)
    veiculo_id = db.Column(db.Integer, db.ForeignKey("veiculos.id"), index=True)
    tipo = db.Column(db.String(30), nullable=False)
    descricao = db.Column(db.String(255), nullable=False)
    valor = db.Column(db.Numeric(10, 2), nullable=False)
    km_referencia = db.Column(db.Numeric(10, 2))
    data_custo = db.Column(db.Date, nullable=False, default=date.today)
    data_vencimento = db.Column(db.Date)
    data_pagamento = db.Column(db.Date)
    status = db.Column(db.String(20), default="pendente")
    comprovante_url = db.Column(db.String(500))
    observacoes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)
    estabelecimento = db.relationship("Estabelecimento", backref=db.backref("custos_entrega", lazy=True))
    motorista = db.relationship("Motorista", backref=db.backref("custos_entrega", lazy=True))
    veiculo = db.relationship("Veiculo", backref=db.backref("custos_entrega", lazy=True))
    __table_args__ = (db.Index("ix_custo_entrega_tipo", "tipo"), db.Index("ix_custo_entrega_data", "data_custo"))

    def to_dict(self):
        return {"id": self.id, "tipo": self.tipo, "descricao": self.descricao,
                "valor": float(self.valor) if self.valor else 0.0,
                "km_referencia": float(self.km_referencia) if self.km_referencia else 0.0,
                "data_custo": self.data_custo.isoformat() if self.data_custo else None,
                "status": self.status, "motorista_id": self.motorista_id,
                "motorista_nome": self.motorista.nome if self.motorista else None,
                "veiculo_id": self.veiculo_id, "observacoes": self.observacoes}

# ------------------------------------------------------------------------------
# Alias e Funções de Suporte
# ------------------------------------------------------------------------------
ItemVenda = VendaItem

login_manager = LoginManager()

@login_manager.user_loader
def load_user(user_id):
    try: return Funcionario.query.get(int(user_id))
    except: return None

@login_manager.request_loader
def load_user_from_request(request):
    auth = request.headers.get("Authorization")
    if auth:
        try:
            typ, tok = auth.split(None, 1)
            if typ.lower() in ("bearer", "token"):
                user = Funcionario.query.filter_by(username=tok).first()
                if user and user.ativo: return user
        except: pass
    tok = request.args.get("token")
    if tok:
        user = Funcionario.query.filter_by(username=tok).first()
        if user and user.ativo: return user
    return None

def get_model_by_table(table_name: str):
    mapping = {
        "estabelecimentos": Estabelecimento,
        "funcionarios": Funcionario,
        "categorias_produto": CategoriaProduto,
        "fornecedores": Fornecedor,
        "produtos": Produto,
        "produto_lotes": ProdutoLote,
        "estoque_lotes": ProdutoLote,
        "movimentacoes_estoque": MovimentacaoEstoque,
        "movimentacao_estoque": MovimentacaoEstoque,
        "vendas": Venda,
        "venda_itens": VendaItem,
        "pagamentos": Pagamento,
        "movimentacoes_caixa": MovimentacaoCaixa,
        "transacoes_caixa": MovimentacaoCaixa,
        "contas_pagar": ContaPagar,
        "contas_receber": ContaReceber,
        "clientes": Cliente,
        "caixas": Caixa,
        "historico_precos": HistoricoPrecos,
        "configuracoes": Configuracao,
        "despesas": Despesa,
        "motoristas": Motorista,
        "veiculos": Veiculo,
        "taxas_entrega": TaxaEntrega,
        "entregas": Entrega,
    }
    return mapping.get(table_name)
SyncLog = SyncQueue
AuditoriaSincronia = SyncQueue

# ==========================================
# Módulo 8: App do Entregador e Logística
# ==========================================

class StatusPedidoLogistica(db.Model):
    __tablename__ = "status_pedido_logistica"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = db.Column(db.Integer, db.ForeignKey('estabelecimentos.id'), nullable=False, index=True)
    venda_id = db.Column(db.Integer, db.ForeignKey('vendas.id'), nullable=True, index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey('funcionarios.id'), nullable=False, index=True)
    status = db.Column(db.String(50), nullable=False) # SAIU_PARA_ENTREGA, CHEGOU_NO_LOCAL, CONCLUIDO
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class AuditoriaQuilometragem(db.Model):
    __tablename__ = "auditoria_quilometragem"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = db.Column(db.Integer, db.ForeignKey('estabelecimentos.id'), nullable=False, index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey('funcionarios.id'), nullable=False, index=True)
    turno_data = db.Column(db.Date, nullable=False, default=lambda: datetime.utcnow().date())
    pontos_gps = db.Column(db.JSON, nullable=True) # JSON array de coords offline
    distancia_total_km = db.Column(db.Float, default=0.0)

class ConfiguracaoLogistica(db.Model):
    __tablename__ = "configuracoes_logistica"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = db.Column(db.Integer, db.ForeignKey('estabelecimentos.id'), nullable=False, index=True)
    preco_gasolina = db.Column(db.Numeric(10, 2), default=6.00)
    preco_alcool = db.Column(db.Numeric(10, 2), default=4.50)
    preco_diesel = db.Column(db.Numeric(10, 2), default=5.00)
    manutencao_moto_diaria = db.Column(db.Numeric(10, 2), default=100.00)
    manutencao_carro_diaria = db.Column(db.Numeric(10, 2), default=200.00)
    preco_por_km_moto = db.Column(db.Numeric(10, 2), default=1.00)
    preco_por_km_carro = db.Column(db.Numeric(10, 2), default=2.00)

class TurnoEntregador(db.Model):
    __tablename__ = "turnos_entregador"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = db.Column(db.Integer, db.ForeignKey('estabelecimentos.id'), nullable=False, index=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey('funcionarios.id'), nullable=False, index=True)
    veiculo_id = db.Column(db.Integer, db.ForeignKey('veiculos.id'), nullable=True, index=True)
    data_turno = db.Column(db.Date, nullable=False, default=lambda: datetime.utcnow().date())
    horario_inicio = db.Column(db.DateTime, default=datetime.utcnow)
    horario_fim = db.Column(db.DateTime, nullable=True)
    km_inicial = db.Column(db.Numeric(10, 2), nullable=False)
    km_final = db.Column(db.Numeric(10, 2), nullable=True)
    distancia_percorrida = db.Column(db.Numeric(10, 2), default=0)
    custo_combustivel = db.Column(db.Numeric(10, 2), default=0)
    custo_manutencao = db.Column(db.Numeric(10, 2), default=0)
    tipo_combustivel = db.Column(db.String(20), default="gasolina")
    status = db.Column(db.String(20), default="aberto") # aberto, fechado

class ManutencaoVeiculo(db.Model, MultiTenantMixin, SerializableMixin, AuditMixin):
    __tablename__ = "manutencoes_veiculo"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    veiculo_id = db.Column(db.Integer, db.ForeignKey('veiculos.id'), nullable=False, index=True)
    motorista_id = db.Column(db.Integer, db.ForeignKey('funcionarios.id'), nullable=True, index=True)
    despesa_id = db.Column(db.Integer, db.ForeignKey('despesas.id'), nullable=True, index=True)
    data_manutencao = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    tipo_servico = db.Column(db.String(100), nullable=False) # Ex: Oleo, Pneus, Relacao, Eletrica
    descricao = db.Column(db.Text, nullable=True)
    km_atual = db.Column(db.Numeric(10, 2), nullable=False)
    valor_total = db.Column(db.Numeric(19, 4), nullable=False)
    
    veiculo = db.relationship('Veiculo', backref=db.backref('manutencoes', lazy=True, cascade='all, delete-orphan'))
    motorista = db.relationship('Funcionario', backref=db.backref('manutencoes_registradas', lazy=True))
    despesa = db.relationship('Despesa', backref=db.backref('manutencao_veiculo', uselist=False))


# ==========================================
# Módulo: Consultor IA
# ==========================================

class ConsultorInteracao(db.Model, MultiTenantMixin):
    """Interações e logs de uso do consultor inteligente."""
    __tablename__ = "consultor_interacoes"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    funcionario_id = db.Column(db.Integer, db.ForeignKey('funcionarios.id'), nullable=True, index=True)
    especialista = db.Column(db.String(40), nullable=False)
    pergunta = db.Column(db.Text, nullable=False)
    resposta = db.Column(db.Text)
    provider = db.Column(db.String(10), nullable=False)
    duracao_ms = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=utcnow)

    funcionario = db.relationship('Funcionario', backref=db.backref('interacoes_ia', lazy=True))

    def to_dict(self):
        return {
            "id": self.id,
            "especialista": self.especialista,
            "pergunta": self.pergunta,
            "resposta": self.resposta,
            "provider": self.provider,
            "duracao_ms": self.duracao_ms,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
