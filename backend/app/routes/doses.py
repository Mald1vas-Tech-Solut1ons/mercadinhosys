"""API da venda por dose: configuração das doses do produto, padrões da loja e aplicação em lote.

Leitura: qualquer funcionário da loja. Escrita: quem a política da loja libera para "Editar produto e preço"
(`produtos.editar`: padrão admin e gerente; o dono ajusta em Configurações → Permissões) nas doses do produto e na
aplicação em lote, porque preço e ml de dose são preço; gerente/admin nos padrões da loja. Toda consulta é filtrada pela loja do token; produto de outra loja
responde 404. A venda em si (baixa de ml) está em ``dose_service`` e nas rotas de venda.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from app import db
from app.decorators.decorator_jwt import funcionario_required, gerente_ou_admin_required
from app.models import Produto
from app.services import dose_service
from app.services import dose_config_service as cfg
from app.services.politica_acoes import acao_protegida
from app.services.dose_service import DoseError
from app.utils.query_helpers import get_authorized_establishment_id

doses_bp = Blueprint("doses", __name__)


def _estab():
    estab_id = get_authorized_establishment_id()
    if not estab_id or str(estab_id).lower() == "all":
        return None
    return int(estab_id)


def _func():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _sem_loja():
    return jsonify({"success": False, "error": "Escolha uma loja"}), 400


def _erro(erro, status=400):
    db.session.rollback()
    return jsonify({"success": False, "error": str(erro)}), status


def _produto(estab_id, produto_id):
    return Produto.query.filter_by(id=produto_id, estabelecimento_id=estab_id).filter(
        Produto.deleted_at.is_(None)).first()


# ── Doses de um produto ───────────────────────────────────────────────────

@doses_bp.route("/produto/<int:produto_id>", methods=["GET"])
@funcionario_required
def ler_doses_do_produto(produto_id):
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    produto = _produto(estab_id, produto_id)
    if not produto:
        return jsonify({"success": False, "error": "Produto não encontrado"}), 404
    return jsonify({"success": True, **cfg.doses_do_produto(produto)})


@doses_bp.route("/produto/<int:produto_id>", methods=["PUT"])
@funcionario_required
@acao_protegida("produtos.editar")
def salvar_doses_do_produto(produto_id):
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    produto = _produto(estab_id, produto_id)
    if not produto:
        return jsonify({"success": False, "error": "Produto não encontrado"}), 404
    try:
        resultado = cfg.salvar_doses_produto(produto, request.get_json(silent=True), _func())
        db.session.commit()
    except DoseError as erro:
        return _erro(erro)
    return jsonify({"success": True, **resultado})


# ── Padrões da loja ───────────────────────────────────────────────────────

@doses_bp.route("/config", methods=["GET"])
@funcionario_required
def ler_config():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    return jsonify({"success": True, **cfg.ler_config_loja(estab_id)})


@doses_bp.route("/config", methods=["PUT"])
@gerente_ou_admin_required
def salvar_config():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    dados = request.get_json(silent=True)
    if not isinstance(dados, dict):
        return _erro("Dados inválidos")
    try:
        resultado = cfg.salvar_config_loja(estab_id, dados)
        db.session.commit()
    except DoseError as erro:
        return _erro(erro)
    return jsonify({"success": True, **resultado})


# ── Garrafas abertas e fim de garrafa ─────────────────────────────────────

def _garrafa_dict(g):
    return {"id": g.id, "produto_id": g.produto_id, "saldo_ml": float(g.saldo_ml),
            "volume_inicial_ml": float(g.volume_inicial_ml), "status": g.status,
            "aberta_em": g.aberta_em.isoformat() if g.aberta_em else None,
            "validade_aberta": g.validade_aberta.isoformat() if g.validade_aberta else None}


@doses_bp.route("/garrafas-abertas", methods=["GET"])
@funcionario_required
def garrafas_abertas():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    produto_id = request.args.get("produto_id", type=int)
    return jsonify({"success": True, "garrafas": [
        _garrafa_dict(g) for g in dose_service.garrafas_abertas_da_loja(estab_id, produto_id)]})


@doses_bp.route("/garrafas/<int:garrafa_id>/encerrar", methods=["POST"])
@funcionario_required
@acao_protegida("doses.encerrar")
def encerrar_garrafa(garrafa_id):
    """'Terminou a garrafa': o ml que o razão ainda mostrava vira desvio. Devolve para onde foram os ml."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    try:
        garrafa, desvio = dose_service.encerrar_garrafa(garrafa_id, estab_id, funcionario_id=_func())
        resumo = dose_service.resumo_garrafa(garrafa)
        db.session.commit()
    except DoseError as erro:
        return _erro(erro, 404 if "não encontrada" in str(erro) else 400)
    return jsonify({"success": True, "garrafa": _garrafa_dict(garrafa), "desvio_ml": float(desvio), "resumo": resumo})


def _json():
    dados = request.get_json(silent=True)
    return dados if isinstance(dados, dict) else {}


