from flask import Blueprint, current_app, jsonify, request, g
from app.models import (db, TabelaPreco, TabelaPrecoItem, Rota, PedidoVenda, PedidoVendaItem,
                        Cliente, Produto, MetaVendedor, ProdutoFoco, Funcionario,
                        Venda, VendaItem, ContaReceber)
from app.services.venda_service import VendaService
from app.utils.errors import EstoqueInsuficienteError
from app.decorators.decorator_jwt import funcionario_required, gerente_ou_admin_required
from flask_jwt_extended import get_jwt_identity, get_jwt
from datetime import datetime, timezone, timedelta
from decimal import Decimal, DecimalException
import hashlib
from uuid import uuid4
import re
import calendar as cal_lib
from sqlalchemy import func

bp = Blueprint("sfa", __name__)


def _parcelas_condicao(condicao, total, base_dt):
    """Traduz a condição de pagamento em parcelas (valor, vencimento).
    'A Vista' → 1x hoje; '30 Dias' → 1x +30d; '30/60' → 2x; '30/60/90' → 3x."""
    total = Decimal(str(total or 0))
    dias = [int(x) for x in re.findall(r"\d+", condicao or "")]
    if not dias:
        dias = [0]  # à vista / sem prazo
    dias = sorted(dias)
    n = len(dias)
    base_val = (total / n).quantize(Decimal("0.01"))
    parcelas, acc = [], Decimal("0")
    for i, d in enumerate(dias):
        valor = base_val if i < n - 1 else (total - acc)  # última ajusta centavos
        acc += valor
        parcelas.append((valor, (base_dt + timedelta(days=d)).date()))
    return parcelas


def _estab_id():
    """Estabelecimento do tenant autenticado (JWT via g). Nunca confia em query param."""
    return getattr(g, "estabelecimento_id", None)


CENT = Decimal("0.01")


def _precos_minimos(cliente, produto_ids, estab_id):
    """Piso negociável por produto, igual ao do app do vendedor.

    Item da tabela de preço ativa do cliente usa ``preco_minimo``; sem tabela,
    o vendedor pode conceder até 10% sobre o preço de venda do cadastro.
    """
    pisos = {}
    if cliente.tabela_preco_id:
        tabela = TabelaPreco.query.filter_by(id=cliente.tabela_preco_id, estabelecimento_id=estab_id, ativa=True).first()
        if tabela:
            for item in TabelaPrecoItem.query.filter(TabelaPrecoItem.tabela_id == tabela.id,
                                                     TabelaPrecoItem.produto_id.in_(produto_ids)).all():
                pisos[item.produto_id] = Decimal(str(item.preco_minimo))
    return pisos


def _calcular_pedido(p_data, items, produtos, pisos):
    """Recalcula o pedido no servidor; o total enviado pelo app só é aceito se conferir."""
    from app.services.estoque_service import quantidade_valida
    from app.utils.sale_validation import number
    linhas, subtotal, total_piso = [], Decimal("0"), Decimal("0")
    for item in items:
        produto = produtos[int(item.get('produto_id'))]
        quantidade = quantidade_valida(item.get('quantidade'))
        preco = number(item.get('preco_unitario'), 'Preço', positive=True)
        desconto_item = number(item.get('desconto', 0), 'Desconto do item')
        bruto = (quantidade * preco).quantize(CENT)
        if desconto_item > bruto:
            raise ValueError(f'Desconto maior que o item {produto.nome}')
        total_item = bruto - desconto_item
        if item.get('total_item') is not None and abs(number(item['total_item'], 'Total do item') - total_item) > CENT:
            raise ValueError(f'Total do item {produto.nome} não confere com quantidade × preço')
        piso_unitario = pisos.get(produto.id, Decimal(str(produto.preco_venda or 0)) * Decimal("0.9"))
        piso = (quantidade * piso_unitario).quantize(CENT)
        if total_item < piso:
            raise ValueError(f'Preço de {produto.nome} abaixo do mínimo negociável')
        linhas.append({'produto_id': produto.id, 'quantidade': quantidade, 'preco_unitario': preco,
                       'desconto': desconto_item, 'total_item': total_item})
        subtotal += total_item
        total_piso += piso
    desconto = number(p_data.get('desconto', 0), 'Desconto')
    if desconto > subtotal:
        raise ValueError('Desconto maior que o pedido')
    total = subtotal - desconto
    # O app soma itens sem arredondar; aceita meio centavo por linha. O valor
    # gravado é sempre o calculado aqui, nunca o enviado.
    tolerancia = CENT + Decimal("0.005") * len(linhas)
    for campo, calculado in (('subtotal', subtotal), ('total', total)):
        if p_data.get(campo) is not None and abs(number(p_data[campo], campo.capitalize()) - calculado) > tolerancia:
            raise ValueError(f'{campo.capitalize()} do pedido não confere com os itens')
    if total < total_piso:
        raise ValueError('Desconto do pedido ultrapassa o mínimo negociável')
    return {'itens': linhas, 'subtotal': subtotal, 'desconto': desconto, 'total': total}


