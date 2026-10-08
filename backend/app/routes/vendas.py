from datetime import timezone
# app/routes/vendas.py – VERSÃO COMPLETA ADAPTADA PARA MÚLTIPLOS PAGAMENTOS
# Compatível com o novo models.py (tabela Pagamento)
# Todas as rotas originais mantidas e funcionais.

from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from flask import Blueprint, request, jsonify, Response, current_app
from app import db
from app.utils.timezone import fmt_local, local_date_to_utc_naive
from app.models import (
    Venda,
    VendaItem,
    Produto,
    Funcionario,
    MovimentacaoEstoque,
    Cliente,
    Fornecedor,
    Estabelecimento,
    MovimentacaoCaixa,
    ContaReceber,
    Caixa,
    Pagamento,
)
from flask_jwt_extended import jwt_required, get_jwt
from app.decorators.plan_guards import permission_required, normalize_plan
from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id, get_dow_extract, get_hour_extract
from sqlalchemy import or_, func, distinct, select
from collections import defaultdict
import random
import string
import io
import csv

vendas_bp = Blueprint("vendas", __name__)

# ------------------------------------------------------------------------------
# CONSTANTES E FUNÇÕES AUXILIARES (ADAPTADAS)
# ------------------------------------------------------------------------------

FILTROS_PERMITIDOS_VENDAS = {
    "codigo": lambda value: ilike_unaccent(Venda.codigo, f"%{value}%"),
    "cliente_nome": lambda value: ilike_unaccent(Cliente.nome, f"%{value}%"),
    "cliente_cpf": lambda value: ilike_unaccent(Cliente.cpf, f"%{value}%"),
    "funcionario_nome": lambda value: ilike_unaccent(Funcionario.nome, f"%{value}%"),
    "status": lambda value: ilike_unaccent(Venda.status, value),
    "observacoes": lambda value: ilike_unaccent(Venda.observacoes, f"%{value}%"),
}

ORDENACOES_PERMITIDAS = {
    "data": Venda.data_venda,
    "total": Venda.total,
    "codigo": Venda.codigo,
    "cliente_nome": Cliente.nome,
    "funcionario_nome": Funcionario.nome,
}


