from flask import Blueprint, current_app, jsonify, request, g
from app.models import (db, TabelaPreco, TabelaPrecoItem, Rota, PedidoVenda, PedidoVendaItem,
                        Cliente, Produto, MetaVendedor, ProdutoFoco, Funcionario,
                        Venda, VendaItem, ContaReceber)
from app.services.venda_service import VendaService
from app.services.pedido_b2b_service import (ReservaIndisponivelError, cancelar_saldo, condicao_a_vista, executar_expedicao,
                                             lista_separacao, parcelas_condicao, planejar_expedicao, reservar)
from app.utils.errors import EstoqueInsuficienteError
from app.decorators.decorator_jwt import funcionario_required, gerente_ou_admin_required
from flask_jwt_extended import get_jwt_identity, get_jwt
from datetime import datetime, timezone, timedelta
from decimal import Decimal, DecimalException
import hashlib
from uuid import uuid4
import re
import calendar as cal_lib
from sqlalchemy import bindparam, func
from app.utils.timezone import iso_local, local_date_to_utc_naive, to_local

bp = Blueprint("sfa", __name__)


_parcelas_condicao = parcelas_condicao  # mantido por compatibilidade com quem importa daqui


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
            SELECT id, nome, tipo_pessoa, razao_social, cnpj, telefone, celular, email,
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
            SELECT p.id, p.nome, p.descricao, p.preco_venda,
                   p.quantidade, p.unidade_medida, p.codigo_barras, p.imagem_url,
                   p.categoria_id, p.ativo, p.marca,
                   COALESCE((SELECT SUM(i.quantidade_reservada)
                             FROM pedido_venda_itens i JOIN pedidos_venda pv ON pv.id = i.pedido_id
                             WHERE i.produto_id = p.id AND i.estabelecimento_id = :eid
                               AND pv.status IN ('aprovado', 'parcial') AND pv.deleted_at IS NULL), 0) AS quantidade_reservada
            FROM produtos p
            WHERE p.estabelecimento_id = :eid AND p.ativo = TRUE AND (p.deleted_at IS NULL) AND p.id > :apos
            ORDER BY p.id
            LIMIT :lim
        """),
        {"eid": estab_id, "apos": apos, "lim": limite + 1}
    ).mappings().all()
    proximo = rows[limite - 1]["id"] if len(rows) > limite else None
    produtos = []
    for r in rows[:limite]:
        produto = dict(r)
        # Disponível para prometer = saldo físico menos o que já está separado para outros pedidos.
        produto["quantidade_disponivel"] = max(0.0, float(produto["quantidade"] or 0) - float(produto["quantidade_reservada"] or 0))
        produtos.append(produto)
    return produtos, proximo


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

        # Mês comercial no fuso da loja (UTC virava o mês 3h antes) e em intervalo semiaberto,
        # que permite usar índice em data_emissao (EXTRACT não usa).
        hoje = to_local(datetime.now(timezone.utc)).date()
        ano, mes = hoje.year, hoje.month
        inicio_mes = local_date_to_utc_naive(hoje.replace(day=1))
        proximo_mes = hoje.replace(day=28) + timedelta(days=4)
        fim_mes = local_date_to_utc_naive(proximo_mes.replace(day=1))

        # 1. Meta do Vendedor (raw SQL sempre restrito ao tenant)
        meta_row = db.session.execute(
            text("SELECT meta_faturamento, meta_positivacao FROM metas_vendedor WHERE vendedor_id = :vid AND mes = :mes AND ano = :ano AND estabelecimento_id = :eid LIMIT 1"),
            {"vid": vendedor_id, "mes": mes, "ano": ano, "eid": estab_id}
        ).mappings().first()

        meta_faturamento = float(meta_row["meta_faturamento"]) if meta_row else 0.0
        meta_positivacao = int(meta_row["meta_positivacao"]) if meta_row else 0

        # 2. Faturamento do mês = vendas geradas pelos pedidos do vendedor (cada expedição é uma venda), já sem
        # as canceladas. Pedido pendente ou só reservado ainda pode ser recusado ou cortado: entra à parte,
        # como carteira a faturar (pipeline), pelo saldo que falta sair.
        vendas_rows = db.session.execute(
            text("""
                SELECT id, total, cliente_id
                FROM vendas
                WHERE funcionario_id = :vid
                  AND estabelecimento_id = :eid
                  AND tipo_venda = 'sfa' AND status = 'finalizada'
                  AND data_venda >= :inicio AND data_venda < :fim
                  AND (deleted_at IS NULL)
            """),
            {"vid": vendedor_id, "inicio": inicio_mes, "fim": fim_mes, "eid": estab_id}
        ).mappings().all()
        saldo_rows = db.session.execute(
            text("""
                SELECT pv.id AS pedido_id, pv.total, pv.subtotal, i.quantidade, i.quantidade_atendida,
                       i.quantidade_cancelada, i.total_item
                FROM pedidos_venda pv JOIN pedido_venda_itens i ON i.pedido_id = pv.id
                WHERE pv.vendedor_id = :vid AND pv.estabelecimento_id = :eid
                  AND pv.status IN ('pendente', 'aprovado', 'parcial') AND (pv.deleted_at IS NULL)
            """),
            {"vid": vendedor_id, "eid": estab_id}
        ).mappings().all()

        faturamento_realizado = sum(float(v["total"]) for v in vendas_rows)
        clientes_positivados = len(set(v["cliente_id"] for v in vendas_rows if v["cliente_id"]))
        saldo_por_pedido, fator_por_pedido = {}, {}
        for r in saldo_rows:
            quantidade = float(r["quantidade"] or 0)
            saldo = max(0.0, quantidade - float(r["quantidade_atendida"] or 0) - float(r["quantidade_cancelada"] or 0))
            saldo_por_pedido[r["pedido_id"]] = saldo_por_pedido.get(r["pedido_id"], 0.0) + (
                saldo / quantidade * float(r["total_item"] or 0) if quantidade else 0.0)
            subtotal = float(r["subtotal"] or 0)
            fator_por_pedido[r["pedido_id"]] = float(r["total"] or 0) / subtotal if subtotal else 1.0  # desconto do pedido
        pipeline_pendente = sum(valor * fator_por_pedido[pid] for pid, valor in saldo_por_pedido.items())

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
            itens_foco = db.session.execute(
                text("""
                    SELECT COALESCE(SUM(vi.quantidade), 0) as total
                    FROM venda_itens vi
                    JOIN vendas v ON v.id = vi.venda_id
                    WHERE v.funcionario_id = :vid
                      AND v.estabelecimento_id = :eid
                      AND v.tipo_venda = 'sfa' AND v.status = 'finalizada'
                      AND v.data_venda >= :inicio AND v.data_venda < :fim
                      AND vi.produto_id IN :foco_ids
                """).bindparams(bindparam("foco_ids", expanding=True)),
                {"vid": vendedor_id, "inicio": inicio_mes, "fim": fim_mes, "eid": estab_id,
                 "foco_ids": [f["produto_id"] for f in foco_rows]}
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
                    "pipeline_pendente": round(pipeline_pendente, 2),
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
                "historico_pedidos": [{**dict(h), "data_emissao": iso_local(h["data_emissao"]) if isinstance(h["data_emissao"], datetime) else h["data_emissao"]}
                                      for h in historico]
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
        statuses = [x.strip() for x in (status or "").split(",") if x.strip()]
        if statuses:
            sql += " AND pv.status IN :statuses"
            params["statuses"] = statuses
        sql += " ORDER BY pv.data_emissao DESC LIMIT 200"

        consulta = text(sql)
        if statuses:
            consulta = consulta.bindparams(bindparam("statuses", expanding=True))
        pedidos = [dict(r) for r in db.session.execute(consulta, params).mappings().all()]
        if pedidos:
            ids = ",".join(str(int(p["id"])) for p in pedidos)
            itens = db.session.execute(text(f"""
                SELECT i.id AS item_id, i.pedido_id, i.produto_id, p.nome AS produto_nome, p.unidade_medida,
                       i.quantidade, i.preco_unitario, i.desconto, i.total_item,
                       i.quantidade_reservada, i.quantidade_atendida, i.quantidade_cancelada
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


