"""Contagem cíclica de estoque — API de "O que sumiu" (FASE 3.1).

Contrato fechado em docs/SPEC_O_QUE_SUMIU_CONTAGEM_CICLICA_2026-10-31.md.
Seis endpoints, todos sob funcionario_required e escopo de tenant:

    GET    /api/contagem/secoes
    POST   /api/contagem
    POST   /api/contagem/<id>/bipar
    GET    /api/contagem/<id>/conferir
    POST   /api/contagem/<id>/aplicar      (nível <= 2 + PIN)
    GET    /api/contagem/relatorio?de=&ate=

Regra que não abre exceção: aplicar grava UMA MovimentacaoEstoque por divergente
com motivo "Contagem cíclica — <seção>". Não existe tabela paralela de perdas —
o DRE e o relatório de perdas já leem movimentacoes_estoque.
"""
from datetime import date, datetime
from decimal import Decimal

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func

from app import db
from app.decorators.decorator_jwt import funcionario_required
from app.models import Funcionario, MovimentacaoEstoque, Produto, utcnow
from app.models_contagem import ContagemCiclica, ContagemCiclicaItem
from app.utils.query_helpers import get_authorized_establishment_id

contagem_bp = Blueprint("contagem", __name__)

MOTIVO_BASE = "Contagem cíclica"


# ────────────────────────────── helpers ──────────────────────────────

def _num(valor, default="0") -> Decimal:
    try:
        return Decimal(str(valor if valor is not None else default))
    except Exception:
        return Decimal(default)


def _usuario_id():
    identidade = get_jwt_identity()
    try:
        return int(identidade)
    except (TypeError, ValueError):
        return None


def _contagem_do_tenant(contagem_id: int, estab_id: int):
    return ContagemCiclica.query.filter_by(id=contagem_id, estabelecimento_id=estab_id).first()


def _resolver_produto_codigo(codigo: str, estab_id: int):
    """Mesmo caminho do PDV: código de barras e, no fallback, código interno."""
    codigo = (codigo or "").strip()
    if not codigo:
        return None
    produto = Produto.query.filter_by(estabelecimento_id=estab_id, codigo_barras=codigo).first()
    if produto:
        return produto
    return Produto.query.filter_by(estabelecimento_id=estab_id, codigo_interno=codigo).first()


def _aplicar_divergencia(contagem: ContagemCiclica, item: ContagemCiclicaItem,
                         decisao: str, usuario_id, motivo: str):
    """Grava a movimentação de estoque do item divergente e devolve o saldo novo.

    'sumiu'   -> só faz sentido quando falta (contado < esperado): saída da diferença.
    'ajustar' -> a prateleira ganhou do sistema: entrada ou saída conforme o sinal.
    """
    esperada = _num(item.quantidade_esperada)
    contada = _num(item.quantidade_contada)
    produto = item.produto or Produto.query.filter_by(id=item.produto_id, estabelecimento_id=contagem.estabelecimento_id).first()
    if produto is None:
        return None, "Produto não encontrado nesta loja"

    if decisao == "sumiu":
        falta = esperada - contada
        if falta <= 0:
            return None, "Item marcado como sumido mas não falta nada — use 'Está certo assim'"
        tipo, quantidade = "saida", falta
    elif decisao == "ajustar":
        diferenca = contada - esperada
        if diferenca == 0:
            return None, None
        tipo, quantidade = ("entrada" if diferenca > 0 else "saida"), abs(diferenca)
    else:
        return None, None

    anterior = _num(produto.quantidade)
    atual = anterior + quantidade if tipo == "entrada" else max(Decimal("0"), anterior - quantidade)
    custo = _num(produto.preco_custo)

    movimentacao = MovimentacaoEstoque(
        estabelecimento_id=contagem.estabelecimento_id,
        produto_id=produto.id,
        funcionario_id=usuario_id,
        tipo=tipo,
        quantidade=quantidade,
        quantidade_anterior=anterior,
        quantidade_atual=atual,
        custo_unitario=custo,
        valor_total=(custo * quantidade),
        motivo=motivo,
        observacoes=f"Contagem cíclica #{contagem.id} — {contagem.nome}",
    )
    produto.quantidade = atual
    db.session.add(movimentacao)
    db.session.flush()  # precisa do id para amarrar no item
    return movimentacao, None


# ────────────────────────────── endpoints ──────────────────────────────

