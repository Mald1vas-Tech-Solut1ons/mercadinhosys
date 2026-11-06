"""API da produção própria: fichas técnicas, ordens de produção e papel dos itens.

Leitura: qualquer funcionário da loja. Escrita: gerente ou admin. Toda consulta é filtrada pela
loja do token (get_authorized_establishment_id); id de outra loja responde 404.
Módulo do plano Pro: o bloqueio vale na API, não só no menu.
"""
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import or_

from app import db
from app.decorators.decorator_jwt import funcionario_required, gerente_ou_admin_required
from app.decorators.plan_guards import pro_required
from app.models import Produto
from app.models_producao import PAPEIS_PRODUCAO, FichaTecnica, OrdemProducao
from app.services import producao_service as svc
from app.utils.query_helpers import get_authorized_establishment_id

producao_bp = Blueprint("producao", __name__)


@producao_bp.before_request
def _exige_plano_pro():
    if request.method == "OPTIONS":
        return None
    return pro_required(lambda: None)()


def _estab():
    estab_id = get_authorized_establishment_id()
    if not estab_id or str(estab_id).lower() == "all":
        return None
    return int(estab_id)


def _erro(erro, status=400):
    db.session.rollback()
    corpo = {"success": False, "error": str(erro)}
    if getattr(erro, "faltas", None):
        corpo["faltas"] = erro.faltas
        status = 409
    return jsonify(corpo), status


def _ficha(estab_id, ficha_id):
    return FichaTecnica.query.filter_by(id=ficha_id, estabelecimento_id=estab_id).first()


def _ordem(estab_id, ordem_id):
    return OrdemProducao.query.filter_by(id=ordem_id, estabelecimento_id=estab_id).first()


def _func():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _sem_loja():
    return jsonify({"success": False, "error": "Escolha uma loja"}), 400


# ── Itens (papel na fábrica) ──────────────────────────────────────────────