def _is_privileged():
    """Admin/gerente/super-admin: pode consultar a carteira de qualquer vendedor da loja."""
    try:
        claims = get_jwt()
    except Exception:
        return False
    if claims.get("is_super_admin"):
        return True
    role = (claims.get("role") or "").lower()
    return role in ("admin", "administrador", "proprietario", "dono", "master", "gerente")


def _vendedor_id():
    """Vendedor enxerga a própria carteira; admin/gerente pode passar ?vendedor_id p/ ver outro."""
    req = request.args.get("vendedor_id")
    if req and _is_privileged():
        return req
    return get_jwt_identity()


# ─────────────────────────────────────────────
#  SYNC DATA (Download do Roteiro para o App)
# ─────────────────────────────────────────────
SYNC_LIMITE_PADRAO = 500
SYNC_LIMITE_MAXIMO = 1000


def _pagina(request_args):
    """Cursor por id crescente; ``limite`` é tamanho de página, não teto do catálogo."""
    limite = max(1, min(request_args.get("limite", SYNC_LIMITE_PADRAO, type=int), SYNC_LIMITE_MAXIMO))
    apos = max(0, request_args.get("apos", 0, type=int))
    return apos, limite


def _rotas_do_vendedor(vendedor_id, estab_id, somente_hoje=False):
    from sqlalchemy import text
    params = {"vid": vendedor_id, "eid": estab_id}
    sql_rotas = "SELECT id, nome, dia_semana, ativa FROM rotas WHERE vendedor_id = :vid AND estabelecimento_id = :eid AND (deleted_at IS NULL)"
    if somente_hoje:
        # Python weekday(): 0=Seg..6=Dom, mesmo padrão de Rota.dia_semana
        params["dow"] = datetime.now(timezone.utc).weekday()
        sql_rotas += " AND dia_semana = :dow"
    return db.session.execute(text(sql_rotas), params).mappings().all()


def _pagina_clientes(estab_id, rota_ids, apos, limite):
    from sqlalchemy import bindparam, text
    if not rota_ids:
        return [], None
    rows = db.session.execute(
        text("""
            SELECT id, nome, telefone, celular, email,
                   logradouro, numero, complemento, bairro, cidade, estado, cep,
                   limite_credito, saldo_devedor, tabela_preco_id, rota_id,
                   ultima_compra, ativo
            FROM clientes
            WHERE rota_id IN :rotas AND estabelecimento_id = :eid AND (deleted_at IS NULL) AND id > :apos
            ORDER BY id
            LIMIT :lim
        """).bindparams(bindparam("rotas", expanding=True)),
        {"eid": estab_id, "rotas": list(rota_ids), "apos": apos, "lim": limite + 1}
    ).mappings().all()
    proximo = rows[limite - 1]["id"] if len(rows) > limite else None
    return [dict(r) for r in rows[:limite]], proximo


def _pagina_produtos(estab_id, apos, limite):
    from sqlalchemy import text
    # Custo e margem ficam no escritório: o pacote vai para o celular do vendedor.
    rows = db.session.execute(
        text("""
            SELECT id, nome, descricao, preco_venda,
                   quantidade, unidade_medida, codigo_barras, imagem_url,
                   categoria_id, ativo, marca
            FROM produtos
            WHERE estabelecimento_id = :eid AND ativo = TRUE AND (deleted_at IS NULL) AND id > :apos
            ORDER BY id
            LIMIT :lim
        """),
        {"eid": estab_id, "apos": apos, "lim": limite + 1}
    ).mappings().all()
    proximo = rows[limite - 1]["id"] if len(rows) > limite else None
    return [dict(r) for r in rows[:limite]], proximo