@contagem_bp.route("/secoes", methods=["GET"])
@funcionario_required
def listar_secoes():
    """Seções que a loja já contou alguma vez, com a última contagem de cada uma."""
    estab_id = get_authorized_establishment_id()
    linhas = (
        db.session.query(
            ContagemCiclica.nome,
            func.count(ContagemCiclica.id).label("total"),
            func.max(ContagemCiclica.data_aplicacao).label("ultima_aplicacao"),
            func.max(ContagemCiclica.data_abertura).label("ultima_abertura"),
        )
        .filter(ContagemCiclica.estabelecimento_id == estab_id)
        .group_by(ContagemCiclica.nome)
        .order_by(ContagemCiclica.nome)
        .all()
    )

    abertas = {
        c.nome: c.id for c in ContagemCiclica.query.filter_by(
            estabelecimento_id=estab_id, status="aberta").all()
    }

    secoes = [{
        "nome": nome,
        "total_contagens": int(total or 0),
        "ultima_aplicacao": ultima_aplicacao.isoformat() if ultima_aplicacao else None,
        "ultima_abertura": ultima_abertura.isoformat() if ultima_abertura else None,
        "contagem_aberta_id": abertas.get(nome),
    } for nome, total, ultima_aplicacao, ultima_abertura in linhas]

    return jsonify({"success": True, "secoes": secoes})


@contagem_bp.route("", methods=["POST"])
@contagem_bp.route("/", methods=["POST"])
@funcionario_required
def abrir_contagem():
    """Abre a contagem da semana e congela a quantidade esperada de cada produto."""
    estab_id = get_authorized_establishment_id()
    dados = request.get_json(silent=True) or {}

    nome = (dados.get("nome") or "").strip()[:80]
    if not nome:
        return jsonify({"error": "Informe o nome da seção (ex.: Gôndola 3 — Higiene)"}), 400

    produtos_ids = dados.get("itens") or []
    if produtos_ids and not isinstance(produtos_ids, list):
        return jsonify({"error": "Formato de itens inválido"}), 400
    # Lista vazia é intencional: o dono abre "Gôndola 3" e bipa o que está lá,
    # sem escolher produto a produto antes de sair da tela.

    ja_aberta = ContagemCiclica.query.filter_by(
        estabelecimento_id=estab_id, nome=nome, status="aberta").first()
    if ja_aberta:
        return jsonify({
            "error": f"A seção '{nome}' já tem uma contagem aberta",
            "contagem_id": ja_aberta.id,
        }), 409

    usuario_id = _usuario_id()
    contagem = ContagemCiclica(
        estabelecimento_id=estab_id,
        nome=nome,
        status="aberta",
        data_abertura=utcnow(),
        funcionario_id=usuario_id or 1,
    )
    db.session.add(contagem)
    db.session.flush()

    produtos = Produto.query.filter(
        Produto.estabelecimento_id == estab_id,
        Produto.id.in_([int(p) for p in produtos_ids if str(p).isdigit()]),
    ).all() if produtos_ids else []
    if produtos_ids and not produtos:
        db.session.rollback()
        return jsonify({"error": "Nenhum produto válido desta loja foi encontrado"}), 400

    for produto in produtos:
        db.session.add(ContagemCiclicaItem(
            estabelecimento_id=estab_id,
            contagem_id=contagem.id,
            produto_id=produto.id,
            quantidade_esperada=_num(produto.quantidade),
            quantidade_contada=Decimal("0"),
            fora_da_secao=False,
        ))

    db.session.commit()
    return jsonify({
        "success": True,
        "contagem": contagem.to_dict(include_itens=True),
        "mensagem": f"Contagem aberta: {len(produtos)} produto(s) em '{nome}'. Comece a bipar.",
    }), 201