def _pedido_travado(pedido_id):
    """Pedido da loja do token, bloqueado FOR UPDATE: reserva, expedição e aprovação não correm juntas."""
    estab_id = _estab_id()
    if not estab_id:
        return estab_id, None
    pedido = PedidoVenda.query.filter_by(id=pedido_id, estabelecimento_id=estab_id) \
        .populate_existing().with_for_update().first()
    return estab_id, pedido


def _travar_cliente_e_produtos(estab_id, pedido):
    """Mesma ordem de locks do checkout: caixa do operador, cliente (crédito) e depois produtos."""
    from app.utils.checkout_locking import lock_checkout
    return lock_checkout(estab_id, get_jwt_identity(), [{'produto_id': item.produto_id} for item in pedido.itens],
                         pedido.cliente_id)


def _validar_credito(cliente, valor, pedido, agora):
    """Crédito só vale para venda a prazo: à vista não consome limite nem é barrada por atraso.
    A prazo exige cliente em dia e limite disponível."""
    valor = Decimal(str(valor or 0))
    if not cliente or condicao_a_vista(pedido.condicao_pagamento, valor, agora):
        return
    from app.services.credito_service import validar_sem_atraso
    validar_sem_atraso(cliente)
    limite_disponivel = Decimal(str(cliente.limite_credito or 0)) - Decimal(str(cliente.saldo_devedor or 0))
    if valor > limite_disponivel:
        raise ValueError(f"Limite de crédito excedido. Disponível: R$ {limite_disponivel:.2f}, pedido: R$ {valor:.2f}")