@bp.route("/sfa/sync-data", methods=["GET"])
@funcionario_required
def sync_data():
    """Baixa rotas, clientes, produtos e tabelas do vendedor para o PWA.

    Clientes e produtos vêm na primeira página; ``paginacao`` indica o cursor
    das próximas em ``/sfa/sync-data/produtos`` e ``/sfa/sync-data/clientes``.
    """
    try:
        vendedor_id = _vendedor_id()
        estab_id = _estab_id()

        if not estab_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        # Filtro opcional de rota "de hoje" (dia_semana: 0=Seg..6=Dom). ?hoje=1 aplica.
        somente_hoje = request.args.get("hoje") in ("1", "true", "True")
        _, limite = _pagina(request.args)

        # 1. Rotas do vendedor (raw SQL, sempre restrito ao tenant do token)
        from sqlalchemy import bindparam, text
        q_rotas = _rotas_do_vendedor(vendedor_id, estab_id, somente_hoje)
        rota_ids = [r["id"] for r in q_rotas]

        # 2. Clientes dessas rotas e 3. produtos ativos: primeira página
        clientes, proximo_cliente = _pagina_clientes(estab_id, rota_ids, 0, limite)
        produtos, proximo_produto = _pagina_produtos(estab_id, 0, limite)

        # 4. Tabelas de Preço
        tabelas_rows = db.session.execute(
            text("SELECT id, nome, ativa FROM tabelas_preco WHERE estabelecimento_id = :eid AND ativa = TRUE"),
            {"eid": estab_id}
        ).mappings().all()

        # 5. Itens das Tabelas
        tabelas_itens_rows = []
        if tabelas_rows:
            tabelas_itens_rows = db.session.execute(
                text("SELECT tabela_id, produto_id, preco_venda, preco_minimo FROM tabela_preco_itens "
                     "WHERE tabela_id IN :tabelas AND estabelecimento_id = :eid").bindparams(bindparam("tabelas", expanding=True)),
                {"tabelas": [t["id"] for t in tabelas_rows], "eid": estab_id}
            ).mappings().all()

        return jsonify({
            "status": "success",
            "data": {
                "rotas": [dict(r) for r in q_rotas],
                "clientes": clientes,
                "produtos": produtos,
                "tabelas_preco": [dict(t) for t in tabelas_rows],
                "tabelas_preco_itens": [dict(i) for i in tabelas_itens_rows],
            },
            "paginacao": {"limite": limite, "proximo_produto": proximo_produto, "proximo_cliente": proximo_cliente},
        }), 200
    except Exception as e:
        current_app.logger.error("Falha no sync SFA: %s", e)
        return jsonify({"status": "error", "message": "Não foi possível sincronizar o roteiro"}), 500


@bp.route("/sfa/sync-data/produtos", methods=["GET"])
@funcionario_required
def sync_data_produtos():
    """Próxima página do catálogo do vendedor (``?apos=<último id>``)."""
    estab_id = _estab_id()
    if not estab_id:
        return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400
    apos, limite = _pagina(request.args)
    produtos, proximo = _pagina_produtos(estab_id, apos, limite)
    return jsonify({"status": "success", "data": produtos, "proximo": proximo}), 200


@bp.route("/sfa/sync-data/clientes", methods=["GET"])
@funcionario_required
def sync_data_clientes():
    """Próxima página da carteira do vendedor (``?apos=<último id>``)."""
    estab_id = _estab_id()
    if not estab_id:
        return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400
    apos, limite = _pagina(request.args)
    somente_hoje = request.args.get("hoje") in ("1", "true", "True")
    rota_ids = [r["id"] for r in _rotas_do_vendedor(_vendedor_id(), estab_id, somente_hoje)]
    clientes, proximo = _pagina_clientes(estab_id, rota_ids, apos, limite)
    return jsonify({"status": "success", "data": clientes, "proximo": proximo}), 200


