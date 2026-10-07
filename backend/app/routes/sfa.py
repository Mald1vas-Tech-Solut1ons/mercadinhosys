from flask import Blueprint, jsonify, request, g
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
@bp.route("/sfa/sync-data", methods=["GET"])
@funcionario_required
def sync_data():
    """Baixa o roteiro do dia, clientes, produtos e tabelas do vendedor para o PWA."""
    try:
        vendedor_id = _vendedor_id()
        estab_id = _estab_id()

        if not estab_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        # Filtro opcional de rota "de hoje" (dia_semana: 0=Seg..6=Dom). ?hoje=1 aplica.
        somente_hoje = request.args.get("hoje") in ("1", "true", "True")

        # 1. Rotas do vendedor (raw SQL, sempre restrito ao tenant do token)
        from sqlalchemy import text
        params = {"vid": vendedor_id, "eid": estab_id}
        sql_rotas = "SELECT id, nome, dia_semana, ativa FROM rotas WHERE vendedor_id = :vid AND estabelecimento_id = :eid AND (deleted_at IS NULL)"
        if somente_hoje:
            # Python weekday(): 0=Seg..6=Dom, mesmo padrão de Rota.dia_semana
            params["dow"] = datetime.now(timezone.utc).weekday()
            sql_rotas += " AND dia_semana = :dow"
        q_rotas = db.session.execute(text(sql_rotas), params).mappings().all()

        rota_ids = [r["id"] for r in q_rotas]

        # 2. Clientes dessas rotas (com dados completos), sempre restrito ao tenant
        clientes_rows = []
        if rota_ids:
            placeholders = ",".join(str(i) for i in rota_ids)
            clientes_rows = db.session.execute(
                text(f"""
                    SELECT id, nome, telefone, celular, email,
                           logradouro, numero, complemento, bairro, cidade, estado, cep,
                           limite_credito, saldo_devedor, tabela_preco_id, rota_id,
                           ultima_compra, ativo
                    FROM clientes
                    WHERE rota_id IN ({placeholders}) AND estabelecimento_id = :eid AND (deleted_at IS NULL)
                    LIMIT 100
                """),
                {"eid": estab_id}
            ).mappings().all()

        # 3. Produtos do estabelecimento
        produtos_rows = []
        if estab_id:
            produtos_rows = db.session.execute(
                text("""
                    SELECT id, nome, descricao, preco_venda, preco_custo,
                           quantidade, unidade_medida, codigo_barras, imagem_url,
                           categoria_id, ativo, marca
                    FROM produtos
                    WHERE estabelecimento_id = :eid AND ativo = TRUE
                    LIMIT 500
                """),
                {"eid": estab_id}
            ).mappings().all()

        # 4. Tabelas de Preço
        tabelas_rows = []
        if estab_id:
            tabelas_rows = db.session.execute(
                text("SELECT id, nome, ativa FROM tabelas_preco WHERE estabelecimento_id = :eid AND ativa = TRUE"),
                {"eid": estab_id}
            ).mappings().all()

        # 5. Itens das Tabelas
        tabelas_itens_rows = []
        if tabelas_rows:
            tab_ids = ",".join(str(t["id"]) for t in tabelas_rows)
            tabelas_itens_rows = db.session.execute(
                text(f"SELECT tabela_id, produto_id, preco_venda, preco_minimo FROM tabela_preco_itens WHERE tabela_id IN ({tab_ids})")
            ).mappings().all()

        def to_plain(row):
            return dict(row)

        return jsonify({
            "status": "success",
            "data": {
                "rotas": [to_plain(r) for r in q_rotas],
                "clientes": [to_plain(c) for c in clientes_rows],
                "produtos": [to_plain(p) for p in produtos_rows],
                "tabelas_preco": [to_plain(t) for t in tabelas_rows],
                "tabelas_preco_itens": [to_plain(i) for i in tabelas_itens_rows],
            }
        }), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


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
            if not p_data.get('cliente_id') or not Cliente.query.filter_by(id=p_data['cliente_id'], estabelecimento_id=estab_id, ativo=True).first():
                raise ValueError('Cliente indisponível na loja')
            items = p_data.get('itens', [])
            if not isinstance(items, list) or not items or any(not isinstance(item, dict) for item in items):
                raise ValueError('Itens do pedido inválidos')
            item_count += len(items)
            if item_count > 1000:
                raise ValueError('Lote limitado a 1.000 itens')
            product_ids = {int(item.get('produto_id')) for item in items}
            available_ids = {p.id for p in Produto.query.filter(Produto.id.in_(product_ids), Produto.estabelecimento_id == estab_id, Produto.ativo.is_(True)).all()}
            if product_ids != available_ids:
                raise ValueError('Produto indisponível na loja')
            for field in ('subtotal', 'desconto', 'total'):
                value = Decimal(str(p_data.get(field, 0)))
                if not value.is_finite() or value < 0:
                    raise ValueError('Valor financeiro inválido')
            for item in items:
                for field in ('quantidade', 'preco_unitario', 'desconto', 'total_item'):
                    value = Decimal(str(item.get(field, 0)))
                    if not value.is_finite() or value < 0 or (field == 'quantidade' and value == 0):
                        raise ValueError('Valor do item inválido')

            novo_pedido = PedidoVenda(
                estabelecimento_id=estab_id,
                cliente_id=p_data.get("cliente_id"),
                vendedor_id=vendedor_id,
                codigo=p_data.get("codigo") or f"PED-SFA-{uuid4().hex[:12]}",
                status="pendente",
                subtotal=p_data.get("subtotal", 0),
                desconto=p_data.get("desconto", 0),
                total=p_data.get("total", 0),
                condicao_pagamento=p_data.get("condicao_pagamento"),
                observacoes=p_data.get("observacoes"),
                offline_uuid=offline_uuid,
                data_emissao=datetime.utcnow()
            )
            db.session.add(novo_pedido)
            db.session.flush()

            for i_data in items:
                item = PedidoVendaItem(
                    estabelecimento_id=novo_pedido.estabelecimento_id,
                    pedido_id=novo_pedido.id,
                    produto_id=i_data.get("produto_id"),
                    quantidade=i_data.get("quantidade"),
                    preco_unitario=i_data.get("preco_unitario"),
                    desconto=i_data.get("desconto", 0),
                    total_item=i_data.get("total_item")
                )
                db.session.add(item)

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
    """Lista pedidos do vendedor com filtro de status."""
    try:
        from sqlalchemy import text
        vendedor_id = _vendedor_id()
        estab_id = _estab_id()
        status = request.args.get("status")
        if not estab_id:
            return jsonify({"status": "error", "message": "Contexto de estabelecimento ausente"}), 400

        sql = """
            SELECT pv.id, pv.codigo, pv.total, pv.status, pv.data_emissao,
                   pv.condicao_pagamento, pv.observacoes, pv.cliente_id,
                   c.nome as cliente_nome
            FROM pedidos_venda pv
            LEFT JOIN clientes c ON c.id = pv.cliente_id
            WHERE pv.vendedor_id = :vid AND pv.estabelecimento_id = :eid AND (pv.deleted_at IS NULL)
        """
        params = {"vid": vendedor_id, "eid": estab_id}
        if status:
            sql += " AND pv.status = :status"
            params["status"] = status
        sql += " ORDER BY pv.data_emissao DESC LIMIT 50"

        rows = db.session.execute(text(sql), params).mappings().all()
        return jsonify({"status": "success", "data": [dict(r) for r in rows]}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@bp.route("/sfa/pedidos/<int:pedido_id>/aprovar", methods=["POST"])
@gerente_ou_admin_required
def aprovar_pedido(pedido_id):
    """Aprova o pedido do vendedor e o transforma em Venda real:
    valida crédito, baixa estoque, cria Venda + itens e gera Conta(s) a Receber
    conforme a condição de pagamento. Idempotente por pedido."""
    try:
        pedido = PedidoVenda.query.get(pedido_id)
        if not pedido:
            return jsonify({"status": "error", "message": "Pedido não encontrado"}), 404

        # Idempotência: pedido já faturado não refatura.
        if pedido.status == "faturado":
            return jsonify({"status": "success", "message": "Pedido já faturado", "pedido": pedido.to_dict()}), 200
        if pedido.status == "cancelado":
            return jsonify({"status": "error", "message": "Pedido cancelado não pode ser aprovado"}), 400
        if not pedido.itens:
            return jsonify({"status": "error", "message": "Pedido sem itens"}), 400

        estab_id = pedido.estabelecimento_id
        cliente = Cliente.query.get(pedido.cliente_id) if pedido.cliente_id else None

        # 1. Validação de crédito (fiado a prazo consome limite do cliente)
        if cliente:
            limite_disponivel = float(cliente.limite_credito or 0) - float(cliente.saldo_devedor or 0)
            if float(pedido.total) > limite_disponivel:
                return jsonify({"status": "error",
                                "message": f"Limite de crédito excedido. Disponível: R$ {limite_disponivel:.2f}, pedido: R$ {float(pedido.total):.2f}"}), 400

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

        # 3. Itens da venda + baixa de estoque (valida disponibilidade)
        for item in pedido.itens:
            produto = Produto.query.get(item.produto_id)
            if not produto:
                return jsonify({"status": "error", "message": f"Produto {item.produto_id} não encontrado"}), 400
            VendaService.atualizar_estoque(
                produto_id=produto.id, quantidade=Decimal(str(item.quantidade)),
                venda_id=venda.id, estabelecimento_id=estab_id,
                funcionario_id=pedido.vendedor_id, data_venda=agora, codigo_venda=codigo_venda)
            db.session.add(VendaItem(
                estabelecimento_id=estab_id, venda_id=venda.id, produto_id=produto.id,
                produto_nome=produto.nome, produto_codigo=produto.codigo_interno,
                produto_unidade=produto.unidade_medida,
                quantidade=item.quantidade, preco_unitario=item.preco_unitario,
                desconto=item.desconto or Decimal("0"), total_item=item.total_item,
                custo_unitario=produto.preco_custo))

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
            cliente.saldo_devedor = float(cliente.saldo_devedor or 0) + float(pedido.total)
            VendaService.atualizar_metricas_cliente(cliente.id, Decimal(str(pedido.total)), agora)

        # 6. Fecha o ciclo do pedido
        pedido.status = "faturado"
        pedido.observacoes = (pedido.observacoes or "") + f" | Faturado como {codigo_venda}"
        db.session.commit()

        return jsonify({"status": "success", "message": "Pedido aprovado e faturado",
                        "data": {"venda_codigo": codigo_venda, "venda_id": venda.id,
                                 "parcelas": len(parcelas), "total": float(pedido.total)}}), 200
    except EstoqueInsuficienteError as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        import traceback; traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


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