def _resumo_itens(pedido):
    return [{"item_id": i.id, "produto_id": i.produto_id, "quantidade": float(i.quantidade),
             "reservado": float(i.quantidade_reservada or 0), "atendido": float(i.quantidade_atendida or 0),
             "cancelado": float(i.quantidade_cancelada or 0), "saldo": float(i.saldo)} for i in pedido.itens]


@bp.route("/sfa/pedidos/<int:pedido_id>/reservar", methods=["POST"])
@gerente_ou_admin_required
def reservar_pedido(pedido_id):
    """Aprova o crédito e separa estoque para o pedido, sem faturar.

    Tudo ou nada por padrão; com ``permitir_falta`` reserva o que existe e o resto fica em carteira.
    Pode ser repetido quando chegar mercadoria para completar a reserva."""
    try:
        corpo = request.get_json(silent=True) or {}
        estab_id, pedido = _pedido_travado(pedido_id)
        if not pedido:
            return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404
        if pedido.status in ("faturado", "cancelado"):
            return jsonify({"status": "error", "message": f"Pedido {pedido.status} não aceita reserva"}), 400
        if not pedido.itens:
            return jsonify({"status": "error", "message": "Pedido sem itens"}), 400
        cliente = _travar_cliente_e_produtos(estab_id, pedido)
        if pedido.status == "pendente":
            _validar_credito(cliente, pedido.total, pedido, datetime.utcnow())
        faltas = reservar(pedido, permitir_falta=bool(corpo.get("permitir_falta")))
        db.session.commit()
        return jsonify({"status": "success", "message": "Pedido reservado" if not faltas else "Reserva parcial: itens em falta ficam em carteira",
                        "data": {"pedido_status": pedido.status, "faltas": faltas, "itens": _resumo_itens(pedido)}}), 200
    except (EstoqueInsuficienteError, ValueError) as e:
        db.session.rollback()
        corpo_erro = {"status": "error", "message": str(e)}
        if isinstance(e, ReservaIndisponivelError):
            corpo_erro["faltas"] = e.faltas
        return jsonify(corpo_erro), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Falha ao reservar pedido SFA %s", pedido_id)
        return jsonify({"status": "error", "message": "Falha ao reservar o pedido"}), 500


@bp.route("/sfa/pedidos/<int:pedido_id>/separacao", methods=["GET"])
@gerente_ou_admin_required
def separacao_pedido(pedido_id):
    """Roteiro de separação do estoquista, com os lotes de validade mais curta primeiro."""
    estab_id = _estab_id()
    pedido = PedidoVenda.query.filter_by(id=pedido_id, estabelecimento_id=estab_id).first() if estab_id else None
    if not pedido:
        return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404
    return jsonify({"status": "success", "data": {"pedido_id": pedido.id, "codigo": pedido.codigo, "status": pedido.status,
                                                  "itens": lista_separacao(pedido)}}), 200


