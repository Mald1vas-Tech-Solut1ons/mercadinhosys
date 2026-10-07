"""
Orchestration Layer - Orquestra todas as camadas
Foco: Simplicidade e clareza
"""

from typing import Dict, Any
from datetime import datetime, timezone
import logging
from decimal import Decimal
from .data_layer import DataLayer
from .stats_layer import StatsValidator
from .models_layer import PracticalModels
from .temporal_analysis import TemporalAnalysis
from .serializers import DashboardSerializer
from .cache_layer import cache_response

# Alias para facilitar uso em cálculos
_PM = PracticalModels

# Logger global - DEVE estar no nível do módulo
logger = logging.getLogger(__name__)


def run_in_parallel(task_dict: Dict[str, Any], max_workers: int = 3) -> Dict[str, Any]:
    """
    Executes multiple database tasks in parallel, safely propagating Flask app context
    and releasing SQLAlchemy sessions to prevent connection pool overflow.
    """
    from concurrent.futures import ThreadPoolExecutor
    import flask
    import time
    import logging
    _logger = logging.getLogger(__name__)

    app = flask.current_app._get_current_object()
    results = {}

    def worker(name, func):
        with app.app_context():
            t_start = time.time()
            try:
                res = func()
                _logger.info(f"⚡ Parallel task '{name}' finished in {time.time() - t_start:.3f}s")
                return name, res, None
            except Exception as ex:
                _logger.error(f"❌ Parallel task '{name}' failed: {ex}", exc_info=True)
                return name, None, ex
            finally:
                from app.models import db
                db.session.remove()

    # Limit to 3 workers to prevent SQLAlchemy QueuePool exhaustion
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(worker, name, func) for name, func in task_dict.items()]
        for fut in futures:
            name, res, err = fut.result()
            
            # Critical tasks must not fail silently, otherwise the dashboard caches zeros.
            critical_tasks = [
                "financials_data", "sales_current_summary", 
                "expense_details", "sales_previous_summary", "sales_timeseries"
            ]
            if err and name in critical_tasks:
                _logger.critical(f"Aborting dashboard generation due to critical task failure: {name}")
                raise Exception(f"Critical task '{name}' failed: {err}")
                
            results[name] = res

    return results

