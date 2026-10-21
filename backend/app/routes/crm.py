"""Rotas do CRM comercial e do pós-venda (/api/crm).

A regra de negócio fica em ``crm_service`` e ``devolucao_service``; aqui só autenticação, papel,
transação e serialização. Toda rota exige loja concreta (o espelho global do super admin não serve).
"""
from datetime import timedelta
from functools import wraps

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import IntegrityError

from app.decorators.rbac import _check_resource, _enforce_impersonation_readonly, _get_nivel
from app.models import (Cliente, ContaReceber, CrmAtividade, CrmCampanha, CrmCampanhaEnvio, CrmChamado,
                        CrmOportunidade, CrmRegraComissao, DevolucaoVenda, Funcionario, Venda, db)
from app.services import crm_service as crm
from app.services import devolucao_service as devolucoes
from app.utils.timezone import hoje_local, iso_local

crm_bp = Blueprint("crm", __name__)


def acesso(recurso):
    def decorador(f):
        @wraps(f)
        @jwt_required()
        def interno(*args, **kwargs):
            from app.utils.auth_utils import is_user_active, normalize_status
            try:
                usuario = Funcionario.query.get(int(get_jwt_identity()))
            except (TypeError, ValueError):
                usuario = None
            if not usuario or not usuario.ativo or usuario.deleted_at is not None \
                    or not is_user_active(normalize_status(getattr(usuario, "status", "ativo"))):
                return jsonify({"success": False, "error": "Usuário inativo ou inexistente"}), 401
            if not _check_resource(usuario, recurso):
                return jsonify({"success": False, "error": "Seu cargo não tem acesso a esta função"}), 403
            bloqueio = _enforce_impersonation_readonly(usuario)
            if bloqueio:
                return bloqueio
            loja = getattr(g, "estabelecimento_id", None)
            if loja is None or str(loja).lower() == "all":
                return jsonify({"success": False, "error": "Selecione uma loja"}), 400
            nivel = _get_nivel(usuario)
            if nivel != 0 and int(loja) != usuario.estabelecimento_id:
                return jsonify({"success": False, "error": "Acesso negado a esta loja"}), 403
            g.crm_ator = crm.Ator(id=usuario.id, estabelecimento_id=int(loja), nivel=nivel)
            try:
                resposta = f(*args, **kwargs)
                if request.method != "GET":
                    db.session.commit()
                return resposta
            except crm.CrmErro as erro:
                db.session.rollback()
                return jsonify({"success": False, "error": str(erro)}), erro.status
            except IntegrityError:
                db.session.rollback()
                return jsonify({"success": False, "error": "Registro em conflito com outro já existente"}), 409
            except ValueError as erro:
                db.session.rollback()
                return jsonify({"success": False, "error": str(erro)}), 400
        return interno
    return decorador


def _ator():
    return g.crm_ator


def _corpo():
    dados = request.get_json(silent=True)
    if not isinstance(dados, dict):
        raise crm.CrmErro("Corpo JSON inválido")
    return dados


def _ok(data, status=200, **extra):
    return jsonify({"success": True, "data": data, **extra}), status


def _periodo():
    hoje = hoje_local()
    inicio = request.args.get("inicio") or hoje.replace(day=1).isoformat()
    fim = request.args.get("fim") or hoje.isoformat()
    return crm._data(inicio, "Início"), crm._data(fim, "Fim")


# ───────────────────────── apoio ─────────────────────────

@crm_bp.route("/responsaveis", methods=["GET"])
@acesso("crm")
def responsaveis():
    ator = _ator()
    consulta = Funcionario.query.filter(Funcionario.estabelecimento_id == ator.estabelecimento_id,
                                        Funcionario.ativo.is_(True))
    if not ator.gestor:
        consulta = consulta.filter(Funcionario.id == ator.id)
    return _ok([{"id": f.id, "nome": f.nome, "role": f.role} for f in consulta.order_by(Funcionario.nome).all()])