@bp.route("/sfa/pedidos/<int:pedido_id>/expedir", methods=["POST"])
@gerente_ou_admin_required
def expedir_pedido(pedido_id):
    """Expede o que está reservado (tudo, ou só os itens/quantidades informados): vende, baixa o estoque
    e gera os títulos do que saiu. O saldo continua no pedido."""
    try:
        corpo = request.get_json(silent=True) or {}
        selecao = None
        if corpo.get("itens") is not None:
            if not isinstance(corpo["itens"], list) or not corpo["itens"]:
                raise ValueError("Informe os itens a expedir")
            selecao = {}
            for linha in corpo["itens"]:
                if not isinstance(linha, dict) or linha.get("item_id") is None:
                    raise ValueError("Item de expedição inválido")
                if int(linha["item_id"]) in selecao:
                    raise ValueError("Item repetido na expedição")
                selecao[int(linha["item_id"])] = linha.get("quantidade")
        estab_id, pedido = _pedido_travado(pedido_id)
        if not pedido:
            return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404
        if pedido.status not in ("aprovado", "parcial"):
            return jsonify({"status": "error", "message": "Reserve o pedido antes de expedir"}), 400
        cliente = _travar_cliente_e_produtos(estab_id, pedido)
        agora = datetime.utcnow()
        plano = planejar_expedicao(pedido, selecao)
        _validar_credito(cliente, plano.total, pedido, agora)
        venda, expedicao, parcelas = executar_expedicao(pedido, plano, cliente, agora=agora)
        db.session.commit()
        return jsonify({"status": "success", "message": "Expedição registrada",
                        "data": {"venda_codigo": venda.codigo, "venda_id": venda.id, "expedicao": expedicao.sequencia,
                                 "parcelas": parcelas, "total": float(plano.total), "pedido_status": pedido.status,
                                 "itens": _resumo_itens(pedido)}}), 200
    except (EstoqueInsuficienteError, ValueError, TypeError, DecimalException) as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Falha ao expedir pedido SFA %s", pedido_id)
        return jsonify({"status": "error", "message": "Falha ao expedir o pedido"}), 500


@bp.route("/sfa/pedidos/<int:pedido_id>/cancelar-saldo", methods=["POST"])
@gerente_ou_admin_required
def cancelar_saldo_pedido(pedido_id):
    """Corta o que ainda não saiu e libera a reserva. Nada expedido: o pedido inteiro é cancelado."""
    try:
        motivo = str((request.get_json(silent=True) or {}).get("motivo") or "Saldo cancelado")[:200]
        estab_id, pedido = _pedido_travado(pedido_id)
        if not pedido:
            return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404
        if pedido.status not in ("aprovado", "parcial"):
            return jsonify({"status": "error", "message": "Só pedido aprovado ou parcial tem saldo a cancelar"}), 400
        _travar_cliente_e_produtos(estab_id, pedido)
        status = cancelar_saldo(pedido, motivo)
        db.session.commit()
        return jsonify({"status": "success", "message": "Saldo cancelado",
                        "data": {"pedido_status": status, "itens": _resumo_itens(pedido)}}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Falha ao cancelar saldo do pedido SFA %s", pedido_id)
        return jsonify({"status": "error", "message": "Falha ao cancelar o saldo"}), 500


@bp.route("/sfa/pedidos/<int:pedido_id>/aprovar", methods=["POST"])
@gerente_ou_admin_required
def aprovar_pedido(pedido_id):
    """Aprova e fatura o pedido inteiro de uma vez: valida crédito, reserva e expede tudo.
    Para reservar primeiro ou entregar em partes, use /reservar e /expedir. Idempotente por pedido."""
    try:
        estab_id, pedido = _pedido_travado(pedido_id)
        if not pedido:
            return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404

        # Idempotência: pedido já faturado não refatura.
        if pedido.status == "faturado":
            return jsonify({"status": "success", "message": "Pedido já faturado", "pedido": pedido.to_dict()}), 200
        if pedido.status == "cancelado":
            return jsonify({"status": "error", "message": "Pedido cancelado não pode ser aprovado"}), 400
        if not pedido.itens:
            return jsonify({"status": "error", "message": "Pedido sem itens"}), 400

        cliente = _travar_cliente_e_produtos(estab_id, pedido)
        agora = datetime.utcnow()
        if pedido.status == "pendente":
            _validar_credito(cliente, pedido.total, pedido, agora)
        reservar(pedido)  # tudo ou nada: sem estoque livre, nada é reservado nem faturado
        plano = planejar_expedicao(pedido)
        if pedido.status != "pendente":
            _validar_credito(cliente, plano.total, pedido, agora)
        venda, _, parcelas = executar_expedicao(pedido, plano, cliente, agora=agora)
        pedido.observacoes = (pedido.observacoes or "") + f" | Faturado como {venda.codigo}"
        db.session.commit()

        return jsonify({"status": "success", "message": "Pedido aprovado e faturado",
                        "data": {"venda_codigo": venda.codigo, "venda_id": venda.id,
                                 "parcelas": parcelas, "total": float(plano.total)}}), 200
    except (EstoqueInsuficienteError, ValueError) as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Falha ao faturar pedido SFA %s", pedido_id)
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