# ─────────────────────────────────────────────
#  KPI DO VENDEDOR
# ─────────────────────────────────────────────
@bp.route("/sfa/kpi/vendedor", methods=["GET"])
@funcionario_required
def kpi_vendedor():
    """Retorna os indicadores cruciais para o Vendedor (Metas, Positivação, Foco)"""
    try:
        from sqlalchemy import text

        vendedor_id = _vendedor_id()
        estab_id = _estab_id()
        if not vendedor_id or not estab_id:
            return jsonify({"status": "error", "message": "Contexto de vendedor/estabelecimento ausente"}), 400

        hoje = datetime.now(timezone.utc).date()
        ano, mes = hoje.year, hoje.month

        # 1. Meta do Vendedor (raw SQL sempre restrito ao tenant)
        meta_row = db.session.execute(
            text("SELECT meta_faturamento, meta_positivacao FROM metas_vendedor WHERE vendedor_id = :vid AND mes = :mes AND ano = :ano AND estabelecimento_id = :eid LIMIT 1"),
            {"vid": vendedor_id, "mes": mes, "ano": ano, "eid": estab_id}
        ).mappings().first()

        meta_faturamento = float(meta_row["meta_faturamento"]) if meta_row else 0.0
        meta_positivacao = int(meta_row["meta_positivacao"]) if meta_row else 0

        # 2. Vendas do mês atual deste vendedor (raw SQL)
        pedidos_rows = db.session.execute(
            text("""
                SELECT id, total, cliente_id
                FROM pedidos_venda
                WHERE vendedor_id = :vid
                  AND estabelecimento_id = :eid
                  AND EXTRACT(month FROM data_emissao) = :mes
                  AND EXTRACT(year FROM data_emissao) = :ano
                  AND status != 'cancelado'
                  AND (deleted_at IS NULL)
            """),
            {"vid": vendedor_id, "mes": mes, "ano": ano, "eid": estab_id}
        ).mappings().all()

        faturamento_realizado = sum(float(p["total"]) for p in pedidos_rows)
        clientes_positivados = len(set(p["cliente_id"] for p in pedidos_rows if p["cliente_id"]))

        # 3. Base de clientes na rota do vendedor
        base_row = db.session.execute(
            text("""
                SELECT COUNT(c.id) as total
                FROM clientes c
                JOIN rotas r ON c.rota_id = r.id
                WHERE r.vendedor_id = :vid AND c.estabelecimento_id = :eid AND (c.deleted_at IS NULL)
            """),
            {"vid": vendedor_id, "eid": estab_id}
        ).mappings().first()
        base_clientes = int(base_row["total"]) if base_row else 0

        # 4. Tendência Matemática
        _, ultimo_dia_mes = cal_lib.monthrange(ano, mes)
        dias_corridos = max(hoje.day, 1)
        tendencia = (faturamento_realizado / dias_corridos) * ultimo_dia_mes

        # 5. Produto Foco
        foco_rows = db.session.execute(
            text("""
                SELECT pf.produto_id
                FROM produtos_foco pf
                WHERE pf.data_inicio <= :hoje AND pf.data_fim >= :hoje
                  AND pf.ativo = TRUE AND pf.estabelecimento_id = :eid
            """),
            {"hoje": hoje, "eid": estab_id}
        ).mappings().all()

        foco_vendido = 0.0
        if foco_rows:
            foco_ids = ",".join(str(f["produto_id"]) for f in foco_rows)
            itens_foco = db.session.execute(
                text(f"""
                    SELECT COALESCE(SUM(pvi.quantidade), 0) as total
                    FROM pedido_venda_itens pvi
                    JOIN pedidos_venda pv ON pv.id = pvi.pedido_id
                    WHERE pv.vendedor_id = :vid
                      AND pv.estabelecimento_id = :eid
                      AND EXTRACT(month FROM pv.data_emissao) = :mes
                      AND EXTRACT(year FROM pv.data_emissao) = :ano
                      AND pv.status != 'cancelado'
                      AND pvi.produto_id IN ({foco_ids})
                """),
                {"vid": vendedor_id, "mes": mes, "ano": ano, "eid": estab_id}
            ).mappings().first()
            foco_vendido = float(itens_foco["total"]) if itens_foco else 0.0

        # 6. Histórico dos últimos pedidos do vendedor
        historico = db.session.execute(
            text("""
                SELECT pv.id, pv.codigo, pv.total, pv.status, pv.data_emissao, c.nome as cliente_nome
                FROM pedidos_venda pv
                LEFT JOIN clientes c ON c.id = pv.cliente_id
                WHERE pv.vendedor_id = :vid AND pv.estabelecimento_id = :eid AND (pv.deleted_at IS NULL)
                ORDER BY pv.data_emissao DESC
                LIMIT 10
            """),
            {"vid": vendedor_id, "eid": estab_id}
        ).mappings().all()

        return jsonify({
            "status": "success",
            "data": {
                "meta": {
                    "faturamento": meta_faturamento,
                    "positivacao": meta_positivacao or base_clientes
                },
                "realizado": {
                    "faturamento": faturamento_realizado,
                    "tendencia": round(tendencia, 2),
                    "dias_corridos": dias_corridos,
                    "total_dias": ultimo_dia_mes
                },
                "carteira": {
                    "base_clientes": base_clientes,
                    "positivados": clientes_positivados,
                    "nao_compraram": max(0, base_clientes - clientes_positivados)
                },
                "produto_foco": {
                    "total_itens_vendidos": foco_vendido,
                },
                "historico_pedidos": [dict(h) for h in historico]
            }
        }), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