@contagem_bp.route("/<int:contagem_id>/bipar", methods=["POST"])
@funcionario_required
def bipar(contagem_id):
    """Um bip = uma unidade contada. Produto fora da seção é aceito e marcado."""
    estab_id = get_authorized_establishment_id()
    contagem = _contagem_do_tenant(contagem_id, estab_id)
    if contagem is None:
        return jsonify({"error": "Contagem não encontrada"}), 404
    if contagem.status != "aberta":
        return jsonify({"error": f"Esta contagem já está {contagem.status} e não aceita bip"}), 409

    dados = request.get_json(silent=True) or {}
    codigo = dados.get("codigo_barras") or dados.get("codigo") or ""
    produto = _resolver_produto_codigo(str(codigo), estab_id)
    if produto is None:
        return jsonify({"error": f"Código '{codigo}' não é de nenhum produto desta loja"}), 404

    item = ContagemCiclicaItem.query.filter_by(contagem_id=contagem.id, produto_id=produto.id).first()
    if item is None:
        # Seção aberta sem lista (o dono só nomeou a gôndola): o primeiro bip define
        # o que é da seção. Se a lista existia e o produto não estava nela, é item de
        # fora — a prateleira erra, não o sistema: aceita e marca.
        secao_tem_lista = ContagemCiclicaItem.query.filter_by(contagem_id=contagem.id).count() > 0
        item = ContagemCiclicaItem(
            estabelecimento_id=estab_id,
            contagem_id=contagem.id,
            produto_id=produto.id,
            quantidade_esperada=_num(produto.quantidade),
            quantidade_contada=Decimal("0"),
            fora_da_secao=secao_tem_lista,
        )
        db.session.add(item)

    item.quantidade_contada = _num(item.quantidade_contada) + Decimal("1")
    db.session.commit()

    return jsonify({
        "success": True,
        "produto": {"id": produto.id, "nome": produto.nome},
        "quantidade_esperada": float(item.quantidade_esperada),
        "quantidade_contada": float(item.quantidade_contada),
        "fora_da_secao": bool(item.fora_da_secao),
    })


@contagem_bp.route("/<int:contagem_id>/conferir", methods=["GET"])
@funcionario_required
def conferir(contagem_id):
    """Calcula e persiste a divergência de cada item (contado - esperado)."""
    estab_id = get_authorized_establishment_id()
    contagem = _contagem_do_tenant(contagem_id, estab_id)
    if contagem is None:
        return jsonify({"error": "Contagem não encontrada"}), 404

    divergentes, ok = [], []
    for item in contagem.itens:
        divergencia = _num(item.quantidade_contada) - _num(item.quantidade_esperada)
        item.divergencia = divergencia
        produto = item.produto
        linha = {
            "produto_id": item.produto_id,
            "nome": produto.nome if produto else f"Produto {item.produto_id}",
            "codigo_barras": produto.codigo_barras if produto else None,
            "unidade": produto.unidade_medida if produto else "UN",
            "quantidade_esperada": float(_num(item.quantidade_esperada)),
            "quantidade_contada": float(_num(item.quantidade_contada)),
            "divergencia": float(divergencia),
            "preco_venda": float(_num(produto.preco_venda)) if produto else 0.0,
            "valor_divergencia": float(divergencia * _num(produto.preco_venda)) if produto else 0.0,
            "fora_da_secao": bool(item.fora_da_secao),
            "decisao": item.decisao,
        }
        (ok if divergencia == 0 else divergentes).append(linha)

    if contagem.status == "aberta":
        contagem.status = "conferida"
    db.session.commit()

    valor_total = sum(linha["valor_divergencia"] for linha in divergentes)
    return jsonify({
        "success": True,
        "contagem": {"id": contagem.id, "nome": contagem.nome, "status": contagem.status},
        "divergentes": divergentes,
        "ok": ok,
        "resumo": {
            "itens_ok": len(ok),
            "itens_divergentes": len(divergentes),
            "valor_divergencia_total": round(valor_total, 2),
        },
    })