def _norm_forma_pagamento(nome):
    if not nome:
        return "dinheiro"
    nome = nome.lower().strip()
    if "crédito" in nome or "credito" in nome:
        return "cartao_credito"
    if "débito" in nome or "debito" in nome:
        return "cartao_debito"
    if "dinheiro" in nome:
        return "dinheiro"
    if "pix" in nome:
        return "pix"
    if "fiado" in nome:
        return "fiado"
    if "alimentação" in nome or "alimentacao" in nome:
        return "vale_alimentacao"
    if "refeição" in nome or "refeicao" in nome:
        return "vale_refeicao"
    return (
        nome.replace(" ", "_")
        .replace("ã", "a")
        .replace("é", "e")
        .replace("ê", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ç", "c")
    )

def gerar_codigo_venda():
    """Gera código único para venda no formato V-YYYYMMDD-XXXX"""
    data_atual = datetime.now().strftime("%Y%m%d")
    random_part = "".join(random.choices(string.digits, k=4))
    return f"V-{data_atual}-{random_part}"

def aplicar_filtros_avancados_vendas(query, filtros, estabelecimento_id):
    """Aplica filtros avançados na query de vendas, compatível com múltiplos pagamentos."""
    if estabelecimento_id and str(estabelecimento_id).lower() != 'all':
        query = query.filter(Venda.estabelecimento_id == estabelecimento_id)

    for chave, valor in filtros.items():
        if chave in FILTROS_PERMITIDOS_VENDAS and valor:
            query = query.filter(FILTROS_PERMITIDOS_VENDAS[chave](valor))

    # Filtro por forma de pagamento (subconsulta na tabela Pagamento)
    if filtros.get("forma_pagamento"):
        sub = db.session.query(Pagamento.venda_id).filter(
            ilike_unaccent(Pagamento.forma_pagamento, f"%{filtros['forma_pagamento']}%")
        ).subquery()
        query = query.filter(Venda.id.in_(select(sub)))

    if not filtros.get("status"):
        query = query.filter(Venda.status == "finalizada")

    # Filtro por data. Datas "puras" (YYYY-MM-DD, sem hora) vêm do frontend
    # representando o dia LOCAL da loja (ex.: botões "Hoje"/"7 dias" do
    # SalesPage) — precisam ser convertidas para o instante UTC equivalente
    # antes de comparar com a coluna do banco (UTC naive). Sem essa conversão,
    # a fronteira do dia ficava deslocada em 3h (perdia vendas do fim da noite
    # local / bug relatado como "filtro de período não funciona direito").
    # Timestamps completos (com T e hora) são tratados como já em UTC.
    for filtro_data in ["data_inicio", "data_fim"]:
        val = filtros.get(filtro_data)
        if val:
            try:
                data_str = val.strip()
                eh_dia_puro = len(data_str) <= 10
                if eh_dia_puro:
                    campo = func.coalesce(Venda.data_venda, Venda.created_at)
                    if filtro_data == "data_inicio":
                        query = query.filter(campo >= local_date_to_utc_naive(data_str))
                    else:
                        query = query.filter(campo <= local_date_to_utc_naive(data_str, fim_do_dia=True))
                else:
                    data_dt = None
                    try:
                        data_dt = datetime.fromisoformat(data_str.replace('Z', '+00:00'))
                    except ValueError:
                        pass
                    if data_dt:
                        campo = func.coalesce(Venda.data_venda, Venda.created_at)
                        if filtro_data == "data_inicio":
                            query = query.filter(campo >= data_dt)
                        else:
                            query = query.filter(campo <= data_dt)
            except Exception:
                pass

    # Filtros numéricos
    for key, field in [("min_total", Venda.total), ("max_total", Venda.total),
                       ("min_valor_recebido", Venda.valor_recebido), ("max_valor_recebido", Venda.valor_recebido)]:
        val = filtros.get(key)
        if val:
            try:
                if key.startswith("min"):
                    query = query.filter(field >= float(val))
                else:
                    query = query.filter(field <= float(val))
            except ValueError:
                pass

    if "cliente_id" in filtros and filtros["cliente_id"]:
        try:
            query = query.filter(Venda.cliente_id == int(filtros["cliente_id"]))
        except ValueError:
            pass
    if "funcionario_id" in filtros and filtros["funcionario_id"]:
        try:
            query = query.filter(Venda.funcionario_id == int(filtros["funcionario_id"]))
        except ValueError:
            pass

    if "produto_nome" in filtros and filtros["produto_nome"]:
        query = query.join(VendaItem).join(Produto).filter(
            or_(
                ilike_unaccent(Produto.nome, f"%{filtros['produto_nome']}%"),
                ilike_unaccent(Produto.codigo_barras, f"%{filtros['produto_nome']}%"),
            )
        )

    tipo = filtros.get("tipo_venda")
    if tipo:
        if tipo == "com_cliente":
            query = query.filter(Venda.cliente_id.isnot(None))
        elif tipo == "sem_cliente":
            query = query.filter(Venda.cliente_id.is_(None))
        elif tipo == "com_desconto":
            query = query.filter(Venda.desconto > 0)
        elif tipo == "sem_desconto":
            query = query.filter(Venda.desconto == 0)

    if "dia_semana" in filtros and filtros["dia_semana"]:
        try:
            dia_num = int(filtros["dia_semana"])
            query = query.filter(get_dow_extract(Venda.data_venda) == dia_num)
        except ValueError:
            pass

    return query

def aplicar_ordenacao_vendas(query, ordenar_por, direcao):
    """Aplica ordenação na query de vendas."""
    if ordenar_por in ORDENACOES_PERMITIDAS:
        campo = ORDENACOES_PERMITIDAS[ordenar_por]
        query = query.order_by(campo.desc() if direcao.lower() == "desc" else campo.asc())
    else:
        query = query.order_by(Venda.data_venda.desc())
    return query

def calcular_estatisticas_vendas(query_base, estabelecimento_id):
    """Calcula estatísticas agregadas das vendas filtradas usando SQL eficiente."""
    ids_sub = query_base.with_entities(Venda.id).subquery()
    ids_select = db.session.query(ids_sub.c.id)

    resumo = db.session.query(
        func.count(Venda.id).label('quantidade'),
        func.sum(Venda.total).label('total'),
        func.sum(Venda.desconto).label('descontos'),
        func.sum(Venda.valor_recebido).label('valor_recebido')
    ).filter(Venda.id.in_(ids_select)).first()

    stats_itens = db.session.query(
        func.sum(VendaItem.margem_lucro_real).label('lucro'),
        func.sum(VendaItem.quantidade).label('total_itens')
    ).filter(VendaItem.venda_id.in_(ids_select)).first()

    quantidade = resumo.quantidade or 0
    total = float(resumo.total or 0)
    total_lucro = float(stats_itens.lucro or 0)
    descontos = float(resumo.descontos or 0)
    valor_recebido = float(resumo.valor_recebido or 0)
    total_itens = int(stats_itens.total_itens or 0)
    ticket_medio = total / quantidade if quantidade > 0 else 0

    formas = db.session.query(
        Pagamento.forma_pagamento,
        func.count(Pagamento.id).label("quantidade"),
        func.sum(Pagamento.valor).label("total")
    ).filter(Pagamento.venda_id.in_(ids_select)).group_by(Pagamento.forma_pagamento).all()

    def _norm(n):
        if not n: return 'dinheiro'
        n = n.lower().strip()
        if 'crédito' in n or 'credito' in n: return 'cartao_credito'
        if 'débito' in n or 'debito' in n: return 'cartao_debito'
        if 'dinheiro' in n: return 'dinheiro'
        if 'pix' in n: return 'pix'
        if 'fiado' in n: return 'fiado'
        if 'alimentação' in n or 'alimentacao' in n: return 'vale_alimentacao'
        if 'refeição' in n or 'refeicao' in n: return 'vale_refeicao'
        return n.replace(" ", "_").replace("ã", "a").replace("é", "e").replace("ê", "e").replace("í", "i").replace("ó", "o").replace("ç", "c")

    formas_dict = {}
    for f in formas:
        norm_key = _norm(f.forma_pagamento)
        if norm_key not in formas_dict:
            formas_dict[norm_key] = {"quantidade": 0, "total": 0.0}
        formas_dict[norm_key]["quantidade"] += f.quantidade
        formas_dict[norm_key]["total"] += float(f.total or 0)

    datas = query_base.with_entities(
        func.min(Venda.data_venda).label("inicio"),
        func.max(Venda.data_venda).label("fim")
    ).first()

    return {
        "total_valor": total,
        "total_vendas": total,
        "total_faturado": total,
        "total_lucro": total_lucro,
        "quantidade_vendas": quantidade,
        "ticket_medio": ticket_medio,
        "total_descontos": descontos,
        "total_valor_recebido": valor_recebido,
        "total_itens": total_itens,
        "formas_pagamento": formas_dict,
        "periodo": {
            "data_inicio": datas.inicio.isoformat() if datas and datas.inicio else None,
            "data_fim": datas.fim.isoformat() if datas and datas.fim else None
        }
    }

# ------------------------------------------------------------------------------
# ROTA DE LISTAGEM PRINCIPAL
# ------------------------------------------------------------------------------

@vendas_bp.route("/", methods=["GET"], strict_slashes=False)
@jwt_required()
def listar_vendas():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        page = request.args.get("page", 1, type=int)
        per_page = min(request.args.get("per_page", 50, type=int), 500)
        ordenar_por = request.args.get("ordenar_por", "data")
        direcao = request.args.get("direcao", "desc")
        search = request.args.get("search", "").strip()

        filtros = {}
        for key in list(FILTROS_PERMITIDOS_VENDAS.keys()) + ["forma_pagamento"]:
            val = request.args.get(key, "").strip()
            if val:
                filtros[key] = val
        for special in ["data_inicio", "data_fim", "min_total", "max_total",
                        "min_valor_recebido", "max_valor_recebido", "cliente_id",
                        "funcionario_id", "produto_nome", "tipo_venda", "dia_semana"]:
            val = request.args.get(special, "").strip()
            if val:
                filtros[special] = val

        query_base = Venda.query

        if search:
            query_base = query_base.filter(
                or_(
                    ilike_unaccent(Venda.codigo, f"%{search}%"),
                    ilike_unaccent(Venda.observacoes, f"%{search}%"),
                    ilike_unaccent(Cliente.nome, f"%{search}%"),
                    ilike_unaccent(Cliente.cpf, f"%{search}%"),
                    ilike_unaccent(Funcionario.nome, f"%{search}%"),
                )
            )

        query_base = aplicar_filtros_avancados_vendas(query_base, filtros, estabelecimento_id)

        estatisticas = calcular_estatisticas_vendas(query_base, estabelecimento_id)

        query_resultados = query_base.options(
            db.joinedload(Venda.funcionario),
            db.joinedload(Venda.cliente),
            db.selectinload(Venda.itens),
            db.selectinload(Venda.pagamentos)
        )
        query_resultados = aplicar_ordenacao_vendas(query_resultados, ordenar_por, direcao)

        pagination = query_resultados.paginate(page=page, per_page=per_page, error_out=False)
        vendas = pagination.items

        resultado = []
        for v in vendas:
            formas = [p.forma_pagamento for p in v.pagamentos if p.status == "aprovado"]
            forma_principal = formas[0] if formas else "Não informado"
            if len(formas) > 1:
                forma_principal += f" +{len(formas)-1}"

            resultado.append({
                "id": v.id,
                "codigo": v.codigo,
                "cliente": {
                    "id": v.cliente_id,
                    "nome": v.cliente.nome if v.cliente else "Consumidor Final",
                    "telefone": v.cliente.telefone if v.cliente else None,
                    "cpf": v.cliente.cpf if v.cliente else None,
                } if v.cliente_id else {"nome": "Consumidor Final"},
                "funcionario": {
                    "id": v.funcionario_id,
                    "nome": v.funcionario.nome if v.funcionario else "Não Informado",
                    "email": v.funcionario.email if v.funcionario else None,
                },
                "subtotal": float(v.subtotal),
                "desconto": float(v.desconto),
                "total": float(v.total),
                "forma_pagamento": forma_principal,
                "valor_recebido": float(v.valor_recebido),
                "troco": float(v.troco),
                "status": v.status,
                "data_venda": ((v.data_venda or v.created_at).replace(tzinfo=timezone.utc).isoformat()) if (v.data_venda or v.created_at) else None,
                # data_formatada já convertida para o fuso LOCAL da loja (era exibido
                # em UTC — 3h adiantado — porque fazia strftime no valor UTC cru).
                "data_formatada": fmt_local(v.data_venda if v.data_venda else v.created_at),
                "quantidade_itens": len(v.itens),
                "observacoes": v.observacoes or "",
                "detalhes_url": f"/api/vendas/{v.id}",
            })

        paginacao = {
            "pagina": pagination.page,
            "pagina_atual": pagination.page,
            "total_paginas": pagination.pages,
            "total": pagination.total,
            "total_itens": pagination.total,
            "itens_por_pagina": pagination.per_page,
            "tem_proxima": pagination.has_next,
            "tem_anterior": pagination.has_prev,
            "filtros_aplicados": filtros if filtros else None,
            "busca_global": search if search else None,
            "ordenacao": {"campo": ordenar_por, "direcao": direcao},
            "estatisticas": {
                "total_valor": float(estatisticas["total_valor"]),
                "total_vendas": float(estatisticas["total_vendas"]),
                "total_lucro": float(estatisticas["total_lucro"]),
                "quantidade_vendas": estatisticas["quantidade_vendas"],
                "ticket_medio": float(estatisticas["ticket_medio"]),
                "total_descontos": float(estatisticas["total_descontos"]),
                "total_valor_recebido": float(estatisticas["total_valor_recebido"]),
                "total_itens": estatisticas["total_itens"],
                "formas_pagamento": estatisticas["formas_pagamento"],
            },
            "filtros_disponiveis": list(FILTROS_PERMITIDOS_VENDAS.keys()) + ["forma_pagamento"] + [
                "data_inicio", "data_fim", "min_total", "max_total", "min_valor_recebido",
                "max_valor_recebido", "cliente_id", "funcionario_id", "produto_nome", "tipo_venda", "dia_semana"
            ],
            "ordenacoes_disponiveis": list(ORDENACOES_PERMITIDAS.keys()),
        }

        return jsonify({"vendas": resultado, "ponto_venda": "PDV 01", "paginacao": paginacao})
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao listar vendas: {str(e)}")
        return jsonify({"error": f"Erro ao listar vendas: {str(e)}"}), 500

# Continuação direta da Parte 1

@vendas_bp.route("/estatisticas", methods=["GET"], strict_slashes=False)
@jwt_required()
@permission_required('financeiro')
def estatisticas_vendas():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        filtros = {k: v for k, v in request.args.items() if v}
        data_inicio = filtros.get("data_inicio")
        data_fim = filtros.get("data_fim")

        query_base = Venda.query
        query_base = aplicar_filtros_avancados_vendas(query_base, filtros, estabelecimento_id)
        ids_sub = query_base.with_entities(Venda.id).subquery()
        ids_select = db.session.query(ids_sub.c.id)

        stats_gerais = db.session.query(
            func.count(Venda.id).label("total_vendas_count"),
            func.sum(Venda.total).label("total_valor")
        ).filter(Venda.id.in_(ids_select)).first()

        total_vendas_count = stats_gerais.total_vendas_count or 0
        total_valor = float(stats_gerais.total_valor or 0)

        stats_itens = db.session.query(
            func.sum(VendaItem.margem_lucro_real).label("total_lucro"),
            func.sum(VendaItem.quantidade).label("total_itens")
        ).filter(VendaItem.venda_id.in_(ids_select)).first()
        total_lucro = float(stats_itens.total_lucro or 0)
        total_itens_venda = float(stats_itens.total_itens or 0)

        ticket_medio = total_valor / total_vendas_count if total_vendas_count > 0 else 0
        itens_por_venda = total_itens_venda / total_vendas_count if total_vendas_count > 0 else 0

        campo_data_dia = func.date(func.coalesce(Venda.data_venda, Venda.created_at))
        vendas_por_dia_res = db.session.query(
            campo_data_dia.label("data"),
            func.count(Venda.id).label("quantidade"),
            func.sum(Venda.total).label("total")
        ).filter(Venda.id.in_(ids_select)).group_by(campo_data_dia).order_by(campo_data_dia.asc()).all()

        previsao_vendas = []
        if len(vendas_por_dia_res) >= 7:
            valores_y = [float(v.total or 0) for v in vendas_por_dia_res]
            n = len(valores_y)
            valores_x = list(range(n))
            media_x = sum(valores_x) / n
            media_y = sum(valores_y) / n
            numerador = sum((valores_x[i] - media_x) * (valores_y[i] - media_y) for i in range(n))
            denominador = sum((valores_x[i] - media_x) ** 2 for i in range(n))
            if denominador != 0:
                b = numerador / denominador
                a = media_y - b * media_x
                ultima_data_str = str(vendas_por_dia_res[-1].data)
                ultima_data = datetime.strptime(ultima_data_str, '%Y-%m-%d').date()
                for i in range(1, 8):
                    proxima_data = ultima_data + timedelta(days=i)
                    x_futuro = n + i - 1
                    valor_previsto = max(0, a + b * x_futuro)
                    previsao_vendas.append({"data": proxima_data.isoformat(), "total": round(valor_previsto, 2), "tipo": "previsao"})

        vendas_historicas = [{"data": str(v.data), "quantidade": v.quantidade, "total": float(v.total or 0), "tipo": "historico"} for v in vendas_por_dia_res]

        from sqlalchemy import case
        formas_pgto_raw = db.session.query(
            Pagamento.forma_pagamento,
            func.count(Pagamento.id).label("quantidade"),
            func.sum(
                case(
                    (Pagamento.forma_pagamento == 'dinheiro', Pagamento.valor - func.coalesce(Venda.troco, 0)),
                    else_=Pagamento.valor
                )
            ).label("total")
        ).join(Venda, Venda.id == Pagamento.venda_id).filter(
            Pagamento.venda_id.in_(ids_select)
        ).group_by(Pagamento.forma_pagamento).all()

        def _norm(nome):
            return _norm_forma_pagamento(nome)

        formas_pgto_agrupadas = {}
        for fp in formas_pgto_raw:
            nk = _norm(fp[0])
            if nk not in formas_pgto_agrupadas:
                formas_pgto_agrupadas[nk] = {"quantidade": 0, "total": 0.0}
            formas_pgto_agrupadas[nk]["quantidade"] += fp[1]
            formas_pgto_agrupadas[nk]["total"] += float(fp[2] or 0)
            
        formas_pgto_res = [
            (k, v["quantidade"], v["total"]) 
            for k, v in formas_pgto_agrupadas.items()
        ]

        vendas_func_res = query_base.join(Funcionario).with_entities(
            Funcionario.nome, func.count(Venda.id), func.sum(Venda.total)
        ).group_by(Funcionario.id, Funcionario.nome).order_by(func.sum(Venda.total).desc()).limit(10).all()

        vendas_cliente_res = query_base.join(Cliente).with_entities(
            Cliente.nome, func.count(Venda.id), func.sum(Venda.total)
        ).group_by(Cliente.id, Cliente.nome).order_by(func.sum(Venda.total).desc()).limit(10).all()

        campo_hora = get_hour_extract(func.coalesce(Venda.data_venda, Venda.created_at))
        vendas_hora_res = db.session.query(
            campo_hora, func.count(Venda.id), func.sum(Venda.total)
        ).filter(Venda.id.in_(ids_select)).group_by(campo_hora).all()

        produtos_res = db.session.query(
            Produto.nome, Fornecedor.nome_fantasia,
            func.sum(VendaItem.quantidade), func.sum(VendaItem.total_item)
        ).join(VendaItem, VendaItem.produto_id == Produto.id).outerjoin(Fornecedor).filter(
            VendaItem.venda_id.in_(ids_select)
        ).group_by(Produto.id, Produto.nome, Fornecedor.nome_fantasia).order_by(func.sum(VendaItem.quantidade).desc()).limit(10).all()

        fornecedores_res = db.session.query(
            Fornecedor.nome_fantasia,
            func.count(distinct(VendaItem.venda_id)),
            func.sum(VendaItem.total_item)
        ).join(Produto, Produto.fornecedor_id == Fornecedor.id).join(VendaItem).filter(
            VendaItem.venda_id.in_(ids_select)
        ).group_by(Fornecedor.id, Fornecedor.nome_fantasia).order_by(func.sum(VendaItem.total_item).desc()).limit(10).all()

        return jsonify({
            "estatisticas_gerais": {
                "quantidade_vendas": total_vendas_count,
                "total_vendas": total_valor,
                "total_valor": total_valor,
                "total_lucro": total_lucro,
                "total_itens": total_itens_venda,
                "ticket_medio": float(ticket_medio),
                "itens_por_venda": float(itens_por_venda),
                "periodo": {"data_inicio": data_inicio, "data_fim": data_fim},
            },
            "vendas_por_dia": vendas_historicas,
            "previsao_vendas": previsao_vendas,
            "formas_pagamento": [
                {"forma": fp[0], "quantidade": fp[1], "total": float(fp[2] or 0),
                 "percentual": (float(fp[2] or 0) / total_valor * 100) if total_valor > 0 else 0.0}
                for fp in formas_pgto_res
            ],
            "vendas_por_funcionario": [{"funcionario": v[0], "quantidade": v[1], "total": float(v[2] or 0)} for v in vendas_func_res],
            "vendas_por_cliente": [{"cliente": v[0], "quantidade": v[1], "total": float(v[2] or 0)} for v in vendas_cliente_res],
            "vendas_por_hora": [{"hora": int(v[0] or 0), "quantidade": v[1], "total": float(v[2] or 0)} for v in vendas_hora_res],
            "produtos_mais_vendidos": [{"nome": p[0], "fornecedor": p[1] or "Sem Fornecedor", "quantidade": p[2], "total": float(p[3] or 0)} for p in produtos_res],
            "vendas_por_fornecedor": [{"fornecedor": f[0], "quantidade_vendas": f[1], "total": float(f[2] or 0)} for f in fornecedores_res],
        }), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao obter estatísticas: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Erro ao obter estatísticas: {str(e)}"}), 500


@vendas_bp.route("/relatorio-diario", methods=["GET"])
@jwt_required()
def relatorio_diario():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        data_str = request.args.get("data", datetime.now().strftime("%Y-%m-%d"))
        formato = request.args.get("formato", "json")

        try:
            data_dt = datetime.strptime(data_str, "%Y-%m-%d")
        except ValueError:
            data_dt = datetime.now()

        inicio_dia = datetime.combine(data_dt.date(), datetime.min.time())
        fim_dia = datetime.combine(data_dt.date(), datetime.max.time())

        query = Venda.query.filter(
            Venda.status == "finalizada",
            func.coalesce(Venda.data_venda, Venda.created_at) >= inicio_dia,
            func.coalesce(Venda.data_venda, Venda.created_at) <= fim_dia
        )
        if estabelecimento_id and str(estabelecimento_id).lower() != 'all':
            query = query.filter(Venda.estabelecimento_id == estabelecimento_id)
        vendas = query.options(
            db.joinedload(Venda.itens),
            db.joinedload(Venda.funcionario),
            db.joinedload(Venda.cliente),
            db.selectinload(Venda.pagamentos),
        ).order_by(Venda.created_at.desc()).all()

        total_vendas = sum(v.total for v in vendas)
        total_descontos = sum(v.desconto for v in vendas)
        quantidade_vendas = len(vendas)
        ticket_medio = total_vendas / quantidade_vendas if quantidade_vendas > 0 else 0

        formas_pagamento = defaultdict(lambda: {"quantidade": 0, "total": 0})
        for v in vendas:
            for p in v.pagamentos:
                if p.status == "aprovado":
                    nk = _norm(p.forma_pagamento)
                    formas_pagamento[nk]["quantidade"] += 1
                    formas_pagamento[nk]["total"] += float(p.valor)

        funcionarios = defaultdict(lambda: {"quantidade": 0, "total": 0, "nome": ""})
        for v in vendas:
            if v.funcionario:
                func_id = v.funcionario.id
                funcionarios[func_id]["quantidade"] += 1
                funcionarios[func_id]["total"] += float(v.total)
                funcionarios[func_id]["nome"] = v.funcionario.nome

        produtos_dia = defaultdict(lambda: {"quantidade": 0, "total": 0, "nome": ""})
        for v in vendas:
            for item in v.itens:
                produtos_dia[item.produto_id]["quantidade"] += float(item.quantidade)
                produtos_dia[item.produto_id]["total"] += float(item.total_item)
                produtos_dia[item.produto_id]["nome"] = item.produto_nome

        vendas_por_hora = defaultdict(lambda: {"quantidade": 0, "total": 0})
        for v in vendas:
            hora = v.created_at.hour
            vendas_por_hora[hora]["quantidade"] += 1
            vendas_por_hora[hora]["total"] += float(v.total)

        if formato == "json":
            return jsonify({
                "data": data_str,
                "resumo": {
                    "total_vendas": float(total_vendas),
                    "quantidade_vendas": quantidade_vendas,
                    "ticket_medio": float(ticket_medio),
                    "total_descontos": float(total_descontos),
                },
                "formas_pagamento": dict(formas_pagamento),
                "funcionarios": [
                    {"id": func_id, "nome": dados["nome"], "quantidade": dados["quantidade"], "total": dados["total"]}
                    for func_id, dados in funcionarios.items()
                ],
                "produtos_mais_vendidos": [
                    {"produto_id": prod_id, "nome": dados["nome"], "quantidade": dados["quantidade"], "total": dados["total"]}
                    for prod_id, dados in sorted(produtos_dia.items(), key=lambda x: x[1]["quantidade"], reverse=True)[:10]
                ],
                "vendas_por_hora": [
                    {"hora": hora, "quantidade": dados["quantidade"], "total": dados["total"]}
                    for hora, dados in sorted(vendas_por_hora.items())
                ],
                "vendas": [
                    {
                        "id": v.id,
                        "codigo": v.codigo,
                        "cliente": v.cliente.nome if v.cliente else "Consumidor Final",
                        "funcionario": v.funcionario.nome if v.funcionario else "Não Informado",
                        "total": float(v.total),
                        "forma_pagamento": (v.pagamentos[0].forma_pagamento if v.pagamentos else "N/A"),
                        "hora": v.created_at.strftime("%H:%M"),
                        "quantidade_itens": len(v.itens),
                    }
                    for v in vendas
                ],
            }), 200
        else:
            return jsonify({"error": "Formato não suportado"}), 400
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao gerar relatório diário: {str(e)}")
        return jsonify({"error": f"Erro ao gerar relatório diário: {str(e)}"}), 500


@vendas_bp.route("/analise-tendencia", methods=["GET"])
@jwt_required()
@permission_required('financeiro')
def analise_tendencia():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        periodo = request.args.get("periodo", "mensal")
        meses = int(request.args.get("meses", 6))

        data_fim = datetime.now()
        data_inicio = data_fim - timedelta(days=30 * meses)

        query = Venda.query.filter(
            Venda.estabelecimento_id == estabelecimento_id,
            Venda.status == "finalizada",
            Venda.created_at >= data_inicio,
            Venda.created_at <= data_fim,
        )

        resultados = []

        if periodo == "diario":
            vendas_por_dia = db.session.query(
                func.date(Venda.created_at).label("data"),
                func.count(Venda.id).label("quantidade"),
                func.sum(Venda.total).label("total"),
            ).filter(
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.status == "finalizada"
            ).group_by(func.date(Venda.created_at)).order_by(func.date(Venda.created_at).desc()).limit(30).all()
            for vpd in vendas_por_dia:
                resultados.append({
                    "periodo": vpd.data.strftime("%d/%m/%Y"),
                    "quantidade": vpd.quantidade,
                    "total": float(vpd.total) if vpd.total else 0,
                })
        elif periodo == "semanal":
            for i in range(meses * 4):
                semana_fim = data_fim - timedelta(weeks=i)
                semana_inicio = semana_fim - timedelta(weeks=1)
                vendas_semana = query.filter(
                    Venda.created_at >= semana_inicio,
                    Venda.created_at <= semana_fim,
                ).all()
                resultados.append({
                    "periodo": f"Semana {i+1} ({semana_inicio.strftime('%d/%m')} - {semana_fim.strftime('%d/%m')})",
                    "quantidade": len(vendas_semana),
                    "total": sum(v.total for v in vendas_semana),
                })
        else:
            for i in range(meses):
                mes_fim = data_fim - timedelta(days=30 * i)
                mes_inicio = mes_fim - timedelta(days=30)
                vendas_mes = query.filter(
                    Venda.created_at >= mes_inicio,
                    Venda.created_at <= mes_fim,
                ).all()
                total_mes = sum(v.total for v in vendas_mes)
                resultados.append({
                    "periodo": mes_inicio.strftime("%B %Y"),
                    "quantidade": len(vendas_mes),
                    "total": total_mes,
                    "ticket_medio": total_mes / len(vendas_mes) if vendas_mes else 0,
                })

        if len(resultados) > 1:
            for i in range(len(resultados) - 1):
                atual = resultados[i]["total"]
                anterior = resultados[i + 1]["total"]
                crescimento = ((atual - anterior) / anterior * 100) if anterior > 0 else (100 if atual > 0 else 0)
                resultados[i]["crescimento"] = round(crescimento, 2)

        return jsonify({
            "periodo_analisado": periodo,
            "meses_analisados": meses,
            "data_inicio": data_inicio.strftime("%Y-%m-%d"),
            "data_fim": data_fim.strftime("%Y-%m-%d"),
            "resultados": resultados,
            "total_geral": sum(r["total"] for r in resultados),
            "media_mensal": sum(r["total"] for r in resultados) / len(resultados) if resultados else 0,
        }), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro na análise de tendência: {str(e)}")
        return jsonify({"error": f"Erro na análise de tendência: {str(e)}"}), 500


@vendas_bp.route("/", methods=["POST", "OPTIONS"], strict_slashes=False)
@jwt_required(optional=True)
@permission_required('vendas')
def criar_venda():
    try:
        claims = get_jwt()
        estabelecimento_id = claims.get("estabelecimento_id")
        # Sem fallback para "estabelecimento 1": um token sem estabelecimento concreto
        # (ausente ou "all", caso de super admin sem loja selecionada) não pode gerar venda.
        if not estabelecimento_id or str(estabelecimento_id).lower() == "all":
            current_app.logger.error(
                f"criar_venda bloqueada: estabelecimento_id ausente ou não concreto no JWT (valor={estabelecimento_id!r})"
            )
            return jsonify({"error": "Estabelecimento não identificado no token de autenticação."}), 401
        try:
            estabelecimento_id = int(estabelecimento_id)
        except (ValueError, TypeError):
            current_app.logger.error(
                f"criar_venda bloqueada: estabelecimento_id inválido no JWT (valor={estabelecimento_id!r})"
            )
            return jsonify({"error": "Estabelecimento inválido no token de autenticação."}), 401
        data = request.get_json()
        if not isinstance(data, dict) or not data.get("items"):
            return jsonify({"error": "Dados inválidos ou carrinho vazio"}), 400

        try:
            subtotal = float(data.get("subtotal", 0))
            desconto = float(data.get("desconto", 0))
            total = float(data.get("total", 0))
            cliente_id = data.get("cliente_id")
            if subtotal < 0 or desconto < 0 or total < 0:
                return jsonify({"error": "Valores negativos não permitidos"}), 400
        except ValueError:
            return jsonify({"error": "Valores numéricos inválidos"}), 400

        estabelecimento = Estabelecimento.query.get(estabelecimento_id)
        if not estabelecimento:
            return jsonify({"error": "Estabelecimento não encontrado"}), 404

        codigo_venda = gerar_codigo_venda()
        while Venda.query.filter_by(estabelecimento_id=estabelecimento_id, codigo=codigo_venda).first():
            codigo_venda = gerar_codigo_venda()

        pagamentos_data = data.get("pagamentos", [])
        if not pagamentos_data:
            payment_method = data.get("paymentMethod") or "dinheiro"
            forma = payment_method.lower()
            valor_recebido = float(data.get("cashReceived", total))
            pagamentos_data = [{"forma": forma, "valor": valor_recebido}]

        from app.utils.sale_validation import validate_sale
        try:
            subtotal, desconto, total = validate_sale(data, pagamentos_data)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        total_pago = sum(Decimal(str(p['valor'])) for p in pagamentos_data)
        from app.utils.checkout_locking import lock_checkout, validate_credit
        try:
            locked_client = lock_checkout(estabelecimento_id, claims.get('sub'), data['items'], cliente_id, data.get('offline_uuid'))
            if data.get('offline_uuid'):
                previous = Venda.query.filter_by(estabelecimento_id=estabelecimento_id, offline_uuid=data['offline_uuid']).first()
                if previous:
                    return jsonify({'success': True, 'idempotente': True, 'venda': previous.to_dict()}), 200
            validate_credit(locked_client, pagamentos_data)
            from app.utils.checkout_locking import validate_pricing
            validate_pricing(request.current_user, data['items'], desconto, estabelecimento_id)
        except (ValueError, TypeError) as error:
            db.session.rollback()
            return jsonify({'error': str(error)}), 400
        if total_pago < total:
            return jsonify({"error": f"Valor total pago (R$ {total_pago:.2f}) é menor que o total da venda (R$ {total:.2f})"}), 400

        tem_restrito = any((p.get("forma_pagamento") or p.get("forma")) in ["fiado", "vale_alimentacao", "vale_refeicao"] for p in pagamentos_data)
        if cliente_id and not Cliente.query.filter_by(id=cliente_id, estabelecimento_id=estabelecimento_id).first():
            return jsonify({"error": "Cliente não encontrado neste estabelecimento"}), 404
        if any(p['forma'] == 'fiado' for p in pagamentos_data) and not cliente_id:
            return jsonify({"error": "Vendas no fiado exigem um cliente cadastrado"}), 400
        is_saas_admin = claims.get("is_super_admin", False)
        
        # O Admin logado acessa tudo na fase de teste
        from app.utils.query_helpers import get_funcionario_safe
        user_id = claims.get("sub", 1)
        func_dados = get_funcionario_safe(user_id) or {}
        is_local_admin = str(func_dados.get("role", "")).upper() == "ADMIN" or str(func_dados.get("cargo", "")).lower() in ["admin", "administrador"]

        if tem_restrito and not (is_saas_admin or is_local_admin):
            plano_atual = normalize_plan(getattr(estabelecimento, "plano", "Gratuito"))
            if plano_atual != "Pro":
                return jsonify({"error": "FUNCIONALIDADE_RESTRITA", "message": "Seu plano não permite vendas no FIADO/VALE."}), 403
            if not cliente_id:
                return jsonify({"error": "CLIENTE_OBRIGATORIO", "message": "Vendas no FIADO/VALE exigem um cliente cadastrado."}), 400

            cliente_obj = Cliente.query.get(cliente_id)
            if not cliente_obj:
                return jsonify({"error": "CLIENTE_NAO_ENCONTRADO", "message": "Cliente informado não foi encontrado."}), 404

            valor_restrito = sum(float(p.get("valor") or 0) for p in pagamentos_data if (p.get("forma_pagamento") or p.get("forma")) in ["fiado", "vale_alimentacao", "vale_refeicao"])
            limite = float(cliente_obj.limite_credito or 0)
            saldo_atual = float(cliente_obj.saldo_devedor or 0)

            if limite == 0:
                return jsonify({
                    "error": "SEM_LIMITE_CREDITO", 
                    "message": "Este cliente não possui limite de crédito aprovado (Limite R$ 0,00)."
                }), 400

            if (saldo_atual + valor_restrito) > limite:
                return jsonify({
                    "error": "LIMITE_CREDITO_EXCEDIDO", 
                    "message": f"Limite de crédito excedido. Limite: R$ {limite:.2f}, Saldo Atual: R$ {saldo_atual:.2f}, Tentativa de Compra: R$ {valor_restrito:.2f}"
                }), 400

        db.session.begin_nested()
        try:
            # Dinheiro entra na gaveta de quem vendeu (o mesmo caixa travado no checkout),
            # nunca no caixa aberto mais recente de outro operador.
            caixa_aberto = Caixa.query.filter_by(estabelecimento_id=estabelecimento_id, funcionario_id=int(claims["sub"]),
                                                 status="aberto").order_by(Caixa.data_abertura.desc()).first()

            nova_venda = Venda(
                estabelecimento_id=estabelecimento_id,
                codigo=codigo_venda,
                cliente_id=cliente_id,
                funcionario_id=claims["sub"],
                caixa_id=caixa_aberto.id if caixa_aberto else None,
                subtotal=subtotal,
                desconto=desconto,
                total=total,
                valor_recebido=total_pago,
                troco=max(0, total_pago - total),
                status="finalizada",
                observacoes=data.get("observacoes", ""),
                offline_uuid=data.get("offline_uuid"),
            )
            db.session.add(nova_venda)
            db.session.flush()

            from app.services.estoque_service import registrar_saida
            for item_data in data["items"]:
                # Extração robusta de campos (suporte a múltiplos padrões de frontend)
                produto_id = item_data.get("id") or item_data.get("productId") or item_data.get("produto_id")
                quantidade = Decimal(str(item_data.get("quantity") or item_data.get("quantidade", 1)))
                preco_unitario = Decimal(str(item_data.get("price") or item_data.get("preco_unitario", 0)))

                if not produto_id:
                    raise Exception("ID do produto não informado no item")

                # Lock pessimista para consistência ACID em concorrência
                produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=nova_venda.estabelecimento_id).with_for_update().first()
                if not produto:
                    raise Exception(f"Produto {produto_id} não encontrado neste estabelecimento")
                if not produto.ativo or produto.deleted_at is not None:
                    raise Exception("Produto inativo")

                total_item = (preco_unitario * quantidade).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                _, custo_unitario = registrar_saida(
                    produto, quantidade, venda_id=nova_venda.id, funcionario_id=nova_venda.funcionario_id,
                    motivo=f"Venda #{nova_venda.codigo}")
                venda_item = VendaItem(
                    venda_id=nova_venda.id,
                    estabelecimento_id=estabelecimento_id, # Usar variável local garantida
                    produto_id=produto_id,
                    quantidade=quantidade,
                    preco_unitario=preco_unitario,
                    desconto=Decimal("0"),
                    total_item=total_item,
                    produto_nome=produto.nome,
                    produto_codigo=produto.codigo_barras or produto.codigo_interno,
                    produto_unidade=produto.unidade_medida or "UN",
                    custo_unitario=custo_unitario,
                    margem_lucro_real=((preco_unitario - custo_unitario) * quantidade).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                )
                db.session.add(venda_item)

                produto.quantidade_vendida = Decimal(str(produto.quantidade_vendida or 0)) + quantidade
                produto.total_vendido = Decimal(str(produto.total_vendido or 0)) + total_item
                produto.ultima_venda = datetime.now(timezone.utc)

            # 3. Processar Pagamentos (Multi-Tender)
            troco_pendente = max(0, total_pago - total)
            for pgto in pagamentos_data:
                forma = (pgto.get("forma_pagamento") or pgto.get("forma") or "dinheiro").lower()
                valor_p = Decimal(str(pgto['valor']))
                
                pagamento = Pagamento(
                    venda_id=nova_venda.id,
                    estabelecimento_id=estabelecimento_id, # Usar variável local garantida
                    forma_pagamento=forma,
                    valor=valor_p,
                    bandeira=pgto.get("bandeira"),
                    ultimos_digitos=pgto.get("ultimos_digitos"),
                    parcelas=pgto.get("parcelas", 1),
                    codigo_voucher=pgto.get("codigo_voucher"),
                    prazo_dias=pgto.get("prazo_dias"),
                    status="aprovado",
                    data_pagamento=datetime.now(timezone.utc),
                )
                db.session.add(pagamento)

                # Fluxo de Caixa Centralizado
                if caixa_aberto and forma != "fiado":
                    mov_caixa = MovimentacaoCaixa(
                        caixa_id=caixa_aberto.id,
                        estabelecimento_id=nova_venda.estabelecimento_id,
                        tipo="venda",
                        valor=valor_p,
                        forma_pagamento=forma,
                        venda_id=nova_venda.id,
                        descricao=f"Venda PDV #{nova_venda.codigo}"
                    )
                    db.session.add(mov_caixa)
                    
                    # O saldo_atual da GAVETA física só contabiliza dinheiro
                    if forma == "dinheiro":
                        abatimento = min(valor_p, troco_pendente)
                        valor_liquido = valor_p - abatimento
                        troco_pendente -= abatimento
                        mov_caixa.valor = valor_liquido
                        caixa_aberto.saldo_atual = Decimal(str(caixa_aberto.saldo_atual or 0)) + valor_liquido

                # Lógica de Fiado (Contas a Receber)
                if forma == "fiado" and nova_venda.cliente_id:
                    # Verifica se o frontend mandou data_vencimento_fiado
                    data_vencimento_fiado = data.get("data_vencimento_fiado")
                    if data_vencimento_fiado:
                        vencimento = datetime.strptime(data_vencimento_fiado, "%Y-%m-%d").date()
                    else:
                        vencimento = datetime.now(timezone.utc).date() + timedelta(days=pgto.get("prazo_dias", 30))

                    conta = ContaReceber(
                        estabelecimento_id=nova_venda.estabelecimento_id,
                        cliente_id=nova_venda.cliente_id,
                        venda_id=nova_venda.id,
                        numero_documento=nova_venda.codigo,
                        valor_original=valor_p,
                        valor_atual=valor_p,
                        data_emissao=datetime.now(timezone.utc).date(),
                        data_vencimento=vencimento,
                        status="aberto",
                        observacoes=f"FIADO gerado via Venda #{nova_venda.codigo}"
                    )
                    db.session.add(conta)
                    if hasattr(nova_venda.cliente, 'saldo_devedor'):
                        nova_venda.cliente.saldo_devedor = Decimal(str(nova_venda.cliente.saldo_devedor or 0)) + valor_p

            db.session.commit()
            return jsonify({
                "success": True,
                "venda": {"id": nova_venda.id, "codigo": nova_venda.codigo, "total": float(nova_venda.total)},
                "mensagens": ["Venda finalizada com sucesso!"]
            }), 201

        except Exception as inner_e:
            db.session.rollback()
            return jsonify({"error": "FALHA_PROCESSAMENTO", "message": str(inner_e)}), 400

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ ERRO CRÍTICO VENDA: {str(e)}")
        return jsonify({"error": "Erro interno no servidor", "details": str(e)}), 500