# ─────────────────────────────────────────────
#  SYNC PEDIDOS (POST — Vendedor envia pedidos)
# ─────────────────────────────────────────────
@bp.route("/sfa/sync-pedidos", methods=["POST"])
@funcionario_required
def sync_pedidos():
    """Recebe pedidos feitos offline (Pré-Venda) e persiste no banco."""
    try:
        data = request.json or {}
        if not isinstance(data, dict):
            raise ValueError('Payload de pedidos inválido')
        pedidos = data.get("pedidos", [])
        if not isinstance(pedidos, list) or len(pedidos) > 1000:
            raise ValueError('Lote de pedidos inválido')
        estab_id = _estab_id()
        vendedor_token = _vendedor_id()
        if not estab_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        synced = []
        item_count = 0
        for p_data in pedidos:
            if not isinstance(p_data, dict):
                raise ValueError('Pedido inválido')
            offline_uuid = p_data.get("offline_uuid")

            if offline_uuid:
                if not isinstance(offline_uuid, str) or len(offline_uuid) > 36:
                    raise ValueError('Identificador offline inválido')
                if db.engine.dialect.name == 'postgresql':
                    lock_key = int.from_bytes(hashlib.sha256(f'sfa:{estab_id}:{offline_uuid}'.encode()).digest()[:8], 'big', signed=True)
                    db.session.execute(db.text('SELECT pg_advisory_xact_lock(:key)'), {'key': lock_key})
                existente = db.session.execute(
                    db.text("SELECT id, codigo FROM pedidos_venda WHERE offline_uuid = :uuid AND estabelecimento_id = :eid LIMIT 1"),
                    {"uuid": offline_uuid, "eid": estab_id}
                ).mappings().first()
                if existente:
                    synced.append(existente["codigo"])
                    continue

            # vendedor sempre o do token; admin/gerente pode lançar em nome de outro (?vendedor_id)
            vendedor_id = (p_data.get("vendedor_id") or vendedor_token) if _is_privileged() else vendedor_token
            if not Funcionario.query.filter_by(id=vendedor_id, estabelecimento_id=estab_id, ativo=True).first():
                raise ValueError('Vendedor indisponível na loja')
            cliente = Cliente.query.filter_by(id=p_data.get('cliente_id'), estabelecimento_id=estab_id, ativo=True).first() \
                if p_data.get('cliente_id') else None
            if not cliente:
                raise ValueError('Cliente indisponível na loja')
            items = p_data.get('itens', [])
            if not isinstance(items, list) or not items or any(not isinstance(item, dict) for item in items):
                raise ValueError('Itens do pedido inválidos')
            item_count += len(items)
            if item_count > 1000:
                raise ValueError('Lote limitado a 1.000 itens')
            product_ids = {int(item.get('produto_id')) for item in items}
            produtos = {p.id: p for p in Produto.query.filter(Produto.id.in_(product_ids), Produto.estabelecimento_id == estab_id, Produto.ativo.is_(True)).all()}
            if product_ids != set(produtos):
                raise ValueError('Produto indisponível na loja')
            calculo = _calcular_pedido(p_data, items, produtos, _precos_minimos(cliente, product_ids, estab_id))

            novo_pedido = PedidoVenda(
                estabelecimento_id=estab_id,
                cliente_id=cliente.id,
                vendedor_id=vendedor_id,
                codigo=p_data.get("codigo") or f"PED-SFA-{uuid4().hex[:12]}",
                status="pendente",
                subtotal=calculo['subtotal'],
                desconto=calculo['desconto'],
                total=calculo['total'],
                condicao_pagamento=p_data.get("condicao_pagamento"),
                observacoes=p_data.get("observacoes"),
                offline_uuid=offline_uuid,
                data_emissao=datetime.utcnow()
            )
            db.session.add(novo_pedido)
            db.session.flush()

            for linha in calculo['itens']:
                db.session.add(PedidoVendaItem(estabelecimento_id=novo_pedido.estabelecimento_id,
                                               pedido_id=novo_pedido.id, **linha))

            synced.append(novo_pedido.codigo)

        db.session.commit()
        return jsonify({"status": "success", "message": f"{len(synced)} pedidos sincronizados", "pedidos_sincronizados": synced}), 200
    except (ValueError, TypeError, DecimalException) as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        import traceback; traceback.print_exc()
        return jsonify({"status": "error", "message": 'Falha ao sincronizar pedidos'}), 500


# ─────────────────────────────────────────────
#  PEDIDOS DO VENDEDOR (Listagem e Detalhes)
# ─────────────────────────────────────────────
@bp.route("/sfa/pedidos", methods=["GET"])
@funcionario_required
def listar_pedidos_vendedor():
    """Lista pedidos com filtro de status.

    Vendedor vê a própria carteira. Gerente/admin sem ``vendedor_id`` vê a loja
    inteira, que é o que a fila de aprovação precisa; itens vêm junto.
    """
    try:
        from sqlalchemy import text
        estab_id = _estab_id()
        status = request.args.get("status")
        if not estab_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        sql = """
            SELECT pv.id, pv.codigo, pv.total, pv.subtotal, pv.desconto, pv.status, pv.data_emissao,
                   pv.condicao_pagamento, pv.observacoes, pv.cliente_id, pv.vendedor_id,
                   c.nome as cliente_nome, c.limite_credito, c.saldo_devedor, f.nome as vendedor_nome
            FROM pedidos_venda pv
            LEFT JOIN clientes c ON c.id = pv.cliente_id AND c.estabelecimento_id = pv.estabelecimento_id
            LEFT JOIN funcionarios f ON f.id = pv.vendedor_id AND f.estabelecimento_id = pv.estabelecimento_id
            WHERE pv.estabelecimento_id = :eid AND (pv.deleted_at IS NULL)
        """
        params = {"eid": estab_id}
        if not (_is_privileged() and not request.args.get("vendedor_id")):
            sql += " AND pv.vendedor_id = :vid"
            params["vid"] = _vendedor_id()
        if status:
            sql += " AND pv.status = :status"
            params["status"] = status
        sql += " ORDER BY pv.data_emissao DESC LIMIT 200"

        pedidos = [dict(r) for r in db.session.execute(text(sql), params).mappings().all()]
        if pedidos:
            ids = ",".join(str(int(p["id"])) for p in pedidos)
            itens = db.session.execute(text(f"""
                SELECT i.pedido_id, i.produto_id, p.nome AS produto_nome, p.unidade_medida,
                       i.quantidade, i.preco_unitario, i.desconto, i.total_item
                FROM pedido_venda_itens i
                JOIN produtos p ON p.id = i.produto_id AND p.estabelecimento_id = i.estabelecimento_id
                WHERE i.pedido_id IN ({ids}) AND i.estabelecimento_id = :eid
                ORDER BY i.id
            """), {"eid": estab_id}).mappings().all()
            por_pedido = {}
            for item in itens:
                por_pedido.setdefault(item["pedido_id"], []).append(dict(item))
            for pedido in pedidos:
                pedido["itens"] = por_pedido.get(pedido["id"], [])
        return jsonify({"status": "success", "data": pedidos}), 200
    except Exception as e:
        current_app.logger.error("Falha ao listar pedidos SFA: %s", e)
        return jsonify({"status": "error", "message": "Não foi possível listar os pedidos"}), 500