@doses_bp.route("/garrafas/<int:garrafa_id>", methods=["GET"])
@funcionario_required
def detalhe_garrafa(garrafa_id):
    """Uma garrafa: para onde foram os ml (resumo) e o razão completo dela."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    from app.models_dose import GarrafaAberta
    garrafa = GarrafaAberta.query.filter_by(id=garrafa_id, estabelecimento_id=estab_id).first()
    if garrafa is None:
        return jsonify({"success": False, "error": "Garrafa não encontrada nesta loja"}), 404
    return jsonify({"success": True, "garrafa": _garrafa_dict(garrafa),
                    "resumo": dose_service.resumo_garrafa(garrafa),
                    "razao": dose_service.razao_de_ml(estab_id, garrafa_id=garrafa_id, limite=200),
                    "confere": dose_service.ledger_confere(garrafa)})


@doses_bp.route("/produto/<int:produto_id>/razao", methods=["GET"])
@funcionario_required
def razao_do_produto(produto_id):
    """Razão de ml do produto (venda, estorno, perda, cortesia, ajuste...), mais recente primeiro."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    if not _produto(estab_id, produto_id):
        return jsonify({"success": False, "error": "Produto não encontrado"}), 404
    garrafas = dose_service.garrafas_abertas_da_loja(estab_id, produto_id)
    return jsonify({
        "success": True,
        "razao": dose_service.razao_de_ml(estab_id, produto_id=produto_id, limite=request.args.get("limite", 100, type=int)),
        "garrafas_abertas": [_garrafa_dict(g) for g in garrafas],
        "resumo": dose_service.resumo_aberto(estab_id, [produto_id]).get(produto_id),
    })


@doses_bp.route("/produto/<int:produto_id>/baixa", methods=["POST"])
@funcionario_required
@acao_protegida("doses.baixa")
def baixar_ml(produto_id):
    """Perda/derramamento, cortesia ou degustação em ml. Sai da garrafa aberta (abre outra se faltar)."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    produto = _produto(estab_id, produto_id)
    if not produto:
        return jsonify({"success": False, "error": "Produto não encontrado"}), 404
    dados = _json()
    tipo = str(dados.get("tipo") or "").strip().lower()
    motivo = str(dados.get("motivo") or "").strip()
    if tipo == "perda" and not motivo:
        return _erro("Diga o que aconteceu (derramou, quebrou...): é o que explica a perda no relatório")
    try:
        movimentos, custo = dose_service.baixar_ml(produto, dados.get("ml"), tipo, funcionario_id=_func(), motivo=motivo or None)
        db.session.commit()
    except DoseError as erro:
        return _erro(erro, 409 if isinstance(erro, dose_service.DoseIndisponivelError) else 400)
    return jsonify({"success": True, "tipo": tipo, "ml": float(-sum(m.ml for m in movimentos)), "custo": float(custo),
                    "estado": dose_service.resumo_aberto(estab_id, [produto_id]).get(produto_id)})


@doses_bp.route("/garrafas/<int:garrafa_id>/ajuste", methods=["POST"])
@funcionario_required
@acao_protegida("doses.ajustar")
def ajustar_garrafa(garrafa_id):
    """Contagem física da garrafa aberta: grava a diferença contra o razão."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    dados = _json()
    try:
        garrafa, diferenca = dose_service.ajustar_saldo(
            garrafa_id, estab_id, dados.get("saldo_fisico_ml"), funcionario_id=_func(),
            motivo=str(dados.get("motivo") or "").strip() or None)
        resumo = dose_service.resumo_garrafa(garrafa)
        db.session.commit()
    except DoseError as erro:
        return _erro(erro, 404 if "não encontrada" in str(erro) else 400)
    return jsonify({"success": True, "garrafa": _garrafa_dict(garrafa), "diferenca_ml": float(diferenca), "resumo": resumo})


@doses_bp.route("/garrafas/<int:garrafa_id>/descartar", methods=["POST"])
@funcionario_required
@acao_protegida("doses.descartar")
def descartar_garrafa(garrafa_id):
    """Descarta a garrafa aberta (vencida depois de aberta, contaminada): o saldo vira perda registrada."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    motivo = str(_json().get("motivo") or "").strip()
    try:
        garrafa, perdido = dose_service.descartar_garrafa(garrafa_id, estab_id, funcionario_id=_func(), motivo=motivo or None)
        custo = float((perdido * garrafa.custo_por_ml).quantize(dose_service.Q4))
        resumo = dose_service.resumo_garrafa(garrafa)
        db.session.commit()
    except DoseError as erro:
        return _erro(erro, 404 if "não encontrada" in str(erro) else 400)
    return jsonify({"success": True, "garrafa": _garrafa_dict(garrafa), "perdido_ml": float(perdido), "custo": custo,
                    "resumo": resumo})


@doses_bp.route("/vencidas", methods=["GET"])
@funcionario_required
def garrafas_vencidas():
    """Garrafas abertas cuja validade depois de aberta passou: já não vendem e esperam o descarte."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    vencidas = dose_service.garrafas_vencidas(estab_id)
    nomes = {p.id: p.nome for p in Produto.query.filter(
        Produto.estabelecimento_id == estab_id, Produto.id.in_([g.produto_id for g in vencidas] or [0])).all()}
    return jsonify({"success": True, "garrafas": [
        {**_garrafa_dict(g), "produto": nomes.get(g.produto_id)} for g in vencidas]})


# ── Aplicar o mesmo conjunto de doses a vários produtos ───────────────────

@doses_bp.route("/aplicar", methods=["POST"])
@funcionario_required
@acao_protegida("produtos.editar")
def aplicar_modelo():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    dados = request.get_json(silent=True)
    if not isinstance(dados, dict):
        return _erro("Dados inválidos")
    dry_run = dados.get("dry_run", True) is not False        # sem dizer o contrário, só pré-visualiza
    try:
        resultado = cfg.aplicar_modelo(
            estab_id, dados.get("modelo"), dados.get("selecao") or {}, modo=dados.get("modo") or "substituir",
            dry_run=dry_run, volume_padrao_ml=dados.get("volume_padrao_ml"), funcionario_id=_func())
        if dry_run:
            db.session.rollback()
        else:
            db.session.commit()
    except DoseError as erro:
        return _erro(erro)
    return jsonify({"success": True, **resultado})