# Continuação direta da Parte 2 – FINAL

@vendas_bp.route("/<int:venda_id>", methods=["GET"])
@jwt_required()
def obter_venda(venda_id):
    try:
        estabelecimento_id = get_authorized_establishment_id()
        query = Venda.query.filter_by(id=venda_id)
        if str(estabelecimento_id).lower() != 'all':
            query = query.filter_by(estabelecimento_id=estabelecimento_id)
            
        venda = query.options(
            db.joinedload(Venda.itens),
            db.joinedload(Venda.cliente),
            db.joinedload(Venda.funcionario),
            db.selectinload(Venda.pagamentos),
        ).first_or_404()

        mov_query = MovimentacaoEstoque.query.filter_by(venda_id=venda_id)
        if str(estabelecimento_id).lower() != 'all':
            mov_query = mov_query.filter_by(estabelecimento_id=estabelecimento_id)
        movimentacoes = mov_query.all()

        return jsonify({"venda": {
            "id": venda.id,
            "codigo": venda.codigo,
            "cliente": {
                "id": venda.cliente.id if venda.cliente else None,
                "nome": venda.cliente.nome if venda.cliente else "Consumidor Final",
                "telefone": venda.cliente.telefone if venda.cliente else None,
                "cpf": venda.cliente.cpf if venda.cliente else None
            },
            "funcionario": {
                "id": venda.funcionario.id if venda.funcionario else None,
                "nome": venda.funcionario.nome if venda.funcionario else "Não Informado",
                "email": venda.funcionario.email if venda.funcionario else None
            },
            "subtotal": float(venda.subtotal),
            "desconto": float(venda.desconto),
            "total": float(venda.total),
            "valor_recebido": float(venda.valor_recebido),
            "troco": float(venda.troco),
            "status": venda.status,
            "observacoes": venda.observacoes,
            "created_at": venda.created_at.isoformat(),
            "data_atualizacao": venda.updated_at.isoformat() if venda.updated_at else None,
            "itens": [
                {
                    "id": i.id,
                    "produto_id": i.produto_id,
                    "produto_nome": i.produto_nome,
                    "produto_codigo": i.produto_codigo,
                    "quantidade": float(i.quantidade),
                    "preco_unitario": float(i.preco_unitario),
                    "desconto": float(i.desconto),
                    "total_item": float(i.total_item),
                    "unidade_medida": i.produto_unidade
                } for i in venda.itens
            ],
            "pagamentos": [
                {
                    "forma_pagamento": p.forma_pagamento,
                    "valor": float(p.valor),
                    "status": p.status,
                    "parcelas": p.parcelas,
                    "bandeira": p.bandeira,
                    "ultimos_digitos": p.ultimos_digitos
                } for p in venda.pagamentos
            ],
            "movimentacoes_estoque": [
                {
                    "id": m.id,
                    "produto_id": m.produto_id,
                    "produto_nome": m.produto.nome if m.produto else "Produto Removido",
                    "tipo": m.tipo,
                    "quantidade": float(m.quantidade),
                    "quantidade_anterior": float(m.quantidade_anterior),
                    "quantidade_atual": float(m.quantidade_atual),
                    "motivo": m.motivo,
                    "data": m.created_at.isoformat()
                } for m in movimentacoes
            ],
        }}), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao obter venda: {str(e)}")
        return jsonify({"error": f"Erro ao obter venda: {str(e)}"}), 500