@crm_bp.route("/clientes/<int:cliente_id>/resumo", methods=["GET"])
@acesso("pos_venda")
def cliente_360(cliente_id):
    """Visão do cliente para o atendimento: negócios, follow-up, chamados, títulos, consentimento."""
    ator = _ator()
    cliente = crm.cliente_acessivel(ator, cliente_id)
    oportunidades = CrmOportunidade.query.filter_by(estabelecimento_id=ator.estabelecimento_id, cliente_id=cliente.id) \
        .order_by(CrmOportunidade.created_at.desc()).limit(50).all() if ator.nivel != 4 else []
    atividades = CrmAtividade.query.filter_by(estabelecimento_id=ator.estabelecimento_id, cliente_id=cliente.id) \
        .order_by(CrmAtividade.created_at.desc()).limit(50).all()
    chamados = CrmChamado.query.filter_by(estabelecimento_id=ator.estabelecimento_id, cliente_id=cliente.id) \
        .order_by(CrmChamado.created_at.desc()).limit(50).all()
    vendas = Venda.query.filter_by(estabelecimento_id=ator.estabelecimento_id, cliente_id=cliente.id) \
        .order_by(Venda.data_venda.desc()).limit(20).all()
    titulos = ContaReceber.query.filter(ContaReceber.estabelecimento_id == ator.estabelecimento_id,
                                        ContaReceber.cliente_id == cliente.id, ContaReceber.status == "aberto",
                                        ContaReceber.valor_atual > 0).order_by(ContaReceber.data_vencimento).all()
    hoje = hoje_local()
    return _ok({
        "cliente": {"id": cliente.id, "nome": cliente.nome, "documento": cliente.documento,
                    "tipo_pessoa": cliente.tipo_pessoa, "celular": cliente.celular, "email": cliente.email,
                    "vendedor_id": cliente.vendedor_id, "limite_credito": float(cliente.limite_credito or 0),
                    "saldo_devedor": float(cliente.saldo_devedor or 0), "ultima_compra": iso_local(cliente.ultima_compra)},
        "oportunidades": [crm.oportunidade_dict(o) for o in oportunidades],
        "atividades": [crm.atividade_dict(a) for a in atividades],
        "chamados": [crm.chamado_dict(c) for c in chamados],
        "vendas": [{"id": v.id, "codigo": v.codigo, "data": iso_local(v.data_venda), "total": float(v.total or 0),
                    "status": v.status} for v in vendas],
        "titulos_abertos": [{"id": t.id, "documento": t.numero_documento, "vencimento": t.data_vencimento.isoformat(),
                             "valor": float(t.valor_atual), "vencido": t.data_vencimento < hoje} for t in titulos],
        "consentimento": crm.consentimento_do_cliente(ator, cliente.id),
    })


# ───────────────────────── leads ─────────────────────────

@crm_bp.route("/leads", methods=["GET"])
@acesso("crm")
def leads_listar():
    return _ok([crm.lead_dict(l) for l in crm.listar_leads(_ator(), request.args)])


@crm_bp.route("/leads", methods=["POST"])
@acesso("crm")
def leads_criar():
    lead = crm.criar_lead(_ator(), _corpo())
    return _ok(crm.lead_dict(lead), 201)


@crm_bp.route("/leads/<int:lead_id>", methods=["PATCH"])
@acesso("crm")
def leads_atualizar(lead_id):
    return _ok(crm.lead_dict(crm.atualizar_lead(_ator(), lead_id, _corpo())))


@crm_bp.route("/leads/<int:lead_id>/converter", methods=["POST"])
@acesso("crm")
def leads_converter(lead_id):
    lead, cliente = crm.converter_lead(_ator(), lead_id, _corpo().get("cliente_id"))
    return _ok({"lead": crm.lead_dict(lead), "cliente_id": cliente.id})


# ───────────────────────── oportunidades ─────────────────────────

@crm_bp.route("/oportunidades", methods=["GET"])
@acesso("crm")
def oportunidades_listar():
    return _ok([crm.oportunidade_dict(o) for o in crm.listar_oportunidades(_ator(), request.args)])


