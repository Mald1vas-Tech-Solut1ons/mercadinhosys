"""CRM comercial: leads, funil de oportunidades, follow-up, consentimento (LGPD), campanhas e comissão.

Regras de escopo: admin e gerente veem a loja inteira; o vendedor vê só o que é dele (responsável) e
os clientes da própria carteira (``Cliente.vendedor_id``). Este módulo nunca faz commit; a rota abre
e fecha a transação.

Datas: o banco grava UTC naive. Períodos e "hoje" são o dia da loja (``app.utils.timezone``).
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import quote

from sqlalchemy import and_, func, or_

from app.models import (Cliente, ContaReceber, CrmAtividade, CrmCampanha, CrmCampanhaEnvio, CrmChamado,
                        CrmComissaoFechamento, CrmConsentimento, CrmLead, CrmOportunidade, CrmRegraComissao,
                        DevolucaoVenda, Funcionario, PedidoVenda, PedidoVendaExpedicao, Venda, db, normalizar_documento)
from app.utils.timezone import hoje_local, iso_local, local_date_to_utc_naive, to_local, LOCAL_TZ

CENT = Decimal("0.01")

ETAPAS = {"prospeccao": 10, "qualificacao": 25, "proposta": 50, "negociacao": 75, "ganha": 100, "perdida": 0}
ETAPAS_ABERTAS = ("prospeccao", "qualificacao", "proposta", "negociacao")
STATUS_LEAD = ("novo", "contatado", "qualificado", "convertido", "descartado")
TIPOS_ATIVIDADE = ("ligacao", "visita", "whatsapp", "email", "reuniao", "tarefa")
CANAIS = ("whatsapp", "email", "sms", "telefone")
FINALIDADES = ("marketing", "cobranca", "pos_venda")
ORIGENS_CONSENTIMENTO = ("balcao", "formulario", "whatsapp", "email", "verbal", "contrato", "importacao",
                         "campanha", "conversao_lead")
TIPOS_CHAMADO = ("reclamacao", "avaria", "troca", "devolucao", "garantia", "duvida", "entrega")
PRIORIDADES_SLA_HORAS = {"alta": 24, "media": 72, "baixa": 120}
STATUS_CHAMADO = ("aberto", "em_atendimento", "aguardando_cliente", "resolvido", "fechado")
TRANSICOES_CHAMADO = {
    "aberto": {"em_atendimento", "aguardando_cliente", "resolvido"},
    "em_atendimento": {"aguardando_cliente", "resolvido"},
    "aguardando_cliente": {"em_atendimento", "resolvido"},
    "resolvido": {"fechado", "em_atendimento"},
    "fechado": set(),
}
STATUS_ENVIO = ("enviado", "falhou", "respondido", "descadastrado")


class CrmErro(ValueError):
    status = 400


class AcessoNegado(CrmErro):
    status = 403


class NaoEncontrado(CrmErro):
    status = 404


class Conflito(CrmErro):
    status = 409


@dataclass(frozen=True)
class Ator:
    id: int
    estabelecimento_id: int
    nivel: int  # 0 super admin, 1 admin, 2 gerente, 4 caixa/estoque, 5 vendedor

    @property
    def gestor(self):
        return self.nivel in (0, 1, 2)


# ───────────────────────────── utilitários ─────────────────────────────

def _texto(valor, rotulo, maximo, obrigatorio=False):
    texto = (str(valor).strip() if valor is not None else "")
    if obrigatorio and not texto:
        raise CrmErro(f"{rotulo} é obrigatório")
    if len(texto) > maximo:
        raise CrmErro(f"{rotulo} aceita no máximo {maximo} caracteres")
    return texto or None


def _dinheiro(valor, rotulo):
    try:
        numero = Decimal(str(valor))
    except Exception:
        raise CrmErro(f"{rotulo} inválido") from None
    if not numero.is_finite() or numero < 0 or numero > Decimal("1000000000000"):
        raise CrmErro(f"{rotulo} inválido")
    return numero.quantize(CENT, rounding=ROUND_HALF_UP)


def _inteiro(valor, rotulo, minimo, maximo):
    try:
        numero = int(valor)
    except (TypeError, ValueError):
        raise CrmErro(f"{rotulo} inválido") from None
    if numero < minimo or numero > maximo:
        raise CrmErro(f"{rotulo} deve estar entre {minimo} e {maximo}")
    return numero


def _data(valor, rotulo):
    if valor in (None, ""):
        return None
    try:
        return datetime.strptime(str(valor)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise CrmErro(f"{rotulo} inválida (use AAAA-MM-DD)") from None


def instante_local_para_utc(valor, rotulo="Data"):
    """Aceita 'AAAA-MM-DD' (fim do dia da loja) ou data e hora local 'AAAA-MM-DDTHH:MM'; devolve UTC naive."""
    if valor in (None, ""):
        return None
    texto = str(valor).strip()
    try:
        if len(texto) <= 10:
            return local_date_to_utc_naive(texto, fim_do_dia=True)
        instante = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        raise CrmErro(f"{rotulo} inválida") from None
    if instante.tzinfo is None:
        instante = instante.replace(tzinfo=LOCAL_TZ)
    return instante.astimezone(timezone.utc).replace(tzinfo=None)


def _agora():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _dec(valor):
    return float(Decimal(str(valor or 0)).quantize(CENT, rounding=ROUND_HALF_UP))


def _funcionario_da_loja(ator, funcionario_id, rotulo="Responsável"):
    funcionario = Funcionario.query.filter_by(id=int(funcionario_id), estabelecimento_id=ator.estabelecimento_id).first()
    if not funcionario or not funcionario.ativo:
        raise CrmErro(f"{rotulo} não encontrado ou inativo")
    return funcionario


def _responsavel(ator, dados):
    """Gestor pode atribuir a outro funcionário; os demais sempre ficam como responsáveis."""
    pedido = dados.get("responsavel_id")
    if pedido in (None, "") or int(pedido) == ator.id:
        return ator.id
    if not ator.gestor:
        raise AcessoNegado("Só gerente ou admin atribui a outro responsável")
    return _funcionario_da_loja(ator, pedido).id


def cliente_acessivel(ator, cliente_id, *, para_vendedor_sem_carteira=False):
    """Cliente da loja; o vendedor só alcança a própria carteira (e, se pedido, clientes sem vendedor)."""
    try:
        cliente_id = int(cliente_id)
    except (TypeError, ValueError):
        raise CrmErro("Cliente inválido") from None
    cliente = Cliente.query.filter_by(id=cliente_id, estabelecimento_id=ator.estabelecimento_id).first()
    if not cliente:
        raise NaoEncontrado("Cliente não encontrado")
    if ator.nivel == 5 and cliente.vendedor_id != ator.id:
        if not (para_vendedor_sem_carteira and cliente.vendedor_id is None):
            raise AcessoNegado("Cliente fora da sua carteira")
    return cliente


def _escopo(consulta, modelo, ator):
    consulta = consulta.filter(modelo.estabelecimento_id == ator.estabelecimento_id)
    if not ator.gestor:
        consulta = consulta.filter(modelo.responsavel_id == ator.id)
    return consulta


def _obter(modelo, ator, registro_id, rotulo):
    registro = _escopo(modelo.query, modelo, ator).filter(modelo.id == int(registro_id)).first()
    if not registro:
        raise NaoEncontrado(f"{rotulo} não encontrado")
    return registro


# ───────────────────────────── leads ─────────────────────────────

def lead_dict(lead):
    return {
        "id": lead.id, "nome": lead.nome, "empresa": lead.empresa, "documento": lead.documento,
        "telefone": lead.telefone, "email": lead.email, "cidade": lead.cidade, "estado": lead.estado,
        "origem": lead.origem, "status": lead.status, "responsavel_id": lead.responsavel_id,
        "responsavel_nome": lead.responsavel.nome if lead.responsavel else None,
        "cliente_id": lead.cliente_id, "motivo_descarte": lead.motivo_descarte, "observacoes": lead.observacoes,
        "created_at": iso_local(lead.created_at), "convertido_em": iso_local(lead.convertido_em),
    }


def _duplicidade_documento(ator, documento, ignorar_lead_id=None):
    if not documento:
        return
    lead = CrmLead.query.filter(CrmLead.estabelecimento_id == ator.estabelecimento_id, CrmLead.documento == documento,
                                CrmLead.status != "descartado")
    if ignorar_lead_id:
        lead = lead.filter(CrmLead.id != ignorar_lead_id)
    existente = lead.first()
    if existente:
        raise Conflito(f"Já existe o lead #{existente.id} com este documento")
    cliente = Cliente.query.filter(Cliente.estabelecimento_id == ator.estabelecimento_id,
                                   or_(Cliente.cpf == documento, Cliente.cnpj == documento)).first()
    if cliente:
        raise Conflito(f"Este documento já é do cliente #{cliente.id} ({cliente.nome}); crie a oportunidade no cliente")


def criar_lead(ator, dados):
    documento = normalizar_documento(dados.get("documento") or "") or None
    if documento and len(documento) not in (11, 14):
        raise CrmErro("Documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos)")
    if not (dados.get("telefone") or dados.get("email")):
        raise CrmErro("Informe telefone ou e-mail para contato")
    _duplicidade_documento(ator, documento)
    lead = CrmLead(
        estabelecimento_id=ator.estabelecimento_id,
        nome=_texto(dados.get("nome"), "Nome", 150, True),
        empresa=_texto(dados.get("empresa"), "Empresa", 150),
        documento=documento,
        telefone=_texto(dados.get("telefone"), "Telefone", 30),
        email=_texto(dados.get("email"), "E-mail", 120),
        cidade=_texto(dados.get("cidade"), "Cidade", 100),
        estado=(_texto(dados.get("estado"), "UF", 2) or "").upper() or None,
        origem=_texto(dados.get("origem") or "manual", "Origem", 40),
        observacoes=_texto(dados.get("observacoes"), "Observações", 4000),
        responsavel_id=_responsavel(ator, dados),
        status="novo",
    )
    db.session.add(lead)
    db.session.flush()
    return lead


def atualizar_lead(ator, lead_id, dados):
    lead = _obter(CrmLead, ator, lead_id, "Lead")
    if lead.status == "convertido":
        raise Conflito("Lead convertido não pode ser alterado; edite o cliente")
    for campo, rotulo, maximo in (("nome", "Nome", 150), ("empresa", "Empresa", 150), ("telefone", "Telefone", 30),
                                  ("email", "E-mail", 120), ("cidade", "Cidade", 100), ("origem", "Origem", 40),
                                  ("observacoes", "Observações", 4000)):
        if campo in dados:
            setattr(lead, campo, _texto(dados[campo], rotulo, maximo, obrigatorio=campo in ("nome", "origem")))
    if "estado" in dados:
        lead.estado = (_texto(dados["estado"], "UF", 2) or "").upper() or None
    if "documento" in dados:
        documento = normalizar_documento(dados.get("documento") or "") or None
        if documento and len(documento) not in (11, 14):
            raise CrmErro("Documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos)")
        _duplicidade_documento(ator, documento, ignorar_lead_id=lead.id)
        lead.documento = documento
    if "responsavel_id" in dados:
        lead.responsavel_id = _responsavel(ator, dados)
    if "status" in dados:
        status = dados["status"]
        if status not in STATUS_LEAD or status == "convertido":
            raise CrmErro("Status inválido (a conversão tem rota própria)")
        if status == "descartado":
            lead.motivo_descarte = _texto(dados.get("motivo_descarte"), "Motivo do descarte", 255, True)
        lead.status = status
    return lead


def listar_leads(ator, filtros):
    consulta = _escopo(CrmLead.query, CrmLead, ator)
    if filtros.get("status"):
        consulta = consulta.filter(CrmLead.status == filtros["status"])
    if filtros.get("responsavel_id") and ator.gestor:
        consulta = consulta.filter(CrmLead.responsavel_id == int(filtros["responsavel_id"]))
    if filtros.get("busca"):
        termo = f"%{filtros['busca'].strip()}%"
        consulta = consulta.filter(or_(CrmLead.nome.ilike(termo), CrmLead.empresa.ilike(termo),
                                       CrmLead.telefone.ilike(termo), CrmLead.email.ilike(termo)))
    return consulta.order_by(CrmLead.created_at.desc()).limit(500).all()


def converter_lead(ator, lead_id, cliente_id):
    """Liga o lead a um cliente cadastrado (o cadastro usa o formulário de clientes, com as validações de PF/PJ)."""
    lead = _obter(CrmLead, ator, lead_id, "Lead")
    if lead.status in ("convertido", "descartado"):
        raise Conflito(f"Lead já está {lead.status}")
    cliente = cliente_acessivel(ator, cliente_id, para_vendedor_sem_carteira=True)
    if cliente.vendedor_id is None:
        cliente.vendedor_id = lead.responsavel_id  # o cliente nasce na carteira de quem o trouxe
    agora = _agora()
    lead.status, lead.cliente_id, lead.convertido_em = "convertido", cliente.id, agora
    CrmOportunidade.query.filter(CrmOportunidade.estabelecimento_id == ator.estabelecimento_id,
                                 CrmOportunidade.lead_id == lead.id, CrmOportunidade.cliente_id.is_(None)) \
        .update({"cliente_id": cliente.id}, synchronize_session=False)
    CrmAtividade.query.filter(CrmAtividade.estabelecimento_id == ator.estabelecimento_id,
                              CrmAtividade.lead_id == lead.id, CrmAtividade.cliente_id.is_(None)) \
        .update({"cliente_id": cliente.id}, synchronize_session=False)
    # O consentimento é da pessoa: o histórico do lead passa a valer para o cliente, com a origem registrada.
    for (canal, finalidade), registro in _consentimentos_vigentes(ator, lead_id=lead.id).items():
        db.session.add(CrmConsentimento(
            estabelecimento_id=ator.estabelecimento_id, cliente_id=cliente.id, canal=canal, finalidade=finalidade,
            concedido=registro.concedido, origem="conversao_lead",
            evidencia=f"Lead #{lead.id}: {registro.origem} em {iso_local(registro.registrado_em)}"[:255],
            registrado_por_id=ator.id))
    return lead, cliente


# ───────────────────────────── oportunidades ─────────────────────────────

def probabilidade(oportunidade):
    if oportunidade.etapa in ("ganha", "perdida"):
        return ETAPAS[oportunidade.etapa]
    return oportunidade.probabilidade if oportunidade.probabilidade is not None else ETAPAS[oportunidade.etapa]


def oportunidade_dict(op):
    valor = Decimal(str(op.valor_estimado or 0))
    prob = probabilidade(op)
    return {
        "id": op.id, "titulo": op.titulo, "cliente_id": op.cliente_id,
        "cliente_nome": op.cliente.nome if op.cliente else None, "lead_id": op.lead_id,
        "lead_nome": op.lead.nome if op.lead else None, "responsavel_id": op.responsavel_id,
        "responsavel_nome": op.responsavel.nome if op.responsavel else None, "etapa": op.etapa,
        "valor_estimado": _dec(valor), "probabilidade": prob, "valor_ponderado": _dec(valor * prob / 100),
        "data_prevista_fechamento": op.data_prevista_fechamento.isoformat() if op.data_prevista_fechamento else None,
        "pedido_venda_id": op.pedido_venda_id, "valor_ganho": _dec(op.valor_ganho) if op.valor_ganho is not None else None,
        "motivo_perda": op.motivo_perda, "concorrente": op.concorrente,
        "created_at": iso_local(op.created_at), "fechada_em": iso_local(op.fechada_em),
    }


def criar_oportunidade(ator, dados):
    cliente_id, lead_id = dados.get("cliente_id"), dados.get("lead_id")
    if not cliente_id and not lead_id:
        raise CrmErro("Informe o cliente ou o lead")
    cliente = cliente_acessivel(ator, cliente_id) if cliente_id else None
    lead = _obter(CrmLead, ator, lead_id, "Lead") if lead_id else None
    if lead and lead.status in ("descartado",):
        raise Conflito("Lead descartado")
    if lead and lead.cliente_id and not cliente:
        cliente = Cliente.query.get(lead.cliente_id)
    etapa = dados.get("etapa") or "prospeccao"
    if etapa not in ETAPAS_ABERTAS:
        raise CrmErro("Oportunidade nasce numa etapa aberta")
    op = CrmOportunidade(
        estabelecimento_id=ator.estabelecimento_id,
        titulo=_texto(dados.get("titulo"), "Título", 150, True),
        cliente_id=cliente.id if cliente else None,
        lead_id=lead.id if lead else None,
        responsavel_id=_responsavel(ator, dados),
        etapa=etapa,
        valor_estimado=_dinheiro(dados.get("valor_estimado", 0), "Valor estimado"),
        probabilidade=_inteiro(dados["probabilidade"], "Probabilidade", 0, 100) if dados.get("probabilidade") not in (None, "") else None,
        data_prevista_fechamento=_data(dados.get("data_prevista_fechamento"), "Previsão de fechamento"),
        concorrente=_texto(dados.get("concorrente"), "Concorrente", 100),
    )
    db.session.add(op)
    db.session.flush()
    return op


def atualizar_oportunidade(ator, op_id, dados):
    op = _obter(CrmOportunidade, ator, op_id, "Oportunidade")
    fechada = op.etapa in ("ganha", "perdida")
    if fechada and dados.get("etapa") not in ETAPAS_ABERTAS:
        raise Conflito("Oportunidade encerrada; reabra para editar")
    if "titulo" in dados:
        op.titulo = _texto(dados["titulo"], "Título", 150, True)
    if "valor_estimado" in dados:
        op.valor_estimado = _dinheiro(dados["valor_estimado"], "Valor estimado")
    if "probabilidade" in dados:
        op.probabilidade = None if dados["probabilidade"] in (None, "") else _inteiro(dados["probabilidade"], "Probabilidade", 0, 100)
    if "data_prevista_fechamento" in dados:
        op.data_prevista_fechamento = _data(dados["data_prevista_fechamento"], "Previsão de fechamento")
    if "concorrente" in dados:
        op.concorrente = _texto(dados["concorrente"], "Concorrente", 100)
    if "responsavel_id" in dados:
        op.responsavel_id = _responsavel(ator, dados)
    if "etapa" in dados and dados["etapa"] != op.etapa:
        mover_etapa(ator, op, dados["etapa"], dados)
    return op


def mover_etapa(ator, op, etapa, dados):
    if etapa not in ETAPAS:
        raise CrmErro("Etapa inválida")
    if op.etapa in ("ganha", "perdida"):
        if not ator.gestor:
            raise AcessoNegado("Só gerente ou admin reabre oportunidade encerrada")
        if etapa not in ETAPAS_ABERTAS:
            raise CrmErro("Reabertura volta para uma etapa aberta")
        op.fechada_em = op.valor_ganho = op.motivo_perda = op.pedido_venda_id = None
    if etapa == "ganha":
        if not op.cliente_id:
            raise CrmErro("Converta o lead em cliente antes de ganhar a oportunidade")
        pedido_id = dados.get("pedido_venda_id")
        if pedido_id:
            pedido = PedidoVenda.query.filter_by(id=int(pedido_id), estabelecimento_id=ator.estabelecimento_id).first()
            if not pedido or pedido.cliente_id != op.cliente_id:
                raise CrmErro("Pedido não encontrado para este cliente")
            if pedido.status == "cancelado":
                raise CrmErro("Pedido cancelado não ganha oportunidade")
            outra = CrmOportunidade.query.filter(CrmOportunidade.estabelecimento_id == ator.estabelecimento_id,
                                                 CrmOportunidade.pedido_venda_id == pedido.id,
                                                 CrmOportunidade.id != op.id).first()
            if outra:
                raise Conflito(f"Pedido já ganhou a oportunidade #{outra.id}")
            op.pedido_venda_id, op.valor_ganho = pedido.id, Decimal(str(pedido.total or 0))
        else:
            valor = dados.get("valor_ganho")
            op.valor_ganho = _dinheiro(valor, "Valor ganho") if valor not in (None, "") else op.valor_estimado
        op.motivo_perda = None
        op.fechada_em = _agora()
    elif etapa == "perdida":
        op.motivo_perda = _texto(dados.get("motivo_perda"), "Motivo da perda", 255, True)
        op.concorrente = _texto(dados.get("concorrente"), "Concorrente", 100) or op.concorrente
        op.valor_ganho, op.pedido_venda_id = None, None
        op.fechada_em = _agora()
    op.etapa = etapa
    return op


def listar_oportunidades(ator, filtros):
    consulta = _escopo(CrmOportunidade.query, CrmOportunidade, ator)
    if filtros.get("etapa"):
        consulta = consulta.filter(CrmOportunidade.etapa == filtros["etapa"])
    if filtros.get("abertas"):
        consulta = consulta.filter(CrmOportunidade.etapa.in_(ETAPAS_ABERTAS))
    if filtros.get("cliente_id"):
        consulta = consulta.filter(CrmOportunidade.cliente_id == int(filtros["cliente_id"]))
    if filtros.get("responsavel_id") and ator.gestor:
        consulta = consulta.filter(CrmOportunidade.responsavel_id == int(filtros["responsavel_id"]))
    return consulta.order_by(CrmOportunidade.created_at.desc()).limit(1000).all()


def funil(ator, inicio, fim, responsavel_id=None):
    """Pipeline aberto (valor e valor ponderado por etapa) e resultado do período pela data de fechamento."""
    base = _escopo(CrmOportunidade.query, CrmOportunidade, ator)
    if responsavel_id and ator.gestor:
        base = base.filter(CrmOportunidade.responsavel_id == int(responsavel_id))
    etapas = []
    total, ponderado = Decimal("0"), Decimal("0")
    abertas = base.filter(CrmOportunidade.etapa.in_(ETAPAS_ABERTAS)).all()
    hoje = hoje_local()
    vencidas = 0
    for etapa in ETAPAS_ABERTAS:
        lista = [o for o in abertas if o.etapa == etapa]
        valor = sum((Decimal(str(o.valor_estimado or 0)) for o in lista), Decimal("0"))
        pond = sum((Decimal(str(o.valor_estimado or 0)) * probabilidade(o) / 100 for o in lista), Decimal("0"))
        total += valor
        ponderado += pond
        etapas.append({"etapa": etapa, "quantidade": len(lista), "valor": _dec(valor), "valor_ponderado": _dec(pond)})
    vencidas = sum(1 for o in abertas if o.data_prevista_fechamento and o.data_prevista_fechamento < hoje)

    ini_utc, fim_utc = local_date_to_utc_naive(inicio), local_date_to_utc_naive(fim, fim_do_dia=True)
    fechadas = base.filter(CrmOportunidade.etapa.in_(("ganha", "perdida")),
                           CrmOportunidade.fechada_em >= ini_utc, CrmOportunidade.fechada_em <= fim_utc).all()
    ganhas = [o for o in fechadas if o.etapa == "ganha"]
    perdidas = [o for o in fechadas if o.etapa == "perdida"]
    ciclo = [(o.fechada_em - o.created_at).days for o in ganhas if o.fechada_em and o.created_at]
    motivos = {}
    for o in perdidas:
        motivos[o.motivo_perda] = motivos.get(o.motivo_perda, 0) + 1
    return {
        "pipeline": {"etapas": etapas, "valor_total": _dec(total), "valor_ponderado": _dec(ponderado),
                     "quantidade": len(abertas), "previsao_vencida": vencidas},
        "periodo": {
            "inicio": str(inicio), "fim": str(fim), "ganhas": len(ganhas), "perdidas": len(perdidas),
            "valor_ganho": _dec(sum((Decimal(str(o.valor_ganho or 0)) for o in ganhas), Decimal("0"))),
            "taxa_conversao": round(len(ganhas) * 100 / len(fechadas), 1) if fechadas else None,
            "ciclo_medio_dias": round(sum(ciclo) / len(ciclo), 1) if ciclo else None,
            "motivos_perda": sorted(({"motivo": m, "quantidade": q} for m, q in motivos.items()),
                                    key=lambda x: -x["quantidade"]),
        },
        "atividades": resumo_atividades(ator),
    }


# ───────────────────────────── atividades e follow-up ─────────────────────────────

def atividade_dict(a):
    agora = _agora()
    return {
        "id": a.id, "tipo": a.tipo, "assunto": a.assunto, "descricao": a.descricao,
        "vencimento": iso_local(a.vencimento), "concluida_em": iso_local(a.concluida_em), "resultado": a.resultado,
        "atrasada": a.concluida_em is None and a.vencimento is not None and a.vencimento < agora,
        "responsavel_id": a.responsavel_id, "responsavel_nome": a.responsavel.nome if a.responsavel else None,
        "cliente_id": a.cliente_id, "lead_id": a.lead_id, "oportunidade_id": a.oportunidade_id,
        "chamado_id": a.chamado_id, "created_at": iso_local(a.created_at),
    }


def _vinculos_atividade(ator, dados):
    vinculos = {}
    if dados.get("cliente_id"):
        vinculos["cliente_id"] = cliente_acessivel(ator, dados["cliente_id"]).id
    if dados.get("lead_id"):
        vinculos["lead_id"] = _obter(CrmLead, ator, dados["lead_id"], "Lead").id
    if dados.get("oportunidade_id"):
        op = _obter(CrmOportunidade, ator, dados["oportunidade_id"], "Oportunidade")
        vinculos["oportunidade_id"] = op.id
        vinculos.setdefault("cliente_id", op.cliente_id)
        vinculos.setdefault("lead_id", op.lead_id)
    if dados.get("chamado_id"):
        chamado = obter_chamado(ator, dados["chamado_id"])
        vinculos["chamado_id"] = chamado.id
        vinculos.setdefault("cliente_id", chamado.cliente_id)
    if not vinculos:
        raise CrmErro("Atividade precisa de um cliente, lead, oportunidade ou chamado")
    return vinculos


def criar_atividade(ator, dados):
    tipo = dados.get("tipo") or "tarefa"
    if tipo not in TIPOS_ATIVIDADE:
        raise CrmErro("Tipo de atividade inválido")
    atividade = CrmAtividade(
        estabelecimento_id=ator.estabelecimento_id, tipo=tipo,
        assunto=_texto(dados.get("assunto"), "Assunto", 150, True),
        descricao=_texto(dados.get("descricao"), "Descrição", 4000),
        vencimento=instante_local_para_utc(dados.get("vencimento"), "Vencimento"),
        responsavel_id=_responsavel(ator, dados), criado_por_id=ator.id,
        **_vinculos_atividade(ator, dados),
    )
    db.session.add(atividade)
    db.session.flush()
    if atividade.chamado_id:
        _marcar_primeira_resposta(CrmChamado.query.get(atividade.chamado_id))
    return atividade


def concluir_atividade(ator, atividade_id, dados):
    atividade = _obter(CrmAtividade, ator, atividade_id, "Atividade")
    if atividade.concluida_em:
        raise Conflito("Atividade já concluída")
    atividade.concluida_em = _agora()
    atividade.resultado = _texto(dados.get("resultado"), "Resultado", 255, True)
    proxima = None
    seguinte = dados.get("proxima")
    if seguinte:
        vinculos = {k: getattr(atividade, k) for k in ("cliente_id", "lead_id", "oportunidade_id", "chamado_id")
                    if getattr(atividade, k)}
        proxima = criar_atividade(ator, {**vinculos, "responsavel_id": atividade.responsavel_id, **seguinte})
    return atividade, proxima


def listar_atividades(ator, filtros):
    consulta = _escopo(CrmAtividade.query, CrmAtividade, ator)
    situacao = filtros.get("situacao")
    agora = _agora()
    if situacao == "abertas":
        consulta = consulta.filter(CrmAtividade.concluida_em.is_(None))
    elif situacao == "atrasadas":
        consulta = consulta.filter(CrmAtividade.concluida_em.is_(None), CrmAtividade.vencimento < agora)
    elif situacao == "hoje":
        hoje = hoje_local()
        consulta = consulta.filter(CrmAtividade.concluida_em.is_(None),
                                   CrmAtividade.vencimento >= local_date_to_utc_naive(hoje),
                                   CrmAtividade.vencimento <= local_date_to_utc_naive(hoje, fim_do_dia=True))
    elif situacao == "concluidas":
        consulta = consulta.filter(CrmAtividade.concluida_em.isnot(None))
    for campo in ("cliente_id", "lead_id", "oportunidade_id", "chamado_id"):
        if filtros.get(campo):
            consulta = consulta.filter(getattr(CrmAtividade, campo) == int(filtros[campo]))
    if filtros.get("responsavel_id") and ator.gestor:
        consulta = consulta.filter(CrmAtividade.responsavel_id == int(filtros["responsavel_id"]))
    return consulta.order_by(CrmAtividade.concluida_em.isnot(None), CrmAtividade.vencimento.is_(None),
                             CrmAtividade.vencimento, CrmAtividade.id.desc()).limit(500).all()


def resumo_atividades(ator):
    base = _escopo(CrmAtividade.query, CrmAtividade, ator).filter(CrmAtividade.concluida_em.is_(None))
    agora, hoje = _agora(), hoje_local()
    return {
        "abertas": base.count(),
        "atrasadas": base.filter(CrmAtividade.vencimento < agora).count(),
        "hoje": base.filter(CrmAtividade.vencimento >= local_date_to_utc_naive(hoje),
                            CrmAtividade.vencimento <= local_date_to_utc_naive(hoje, fim_do_dia=True)).count(),
    }


# ───────────────────────────── consentimento (LGPD) ─────────────────────────────

def _consentimentos_vigentes(ator, *, cliente_id=None, lead_id=None):
    filtro = CrmConsentimento.cliente_id == cliente_id if cliente_id else CrmConsentimento.lead_id == lead_id
    registros = CrmConsentimento.query.filter(CrmConsentimento.estabelecimento_id == ator.estabelecimento_id, filtro) \
        .order_by(CrmConsentimento.id).all()
    vigentes = {}
    for registro in registros:
        vigentes[(registro.canal, registro.finalidade)] = registro
    return vigentes


def registrar_consentimento(ator, dados):
    canal, finalidade = dados.get("canal"), dados.get("finalidade") or "marketing"
    if canal not in CANAIS:
        raise CrmErro("Canal inválido")
    if finalidade not in FINALIDADES:
        raise CrmErro("Finalidade inválida")
    origem = dados.get("origem")
    if origem not in ORIGENS_CONSENTIMENTO:
        raise CrmErro("Origem do consentimento inválida")
    if not isinstance(dados.get("concedido"), bool):
        raise CrmErro("Informe se o consentimento foi concedido (true) ou revogado (false)")
    cliente_id = lead_id = None
    if dados.get("cliente_id"):
        cliente_id = cliente_acessivel(ator, dados["cliente_id"]).id
    elif dados.get("lead_id"):
        lead_id = _obter(CrmLead, ator, dados["lead_id"], "Lead").id
    else:
        raise CrmErro("Informe o cliente ou o lead")
    evidencia = _texto(dados.get("evidencia"), "Evidência", 255)
    if dados["concedido"] and not evidencia and origem in ("verbal", "balcao"):
        raise CrmErro("Consentimento verbal ou de balcão exige a evidência (quem ouviu, quando, como)")
    registro = CrmConsentimento(
        estabelecimento_id=ator.estabelecimento_id, cliente_id=cliente_id, lead_id=lead_id, canal=canal,
        finalidade=finalidade, concedido=dados["concedido"], origem=origem, evidencia=evidencia,
        registrado_por_id=ator.id)
    db.session.add(registro)
    db.session.flush()
    return registro


def consentimento_dict(r):
    return {"id": r.id, "cliente_id": r.cliente_id, "lead_id": r.lead_id, "canal": r.canal,
            "finalidade": r.finalidade, "concedido": r.concedido, "origem": r.origem, "evidencia": r.evidencia,
            "registrado_por_id": r.registrado_por_id, "registrado_em": iso_local(r.registrado_em)}


def consentimento_do_cliente(ator, cliente_id):
    cliente = cliente_acessivel(ator, cliente_id)
    historico = CrmConsentimento.query.filter_by(estabelecimento_id=ator.estabelecimento_id, cliente_id=cliente.id) \
        .order_by(CrmConsentimento.id.desc()).all()
    vigentes = _consentimentos_vigentes(ator, cliente_id=cliente.id)
    return {
        "vigente": [{"canal": c, "finalidade": f, "concedido": r.concedido, "desde": iso_local(r.registrado_em)}
                    for (c, f), r in sorted(vigentes.items())],
        "historico": [consentimento_dict(r) for r in historico],
    }


def clientes_com_consentimento(estabelecimento_id, cliente_ids, canal, finalidade="marketing"):
    """IDs cujo registro mais recente para canal/finalidade é concedido. Sem registro = sem consentimento."""
    if not cliente_ids:
        return set()
    ultimo = db.session.query(CrmConsentimento.cliente_id, func.max(CrmConsentimento.id).label("ultimo")).filter(
        CrmConsentimento.estabelecimento_id == estabelecimento_id, CrmConsentimento.canal == canal,
        CrmConsentimento.finalidade == finalidade, CrmConsentimento.cliente_id.in_(list(cliente_ids)),
    ).group_by(CrmConsentimento.cliente_id).subquery()
    linhas = db.session.query(CrmConsentimento.cliente_id).join(ultimo, CrmConsentimento.id == ultimo.c.ultimo) \
        .filter(CrmConsentimento.concedido.is_(True)).all()
    return {linha[0] for linha in linhas}


# ───────────────────────────── campanhas ─────────────────────────────

FILTROS_CAMPANHA = ("vendedor_id", "rota_id", "tipo_pessoa", "cidade", "estado", "sem_compra_dias",
                    "comprou_ultimos_dias", "valor_minimo_gasto", "excluir_inadimplentes")


def _normalizar_filtros(filtros):
    filtros = dict(filtros or {})
    desconhecidos = set(filtros) - set(FILTROS_CAMPANHA)
    if desconhecidos:
        raise CrmErro(f"Filtro desconhecido: {', '.join(sorted(desconhecidos))}")
    for chave in ("sem_compra_dias", "comprou_ultimos_dias"):
        if filtros.get(chave) not in (None, ""):
            filtros[chave] = _inteiro(filtros[chave], chave, 1, 3650)
    if filtros.get("valor_minimo_gasto") not in (None, ""):
        filtros["valor_minimo_gasto"] = str(_dinheiro(filtros["valor_minimo_gasto"], "Valor mínimo gasto"))
    if filtros.get("tipo_pessoa") not in (None, "", "PF", "PJ"):
        raise CrmErro("Tipo de pessoa inválido")
    return {k: v for k, v in filtros.items() if v not in (None, "")}


def _publico(estabelecimento_id, filtros):
    consulta = Cliente.query.filter(Cliente.estabelecimento_id == estabelecimento_id, Cliente.ativo.is_(True))
    if filtros.get("vendedor_id"):
        consulta = consulta.filter(Cliente.vendedor_id == int(filtros["vendedor_id"]))
    if filtros.get("rota_id"):
        consulta = consulta.filter(Cliente.rota_id == int(filtros["rota_id"]))
    if filtros.get("tipo_pessoa"):
        consulta = consulta.filter(Cliente.tipo_pessoa == filtros["tipo_pessoa"])
    if filtros.get("cidade"):
        consulta = consulta.filter(func.lower(Cliente.cidade) == str(filtros["cidade"]).strip().lower())
    if filtros.get("estado"):
        consulta = consulta.filter(Cliente.estado == str(filtros["estado"]).strip().upper())
    agora = _agora()
    if filtros.get("sem_compra_dias"):
        limite = agora - timedelta(days=filtros["sem_compra_dias"])
        consulta = consulta.filter(or_(Cliente.ultima_compra.is_(None), Cliente.ultima_compra < limite))
    if filtros.get("comprou_ultimos_dias"):
        consulta = consulta.filter(Cliente.ultima_compra >= agora - timedelta(days=filtros["comprou_ultimos_dias"]))
    if filtros.get("valor_minimo_gasto"):
        consulta = consulta.filter(Cliente.valor_total_gasto >= Decimal(filtros["valor_minimo_gasto"]))
    if filtros.get("excluir_inadimplentes"):
        vencidos = db.session.query(ContaReceber.cliente_id).filter(
            ContaReceber.estabelecimento_id == estabelecimento_id, ContaReceber.status == "aberto",
            ContaReceber.valor_atual > 0, ContaReceber.data_vencimento < hoje_local())
        consulta = consulta.filter(~Cliente.id.in_(vencidos))
    return consulta.order_by(Cliente.id).all()


def _destino(cliente, canal):
    if canal == "email":
        return (cliente.email or "").strip() or None
    numero = normalizar_documento(cliente.celular or cliente.telefone or "")
    return numero if len(numero) >= 10 else None


def previa_campanha(ator, canal, filtros, finalidade="marketing"):
    if canal not in CANAIS:
        raise CrmErro("Canal inválido")
    filtros = _normalizar_filtros(filtros)
    publico = _publico(ator.estabelecimento_id, filtros)
    consentidos = clientes_com_consentimento(ator.estabelecimento_id, [c.id for c in publico], canal, finalidade)
    aptos, sem_destino = [], 0
    for cliente in publico:
        if cliente.id not in consentidos:
            continue
        destino = _destino(cliente, canal)
        if not destino:
            sem_destino += 1
            continue
        aptos.append((cliente, destino))
    return {
        "filtros": filtros, "publico_filtrado": len(publico),
        "sem_consentimento": len(publico) - len(consentidos), "sem_destino": sem_destino,
        "aptos": len(aptos), "amostra": [{"cliente_id": c.id, "nome": c.nome, "destino": d} for c, d in aptos[:20]],
    }, aptos


def campanha_dict(c, com_resultado=False):
    dados = {"id": c.id, "nome": c.nome, "canal": c.canal, "mensagem": c.mensagem, "filtros": c.filtros or {},
             "janela_conversao_dias": c.janela_conversao_dias, "status": c.status, "created_at": iso_local(c.created_at),
             "iniciada_em": iso_local(c.iniciada_em), "encerrada_em": iso_local(c.encerrada_em)}
    if com_resultado:
        dados["resultado"] = resultado_campanha(c)
    return dados


def criar_campanha(ator, dados):
    canal = dados.get("canal") or "whatsapp"
    if canal not in CANAIS:
        raise CrmErro("Canal inválido")
    campanha = CrmCampanha(
        estabelecimento_id=ator.estabelecimento_id, nome=_texto(dados.get("nome"), "Nome", 150, True), canal=canal,
        mensagem=_texto(dados.get("mensagem"), "Mensagem", 2000, True), filtros=_normalizar_filtros(dados.get("filtros")),
        janela_conversao_dias=_inteiro(dados.get("janela_conversao_dias", 7), "Janela de conversão", 1, 90),
        status="rascunho", criado_por_id=ator.id)
    db.session.add(campanha)
    db.session.flush()
    return campanha


def obter_campanha(ator, campanha_id, travar=False):
    consulta = CrmCampanha.query.filter_by(id=int(campanha_id), estabelecimento_id=ator.estabelecimento_id)
    if travar:
        consulta = consulta.populate_existing().with_for_update()
    campanha = consulta.first()
    if not campanha:
        raise NaoEncontrado("Campanha não encontrada")
    return campanha


def atualizar_campanha(ator, campanha_id, dados):
    campanha = obter_campanha(ator, campanha_id, travar=True)
    if campanha.status != "rascunho":
        raise Conflito("Só o rascunho pode ser editado; o público de uma campanha ativa está congelado")
    if "nome" in dados:
        campanha.nome = _texto(dados["nome"], "Nome", 150, True)
    if "mensagem" in dados:
        campanha.mensagem = _texto(dados["mensagem"], "Mensagem", 2000, True)
    if "canal" in dados:
        if dados["canal"] not in CANAIS:
            raise CrmErro("Canal inválido")
        campanha.canal = dados["canal"]
    if "filtros" in dados:
        campanha.filtros = _normalizar_filtros(dados["filtros"])
    if "janela_conversao_dias" in dados:
        campanha.janela_conversao_dias = _inteiro(dados["janela_conversao_dias"], "Janela de conversão", 1, 90)
    return campanha


def iniciar_campanha(ator, campanha_id):
    """Congela o público: só entra quem tem consentimento vigente no canal e um destino válido."""
    campanha = obter_campanha(ator, campanha_id, travar=True)
    if campanha.status != "rascunho":
        raise Conflito("Campanha já iniciada")
    _, aptos = previa_campanha(ator, campanha.canal, campanha.filtros or {})
    if not aptos:
        raise CrmErro("Nenhum cliente apto: sem consentimento no canal ou sem contato válido")
    for cliente, destino in aptos:
        db.session.add(CrmCampanhaEnvio(estabelecimento_id=ator.estabelecimento_id, campanha_id=campanha.id,
                                        cliente_id=cliente.id, destino=destino, status="pendente"))
    campanha.status, campanha.iniciada_em = "ativa", _agora()
    return campanha, len(aptos)


def mensagem_para(campanha, cliente):
    primeiro_nome = (cliente.contato_nome or cliente.nome or "").split(" ")[0]
    return campanha.mensagem.replace("{nome}", primeiro_nome).replace("{empresa}", cliente.nome or "")


def envio_dict(envio, campanha):
    dados = {"id": envio.id, "cliente_id": envio.cliente_id, "cliente_nome": envio.cliente.nome if envio.cliente else None,
             "destino": envio.destino, "status": envio.status, "enviado_em": iso_local(envio.enviado_em),
             "respondido_em": iso_local(envio.respondido_em), "observacao": envio.observacao}
    if campanha.canal == "whatsapp" and envio.cliente:
        numero = envio.destino if envio.destino.startswith("55") else "55" + envio.destino
        dados["link"] = f"https://wa.me/{numero}?text={quote(mensagem_para(campanha, envio.cliente))}"
    return dados


def registrar_envio(ator, campanha_id, envio_id, status, observacao=None):
    campanha = obter_campanha(ator, campanha_id)
    if campanha.status != "ativa":
        raise Conflito("Campanha não está ativa")
    if status not in STATUS_ENVIO:
        raise CrmErro("Situação de envio inválida")
    envio = CrmCampanhaEnvio.query.filter_by(id=int(envio_id), campanha_id=campanha.id,
                                             estabelecimento_id=ator.estabelecimento_id).populate_existing().with_for_update().first()
    if not envio:
        raise NaoEncontrado("Envio não encontrado")
    agora = _agora()
    if status == "enviado":
        # O consentimento pode ter sido revogado depois de a campanha congelar o público.
        if envio.cliente_id not in clientes_com_consentimento(ator.estabelecimento_id, [envio.cliente_id], campanha.canal):
            envio.status, envio.observacao = "falhou", "Consentimento revogado antes do envio"
            raise Conflito("Cliente revogou o consentimento; envio bloqueado")
        if envio.status not in ("pendente", "falhou"):
            raise Conflito("Envio já registrado")
        envio.enviado_em = agora
    elif status == "respondido":
        if not envio.enviado_em:
            raise Conflito("Registre o envio antes da resposta")
        envio.respondido_em = agora
    elif status == "descadastrado":
        db.session.add(CrmConsentimento(
            estabelecimento_id=ator.estabelecimento_id, cliente_id=envio.cliente_id, canal=campanha.canal,
            finalidade="marketing", concedido=False, origem="campanha",
            evidencia=f"Pediu para sair na campanha #{campanha.id}", registrado_por_id=ator.id))
    envio.status = status
    envio.registrado_por_id = ator.id
    envio.observacao = _texto(observacao, "Observação", 255) or envio.observacao
    return envio


def encerrar_campanha(ator, campanha_id):
    campanha = obter_campanha(ator, campanha_id, travar=True)
    if campanha.status != "ativa":
        raise Conflito("Só campanha ativa pode ser encerrada")
    campanha.status, campanha.encerrada_em = "encerrada", _agora()
    return campanha


def resultado_campanha(campanha):
    """Atribuição por janela: venda do cliente entre o envio e o fim da janela. Não é prova de causa."""
    envios = CrmCampanhaEnvio.query.filter_by(campanha_id=campanha.id, estabelecimento_id=campanha.estabelecimento_id).all()
    por_status = {}
    for envio in envios:
        por_status[envio.status] = por_status.get(envio.status, 0) + 1
    alcancados = [e for e in envios if e.enviado_em]
    convertidos, receita = 0, Decimal("0")
    for envio in alcancados:
        fim = envio.enviado_em + timedelta(days=campanha.janela_conversao_dias)
        total = db.session.query(func.coalesce(func.sum(Venda.total), 0)).filter(
            Venda.estabelecimento_id == campanha.estabelecimento_id, Venda.cliente_id == envio.cliente_id,
            Venda.status != "cancelada", Venda.deleted_at.is_(None),
            Venda.data_venda >= envio.enviado_em, Venda.data_venda <= fim).scalar()
        total = Decimal(str(total or 0))
        if total > 0:
            convertidos += 1
            receita += total
    return {
        "publico": len(envios), "por_status": por_status, "enviados": len(alcancados),
        "respondidos": por_status.get("respondido", 0), "descadastrados": por_status.get("descadastrado", 0),
        "convertidos": convertidos, "receita_atribuida": _dec(receita),
        "taxa_conversao": round(convertidos * 100 / len(alcancados), 1) if alcancados else None,
        "criterio": f"venda do cliente até {campanha.janela_conversao_dias} dia(s) após o envio",
    }


# ───────────────────────────── comissão ─────────────────────────────

def _competencia(texto):
    try:
        ano, mes = (int(p) for p in str(texto).split("-"))
        inicio = datetime(ano, mes, 1).date()
    except (TypeError, ValueError):
        raise CrmErro("Competência inválida (use AAAA-MM)") from None
    proximo = (inicio.replace(day=28) + timedelta(days=4)).replace(day=1)
    return inicio, proximo - timedelta(days=1)


def percentual_vendedor(estabelecimento_id, vendedor):
    regra = CrmRegraComissao.query.filter_by(estabelecimento_id=estabelecimento_id, vendedor_id=vendedor.id,
                                             ativo=True).first()
    if regra:
        return Decimal(str(regra.percentual)), "propria"
    from app.decorators.rbac import nivel_do_role
    if nivel_do_role(vendedor.role) == 5:
        padrao = CrmRegraComissao.query.filter(CrmRegraComissao.estabelecimento_id == estabelecimento_id,
                                               CrmRegraComissao.vendedor_id.is_(None),
                                               CrmRegraComissao.ativo.is_(True)).first()
        if padrao:
            return Decimal(str(padrao.percentual)), "padrao"
    return None, None


def definir_regra(ator, dados):
    percentual = _dinheiro(dados.get("percentual"), "Percentual")
    if percentual > 100:
        raise CrmErro("Percentual acima de 100%")
    vendedor_id = dados.get("vendedor_id")
    if vendedor_id not in (None, ""):
        vendedor_id = _funcionario_da_loja(ator, vendedor_id, "Vendedor").id
    else:
        vendedor_id = None
    consulta = CrmRegraComissao.query.filter(CrmRegraComissao.estabelecimento_id == ator.estabelecimento_id)
    consulta = consulta.filter(CrmRegraComissao.vendedor_id == vendedor_id) if vendedor_id else \
        consulta.filter(CrmRegraComissao.vendedor_id.is_(None))
    regra = consulta.populate_existing().with_for_update().first()
    if regra is None:
        regra = CrmRegraComissao(estabelecimento_id=ator.estabelecimento_id, vendedor_id=vendedor_id, percentual=percentual)
        db.session.add(regra)
    regra.percentual = percentual
    regra.ativo = bool(dados.get("ativo", True))
    db.session.flush()
    return regra


def _vendedor_expr():
    """Quem vendeu: o vendedor do pedido B2B quando a venda é expedição; senão quem registrou a venda."""
    return func.coalesce(PedidoVenda.vendedor_id, Venda.funcionario_id)


def _vendas_com_vendedor(estabelecimento_id):
    return db.session.query(Venda, _vendedor_expr().label("vendedor_id")) \
        .outerjoin(PedidoVendaExpedicao, PedidoVendaExpedicao.venda_id == Venda.id) \
        .outerjoin(PedidoVenda, PedidoVenda.id == PedidoVendaExpedicao.pedido_id) \
        .filter(Venda.estabelecimento_id == estabelecimento_id, Venda.deleted_at.is_(None))


def eventos_comissao(estabelecimento_id, vendedor_id, inicio, fim):
    """Cada fato entra no mês em que acontece: venda (+), cancelamento (−) e devolução (−).

    Assim uma competência fechada nunca muda; o cancelamento de uma venda de setembro feito em
    outubro desconta em outubro.
    """
    ini_utc, fim_utc = local_date_to_utc_naive(inicio), local_date_to_utc_naive(fim, fim_do_dia=True)
    base = _vendas_com_vendedor(estabelecimento_id).filter(_vendedor_expr() == vendedor_id)
    eventos = []
    for venda, _ in base.filter(Venda.data_venda >= ini_utc, Venda.data_venda <= fim_utc,
                                Venda.status.in_(("finalizada", "cancelada"))).all():
        eventos.append({"tipo": "venda", "venda_id": venda.id, "codigo": venda.codigo,
                        "data": iso_local(venda.data_venda), "valor": Decimal(str(venda.total or 0))})
    for venda, _ in base.filter(Venda.status == "cancelada", Venda.data_cancelamento >= ini_utc,
                                Venda.data_cancelamento <= fim_utc).all():
        eventos.append({"tipo": "cancelamento", "venda_id": venda.id, "codigo": venda.codigo,
                        "data": iso_local(venda.data_cancelamento), "valor": -Decimal(str(venda.total or 0))})
    devolucoes = db.session.query(DevolucaoVenda, Venda) \
        .join(Venda, Venda.id == DevolucaoVenda.venda_id) \
        .outerjoin(PedidoVendaExpedicao, PedidoVendaExpedicao.venda_id == Venda.id) \
        .outerjoin(PedidoVenda, PedidoVenda.id == PedidoVendaExpedicao.pedido_id) \
        .filter(DevolucaoVenda.estabelecimento_id == estabelecimento_id, DevolucaoVenda.tipo == "devolucao",
                DevolucaoVenda.created_at >= ini_utc, DevolucaoVenda.created_at <= fim_utc,
                _vendedor_expr() == vendedor_id).all()
    for devolucao, venda in devolucoes:
        eventos.append({"tipo": "devolucao", "venda_id": venda.id, "codigo": venda.codigo,
                        "data": iso_local(devolucao.created_at), "valor": -Decimal(str(devolucao.valor_total or 0))})
    eventos.sort(key=lambda e: e["data"] or "")
    return eventos


def extrato_comissao(ator, vendedor_id, competencia):
    inicio, fim = _competencia(competencia)
    vendedor = _funcionario_da_loja(ator, vendedor_id, "Vendedor") if ator.gestor else \
        Funcionario.query.filter_by(id=ator.id, estabelecimento_id=ator.estabelecimento_id).first()
    if not ator.gestor and int(vendedor_id) != ator.id:
        raise AcessoNegado("Vendedor só consulta a própria comissão")
    fechamento = CrmComissaoFechamento.query.filter_by(estabelecimento_id=ator.estabelecimento_id,
                                                       vendedor_id=vendedor.id, competencia=competencia).first()
    if fechamento:
        return {"vendedor_id": vendedor.id, "vendedor_nome": vendedor.nome, "competencia": competencia,
                "fechada": True, "fechado_em": iso_local(fechamento.fechado_em),
                "base_vendas": _dec(fechamento.base_vendas), "base_cancelamentos": _dec(fechamento.base_cancelamentos),
                "base_devolucoes": _dec(fechamento.base_devolucoes), "base_liquida": _dec(fechamento.base_liquida),
                "percentual": _dec(fechamento.percentual), "valor_comissao": _dec(fechamento.valor_comissao),
                "eventos": fechamento.detalhes or [], "aviso": None}
    eventos = eventos_comissao(ator.estabelecimento_id, vendedor.id, inicio, fim)
    somas = {"venda": Decimal("0"), "cancelamento": Decimal("0"), "devolucao": Decimal("0")}
    for evento in eventos:
        somas[evento["tipo"]] += evento["valor"]
    liquida = somas["venda"] + somas["cancelamento"] + somas["devolucao"]
    percentual, origem = percentual_vendedor(ator.estabelecimento_id, vendedor)
    valor = (liquida * percentual / 100).quantize(CENT, rounding=ROUND_HALF_UP) if percentual is not None else Decimal("0")
    return {
        "vendedor_id": vendedor.id, "vendedor_nome": vendedor.nome, "competencia": competencia, "fechada": False,
        "base_vendas": _dec(somas["venda"]), "base_cancelamentos": _dec(somas["cancelamento"]),
        "base_devolucoes": _dec(somas["devolucao"]), "base_liquida": _dec(liquida),
        "percentual": _dec(percentual) if percentual is not None else None, "origem_percentual": origem,
        "valor_comissao": _dec(valor),
        "eventos": [{**e, "valor": _dec(e["valor"])} for e in eventos],
        "aviso": None if percentual is not None else "Sem regra de comissão para este funcionário",
    }


def fechar_comissao(ator, vendedor_id, competencia):
    inicio, fim = _competencia(competencia)
    if fim >= hoje_local().replace(day=1):
        raise CrmErro("Só é possível fechar competência encerrada")
    extrato = extrato_comissao(ator, vendedor_id, competencia)
    if extrato["fechada"]:
        raise Conflito("Competência já fechada")
    if extrato["percentual"] is None:
        raise CrmErro("Defina a regra de comissão antes de fechar")
    fechamento = CrmComissaoFechamento(
        estabelecimento_id=ator.estabelecimento_id, vendedor_id=extrato["vendedor_id"], competencia=competencia,
        base_vendas=Decimal(str(extrato["base_vendas"])), base_cancelamentos=Decimal(str(extrato["base_cancelamentos"])),
        base_devolucoes=Decimal(str(extrato["base_devolucoes"])), base_liquida=Decimal(str(extrato["base_liquida"])),
        percentual=Decimal(str(extrato["percentual"])), valor_comissao=Decimal(str(extrato["valor_comissao"])),
        detalhes=extrato["eventos"], fechado_por_id=ator.id)
    db.session.add(fechamento)
    db.session.flush()
    return fechamento


def resumo_comissoes(ator, competencia):
    """Todos os que venderam na competência ou têm regra própria."""
    inicio, fim = _competencia(competencia)
    ini_utc, fim_utc = local_date_to_utc_naive(inicio), local_date_to_utc_naive(fim, fim_do_dia=True)
    ids = {linha[0] for linha in db.session.query(_vendedor_expr()).select_from(Venda)
           .outerjoin(PedidoVendaExpedicao, PedidoVendaExpedicao.venda_id == Venda.id)
           .outerjoin(PedidoVenda, PedidoVenda.id == PedidoVendaExpedicao.pedido_id)
           .filter(Venda.estabelecimento_id == ator.estabelecimento_id,
                   or_(and_(Venda.data_venda >= ini_utc, Venda.data_venda <= fim_utc),
                       and_(Venda.data_cancelamento >= ini_utc, Venda.data_cancelamento <= fim_utc))).distinct().all()}
    ids |= {r.vendedor_id for r in CrmRegraComissao.query.filter(
        CrmRegraComissao.estabelecimento_id == ator.estabelecimento_id, CrmRegraComissao.vendedor_id.isnot(None)).all()}
    linhas = []
    for vendedor_id in sorted(i for i in ids if i):
        extrato = extrato_comissao(ator, vendedor_id, competencia)
        extrato.pop("eventos")
        linhas.append(extrato)
    return linhas


# ───────────────────────────── chamados (pós-venda) ─────────────────────────────

def _escopo_chamado(consulta, ator):
    consulta = consulta.filter(CrmChamado.estabelecimento_id == ator.estabelecimento_id)
    if ator.nivel == 5:
        carteira = db.session.query(Cliente.id).filter(Cliente.estabelecimento_id == ator.estabelecimento_id,
                                                       Cliente.vendedor_id == ator.id)
        consulta = consulta.filter(or_(CrmChamado.cliente_id.in_(carteira), CrmChamado.responsavel_id == ator.id))
    return consulta


def obter_chamado(ator, chamado_id, travar=False):
    consulta = _escopo_chamado(CrmChamado.query, ator).filter(CrmChamado.id == int(chamado_id))
    if travar:
        consulta = consulta.populate_existing().with_for_update()
    chamado = consulta.first()
    if not chamado:
        raise NaoEncontrado("Chamado não encontrado")
    return chamado


def chamado_dict(c):
    agora = _agora()
    encerrado = c.status in ("resolvido", "fechado")
    referencia = c.resolvido_em or agora
    return {
        "id": c.id, "numero": c.numero, "cliente_id": c.cliente_id, "cliente_nome": c.cliente.nome if c.cliente else None,
        "venda_id": c.venda_id, "tipo": c.tipo, "prioridade": c.prioridade, "status": c.status, "assunto": c.assunto,
        "descricao": c.descricao, "responsavel_id": c.responsavel_id, "sla_vencimento": iso_local(c.sla_vencimento),
        "sla_estourado": referencia > c.sla_vencimento, "atrasado": not encerrado and agora > c.sla_vencimento,
        "primeira_resposta_em": iso_local(c.primeira_resposta_em), "resolvido_em": iso_local(c.resolvido_em),
        "fechado_em": iso_local(c.fechado_em), "resolucao": c.resolucao, "created_at": iso_local(c.created_at),
    }


def abrir_chamado(ator, dados):
    cliente = cliente_acessivel(ator, dados.get("cliente_id"))
    venda_id = dados.get("venda_id")
    if venda_id:
        venda = Venda.query.filter_by(id=int(venda_id), estabelecimento_id=ator.estabelecimento_id).first()
        if not venda or venda.cliente_id != cliente.id:
            raise CrmErro("Venda não encontrada para este cliente")
    tipo, prioridade = dados.get("tipo") or "reclamacao", dados.get("prioridade") or "media"
    if tipo not in TIPOS_CHAMADO:
        raise CrmErro("Tipo de chamado inválido")
    if prioridade not in PRIORIDADES_SLA_HORAS:
        raise CrmErro("Prioridade inválida")
    responsavel_id = dados.get("responsavel_id")
    if responsavel_id not in (None, ""):
        responsavel_id = _funcionario_da_loja(ator, responsavel_id).id
    agora = _agora()
    chamado = CrmChamado(
        estabelecimento_id=ator.estabelecimento_id, numero=f"TMP-{ator.id}-{agora.timestamp()}"[:20],
        cliente_id=cliente.id, venda_id=int(venda_id) if venda_id else None, tipo=tipo, prioridade=prioridade,
        status="aberto", assunto=_texto(dados.get("assunto"), "Assunto", 150, True),
        descricao=_texto(dados.get("descricao"), "Descrição", 8000), responsavel_id=responsavel_id or None,
        aberto_por_id=ator.id, created_at=agora,
        sla_vencimento=agora + timedelta(hours=PRIORIDADES_SLA_HORAS[prioridade]))
    db.session.add(chamado)
    db.session.flush()
    chamado.numero = f"CH-{chamado.id:06d}"
    return chamado


def _marcar_primeira_resposta(chamado):
    if chamado and chamado.primeira_resposta_em is None:
        chamado.primeira_resposta_em = _agora()


def atualizar_chamado(ator, chamado_id, dados):
    chamado = obter_chamado(ator, chamado_id, travar=True)
    if chamado.status == "fechado":
        raise Conflito("Chamado fechado")
    if "responsavel_id" in dados:
        chamado.responsavel_id = _funcionario_da_loja(ator, dados["responsavel_id"]).id if dados["responsavel_id"] else None
    if "prioridade" in dados and dados["prioridade"] != chamado.prioridade:
        if dados["prioridade"] not in PRIORIDADES_SLA_HORAS:
            raise CrmErro("Prioridade inválida")
        chamado.prioridade = dados["prioridade"]
        chamado.sla_vencimento = chamado.created_at + timedelta(hours=PRIORIDADES_SLA_HORAS[chamado.prioridade])
    novo = dados.get("status")
    if novo and novo != chamado.status:
        if novo not in TRANSICOES_CHAMADO[chamado.status]:
            raise Conflito(f"Não é possível ir de {chamado.status} para {novo}")
        agora = _agora()
        _marcar_primeira_resposta(chamado)
        if novo == "resolvido":
            chamado.resolucao = _texto(dados.get("resolucao"), "Resolução", 8000, True)
            chamado.resolvido_em = agora
        elif novo == "fechado":
            chamado.fechado_em = agora
        elif chamado.status == "resolvido":  # reabertura
            chamado.resolvido_em = None
        chamado.status = novo
    return chamado


def listar_chamados(ator, filtros):
    consulta = _escopo_chamado(CrmChamado.query, ator)
    if filtros.get("status"):
        consulta = consulta.filter(CrmChamado.status == filtros["status"])
    if filtros.get("abertos"):
        consulta = consulta.filter(CrmChamado.status.notin_(("resolvido", "fechado")))
    if filtros.get("atrasados"):
        consulta = consulta.filter(CrmChamado.status.notin_(("resolvido", "fechado")), CrmChamado.sla_vencimento < _agora())
    if filtros.get("cliente_id"):
        consulta = consulta.filter(CrmChamado.cliente_id == int(filtros["cliente_id"]))
    return consulta.order_by(CrmChamado.created_at.desc()).limit(500).all()


def painel_chamados(ator, inicio, fim):
    base = _escopo_chamado(CrmChamado.query, ator)
    agora = _agora()
    abertos = base.filter(CrmChamado.status.notin_(("resolvido", "fechado"))).all()
    ini_utc, fim_utc = local_date_to_utc_naive(inicio), local_date_to_utc_naive(fim, fim_do_dia=True)
    resolvidos = base.filter(CrmChamado.resolvido_em >= ini_utc, CrmChamado.resolvido_em <= fim_utc).all()
    horas = [(c.resolvido_em - c.created_at).total_seconds() / 3600 for c in resolvidos]
    no_prazo = sum(1 for c in resolvidos if c.resolvido_em <= c.sla_vencimento)
    por_tipo = {}
    for c in base.filter(CrmChamado.created_at >= ini_utc, CrmChamado.created_at <= fim_utc).all():
        por_tipo[c.tipo] = por_tipo.get(c.tipo, 0) + 1
    return {
        "abertos": len(abertos), "atrasados": sum(1 for c in abertos if agora > c.sla_vencimento),
        "resolvidos_periodo": len(resolvidos),
        "tempo_medio_resolucao_horas": round(sum(horas) / len(horas), 1) if horas else None,
        "sla_cumprido_percentual": round(no_prazo * 100 / len(resolvidos), 1) if resolvidos else None,
        "abertos_por_tipo_no_periodo": por_tipo,
    }