@contagem_bp.route("/<int:contagem_id>/aplicar", methods=["POST"])
@funcionario_required
def aplicar(contagem_id):
    """Fecha a contagem: uma MovimentacaoEstoque por divergente, com o PIN do dono."""
    from app.decorators.rbac import nivel_do_role
    from app.routes.configuracao import autorizar_por_pin

    estab_id = get_authorized_establishment_id()
    contagem = _contagem_do_tenant(contagem_id, estab_id)
    if contagem is None:
        return jsonify({"error": "Contagem não encontrada"}), 404
    if contagem.status == "aplicada":
        return jsonify({"error": "Esta contagem já foi aplicada"}), 409

    usuario_id = _usuario_id()
    operador = Funcionario.query.filter_by(id=usuario_id, estabelecimento_id=estab_id).first() if usuario_id else None
    if operador is None or nivel_do_role(operador.role) > 2:
        return jsonify({"error": "Aplicar contagem exige o dono ou um gerente"}), 403

    dados = request.get_json(silent=True) or {}
    pin = dados.get("pin")
    autorizador = autorizar_por_pin(estab_id, pin)
    if autorizador is None:
        return jsonify({"error": "PIN inválido — a contagem não foi aplicada"}), 403

    decisoes = dados.get("itens") or []
    if not isinstance(decisoes, list):
        return jsonify({"error": "Formato de itens inválido"}), 400
    mapa = {int(d.get("produto_id")): (d.get("decisao") or "").strip().lower()
            for d in decisoes if str(d.get("produto_id", "")).isdigit()}

    motivo = f"{MOTIVO_BASE} — {contagem.nome}"
    aplicados, ignorados, erros = [], [], []

    for item in contagem.itens:
        decisao = mapa.get(item.produto_id)
        if decisao in (None, "", "ok", "recontar"):
            ignorados.append(item.produto_id)
            continue
        if decisao not in ("sumiu", "ajustar"):
            erros.append({"produto_id": item.produto_id, "erro": f"Decisão '{decisao}' desconhecida"})
            continue

        movimentacao, erro = _aplicar_divergencia(contagem, item, decisao, usuario_id, motivo)
        if erro:
            erros.append({"produto_id": item.produto_id, "erro": erro})
            continue
        item.decisao = decisao
        if movimentacao is not None:
            item.movimentacao_id = movimentacao.id
            aplicados.append({
                "produto_id": item.produto_id,
                "decisao": decisao,
                "tipo": movimentacao.tipo,
                "quantidade": float(movimentacao.quantidade),
                "valor": float(_num(movimentacao.valor_total)),
                "movimentacao_id": movimentacao.id,
            })

    if erros and not aplicados:
        db.session.rollback()
        return jsonify({"error": "Nada foi aplicado", "detalhes": erros}), 400

    contagem.status = "aplicada"
    contagem.data_aplicacao = utcnow()
    db.session.commit()

    total = sum(a["valor"] for a in aplicados)
    return jsonify({
        "success": True,
        "contagem": {"id": contagem.id, "nome": contagem.nome, "status": contagem.status},
        "movimentacoes": aplicados,
        "ignorados": ignorados,
        "erros": erros,
        "resumo": {
            "movimentacoes": len(aplicados),
            "valor_total": round(total, 2),
            "autorizado_por": autorizador.nome,
        },
    })


@contagem_bp.route("/relatorio", methods=["GET"])
@funcionario_required
def relatorio():
    """'O que sumiu no mês': divergências aplicadas por seção no período."""
    estab_id = get_authorized_establishment_id()

    def _data(param, default):
        valor = request.args.get(param)
        if not valor:
            return default
        try:
            return datetime.strptime(valor, "%Y-%m-%d").date()
        except ValueError:
            return default

    hoje = date.today()
    de = _data("de", hoje.replace(day=1))
    ate = _data("ate", hoje)

    inicio = datetime.combine(de, datetime.min.time())
    fim = datetime.combine(ate, datetime.max.time())

    movimentacoes = MovimentacaoEstoque.query.filter(
        MovimentacaoEstoque.estabelecimento_id == estab_id,
        MovimentacaoEstoque.motivo.like(f"{MOTIVO_BASE}%"),
        MovimentacaoEstoque.created_at >= inicio,
        MovimentacaoEstoque.created_at <= fim,
    ).all()

    por_secao = {}
    total_itens = 0
    total_valor = Decimal("0")
    for mov in movimentacoes:
        secao = mov.motivo.split("—", 1)[-1].strip() if "—" in mov.motivo else "(sem seção)"
        bloco = por_secao.setdefault(secao, {"secao": secao, "itens": 0, "valor": 0.0, "saidas": 0, "entradas": 0})
        bloco["itens"] += 1
        valor = _num(mov.valor_total)
        bloco["valor"] += float(valor if mov.tipo == "saida" else -valor)
        bloco["saidas" if mov.tipo == "saida" else "entradas"] += 1
        total_itens += 1
        total_valor += valor if mov.tipo == "saida" else -valor

    return jsonify({
        "success": True,
        "periodo": {"de": de.isoformat(), "ate": ate.isoformat()},
        "secoes": sorted(por_secao.values(), key=lambda b: -abs(b["valor"])),
        "resumo": {
            "itens_divergentes": total_itens,
            "valor_total": round(float(total_valor), 2),
        },
    })