@crm_bp.route("/oportunidades", methods=["POST"])
@acesso("crm")
def oportunidades_criar():
    return _ok(crm.oportunidade_dict(crm.criar_oportunidade(_ator(), _corpo())), 201)


@crm_bp.route("/oportunidades/<int:op_id>", methods=["PATCH"])
@acesso("crm")
def oportunidades_atualizar(op_id):
    return _ok(crm.oportunidade_dict(crm.atualizar_oportunidade(_ator(), op_id, _corpo())))


@crm_bp.route("/funil", methods=["GET"])
@acesso("crm")
def funil():
    inicio, fim = _periodo()
    return _ok(crm.funil(_ator(), inicio, fim, request.args.get("responsavel_id")))


# ───────────────────────── atividades ─────────────────────────

@crm_bp.route("/atividades", methods=["GET"])
@acesso("pos_venda")
def atividades_listar():
    return _ok([crm.atividade_dict(a) for a in crm.listar_atividades(_ator(), request.args)],
               resumo=crm.resumo_atividades(_ator()))


@crm_bp.route("/atividades", methods=["POST"])
@acesso("pos_venda")
def atividades_criar():
    return _ok(crm.atividade_dict(crm.criar_atividade(_ator(), _corpo())), 201)


@crm_bp.route("/atividades/<int:atividade_id>/concluir", methods=["POST"])
@acesso("pos_venda")
def atividades_concluir(atividade_id):
    atividade, proxima = crm.concluir_atividade(_ator(), atividade_id, _corpo())
    return _ok({"atividade": crm.atividade_dict(atividade),
                "proxima": crm.atividade_dict(proxima) if proxima else None})


# ───────────────────────── consentimento ─────────────────────────

@crm_bp.route("/consentimentos", methods=["POST"])
@acesso("consentimento")
def consentimentos_registrar():
    return _ok(crm.consentimento_dict(crm.registrar_consentimento(_ator(), _corpo())), 201)


@crm_bp.route("/clientes/<int:cliente_id>/consentimentos", methods=["GET"])
@acesso("consentimento")
def consentimentos_cliente(cliente_id):
    return _ok(crm.consentimento_do_cliente(_ator(), cliente_id))


# ───────────────────────── campanhas ─────────────────────────

@crm_bp.route("/campanhas", methods=["GET"])
@acesso("crm_gestao")
def campanhas_listar():
    lista = CrmCampanha.query.filter_by(estabelecimento_id=_ator().estabelecimento_id) \
        .order_by(CrmCampanha.created_at.desc()).limit(200).all()
    return _ok([crm.campanha_dict(c) for c in lista])


@crm_bp.route("/campanhas/previa", methods=["POST"])
@acesso("crm_gestao")
def campanhas_previa():
    dados = _corpo()
    previa, _ = crm.previa_campanha(_ator(), dados.get("canal") or "whatsapp", dados.get("filtros"))
    return _ok(previa)


@crm_bp.route("/campanhas", methods=["POST"])
@acesso("crm_gestao")
def campanhas_criar():
    return _ok(crm.campanha_dict(crm.criar_campanha(_ator(), _corpo())), 201)


@crm_bp.route("/campanhas/<int:campanha_id>", methods=["GET"])
@acesso("crm_gestao")
def campanhas_detalhe(campanha_id):
    campanha = crm.obter_campanha(_ator(), campanha_id)
    envios = CrmCampanhaEnvio.query.filter_by(campanha_id=campanha.id, estabelecimento_id=campanha.estabelecimento_id) \
        .order_by(CrmCampanhaEnvio.id).all()
    return _ok({**crm.campanha_dict(campanha, com_resultado=True), "envios": [crm.envio_dict(e, campanha) for e in envios]})


@crm_bp.route("/campanhas/<int:campanha_id>", methods=["PATCH"])
@acesso("crm_gestao")
def campanhas_atualizar(campanha_id):
    return _ok(crm.campanha_dict(crm.atualizar_campanha(_ator(), campanha_id, _corpo())))


