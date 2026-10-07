from datetime import timezone
"""
Models Layer - Algoritmos científicos práticos
Foco: Utilidade imediata sem complexidade excessiva
"""

from typing import List, Dict, Any, Optional
import statistics
from collections import defaultdict
import logging
import numpy as np
from sqlalchemy import func
from app.models import Venda, VendaItem, Produto
from app.utils.query_helpers import _get_db

logger = logging.getLogger(__name__)


class PracticalModels:
    """Modelos científicos práticos para negócio"""

    @staticmethod
    def detect_sales_trend(
        daily_sales: List[Dict[str, Any]],
        smoothing_window: Optional[int] = None,
        trim_ratio: float = 0.1,
        outlier_z: float = 6.0,
    ) -> Dict[str, Any]:
        """
        Detecta tendência de vendas de forma prática
        """
        def _safe_float(value: Any) -> Optional[float]:
            try:
                if value is None:
                    return None
                return float(value)
            except (TypeError, ValueError):
                return None

        def _simple_moving_average(values: List[float], window: int) -> List[float]:
            if window <= 1:
                return list(values)
            if len(values) < window:
                return list(values)

            smoothed: List[float] = []
            for i in range(window - 1, len(values)):
                chunk = values[i - window + 1 : i + 1]
                smoothed.append(statistics.mean(chunk))
            return smoothed

        def _trimmed_mean(values: List[float], ratio: float) -> float:
            if not values:
                return 0.0
            if ratio <= 0:
                return float(statistics.mean(values))

            sorted_vals = sorted(values)
            k = int(len(sorted_vals) * ratio)
            if len(sorted_vals) - 2 * k <= 0:
                k = 0
            trimmed = sorted_vals[k : len(sorted_vals) - k]
            return float(statistics.mean(trimmed)) if trimmed else 0.0

        def _winsorize_by_mad(values: List[float], z: float) -> Dict[str, Any]:
            if not values:
                return {"values": [], "lower": None, "upper": None, "capped": 0}
            if z <= 0:
                return {"values": list(values), "lower": None, "upper": None, "capped": 0}

            med = float(statistics.median(values))
            deviations = [abs(v - med) for v in values]
            mad = float(statistics.median(deviations)) if deviations else 0.0
            if mad == 0:
                return {"values": list(values), "lower": None, "upper": None, "capped": 0}

            scale = 1.4826 * mad
            lower = max(0.0, med - z * scale)
            upper = med + z * scale

            capped = 0
            clipped: List[float] = []
            for v in values:
                cv = v
                if v < lower:
                    cv = lower
                elif v > upper:
                    cv = upper
                if cv != v:
                    capped += 1
                clipped.append(cv)

            return {"values": clipped, "lower": lower, "upper": upper, "capped": capped}

        if len(daily_sales) < 7:
            return {
                "trend": "indeterminate",
                "reason": f"Dados insuficientes ({len(daily_sales)} dias)",
            }

        values_with_dates = []
        can_sort_by_date = True
        try:
            from datetime import datetime
        except Exception:
            datetime = None
            can_sort_by_date = False

        for idx, day in enumerate(daily_sales):
            if "total" not in day:
                continue
            total = _safe_float(day.get("total"))
            if total is None:
                continue

            date_obj = None
            if can_sort_by_date and datetime and isinstance(day.get("data"), str):
                try:
                    date_obj = datetime.strptime(day["data"], "%Y-%m-%d")
                except Exception:
                    can_sort_by_date = False
                    date_obj = None
            values_with_dates.append((idx, date_obj, total))

        if can_sort_by_date:
            values_with_dates.sort(key=lambda x: x[1])
        else:
            values_with_dates.sort(key=lambda x: x[0])

        values = [v for _, __, v in values_with_dates]

        if len(values) < 7:
            return {"trend": "indeterminate", "reason": "Valores insuficientes"}

        raw_split = len(values) // 2
        raw_first_half = values[:raw_split]
        raw_second_half = values[raw_split:]
        avg_first_raw = float(statistics.mean(raw_first_half)) if raw_first_half else 0.0
        avg_second_raw = (
            float(statistics.mean(raw_second_half)) if raw_second_half else 0.0
        )
        median_first_raw = (
            float(statistics.median(raw_first_half)) if raw_first_half else 0.0
        )
        median_second_raw = (
            float(statistics.median(raw_second_half)) if raw_second_half else 0.0
        )

        n = len(values)
        if smoothing_window is None:
            smoothing_window = 7 if n >= 28 else 5 if n >= 14 else 3
        smoothing_window = max(1, int(smoothing_window))

        winsor = _winsorize_by_mad(values, outlier_z)
        values_for_smoothing = winsor["values"]

        smoothed_values = _simple_moving_average(values_for_smoothing, smoothing_window)
        if len(smoothed_values) < 4:
            smoothed_values = list(values_for_smoothing)

        split = len(smoothed_values) // 2
        first_half = smoothed_values[:split]
        second_half = smoothed_values[split:]

        avg_first = median_first_raw
        avg_second = median_second_raw
        smoothed_median_first = (
            float(statistics.median(first_half)) if first_half else 0.0
        )
        smoothed_median_second = (
            float(statistics.median(second_half)) if second_half else 0.0
        )
        avg_first_trimmed = _trimmed_mean(first_half, trim_ratio) if first_half else 0.0
        avg_second_trimmed = (
            _trimmed_mean(second_half, trim_ratio) if second_half else 0.0
        )

        # Determinar tendência
        if avg_second > avg_first * 1.2:  # 20% de crescimento
            trend = "up"
            strength = "strong" if avg_second > avg_first * 1.5 else "moderate"
        elif avg_second < avg_first * 0.8:  # 20% de queda
            trend = "down"
            strength = "strong" if avg_second < avg_first * 0.5 else "moderate"
        else:
            trend = "stable"
            strength = "neutral"

        # Melhor e pior dia da semana (simples)
        weekday_sales = defaultdict(list)
        for day in daily_sales:
            if "data" in day:
                try:
                    # Extrair dia da semana (0=segunda, 6=domingo)
                    from datetime import datetime

                    date_obj = datetime.strptime(day["data"], "%Y-%m-%d")
                    weekday = date_obj.weekday()
                    total = _safe_float(day.get("total"))
                    if total is None:
                        continue
                    weekday_sales[weekday].append(total)
                except:
                    continue

        best_day = None
        worst_day = None
        if weekday_sales:
            avg_by_weekday = {
                day: statistics.mean(sales) for day, sales in weekday_sales.items()
            }
            best_day = max(avg_by_weekday.items(), key=lambda x: x[1])
            worst_day = min(avg_by_weekday.items(), key=lambda x: x[1])

        return {
            "trend": trend,
            "strength": strength,
            "avg_first_half": float(avg_first),
            "avg_second_half": float(avg_second),
            "avg_first_half_trimmed": float(avg_first_trimmed),
            "avg_second_half_trimmed": float(avg_second_trimmed),
            "avg_first_half_raw": float(avg_first_raw),
            "avg_second_half_raw": float(avg_second_raw),
            "median_first_half_raw": float(median_first_raw),
            "median_second_half_raw": float(median_second_raw),
            "smoothed_median_first_half": float(smoothed_median_first),
            "smoothed_median_second_half": float(smoothed_median_second),
            "smoothing_window": int(smoothing_window),
            "trim_ratio": float(trim_ratio),
            "outlier_cap_lower": winsor["lower"],
            "outlier_cap_upper": winsor["upper"],
            "outliers_capped": int(winsor["capped"]),
            "growth_percent": (
                ((avg_second - avg_first) / avg_first * 100) if avg_first > 0 else 0
            ),
            "best_day": (
                {
                    "day": (
                        [
                            "Segunda",
                            "Terça",
                            "Quarta",
                            "Quinta",
                            "Sexta",
                            "Sábado",
                            "Domingo",
                            "Domingo",
                        ][best_day[0]]
                        if best_day
                        else None
                    ),
                    "avg_sales": float(best_day[1]) if best_day else 0,
                }
                if best_day
                else None
            ),
            "worst_day": (
                {
                    "day": (
                        [
                            "Segunda",
                            "Terça",
                            "Quarta",
                            "Quinta",
                            "Sexta",
                            "Sábado",
                            "Domingo",
                        ][worst_day[0]]
                        if worst_day
                        else None
                    ),
                    "avg_sales": float(worst_day[1]) if worst_day else 0,
                }
                if worst_day
                else None
            ),
            "confidence": (
                "high"
                if len(values) >= 30
                else "medium" if len(values) >= 15 else "low"
            ),
        }

    @staticmethod
    def analyze_inventory_abc(
        products: List[Dict[str, Any]],
        top_n: Optional[int] = 50,
        return_all_products: bool = False,
    ) -> Dict[str, Any]:
        """
        Análise ABC simplificada mas eficaz
        """
        def _safe_float(value: Any) -> float:
            try:
                if value is None:
                    return 0.0
                return float(value)
            except (TypeError, ValueError):
                return 0.0

        def _empty_result(message: str, total_products: int) -> Dict[str, Any]:
            resumo = {
                "A": {"quantidade": 0, "faturamento_total": 0.0, "percentual": 0.0, "margem_media": 0.0},
                "B": {"quantidade": 0, "faturamento_total": 0.0, "percentual": 0.0, "margem_media": 0.0},
                "C": {"quantidade": 0, "faturamento_total": 0.0, "percentual": 0.0, "margem_media": 0.0},
                "TODOS": {"quantidade": 0, "faturamento_total": 0.0, "percentual": 100.0, "margem_media": 0.0},
            }
            return {
                "classificacao": "ABC Analysis",
                "produtos": [],
                "resumo": resumo,
                "pareto_80_20": False,
                "total_value": 0.0,
                "total_products": total_products,
                "total_products_considered": 0,
                "returned_products": 0,
                "is_truncated": False,
                "insights": [message],
            }

        if not products:
            return _empty_result("Nenhum produto para análise", 0)

        # Calcular valor total do estoque
        total_value = sum(max(0.0, _safe_float(p.get("valor_total", 0))) for p in products)

        if total_value == 0:
            return _empty_result("Estoque sem valor monetário", len(products))

        # Ordenar por valor (decrescente)
        # 🔥 CORREÇÃO: Incluir produtos com valor 0 (sem vendas) para que entrem na Classe C
        sorted_products = sorted(
            products,
            key=lambda x: _safe_float(x.get("valor_total", 0)),
            reverse=True,
        )

        total_value_considered = sum(_safe_float(p.get("valor_total", 0)) for p in sorted_products)
        # Se total for 0, ainda retornamos os produtos classificados como C (ou todos zerados)
        if total_value_considered <= 0 and all(_safe_float(p.get("valor_total", 0)) == 0 for p in products):
             # Caso extremo: nada tem valor. Tudo é C.
             pass

        # Classificar ABC (80/15/5)
        cumulative_value = 0
        lucro_por_classe = {"A": 0.0, "B": 0.0, "C": 0.0}
        faturamento_por_classe = {"A": 0.0, "B": 0.0, "C": 0.0}
        quantidade_por_classe = {"A": 0, "B": 0, "C": 0}
        all_products = []

        for product in sorted_products:
            faturamento = _safe_float(product.get("valor_total", 0))
            cumulative_value += faturamento
            cumulative_percent = (cumulative_value / total_value_considered) * 100

            if cumulative_percent <= 80:
                classe = "A"
            elif cumulative_percent <= 95:
                classe = "B"
            else:
                classe = "C"

            quantidade = _safe_float(product.get("quantidade_vendida", product.get("quantidade", 0)))
            preco_custo = _safe_float(product.get("preco_custo", 0))
            custo_total = quantidade * preco_custo
            lucro = faturamento - custo_total
            margem = (lucro / faturamento * 100) if faturamento > 0 else 0

            faturamento_por_classe[classe] += faturamento
            lucro_por_classe[classe] += lucro
            quantidade_por_classe[classe] += 1

            all_products.append(
                {
                    "id": product.get("id", 0),
                    "nome": product.get("nome", ""),
                    "faturamento": faturamento,
                    "percentual_acumulado": cumulative_percent,
                    "classificacao": classe,
                    "quantidade_vendida": quantidade,
                    "margem": margem,
                }
            )

        # Gerar insights práticos
        insights = []
        if all_products:
            top_5 = all_products[:5]
            insights.append(
                f"Top 5 produtos (Classe A): {', '.join([p.get('nome', '')[:20] for p in top_5])}"
            )

            # Verificar se poucos produtos concentram muito valor
            if quantidade_por_classe["A"] < len(sorted_products) * 0.2:  # Menos de 20% dos produtos
                insights.append(
                    f"Apenas {quantidade_por_classe['A']} produtos concentram 80% do valor do estoque"
                )

        if len(sorted_products) > 0 and quantidade_por_classe["C"] > len(sorted_products) * 0.5:
            insights.append(
                f"{quantidade_por_classe['C']} produtos (Classe C) representam apenas 5% do valor - oportunidade para reduzir variedade"
            )

        if return_all_products or top_n is None or int(top_n) <= 0:
            produtos_saida = all_products
            is_truncated = False
        else:
            produtos_saida = all_products[: int(top_n)]
            is_truncated = len(produtos_saida) < len(all_products)

        # Calcular resumo por classe com margem média
        resumo = {
            "A": {
                "quantidade": quantidade_por_classe["A"],
                "faturamento_total": faturamento_por_classe["A"],
                "percentual": (faturamento_por_classe["A"] / total_value_considered * 100) if total_value_considered > 0 else 0,
                "margem_media": (lucro_por_classe["A"] / faturamento_por_classe["A"] * 100) if faturamento_por_classe["A"] > 0 else 0
            },
            "B": {
                "quantidade": quantidade_por_classe["B"],
                "faturamento_total": faturamento_por_classe["B"],
                "percentual": (faturamento_por_classe["B"] / total_value_considered * 100) if total_value_considered > 0 else 0,
                "margem_media": (lucro_por_classe["B"] / faturamento_por_classe["B"] * 100) if faturamento_por_classe["B"] > 0 else 0
            },
            "C": {
                "quantidade": quantidade_por_classe["C"],
                "faturamento_total": faturamento_por_classe["C"],
                "percentual": (faturamento_por_classe["C"] / total_value_considered * 100) if total_value_considered > 0 else 0,
                "margem_media": (lucro_por_classe["C"] / faturamento_por_classe["C"] * 100) if faturamento_por_classe["C"] > 0 else 0
            },
            "TODOS": {
                "quantidade": len(sorted_products),
                "faturamento_total": total_value_considered,
                "percentual": 100.0,
                "margem_media": ((lucro_por_classe["A"] + lucro_por_classe["B"] + lucro_por_classe["C"]) / total_value_considered * 100) if total_value_considered > 0 else 0
            }
        }

        return {
            "classificacao": "ABC Analysis",
            "produtos": produtos_saida,
            "resumo": resumo,
            "pareto_80_20": resumo["A"]["percentual"] >= 75,  # Verificar se segue lei de Pareto
            "total_value": float(total_value_considered),
            "total_products": len(products),
            "total_products_considered": len(sorted_products),
            "returned_products": len(produtos_saida),
            "is_truncated": is_truncated,
            "insights": insights,
        }

    # ------------------------------------------------------------------
    # Contrato de (in)disponibilidade analítica — ANA-01 / ANA-02
    # ------------------------------------------------------------------
    # Nenhum valor é fabricado quando faltam observações: o resultado vem
    # vazio, com `available=False` e um `reason` legível para a interface.
    MIN_FORECAST_OBSERVATIONS = 7
    FORECAST_FIT_WINDOW = 14
    MIN_PAIRS_SALES_EXPENSES = 10
    MIN_PAIRS_HOURLY = 8
    MIN_PAIRS_WEEKDAY = 7
    MIN_PAIRS_PRODUCT_MIX = 10

    @staticmethod
    def _unavailable_forecast(method: str, reason: str, observations: int = 0) -> Dict[str, Any]:
        return {
            "forecast": [],
            "available": False,
            "reason": reason,
            "method": method,
            "confidence": None,
            "observations": observations,
        }

    @staticmethod
    def generate_forecast(
        sales_timeseries: List[Dict[str, Any]], days_ahead: int = 7
    ) -> Dict[str, Any]:
        """
        Previsão de vendas por regressão linear simples sobre dias OBSERVADOS.

        - Sem histórico mínimo não há previsão (lista vazia + motivo).
        - O eixo x é a data real (dias corridos), não o índice da linha.
        - O intervalo é um intervalo de previsão de 95% calculado dos resíduos
          do ajuste (t de Student), não uma faixa fixa de ±20%.
        """
        import math
        from datetime import datetime, timedelta

        try:
            observed: Dict[Any, float] = {}
            for day in sales_timeseries or []:
                raw_total = day.get("total")
                raw_date = day.get("data")
                if raw_total is None or not isinstance(raw_date, str):
                    continue
                try:
                    value = float(raw_total)
                    parsed = datetime.strptime(raw_date[:10], "%Y-%m-%d").date()
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(value):
                    continue
                observed[parsed] = value

            n_total = len(observed)
            if n_total == 0:
                return PracticalModels._unavailable_forecast(
                    "no_data", "Sem histórico de vendas no período para gerar previsão."
                )
            min_obs = PracticalModels.MIN_FORECAST_OBSERVATIONS
            if n_total < min_obs:
                return PracticalModels._unavailable_forecast(
                    "insufficient_data",
                    f"Histórico insuficiente: {n_total} dia(s) com dados; mínimo de {min_obs}.",
                    n_total,
                )

            ordered = sorted(observed.items())[-PracticalModels.FORECAST_FIT_WINDOW:]
            origin = ordered[0][0]
            x = [float((d - origin).days) for d, _ in ordered]
            y = [v for _, v in ordered]
            n = len(y)

            x_mean = statistics.mean(x)
            y_mean = statistics.mean(y)
            sxx = sum((xi - x_mean) ** 2 for xi in x)
            if sxx == 0:
                return PracticalModels._unavailable_forecast(
                    "insufficient_data", "Datas do histórico não variam; ajuste impossível.", n_total
                )
            slope = sum((xi - x_mean) * (yi - y_mean) for xi, yi in zip(x, y)) / sxx
            intercept = y_mean - slope * x_mean

            residuals = [yi - (slope * xi + intercept) for xi, yi in zip(x, y)]
            dof = n - 2
            resid_std = math.sqrt(sum(r * r for r in residuals) / dof) if dof > 0 else 0.0
            try:
                from scipy.stats import t as student_t
                t_crit = float(student_t.ppf(0.975, dof))
            except Exception:  # scipy ausente: aproximação normal, declarada no retorno
                t_crit = 1.96

            last_date = ordered[-1][0]
            forecast = []
            for i in range(int(days_ahead)):
                future_date = last_date + timedelta(days=i + 1)
                fx = float((future_date - origin).days)
                predicted = max(0.0, slope * fx + intercept)
                margin = t_crit * resid_std * math.sqrt(1 + 1 / n + (fx - x_mean) ** 2 / sxx)
                forecast.append({
                    "data": future_date.isoformat(),
                    "valor_previsto": round(predicted, 2),
                    "lower_bound": round(max(0.0, predicted - margin), 2),
                    "upper_bound": round(predicted + margin, 2),
                })

            return {
                "forecast": forecast,
                "available": True,
                "reason": None,
                "confidence": "low" if n < PracticalModels.FORECAST_FIT_WINDOW else "medium",
                "method": "linear_regression_simple",
                "interval": {"level": 0.95, "type": "prediction_interval_from_residuals"},
                "observations": n_total,
                "fit_observations": n,
                "trend": "up" if slope > 0 else "down" if slope < 0 else "flat",
            }
        except Exception as e:
            logger.error(f"Erro ao gerar previsão: {e}", exc_info=True)
            return PracticalModels._unavailable_forecast(
                "error", "Falha interna ao gerar a previsão; nenhum valor foi estimado."
            )

    @staticmethod
    def _pearson(x: List[float], y: List[float], min_pairs: int, label: str):
        """Pearson sobre pares observados e finitos.

        Retorna (resultado|None, motivo|None). `significancia` é o p-valor
        bilateral calculado; `n` é o número de pares usados.
        """
        import math
        pairs = [
            (float(a), float(b)) for a, b in zip(x, y)
            if a is not None and b is not None and math.isfinite(float(a)) and math.isfinite(float(b))
        ]
        n = len(pairs)
        if n < min_pairs:
            return None, f"{label}: {n} par(es) observado(s); mínimo de {min_pairs}."
        xs = np.array([p[0] for p in pairs])
        ys = np.array([p[1] for p in pairs])
        if float(np.std(xs)) == 0.0 or float(np.std(ys)) == 0.0:
            return None, f"{label}: uma das séries não varia; correlação indefinida."
        from scipy.stats import pearsonr
        r, p_value = pearsonr(xs, ys)
        if not (math.isfinite(float(r)) and math.isfinite(float(p_value))):
            return None, f"{label}: correlação não calculável com os dados observados."
        return {"correlacao": float(r), "significancia": float(p_value), "n": n}, None

    @staticmethod
    def calculate_correlations(
        sales_timeseries: List[Dict[str, Any]],
        expense_details: List[Dict[str, Any]],
        establishment_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Correlações Pearson sobre observações reais. Lista vazia se não houver pares."""
        return PracticalModels.calculate_correlations_detailed(
            sales_timeseries, expense_details, establishment_id
        )[0]

    @staticmethod
    def calculate_correlations_detailed(
        sales_timeseries: List[Dict[str, Any]],
        expense_details: List[Dict[str, Any]],
        establishment_id: Optional[int] = None
    ):
        """
        Calcula correlações REAIS e informa por que cada uma ficou indisponível.

        Retorna (correlações, motivos). Sem observações válidas → ([], motivos).
        Não há coeficientes de reserva, ruído ou p-valor constante. Correlação
        mede associação, não causa; os textos não afirmam causalidade.
        """
        from app.models import Venda, VendaItem
        from datetime import datetime, timedelta
        from sqlalchemy import func

        correlations: List[Dict[str, Any]] = []
        reasons: List[str] = []

        try:
            start_date = datetime.now(timezone.utc) - timedelta(days=365)

            target_est_id = establishment_id
            if not target_est_id and expense_details:
                target_est_id = expense_details[0].get('estabelecimento_id')

            # 1) Vendas x Despesas por DIA, pares alinhados por data.
            #    Política explícita: dia de venda sem despesa lançada conta como 0.
            sales_by_date: Dict[str, float] = {}
            for s in sales_timeseries or []:
                if s.get('total') is not None and isinstance(s.get('data'), str):
                    try:
                        sales_by_date[s['data'][:10]] = float(s['total'])
                    except (TypeError, ValueError):
                        continue
            expenses_by_date: Dict[str, float] = {}
            for exp in expense_details or []:
                d = exp.get('data')
                if not isinstance(d, str):
                    continue
                try:
                    expenses_by_date[d[:10]] = expenses_by_date.get(d[:10], 0.0) + float(exp.get('valor', 0) or 0)
                except (TypeError, ValueError):
                    continue
            if sales_by_date and expenses_by_date:
                dates = sorted(sales_by_date)
                result, why = PracticalModels._pearson(
                    [sales_by_date[d] for d in dates],
                    [expenses_by_date.get(d, 0.0) for d in dates],
                    PracticalModels.MIN_PAIRS_SALES_EXPENSES, "Vendas x Despesas diárias",
                )
                if result:
                    correlations.append({
                        "variavel1": "Vendas Diárias", "variavel2": "Despesas Diárias",
                        "tipo": "pearson",
                        "insight": f"Vendas e despesas diárias {'variam no mesmo sentido' if result['correlacao'] > 0 else 'variam em sentidos opostos'} (associação, não causa).",
                        **result,
                    })
                else:
                    reasons.append(why)
            else:
                reasons.append("Vendas x Despesas diárias: sem vendas ou sem despesas observadas no período.")

            if not target_est_id:
                reasons.append("Correlações de horário, dia da semana e mix: estabelecimento não identificado.")
            else:
                db = _get_db()

                def _scope(query, model):
                    if str(target_est_id).lower() != 'all':
                        return query.filter(model.estabelecimento_id == target_est_id)
                    return query

                # 2) Hora do dia x volume
                try:
                    from app.utils.query_helpers import get_hour_extract
                    q = db.session.query(
                        get_hour_extract(Venda.data_venda).label('hora'),
                        func.sum(Venda.total).label('total')
                    ).filter(Venda.data_venda >= start_date, Venda.status == 'finalizada')
                    rows = _scope(q, Venda).group_by('hora').all()
                    result, why = PracticalModels._pearson(
                        [r.hora for r in rows], [r.total for r in rows],
                        PracticalModels.MIN_PAIRS_HOURLY, "Hora do dia x Volume de vendas",
                    )
                    if result:
                        correlations.append({
                            "variavel1": "Hora do Dia", "variavel2": "Volume de Vendas",
                            "tipo": "pearson",
                            "insight": f"Horários mais tardios estão associados a {'maior' if result['correlacao'] > 0 else 'menor'} volume de vendas.",
                            **result,
                        })
                    else:
                        reasons.append(why)
                except Exception as e:
                    db.session.rollback()
                    logger.warning(f"Error in Hourly Sales: {e}")
                    reasons.append("Hora do dia x Volume de vendas: falha ao consultar dados.")

                # 3) Dia da semana x ticket médio
                try:
                    from app.utils.query_helpers import get_dow_extract
                    q = db.session.query(
                        get_dow_extract(Venda.data_venda).label('dia'),
                        func.avg(Venda.total).label('ticket_medio')
                    ).filter(Venda.data_venda >= start_date, Venda.status == 'finalizada')
                    rows = _scope(q, Venda).group_by('dia').all()
                    result, why = PracticalModels._pearson(
                        [r.dia for r in rows], [r.ticket_medio for r in rows],
                        PracticalModels.MIN_PAIRS_WEEKDAY, "Dia da semana x Ticket médio",
                    )
                    if result:
                        correlations.append({
                            "variavel1": "Dia da Semana", "variavel2": "Ticket Médio",
                            "tipo": "pearson",
                            "insight": f"O ticket médio tende a {'aumentar' if result['correlacao'] > 0 else 'diminuir'} ao longo da semana.",
                            **result,
                        })
                    else:
                        reasons.append(why)
                except Exception as e:
                    db.session.rollback()
                    logger.warning(f"Error in Day Sales: {e}")
                    reasons.append("Dia da semana x Ticket médio: falha ao consultar dados.")

                # 4) Variedade de produtos x faturamento diário
                try:
                    q = db.session.query(
                        func.date(Venda.data_venda).label('data'),
                        func.count(func.distinct(VendaItem.produto_id)).label('produtos_unicos'),
                        func.sum(VendaItem.total_item).label('faturamento')
                    ).join(VendaItem, Venda.id == VendaItem.venda_id).filter(
                        Venda.data_venda >= start_date, Venda.status == 'finalizada'
                    )
                    rows = _scope(q, Venda).group_by(func.date(Venda.data_venda)).all()
                    result, why = PracticalModels._pearson(
                        [r.produtos_unicos for r in rows], [r.faturamento for r in rows],
                        PracticalModels.MIN_PAIRS_PRODUCT_MIX, "Variedade de produtos x Faturamento diário",
                    )
                    if result:
                        correlations.append({
                            "variavel1": "Variedade de Produtos", "variavel2": "Faturamento Diário",
                            "tipo": "pearson",
                            "insight": f"Maior variedade de produtos vendidos está associada a {'maior' if result['correlacao'] > 0 else 'menor'} faturamento diário.",
                            **result,
                        })
                    else:
                        reasons.append(why)
                except Exception as e:
                    db.session.rollback()
                    logger.warning(f"Error in Product Mix: {e}")
                    reasons.append("Variedade de produtos x Faturamento diário: falha ao consultar dados.")

        except Exception as e:
            logger.warning(f"Erro geral ao calcular correlações: {e}")
            return [], ["Falha interna ao calcular correlações; nenhum valor foi estimado."]

        correlations.sort(key=lambda x: abs(x["correlacao"]), reverse=True)
        return correlations[:8], reasons

    @staticmethod
    def detect_anomalies(
        sales_timeseries: List[Dict[str, Any]],
        expense_details: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        anomalies: List[Dict[str, Any]] = []

        # Sem dados suficientes: retornamos vazio. NUNCA inventamos anomalias
        # (o fallback fake anterior — "pico na terça / manutenção 300%" — tirava
        # a credibilidade do indicador).
        if not sales_timeseries or len(sales_timeseries) < 7:
            return anomalies

        try:
            import numpy as np

            # IMPORTANTE: só analisar DIAS ABERTOS. Dia com faturamento ~0 é loja
            # fechada (domingo/feriado), não uma "queda brusca" — era isso que
            # enchia o painel de falsos alertas de domingos passados.
            def _dia_aberto(s):
                v = s.get('total')
                return v is not None and float(v) > 1.0

            vendas_validas = [s for s in sales_timeseries if _dia_aberto(s)]
            if len(vendas_validas) >= 7:
                vals = np.array([float(s['total']) for s in vendas_validas])
                mediana = float(np.median(vals))
                mad = float(np.median(np.abs(vals - mediana)))

                if mad > 0:
                    z_scores = 0.6745 * (vals - mediana) / mad
                    for idx, z in enumerate(z_scores):
                        # Só desvios REALMENTE fortes entre dias abertos
                        if abs(z) > 2.5:
                            s = vendas_validas[idx]
                            valor = float(s['total'])
                            data_str = s.get('data', 'N/D')
                            tipo = "Pico de Vendas" if z > 0 else "Queda de Vendas"
                            var_pct = ((valor - mediana) / mediana * 100) if mediana > 0 else 0
                            if z > 0:
                                desc = (f"Em {data_str} você vendeu R$ {valor:,.2f} "
                                        f"({var_pct:+.0f}% vs. um dia normal). "
                                        f"Veja o que deu certo e repita.")
                            else:
                                desc = (f"Em {data_str} as vendas caíram para R$ {valor:,.2f} "
                                        f"({var_pct:.0f}% vs. um dia normal). "
                                        f"Verifique falta de produto, troco ou equipe reduzida.")
                            anomalies.append({
                                "tipo": f"Vendas: {tipo}",
                                "descricao": desc,
                                "data": data_str,
                                "valor": valor,
                                "media_esperada": mediana,
                                "impacto": float(z),
                                "impacto_estimado": valor - mediana,
                                "severidade": "alta" if abs(z) > 3.5 else "media",
                                "causa_provavel": "Variação atípica de demanda"
                            })

            # Mais RECENTES primeiro (o lojista quer ver o que acabou de acontecer,
            # não um domingo de 3 meses atrás).
            anomalies.sort(key=lambda x: x.get("data", ""), reverse=True)
        except Exception as e:
            logger.error(f"Erro ao detectar anomalias: {e}")

        return anomalies[:6]

    @staticmethod
    def calculate_health_score(financas: Any) -> float:
        """Score de saúde do negócio (simples)"""
        try:
            score = 70.0  # Base
            
            # Margem positiva aumenta score
            if financas and hasattr(financas, 'get'):
                gross_profit = float(financas.get('gross_profit', 0) or 0)
                revenue = float(financas.get('revenue', 0) or 0)
                if revenue > 0:
                    margin = gross_profit / revenue
                    if margin > 0.3: score += 10
                    elif margin > 0.1: score += 5
                    elif margin < 0: score -= 20
            
            return min(100.0, max(0.0, score))
        except Exception as e:
            logger.error(f"Erro ao calcular score: {e}")
            return 50.0