class DashboardOrchestrator:
    """Orquestra a geração do dashboard"""

    def __init__(self, establishment_id: Any, is_super_admin: bool = False):
        self.establishment_id = establishment_id

    # @cache_response(ttl_seconds=60, require_db_check=False)  # DESATIVADO PARA DEBUG
    def get_executive_dashboard(self, days: int = 30) -> Dict[str, Any]:
        """
        Dashboard executivo - Resumo para gestão
        """
        # 1. Coletar dados
        from datetime import timedelta
        end_date = datetime.now(timezone.utc)
        start_current = end_date - timedelta(days=days)
        start_previous = end_date - timedelta(days=days * 2)
        end_previous = end_date - timedelta(days=days)

        sales_summary = DataLayer.get_sales_summary_range(
            self.establishment_id, start_current, end_date
        )
        sales_summary_previous = DataLayer.get_sales_summary_range(
            self.establishment_id, start_previous, end_previous
        )
        sales_timeseries = DataLayer.get_sales_timeseries(self.establishment_id, days)
        inventory_summary = DataLayer.get_inventory_summary(self.establishment_id)
        customer_metrics = DataLayer.get_customer_metrics(self.establishment_id, days)
        rh_metrics = DataLayer.get_rh_metrics(self.establishment_id, days)
        # SFA: performance de vendedores (estava referenciada no retorno sem ser definida)
        sellers_performance = DataLayer.get_sellers_performance(self.establishment_id, days) or []

        def _confidence_from_samples(samples: int) -> str:
            if samples < 5:
                return "INSUFICIENT"
            if samples < 15:
                return "LOW"
            if samples < 30:
                return "MEDIUM"
            return "HIGH"

        sales_current = {
            "value": sales_summary.get("total_faturado", 0),
            "confidence": _confidence_from_samples(sales_summary.get("total_vendas", 0)),
            "sample_size": sales_summary.get("total_vendas", 0),
            "warnings": [],
        }

        sales_previous = {
            "value": sales_summary_previous.get("total_faturado", 0),
            "confidence": _confidence_from_samples(
                sales_summary_previous.get("total_vendas", 0)
            ),
            "sample_size": sales_summary_previous.get("total_vendas", 0),
            "warnings": [],
        }

        # Calcular crescimento
        growth = StatsValidator.calculate_growth(
            current_value=sales_current.get("value", 0),
            previous_value=sales_previous.get("value", 0),
            current_samples=sales_current.get("sample_size", 0),
            previous_samples=sales_previous.get("sample_size", 0),
        )

        # 3. Análises científicas
        trend_analysis = PracticalModels.detect_sales_trend(sales_timeseries)

        # Análise ABC do estoque
        top_products = DataLayer.get_top_products(self.establishment_id, days, 50)
        abc_analysis = PracticalModels.analyze_inventory_abc(
            [
                {
                    "nome": p["nome"],
                    "valor_total": p["faturamento"],
                    "quantidade": p["quantidade_vendida"],
                }
                for p in top_products
            ]
        )

        # Score de saúde — calculate_health_score espera UM dict financeiro
        # com 'revenue'/'gross_profit' (a assinatura antiga de 3 args não existe).
        financas_score = {
            "revenue": float(sales_summary.get("total_faturado", 0) or 0),
            "gross_profit": float(
                sales_summary.get("lucro_bruto", sales_summary.get("total_lucro", 0)) or 0
            ),
        }
        health_score = PracticalModels.calculate_health_score(financas_score)

        # 4. Serializar para frontend
        serializer = DashboardSerializer()

        return {
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "period_days": days,
            "summary": {
                "revenue": serializer.serialize_metric(sales_current),
                "growth": serializer.serialize_growth(growth),
                "avg_ticket": serializer.serialize_metric(
                    {
                        "value": sales_summary["ticket_medio"],
                        "confidence": "HIGH",
                        "sample_size": sales_summary["total_vendas"],
                    }
                ),
                "active_days": {
                    "value": sales_summary["dias_com_venda"],
                    "display": f"{sales_summary['dias_com_venda']}/{days} dias",
                    "status": "high_confidence",
                },
            },
            "inventory": {
                "total_value": {
                    "value": inventory_summary["valor_total"],
                    "display": f"R$ {inventory_summary['valor_total']:,.0f}",
                    "status": "high_confidence",
                },
                "low_stock_alert": {
                    "value": inventory_summary["baixo_estoque"],
                    "display": f"{inventory_summary['baixo_estoque']} produtos",
                    "status": (
                        "warning" if inventory_summary["baixo_estoque"] > 0 else "ok"
                    ),
                },
                "abc_analysis": abc_analysis,
            },
            "trend": serializer.serialize_trend(trend_analysis),
            "health": serializer.serialize_health_score(health_score),
            "top_products": top_products[:5],
            "customer_metrics": {
                "unique_customers": customer_metrics["clientes_unicos"],
                "avg_ticket_customer": customer_metrics["ticket_medio_cliente"],
                "max_purchase": customer_metrics["maior_compra"],
            },
            "rh": rh_metrics,
            "sfa": {
                "vendedores": sellers_performance
            },
            "charts": {
                "sales_trend": sales_timeseries,
            },
        }

    @cache_response(ttl_seconds=60, require_db_check=False) # Restored with safe TTL
    def get_scientific_dashboard(
        self,
        days: int = 30,
        start_date: datetime = None,
        end_date: datetime = None,
        category_ids: list = None,
        segment: str = None
    ) -> Dict[str, Any]:
        """
        Dashboard científico - Análise avançada com insights.
        Se start_date e end_date forem fornecidos, usa esse período; senão usa os últimos N dias.
        
        AC 3.1: Date range filters update all metrics and charts immediately
        AC 3.2: Product category filters correctly filter sales and inventory data
        AC 3.3: Customer segment filters update customer analytics in real-time
        AC 3.4: Multiple filters can be combined and work together correctly
        AC 3.5: Filter state persists when navigating between dashboard sections
        """
        from app.models import db
        import logging
        _logger = logging.getLogger(__name__)
        try:
            return self._get_scientific_dashboard_logic(days, start_date, end_date, category_ids, segment)
        except Exception as e:
            from app.models import db
            db.session.rollback()
            _logger.error(f"Erro CRÍTICO no dashboard científico: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

    def _get_scientific_dashboard_logic(
        self,
        days: int = 30,
        start_date_override: datetime = None,
        end_date_override: datetime = None,
        category_ids: list = None,
        segment: str = None
    ) -> Dict[str, Any]:
        import logging
        _logger = logging.getLogger(__name__)
        
        from datetime import timedelta
        end_date = end_date_override if end_date_override else datetime.now(timezone.utc)
        if start_date_override and end_date_override:
            start_current = start_date_override
        else:
            # 🔥 CORREÇÃO: Forçar início do dia para capturar despesas/vendas do primeiro dia completo
            start_current = (end_date - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
        
        def _confidence_from_samples(samples: int) -> str:
            """Função auxiliar para calcular confiança baseada em amostras"""
            if samples < 5:
                return "INSUFICIENT"
            if samples < 15:
                return "LOW"
            if samples < 30:
                return "MEDIUM"
            return "HIGH"
        
        from app.models import Cliente
        from app.dashboard_cientifico.models_layer import PracticalModels as _PM
        # Ajustar período anterior também
        start_previous = (start_current - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_previous = (start_current - timedelta(seconds=1))

        import time
        from flask import current_app
        start_exec = time.time()
        
        # Obter a instância da app (para logs ou acesso ao config se necessário)
        app = current_app._get_current_object()
        
        # 🔥 ALTERAÇÃO CRÍTICA OTIMIZADA: Executar todas as queries em paralelo via ThreadPoolExecutor seguro
        _logger.info(f"START: Coleta de dados em paralelo seguro (est_id: {self.establishment_id})")
        tasks = {
            "financials_data": lambda: DataLayer.get_sales_financials(self.establishment_id, start_current, end_date),
            "expense_details": lambda: DataLayer.get_expense_details(self.establishment_id, start_current, end_date),
            "sales_current_summary": lambda: DataLayer.get_sales_summary_range(self.establishment_id, start_current, end_date),
            "sales_previous_summary": lambda: DataLayer.get_sales_summary_range(self.establishment_id, start_previous, end_previous),
            "inventory_summary": lambda: DataLayer.get_inventory_summary(self.establishment_id),
            "sales_by_hour": lambda: DataLayer.get_sales_by_hour(self.establishment_id, days),
            "top_products_by_hour": lambda: DataLayer.get_top_products_by_hour(self.establishment_id, days, top_n=5),
            "customer_temporal_patterns": lambda: DataLayer.get_customer_temporal_patterns(self.establishment_id, days=90),
            "hourly_concentration": lambda: DataLayer.get_hourly_concentration_metrics(self.establishment_id, days),
            "hourly_sales_by_category": lambda: TemporalAnalysis.get_hourly_sales_by_category(self.establishment_id, days),
            "period_analysis": lambda: TemporalAnalysis.get_period_analysis(self.establishment_id, days),
            "weekday_analysis": lambda: TemporalAnalysis.get_weekday_analysis(self.establishment_id, days),
            "rh_metrics": lambda: DataLayer.get_rh_metrics(self.establishment_id, days),
            # Mínimo de 90 dias: a série alimenta forecast/anomalias/correlações,
            # que degradam com janelas curtas (ex.: filtro de 7 dias).
            "sales_timeseries": lambda: DataLayer.get_sales_timeseries(self.establishment_id, max(days, 90)),
            "fiado_metrics": lambda: DataLayer.get_fiado_metrics(self.establishment_id),
            "receivables_metrics": lambda: DataLayer.get_receivables_metrics(self.establishment_id),
            "abc_analysis": lambda: self.get_abc_analysis(days=days, limit=None),
            "expiring_products": lambda: DataLayer.get_expiring_products(self.establishment_id, 30),
            "customer_metrics": lambda: DataLayer.get_customer_metrics(self.establishment_id, days),
            "supplier_performance": lambda: DataLayer.get_supplier_performance(self.establishment_id, days),
            "product_hourly_recommendations": lambda: TemporalAnalysis.get_product_hourly_recommendations(self.establishment_id, days),
            "category_performance_by_time": lambda: TemporalAnalysis.get_category_performance_by_time(self.establishment_id, days),
            "payment_methods_metrics": lambda: DataLayer.get_payment_methods_metrics(self.establishment_id, start_current, end_date),
            "sellers_performance": lambda: DataLayer.get_sellers_performance(self.establishment_id, days),
        }

        try:
            parallel_results = run_in_parallel(tasks, max_workers=3)
        except Exception as parallel_err:
            _logger.critical(f"Falha critica no executor paralelo (re-lançando para evitar cache falso): {parallel_err}")
            raise parallel_err

        # Mapeamento com fallbacks robustos
        financials_data = parallel_results.get("financials_data") or {"revenue": 0.0, "cogs": 0.0, "gross_profit": 0.0}
        expense_details = parallel_results.get("expense_details") or []
        sales_current_summary = parallel_results.get("sales_current_summary") or {"total_vendas": 0, "total_faturado": 0.0, "ticket_medio": 0.0, "dias_com_venda": 0}
        sales_previous_summary = parallel_results.get("sales_previous_summary") or {"total_vendas": 0, "total_faturado": 0.0, "ticket_medio": 0.0, "dias_com_venda": 0}
        inventory_summary = parallel_results.get("inventory_summary") or {"total_produtos": 0, "valor_total": 0.0, "custo_total": 0.0, "baixo_estoque": 0}
        sales_by_hour = parallel_results.get("sales_by_hour") or []
        top_products_by_hour = parallel_results.get("top_products_by_hour") or []
        customer_temporal_patterns = parallel_results.get("customer_temporal_patterns") or []
        hourly_concentration = parallel_results.get("hourly_concentration") or {}
        hourly_sales_by_category = parallel_results.get("hourly_sales_by_category") or {}
        period_analysis = parallel_results.get("period_analysis") or {}
        weekday_analysis = parallel_results.get("weekday_analysis") or {}
        rh_metrics = parallel_results.get("rh_metrics") or {}
        sales_timeseries = parallel_results.get("sales_timeseries") or []
        fiado_metrics = parallel_results.get("fiado_metrics") or {"total_aberto": 0.0, "total_limite": 0.0, "clientes_com_fiado": 0, "percentual_limite_utilizado": 0.0, "maior_devedor_nome": "", "maior_devedor_valor": 0.0, "ticket_medio_fiado": 0.0, "percentual_clientes_com_fiado": 0.0, "top_devedores": []}
        receivables_metrics = parallel_results.get("receivables_metrics") or {"total_vencido": 0.0, "total_a_vencer": 0.0, "total_recebivel": 0.0, "taxa_inadimplencia": 0.0, "titulos_vencidos": 0, "ranking_atraso": []}
        abc_analysis = parallel_results.get("abc_analysis") or {"produtos": [], "resumo": {}, "total_value": 0}
        expiring_products = parallel_results.get("expiring_products") or []
        customer_metrics = parallel_results.get("customer_metrics") or {"ticket_medio": 0, "clientes_unicos": 0, "novos_clientes": 0, "vendas_no_periodo": 0}
        product_hourly_recommendations = parallel_results.get("product_hourly_recommendations") or []
        category_performance_by_time = parallel_results.get("category_performance_by_time") or {}
        payment_methods_metrics = parallel_results.get("payment_methods_metrics") or {"metricas": [], "total_processado": 0.0}
        sellers_performance = parallel_results.get("sellers_performance") or []

        _logger.info(f"DONE: Coleta paralela concluida em {time.time()-start_exec:.2f}s")

        # Dados Financeiros - Cálculo direto dos dados coletados
        revenue = float(financials_data.get("revenue", sales_current_summary.get("total_faturado", 0.0)))
        cogs = float(financials_data.get("cogs", 0.0))
        gross_profit = float(financials_data.get("gross_profit", revenue - cogs))
        
        # Despesas do período
        total_despesas_periodo = sum(float(exp.get("valor", 0.0)) for exp in expense_details) if expense_details else 0.0
        
        # Descontos
        discounts = 0.0
        
        # Lucro Líquido = Lucro Bruto - Despesas - Descontos
        net_profit = gross_profit - total_despesas_periodo - discounts
        
        _logger.info(f"Dashboard Metrics: Revenue={revenue}, COGS={cogs}, GrossProfit={gross_profit}, Expenses={total_despesas_periodo}, NetProfit={net_profit}")
        

        
        # Margens
        gross_margin = (gross_profit / revenue * 100) if revenue > 0 else 0.0
        net_margin = (net_profit / revenue * 100) if revenue > 0 else 0.0
        
        # ROI (Net Profit / Inventory Value)
        avg_inventory_cost = float(inventory_summary.get("valor_total", 0.0))
        roi = (net_profit / avg_inventory_cost * 100) if avg_inventory_cost > 0 else 0.0
        
        financials_consolidated = {
            "revenue": revenue,
            "faturamento": revenue,
            "total_vendas": revenue,
            "cogs": cogs,
            "gross_profit": gross_profit,
            "lucro_bruto": gross_profit,
            "expenses": total_despesas_periodo,
            "total_despesas": total_despesas_periodo,
            "net_profit": net_profit,
            "lucro_liquido": net_profit,
            "gross_margin": gross_margin,
            "net_margin": net_margin,
            "roi": roi,
            "count": int(sales_current_summary.get("total_vendas", 0))
        }


        # Sub-queries que dependem ou são mais pesadas
        try:
            product_hour_matrix = DataLayer.get_product_hour_correlation_matrix(self.establishment_id, days, top_products=10)
        except Exception as e:
            _logger.warning(f"Erro ao obter matriz de correlação: {e}")
            product_hour_matrix = []

        try:
            customer_product_affinity = DataLayer.get_customer_product_affinity(self.establishment_id, days=90, min_support=3)
        except Exception as e:
            _logger.warning(f"Erro ao obter afinidade de clientes: {e}")
            customer_product_affinity = []

        try:
            hourly_customer_behavior = DataLayer.get_hourly_customer_behavior(self.establishment_id, days=60)
        except Exception as e:
            _logger.warning(f"Erro ao obter comportamento de clientes: {e}")
            hourly_customer_behavior = []

        try:
            forecast = PracticalModels.generate_forecast(sales_timeseries, days_ahead=30)
        except Exception as e:
            _logger.warning(f"Erro ao gerar forecast: {e}")
            forecast = PracticalModels._unavailable_forecast(
                "error", "Falha interna ao gerar a previsão; nenhum valor foi estimado."
            )

        # 5. Métricas de Comparação
        # 🔥 CORREÇÃO: Usar a MESMA fonte de dados (get_sales_summary_range) para ambos os períodos
        # Anteriormente, current usava get_sales_financials (JOIN inflado) e previous usava get_sales_summary_range
        # Isso causava comparações assimétricas e crescimento incorreto
        current_faturado = float(sales_current_summary.get("total_faturado", 0))
        previous_faturado = float(sales_previous_summary.get("total_faturado", 0))
        
        sales_current_metric = {
            "value": current_faturado,
            "confidence": _confidence_from_samples(
                sales_current_summary.get("total_vendas", 0)
            ),
            "sample_size": sales_current_summary.get("total_vendas", 0),
            "warnings": [],
        }
        sales_previous_metric = {
            "value": previous_faturado,
            "confidence": _confidence_from_samples(
                sales_previous_summary.get("total_vendas", 0)
            ),
            "sample_size": sales_previous_summary.get("total_vendas", 0),
            "warnings": [],
        }

        try:
            growth_period = StatsValidator.calculate_growth(
                current_value=sales_current_metric.get("value", 0),
                previous_value=sales_previous_metric.get("value", 0),
                current_samples=sales_current_metric.get("sample_size", 0),
                previous_samples=sales_previous_metric.get("sample_size", 0),
            )
        except Exception:
            growth_period = {"value": 0.0, "display": "0%", "status": "no_data", "is_positive": False, "icon": "minus"}


        growth_homologo_week = None
        if days >= 14:
            start_week_current = end_date - timedelta(days=7)
            start_week_previous = end_date - timedelta(days=14)
            end_week_previous = end_date - timedelta(days=7)
            week_current = DataLayer.get_sales_summary_range(
                self.establishment_id, start_week_current, end_date
            )
            week_previous = DataLayer.get_sales_summary_range(
                self.establishment_id, start_week_previous, end_week_previous
            )
            growth_homologo_week = StatsValidator.calculate_growth(
                current_value=week_current.get("total_faturado", 0),
                previous_value=week_previous.get("total_faturado", 0),
                current_samples=week_current.get("total_vendas", 0),
                previous_samples=week_previous.get("total_vendas", 0),
            )

        try:
            sales_trend = _PM.detect_sales_trend(sales_timeseries)
        except Exception as e:
            _logger.warning(f"Erro ao detectar tendência de vendas: {e}")
            sales_trend = {"direction": "neutral", "slope": 0, "is_statistically_significant": False}
        
        # 🔥 NOVO: Calcular correlações estatísticas (Blindado contra TypeError/ValueError)
        correlations = []
        correlations_reasons = []
        try:
            correlations, correlations_reasons = _PM.calculate_correlations_detailed(
                sales_timeseries, expense_details, establishment_id=self.establishment_id
            )
        except Exception as e:
            _logger.warning(f"Erro ao calcular correlações: {e}")
            correlations_reasons = ["Falha interna ao calcular correlações; nenhum valor foi estimado."]
        
        # 🔥 NOVO: Detectar anomalias (Blindado)
        anomalies = []
        try:
            if sales_timeseries:
                anomalies = _PM.detect_anomalies(sales_timeseries, expense_details)
        except Exception as e:
            _logger.warning(f"Erro ao detectar anomalias: {e}")
            _logger.warning(f"Erro ao detectar anomalias: {e}")
            anomalies = []

        # abc_analysis já foi calculado acima
        rfm_analysis = self.get_rfm_analysis(window_days=180)
        
        # 🔥 NOVO: Produtos Estrela (Top 10 da Classe A com melhor margem)
        produtos_estrela = []
        if abc_analysis and abc_analysis.get("produtos"):
            produtos_classe_a = [p for p in abc_analysis["produtos"] if p.get("classificacao") == "A"]
            # Ordenar por margem e pegar top 10
            produtos_classe_a_sorted = sorted(
                produtos_classe_a,
                key=lambda x: x.get("margem", 0),
                reverse=True
            )[:10]
            
            for p in produtos_classe_a_sorted:
                produtos_estrela.append({
                    "id": p.get("id", 0),
                    "nome": p.get("nome", ""),
                    "classificacao": "A",
                    "margem": p.get("margem", 0),
                    "market_share": p.get("percentual_acumulado", 0),
                    "total_vendido": p.get("quantidade_vendida", 0),
                    "custo_unitario": p.get("preco_custo", 0),
                    "preco_venda": p.get("preco_venda", 0) if "preco_venda" in p else 0,
                    "lucro_total": p.get("faturamento", 0) * (p.get("margem", 0) / 100),
                    "roi": (p.get("margem", 0) / 100) if p.get("preco_custo", 0) > 0 else 0,
                    "elasticidade": 0,
                    "faturamento": p.get("faturamento", 0),
                    "quantidade_vendida": p.get("quantidade_vendida", 0)
                })
        
        # 🔥 NOVO: Produtos Lentos (Classe C ou produtos com menor desempenho)
        produtos_lentos = []
        if abc_analysis and abc_analysis.get("produtos"):
            from app.models import Produto
            
            # Tentar pegar Classe C primeiro
            produtos_classe_c = [p for p in abc_analysis["produtos"] if p.get("classificacao") == "C"]
            
            # Se não tiver Classe C, pegar os 10 piores da Classe B
            if not produtos_classe_c:
                produtos_classe_b = [p for p in abc_analysis["produtos"] if p.get("classificacao") == "B"]
                produtos_lentos_candidatos = sorted(
                    produtos_classe_b,
                    key=lambda x: x.get("quantidade_vendida", 0)
                )[:10]
            else:
                # Pegar os 10 piores da classe C
                produtos_lentos_candidatos = sorted(
                    produtos_classe_c,
                    key=lambda x: x.get("quantidade_vendida", 0)
                )[:10]
            
            produto_ids_lentos = [p.get("id") for p in produtos_lentos_candidatos if p.get("id")]
            
            # 🔥 CORREÇÃO: Buscar produtos do banco com todos os dados necessários
            query_db_lentos = Produto.query.filter(Produto.id.in_(produto_ids_lentos))
            if str(self.establishment_id).lower() != 'all':
                query_db_lentos = query_db_lentos.filter(Produto.estabelecimento_id == self.establishment_id)
            produtos_db_lentos = query_db_lentos.all()
            
            # Criar mapa com estoque E preço de custo do banco (dados reais)
            produtos_db_map = {
                p.id: {
                    'estoque': p.quantidade,
                    'preco_custo': float(p.preco_custo) if p.preco_custo else 0.0
                } 
                for p in produtos_db_lentos
            }
            
            for p in produtos_lentos_candidatos:
                produto_id = p.get("id", 0)
                qtd_vendida = float(p.get("quantidade_vendida", 0) or 0)
                
                # 🔥 CORREÇÃO: Pegar estoque e preço de custo REAIS do banco
                produto_db_data = produtos_db_map.get(produto_id, {'estoque': 0, 'preco_custo': 0})
                estoque_atual = float(produto_db_data['estoque'] or 0)
                preco_custo = float(produto_db_data['preco_custo'] or 0)
                
                # Se preco_custo do banco for 0, tentar pegar do ABC
                if preco_custo == 0:
                    preco_custo = float(p.get("preco_custo", 0) or 0)
                
                # Calcular giro de estoque (vendas / estoque médio)
                # Para produtos lentos, o giro será baixo
                giro_estoque = (qtd_vendida / estoque_atual) if estoque_atual > 0 else 0
                
                demanda_diaria = qtd_vendida / days if days > 0 else 0

                # Calcular dias de estoque parado
                # Se estoque <= 0, dias de estoque é 0 (esgotado, não encalhado)
                if estoque_atual <= 0:
                    dias_estoque = 0
                elif demanda_diaria > 0:
                    dias_estoque = estoque_atual / demanda_diaria
                else:
                    dias_estoque = 999 # Infinito (tem estoque mas não tem saída)
                
                # 🔥 CORREÇÃO: Custo do capital parado = preço de custo × estoque atual
                custo_parado = preco_custo * estoque_atual
                
                # 🔥 CORREÇÃO: Perda mensal = 1% do capital parado (custo de oportunidade)
                perda_mensal = custo_parado * 0.01
                
                produtos_lentos.append({
                    "id": produto_id,
                    "nome": p.get("nome", ""),
                    "quantidade": qtd_vendida,
                    "total_vendido": p.get("faturamento", 0),
                    "dias_estoque": round(dias_estoque, 0) if dias_estoque < 999 else 999,
                    "giro_estoque": round(giro_estoque, 2),
                    "custo_parado": round(custo_parado, 2),
                    "perda_mensal": round(perda_mensal, 2),
                    "estoque_atual": estoque_atual,
                    "margem": p.get("margem", 0),
                    "classificacao": p.get("classificacao", "B")
                })
        
        # 🔥 NOVO: Previsão de Demanda (Top 20 produtos com previsão)
        previsao_demanda = []
        if abc_analysis and abc_analysis.get("produtos"):
            from app.models import Produto
            
            top_20_produtos = abc_analysis["produtos"][:20]
            produto_ids = [p.get("id") for p in top_20_produtos if p.get("id")]
            
            # Buscar estoque real dos produtos
            query_db = Produto.query.filter(Produto.id.in_(produto_ids))
            if str(self.establishment_id).lower() != 'all':
                query_db = query_db.filter(Produto.estabelecimento_id == self.establishment_id)
            produtos_db = query_db.all()
            
            estoque_map = {p.id: p.quantidade for p in produtos_db}
            
            for p in top_20_produtos:
                produto_id = p.get("id", 0)
                qtd_vendida = float(p.get("quantidade_vendida", 0) or 0)
                demanda_diaria = qtd_vendida / days if days > 0 else 0
                estoque_atual = float(estoque_map.get(produto_id, 0) or 0)
                
                # Calcular giro de estoque
                giro_estoque = (qtd_vendida / estoque_atual) if estoque_atual > 0 else 0
                
                previsao_demanda.append({
                    "id": produto_id,
                    "produto_nome": p.get("nome", ""),
                    "nome": p.get("nome", ""),
                    "estoque_atual": estoque_atual,
                    "demanda_diaria_prevista": round(demanda_diaria, 2),
                    "risco_ruptura": (estoque_atual / demanda_diaria < 7) if demanda_diaria > 0 else False,
                    "margem_lucro": p.get("margem", 0),
                    "custo_estoque": p.get("preco_custo", 0) * estoque_atual,
                    "giro_estoque": round(giro_estoque, 2),
                    "classificação_abc": p.get("classificacao", "C"),
                    "variavel": p.get("nome", ""),
                    "valor_atual": p.get("faturamento", 0),
                    # Sem modelo de previsão por produto: não inventamos valor,
                    # confiança nem intervalo. `demanda_diaria_prevista` acima é a
                    # média diária OBSERVADA no período.
                    "previsao_30d": None,
                    "confianca": None,
                    "intervalo_confianca": None,
                    "metodo": "media_historica_observada"
                })

        risco_ids = [
            c["cliente_id"]
            for c in rfm_analysis.get("customers", [])
            if c.get("segment") in {"Risco", "Perdido"}
        ][:50]
        clientes_risco = []
        if risco_ids:
            query_risco = Cliente.query.filter(Cliente.id.in_(risco_ids))
            if str(self.establishment_id).lower() != 'all':
                query_risco = query_risco.filter(Cliente.estabelecimento_id == self.establishment_id)
            rows = query_risco.all()
            by_id = {int(c.id): c for c in rows}
            for cid in risco_ids:
                cli = by_id.get(int(cid))
                if not cli:
                    continue
                clientes_risco.append(
                    {"id": int(cli.id), "nome": cli.nome, "celular": cli.celular}
                )

        segments = rfm_analysis.get("segments", {}) or {}
        count_risco = int(segments.get("Risco", 0) or 0) + int(
            segments.get("Perdido", 0) or 0
        )

        # ============================================================
        # 🧠 MOTOR DE INTELIGÊNCIA DE NEGÓCIO (BI ENGINE)
        # 8 cenários profissionais com impacto financeiro quantificado,
        # linguagem contextual e CTAs acionáveis.
        # Prioridade: 1=crítico, 2=urgente, 3=oportunidade
        # ============================================================
        recomendacoes = []

        _ticket_medio = float(sales_current_summary.get("ticket_medio", 0))
        _fiado_total = float(fiado_metrics.get("total_aberto", 0))
        _fiado_clientes = int(fiado_metrics.get("clientes_com_fiado", 0))
        _fiado_perc_fat = (_fiado_total / revenue * 100) if revenue > 0 else 0.0
        _baixo_estoque = int(inventory_summary.get("baixo_estoque", 0) or 0)
        _margem_a = float(abc_analysis.get("resumo", {}).get("A", {}).get("margem_media", 0) or 0)
        _margem_b = float(abc_analysis.get("resumo", {}).get("B", {}).get("margem_media", 0) or 0)
        # growth_period usa chave 'value' (de StatsValidator.calculate_growth)
        _growth_val = float(growth_period.get("value", 0) or 0)
        # previous_faturado já foi calculado acima na seção de comparação (linha ~377)

        # --- CENÁRIO 1: PREJUÍZO OPERACIONAL ---------------------------
        if net_profit < 0:
            causa = ""
            if total_despesas_periodo > gross_profit:
                causa = (f"Suas despesas (R$ {total_despesas_periodo:,.2f}) "
                         f"consumiram {(total_despesas_periodo/gross_profit*100 if gross_profit > 0 else 0):.0f}% "
                         f"do Lucro Bruto (R$ {gross_profit:,.2f}).")
            elif gross_margin < 20:
                causa = (f"A Margem Bruta de {gross_margin:.1f}% está muito baixa "
                         f"— você está vendendo quase a preço de custo.")
            else:
                causa = f"A estrutura de custos superou o faturamento em R$ {abs(net_profit):,.2f}."
            recomendacoes.append({
                "tipo": "financeiro_critico",
                "prioridade": 1,
                "mensagem": (
                    f"🚨 PREJUÍZO DE R$ {abs(net_profit):,.2f} no período. {causa} "
                    f"Corte pelo menos R$ {abs(net_profit):,.2f} em custos para zerar o prejuízo."
                ),
                "impacto_estimado": round(abs(net_profit), 2),
                "cta": "Auditar Despesas",
                "alvo": "despesas",
                "icone": "🚨"
            })

        # --- CENÁRIO 2: MARGEM LÍQUIDA EM ZONA DE RISCO ----------------
        elif 0 < net_margin < 5:
            recomendacoes.append({
                "tipo": "eficiencia",
                "prioridade": 2,
                "mensagem": (
                    f"⚠️ MARGEM LÍQUIDA FRÁGIL: {net_margin:.1f}% — qualquer imprevisto coloca o negócio no vermelho. "
                    f"Com faturamento de R$ {revenue:,.2f}, você tem apenas R$ {net_profit:,.2f} de colchão. "
                    f"Meta recomendada para varejo: margem líquida ≥ 8%."
                ),
                "impacto_estimado": round((0.08 - net_margin / 100) * revenue, 2),
                "cta": "Ver Análise de Margens",
                "alvo": "analise-financeira",
                "icone": "⚠️"
            })

        # --- CENÁRIO 3: MARKUP ABAIXO DO PADRÃO VAREJO ----------------
        if gross_margin < 25 and revenue > 0 and net_profit >= 0:
            # Projetar aumento real considerando ganho marginal de 5 pontos
            # Impacto não deve exceder 15% do faturamento total para ser realista
            impacto_markup = min(revenue * 0.05, revenue * 0.15)
            recomendacoes.append({
                "tipo": "precificacao",
                "prioridade": 1 if gross_margin < 15 else 2,
                "mensagem": (
                    f"💰 MARKUP ABAIXO DO MERCADO: Margem Bruta {gross_margin:.1f}% "
                    f"(referência saudável: 25-35% para supermercado). "
                    f"Aumentar o markup médio em 5 p.p. geraria "
                    f"+R$ {revenue * 0.05:,.2f} adicionais por período."
                ),
                "impacto_estimado": round(impacto_markup, 2),
                "cta": "Revisar Precificação",
                "alvo": "produtos",
                "icone": "💰"
            })

        # --- CENÁRIO 4: CLIENTES EM RISCO DE CHURN (RFM) ---------------
        if count_risco > 0:
            # Impacto estimado: recuperacao de 30% do faturado medio desses clientes
            # Capamos a receita_risco para nao gerar valores astronomicos em dados de teste
            base_calculo = min(revenue * 0.3, _ticket_medio * count_risco)
            impacto_retencao = base_calculo * 0.5 # Projetamos recuperar 50% do risco plausivel
            
            recomendacoes.append({
                "tipo": "retencao",
                "prioridade": 2,
                "mensagem": (
                    f"👥 {count_risco} CLIENTES EM RISCO DE ABANDONO identificados pelo modelo RFM. "
                    f"Ticket médio deles: R$ {_ticket_medio:,.2f}. "
                    f"Recuperar metade deste grupo geraria ~R$ {impacto_retencao:,.2f} adicionais. "
                    f"Consulte a lista de nomes nos detalhes para ação direta."
                ),
                "impacto_estimado": round(impacto_retencao, 2),
                "cta": "Ver Clientes em Risco",
                "alvo": "clientes",
                "segmentos": ["Risco", "Perdido"],
                "clientes": clientes_risco[:20], # Limitar a 20 para o modal
                "icone": "👥"
            })

        # --- CENÁRIO 5: EXPOSIÇÃO DE FIADO / CRÉDITO --------------------
        if _fiado_total > 0:
            if _fiado_perc_fat >= 10:
                recomendacoes.append({
                    "tipo": "fiado_critico",
                    "prioridade": 1,
                    "mensagem": (
                        f"🤝 ALERTA DE CRÉDITO: R$ {_fiado_total:,.2f} de fiado em aberto "
                        f"({_fiado_perc_fat:.1f}% do seu faturamento) com {_fiado_clientes} clientes. "
                        f"Maior devedor: {fiado_metrics.get('maior_devedor_nome', 'N/A')} "
                        f"(R$ {fiado_metrics.get('maior_devedor_valor', 0):,.2f}). "
                        f"Fiado excessivo compromete o fluxo de caixa."
                    ),
                    "impacto_estimado": round(_fiado_total, 2),
                    "cta": "Ver Clientes com Fiado",
                    "alvo": "clientes",
                    "top_devedores": fiado_metrics.get("top_devedores", []),
                    "icone": "🤝"
                })
            else:
                recomendacoes.append({
                    "tipo": "fiado_atencao",
                    "prioridade": 3,
                    "mensagem": (
                        f"🤝 Carteira de fiado: R$ {_fiado_total:,.2f} em aberto "
                        f"({_fiado_perc_fat:.1f}% do faturamento) com {_fiado_clientes} clientes. "
                        f"Monitore para evitar crescimento da inadimplência."
                    ),
                    "impacto_estimado": round(_fiado_total, 2),
                    "cta": "Gestão de Fiado",
                    "alvo": "clientes",
                    "top_devedores": fiado_metrics.get("top_devedores", []),
                    "icone": "🤝"
                })

        # --- CENÁRIO 6: ESTOQUE BAIXO -----------------------------------
        if _baixo_estoque > 0:
            perda_potencial = _ticket_medio * _baixo_estoque * 0.3
            recomendacoes.append({
                "tipo": "estoque",
                "prioridade": 2 if _baixo_estoque > 5 else 3,
                "mensagem": (
                    f"📦 {_baixo_estoque} produto{'s' if _baixo_estoque > 1 else ''} abaixo do estoque mínimo. "
                    f"Ruptura em itens Classe A pode gerar perda estimada de "
                    f"R$ {perda_potencial:,.2f} em vendas. Priorize a reposição imediata."
                ),
                "impacto_estimado": round(perda_potencial, 2),
                "cta": "Ver Estoque Baixo",
                "alvo": "produtos",
                "icone": "📦"
            })

        # --- CENÁRIO 7: QUEDA NO FATURAMENTO ---------------------------
        if _growth_val < -10:
            delta_receita = abs(_growth_val / 100 * previous_faturado)
            recomendacoes.append({
                "tipo": "vendas_queda",
                "prioridade": 2,
                "mensagem": (
                    f"📉 QUEDA DE {abs(_growth_val):.1f}% NO FATURAMENTO vs período anterior. "
                    f"Isso representa R$ {delta_receita:,.2f} a menos em receita. "
                    f"Verifique produtos Classe A em falta, promoções da concorrência ou sazonalidade."
                ),
                "impacto_estimado": round(delta_receita, 2),
                "cta": "Analisar Tendência",
                "alvo": "dashboard",
                "icone": "📉"
            })

        # --- CENÁRIO 8: CLASSE B MAIS RENTÁVEL QUE A -------------------
        if _margem_b > _margem_a + 5 and _margem_a > 0:
            recomendacoes.append({
                "tipo": "margem_oportunidade",
                "prioridade": 3,
                "mensagem": (
                    f"💡 OPORTUNIDADE DE MARGEM: Produtos Classe B rendem {_margem_b:.1f}% "
                    f"de margem vs {_margem_a:.1f}% da Classe A. "
                    f"Aumentar o mix de B pode melhorar a rentabilidade "
                    f"sem depender de maior volume de vendas."
                ),
                "impacto_estimado": round(revenue * (_margem_b - _margem_a) / 100 * 0.1, 2),
                "cta": "Ver Análise ABC",
                "alvo": "analise-detalhada",
                "icone": "💡"
            })

        # --- CENÁRIO 9: PRODUTOS PRÓXIMOS AO VENCIMENTO -----------------
        if expiring_products:
            total_expiring = len(expiring_products)
            loss_estimate = sum(p.get("valor_risco_custo", 0) for p in expiring_products)
            recomendacoes.append({
                "tipo": "vencimento_critico",
                "prioridade": 1,
                "mensagem": (
                    f"⚠️ ALERTA DE VALIDADE: {total_expiring} produto(s) vencerão nos próximos 30 dias. "
                    f"Risco de perda financeira (estoque encalhado): R$ {loss_estimate:,.2f}. "
                    f"Recomendação: Crie promoções atrativas imediatamente para liquidar esses lotes."
                ),
                "impacto_estimado": round(loss_estimate, 2),
                "cta": "Promover Produtos",
                "alvo": "produtos",
                "icone": "⏳"
            })

        # ============================================================
        # 🔬 INSIGHTS OPERACIONAIS SENSÍVEIS (produto + equipe)
        # Sinais concretos que um lojista LEIGO precisa ver para agir a
        # tempo — cada um em linguagem simples e com ação clara.
        # ============================================================
        try:
            prod_perf = DataLayer.get_all_products_performance(self.establishment_id, days)
        except Exception:
            prod_perf = []

        dias_periodo = max(1, int(days))

        # --- RUPTURA IMINENTE: itens que giram e vão acabar em < 7 dias -----
        ruptura = []
        for p in prod_perf:
            vend = float(p.get("quantidade_vendida", 0) or 0)
            est = float(p.get("estoque_atual", 0) or 0)
            if vend <= 0:
                continue
            media_dia = vend / dias_periodo
            if media_dia <= 0:
                continue
            cobertura = est / media_dia
            if cobertura < 7:
                ruptura.append({
                    "nome": p.get("nome"), "cobertura": cobertura,
                    "perda_dia": media_dia * float(p.get("preco_venda", 0) or 0),
                })
        if ruptura:
            ruptura.sort(key=lambda x: x["cobertura"])
            criticos = ruptura[:5]
            nomes = ", ".join(f"{r['nome']} (~{r['cobertura']:.0f} dias)" for r in criticos)
            perda_semana = sum(r["perda_dia"] for r in criticos) * 7
            recomendacoes.append({
                "tipo": "ruptura",
                "prioridade": 1,
                "mensagem": (
                    f"📦 RISCO DE RUPTURA: {len(ruptura)} produto(s) devem acabar em menos de 7 dias "
                    f"no ritmo de venda atual. Os mais urgentes: {nomes}. "
                    f"Faça o pedido ao fornecedor agora — cada dia sem esses itens deixa de faturar "
                    f"cerca de R$ {sum(r['perda_dia'] for r in criticos):,.2f}."
                ),
                "impacto_estimado": round(perda_semana, 2),
                "cta": "Fazer Pedido",
                "alvo": "produtos",
                "icone": "📦"
            })

        # --- ENCALHE: capital parado, produto sem giro -> promover ----------
        encalhe = [
            p for p in prod_perf
            if float(p.get("quantidade_vendida", 0) or 0) == 0
            and float(p.get("estoque_atual", 0) or 0) > 0
        ]
        if encalhe:
            capital_parado = sum(
                float(p.get("estoque_atual", 0) or 0) * float(p.get("preco_custo", 0) or 0)
                for p in encalhe
            )
            nomes = ", ".join(p.get("nome") for p in encalhe[:5])
            recomendacoes.append({
                "tipo": "estoque",
                "prioridade": 2,
                "mensagem": (
                    f"🐌 PRODUTOS PARADOS: {len(encalhe)} item(ns) não venderam nada no período e "
                    f"têm R$ {capital_parado:,.2f} do seu dinheiro parado na prateleira. "
                    f"Exemplos: {nomes}. Crie uma promoção ou combo para transformar esse estoque em caixa."
                ),
                "impacto_estimado": round(capital_parado, 2),
                "cta": "Criar Promoção",
                "alvo": "produtos",
                "icone": "🐌"
            })

        # --- ASSIDUIDADE / DESMOTIVAÇÃO DA EQUIPE --------------------------
        alertas_rh = []
        for f in (rh_metrics.get("faltas_por_funcionario_mes") or []):
            fal = int(f.get("faltas", 0) or 0)
            if fal >= 2:
                alertas_rh.append(f"{f.get('nome')} tem {fal} falta(s) não justificada(s) este mês")
        for a in (rh_metrics.get("atrasos_por_funcionario_mes") or []):
            qtd = int(a.get("atrasos_qtd", 0) or 0)
            if qtd >= 3:
                alertas_rh.append(f"{a.get('nome')} atrasou {qtd}x ({int(a.get('minutos_atraso', 0) or 0)} min acumulados)")
        if alertas_rh:
            recomendacoes.append({
                "tipo": "equipe",
                "prioridade": 2,
                "mensagem": (
                    f"👥 ATENÇÃO À EQUIPE: {'; '.join(alertas_rh[:4])}. "
                    f"Faltas e atrasos frequentes costumam sinalizar desmotivação e afetam o atendimento. "
                    f"Converse com a pessoa antes que vire um problema maior."
                ),
                "impacto_estimado": 0.0,
                "cta": "Ver Ponto da Equipe",
                "alvo": "rh",
                "icone": "👥"
            })

        # Ordenar: críticos primeiro
        recomendacoes.sort(key=lambda x: x.get("prioridade", 99))


        # 🔥 NOTA: total_despesas_periodo já foi calculado via DataLayer.get_total_expenses_value acima.
        # NÃO recalcular aqui para evitar divergência com o DRE (a soma dos detalhes pode diferir).

        # 🔥 NOVO: "LINK EACH PRODUCT TO AN ORDER"
        # Coletar todos os IDs de produtos em destaque para buscar última compra de forma eficiente (1 única query)
        todos_mais_vendidos_ids = set()
        for p in produtos_estrela: 
            if p.get('id'): todos_mais_vendidos_ids.add(p['id'])
        for p in produtos_lentos: 
            if p.get('id'): todos_mais_vendidos_ids.add(p['id'])
        for p in previsao_demanda: 
            if p.get('id'): todos_mais_vendidos_ids.add(p['id'])
        
        last_orders = DataLayer.get_last_purchase_orders(self.establishment_id, list(todos_mais_vendidos_ids))
        
        # Injetar dados de última compra nos produtos para o dashboard
        for p in produtos_estrela:
            pid = p.get("id")
            p["ultima_compra"] = last_orders.get(pid) if pid else None
        for p in produtos_lentos:
            pid = p.get("id")
            p["ultima_compra"] = last_orders.get(pid) if pid else None
        for p in previsao_demanda:
            pid = p.get("id")
            p["ultima_compra"] = last_orders.get(pid) if pid else None
        
        # 10. Construir Previsões Financeiras para o painel avançado
        # Só existe previsão financeira quando há previsão real de faturamento.
        # Despesas e lucro projetados (antes: fatores fixos 1,02 e 1,05) foram
        # removidos: não há modelo para eles. O intervalo diário não é somado
        # em um intervalo mensal (não seria válido), então fica indisponível.
        forecast_available = bool(isinstance(forecast, dict) and forecast.get("available") and forecast.get("forecast"))
        previsoes_financeiras = []
        if forecast_available:
            previsoes_financeiras.append({
                "variavel": "Faturamento Estimado",
                "valor_atual": revenue,
                "previsao_30d": round(sum(f.get("valor_previsto", 0) for f in forecast["forecast"]), 2),
                "confianca": None,
                "nivel_confianca": forecast.get("confidence"),
                "intervalo_confianca": None,
                "metodo": forecast.get("method"),
                "observacoes": forecast.get("observations"),
            })
        forecast_status = {
            "available": forecast_available,
            "reason": None if forecast_available else (forecast.get("reason") if isinstance(forecast, dict) else "Previsão indisponível."),
            "method": forecast.get("method") if isinstance(forecast, dict) else None,
            "observations": forecast.get("observations") if isinstance(forecast, dict) else 0,
        }
        analytics_availability = {
            "forecast": forecast_status,
            "previsoes": forecast_status,
            "correlations": {
                "available": bool(correlations),
                "reasons": [] if correlations else list(correlations_reasons or ["Sem observações válidas para correlação."]),
            },
        }
        
        # 11. Montar objeto final
        res = {
            "success": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "period_days": int(days),
            "summary": {
                "sales_current": DashboardSerializer.serialize_metric(sales_current_metric),
                "sales_previous": DashboardSerializer.serialize_metric(sales_previous_metric),
                "growth_period": DashboardSerializer.serialize_growth(growth_period),
                "growth": DashboardSerializer.serialize_growth(growth_period),  # 🔥 ALIAS para compatibilidade frontend
                "growth_homologo_week": (
                    DashboardSerializer.serialize_growth(growth_homologo_week)
                    if growth_homologo_week
                    else {"value": None, "display": "--", "status": "no_data", "is_positive": False, "icon": "minus"}
                ),
                "revenue": {"value": revenue, "display": f"R$ {revenue:,.2f}"},
                "faturamento": {"value": revenue, "display": f"R$ {revenue:,.2f}"},
                "total_vendas": {"value": revenue, "display": f"R$ {revenue:,.2f}"},
                "expenses": {"value": total_despesas_periodo, "display": f"R$ {total_despesas_periodo:,.2f}"},
                "total_despesas": {"value": total_despesas_periodo, "display": f"R$ {total_despesas_periodo:,.2f}"},
                "gross_profit": {"value": gross_profit, "display": f"R$ {gross_profit:,.2f}"},
                "lucro_bruto": {"value": gross_profit, "display": f"R$ {gross_profit:,.2f}"},
                "net_profit": {"value": net_profit, "display": f"R$ {net_profit:,.2f}"},
                "lucro_liquido": {"value": net_profit, "display": f"R$ {net_profit:,.2f}"},
                "inventory_value": inventory_summary.get("valor_total", 0),
                "low_stock_count": inventory_summary.get("baixo_estoque", 0),
                "unique_customers": customer_metrics.get("clientes_unicos", 0),
                "avg_ticket": {
                    "value": sales_current_summary.get("ticket_medio", 0),
                    "display": f"R$ {sales_current_summary.get('ticket_medio', 0):,.2f}",
                    "status": "high_confidence",
                },
                "fiado_aberto": fiado_metrics.get("total_aberto", 0.0), # SSD: Real exposure
                "fiado_vencido": receivables_metrics.get("total_vencido", 0.0), # SSD: Real overdue
            },
            "financials": financials_consolidated,
            "timeseries": sales_timeseries,
            "gini_index": hourly_concentration.get("gini_index", 0.0),
            "forecast": forecast,
            "expenses": expense_details,
            "total_despesas": total_despesas_periodo,
            "sales_by_hour": sales_by_hour,
            "top_products_by_hour": top_products_by_hour,
            "customer_temporal_patterns": customer_temporal_patterns,
            "hourly_concentration": hourly_concentration,
            "product_hour_matrix": product_hour_matrix,
            "customer_product_affinity": customer_product_affinity,
            "hourly_customer_behavior": hourly_customer_behavior,
            "hourly_sales_by_category": hourly_sales_by_category,
            "fornecedores_performance": parallel_results.get("supplier_performance", []),
            "fiado": fiado_metrics,
            "period_analysis": period_analysis,
            "weekday_analysis": weekday_analysis,
            "product_hourly_recommendations": product_hourly_recommendations,
            "category_performance_by_time": category_performance_by_time,
            "abc": abc_analysis,
            "rfm": {"segments": segments, "window_days": rfm_analysis.get("window_days", 180),
                    "recencia_media": rfm_analysis.get("customers", []) and round(
                        sum(c.get("recency_days", 0) for c in rfm_analysis.get("customers", [])) / len(rfm_analysis.get("customers", [])), 1
                    ) or 0,
                    "frequencia_media": rfm_analysis.get("customers", []) and round(
                        sum(c.get("frequency", 0) for c in rfm_analysis.get("customers", [])) / len(rfm_analysis.get("customers", [])), 1
                    ) or 0,
                    "valor_medio_compra": rfm_analysis.get("customers", []) and round(
                        sum(c.get("monetary", 0) for c in rfm_analysis.get("customers", [])) / len(rfm_analysis.get("customers", [])), 2
                    ) or 0,
            },
            "recomendacoes": recomendacoes,
            "correlations": correlations,
            "anomalies": anomalies,
            "previsoes": previsoes_financeiras,
            "analytics_availability": analytics_availability,
            "analise_produtos": {
                "produtos_estrela": produtos_estrela,
                "produtos_lentos": produtos_lentos,
                "previsao_demanda": previsao_demanda,
            },
            "rh": rh_metrics,
            "sfa": {
                "vendedores": sellers_performance
            },
            "inventory": inventory_summary,
            "trend": sales_trend,
            # 🔥 NOVO: Formas de Pagamento com porcentagem (Multi-Payment Engine)
            "payment_methods": payment_methods_metrics,
            # 🔥 FIADO: Dados completos de carteira de crédito
            "fiado": {
                "total_aberto": fiado_metrics.get("total_aberto", 0.0),
                "total_limite": fiado_metrics.get("total_limite", 0.0),
                "clientes_com_fiado": fiado_metrics.get("clientes_com_fiado", 0),
                "percentual_limite_utilizado": fiado_metrics.get("percentual_limite_utilizado", 0.0),
                "percentual_do_faturamento": round(_fiado_perc_fat, 1),
                "ticket_medio_fiado": fiado_metrics.get("ticket_medio_fiado", 0.0),
                "percentual_clientes_com_fiado": fiado_metrics.get("percentual_clientes_com_fiado", 0.0),
                "maior_devedor_id": fiado_metrics.get("maior_devedor_id"),
                "maior_devedor_nome": fiado_metrics.get("maior_devedor_nome", ""),
                "maior_devedor_celular": fiado_metrics.get("maior_devedor_celular", ""),
                "maior_devedor_valor": fiado_metrics.get("maior_devedor_valor", 0.0),
                "top_devedores": fiado_metrics.get("top_devedores", []),
                "tendencias": fiado_metrics.get("tendencias", {"novos_fiados_30d": 0.0, "pagamentos_fiado_30d": 0.0, "taxa_recuperacao_percentual": 0.0, "status": "alerta"}),
                "top_produtos": fiado_metrics.get("top_produtos", []),
                "bons_pagadores": fiado_metrics.get("bons_pagadores", []),
            },
            "receivables": receivables_metrics, # NEW: Dados detalhados para a nova aba financeira
            "_performance": {
                "total_time": time.time() - start_exec
            }
        }
        return res

    # 🔥 CACHE DESATIVADO PARA DEBUG (era 900s)
    @cache_response(ttl_seconds=1, require_db_check=False)
    def get_abc_analysis(self, days: int = 30, limit: int = 500) -> Dict[str, Any]:
        from app.models import db
        import logging
        _logger = logging.getLogger(__name__)
        try:
            # 🔥 CORREÇÃO: Usar get_all_products_performance para incluir TUDO (mesmo sem vendas)
            all_products_perf = DataLayer.get_all_products_performance(self.establishment_id, days)
            _logger.info(f"ABC Analysis: Processing {len(all_products_perf)} active products (Target: ~203)")
            
            return PracticalModels.analyze_inventory_abc(
                all_products_perf,
                top_n=None,  # Retornar TODOS os produtos, não limitar
                return_all_products=True,  # Forçar retorno de todos
            )
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro na análise ABC: {e}")
            return {"produtos": [], "resumo": {}, "total_value": 0}

    @cache_response(ttl_seconds=900, require_db_check=True)
    def get_rfm_analysis(self, window_days: int = 180) -> Dict[str, Any]:
        from app.models import Cliente, db
        try:
            return Cliente.calcular_rfm(self.establishment_id, days=int(window_days))
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro na análise RFM: {e}")
            return {"customers": [], "segments": {}}