@crm_bp.route("/campanhas/<int:campanha_id>/iniciar", methods=["POST"])
@acesso("crm_gestao")
def campanhas_iniciar(campanha_id):
    campanha, publico = crm.iniciar_campanha(_ator(), campanha_id)
    return _ok({**crm.campanha_dict(campanha), "publico": publico})


@crm_bp.route("/campanhas/<int:campanha_id>/envios/<int:envio_id>", methods=["POST"])
@acesso("crm_gestao")
def campanhas_envio(campanha_id, envio_id):
    dados = _corpo()
    try:
        envio = crm.registrar_envio(_ator(), campanha_id, envio_id, dados.get("status"), dados.get("observacao"))
    except crm.Conflito as erro:
        # Guarda o bloqueio por revogação de consentimento antes de responder o conflito.
        if "revogou" in str(erro):
            db.session.commit()
            return jsonify({"success": False, "error": str(erro)}), 409
        raise
    return _ok(crm.envio_dict(envio, envio.campanha))


@crm_bp.route("/campanhas/<int:campanha_id>/encerrar", methods=["POST"])
@acesso("crm_gestao")
def campanhas_encerrar(campanha_id):
    return _ok(crm.campanha_dict(crm.encerrar_campanha(_ator(), campanha_id), com_resultado=True))


# ───────────────────────── comissão ─────────────────────────

@crm_bp.route("/comissoes/regras", methods=["GET"])
@acesso("crm_gestao")
def comissoes_regras():
    regras = CrmRegraComissao.query.filter_by(estabelecimento_id=_ator().estabelecimento_id).all()
    nomes = {f.id: f.nome for f in Funcionario.query.filter_by(estabelecimento_id=_ator().estabelecimento_id).all()}
    return _ok([{"id": r.id, "vendedor_id": r.vendedor_id, "vendedor_nome": nomes.get(r.vendedor_id, "Padrão (vendedores)"),
                 "percentual": float(r.percentual), "ativo": r.ativo} for r in regras])


@crm_bp.route("/comissoes/regras", methods=["PUT"])
@acesso("crm_gestao")
def comissoes_definir_regra():
    regra = crm.definir_regra(_ator(), _corpo())
    return _ok({"id": regra.id, "vendedor_id": regra.vendedor_id, "percentual": float(regra.percentual),
                "ativo": regra.ativo})


def _competencia_padrao():
    return request.args.get("competencia") or hoje_local().strftime("%Y-%m")


@crm_bp.route("/comissoes/extrato", methods=["GET"])
@acesso("crm")
def comissoes_extrato():
    ator = _ator()
    return _ok(crm.extrato_comissao(ator, request.args.get("vendedor_id") or ator.id, _competencia_padrao()))


@crm_bp.route("/comissoes/resumo", methods=["GET"])
@acesso("crm_gestao")
def comissoes_resumo():
    return _ok(crm.resumo_comissoes(_ator(), _competencia_padrao()))


@crm_bp.route("/comissoes/fechar", methods=["POST"])
@acesso("crm_gestao")
def comissoes_fechar():
    dados = _corpo()
    fechamento = crm.fechar_comissao(_ator(), dados.get("vendedor_id"), dados.get("competencia"))
    return _ok({"id": fechamento.id, "competencia": fechamento.competencia,
                "valor_comissao": float(fechamento.valor_comissao)}, 201)


# ───────────────────────── chamados ─────────────────────────

@crm_bp.route("/chamados", methods=["GET"])
@acesso("pos_venda")
def chamados_listar():
    return _ok([crm.chamado_dict(c) for c in crm.listar_chamados(_ator(), request.args)])


@crm_bp.route("/chamados/painel", methods=["GET"])
@acesso("pos_venda")
def chamados_painel():
    inicio, fim = _periodo()
    return _ok(crm.painel_chamados(_ator(), inicio, fim))