@producao_bp.route("/itens", methods=["GET"])
@funcionario_required
def listar_itens():
    """Produtos para montar fichas: busca por nome/código, filtro opcional por papel."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    q = Produto.query.filter(Produto.estabelecimento_id == estab_id, Produto.deleted_at.is_(None),
                             Produto.ativo.isnot(False), Produto.eh_grade_modelo.isnot(True))
    busca = (request.args.get("busca") or "").strip()
    if busca:
        termo = f"%{busca}%"
        q = q.filter(or_(Produto.nome.ilike(termo), Produto.codigo_barras.ilike(termo),
                         Produto.codigo_interno.ilike(termo)))
    pai = request.args.get("pai", type=int)
    if pai:  # variações da mesma grade (para copiar a ficha)
        q = q.filter(Produto.produto_pai_id == pai)
    papel = (request.args.get("papel") or "").strip()
    if papel == "revenda":
        q = q.filter(Produto.papel_producao.is_(None))
    elif papel:
        q = q.filter(Produto.papel_producao == papel)
    itens = q.order_by(Produto.nome).limit(min(request.args.get("limite", 50, type=int), 200)).all()
    return jsonify({"success": True, "itens": [{
        "id": p.id, "nome": p.nome, "unidade": p.unidade_medida or "UN", "papel": p.papel_producao or "revenda",
        "unidades": svc.unidades_compativeis(p.unidade_medida), "produto_pai_id": p.produto_pai_id,
        "quantidade": float(p.quantidade or 0), "preco_custo": float(p.preco_custo or 0),
        "preco_venda": float(p.preco_venda or 0)} for p in itens]})


@producao_bp.route("/itens/<int:produto_id>/papel", methods=["PATCH"])
@gerente_ou_admin_required
def definir_papel(produto_id):
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=estab_id).first()
    if not produto:
        return jsonify({"success": False, "error": "Produto não encontrado"}), 404
    try:
        svc.definir_papel(produto, (request.get_json(silent=True) or {}).get("papel"))
        db.session.commit()
    except svc.ProducaoError as erro:
        return _erro(erro)
    return jsonify({"success": True, "papel": produto.papel_producao or "revenda", "papeis": PAPEIS_PRODUCAO})


# ── Fichas técnicas ───────────────────────────────────────────────────────

@producao_bp.route("/fichas", methods=["GET"])
@funcionario_required
def listar_fichas():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    fichas = FichaTecnica.query.filter_by(estabelecimento_id=estab_id).all()
    dados = sorted((svc.ficha_dict(f) for f in fichas), key=lambda f: f["produto_nome"].lower())
    return jsonify({"success": True, "fichas": dados})


@producao_bp.route("/fichas", methods=["POST"])
@gerente_ou_admin_required
def criar_ficha():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    try:
        ficha = svc.salvar_ficha(estab_id, request.get_json(silent=True) or {}, funcionario_id=_func())
        db.session.commit()
    except (svc.ProducaoError, ValueError) as erro:
        return _erro(erro)
    return jsonify({"success": True, "ficha": svc.ficha_dict(ficha)}), 201


@producao_bp.route("/fichas/<int:ficha_id>", methods=["GET"])
@funcionario_required
def obter_ficha(ficha_id):
    estab_id = _estab()
    ficha = _ficha(estab_id, ficha_id) if estab_id else None
    if not ficha:
        return jsonify({"success": False, "error": "Ficha não encontrada"}), 404
    return jsonify({"success": True, "ficha": svc.ficha_dict(ficha)})


@producao_bp.route("/fichas/<int:ficha_id>", methods=["PUT"])
@gerente_ou_admin_required
def atualizar_ficha(ficha_id):
    estab_id = _estab()
    ficha = _ficha(estab_id, ficha_id) if estab_id else None
    if not ficha:
        return jsonify({"success": False, "error": "Ficha não encontrada"}), 404
    try:
        dados = dict(request.get_json(silent=True) or {})
        dados["produto_id"] = ficha.produto_id  # o produto da ficha não muda
        svc.salvar_ficha(estab_id, dados, ficha=ficha, funcionario_id=_func())
        db.session.commit()
    except (svc.ProducaoError, ValueError) as erro:
        return _erro(erro)
    return jsonify({"success": True, "ficha": svc.ficha_dict(ficha)})


@producao_bp.route("/fichas/<int:ficha_id>/versoes", methods=["GET"])
@funcionario_required
def versoes_ficha(ficha_id):
    estab_id = _estab()
    ficha = _ficha(estab_id, ficha_id) if estab_id else None
    if not ficha:
        return jsonify({"success": False, "error": "Ficha não encontrada"}), 404
    return jsonify({"success": True, "versoes": svc.versoes_dict(ficha)})


@producao_bp.route("/fichas/<int:ficha_id>/copiar", methods=["POST"])
@gerente_ou_admin_required
def copiar_ficha(ficha_id):
    """Grade: copia a receita para outras variações (tamanho/cor) do mesmo produto."""
    estab_id = _estab()
    ficha = _ficha(estab_id, ficha_id) if estab_id else None
    if not ficha:
        return jsonify({"success": False, "error": "Ficha não encontrada"}), 404
    try:
        criadas, ignoradas = svc.copiar_ficha(estab_id, ficha, (request.get_json(silent=True) or {}).get("produto_ids"),
                                              funcionario_id=_func())
        db.session.commit()
    except (svc.ProducaoError, ValueError) as erro:
        return _erro(erro)
    return jsonify({"success": True, "criadas": [svc.ficha_dict(f, com_capacidade=False) for f in criadas],
                    "ignoradas": ignoradas})


# ── Ordens de produção ────────────────────────────────────────────────────

@producao_bp.route("/ordens", methods=["GET"])
@funcionario_required
def listar_ordens():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    q = OrdemProducao.query.filter_by(estabelecimento_id=estab_id)
    status = (request.args.get("status") or "").strip()
    if status:
        q = q.filter(OrdemProducao.status == status)
    ordens = q.order_by(OrdemProducao.id.desc()).limit(200).all()
    return jsonify({"success": True, "ordens": [svc.ordem_dict(o) for o in ordens]})


@producao_bp.route("/ordens", methods=["POST"])
@gerente_ou_admin_required
def criar_ordem():
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    dados = request.get_json(silent=True) or {}
    ficha = _ficha(estab_id, int(dados.get("ficha_id") or 0))
    if not ficha:
        return jsonify({"success": False, "error": "Ficha não encontrada"}), 404
    try:
        op = svc.criar_ordem(estab_id, ficha, dados.get("quantidade"), int(get_jwt_identity()),
                             dados.get("observacoes"))
        db.session.commit()
    except (svc.ProducaoError, ValueError) as erro:
        return _erro(erro)
    corpo = svc.ordem_dict(op)
    corpo["faltas"] = svc.faltas_da_ordem(op)
    return jsonify({"success": True, "ordem": corpo}), 201


@producao_bp.route("/ordens/<int:ordem_id>", methods=["GET"])
@funcionario_required
def obter_ordem(ordem_id):
    estab_id = _estab()
    op = _ordem(estab_id, ordem_id) if estab_id else None
    if not op:
        return jsonify({"success": False, "error": "Ordem não encontrada"}), 404
    corpo = svc.ordem_dict(op)
    corpo["faltas"] = svc.faltas_da_ordem(op) if op.status in ("planejada", "em_producao") else []
    return jsonify({"success": True, "ordem": corpo})


def _acao(ordem_id, executar):
    estab_id = _estab()
    op = _ordem(estab_id, ordem_id) if estab_id else None
    if not op:
        return jsonify({"success": False, "error": "Ordem não encontrada"}), 404
    try:
        executar(op)
        db.session.commit()
    except (svc.ProducaoError, ValueError) as erro:
        return _erro(erro)
    except Exception as erro:  # erro inesperado não pode deixar estoque pela metade
        db.session.rollback()
        current_app.logger.exception("Erro na ordem de produção %s: %s", ordem_id, erro)
        return jsonify({"success": False, "error": "Erro ao processar a ordem"}), 500
    return jsonify({"success": True, "ordem": svc.ordem_dict(op)})


@producao_bp.route("/ordens/<int:ordem_id>/iniciar", methods=["POST"])
@gerente_ou_admin_required
def iniciar_ordem(ordem_id):
    return _acao(ordem_id, svc.iniciar_ordem)


@producao_bp.route("/ordens/<int:ordem_id>/encerrar", methods=["POST"])
@gerente_ou_admin_required
def encerrar_ordem(ordem_id):
    dados = request.get_json(silent=True) or {}
    return _acao(ordem_id, lambda op: svc.encerrar_ordem(op, dados, int(get_jwt_identity())))


@producao_bp.route("/ordens/<int:ordem_id>/apontar", methods=["POST"])
@gerente_ou_admin_required
def apontar_ordem(ordem_id):
    """Produção parcial: entrega uma parte (turno, fornada) sem encerrar a ordem."""
    dados = request.get_json(silent=True) or {}
    return _acao(ordem_id, lambda op: svc.apontar(op, dados, int(get_jwt_identity())))


@producao_bp.route("/ordens/<int:ordem_id>/cancelar", methods=["POST"])
@gerente_ou_admin_required
def cancelar_ordem(ordem_id):
    return _acao(ordem_id, svc.cancelar_ordem)


@producao_bp.route("/ordens/<int:ordem_id>/estornar", methods=["POST"])
@gerente_ou_admin_required
def estornar_ordem(ordem_id):
    """Desfaz a OP (todas as entregas). Mexe em estoque e custo: exige PIN de gerente e fica na auditoria."""
    from app.models import Auditoria
    from app.services.politica_acoes import resposta_erro_pin, validar_pin
    estab_id = _estab()
    op = _ordem(estab_id, ordem_id) if estab_id else None
    if not op:
        return jsonify({"success": False, "error": "Ordem não encontrada"}), 404
    dados = request.get_json(silent=True) or {}
    autorizador, erro_pin = validar_pin(estab_id, get_jwt_identity(), dados.get("pin"))
    if erro_pin:
        return resposta_erro_pin(erro_pin, "PIN de gerente obrigatório para estornar a ordem")

    def executar(ordem):
        svc.estornar_ordem(ordem, dados.get("motivo"), int(get_jwt_identity()))
        Auditoria.registrar(
            estabelecimento_id=estab_id, tipo_evento="producao_estorno",
            descricao=f"Estorno da {ordem.numero} ({ordem.produto.nome}): {ordem.motivo_estorno}",
            usuario_id=int(get_jwt_identity()),
            valor=float((ordem.custo_unitario_real or 0) * (ordem.quantidade_produzida or 0)),
            detalhes={"ordem_id": ordem.id, "autorizado_por": autorizador.nome,
                      "quantidade_produzida": float(ordem.quantidade_produzida or 0)})
    return _acao(ordem_id, executar)


@producao_bp.route("/rastreio/lote/<int:lote_id>", methods=["GET"])
@funcionario_required
def rastreio_lote(lote_id):
    """Recall: de onde veio este lote e para onde foi (ordens, lotes produzidos e vendas)."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    try:
        return jsonify({"success": True, **svc.rastreio_lote(estab_id, lote_id)})
    except svc.ProducaoError as erro:
        return jsonify({"success": False, "error": str(erro)}), 404