@vendas_bp.route("/vendas-do-dia", methods=["GET"])
@jwt_required()
def vendas_do_dia():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        hoje = datetime.now().date()
        amanha = hoje + timedelta(days=1)

        vendas_hoje = Venda.query.filter(
            Venda.estabelecimento_id == estabelecimento_id,
            Venda.created_at >= hoje,
            Venda.created_at < amanha,
            Venda.status == "finalizada",
        ).options(
            db.joinedload(Venda.funcionario),
            db.joinedload(Venda.itens),
            db.selectinload(Venda.pagamentos)
        ).order_by(Venda.created_at.desc()).all()

        total_hoje = sum(v.total for v in vendas_hoje)
        quantidade_vendas = len(vendas_hoje)

        formas_dict = defaultdict(lambda: {"quantidade": 0, "total": 0.0})
        for v in vendas_hoje:
            for p in v.pagamentos:
                if p.status == "aprovado":
                    formas_dict[p.forma_pagamento]["quantidade"] += 1
                    formas_dict[p.forma_pagamento]["total"] += float(p.valor)

        produtos_mais_vendidos = db.session.query(
            VendaItem.produto_nome,
            func.sum(VendaItem.quantidade).label("quantidade_total"),
            func.sum(VendaItem.total_item).label("total_vendido"),
        ).join(Venda).filter(
            Venda.estabelecimento_id == estabelecimento_id,
            Venda.created_at >= hoje,
            Venda.created_at < amanha,
            Venda.status == "finalizada",
        ).group_by(VendaItem.produto_nome).order_by(func.sum(VendaItem.quantidade).desc()).limit(10).all()

        return jsonify({
            "data": hoje.isoformat(),
            "vendas": [
                {
                    "id": v.id,
                    "codigo": v.codigo,
                    "cliente": v.cliente.nome if v.cliente else "Consumidor Final",
                    "funcionario": v.funcionario.nome if v.funcionario else "Não Informado",
                    "total": float(v.total),
                    "forma_pagamento": (v.pagamentos[0].forma_pagamento if v.pagamentos else "N/A"),
                    "hora": v.created_at.strftime("%H:%M"),
                    "quantidade_itens": len(v.itens)
                } for v in vendas_hoje
            ],
            "estatisticas": {
                "total_vendas": float(total_hoje),
                "quantidade_vendas": quantidade_vendas,
                "ticket_medio": float(total_hoje / quantidade_vendas) if quantidade_vendas > 0 else 0,
                "formas_pagamento": [
                    {"forma": k, "quantidade": v["quantidade"], "total": v["total"]}
                    for k, v in formas_dict.items()
                ],
                "produtos_mais_vendidos": [
                    {"nome": p.produto_nome, "quantidade": int(p.quantidade_total), "total_vendido": float(p.total_vendido)}
                    for p in produtos_mais_vendidos
                ],
            }
        }), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao obter vendas do dia: {str(e)}")
        return jsonify({"error": f"Erro ao obter vendas do dia: {str(e)}"}), 500