@crm_bp.route("/chamados", methods=["POST"])
@acesso("pos_venda")
def chamados_abrir():
    return _ok(crm.chamado_dict(crm.abrir_chamado(_ator(), _corpo())), 201)


@crm_bp.route("/chamados/<int:chamado_id>", methods=["GET"])
@acesso("pos_venda")
def chamados_detalhe(chamado_id):
    ator = _ator()
    chamado = crm.obter_chamado(ator, chamado_id)
    atividades = CrmAtividade.query.filter_by(estabelecimento_id=ator.estabelecimento_id, chamado_id=chamado.id) \
        .order_by(CrmAtividade.created_at).all()
    devs = DevolucaoVenda.query.filter_by(estabelecimento_id=ator.estabelecimento_id, chamado_id=chamado.id).all()
    return _ok({**crm.chamado_dict(chamado), "atividades": [crm.atividade_dict(a) for a in atividades],
                "devolucoes": [devolucoes.devolucao_dict(d) for d in devs]})


@crm_bp.route("/chamados/<int:chamado_id>", methods=["PATCH"])
@acesso("pos_venda")
def chamados_atualizar(chamado_id):
    return _ok(crm.chamado_dict(crm.atualizar_chamado(_ator(), chamado_id, _corpo())))


# ───────────────────────── devoluções e trocas ─────────────────────────

def _venda_visivel(venda_id):
    ator = _ator()
    venda = Venda.query.filter_by(id=venda_id, estabelecimento_id=ator.estabelecimento_id).first()
    if not venda:
        raise crm.NaoEncontrado("Venda não encontrada")
    if ator.nivel == 5:
        if not venda.cliente_id:
            raise crm.AcessoNegado("Venda sem cliente identificado")
        crm.cliente_acessivel(ator, venda.cliente_id)
    return venda


@crm_bp.route("/vendas/<int:venda_id>/devolucao", methods=["GET"])
@acesso("pos_venda")
def devolucao_resumo(venda_id):
    venda = _venda_visivel(venda_id)
    resumo = devolucoes.resumo_devolucoes_venda(venda)
    resumo["devolucoes"] = [devolucoes.devolucao_dict(d) for d in
                            DevolucaoVenda.query.filter_by(venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id)
                            .order_by(DevolucaoVenda.id).all()]
    return _ok(resumo)


@crm_bp.route("/vendas/<int:venda_id>/devolucoes", methods=["POST"])
@acesso("devolucoes")
def devolucao_registrar(venda_id):
    devolucao, repetida = devolucoes.registrar_devolucao(_ator(), venda_id, _corpo())
    return _ok(devolucoes.devolucao_dict(devolucao), 200 if repetida else 201, repetida=repetida)


@crm_bp.route("/vendas/busca", methods=["GET"])
@acesso("pos_venda")
def vendas_busca():
    """Localiza a venda do cliente para abrir chamado ou devolver (código ou cliente)."""
    ator = _ator()
    consulta = Venda.query.filter(Venda.estabelecimento_id == ator.estabelecimento_id, Venda.status == "finalizada")
    if request.args.get("cliente_id"):
        cliente = crm.cliente_acessivel(ator, request.args["cliente_id"])
        consulta = consulta.filter(Venda.cliente_id == cliente.id)
    elif ator.nivel == 5:
        carteira = db.session.query(Cliente.id).filter(Cliente.estabelecimento_id == ator.estabelecimento_id,
                                                       Cliente.vendedor_id == ator.id)
        consulta = consulta.filter(Venda.cliente_id.in_(carteira))
    if request.args.get("codigo"):
        consulta = consulta.filter(Venda.codigo.ilike(f"%{request.args['codigo'].strip()}%"))
    vendas = consulta.order_by(Venda.data_venda.desc()).limit(30).all()
    return _ok([{"id": v.id, "codigo": v.codigo, "data": iso_local(v.data_venda), "total": float(v.total or 0),
                 "cliente_id": v.cliente_id, "cliente_nome": v.cliente.nome if v.cliente else None} for v in vendas])
