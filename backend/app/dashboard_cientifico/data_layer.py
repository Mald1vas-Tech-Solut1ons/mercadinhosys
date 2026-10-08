from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy import func, desc, extract, case, and_, or_
from decimal import Decimal, ROUND_HALF_UP
from app.utils.custo import custo_efetivo
from app.models import (
    Venda, VendaItem, Produto, Cliente,
    Funcionario, FuncionarioBeneficio, Beneficio, BancoHoras, RegistroPonto, ConfiguracaoHorario,
    Despesa, ContaPagar, ContaReceber, JustificativaPonto
)
from app.utils.query_helpers import _get_db
import logging
from functools import wraps
from app.services.rh_calculator_service import calcular_custo_folha_detalhado

logger = logging.getLogger(__name__)

def provide_session(f):
    """Decorator sênior para injetar db.session e gerenciar transações/erros/timezones."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        db = _get_db()
        
        # Normalização sênior: converter todos os argumentos datetime para naive UTC
        # Isso resolve o erro 'can't subtract offset-naive and offset-aware datetimes'
        new_args = []
        for arg in args:
            if isinstance(arg, datetime) and arg.tzinfo is not None:
                new_args.append(arg.astimezone(timezone.utc).replace(tzinfo=None))
            else:
                new_args.append(arg)
        
        for k, v in kwargs.items():
            if isinstance(v, datetime) and v.tzinfo is not None:
                kwargs[k] = v.astimezone(timezone.utc).replace(tzinfo=None)
                
        try:
            return f(db, *new_args, **kwargs)
        except Exception as e:
            db.session.rollback()
            method_name = f.__name__
            logger.error(f"Erro em DataLayer.{method_name}: {e}")
            if 'timeseries' in method_name or 'list' in method_name or 'details' in method_name:
                return []
            return {}
    return wrapper

class DataLayer:
    """
    Camada de acesso a dados para o Dashboard Científico.
    Executa queries otimizadas e retorna dados brutos ou semi-processados.
    """

    @staticmethod
    def _filter_tenant(query, model, est_id):
        """Helper sênior para centralizar a filtragem multi-tenant."""
        if str(est_id).lower() != 'all':
            return query.filter(model.estabelecimento_id == est_id)
        return query

    @staticmethod
    @provide_session
    def get_sales_summary_range(db, estabelecimento_id: int, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """Resumo de vendas para um período específico (inclui o dia inteiro de end_date)"""
        try:
            from datetime import timezone
            # Garantir timezone UTC para todas as datas de entrada
            if isinstance(start_date, datetime):
                start_dt = start_date if start_date.tzinfo else start_date.replace(tzinfo=timezone.utc)
            else:
                start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
                
            if isinstance(end_date, datetime):
                end_dt = end_date if end_date.tzinfo else end_date.replace(tzinfo=timezone.utc)
            else:
                end_dt = datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)

            start_d = start_dt.date()
            end_d = end_dt.date()
            end_exclusive = end_d + timedelta(days=1)
        
            query = db.session.query(
                func.count(Venda.id).label('total_vendas'),
                func.sum(Venda.total).label('total_faturado'),
                func.avg(Venda.total).label('ticket_medio'),
                func.count(func.distinct(func.date(Venda.data_venda))).label('dias_com_venda')
            ).filter(
                Venda.data_venda >= start_d,
                Venda.data_venda < end_exclusive,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            result = query.first()

            return {
                "total_vendas": result.total_vendas or 0,
                "total_faturado": float(result.total_faturado or 0),
                "ticket_medio": float(result.ticket_medio or 0),
                "dias_com_venda": result.dias_com_venda or 0
            }

        except Exception as e:
            db.session.rollback()
            logger.error(f"ERRO CRÍTICO em get_sales_summary_range: {e}", exc_info=True)
            return {
                "total_vendas": 0,
                "total_faturado": 0.0,
                "ticket_medio": 0.0,
                "dias_com_venda": 0
            }

    @staticmethod
    @provide_session
    def get_sales_timeseries(db, estabelecimento_id: int, days: int) -> List[Dict[str, Any]]:
        """Série temporal de vendas diárias integrando Receita, CMV e Despesas.

        Despesas exclui espelhos (ver app.utils.financeiro_constants) — do
        contrário fornecedor/boleto de mercadoria contavam junto do CMV — e
        rateia a folha REAL calculada da janela por dia (competência), em vez
        do espelho de salário (sem encargos) concentrado no dia 1 do mês.
        """
        try:
            from app.utils.financeiro_constants import sem_categorias_integradas

            start_date = (datetime.now(timezone.utc) - timedelta(days=days)).date()
            end_date = start_date + timedelta(days=max(days - 1, 0))

            # Garante formato start_date datetime
            start_dt = datetime.combine(start_date, datetime.min.time())
            
            # db injetado pelo decorator
            # Query Vendas (Agrupa por dia)
            query_vendas = db.session.query(
                func.date(Venda.data_venda).label('data'),
                func.sum(Venda.total).label('valor'),
                func.count(Venda.id).label('qtd')
            ).filter(
                func.date(Venda.data_venda) >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_vendas = query_vendas.filter(Venda.estabelecimento_id == estabelecimento_id)
            
            resultados_venda = query_vendas.group_by(func.date(Venda.data_venda)).all()

            # Query CMV (Custo)
            query_cogs = db.session.query(
                func.date(Venda.data_venda).label('data'),
                func.sum(custo_efetivo() * VendaItem.quantidade).label('cogs')
            ).join(VendaItem, Venda.id == VendaItem.venda_id).outerjoin(
                Produto, Produto.id == VendaItem.produto_id
            ).filter(
                func.date(Venda.data_venda) >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_cogs = query_cogs.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            resultados_cogs = query_cogs.group_by(func.date(Venda.data_venda)).all()

            # Query Despesas (exclui espelhos — fonte primária é ContaPagar/folha)
            query_despesas = db.session.query(
                func.date(Despesa.data_despesa).label('data'),
                func.sum(Despesa.valor).label('valor')
            ).filter(
                func.date(Despesa.data_despesa) >= start_date
            )
            query_despesas = sem_categorias_integradas(query_despesas, Despesa.categoria)

            if str(estabelecimento_id).lower() != 'all':
                query_despesas = query_despesas.filter(Despesa.estabelecimento_id == estabelecimento_id)

            resultados_despesas = query_despesas.group_by(func.date(Despesa.data_despesa)).all()

            # Folha REAL da janela inteira, rateada por dia — evita concentrar
            # o custo de pessoal no dia 1 (comportamento do espelho da seed).
            try:
                folha = calcular_custo_folha_detalhado(estabelecimento_id, start_date, end_date)
                custo_folha_total = float(folha.get("custo_folha", {}).get("custo_real_total", 0.0))
            except Exception as e_folha:
                logger.error(f"Erro ao calcular folha em get_sales_timeseries: {e_folha}")
                custo_folha_total = 0.0
            custo_folha_dia = (custo_folha_total / days) if days > 0 else 0.0

            # Construir mapa de dias
            mapa_dias = {}
            for i in range(days):
                d = (start_date + timedelta(days=i)).strftime('%Y-%m-%d')
                mapa_dias[d] = {
                    "data": d,
                    "total": 0.0,
                    "valor": 0.0,
                    "qtd": 0,
                    "cogs": 0.0,
                    "despesas": 0.0,
                    "lucro_bruto": 0.0,
                    "lucro_liquido": 0.0
                }

            # Preencher Vendas
            for r in resultados_venda:
                d_str = str(r.data)
                if d_str in mapa_dias:
                    mapa_dias[d_str]["total"] = float(r.valor or 0)
                    mapa_dias[d_str]["valor"] = float(r.valor or 0)
                    mapa_dias[d_str]["qtd"] = r.qtd
            
            # Preencher COGS
            for r in resultados_cogs:
                d_str = str(r.data)
                if d_str in mapa_dias:
                    mapa_dias[d_str]["cogs"] = float(r.cogs or 0)
                    
            # Preencher Despesas (operacionais + rateio diário da folha real)
            for r in resultados_despesas:
                d_str = str(r.data)
                if d_str in mapa_dias:
                    mapa_dias[d_str]["despesas"] = float(r.valor or 0)
            for k in mapa_dias:
                mapa_dias[k]["despesas"] += custo_folha_dia

            # Calcular Lucro Bruto e Líquido Diários
            for k in mapa_dias:
                dia = mapa_dias[k]
                dia["lucro_bruto"] = dia["total"] - dia["cogs"]
                dia["lucro_liquido"] = dia["lucro_bruto"] - dia["despesas"]

            return sorted(list(mapa_dias.values()), key=lambda x: x["data"])
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_sales_timeseries: {e}")
            return []

    # ... (other replacements will follow same pattern)

    @staticmethod
    @provide_session
    def get_expiring_products(db, estabelecimento_id: int, days_alert: int = 30) -> List[Dict[str, Any]]:
        try:
            # db injetado pelo decorator
            # Normalizar para naive e garantir compatibilidade
            hoje_dt = datetime.now(timezone.utc)
            hoje = hoje_dt.date()
            data_limite = hoje + timedelta(days=days_alert)
            
            query = db.session.query(
                Produto.id,
                Produto.nome,
                Produto.lote,
                Produto.data_validade,
                Produto.quantidade,
                Produto.preco_custo,
                Produto.preco_venda
            ).filter(
                Produto.ativo == True,
                Produto.data_validade.isnot(None),
                Produto.data_validade <= data_limite
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Produto.estabelecimento_id == estabelecimento_id)
                
            results = query.order_by(Produto.data_validade.asc()).all()

            return [
                {
                    "id": r.id,
                    "nome": r.nome,
                    "lote": r.lote or "N/D",
                    "data_validade": r.data_validade.isoformat() if r.data_validade else None,
                    "dias_para_vencer": (
                        ((r.data_validade.date() if hasattr(r.data_validade, "date") else r.data_validade) - hoje).days 
                        if r.data_validade else 0
                    ),
                    "quantidade": float(r.quantidade or 0),
                    "valor_risco_custo": float(r.preco_custo or 0) * float(r.quantidade or 0),
                    "valor_risco_venda": float(r.preco_venda or 0) * float(r.quantidade or 0)
                }
                for r in results
                if r.quantidade and r.quantidade > 0
            ]
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_expiring_products: {e}")
            return []

    @staticmethod
    @provide_session
    def get_inventory_summary(db, estabelecimento_id: int) -> Dict[str, Any]:
        """Resumo do inventário (valor total, itens baixo estoque)"""
        try:
            # db injetado pelo decorator
            # Valor total do estoque (custo * quantidade)
            query_valor = db.session.query(
                func.sum(Produto.preco_custo * Produto.quantidade)
            ).filter(
                Produto.ativo == True
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_valor = query_valor.filter(Produto.estabelecimento_id == estabelecimento_id)
                
            valor_total = query_valor.scalar()

            # Quantidade de produtos com estoque abaixo do mínimo
            query_baixo = db.session.query(func.count(Produto.id)).filter(
                Produto.ativo == True,
                Produto.quantidade <= func.coalesce(Produto.quantidade_minima, 0)
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_baixo = query_baixo.filter(Produto.estabelecimento_id == estabelecimento_id)
                
            baixo_estoque = query_baixo.scalar()

            return {
                "valor_total": float(valor_total or 0),
                "baixo_estoque": baixo_estoque or 0
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_inventory_summary: {e}")
            return {"valor_total": 0.0, "baixo_estoque": 0}

    @staticmethod
    @provide_session
    def get_customer_metrics(db, estabelecimento_id: int, days: int) -> Dict[str, Any]:
        """Métricas de clientes (únicos, ticket médio)"""
        try:
            # db injetado pelo decorator
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            query_clientes = db.session.query(func.count(func.distinct(Venda.cliente_id))).filter(
                Venda.data_venda >= start_date,
                Venda.cliente_id.isnot(None)
            )
            if str(estabelecimento_id).lower() != 'all':
                query_clientes = query_clientes.filter(Venda.estabelecimento_id == estabelecimento_id)
            clientes_unicos = query_clientes.scalar()

            # Ticket médio por cliente (apenas vendas identificadas)
            query_faturado = db.session.query(func.sum(Venda.total)).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada',
                Venda.cliente_id.isnot(None)
            )
            if str(estabelecimento_id).lower() != 'all':
                query_faturado = query_faturado.filter(Venda.estabelecimento_id == estabelecimento_id)
            total_faturado = query_faturado.scalar() or 0

            ticket_medio_cliente = float(total_faturado) / clientes_unicos if clientes_unicos and clientes_unicos > 0 else 0

            # Maior compra do período
            query_maior = db.session.query(func.max(Venda.total)).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            if str(estabelecimento_id).lower() != 'all':
                query_maior = query_maior.filter(Venda.estabelecimento_id == estabelecimento_id)
            maior_compra = query_maior.scalar()

            return {
                "clientes_unicos": clientes_unicos or 0,
                "ticket_medio_cliente": float(ticket_medio_cliente),
                "maior_compra": float(maior_compra or 0)
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_customer_metrics: {e}")
            return {"clientes_unicos": 0, "ticket_medio_cliente": 0.0, "maior_compra": 0.0}

    @staticmethod
    @provide_session
    def get_top_products(db, estabelecimento_id: int, days: int, limit: int = 10) -> List[Dict[str, Any]]:
        """Top produtos mais vendidos (Curva ABC)"""
        try:
            # db injetado pelo decorator
            # 🔥 CORREÇÃO: Usar datetime completo para garantir compatibilidade com Postgres
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
            
            query_top = db.session.query(
                Produto.id,
                Produto.nome,
                Produto.preco_custo,
                Produto.preco_venda,
                func.sum(VendaItem.quantidade).label('quantidade_vendida'),
                func.sum(VendaItem.total_item).label('faturamento')
            ).join(VendaItem, VendaItem.produto_id == Produto.id)\
             .join(Venda, Venda.id == VendaItem.venda_id)\
             .filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_top = query_top.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query_top.group_by(
                Produto.id, Produto.nome, Produto.preco_custo, Produto.preco_venda
            ).order_by(
                desc('faturamento')
            ).limit(limit).all()

            return [
                {
                    "id": r.id,
                    "nome": r.nome,
                    "preco_custo": float(r.preco_custo or 0),
                    "preco_venda": float(r.preco_venda or 0),
                    "quantidade_vendida": float(r.quantidade_vendida or 0),
                    "faturamento": float(r.faturamento or 0),
                    # Margem lucro correta: (Venda - Custo) / Custo * 100
                    "margem": ((float(r.preco_venda or 0) - float(r.preco_custo or 0)) / float(r.preco_custo or 0) * 100) if r.preco_custo and r.preco_custo > 0 else 0
                }
                for r in results
            ]
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_top_products: {e}")
            return []

    @staticmethod
    @provide_session
    def get_all_products_performance(db, estabelecimento_id: int, days: int) -> List[Dict[str, Any]]:
        """
        Retorna TODOS os produtos ativos com sua performance de vendas no período.
        Essencial para análise ABC correta (incluindo produtos sem vendas).
        """
        try:
            # db injetado pelo decorator
            # 🔥 CORREÇÃO: Usar datetime completo
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
            
            # Subquery para vendas filtradas por data
            # Necessário para não filtrar os produtos quando fizermos o LEFT JOIN
            query_vendas = db.session.query(
                VendaItem.produto_id,
                func.sum(VendaItem.quantidade).label('qtd'),
                func.sum(VendaItem.total_item).label('total')
            ).join(Venda, Venda.id == VendaItem.venda_id).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_vendas = query_vendas.filter(Venda.estabelecimento_id == estabelecimento_id)
            
            vendas_periodo = query_vendas.group_by(VendaItem.produto_id).subquery()

            # Query principal: Produtos LEFT JOIN Vendas
            query_prod = db.session.query(
                Produto.id,
                Produto.nome,
                Produto.preco_custo,
                Produto.preco_venda,
                Produto.quantidade.label('estoque_atual'),
                vendas_periodo.c.qtd,
                vendas_periodo.c.total
            ).outerjoin(
                vendas_periodo, Produto.id == vendas_periodo.c.produto_id
            ).filter(
                Produto.ativo == True,
                ~Produto.nome.ilike('%teste%'),
                ~Produto.nome.ilike('%qa%'),
                ~Produto.nome.ilike('%estorno%'),
                ~Produto.nome.ilike('%sem codigo%')
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_prod = query_prod.filter(Produto.estabelecimento_id == estabelecimento_id)
            
            results = query_prod.all()

            return [
                {
                    "id": r.id,
                    "nome": r.nome,
                    "preco_custo": float(r.preco_custo or 0),
                    "preco_venda": float(r.preco_venda or 0),
                    "estoque_atual": float(r.estoque_atual or 0),
                    "quantidade_vendida": float(r.qtd or 0),
                    "faturamento": float(r.total or 0),
                    "valor_total": float(r.total or 0),
                    "margem": ((float(r.preco_venda or 0) - float(r.preco_custo or 0)) / float(r.preco_custo or 0) * 100) if r.preco_custo and r.preco_custo > 0 else 0
                }
                for r in results
            ]
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_all_products_performance: {e}")
            return []

    @staticmethod
    @provide_session
    def get_supplier_performance(db, estabelecimento_id: int, days: int) -> List[Dict[str, Any]]:
        """
        Painel de fornecedores com dados REAIS: faturamento gerado no PDV,
        total comprado (contas a pagar), pedidos, saldo em aberto e a
        pontualidade de pagamento calculada (sem score inventado).
        A condição de pagamento e o prazo vêm de cada fornecedor (não global).
        """
        try:
            from app.models import Fornecedor, ContaPagar, PedidoCompra
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)

            def _tenant(q, col):
                if str(estabelecimento_id).lower() != 'all':
                    return q.filter(col == estabelecimento_id)
                return q

            # 1. Faturamento gerado no PDV por fornecedor (giro dos produtos dele)
            vendas_q = db.session.query(
                Produto.fornecedor_id.label('fid'),
                func.sum(VendaItem.total_item).label('total_faturado'),
                func.sum(VendaItem.quantidade).label('total_itens')
            ).select_from(VendaItem).join(
                Venda, Venda.id == VendaItem.venda_id
            ).join(
                Produto, Produto.id == VendaItem.produto_id
            ).filter(Venda.data_venda >= start_date, Venda.status == 'finalizada')
            vendas_q = _tenant(vendas_q, Venda.estabelecimento_id)
            vendas_por_forn = {
                r.fid: (float(r.total_faturado or 0), float(r.total_itens or 0))
                for r in vendas_q.group_by(Produto.fornecedor_id).all()
            }

            # 2. Compras (contas a pagar) por fornecedor: total, aberto, pontualidade
            compras_q = db.session.query(
                ContaPagar.fornecedor_id.label('fid'),
                func.sum(ContaPagar.valor_original).label('total_comprado'),
                func.sum(case((ContaPagar.status == 'aberto', ContaPagar.valor_atual), else_=0)).label('aberto'),
                func.count(func.distinct(ContaPagar.pedido_compra_id)).label('num_pedidos'),
                func.count(ContaPagar.id).label('num_titulos'),
                func.sum(case(
                    (and_(ContaPagar.status == 'pago',
                          ContaPagar.data_pagamento <= ContaPagar.data_vencimento), 1),
                    else_=0)).label('pagos_em_dia'),
                func.sum(case((ContaPagar.status == 'pago', 1), else_=0)).label('total_pagos'),
            )
            compras_q = _tenant(compras_q, ContaPagar.estabelecimento_id)
            compras_por_forn = {r.fid: r for r in compras_q.group_by(ContaPagar.fornecedor_id).all()}

            # 3. Cadastro dos fornecedores (condição de pagamento é POR fornecedor)
            forn_q = db.session.query(Fornecedor).filter(Fornecedor.ativo == True)
            forn_q = _tenant(forn_q, Fornecedor.estabelecimento_id)

            saida = []
            for f in forn_q.all():
                fat, itens = vendas_por_forn.get(f.id, (0.0, 0.0))
                c = compras_por_forn.get(f.id)
                total_comprado = float(c.total_comprado or 0) if c else 0.0
                aberto = float(c.aberto or 0) if c else 0.0
                num_pedidos = int(c.num_pedidos or 0) if c else 0
                total_pagos = int(c.total_pagos or 0) if c else 0
                pagos_em_dia = int(c.pagos_em_dia or 0) if c else 0
                pontualidade = round(pagos_em_dia / total_pagos * 100, 1) if total_pagos > 0 else 100.0
                saida.append({
                    "id": f.id,
                    "fornecedor": f.nome_fantasia,
                    "total": fat,                       # faturamento gerado no PDV
                    "total_itens": itens,
                    "total_comprado": total_comprado,   # custo comprado dele
                    "saldo_aberto": aberto,             # o que ainda devo a ele
                    "num_pedidos": num_pedidos,
                    "condicao_pagamento": f.forma_pagamento or "A definir",
                    "prazo_entrega_dias": int(f.prazo_entrega or 0),
                    "classificacao": f.classificacao or "REGULAR",
                    "pontualidade_pagamento": pontualidade,
                })

            saida.sort(key=lambda x: x["total"], reverse=True)
            return saida[:15]
        except Exception as e:
            logger.error(f"Erro em get_supplier_performance: {e}")
            return []

    @staticmethod
    @provide_session
    def get_expense_details(db, estabelecimento_id: int, start_date: datetime, end_date: datetime) -> List[Dict[str, Any]]:
        """Detalhamento de despesas por tipo (período específico).

        Exclui despesas-espelho (ver app.utils.financeiro_constants) e injeta uma
        linha sintética com o custo REAL da folha (mesma fonte da página Despesas
        e do DRE) — sem isso o total do dashboard (soma desta lista) tanto contava
        boleto/fornecedor 2× (junto do CMV) quanto usava o espelho de salário
        (sem encargos/benefícios) em vez da folha calculada.
        """
        try:
            from app.utils.financeiro_constants import sem_categorias_integradas

            # db injetado pelo decorator
            # 🔥 CORREÇÃO: Despesa.data_despesa é do tipo DATE no banco.
            # Devemos comparar com objetos date simples, sem time ou tzinfo.
            start_date_norm = start_date.date() if isinstance(start_date, datetime) else start_date
            end_date_norm = end_date.date() if isinstance(end_date, datetime) else end_date

            query_expenses = db.session.query(
                Despesa.tipo,
                func.sum(Despesa.valor).label('total')
            ).filter(
                Despesa.data_despesa >= start_date_norm,
                Despesa.data_despesa <= end_date_norm
            )
            query_expenses = sem_categorias_integradas(query_expenses, Despesa.categoria)

            if str(estabelecimento_id).lower() != 'all':
                query_expenses = query_expenses.filter(Despesa.estabelecimento_id == estabelecimento_id)

            results = query_expenses.group_by(Despesa.tipo).all()

            detalhes = [
                {
                    "tipo": r.tipo or "Sem Categoria",
                    "valor": float(Decimal(str(r.total or 0)))
                }
                for r in results
            ]

            try:
                folha = calcular_custo_folha_detalhado(estabelecimento_id, start_date_norm, end_date_norm)
                custo_folha = float(folha.get("custo_folha", {}).get("custo_real_total", 0.0))
            except Exception as e_folha:
                logger.error(f"Erro ao calcular folha em get_expense_details: {e_folha}")
                custo_folha = 0.0
            if custo_folha > 0:
                detalhes.append({"tipo": "folha_calculada", "valor": custo_folha})

            return detalhes
        except Exception as e:
            db.session.rollback()
            logger.error(f"ERRO CRÍTICO em get_expense_details: {e}", exc_info=True)
            return []

    @staticmethod
    @provide_session
    def get_total_expenses_value(db, estabelecimento_id: int, start_date: datetime, end_date: datetime) -> float:
        """
        Retorna o valor TOTAL de despesas para o período, sem agrupamento.
        Usado para cálculo de Lucro Líquido no Dashboard (Sincronizado com DRE).

        Exclui despesas-espelho (ver app.utils.financeiro_constants) e soma a
        folha de pagamento REAL calculada — mesma fonte que a página Despesas e
        o DRE (antes somava Despesa bruta, contando boleto/fornecedor junto com
        o CMV e usando o espelho de salário sem encargos).
        """
        try:
            from app.utils.financeiro_constants import sem_categorias_integradas

            # db injetado pelo decorator
            # 🔥 CORREÇÃO: Despesa.data_despesa é DATE.
            # Normalização rigorosa para objetos date (sem timezone/time)
            start_date_norm = start_date.date() if isinstance(start_date, datetime) else start_date
            end_date_norm = end_date.date() if isinstance(end_date, datetime) else end_date

            query = db.session.query(func.sum(Despesa.valor)).filter(
                Despesa.data_despesa >= start_date_norm,
                Despesa.data_despesa <= end_date_norm
            )
            query = sem_categorias_integradas(query, Despesa.categoria)

            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Despesa.estabelecimento_id == estabelecimento_id)

            total_operacionais = float(query.scalar() or 0.0)

            try:
                folha = calcular_custo_folha_detalhado(estabelecimento_id, start_date_norm, end_date_norm)
                custo_folha = float(folha.get("custo_folha", {}).get("custo_real_total", 0.0))
            except Exception as e_folha:
                logger.error(f"Erro ao calcular folha em get_total_expenses_value: {e_folha}")
                custo_folha = 0.0

            return total_operacionais + custo_folha
        except Exception as e:
            logger.error(f"ERRO CRÍTICO em get_total_expenses_value: {e}", exc_info=True)
            return 0.0

    @staticmethod
    @provide_session
    def get_sales_by_hour(db, estabelecimento_id: int, days: int) -> List[Dict[str, Any]]:
        """Vendas agrupadas por hora do dia (Heatmap)"""
        try:
            # db injetado pelo decorator
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # Compatibilidade cross-database para extração de hora
            from app.utils.query_helpers import get_hour_extract
            hour_extract = get_hour_extract(Venda.data_venda)

            query_hourly = db.session.query(
                hour_extract.label('hora'),
                func.count(func.distinct(Venda.id)).label('qtd'),
                func.sum(VendaItem.total_item).label('total'),
                func.sum(VendaItem.quantidade * custo_efetivo()).label('cogs')
            ).join(VendaItem, VendaItem.venda_id == Venda.id).outerjoin(
                Produto, Produto.id == VendaItem.produto_id
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_hourly = query_hourly.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query_hourly.group_by(hour_extract).order_by(hour_extract).all()

            out = []
            for r in results:
                total_sale = float(r.total or 0)
                total_cogs = float(r.cogs or 0)
                lucro = total_sale - total_cogs
                margem = (lucro / total_sale * 100) if total_sale > 0 else 0
                out.append({
                    "hora": int(r.hora) if r.hora is not None else 0,
                    "qtd": r.qtd,
                    "total": total_sale,
                    "lucro": float(lucro),
                    "margem": float(margem)
                })
            return out
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_sales_by_hour: {e}")
            return []

    @staticmethod
    @provide_session
    def get_top_products_by_hour(db, estabelecimento_id: int, days: int, top_n: int = 5) -> List[Dict[str, Any]]:
        """Top produtos por faixa horária (Manhã, Tarde, Noite) agrupados dinamicamente"""
        try:
            # db injetado pelo decorator
            from app.utils.query_helpers import get_hour_extract
            hour_extract = get_hour_extract(Venda.data_venda)
            
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
            
            query_top = db.session.query(
                hour_extract.label('hora'),
                Produto.id,
                Produto.nome,
                func.sum(VendaItem.quantidade).label('quantidade_vendida'),
                func.sum(VendaItem.total_item).label('faturamento')
            ).join(VendaItem, VendaItem.produto_id == Produto.id)\
             .join(Venda, Venda.id == VendaItem.venda_id)\
             .filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
             )
             
            if str(estabelecimento_id).lower() != 'all':
                query_top = query_top.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query_top.group_by(hour_extract, Produto.id, Produto.nome).all()
             
            grouped = {}
            for r in results:
                hr = int(r.hora) if r.hora is not None else 0
                if hr not in grouped:
                    grouped[hr] = []
                grouped[hr].append({
                    "hora": hr,
                    "produto_id": r.id,
                    "produto_nome": r.nome,
                    "quantidade_vendida": float(r.quantidade_vendida or 0),
                    "faturamento": float(r.faturamento or 0)
                })
                
            final_list = []
            for hr, items in grouped.items():
                items.sort(key=lambda x: x["quantidade_vendida"], reverse=True)
                final_list.extend(items[:top_n])
            return final_list
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_top_products_by_hour: {e}")
            return []

    @staticmethod
    @provide_session
    def get_customer_temporal_patterns(db, estabelecimento_id: int, days: int) -> Dict[str, Any]:
        """Padrões de compra por dia da semana"""
        try:
            # db injetado pelo decorator
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # Compatibilidade cross-database para extração de dia da semana
            from app.utils.query_helpers import get_dow_extract
            dow_extract = get_dow_extract(Venda.data_venda)
            
            query_patterns = db.session.query(
                dow_extract.label('dia_semana'),
                func.count(Venda.id).label('qtd'),
                func.sum(Venda.total).label('total')
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_patterns = query_patterns.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query_patterns.group_by(dow_extract).all()
            
            dias_map = {
                '0': 'Domingo', '1': 'Segunda', '2': 'Terça', '3': 'Quarta',
                '4': 'Quinta', '5': 'Sexta', '6': 'Sábado'
            }

            return [
                {
                    "dia": dias_map.get(str(r.dia_semana), str(r.dia_semana)) if r.dia_semana is not None else "Desconhecido",
                    "qtd": r.qtd,
                    "total": float(r.total or 0)
                }
                for r in results
            ]
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_customer_temporal_patterns: {e}")
            return []

    @staticmethod
    @provide_session
    def get_hourly_concentration_metrics(db, estabelecimento_id: int, days: int) -> Dict[str, Any]:
        """
        Concentração de vendas em horários de pico com Índice de Gini
        Gini = 0 (distribuição perfeita) a 1 (concentração total)
        """
        try:
            # db injetado pelo decorator
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # Compatibilidade cross-database para extração de hora
            from app.utils.query_helpers import get_hour_extract
            hour_extract = get_hour_extract(Venda.data_venda)

            # Buscar vendas por hora
            query_gini = db.session.query(
                hour_extract.label('hora'),
                func.sum(Venda.total).label('total')
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_gini = query_gini.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query_gini.group_by(hour_extract).order_by(hour_extract).all()
            
            if not results:
                return {
                    "gini_index": 0.0,
                    "concentration_top_3": 0.0,
                    "diversification": 100.0,
                    "top_hours": [],
                    "distribution": []
                }
            
            # Extrair valores de faturamento por hora
            hourly_values = [float(r.total or 0) for r in results]
            total_faturamento = sum(hourly_values)
            
            if total_faturamento == 0:
                return {
                    "gini_index": 0.0,
                    "concentration_top_3": 0.0,
                    "diversification": 100.0,
                    "top_hours": [],
                    "distribution": []
                }
            
            # 🔥 CALCULAR ÍNDICE DE GINI
            # Fórmula: Gini = (2 * sum(i * x_i)) / (n * sum(x_i)) - (n+1)/n
            # Onde x_i são os valores ordenados
            n = len(hourly_values)
            sorted_values = sorted(hourly_values)
            
            numerator = sum((i + 1) * sorted_values[i] for i in range(n))
            gini_index = (2 * numerator) / (n * total_faturamento) - (n + 1) / n
            gini_index = max(0.0, min(1.0, gini_index))  # Garantir entre 0 e 1
            
            # 🔥 CONCENTRAÇÃO TOP 3 HORÁRIOS
            top_3_values = sorted(hourly_values, reverse=True)[:3]
            concentration_top_3 = (sum(top_3_values) / total_faturamento * 100) if total_faturamento > 0 else 0
            
            # 🔥 DIVERSIFICAÇÃO (inverso da concentração)
            # Se Gini baixo = bem distribuído = alta diversificação
            diversification = (1 - gini_index) * 100
            
            # 🔥 TOP 5 HORÁRIOS
            top_hours = []
            for r in sorted(results, key=lambda x: float(x.total or 0), reverse=True)[:5]:
                hora = int(r.hora) if r.hora is not None else 0
                total = float(r.total or 0)
                percentual = (total / total_faturamento * 100) if total_faturamento > 0 else 0
                top_hours.append({
                    "hora": f"{hora:02d}:00",
                    "faturamento": round(total, 2),
                    "percentual": round(percentual, 1)
                })
            
            # 🔥 DISTRIBUIÇÃO COMPLETA
            distribution = []
            for r in results:
                hora = int(r.hora) if r.hora is not None else 0
                total = float(r.total or 0)
                percentual = (total / total_faturamento * 100) if total_faturamento > 0 else 0
                distribution.append({
                    "hora": f"{hora:02d}:00",
                    "faturamento": round(total, 2),
                    "percentual": round(percentual, 1)
                })
            
            return {
                "gini_index": round(gini_index, 3),
                "concentration_top_3": round(concentration_top_3, 1),
                "diversification": round(diversification, 1),
                "top_hours": top_hours,
                "distribution": distribution,
                "interpretacao": {
                    "gini": "Baixa concentração - Vendas bem distribuídas" if gini_index < 0.4 else "Média concentração" if gini_index < 0.7 else "Alta concentração - Vendas concentradas em poucos horários",
                    "diversificacao": "Boa diversificação" if diversification > 60 else "Diversificação moderada" if diversification > 40 else "Baixa diversificação - Considere estratégias para outros horários"
                }
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_hourly_concentration_metrics: {e}")
            return {
                "gini_index": 0.0,
                "concentration_top_3": 0.0,
                "diversification": 100.0,
                "top_hours": [],
                "distribution": []
            }

    @staticmethod
    def get_product_hour_correlation_matrix(estabelecimento_id: int, days: int, top_products: int = 10) -> List[Dict[str, Any]]:
        """Matriz de correlação (simulada ou simplificada)"""
        return []

    @staticmethod
    def get_customer_product_affinity(estabelecimento_id: int, days: int, min_support: int = 3) -> List[Dict[str, Any]]:
        """Afinidade entre produtos (Market Basket Analysis simplificado)"""
        return []

    @staticmethod
    def get_hourly_customer_behavior(estabelecimento_id: int, days: int) -> List[Dict[str, Any]]:
        """Comportamento horário de clientes"""
        return []

    @staticmethod
    @provide_session
    def get_last_purchase_orders(db, estabelecimento_id: int, produto_ids: List[int]) -> Dict[int, Dict[str, Any]]:
        """
        Retorna o último pedido de compra para cada produto da lista.
        Responde ao requisito: "LINK EACH PRODUCT TO AN ORDER"
        """
        if not produto_ids:
            return {}
            
        from app.models import PedidoCompra, PedidoCompraItem, Fornecedor
        
        try:
            # db injetado pelo decorator
            # Query para buscar o último pedido finalizado/recebido para cada produto
            # Usando subquery para encontrar a data máxima por produto
            sub_query_stmt = db.session.query(
                PedidoCompraItem.produto_id,
                func.max(PedidoCompra.data_pedido).label('max_data')
            ).join(PedidoCompra).filter(
                PedidoCompraItem.produto_id.in_(produto_ids)
            )
            
            if str(estabelecimento_id).lower() != 'all':
                sub_query_stmt = sub_query_stmt.filter(PedidoCompra.estabelecimento_id == estabelecimento_id)
            
            subquery = sub_query_stmt.group_by(PedidoCompraItem.produto_id).subquery()
            
            # Join dos dados reais do último pedido
            results = db.session.query(
                PedidoCompraItem.produto_id,
                PedidoCompra.id.label('pedido_id'),
                PedidoCompra.numero_pedido,
                PedidoCompra.data_pedido,
                PedidoCompra.status,
                Fornecedor.nome_fantasia.label('fornecedor_nome'),
                PedidoCompraItem.preco_unitario,
                PedidoCompraItem.quantidade_solicitada
            ).join(PedidoCompra, PedidoCompra.id == PedidoCompraItem.pedido_id)\
             .join(subquery, and_(
                 PedidoCompraItem.produto_id == subquery.c.produto_id,
                 PedidoCompra.data_pedido == subquery.c.max_data
             ))\
             .outerjoin(Fornecedor, Fornecedor.id == PedidoCompra.fornecedor_id)\
             .all()
             
            return {
                r.produto_id: {
                    "pedido_id": r.pedido_id,
                    "numero_pedido": r.numero_pedido,
                    "data": r.data_pedido.isoformat() if r.data_pedido else None,
                    "status": r.status,
                    "fornecedor": r.fornecedor_nome,
                    "preco_compra": float(r.preco_unitario or 0),
                    "quantidade_comprada": float(r.quantidade_solicitada or 0)
                }
                for r in results
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_last_purchase_orders: {e}")
            return {}

    @staticmethod
    @provide_session
    def get_rh_metrics(db, estabelecimento_id: int, days: int = 30) -> Dict[str, Any]:
        """
        Métricas de RH: Horas Extras, Benefícios, Folha e Assiduidade
        """
        try:
            # db injetado pelo decorator
            data_inicio = datetime.now() - timedelta(days=days)
            data_inicio_dia = data_inicio.date()
            hoje_dia = datetime.now().date()
            inicio_mes = hoje_dia.replace(day=1)

            try:
                config_query = ConfiguracaoHorario.query
                if str(estabelecimento_id).lower() != 'all':
                    config_query = config_query.filter_by(estabelecimento_id=estabelecimento_id)
                config = config_query.first()
            except Exception as e:
                logger.error(f"Erro ao buscar ConfiguracaoHorario (possível falta de migração): {e}")
                config = None

            hora_saida_ref = config.hora_saida if config and getattr(config, 'hora_saida', None) else datetime.strptime('18:00', '%H:%M').time()
            tolerancia_saida = int(getattr(config, 'tolerancia_saida', 5) or 5)
            jornada = int(getattr(config, 'jornada_diaria_minutos', 480) or 480)

            def _time_to_minutes(t):
                return int(t.hour) * 60 + int(t.minute)

            minuto_saida_ref = _time_to_minutes(hora_saida_ref) + tolerancia_saida

            # Query todos os pontos em lote. O limite inferior cobre tanto a janela
            # do filtro (days) quanto o mês corrente, pois os blocos "_mes" abaixo
            # sempre calculam sobre o mês calendário (inicio_mes) — independente do
            # período selecionado no dashboard.
            data_inicio_pontos = min(data_inicio_dia, inicio_mes)
            pontos_bulk_query = db.session.query(RegistroPonto).filter(
                RegistroPonto.data >= data_inicio_pontos
            )
            if str(estabelecimento_id).lower() != 'all':
                pontos_bulk_query = pontos_bulk_query.filter(RegistroPonto.estabelecimento_id == estabelecimento_id)
            pontos_bulk = pontos_bulk_query.all()

            # 3. Análise de Pontualidade e Assiduidade (Python in-memory)
            entradas_por_status = {}
            for p in pontos_bulk:
                if p.tipo_registro == 'entrada':
                    status = p.status or 'normal'
                    if status not in entradas_por_status:
                        entradas_por_status[status] = []
                    entradas_por_status[status].append(p)

            total_entradas = sum(len(lst) for lst in entradas_por_status.values())
            total_atrasos_qtd = len(entradas_por_status.get('atrasado', []))
            total_minutos_atraso = sum(float(p.minutos_atraso or 0) for status, lst in entradas_por_status.items() for p in lst)
            taxa_pontualidade = ((total_entradas - total_atrasos_qtd) / total_entradas * 100) if total_entradas > 0 else 100.0

            # 4. Estimativa de Horas Extras (Python in-memory)
            minutos_extras_estimados = 0
            overtime_by_employee = {}
            overtime_by_day = {}
            saidas_periodo = [p for p in pontos_bulk if p.tipo_registro == 'saida']

            for p in saidas_periodo:
                if not p.hora:
                    continue
                minutos_saida = _time_to_minutes(p.hora)
                extra = minutos_saida - minuto_saida_ref
                if extra <= 0:
                    continue
                minutos_extras_estimados += extra
                overtime_by_employee[p.funcionario_id] = overtime_by_employee.get(p.funcionario_id, 0) + extra
                day_key = p.data.isoformat() if p.data else None
                if day_key:
                    overtime_by_day[day_key] = overtime_by_day.get(day_key, 0) + extra

            # Buscamos a query dos benefícios por funcionário primeiro para evitar queries duplicadas
            query_ben_func = db.session.query(
                FuncionarioBeneficio.funcionario_id,
                Beneficio.nome,
                FuncionarioBeneficio.valor
            ).select_from(FuncionarioBeneficio).join(Beneficio).join(Funcionario).filter(
                Funcionario.ativo == True,
                FuncionarioBeneficio.ativo == True
            )
            if str(estabelecimento_id).lower() != 'all':
                 query_ben_func = query_ben_func.filter(Funcionario.estabelecimento_id == estabelecimento_id)
            beneficios_por_func = query_ben_func.all()

            # 1. Custo Mensal de Benefícios Ativos (Calculado em Python)
            total_beneficios = sum(float(b[2] or 0) for b in beneficios_por_func)

            # Buscamos todos os funcionários ativos
            query_ativos = Funcionario.query.filter_by(ativo=True)
            if str(estabelecimento_id).lower() != 'all':
                query_ativos = query_ativos.filter_by(estabelecimento_id=estabelecimento_id)
            funcionarios_ativos = query_ativos.all()
            funcionarios_ativos_ids = [f.id for f in funcionarios_ativos]

            # 2. Total Salários Base (Calculado em Python)
            total_salarios = sum(float(f.salario_base or 0) for f in funcionarios_ativos)

            valor_hora_medio = (float(total_salarios) / 220) if total_salarios > 0 else 10.0
            custo_extras_estimado = (minutos_extras_estimados / 60) * valor_hora_medio * 1.5

            # 5. Custo Total Estimado (Agora usa a Fonte de Verdade Oficial)
            try:
                folha_real = calcular_custo_folha_detalhado(estabelecimento_id, inicio_mes, hoje_dia)
                custo_folha_estimado = float(folha_real.get("custo_folha", {}).get("custo_real_total", 0.0))
            except Exception as e_folha:
                logger.error(f"Erro ao calcular folha real no RH Dashboard: {e_folha}")
                custo_folha_estimado = float(total_salarios) + float(total_beneficios) + custo_extras_estimado

            # 6. Rotatividade (Turnover)
            # Admissões no período
            admissoes_query = db.session.query(func.count(Funcionario.id)).filter(
                Funcionario.data_admissao >= data_inicio
            )
            if str(estabelecimento_id).lower() != 'all':
                admissoes_query = admissoes_query.filter(Funcionario.estabelecimento_id == estabelecimento_id)
            admissoes = admissoes_query.scalar() or 0
            
            # Demissões no período
            demissoes_query = db.session.query(func.count(Funcionario.id)).filter(
                Funcionario.data_demissao >= data_inicio
            )
            if str(estabelecimento_id).lower() != 'all':
                demissoes_query = demissoes_query.filter(Funcionario.estabelecimento_id == estabelecimento_id)
            demissoes = demissoes_query.scalar() or 0
            
            query_total = Funcionario.query
            if str(estabelecimento_id).lower() != 'all':
                query_total = query_total.filter_by(estabelecimento_id=estabelecimento_id)
            total_funcionarios = query_total.count()
            # Se não tem funcionários hoje, não tem como calcular taxa corretamente, evita divisão por zero
            media_funcionarios = total_funcionarios if total_funcionarios > 0 else 1
            
            turnover_rate = (((admissoes + demissoes) / 2) / media_funcionarios * 100)

            # 7. Evolução de Admissões e Demissões (Últimos 12 meses)
            # 7. Evolução (Últimos 12 meses) - OTIMIZADO
            def _shift_month(year: int, month: int, delta: int):
                m = month + delta
                y = year + (m - 1) // 12
                m = ((m - 1) % 12) + 1
                return y, m

            now = datetime.now()
            current_year, current_month = now.year, now.month
            start_history = (datetime(current_year, current_month, 1) - timedelta(days=365)).date()
            
            # Busca todas as admissões do ano agrupadas por mês
            admissoes_bulk_query = db.session.query(
                extract('year', Funcionario.data_admissao).label('ano'),
                extract('month', Funcionario.data_admissao).label('mes'),
                func.count(Funcionario.id).label('qtd')
            ).filter(
                Funcionario.data_admissao >= start_history
            )
            if str(estabelecimento_id).lower() != 'all':
                admissoes_bulk_query = admissoes_bulk_query.filter(Funcionario.estabelecimento_id == estabelecimento_id)
            
            admissoes_bulk = admissoes_bulk_query.group_by('ano', 'mes').all()
            
            admissoes_map = {(int(r.ano), int(r.mes)): r.qtd for r in admissoes_bulk}
            
            # Busca todas as demissões do ano agrupadas por mês
            demissoes_bulk_query = db.session.query(
                extract('year', Funcionario.data_demissao).label('ano'),
                extract('month', Funcionario.data_demissao).label('mes'),
                func.count(Funcionario.id).label('qtd')
            ).filter(
                Funcionario.data_demissao >= start_history
            )
            if str(estabelecimento_id).lower() != 'all':
                demissoes_bulk_query = demissoes_bulk_query.filter(Funcionario.estabelecimento_id == estabelecimento_id)
            
            demissoes_bulk = demissoes_bulk_query.group_by('ano', 'mes').all()
            
            demissoes_map = {(int(r.ano), int(r.mes)): r.qtd for r in demissoes_bulk}
            
            # Busca todos os atrasos do ano agrupados por mês
            atrasos_bulk_query = db.session.query(
                extract('year', RegistroPonto.data).label('ano'),
                extract('month', RegistroPonto.data).label('mes'),
                func.count(RegistroPonto.id).label('qtd')
            ).filter(
                RegistroPonto.data >= start_history,
                RegistroPonto.minutos_atraso > 0
            )
            if str(estabelecimento_id).lower() != 'all':
                atrasos_bulk_query = atrasos_bulk_query.filter(RegistroPonto.estabelecimento_id == estabelecimento_id)
            
            atrasos_bulk = atrasos_bulk_query.group_by('ano', 'mes').all()
            
            atrasos_map = {(int(r.ano), int(r.mes)): r.qtd for r in atrasos_bulk}

            evolution_turnover = []
            meses_nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
            
            for i in range(11, -1, -1):
                y, m = _shift_month(current_year, current_month, -i)
                key = (y, m)
                
                admissoes_mes = admissoes_map.get(key, 0)
                demissoes_mes = demissoes_map.get(key, 0)
                atrasos_mes = atrasos_map.get(key, 0)
                
                evolution_turnover.append({
                    "mes": f"{meses_nomes[m-1]}/{str(y)[2:]}",
                    "admissoes": admissoes_mes,
                    "demissoes": demissoes_mes,
                    "atrasos": atrasos_mes,
                    "ausencias": 0,
                    "horas_extras": 0  # Simplificado para performance
                })

            # 8. Detalhamento de Benefícios (Python in-memory)
            benefits_map = {}
            for _, nome, valor in beneficios_por_func:
                benefits_map[nome] = benefits_map.get(nome, 0.0) + float(valor or 0)
            benefits_data = [{"name": name or "Outros", "value": val} for name, val in benefits_map.items()]

            # 9. Top Funcionários com Horas Extras (estimado via ponto, ou via BancoHoras se disponível)
            overtime_list = []
            banco_horas_mes = datetime.now().strftime("%Y-%m")
            banco_registros_query = db.session.query(BancoHoras).join(Funcionario).filter(
                BancoHoras.mes_referencia == banco_horas_mes
            )
            if str(estabelecimento_id).lower() != 'all':
                banco_registros_query = banco_registros_query.filter(Funcionario.estabelecimento_id == estabelecimento_id)
            
            banco_registros = banco_registros_query.all()

            if banco_registros:
                ordenados = sorted(banco_registros, key=lambda r: int(r.saldo_minutos or 0), reverse=True)[:5]
                for r in ordenados:
                    overtime_list.append({
                        "nome": r.funcionario.nome if r.funcionario else "Desconhecido",
                        "horas": round((float(r.saldo_minutos or 0) / 60), 1),
                        "custo_estimado": float(r.valor_hora_extra or 0)
                    })
            else:
                if overtime_by_employee:
                    top_ids = sorted(overtime_by_employee.items(), key=lambda x: x[1], reverse=True)[:5]
                    nomes = dict(db.session.query(Funcionario.id, Funcionario.nome).filter(Funcionario.id.in_([i for i, _ in top_ids])).all())
                    for func_id, mins in top_ids:
                        overtime_list.append({
                            "nome": nomes.get(func_id, "Desconhecido"),
                            "horas": round(float(mins) / 60, 1),
                            "custo_estimado": round((float(mins) / 60) * valor_hora_medio * 1.5, 2)
                        })

            # 12. Entradas Atrasadas no Mês (Python in-memory de pontos_bulk)
            atrasos_por_func_id = {}
            for p in pontos_bulk:
                if p.data >= inicio_mes and p.tipo_registro == 'entrada' and p.minutos_atraso and int(p.minutos_atraso) > 0:
                    fid = p.funcionario_id
                    if fid not in atrasos_por_func_id:
                        atrasos_por_func_id[fid] = {"qtd": 0, "minutos": 0}
                    atrasos_por_func_id[fid]["qtd"] += 1
                    atrasos_por_func_id[fid]["minutos"] += int(p.minutos_atraso or 0)

            # 13. Saídas no Mês (Python in-memory de pontos_bulk)
            extras_mes_por_func_id: Dict[int, int] = {}
            extras_mes_por_dia: Dict[str, int] = {}
            for p in pontos_bulk:
                if p.data >= inicio_mes and p.tipo_registro == 'saida':
                    if not p.hora:
                        continue
                    minutos_saida = _time_to_minutes(p.hora)
                    extra = minutos_saida - minuto_saida_ref
                    if extra <= 0:
                        continue
                    extras_mes_por_func_id[p.funcionario_id] = extras_mes_por_func_id.get(p.funcionario_id, 0) + int(extra)
                    if p.data:
                        extras_mes_por_dia[p.data.isoformat()] = extras_mes_por_dia.get(p.data.isoformat(), 0) + int(extra)

            # Organizar detalhes de benefícios (já populados de beneficios_por_func)
            beneficios_por_func_id = {}
            beneficios_detalhes_por_id = {}
            for fid, nome, valor in beneficios_por_func:
                fid = int(fid)
                val_f = float(valor or 0)
                beneficios_por_func_id[fid] = beneficios_por_func_id.get(fid, 0) + val_f
                if fid not in beneficios_detalhes_por_id:
                    beneficios_detalhes_por_id[fid] = []
                beneficios_detalhes_por_id[fid].append({
                    "descricao": nome,
                    "valor": val_f
                })

            dias_uteis_mes = 0
            d = inicio_mes
            while d <= hoje_dia:
                if d.weekday() != 6:
                    dias_uteis_mes += 1
                d += timedelta(days=1)

            # 15. Dias com Entrada no Mês (Python in-memory de pontos_bulk)
            dias_com_entrada_mes_por_id = {}
            dias_entrada_func_dates = {}  # funcionario_id -> set of dates
            for p in pontos_bulk:
                if p.data >= inicio_mes and p.tipo_registro == 'entrada':
                    fid = p.funcionario_id
                    if fid not in dias_entrada_func_dates:
                        dias_entrada_func_dates[fid] = set()
                    dias_entrada_func_dates[fid].add(p.data)
            
            for fid, dates in dias_entrada_func_dates.items():
                dias_com_entrada_mes_por_id[fid] = len(dates)

            banco_horas_registros_query = db.session.query(BancoHoras).join(Funcionario).filter(
                BancoHoras.mes_referencia == banco_horas_mes
            )
            if str(estabelecimento_id).lower() != 'all':
                banco_horas_registros_query = banco_horas_registros_query.filter(Funcionario.estabelecimento_id == estabelecimento_id)
                
            banco_horas_registros = banco_horas_registros_query.all()

            banco_horas_por_id = {
                int(r.funcionario_id): {
                    "saldo_minutos": int(r.saldo_minutos or 0),
                    "valor_hora_extra": float(r.valor_hora_extra or 0),
                    "horas_trabalhadas_minutos": int(r.horas_trabalhadas_minutos or 0),
                    "horas_esperadas_minutos": int(r.horas_esperadas_minutos or 0)
                }
                for r in banco_horas_registros
            }

            # Obter total de dias justificados (aprovados) por funcionário
            from app.models import JustificativaPonto
            
            justificativas_aprov_query = db.session.query(
                JustificativaPonto.funcionario_id,
                func.count(func.distinct(func.date(JustificativaPonto.data))).label('dias')
            ).filter(JustificativaPonto.status == 'aprovado')
            
            if str(estabelecimento_id).lower() != 'all':
                justificativas_aprov_query = justificativas_aprov_query.filter(JustificativaPonto.estabelecimento_id == estabelecimento_id)
                
            justificativas_aprovadas = {r.funcionario_id: int(r.dias or 0) for r in justificativas_aprov_query.group_by(JustificativaPonto.funcionario_id).all()}

            atrasos_por_funcionario_mes = []
            horas_extras_por_funcionario_mes = []
            faltas_por_funcionario_mes = []
            banco_horas_por_funcionario_mes = []
            espelho_pagamento_mes = []

            for f in funcionarios_ativos:
                atraso_info = atrasos_por_func_id.get(f.id, {"qtd": 0, "minutos": 0})
                extras_min = int(extras_mes_por_func_id.get(f.id, 0))
                beneficios_total = float(beneficios_por_func_id.get(f.id, 0))
                dias_presenca = int(dias_com_entrada_mes_por_id.get(f.id, 0))
                
                # Descontar dias justificados do cálculo de faltas
                dias_justificados = justificativas_aprovadas.get(f.id, 0)
                faltas_calculadas = dias_uteis_mes - dias_presenca
                faltas = max(0, faltas_calculadas - dias_justificados)
                
                banco = banco_horas_por_id.get(f.id, {"saldo_minutos": 0, "valor_hora_extra": 0.0, "horas_trabalhadas_minutos": 0, "horas_esperadas_minutos": 0})

                custo_extras_func = round((extras_min / 60) * valor_hora_medio * 1.5, 2)
                
                # Desconto de faltas no holerite
                valor_diario = float(f.salario_base or 0) / dias_uteis_mes if dias_uteis_mes > 0 else 0
                desconto_faltas = faltas * valor_diario
                
                total_estimado = float(f.salario_base or 0) + beneficios_total + custo_extras_func - desconto_faltas

                atrasos_por_funcionario_mes.append({
                    "funcionario_id": f.id,
                    "nome": f.nome,
                    "cargo": f.cargo,
                    "atrasos_qtd": int(atraso_info["qtd"]),
                    "minutos_atraso": int(atraso_info["minutos"])
                })

                horas_extras_por_funcionario_mes.append({
                    "funcionario_id": f.id,
                    "nome": f.nome,
                    "cargo": f.cargo,
                    "minutos_extras": int(extras_min),
                    "custo_extras": float(custo_extras_func)
                })

                faltas_por_funcionario_mes.append({
                    "funcionario_id": f.id,
                    "nome": f.nome,
                    "cargo": f.cargo,
                    "faltas": int(faltas),
                    "dias_uteis": int(dias_uteis_mes),
                    "dias_presenca": int(dias_presenca)
                })

                banco_horas_por_funcionario_mes.append({
                    "funcionario_id": f.id,
                    "nome": f.nome,
                    "cargo": f.cargo,
                    "saldo_minutos": int(banco["saldo_minutos"]),
                    "valor_hora_extra": float(banco["valor_hora_extra"]),
                    "horas_trabalhadas_minutos": int(banco["horas_trabalhadas_minutos"]),
                    "horas_esperadas_minutos": int(banco["horas_esperadas_minutos"])
                })

                espelho_pagamento_mes.append({
                    "funcionario_id": f.id,
                    "nome": f.nome,
                    "cargo": f.cargo,
                    "salario_base": float(f.salario_base or 0),
                    "beneficios": float(beneficios_total),
                    "beneficios_detalhes": beneficios_detalhes_por_id.get(f.id, []),
                    "horas_extras_horas": round(extras_min / 60, 2),
                    "custo_horas_extras": float(custo_extras_func),
                    "atrasos_minutos": int(atraso_info["minutos"]),
                    "faltas": int(faltas),
                    "banco_horas_saldo_horas": round(int(banco["saldo_minutos"]) / 60, 2),
                    "desconto_faltas": float(desconto_faltas),
                    "total_estimado": round(float(total_estimado), 2)
                })

            atrasos_por_funcionario_mes.sort(key=lambda x: x["minutos_atraso"], reverse=True)
            horas_extras_por_funcionario_mes.sort(key=lambda x: x["minutos_extras"], reverse=True)
            faltas_por_funcionario_mes.sort(key=lambda x: x["faltas"], reverse=True)
            banco_horas_por_funcionario_mes.sort(key=lambda x: x["saldo_minutos"], reverse=True)
            espelho_pagamento_mes.sort(key=lambda x: x["total_estimado"], reverse=True)

            # Otimização sênior contra loop N+1: Buscar todos os pontos de hoje de uma vez só
            pontos_hoje_todos = db.session.query(RegistroPonto).filter(
                RegistroPonto.data == hoje_dia
            ).order_by(RegistroPonto.funcionario_id, RegistroPonto.hora.desc()).all()

            pontos_hoje_map = {}
            for p in pontos_hoje_todos:
                if p.funcionario_id not in pontos_hoje_map:
                    pontos_hoje_map[p.funcionario_id] = p

            team_status = []
            todos_funcionarios = funcionarios_ativos
            
            for funcionario in todos_funcionarios:
                ultimo_ponto = pontos_hoje_map.get(funcionario.id)
                
                status_atual = "Ausente"
                horario_ultimo = "-"
                
                if ultimo_ponto:
                    horario_ultimo = ultimo_ponto.hora.strftime('%H:%M') if ultimo_ponto.hora else "-"
                    if ultimo_ponto.tipo_registro == 'entrada': status_atual = "Em Trabalho"
                    elif ultimo_ponto.tipo_registro == 'saida_almoco': status_atual = "Almoço"
                    elif ultimo_ponto.tipo_registro == 'retorno_almoco': status_atual = "Em Trabalho"
                    elif ultimo_ponto.tipo_registro == 'saida': status_atual = "Saiu"
                
                team_status.append({
                    "nome": funcionario.nome.split()[0], # Primeiro nome
                    "cargo": funcionario.cargo,
                    "status": status_atual,
                    "ultimo_registro": horario_ultimo
                })

            recent_points_query = db.session.query(
                RegistroPonto.data,
                RegistroPonto.hora,
                RegistroPonto.tipo_registro,
                Funcionario.nome
            ).join(Funcionario)
            
            if str(estabelecimento_id).lower() != 'all':
                recent_points_query = recent_points_query.filter(RegistroPonto.estabelecimento_id == estabelecimento_id)
                
            recent_points = recent_points_query.order_by(RegistroPonto.data.desc(), RegistroPonto.hora.desc()).limit(20).all()
            
            recent_points_list = [
                {
                    "data": p.data.strftime('%d/%m/%Y') if p.data else "-",
                    "hora": p.hora.strftime('%H:%M') if p.hora else "-",
                    "tipo": p.tipo_registro,
                    "funcionario": p.nome
                }
                for p in recent_points
            ]

            start_daily = hoje_dia - timedelta(days=6)
            pontos_query = db.session.query(
                RegistroPonto.funcionario_id,
                Funcionario.nome,
                RegistroPonto.data,
                RegistroPonto.hora,
                RegistroPonto.tipo_registro,
                RegistroPonto.minutos_atraso
            ).join(Funcionario).filter(
                RegistroPonto.data >= start_daily
            )
            
            if str(estabelecimento_id).lower() != 'all':
                pontos_query = pontos_query.filter(RegistroPonto.estabelecimento_id == estabelecimento_id)
                
            pontos = pontos_query.all()

            daily_map: Dict[str, Dict[str, Any]] = {}
            for func_id, nome, data_p, hora_p, tipo, min_atraso in pontos:
                if not data_p:
                    continue
                key = f"{data_p.isoformat()}:{func_id}"
                if key not in daily_map:
                    daily_map[key] = {
                        "data": data_p.isoformat(),
                        "funcionario": nome,
                        "entrada": None,
                        "saida": None,
                        "minutos_atraso": 0,
                        "minutos_extras": 0
                    }
                row = daily_map[key]
                if tipo == "entrada" and hora_p:
                    if row["entrada"] is None or hora_p < row["entrada"]:
                        row["entrada"] = hora_p
                    row["minutos_atraso"] += int(min_atraso or 0)
                if tipo == "saida" and hora_p:
                    if row["saida"] is None or hora_p > row["saida"]:
                        row["saida"] = hora_p

            daily_summary = []
            for row in daily_map.values():
                saida = row["saida"]
                if saida:
                    extra = _time_to_minutes(saida) - minuto_saida_ref
                    row["minutos_extras"] = int(extra) if extra > 0 else 0
                daily_summary.append({
                    "data": row["data"],
                    "funcionario": row["funcionario"],
                    "entrada": row["entrada"].strftime("%H:%M") if row["entrada"] else "-",
                    "saida": row["saida"].strftime("%H:%M") if row["saida"] else "-",
                    "minutos_atraso": int(row["minutos_atraso"]),
                    "minutos_extras": int(row["minutos_extras"])
                })

            daily_summary.sort(key=lambda r: (r["data"], r["funcionario"]), reverse=True)

            overtime_trend = []
            for i in range(13, -1, -1):
                d = hoje_dia - timedelta(days=i)
                mins = int(overtime_by_day.get(d.isoformat(), 0))
                overtime_trend.append({
                    "data": d.isoformat(),
                    "minutos_extras": mins,
                    "custo_extras": round((mins / 60) * valor_hora_medio * 1.5, 2)
                })

            from app.models import JustificativaPonto
            
            justificativas_pendentes_query = db.session.query(
                JustificativaPonto.id,
                JustificativaPonto.tipo,
                JustificativaPonto.data,
                JustificativaPonto.motivo,
                Funcionario.nome
            ).join(Funcionario, JustificativaPonto.funcionario_id == Funcionario.id).filter(JustificativaPonto.status == 'pendente')
            
            if str(estabelecimento_id).lower() != 'all':
                justificativas_pendentes_query = justificativas_pendentes_query.filter(JustificativaPonto.estabelecimento_id == estabelecimento_id)
                
            jp_rows = justificativas_pendentes_query.all()
            justificativas_pendentes = [
                {
                    "id": r.id,
                    "funcionario": r.nome,
                    "tipo": r.tipo,
                    "data": r.data.strftime("%d/%m/%Y"),
                    "motivo": r.motivo,
                    "status": "pendente"
                }
                for r in jp_rows
            ]

            return {
                "total_beneficios_mensal": float(total_beneficios),
                "total_salarios": float(total_salarios),
                "custo_folha_estimado": round(custo_folha_estimado, 2),
                "funcionarios_ativos": len(funcionarios_ativos_ids),
                
                # Indicadores de Assiduidade
                "total_entradas_periodo": total_entradas,
                "total_atrasos_qtd": total_atrasos_qtd,
                "taxa_pontualidade": round(taxa_pontualidade, 1),
                "total_minutos_atraso": int(total_minutos_atraso),
                
                # Indicadores de Extras
                "minutos_extras_estimados": int(minutos_extras_estimados),
                "custo_extras_estimado": round(custo_extras_estimado, 2),

                # Indicadores de Rotatividade
                "admissoes_periodo": admissoes,
                "demissoes_periodo": demissoes,
                "turnover_rate": round(turnover_rate, 2),
                
                # Gráficos e Tabelas
                "evolution_turnover": evolution_turnover,
                "benefits_breakdown": benefits_data,
                "top_overtime_employees": overtime_list,
                "team_status_today": team_status,
                "recent_points": recent_points_list,
                "daily_ponto_summary": daily_summary,
                "overtime_trend": overtime_trend,
                "atrasos_por_funcionario_mes": atrasos_por_funcionario_mes,
                "horas_extras_por_funcionario_mes": horas_extras_por_funcionario_mes,
                "faltas_por_funcionario_mes": faltas_por_funcionario_mes,
                "banco_horas_por_funcionario_mes": banco_horas_por_funcionario_mes,
                "espelho_pagamento_mes": espelho_pagamento_mes,
                "justificativas_pendentes": justificativas_pendentes,
                "resumo_mes": {
                    "inicio": inicio_mes.isoformat(),
                    "fim": hoje_dia.isoformat(),
                    "dias_uteis": int(dias_uteis_mes),
                    "total_atrasos_minutos": int(sum([x["minutos_atraso"] for x in atrasos_por_funcionario_mes])),
                    "total_atrasos_qtd": int(sum([x["atrasos_qtd"] for x in atrasos_por_funcionario_mes])),
                    "total_extras_minutos": int(sum([x["minutos_extras"] for x in horas_extras_por_funcionario_mes])),
                    "total_faltas": int(sum([x["faltas"] for x in faltas_por_funcionario_mes]))
                }
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro ao calcular métricas de RH: {e}")
            return {
                "total_beneficios_mensal": 0.0,
                "total_salarios": 0.0,
                "custo_folha_estimado": 0.0,
                "funcionarios_ativos": 0,
                "total_entradas_periodo": 0,
                "total_atrasos_qtd": 0,
                "taxa_pontualidade": 100.0,
                "total_minutos_atraso": 0,
                "minutos_extras_estimados": 0,
                "custo_extras_estimado": 0.0,
                "turnover_rate": 0.0,
                "admissoes_periodo": 0,
                "demissoes_periodo": 0,
                "evolution_turnover": [],
                "benefits_breakdown": [],
                "top_overtime_employees": [],
                "team_status_today": [],
                "recent_points": [],
                "daily_ponto_summary": [],
                "overtime_trend": [],
                "atrasos_por_funcionario_mes": [],
                "horas_extras_por_funcionario_mes": [],
                "faltas_por_funcionario_mes": [],
                "banco_horas_por_funcionario_mes": [],
                "espelho_pagamento_mes": [],
                "resumo_mes": {
                    "inicio": None,
                    "fim": None,
                    "dias_uteis": 0,
                    "total_atrasos_minutos": 0,
                    "total_atrasos_qtd": 0,
                    "total_extras_minutos": 0,
                    "total_faltas": 0
                }
            }

    # (Antigo get_consolidated_financial_summary duplicado foi removido daqui para evitar ambiguidade)

    @staticmethod
    @provide_session
    def get_payment_methods_metrics(db, estabelecimento_id: int, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        Retorna as métricas destrinchadas de formas de pagamento usando a tabela Pagamento,
        com os devidos percentuais perante o montante total.
        """
        try:
            start_dt = start_date if start_date.tzinfo else start_date.replace(tzinfo=timezone.utc)
            end_dt = end_date if end_date.tzinfo else end_date.replace(tzinfo=timezone.utc)

            from app.models import Pagamento, Venda

            # Fazer SUM do valor por forma_pagamento
            q = db.session.query(
                Pagamento.forma_pagamento,
                func.sum(Pagamento.valor).label("total_valor"),
                func.count(Pagamento.id).label("quantidade")
            ).join(Venda).filter(
                Venda.data_venda >= start_dt,
                Venda.data_venda <= end_dt,
                Venda.status != 'cancelada',
                Pagamento.status == 'aprovado'
            )

            if str(estabelecimento_id).lower() != 'all':
                q = q.filter(Venda.estabelecimento_id == estabelecimento_id)

            resultados = q.group_by(Pagamento.forma_pagamento).all()

            total_geral = sum([float(r.total_valor or 0) for r in resultados])
            
            metricas = []
            for r in resultados:
                total_fp = float(r.total_valor or 0)
                percentual = (total_fp / total_geral * 100) if total_geral > 0 else 0.0
                metricas.append({
                    "forma_pagamento": r.forma_pagamento or "Indefinida",
                    "total_valor": total_fp,
                    "quantidade": int(r.quantidade or 0),
                    "percentual": round(percentual, 2)
                })

            # Ordenar por percentual
            metricas.sort(key=lambda x: x["percentual"], reverse=True)

            return {
                "metricas": metricas,
                "total_processado": total_geral
            }
        except Exception as e:
            logger.error(f"Erro ao agregar formas de pagamento: {e}")
            return {"metricas": [], "total_processado": 0.0}

    @staticmethod
    @provide_session
    def get_sales_financials(db, estabelecimento_id: int, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        Retorna dados financeiros de vendas for DRE (Revenue, COGS, Margin).
        Calculado via queries separadas para evitar multiplicação de linhas em JOINs.
        """
        try:
            # db injetado pelo decorator
            # Usar as datas já normalizadas pelo decorator @provide_session
            start_dt = start_date
            end_dt = end_date

            # 1. Total Vendas (Revenue)
            q_rev = db.session.query(func.sum(Venda.total)).filter(
                Venda.data_venda >= start_dt,
                Venda.data_venda <= end_dt,
                Venda.status != 'cancelada'
            )
            if estabelecimento_id != 'all': q_rev = q_rev.filter(Venda.estabelecimento_id == estabelecimento_id)
            revenue = q_rev.scalar() or 0.0

            # 2. Total Vendas Contagem
            q_count = db.session.query(func.count(Venda.id)).filter(
                Venda.data_venda >= start_dt,
                Venda.data_venda <= end_dt,
                Venda.status != 'cancelada'
            )
            if estabelecimento_id != 'all': q_count = q_count.filter(Venda.estabelecimento_id == estabelecimento_id)
            count = q_count.scalar() or 0

            # 3. CMV (Cost of Goods Sold)
            # Use COALESCE to fall back to produtos.preco_custo when custo_unitario is NULL
            from sqlalchemy import case as sa_case
            q_cogs = db.session.query(
                func.sum(custo_efetivo() * VendaItem.quantidade)
            ).join(
                Venda, Venda.id == VendaItem.venda_id
            ).outerjoin(
                Produto, Produto.id == VendaItem.produto_id
            ).filter(
                Venda.data_venda >= start_dt,
                Venda.data_venda <= end_dt,
                Venda.status != 'cancelada'
            )
            if estabelecimento_id != 'all': q_cogs = q_cogs.filter(Venda.estabelecimento_id == estabelecimento_id)
            cogs = q_cogs.scalar() or 0.0

            # 4. Gross Profit
            revenue = float(revenue)
            cogs = float(cogs)
            gross_profit = revenue - cogs

            return {
                "revenue": revenue,
                "cogs": cogs,
                "gross_profit": gross_profit,
                "count": int(count)
            }
        except Exception as e:
            logger.error(f"ERRO CRÍTICO em get_sales_financials: {e}", exc_info=True)
            return {"revenue": 0.0, "cogs": 0.0, "gross_profit": 0.0, "count": 0}
    @staticmethod
    @provide_session
    def get_consolidated_financial_summary(db, estabelecimento_id: int, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        Consolida dados financeiros para o Resumo Financeiro (DRE + Fluxo).
        Otimizado para reduzir round-trips ao banco.
        """
        # Estrutura padrão para evitar 500 se algo falhar
        result = {
            "vendas": {"revenue": 0.0, "cogs": 0.0, "gross_profit": 0.0, "count": 0, "total_recebido": 0.0},
            "despesas": {"total": 0.0, "recorrentes": 0.0, "despesas_pessoal": 0.0,
                         "despesas_operacionais": 0.0, "despesas_caixa": 0.0},
            "contas_pagar": {
                "total_aberto": 0.0, "total_vencido": 0.0, "vence_hoje_valor": 0.0,
                "qtd_vencidos": 0, "qtd_vence_hoje": 0, "qtd_vence_7d": 0,
                "vence_7d": 0.0, "vence_30d": 0.0, "pago_periodo": 0.0
            }
        }

        try:
            # db injetado pelo decorator
            if isinstance(start_date, datetime):
                start_dt = start_date if start_date.tzinfo else start_date.replace(tzinfo=timezone.utc)
            else:
                start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
                
            if isinstance(end_date, datetime):
                end_dt = end_date if end_date.tzinfo else end_date.replace(tzinfo=timezone.utc)
            else:
                end_dt = datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)
                if end_dt.hour == 0:
                    end_dt = end_dt.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)

            # 1. DADOS DE VENDAS
            try:
                sales_data = DataLayer.get_sales_financials(estabelecimento_id, start_dt, end_dt)
                if isinstance(sales_data, dict):
                    result["vendas"].update(sales_data)
                
                # Total recebido no ato da venda (Cash Flow). Só pagamentos aprovados que
                # entram em caixa: fiado é a receber (entra quando o cliente paga) e
                # o troco devolvido ao cliente não é entrada. Antes somava Venda.valor_recebido,
                # que inclui o fiado e o excedente pago em dinheiro.
                from app.models import Pagamento
                q_pagamentos = db.session.query(func.sum(Pagamento.valor)).join(
                    Venda, Venda.id == Pagamento.venda_id
                ).filter(
                    Venda.data_venda >= start_dt,
                    Venda.data_venda <= end_dt,
                    Venda.status != 'cancelada',
                    Pagamento.status == 'aprovado',
                    func.lower(Pagamento.forma_pagamento) != 'fiado',
                )
                q_troco = db.session.query(func.sum(Venda.troco)).filter(
                    Venda.data_venda >= start_dt,
                    Venda.data_venda <= end_dt,
                    Venda.status != 'cancelada',
                )
                if estabelecimento_id != 'all':
                    q_pagamentos = q_pagamentos.filter(Venda.estabelecimento_id == estabelecimento_id)
                    q_troco = q_troco.filter(Venda.estabelecimento_id == estabelecimento_id)
                total_recebido = float(q_pagamentos.scalar() or 0) - float(q_troco.scalar() or 0)
                result["vendas"]["total_recebido"] = max(0.0, total_recebido)

                # ── MovimentacaoCaixa do PDV (sangrias e suprimentos) ─────────
                try:
                    from app.models import MovimentacaoCaixa
                    q_mov_stats = db.session.query(
                        func.coalesce(
                            func.sum(case((MovimentacaoCaixa.tipo == 'sangria', MovimentacaoCaixa.valor), else_=0)), 0
                        ).label('sangrias'),
                        func.coalesce(
                            func.sum(case((MovimentacaoCaixa.tipo == 'suprimento', MovimentacaoCaixa.valor), else_=0)), 0
                        ).label('suprimentos'),
                    ).filter(
                        MovimentacaoCaixa.created_at >= start_dt,
                        MovimentacaoCaixa.created_at <= end_dt,
                    )
                    if estabelecimento_id != 'all': q_mov_stats = q_mov_stats.filter(MovimentacaoCaixa.estabelecimento_id == estabelecimento_id)
                    mov_stats = q_mov_stats.first()
                    result["caixa_pdv"] = {
                        "sangrias": float(mov_stats.sangrias or 0),
                        "suprimentos": float(mov_stats.suprimentos or 0),
                    }
                except Exception as e_mov:
                    logger.warning(f"Erro ao ler MovimentacaoCaixa: {e_mov}")
                    result["caixa_pdv"] = {"sangrias": 0.0, "suprimentos": 0.0}

            except Exception as e:
                logger.error(f"Erro processando VENDAS em get_consolidated_financial_summary: {e}")

            # 2. DADOS DE DESPESAS
            try:
                # Categorias espelhadas (ver app.utils.financeiro_constants):
                # 'Fornecedores'/'Boleto de Mercadoria' duplicam ContaPagar.pago;
                # 'Folha de Pagamento'/'Benefícios' (lançamentos manuais) duplicam a
                # folha calculada. Ficam fora dos agregados de competência.
                from app.utils.financeiro_constants import CATEGORIAS_INTEGRADAS as _CATS_INTEGRADAS, CATEGORIAS_ESPELHO_BOLETO as _CATS_ESPELHO_BOLETO
                _cat_norm = func.lower(func.trim(func.coalesce(Despesa.categoria, '')))
                _sem_espelho_boleto = _cat_norm.notin_(_CATS_ESPELHO_BOLETO)
                _sem_espelho_total = _cat_norm.notin_(_CATS_INTEGRADAS)

                q_desp = db.session.query(
                    func.sum(case((_sem_espelho_total, Despesa.valor), else_=0)).label('operacionais'),
                    func.sum(case((and_(_sem_espelho_total, Despesa.recorrente == True), Despesa.valor), else_=0)).label('recorrentes'),
                    # Visão CAIXA: tudo que saiu como Despesa exceto os espelhos
                    # de boleto (cobertos por ContaPagar.pago_periodo) — inclui
                    # pagamentos manuais de salário, que SÃO desembolso real.
                    func.sum(case((_sem_espelho_boleto, Despesa.valor), else_=0)).label('caixa'),
                ).filter(
                    Despesa.data_despesa >= start_dt,
                    Despesa.data_despesa <= end_dt
                )
                if estabelecimento_id != 'all': q_desp = q_desp.filter(Despesa.estabelecimento_id == estabelecimento_id)
                despesas_query = q_desp.first()

                # Buscar o custo da folha de pagamento e somá-lo
                try:
                    folha_dados = calcular_custo_folha_detalhado(estabelecimento_id, start_dt, end_dt)
                    despesas_pessoal = float(folha_dados.get("custo_folha", {}).get("custo_real_total", 0.0))
                except Exception as e_folha:
                    logger.error(f"Erro calculando folha no DRE: {e_folha}")
                    despesas_pessoal = 0.0

                total_despesas_operacionais = float(despesas_query.operacionais or 0) if despesas_query else 0.0
                total_recorrentes = float(despesas_query.recorrentes or 0) if despesas_query else 0.0
                despesas_caixa = float(despesas_query.caixa or 0) if despesas_query else 0.0

                result["despesas"] = {
                    "total": total_despesas_operacionais + despesas_pessoal,
                    "recorrentes": total_recorrentes,
                    "despesas_pessoal": despesas_pessoal,
                    "despesas_operacionais": total_despesas_operacionais,
                    "despesas_caixa": despesas_caixa,
                }
            except Exception as e:
                logger.error(f"Erro processando DESPESAS em get_consolidated_financial_summary: {e}")

            # 3. CONTAS A PAGAR (Cálculo Independente de Filtro de Data para Aberto/Vencido)
            try:
                hoje = datetime.now(timezone.utc).date()
                date_7d = hoje + timedelta(days=7)
                date_30d = hoje + timedelta(days=30)
                
                # Para "A Pagar", o filtro de data start/end geralmente não se aplica ao SALDO ABERTO,
                # pois dívidas de meses passados ainda são dívidas hoje.
                q_contas = db.session.query(
                    func.coalesce(func.sum(ContaPagar.valor_atual - func.coalesce(ContaPagar.valor_pago, 0)), 0).label('total_aberto'),
                    func.count(ContaPagar.id).filter(ContaPagar.data_vencimento < hoje).label('qtd_vencidos'),
                    func.coalesce(func.sum(case((ContaPagar.data_vencimento < hoje, ContaPagar.valor_atual - func.coalesce(ContaPagar.valor_pago, 0)), else_=0)), 0).label('total_vencido'),
                    func.coalesce(func.sum(case((and_(ContaPagar.data_vencimento >= hoje, ContaPagar.data_vencimento <= hoje), ContaPagar.valor_atual - func.coalesce(ContaPagar.valor_pago, 0)), else_=0)), 0).label('vence_hoje_valor'),
                    func.count(ContaPagar.id).filter(and_(ContaPagar.data_vencimento >= hoje, ContaPagar.data_vencimento <= hoje)).label('qtd_vence_hoje'),
                    func.count(ContaPagar.id).filter(and_(ContaPagar.data_vencimento >= hoje, ContaPagar.data_vencimento <= date_7d)).label('qtd_vence_7d'),
                    func.coalesce(func.sum(case((and_(ContaPagar.data_vencimento >= hoje, ContaPagar.data_vencimento <= date_7d), ContaPagar.valor_atual - func.coalesce(ContaPagar.valor_pago, 0)), else_=0)), 0).label('vence_7d'),
                    func.coalesce(func.sum(case((and_(ContaPagar.data_vencimento >= hoje, ContaPagar.data_vencimento <= date_30d), ContaPagar.valor_atual - func.coalesce(ContaPagar.valor_pago, 0)), else_=0)), 0).label('vence_30d')
                ).filter(
                    ContaPagar.status.in_(['aberto', 'parcial'])
                )
                if estabelecimento_id != 'all': q_contas = q_contas.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
                contas_query = q_contas.first()
                
                # Pagamentos realizados no período específico (para Fluxo de Caixa REAL)
                q_pagamentos = db.session.query(func.coalesce(func.sum(ContaPagar.valor_pago), 0)).filter(
                    ContaPagar.data_pagamento >= start_dt,
                    ContaPagar.data_pagamento <= end_dt,
                    ContaPagar.status.in_(['pago', 'parcial'])
                )
                if estabelecimento_id != 'all': q_pagamentos = q_pagamentos.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
                pagamentos_query = q_pagamentos.scalar()

                result["contas_pagar"] = {
                    "total_aberto": float(contas_query.total_aberto),
                    "total_vencido": float(contas_query.total_vencido),
                    "vence_hoje_valor": float(contas_query.vence_hoje_valor),
                    "qtd_vencidos": int(contas_query.qtd_vencidos or 0),
                    "qtd_vence_hoje": int(contas_query.qtd_vence_hoje or 0),
                    "qtd_vence_7d": int(contas_query.qtd_vence_7d or 0),
                    "vence_7d": float(contas_query.vence_7d),
                    "vence_30d": float(contas_query.vence_30d),
                    "pago_periodo": float(pagamentos_query or 0)
                }
            except Exception as e:
                logger.error(f"Erro processando CONTAS A PAGAR em get_consolidated_financial_summary: {e}")

            # 4. DESPESAS A VENCER (obrigações futuras cadastradas com data_vencimento)
            try:
                hoje = datetime.now(timezone.utc).date()
                date_7d = hoje + timedelta(days=7)
                date_30d = hoje + timedelta(days=30)
                q_dv = db.session.query(
                    func.coalesce(func.sum(case((and_(Despesa.data_vencimento >= hoje, Despesa.data_vencimento <= hoje), Despesa.valor), else_=0)), 0).label('vence_hoje'),
                    func.coalesce(func.sum(case((and_(Despesa.data_vencimento >= hoje, Despesa.data_vencimento <= date_7d), Despesa.valor), else_=0)), 0).label('vence_7d'),
                    func.coalesce(func.sum(case((and_(Despesa.data_vencimento >= hoje, Despesa.data_vencimento <= date_30d), Despesa.valor), else_=0)), 0).label('vence_30d'),
                    func.coalesce(func.sum(case((Despesa.data_vencimento < hoje, Despesa.valor), else_=0)), 0).label('vencidas'),
                ).filter(Despesa.data_vencimento.isnot(None))
                if estabelecimento_id != 'all':
                    q_dv = q_dv.filter(Despesa.estabelecimento_id == estabelecimento_id)
                dv = q_dv.first()
                result["despesas_a_vencer"] = {
                    "vence_hoje": float(dv.vence_hoje or 0),
                    "vence_7d": float(dv.vence_7d or 0),
                    "vence_30d": float(dv.vence_30d or 0),
                    "vencidas": float(dv.vencidas or 0),
                }
            except Exception as e:
                logger.error(f"Erro processando DESPESAS A VENCER em get_consolidated_financial_summary: {e}")
                result["despesas_a_vencer"] = {"vence_hoje": 0.0, "vence_7d": 0.0, "vence_30d": 0.0, "vencidas": 0.0}

            return result

        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro GERAL em get_consolidated_financial_summary: {e}")
            return result # Retorna estrutura vazia/zerada em caso de catástrofe

    @staticmethod
    @provide_session
    def get_fiado_metrics(db, estabelecimento_id: int) -> Dict[str, Any]:
        """
        Métricas de Carteira de Fiado/Crédito.
        Retorna dados reais de exposição de crédito a partir de Cliente.saldo_devedor.
        Usado no Dashboard Principal e no módulo de Inteligência de Negócio.
        """
        try:
            # db injetado pelo decorator
            # Agrega totais de saldo_devedor e limite_credito de clientes ativos
            query_agg = db.session.query(
                func.coalesce(func.sum(Cliente.saldo_devedor), 0).label('total_aberto'),
                func.coalesce(func.sum(Cliente.limite_credito), 0).label('total_limite'),
                func.count(case((Cliente.saldo_devedor > 0, 1))).label('clientes_com_fiado'),
                func.count(Cliente.id).label('total_clientes'),
            ).filter(
                Cliente.ativo == True
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_agg = query_agg.filter(Cliente.estabelecimento_id == estabelecimento_id)
                
            agg = query_agg.first()

            total_aberto = float(agg.total_aberto or 0)
            total_limite = float(agg.total_limite or 0)
            clientes_com_fiado = int(agg.clientes_com_fiado or 0)
            total_clientes = int(agg.total_clientes or 0)

            # -------------------------------------------------------------
            # AI & Predictive Metrics para Gestão de Fiados
            # -------------------------------------------------------------
            hoje = datetime.now(timezone.utc)
            trinta_dias_atras = hoje - timedelta(days=30)

            # 1. Tendência: Novos Fiados vs. Pagamentos (últimos 30 dias)
            from app.models import Pagamento as PagamentoModel
            query_novos = db.session.query(
                func.coalesce(func.sum(PagamentoModel.valor), 0)
            ).join(Venda).filter(
                PagamentoModel.forma_pagamento.ilike('%fiado%'),
                PagamentoModel.status == 'aprovado',
                Venda.status == 'finalizada',
                Venda.data_venda >= trinta_dias_atras
            )
            if str(estabelecimento_id).lower() != 'all':
                query_novos = query_novos.filter(Venda.estabelecimento_id == estabelecimento_id)
            novos_fiados_30d = query_novos.scalar() or 0.0

            # Quantidade de vendas no fiado (para ticket médio)
            query_qtd_fiado = db.session.query(func.count(func.distinct(Venda.id))).join(PagamentoModel).filter(
                PagamentoModel.forma_pagamento.ilike('%fiado%'),
                PagamentoModel.status == 'aprovado',
                Venda.status == 'finalizada',
                Venda.data_venda >= trinta_dias_atras
            )
            if str(estabelecimento_id).lower() != 'all':
                query_qtd_fiado = query_qtd_fiado.filter(Venda.estabelecimento_id == estabelecimento_id)
            qtd_vendas_fiado = query_qtd_fiado.scalar() or 0
            ticket_medio_fiado_30d = (float(novos_fiados_30d) / float(qtd_vendas_fiado)) if qtd_vendas_fiado > 0 else 0.0

            from app.models import MovimentacaoCaixa
            query_pag = db.session.query(func.coalesce(func.sum(MovimentacaoCaixa.valor), 0)).filter(
                MovimentacaoCaixa.tipo == 'suprimento',
                db.or_(
                    MovimentacaoCaixa.descricao.ilike('Receb. Fiado%'),
                    MovimentacaoCaixa.observacoes.ilike('%Pagamento de fiado%')
                ),
                MovimentacaoCaixa.created_at >= trinta_dias_atras
            )
            if str(estabelecimento_id).lower() != 'all':
                query_pag = query_pag.filter(MovimentacaoCaixa.estabelecimento_id == estabelecimento_id)
            pagamentos_fiado_30d = query_pag.scalar() or 0.0

            taxa_recuperacao = (float(pagamentos_fiado_30d) / float(novos_fiados_30d) * 100) if float(novos_fiados_30d) > 0 else 100.0

            # 2. Top Produtos vendidos no Fiado
            from app.models import VendaItem
            query_top_prod = db.session.query(
                VendaItem.produto_nome,
                func.sum(VendaItem.quantidade).label('qtde'),
                func.sum(VendaItem.total_item).label('valor')
            ).join(Venda, Venda.id == VendaItem.venda_id).join(
                PagamentoModel, PagamentoModel.venda_id == Venda.id
            ).filter(
                PagamentoModel.forma_pagamento.ilike('%fiado%'),
                PagamentoModel.status == 'aprovado',
                Venda.status == 'finalizada',
                Venda.data_venda >= trinta_dias_atras
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_top_prod = query_top_prod.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            top_produtos_query = query_top_prod.group_by(VendaItem.produto_nome).order_by(desc('valor')).limit(5).all()

            top_produtos = [{"nome": p.produto_nome, "quantidade": float(p.qtde), "valor": float(p.valor)} for p in top_produtos_query]

            # 3. Bons Pagadores: Clientes que frequentemente compram fiado mas quitam as dívidas rapidamente.
            query_bons = db.session.query(
                Cliente.id,
                Cliente.nome,
                Cliente.celular,
                func.sum(PagamentoModel.valor).label('volume_credito')
            ).join(Venda, Venda.cliente_id == Cliente.id).join(
                PagamentoModel, PagamentoModel.venda_id == Venda.id
            ).filter(
                Cliente.saldo_devedor <= 0,
                PagamentoModel.forma_pagamento.ilike('%fiado%'),
                PagamentoModel.status == 'aprovado',
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_bons = query_bons.filter(Cliente.estabelecimento_id == estabelecimento_id)
                
            bons_pagadores_query = query_bons.group_by(Cliente.id, Cliente.nome, Cliente.celular).order_by(desc('volume_credito')).limit(5).all()

            bons_pagadores = []
            for c in bons_pagadores_query:
                # Sem "score" inventado: expomos apenas o volume real já quitado.
                bons_pagadores.append({
                    "id": c.id,
                    "nome": c.nome,
                    "celular": c.celular or "",
                    "volume_credito": float(c.volume_credito or 0)
                })

            # Maior devedor — busca separada por clareza
            query_maior = db.session.query(
                Cliente.id,
                Cliente.nome,
                Cliente.celular,
                Cliente.saldo_devedor,
                Cliente.limite_credito
            ).filter(
                Cliente.ativo == True,
                Cliente.saldo_devedor > 0
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_maior = query_maior.filter(Cliente.estabelecimento_id == estabelecimento_id)
                
            maior_devedor = query_maior.order_by(Cliente.saldo_devedor.desc()).first()

            # Top 5 devedores para ranking
            query_top_dev = db.session.query(
                Cliente.id,
                Cliente.nome,
                Cliente.celular,
                Cliente.saldo_devedor,
                Cliente.limite_credito,
                Cliente.ultima_compra
            ).filter(
                Cliente.ativo == True,
                Cliente.saldo_devedor > 0
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_top_dev = query_top_dev.filter(Cliente.estabelecimento_id == estabelecimento_id)
                
            top_devedores = query_top_dev.order_by(Cliente.saldo_devedor.desc()).limit(5).all()

            # % de utilização do limite total
            percentual_limite_utilizado = (total_aberto / total_limite * 100) if total_limite > 0 else 0.0

            # % de clientes com fiado vs total
            percentual_clientes_com_fiado = (clientes_com_fiado / total_clientes * 100) if total_clientes > 0 else 0.0

            # Ticket médio de fiado por devedor
            ticket_medio_fiado = (total_aberto / clientes_com_fiado) if clientes_com_fiado > 0 else 0.0

            return {
                "total_aberto": round(total_aberto, 2),
                "total_limite": round(total_limite, 2),
                "clientes_com_fiado": clientes_com_fiado,
                "total_clientes": total_clientes,
                "percentual_limite_utilizado": round(percentual_limite_utilizado, 1),
                "percentual_clientes_com_fiado": round(percentual_clientes_com_fiado, 1),
                "ticket_medio_fiado": round(ticket_medio_fiado, 2),
                "maior_devedor_id": maior_devedor.id if maior_devedor else None,
                "maior_devedor_nome": maior_devedor.nome if maior_devedor else "",
                "maior_devedor_celular": maior_devedor.celular if maior_devedor else "",
                "maior_devedor_valor": float(maior_devedor.saldo_devedor) if maior_devedor else 0.0,
                "top_devedores": [
                    {
                        "id": d.id,
                        "nome": d.nome,
                        "celular": d.celular or "",
                        "saldo_devedor": float(d.saldo_devedor or 0),
                        "limite_credito": float(d.limite_credito or 0),
                        "percentual_limite": (
                            float(d.saldo_devedor or 0) / float(d.limite_credito or 1) * 100
                            if d.limite_credito and d.limite_credito > 0 else 0.0
                        ),
                        "ultima_compra": d.ultima_compra.isoformat() if d.ultima_compra else None,
                        # Status factual derivado do uso REAL do limite (não é um "score" inventado)
                        "recomendacao": (
                            "Limite estourado" if (d.limite_credito and float(d.saldo_devedor or 0) >= float(d.limite_credito))
                            else "Próximo do limite" if (d.limite_credito and float(d.saldo_devedor or 0) / float(d.limite_credito) >= 0.8)
                            else "Dentro do limite"
                        )
                    }
                    for d in top_devedores
                ],
                "tendencias": {
                    "novos_fiados_30d": float(novos_fiados_30d),
                    "ticket_medio_fiado_30d": round(ticket_medio_fiado_30d, 2),
                    "pagamentos_fiado_30d": float(pagamentos_fiado_30d),
                    "taxa_recuperacao_percentual": round(taxa_recuperacao, 1),
                    "status": "saudavel" if taxa_recuperacao >= 80 else ("alerta" if taxa_recuperacao >= 50 else "critico")
                },
                "top_produtos": top_produtos,
                "bons_pagadores": bons_pagadores
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_fiado_metrics: {e}")
            return {
                "total_aberto": 0.0,
                "total_limite": 0.0,
                "clientes_com_fiado": 0,
                "total_clientes": 0,
                "percentual_limite_utilizado": 0.0,
                "percentual_clientes_com_fiado": 0.0,
                "ticket_medio_fiado": 0.0,
                "maior_devedor_id": None,
                "maior_devedor_nome": "",
                "maior_devedor_celular": "",
                "maior_devedor_valor": 0.0,
                "top_devedores": [],
                "tendencias": {"novos_fiados_30d": 0.0, "pagamentos_fiado_30d": 0.0, "taxa_recuperacao_percentual": 0.0, "status": "alerta"},
                "top_produtos": [],
                "bons_pagadores": []
            }

    @staticmethod
    @provide_session
    def get_receivables_metrics(db, estabelecimento_id: int) -> Dict[str, Any]:
        """
        Métricas de Contas a Receber (Vencidos vs A Receber).
        Diferente de get_fiado_metrics (que olha o saldo total do cliente),
        esta foca nos títulos (ContaReceber) individuais.
        """
        try:
            # db injetado pelo decorator
            hoje = datetime.now(timezone.utc).date()
            
            # Agrega por status de vencimento
            query_agg_stats = db.session.query(
                func.sum(case((and_(ContaReceber.status == 'aberto', ContaReceber.data_vencimento < hoje), ContaReceber.valor_atual), else_=0)).label('total_vencido'),
                func.sum(case((and_(ContaReceber.status == 'aberto', ContaReceber.data_vencimento >= hoje), ContaReceber.valor_atual), else_=0)).label('total_a_vencer'),
                func.count(case((and_(ContaReceber.status == 'aberto', ContaReceber.data_vencimento < hoje), 1))).label('titulos_vencidos'),
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_agg_stats = query_agg_stats.filter(ContaReceber.estabelecimento_id == estabelecimento_id)
                
            stats = query_agg_stats.first()

            total_vencido = float(stats.total_vencido or 0)
            total_a_vencer = float(stats.total_a_vencer or 0)
            total_recebível = total_vencido + total_a_vencer
            
            taxa_inadimplencia = (total_vencido / total_recebível * 100) if total_recebível > 0 else 0.0

            # Ranking de Devedores (por valor vencido)
            query_rk = db.session.query(
                Cliente.id,
                Cliente.nome,
                func.sum(ContaReceber.valor_atual).label('valor_vencido'),
                func.min(ContaReceber.data_vencimento).label('mais_antigo')
            ).join(
                ContaReceber, Cliente.id == ContaReceber.cliente_id
            ).filter(
                ContaReceber.status == 'aberto',
                ContaReceber.data_vencimento < hoje
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query_rk = query_rk.filter(ContaReceber.estabelecimento_id == estabelecimento_id)
                
            ranking_overdue = query_rk.group_by(
                Cliente.id, Cliente.nome
            ).order_by(
                desc('valor_vencido')
            ).limit(10).all()

            return {
                "total_vencido": round(total_vencido, 2),
                "total_a_vencer": round(total_a_vencer, 2),
                "total_recebivel": round(total_recebível, 2),
                "taxa_inadimplencia": round(taxa_inadimplencia, 1),
                "titulos_vencidos": int(stats.titulos_vencidos or 0),
                "ranking_atraso": [
                    {
                        "cliente_id": r.id,
                        "nome": r.nome,
                        "valor_vencido": float(r.valor_vencido),
                        "dias_atraso": (hoje - r.mais_antigo).days if r.mais_antigo else 0
                    }
                    for r in ranking_overdue
                ]
            }
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_receivables_metrics: {e}")
            return {
                "total_vencido": 0.0,
                "total_a_vencer": 0.0,
                "total_recebivel": 0.0,
                "taxa_inadimplencia": 0.0,
                "titulos_vencidos": 0,
                "ranking_atraso": []
            }

    @staticmethod
    @provide_session
    def get_sellers_performance(db, estabelecimento_id: int, days: int) -> List[Dict[str, Any]]:
        """
        Analítica de Força de Vendas (SFA):
        Calcula faturamento do período atual vs período passado, tendência e meta (projetada +10%).
        """
        now = datetime.utcnow()
        start_current = now - timedelta(days=days)
        start_previous = start_current - timedelta(days=days)

        # 1. Query Current Period
        q_current = db.session.query(
            Venda.funcionario_id,
            func.sum(Venda.total).label('total_atual'),
            func.count(Venda.id).label('qtd_atual')
        ).filter(
            Venda.status == 'finalizada',
            Venda.data_venda >= start_current,
            Venda.data_venda <= now
        )
        if estabelecimento_id != 'all':
            q_current = q_current.filter(Venda.estabelecimento_id == estabelecimento_id)
            
        current_query = q_current.group_by(Venda.funcionario_id).all()

        current_map = {row.funcionario_id: {"total": float(row.total_atual or 0), "qtd": row.qtd_atual} for row in current_query}

        # 2. Query Previous Period
        q_prev = db.session.query(
            Venda.funcionario_id,
            func.sum(Venda.total).label('total_passado')
        ).filter(
            Venda.status == 'finalizada',
            Venda.data_venda >= start_previous,
            Venda.data_venda < start_current
        )
        if estabelecimento_id != 'all':
            q_prev = q_prev.filter(Venda.estabelecimento_id == estabelecimento_id)
            
        previous_query = q_prev.group_by(Venda.funcionario_id).all()

        previous_map = {row.funcionario_id: float(row.total_passado or 0) for row in previous_query}

        # 3. Retrieve Vendedores info
        seller_ids = [s for s in set(list(current_map.keys()) + list(previous_map.keys())) if s is not None]
        if not seller_ids:
            return []

        q_func = db.session.query(Funcionario.id, Funcionario.nome).filter(
            Funcionario.id.in_(seller_ids)
        )
        if estabelecimento_id != 'all':
            q_func = q_func.filter(Funcionario.estabelecimento_id == estabelecimento_id)
            
        funcionarios = q_func.all()

        vendedores = []
        for f_id, f_nome in funcionarios:
            atual = current_map.get(f_id, {"total": 0.0, "qtd": 0})
            passado = previous_map.get(f_id, 0.0)
            
            # Meta projetada = Faturamento passado * 1.10 (10% de crescimento desejado)
            meta = passado * 1.10
            if meta == 0:
                meta = atual["total"] * 1.20 if atual["total"] > 0 else 5000.0 # Valor arbitrário para quem não tem histórico

            tendencia = 0.0
            if passado > 0:
                tendencia = ((atual["total"] - passado) / passado) * 100.0

            vendedores.append({
                "id": f_id,
                "nome": f_nome,
                "alcancado": atual["total"],
                "meta": round(meta, 2),
                "tendencia": round(tendencia, 1),
                "vendas_count": atual["qtd"]
            })

        return sorted(vendedores, key=lambda x: x["alcancado"], reverse=True)