@bp.route("/sfa/pedidos/<int:pedido_id>/rejeitar", methods=["POST"])
@gerente_ou_admin_required
def rejeitar_pedido(pedido_id):
    """Recusa um pedido pendente; nada é baixado nem cobrado. Idempotente."""
    try:
        estab_id = _estab_id()
        pedido = PedidoVenda.query.filter_by(id=pedido_id, estabelecimento_id=estab_id)\
            .populate_existing().with_for_update().first() if estab_id else None
        if not pedido:
            return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404
        if pedido.status == "cancelado":
            return jsonify({"status": "success", "message": "Pedido já estava rejeitado"}), 200
        if pedido.status != "pendente":
            return jsonify({"status": "error", "message": f"Pedido {pedido.status} não pode ser rejeitado"}), 400
        motivo = str((request.get_json(silent=True) or {}).get("motivo") or "Rejeitado na aprovação")[:200]
        pedido.status = "cancelado"
        pedido.observacoes = f"{pedido.observacoes or ''} | Rejeitado: {motivo}".strip(" |")
        db.session.commit()
        return jsonify({"status": "success", "message": "Pedido rejeitado"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error("Falha ao rejeitar pedido SFA %s: %s", pedido_id, e)
        return jsonify({"status": "error", "message": "Não foi possível rejeitar o pedido"}), 500


@bp.route("/sfa/pedidos/<int:pedido_id>/aprovar", methods=["POST"])
@gerente_ou_admin_required
def aprovar_pedido(pedido_id):
    """Aprova o pedido do vendedor e o transforma em Venda real:
    valida crédito, baixa estoque, cria Venda + itens e gera Conta(s) a Receber
    conforme a condição de pagamento. Idempotente por pedido."""
    try:
        from app.services.estoque_service import registrar_saida
        from app.utils.checkout_locking import lock_checkout
        estab_id = _estab_id()
        # Trava o pedido: duas aprovações simultâneas não faturam duas vezes.
        pedido = PedidoVenda.query.filter_by(id=pedido_id, estabelecimento_id=estab_id)\
            .populate_existing().with_for_update().first() if estab_id else None
        if not pedido:
            return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404

        # Idempotência: pedido já faturado não refatura.
        if pedido.status == "faturado":
            return jsonify({"status": "success", "message": "Pedido já faturado", "pedido": pedido.to_dict()}), 200
        if pedido.status == "cancelado":
            return jsonify({"status": "error", "message": "Pedido cancelado não pode ser aprovado"}), 400
        if not pedido.itens:
            return jsonify({"status": "error", "message": "Pedido sem itens"}), 400

        # Mesma ordem de locks do checkout: cliente (crédito) e depois produtos.
        cliente = lock_checkout(estab_id, get_jwt_identity(),
                                [{'produto_id': item.produto_id} for item in pedido.itens], pedido.cliente_id)
        total_pedido = Decimal(str(pedido.total or 0))

        # 1. Validação de crédito (fiado a prazo consome limite do cliente)
        if cliente:
            limite_disponivel = Decimal(str(cliente.limite_credito or 0)) - Decimal(str(cliente.saldo_devedor or 0))
            if total_pedido > limite_disponivel:
                db.session.rollback()
                return jsonify({"status": "error",
                                "message": f"Limite de crédito excedido. Disponível: R$ {limite_disponivel:.2f}, pedido: R$ {total_pedido:.2f}"}), 400

        agora = datetime.utcnow()
        codigo_venda = f"VD-SFA-{pedido.id}-{int(agora.timestamp())}"

        # 2. Cria a Venda (faturamento) vinculada ao vendedor do pedido
        venda = Venda(
            estabelecimento_id=estab_id,
            cliente_id=pedido.cliente_id,
            funcionario_id=pedido.vendedor_id,
            codigo=codigo_venda,
            subtotal=pedido.subtotal or pedido.total,
            desconto=pedido.desconto or Decimal("0"),
            total=pedido.total,
            status="finalizada",
            tipo_venda="sfa",
            quantidade_itens=len(pedido.itens),
            observacoes=f"Faturamento do pedido SFA {pedido.codigo}",
            data_venda=agora,
        )
        db.session.add(venda)
        db.session.flush()  # obtém venda.id

        # 3. Itens da venda + baixa de estoque e lotes pela regra única dos canais
        for item in pedido.itens:
            produto = Produto.query.filter_by(id=item.produto_id, estabelecimento_id=estab_id).first()
            if not produto:
                db.session.rollback()
                return jsonify({"status": "error", "message": f"Produto {item.produto_id} não encontrado"}), 400
            quantidade = Decimal(str(item.quantidade))
            total_item = Decimal(str(item.total_item))
            _, custo_unitario = registrar_saida(
                produto, quantidade, venda_id=venda.id, funcionario_id=pedido.vendedor_id,
                motivo=f"Venda SFA {codigo_venda}", data=agora)
            db.session.add(VendaItem(
                estabelecimento_id=estab_id, venda_id=venda.id, produto_id=produto.id,
                produto_nome=produto.nome, produto_codigo=produto.codigo_interno,
                produto_unidade=produto.unidade_medida,
                quantidade=quantidade, preco_unitario=item.preco_unitario,
                desconto=item.desconto or Decimal("0"), total_item=total_item,
                custo_unitario=custo_unitario,
                margem_lucro_real=(total_item - custo_unitario * quantidade).quantize(CENT)))
            produto.quantidade_vendida = Decimal(str(produto.quantidade_vendida or 0)) + quantidade
            produto.total_vendido = Decimal(str(produto.total_vendido or 0)) + total_item
            produto.ultima_venda = agora

        # 4. Conta(s) a Receber conforme a condição de pagamento
        parcelas = _parcelas_condicao(pedido.condicao_pagamento, pedido.total, agora)
        for i, (valor, venc) in enumerate(parcelas, start=1):
            db.session.add(ContaReceber(
                estabelecimento_id=estab_id, cliente_id=pedido.cliente_id, venda_id=venda.id,
                numero_documento=f"DUP-{codigo_venda}-{i}/{len(parcelas)}",
                valor_original=valor, valor_atual=valor,
                data_emissao=agora.date(), data_vencimento=venc, status="aberto",
                observacoes=f"Pedido SFA {pedido.codigo} - parcela {i}/{len(parcelas)} ({pedido.condicao_pagamento or 'à vista'})"))

        # 5. Atualiza saldo devedor e métricas do cliente
        if cliente:
            cliente.saldo_devedor = Decimal(str(cliente.saldo_devedor or 0)) + total_pedido
            VendaService.atualizar_metricas_cliente(cliente.id, total_pedido, agora)

        # 6. Fecha o ciclo do pedido
        pedido.status = "faturado"
        pedido.observacoes = (pedido.observacoes or "") + f" | Faturado como {codigo_venda}"
        db.session.commit()

        return jsonify({"status": "success", "message": "Pedido aprovado e faturado",
                        "data": {"venda_codigo": codigo_venda, "venda_id": venda.id,
                                 "parcelas": len(parcelas), "total": float(pedido.total)}}), 200
    except (EstoqueInsuficienteError, ValueError) as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        import traceback; traceback.print_exc()
        return jsonify({"status": "error", "message": "Falha ao faturar o pedido"}), 500


# ─────────────────────────────────────────────
#  SFA MANAGEMENT (ADMIN — Gestão de Rotas/Metas)
# ─────────────────────────────────────────────
@bp.route("/sfa/admin/metas", methods=["GET", "POST"])
@gerente_ou_admin_required
def admin_metas():
    try:
        estabelecimento_id = _estab_id()
        if not estabelecimento_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        if request.method == "POST":
            data = request.json
            vendedor_id = data.get("vendedor_id")
            mes = data.get("mes")
            ano = data.get("ano")
            meta_faturamento = data.get("meta_faturamento", 0)
            meta_positivacao = data.get("meta_positivacao", 0)

            existing = MetaVendedor.query.filter_by(
                vendedor_id=vendedor_id, mes=mes, ano=ano,
                estabelecimento_id=estabelecimento_id
            ).first()

            if existing:
                existing.meta_faturamento = meta_faturamento
                existing.meta_positivacao = meta_positivacao
            else:
                nova = MetaVendedor(
                    estabelecimento_id=estabelecimento_id,
                    vendedor_id=vendedor_id, mes=mes, ano=ano,
                    meta_faturamento=meta_faturamento,
                    meta_positivacao=meta_positivacao
                )
                db.session.add(nova)
            db.session.commit()
            return jsonify({"status": "success", "message": "Meta salva"}), 200
        else:
            mes = request.args.get("mes", datetime.now().month)
            ano = request.args.get("ano", datetime.now().year)
            metas = MetaVendedor.query.filter_by(
                estabelecimento_id=estabelecimento_id, mes=mes, ano=ano
            ).all()
            return jsonify({"status": "success", "data": [m.to_dict() for m in metas]}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/sfa/admin/rotas", methods=["GET", "POST", "PUT"])
@gerente_ou_admin_required
def admin_rotas():
    try:
        estabelecimento_id = _estab_id()
        if not estabelecimento_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        if request.method in ("POST", "PUT"):
            data = request.json
            rota_id = data.get("id")

            if rota_id:
                rota = Rota.query.get(rota_id)
                if not rota:
                    return jsonify({"status": "error", "message": "Rota não encontrada"}), 404
                rota.nome = data.get("nome", rota.nome)
                rota.vendedor_id = data.get("vendedor_id", rota.vendedor_id)
                rota.dia_semana = data.get("dia_semana", rota.dia_semana)
                rota.ativa = data.get("ativa", rota.ativa)
            else:
                rota = Rota(
                    estabelecimento_id=estabelecimento_id,
                    nome=data.get("nome"),
                    vendedor_id=data.get("vendedor_id"),
                    dia_semana=data.get("dia_semana", 0),
                    ativa=data.get("ativa", True)
                )
                db.session.add(rota)
            db.session.commit()
            return jsonify({"status": "success", "message": "Rota salva", "data": rota.to_dict()}), 200
        else:
            rotas = Rota.query.filter_by(estabelecimento_id=estabelecimento_id).all()
            return jsonify({"status": "success", "data": [r.to_dict() for r in rotas]}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/sfa/admin/rotas/<int:rota_id>", methods=["DELETE"])
@bp.route("/sfa/admin/rotas", methods=["DELETE"])
@gerente_ou_admin_required
def delete_rota(rota_id=None):
    try:
        if rota_id is None:
            rota_id = request.args.get("id", type=int)
        rota = Rota.query.get(rota_id)
        if not rota:
            return jsonify({"status": "error", "message": "Rota não encontrada"}), 404
        db.session.delete(rota)
        db.session.commit()
        return jsonify({"status": "success", "message": "Rota removida"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/sfa/admin/focos", methods=["GET", "POST"])
@bp.route("/sfa/admin/produtos-foco", methods=["GET", "POST"])
@gerente_ou_admin_required
def admin_focos():
    try:
        estabelecimento_id = _estab_id()
        if not estabelecimento_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        if request.method == "POST":
            data = request.json
            foco = ProdutoFoco(
                estabelecimento_id=estabelecimento_id,
                produto_id=data.get("produto_id"),
                data_inicio=data.get("data_inicio"),
                data_fim=data.get("data_fim"),
                meta_quantidade=data.get("meta_quantidade"),
                ativo=data.get("ativo", True)
            )
            db.session.add(foco)
            db.session.commit()
            return jsonify({"status": "success", "message": "Produto foco criado", "data": foco.to_dict()}), 200
        else:
            focos = ProdutoFoco.query.filter_by(estabelecimento_id=estabelecimento_id).all()
            return jsonify({"status": "success", "data": [f.to_dict() for f in focos]}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/sfa/admin/focos/<int:foco_id>", methods=["DELETE"])
@bp.route("/sfa/admin/produtos-foco", methods=["DELETE"])
@gerente_ou_admin_required
def delete_foco(foco_id=None):
    try:
        if foco_id is None:
            foco_id = request.args.get("id", type=int)
        foco = ProdutoFoco.query.get(foco_id)
        if not foco:
            return jsonify({"status": "error", "message": "Foco não encontrado"}), 404
        db.session.delete(foco)
        db.session.commit()
        return jsonify({"status": "success", "message": "Foco removido"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/sfa/tabelas", methods=["GET"])
@funcionario_required
def get_tabelas():
    try:
        # TenantQuery já restringe ao estabelecimento do token.
        tabelas = TabelaPreco.query.all()
        return jsonify({"status": "success", "data": [t.to_dict() for t in tabelas]}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/sfa/rotas", methods=["GET"])
@funcionario_required
def get_rotas():
    try:
        # Vendedor vê apenas as próprias rotas; admin/gerente pode filtrar por ?vendedor_id.
        vendedor_id = _vendedor_id()
        q = Rota.query
        if vendedor_id:
            q = q.filter_by(vendedor_id=vendedor_id)
        rotas = q.all()
        return jsonify({"status": "success", "data": [r.to_dict() for r in rotas]}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