@producao_bp.route("/lotes", methods=["GET"])
@funcionario_required
def buscar_lotes():
    """Busca de lote por número (insumo ou acabado) para abrir o rastreio."""
    from app.models import ProdutoLote
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    busca = (request.args.get("busca") or "").strip()
    if len(busca) < 2:
        return jsonify({"success": True, "lotes": []})
    termo = f"%{busca}%"
    lotes = ProdutoLote.query.join(Produto, Produto.id == ProdutoLote.produto_id).filter(
        ProdutoLote.estabelecimento_id == estab_id,
        or_(ProdutoLote.numero_lote.ilike(termo), Produto.nome.ilike(termo))
    ).order_by(ProdutoLote.id.desc()).limit(30).all()
    return jsonify({"success": True, "lotes": [{
        "lote_id": l.id, "numero_lote": l.numero_lote, "produto_nome": l.produto.nome if l.produto else None,
        "data_validade": l.data_validade.isoformat() if l.data_validade else None,
        "saldo": float(l.quantidade or 0)} for l in lotes]})


@producao_bp.route("/necessidade-insumos", methods=["GET"])
@funcionario_required
def necessidade_insumos():
    """Produção -> compras: quanto comprar de cada insumo para cumprir as ordens abertas."""
    estab_id = _estab()
    if not estab_id:
        return _sem_loja()
    return jsonify({"success": True, "insumos": svc.necessidade_insumos(estab_id)})