@vendas_bp.route("/<int:venda_id>/cancelar", methods=["POST"])
@jwt_required()
def cancelar_venda(venda_id):
    try:
        estabelecimento_id = get_authorized_establishment_id()
        data = request.get_json() or {}
        motivo = data.get("motivo", "Cancelamento solicitado pelo usuário")
        funcionario_id = get_jwt().get('sub')

        query = Venda.query.filter_by(id=venda_id)
        if str(estabelecimento_id).lower() != 'all':
            query = query.filter_by(estabelecimento_id=estabelecimento_id)
        venda = query.populate_existing().with_for_update().first_or_404()
        if venda.status == "cancelada":
            return jsonify({"error": "Esta venda já está cancelada"}), 400

        # ===== Autorização OBRIGATÓRIA (PIN de 4-6 dígitos OU senha de admin) =====
        # Apenas admin (nível 1) e gerente (nível 2) podem autorizar cancelamentos.
        from app.models import Funcionario
        from werkzeug.security import check_password_hash

        pin_cancelamento = (data.get("pin_cancelamento") or "").strip()
        senha_admin = data.get("senha_admin")

        autorizador = None
        if pin_cancelamento:
            # Localiza o admin/gerente do tenant cujo PIN confere (comparação por hash)
            candidatos = Funcionario.query.filter(
                Funcionario.estabelecimento_id == estabelecimento_id,
                Funcionario.pin_cancelamento.isnot(None),
                Funcionario.ativo == True,
            ).all()
            from app.decorators.rbac import nivel_do_role
            autorizador = next((f for f in candidatos if nivel_do_role(f.role) <= 2 and f.check_pin(pin_cancelamento)), None)
            if not autorizador:
                return jsonify({"error": "PIN inválido ou sem permissão para cancelar"}), 403
        elif senha_admin:
            admin_usuario = data.get("admin_usuario")
            if admin_usuario:
                autorizador = Funcionario.query.filter_by(username=admin_usuario, estabelecimento_id=estabelecimento_id).first()
            else:
                claims = get_jwt()
                autorizador = Funcionario.query.filter_by(id=claims.get("sub"), estabelecimento_id=estabelecimento_id).first()
            if not autorizador or not check_password_hash(autorizador.senha or "", senha_admin):
                return jsonify({"error": "Senha do administrador incorreta"}), 403
            from app.decorators.rbac import nivel_do_role
            if nivel_do_role(autorizador.role) > 2:
                return jsonify({"error": "Usuário sem permissão para cancelar vendas"}), 403
        else:
            # Sem credencial válida o cancelamento é bloqueado (fecha o furo de segurança).
            return jsonify({"error": "Autorização obrigatória: informe o PIN de cancelamento"}), 403

        from app.utils.auth_utils import is_user_active
        if not autorizador.ativo or autorizador.deleted_at is not None or not is_user_active(autorizador.status):
            return jsonify({'error': 'Autorizador inativo'}), 403

        # Permitir cancelamento de vendas até 7 dias atrás
        dias_venda = (datetime.now() - venda.created_at.replace(tzinfo=None)).days if venda.created_at else 0
        if dias_venda > 7:
            return jsonify({"error": f"Vendas com mais de 7 dias não podem ser canceladas. Esta venda tem {dias_venda} dias."}), 400

        db.session.begin_nested()
        try:
            from app.utils.checkout_locking import lock_checkout
            from app.services.estoque_service import controla_estoque, estornar_saidas_venda
            lock_checkout(venda.estabelecimento_id, venda.funcionario_id,
                          [{'productId': item.produto_id} for item in venda.itens], venda.cliente_id)
            # O razão de movimentos diz o que saiu. Vendas antigas sem movimento
            # tiveram baixa sem rastro, exceto a venda-entrega legada, que nunca baixou.
            legado = None if venda.tipo_venda == 'delivery' else [
                (item.produto_id, item.quantidade) for item in venda.itens
                if item.produto is not None and controla_estoque(item.produto)]
            estornar_saidas_venda(venda, funcionario_id=funcionario_id,
                                  motivo=f"Cancelamento da venda #{venda.codigo}", itens_sem_movimento=legado)
            for item in venda.itens:
                produto = Produto.query.filter_by(id=item.produto_id, estabelecimento_id=estabelecimento_id).first()
                if produto:
                    # Reverter denormalizações do produto — sem isso, giro/curva
                    # ABC/ranking de mais vendidos ficavam inflados por vendas
                    # que na verdade foram desfeitas.
                    produto.quantidade_vendida = max(
                        Decimal(0), Decimal(str(produto.quantidade_vendida or 0)) - Decimal(str(item.quantidade))
                    )
                    produto.total_vendido = max(
                        Decimal(0), Decimal(str(produto.total_vendido or 0)) - Decimal(str(item.total_item or 0))
                    )

            # Reverter denormalizações do CLIENTE — sem isso, "melhor cliente"
            # e o histórico de gasto ficavam inflados com vendas desfeitas
            # (bug real detectado: valor_total_gasto > soma das vendas finalizadas).
            cliente = None
            if venda.cliente_id:
                cliente = Cliente.query.filter_by(
                    id=venda.cliente_id, estabelecimento_id=estabelecimento_id
                ).first()
                if cliente:
                    cliente.valor_total_gasto = max(
                        0, float(cliente.valor_total_gasto or 0) - float(venda.total or 0)
                    )
                    cliente.total_compras = max(0, int(cliente.total_compras or 0) - 1)

            # Estornar pagamentos e reverter fiado em aberto vinculado a esta venda
            for pag in Pagamento.query.filter_by(venda_id=venda.id).all():
                pag.status = "estornado"

            from app.models import Caixa, MovimentacaoCaixa
            for original in MovimentacaoCaixa.query.filter_by(venda_id=venda.id, tipo='venda').all():
                cashbox = Caixa.query.filter_by(id=original.caixa_id, estabelecimento_id=venda.estabelecimento_id).with_for_update().first()
                db.session.add(MovimentacaoCaixa(estabelecimento_id=venda.estabelecimento_id, caixa_id=original.caixa_id,
                    venda_id=venda.id, tipo='estorno', forma_pagamento=original.forma_pagamento, valor=original.valor,
                    descricao=f'Estorno da venda {venda.codigo}'))
                if cashbox and original.forma_pagamento == 'dinheiro':
                    cashbox.saldo_atual = Decimal(str(cashbox.saldo_atual or 0)) - Decimal(str(original.valor))

            contas = ContaReceber.query.filter_by(venda_id=venda.id, status="aberto").with_for_update().all()
            for conta in contas:
                conta.status = "cancelado"
                if cliente:
                    cliente.saldo_devedor = max(
                        Decimal(0), Decimal(str(cliente.saldo_devedor or 0)) - Decimal(str(conta.valor_atual or 0))
                    )

            venda.status = "cancelada"
            agora = datetime.now()
            venda.data_cancelamento = agora
            venda.motivo_cancelamento = (motivo or "")[:255]
            autorizado_por = f" | Autorizado por: {autorizador.nome}" if autorizador else ""
            venda.observacoes = f"{venda.observacoes or ''}\n[Cancelada em {agora.strftime('%d/%m/%Y %H:%M')}] Motivo: {motivo}{autorizado_por}".strip()
            venda.updated_at = agora

            from app.models import Auditoria
            Auditoria.registrar(
                estabelecimento_id=estabelecimento_id,
                tipo_evento="venda_cancelada",
                descricao=f"Venda {venda.codigo} cancelada — {motivo}" + (
                    f" (autorizado por {autorizador.nome})" if autorizador else ""
                ),
                usuario_id=autorizador.id if autorizador else funcionario_id,
                valor=float(venda.total or 0),
            )

            db.session.commit()
            return jsonify({"success": True, "message": "Venda cancelada com sucesso"}), 200
        except Exception as e:
            db.session.rollback()
            return jsonify({"error": f"Erro ao processar cancelamento: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"Erro ao cancelar venda: {str(e)}"}), 500


@vendas_bp.route("/exportar", methods=["GET"], strict_slashes=False)
@jwt_required()
def exportar_vendas():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        data_inicio = request.args.get("data_inicio")
        data_fim = request.args.get("data_fim")
        status = request.args.get("status")
        formato = request.args.get("formato", "csv")

        query = Venda.query.filter(Venda.estabelecimento_id == estabelecimento_id)
        if data_inicio:
            query = query.filter(Venda.data_venda >= datetime.strptime(data_inicio, "%Y-%m-%d"))
        if data_fim:
            query = query.filter(Venda.data_venda <= datetime.strptime(data_fim, "%Y-%m-%d") + timedelta(days=1))
        if status:
            query = query.filter(Venda.status == status)

        vendas = query.options(db.selectinload(Venda.pagamentos)).order_by(Venda.data_venda.desc()).limit(5000).all()

        output = io.StringIO()
        writer = csv.writer(output, delimiter=";")
        writer.writerow(["Código", "Data", "Cliente", "Funcionário", "Subtotal", "Desconto", "Total", "Forma Pagamento", "Status", "Itens"])
        for v in vendas:
            cliente_nome = v.cliente.nome if v.cliente else ""
            func_nome = v.funcionario.nome if v.funcionario else ""
            formas = ", ".join(p.forma_pagamento for p in v.pagamentos) if v.pagamentos else "N/A"
            writer.writerow([
                v.codigo,
                v.data_venda.strftime("%d/%m/%Y %H:%M") if v.data_venda else "",
                cliente_nome,
                func_nome,
                f"{float(v.subtotal):.2f}",
                f"{float(v.desconto):.2f}",
                f"{float(v.total):.2f}",
                formas,
                v.status,
                len(v.itens)
            ])
        content = output.getvalue()
        output.close()

        mimetype = "application/vnd.ms-excel" if formato == "excel" else "text/csv"
        ext = "xls" if formato == "excel" else "csv"
        resp = Response("\ufeff" + content, mimetype=f"{mimetype}; charset=utf-8")
        resp.headers["Content-Disposition"] = f'attachment; filename="vendas-{datetime.now().strftime("%Y%m%d")}.{ext}"'
        return resp
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao exportar vendas: {str(e)}")
        return jsonify({"error": f"Erro ao exportar: {str(e)}"}), 500


@vendas_bp.route("/<int:venda_id>/comprovante", methods=["GET"], strict_slashes=False)
@jwt_required()
def comprovante_venda(venda_id):
    try:
        estabelecimento_id = get_authorized_establishment_id()
        query = Venda.query.filter_by(id=venda_id)
        if str(estabelecimento_id).lower() != 'all':
            query = query.filter_by(estabelecimento_id=estabelecimento_id)
        venda = query.first_or_404()
        itens = VendaItem.query.filter_by(venda_id=venda.id).all()
        cliente_nome = venda.cliente.nome if venda.cliente else "Consumidor Final"
        func_nome = venda.funcionario.nome if venda.funcionario else "N/A"

        linhas = [
            "=" * 48,
            "MERCADINHO SYS".center(48),
            "CUPOM NÃO FISCAL".center(48),
            "=" * 48,
            f"Venda: {venda.codigo}",
            f"Data: {venda.data_venda.strftime('%d/%m/%Y %H:%M') if venda.data_venda else 'N/A'}",
            f"Cliente: {cliente_nome}",
            f"Operador: {func_nome}",
            "-" * 48,
            f"{'ITEM':<22} {'QTD':>4} {'UNIT':>9} {'TOTAL':>9}",
            "-" * 48
        ]
        for item in itens:
            # 1,5 kg sai como 1.5, não como 1.
            qtd = f"{Decimal(str(item.quantidade)).normalize():f}"
            linhas.append(f"{item.produto_nome[:22]:<22} {qtd:>4} {float(item.preco_unitario):>9.2f} {float(item.total_item):>9.2f}")
        linhas.extend([
            "-" * 48,
            f"{'Subtotal:':<30} R$ {float(venda.subtotal):>10.2f}"
        ])
        if venda.desconto > 0:
            linhas.append(f"{'Desconto:':<30} R$ {float(venda.desconto):>10.2f}")
        linhas.append(f"{'TOTAL:':<30} R$ {float(venda.total):>10.2f}")
        linhas.append("-" * 48)
        for p in venda.pagamentos:
            linhas.append(f"{p.forma_pagamento}: R$ {float(p.valor):.2f}")
        linhas.extend([
            "=" * 48,
            "Obrigado pela preferência!".center(48),
            "=" * 48
        ])
        resp = Response("\n".join(linhas), mimetype="text/plain; charset=utf-8")
        resp.headers["Content-Disposition"] = f'attachment; filename="comprovante-{venda.codigo}.txt"'
        return resp
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao gerar comprovante: {str(e)}")
        return jsonify({"error": f"Erro ao gerar comprovante: {str(e)}"}), 500


# ------------------------------------------------------------------------------
# MÓDULO DE PDV ATIVO (CARRINHO EM ANDAMENTO) – COMPLETO
# ------------------------------------------------------------------------------

@vendas_bp.route("/pdv/ativo", methods=["POST"])
@jwt_required()
def iniciar_venda_pdv():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        data = request.get_json()
        funcionario_id = data.get("funcionario_id")
        cliente_id = data.get("cliente_id")
        if not funcionario_id:
            return jsonify({"error": "Funcionário é obrigatório"}), 400
        codigo_temp = f"PDV-{datetime.now().strftime('%H%M%S')}-{funcionario_id}"
        venda = Venda(
            estabelecimento_id=estabelecimento_id,
            codigo=codigo_temp,
            cliente_id=cliente_id,
            funcionario_id=funcionario_id,
            subtotal=0,
            desconto=0,
            total=0,
            valor_recebido=0,
            troco=0,
            status="em_andamento",
            quantidade_itens=0
        )
        db.session.add(venda)
        db.session.commit()
        return jsonify({"success": True, "venda_id": venda.id, "codigo_temp": codigo_temp}), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro ao iniciar venda PDV: {str(e)}")
        return jsonify({"error": f"Erro ao iniciar venda: {str(e)}"}), 500


@vendas_bp.route("/pdv/<int:venda_id>/adicionar-item", methods=["POST"])
@jwt_required()
def adicionar_item_pdv(venda_id):
    try:
        estabelecimento_id = get_authorized_establishment_id()
        data = request.get_json()
        produto_id = data.get("produto_id")
        quantidade = data.get("quantidade", 1)
        if not produto_id:
            return jsonify({"error": "Produto é obrigatório"}), 400
        query = Venda.query.filter_by(id=venda_id, status="em_andamento")
        if str(estabelecimento_id).lower() != 'all':
            query = query.filter_by(estabelecimento_id=estabelecimento_id)
        venda = query.first_or_404()
        produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=estabelecimento_id).first_or_404()
        if float(produto.quantidade or 0) < quantidade:
            return jsonify({"error": f"Estoque insuficiente. Disponível: {produto.quantidade}"}), 400
        item = VendaItem.query.filter_by(venda_id=venda_id, produto_id=produto_id).first()
        if item:
            item.quantidade = float(item.quantidade) + quantidade
            item.total_item = float(item.quantidade) * float(item.preco_unitario)
        else:
            item = VendaItem(
                venda_id=venda_id,
                estabelecimento_id=estabelecimento_id, # Variável local garantida
                produto_id=produto_id,
                produto_nome=produto.nome,
                produto_codigo=produto.codigo_barras,
                produto_unidade=produto.unidade_medida,
                quantidade=quantidade,
                preco_unitario=float(produto.preco_venda),
                total_item=quantidade * float(produto.preco_venda),
                desconto=0
            )
            db.session.add(item)
        venda.itens = VendaItem.query.filter_by(venda_id=venda_id).all()
        venda.subtotal = sum(float(i.preco_unitario) * float(i.quantidade) for i in venda.itens)
        venda.total = venda.subtotal - float(venda.desconto or 0)
        venda.quantidade_itens = sum(float(i.quantidade) for i in venda.itens)
        db.session.commit()
        return jsonify({
            "success": True,
            "subtotal": float(venda.subtotal),
            "total": float(venda.total),
            "quantidade_itens": int(venda.quantidade_itens)
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro ao adicionar item: {str(e)}")
        return jsonify({"error": f"Erro ao adicionar item: {str(e)}"}), 500


@vendas_bp.route("/pdv/<int:venda_id>/remover-item/<int:item_id>", methods=["DELETE"])
@jwt_required()
def remover_item_pdv(venda_id, item_id):
    try:
        estabelecimento_id = get_authorized_establishment_id()
        item = VendaItem.query.join(Venda).filter(
            VendaItem.id == item_id,
            VendaItem.venda_id == venda_id,
            Venda.estabelecimento_id == estabelecimento_id
        ).first()
        if not item:
            return jsonify({"error": "Item não encontrado"}), 404
        db.session.delete(item)
        venda = Venda.query.filter_by(id=venda_id, estabelecimento_id=estabelecimento_id).first()
        if not venda:
            return jsonify({"error": "Venda não encontrada"}), 404
        venda.itens = VendaItem.query.filter_by(venda_id=venda_id).all()
        venda.subtotal = sum(float(i.preco_unitario) * float(i.quantidade) for i in venda.itens)
        venda.total = venda.subtotal - float(venda.desconto or 0)
        venda.quantidade_itens = sum(float(i.quantidade) for i in venda.itens)
        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Item removido do carrinho",
            "subtotal": float(venda.subtotal),
            "total": float(venda.total)
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro ao remover item: {str(e)}")
        return jsonify({"error": f"Erro ao remover item: {str(e)}"}), 500


@vendas_bp.route("/pdv/<int:venda_id>/atualizar-quantidade", methods=["PUT"])
@jwt_required()
def atualizar_quantidade_pdv(venda_id):
    try:
        estabelecimento_id = get_authorized_establishment_id()
        data = request.get_json()
        item_id = data.get("item_id")
        nova_quantidade = data.get("quantidade", 1)
        if nova_quantidade <= 0:
            return jsonify({"error": "Quantidade deve ser maior que 0"}), 400
        item = VendaItem.query.join(Venda).filter(
            VendaItem.id == item_id,
            VendaItem.venda_id == venda_id,
            Venda.estabelecimento_id == estabelecimento_id
        ).first()
        if not item:
            return jsonify({"error": "Item não encontrado"}), 404
        produto = Produto.query.filter_by(id=item.produto_id, estabelecimento_id=estabelecimento_id).first()
        if not produto:
            return jsonify({"error": "Produto não encontrado"}), 404
        if float(produto.quantidade or 0) < nova_quantidade:
            return jsonify({"error": f"Estoque insuficiente. Disponível: {produto.quantidade}"}), 400
        item.quantidade = nova_quantidade
        item.total_item = nova_quantidade * float(item.preco_unitario)
        venda = Venda.query.filter_by(id=venda_id, estabelecimento_id=estabelecimento_id).first()
        if not venda:
            return jsonify({"error": "Venda não encontrada"}), 404
        venda.itens = VendaItem.query.filter_by(venda_id=venda_id).all()
        venda.subtotal = sum(float(i.preco_unitario) * float(i.quantidade) for i in venda.itens)
        venda.total = venda.subtotal - float(venda.desconto or 0)
        venda.quantidade_itens = sum(float(i.quantidade) for i in venda.itens)
        db.session.commit()
        return jsonify({
            "success": True,
            "subtotal": float(venda.subtotal),
            "total": float(venda.total),
            "quantidade_itens": int(venda.quantidade_itens)
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro ao atualizar quantidade: {str(e)}")
        return jsonify({"error": f"Erro ao atualizar quantidade: {str(e)}"}), 500


@vendas_bp.route("/pdv/configuracoes", methods=["GET"])
@jwt_required()
def obter_configuracoes_pdv():
    try:
        return jsonify({
            "formas_pagamento": [
                {"tipo": "dinheiro", "label": "Dinheiro", "taxa": 0},
                {"tipo": "cartao_credito", "label": "Cartão Crédito", "taxa": 2.5},
                {"tipo": "cartao_debito", "label": "Cartão Débito", "taxa": 1.5},
                {"tipo": "pix", "label": "PIX", "taxa": 0},
                {"tipo": "voucher_alimentacao", "label": "Voucher Alimentação", "taxa": 0},
                {"tipo": "voucher_refeicao", "label": "Voucher Refeição", "taxa": 0},
                {"tipo": "fiado", "label": "Fiado", "taxa": 0},
            ],
            "permitir_venda_sem_estoque": False,
            "desconto_maximo_percentual": 10.0,
            "arredondamento_valores": 0.05,
        }), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao obter configurações PDV: {str(e)}")
        return jsonify({"error": f"Erro ao obter configurações: {str(e)}"}), 500


@vendas_bp.route("/pdv/calcular-troco", methods=["POST"])
@jwt_required()
def calcular_troco():
    try:
        data = request.get_json()
        total = float(data.get("total", 0))
        valor_recebido = float(data.get("valor_recebido", 0))
        if valor_recebido < total:
            return jsonify({
                "error": "Valor recebido é menor que o total",
                "troco": 0,
                "faltante": total - valor_recebido
            }), 400
        return jsonify({
            "troco": valor_recebido - total,
            "valor_recebido": valor_recebido,
            "total": total
        }), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao calcular troco: {str(e)}")
        return jsonify({"error": f"Erro ao calcular troco: {str(e)}"}), 500


@vendas_bp.route("/pdv/carrinhos-ativos", methods=["GET"])
@jwt_required()
def listar_carrinhos_ativos():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        vendas_ativas = Venda.query.filter(
            Venda.status == "em_andamento",
            Venda.estabelecimento_id == estabelecimento_id
        ).all()
        return jsonify({
            "carrinhos_ativos": [
                {
                    "venda_id": v.id,
                    "codigo_temp": v.codigo,
                    "funcionario_id": v.funcionario_id,
                    "cliente_id": v.cliente_id,
                    "total": float(v.total),
                    "quantidade_itens": int(v.quantidade_itens or 0),
                    "iniciada_em": v.created_at.isoformat()
                }
                for v in vendas_ativas
            ]
        }), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro ao listar carrinhos ativos: {str(e)}")
        return jsonify({"error": f"Erro ao listar carrinhos ativos: {str(e)}"}), 500

# ============================================
# FIM DO ARQUIVO vendas.py
# ============================================
