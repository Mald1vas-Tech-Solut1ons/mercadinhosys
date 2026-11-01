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
from app.utils.query_helpers import _get_db, get_local_date
from app.utils.timezone import iso_utc

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

            # Dias antes da primeira venda não são "venda zero": a loja ainda não usava o sistema.
            # A série chega completada com zeros (90 dias) e a reta lia a estreia como crescimento
            # (R$ 4,8 mil em 7 dias viravam R$ 63 mil previstos em 30).
            com_venda = [d for d, v in observed.items() if v > 0]
            if com_venda:
                estreia = min(com_venda)
                observed = {d: v for d, v in observed.items() if d >= estreia}

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

            # Sazonalidade semanal: fator de cada dia da semana sobre a média
            # observada. Vem dos dados — não é constante inventada. Só aplicamos
            # com 2+ semanas de histórico (senão o "padrão semanal" é ruído de
            # 1-2 ocorrências por dia e distorce a reta em vez de informá-la).
            fatores_semanais = {wd: 1.0 for wd in range(7)}
            if n_total >= PracticalModels.FORECAST_FIT_WINDOW:
                weekday_vals = defaultdict(list)
                for d, v in observed.items():
                    weekday_vals[d.weekday()].append(v)
                overall_mean = y_mean
                for wd in range(7):
                    vals = weekday_vals.get(wd, [])
                    if vals and overall_mean > 0:
                        fatores_semanais[wd] = statistics.mean(vals) / overall_mean

            # Histórico do MESMO feriado (mesmo mês/dia em anos anteriores) para
            # estimar a venda de feriado com dado real, em vez de zerar ou chutar.
            from app.dashboard_cientifico.calendario import info_data, nome_feriado as _nome_feriado
            feriado_hist = defaultdict(list)
            for d, v in observed.items():
                if _nome_feriado(d):
                    feriado_hist[(d.month, d.day)].append(v)

            last_date = ordered[-1][0]
            forecast = []
            for i in range(int(days_ahead)):
                future_date = last_date + timedelta(days=i + 1)
                fx = float((future_date - origin).days)
                base = slope * fx + intercept
                fator = fatores_semanais.get(future_date.weekday(), 1.0)
                predicted = max(0.0, base * fator)
                margin = t_crit * resid_std * math.sqrt(1 + 1 / n + (fx - x_mean) ** 2 / sxx)

                info = info_data(future_date)
                historico_feriado = feriado_hist.get((future_date.month, future_date.day))
                # Feriado com histórico real: usa a média observada dele (mais
                # honesto que zerar ou chutar fator). Sem histórico: mantém a
                # sazonalidade, mas sinaliza incerteza alargando a faixa.
                if info["feriado"] and historico_feriado:
                    predicted = max(0.0, statistics.mean(historico_feriado))
                    margin *= 1.5
                elif info["feriado"]:
                    margin *= 2.0

                forecast.append({
                    "data": iso_utc(future_date),
                    "valor_previsto": round(predicted, 2),
                    "lower_bound": round(max(0.0, predicted - margin), 2),
                    "upper_bound": round(predicted + margin, 2),
                    "dia_semana": info["dia_semana"],
                    "fator_sazonal": round(fator, 3),
                    "feriado": info["feriado"],
                    "feriado_nome": info["feriado_nome"],
                })

            return {
                "forecast": forecast,
                "available": True,
                "reason": None,
                "confidence": "low" if n < PracticalModels.FORECAST_FIT_WINDOW else "medium",
                "method": "regressao_linear_sazonal_semanal_feriados",
                "interval": {"level": 0.95, "type": "prediction_interval_from_residuals"},
                "seasonality": {
                    "tipo": "semanal",
                    "fatores": {str(k): round(v, 3) for k, v in fatores_semanais.items()},
                },
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
                        get_local_date(Venda.data_venda).label('data'),
                        func.count(func.distinct(VendaItem.produto_id)).label('produtos_unicos'),
                        func.sum(VendaItem.total_item).label('faturamento')
                    ).join(VendaItem, Venda.id == VendaItem.venda_id).filter(
                        Venda.data_venda >= start_date, Venda.status == 'finalizada'
                    )
                    rows = _scope(q, Venda).group_by(get_local_date(Venda.data_venda)).all()
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
            from datetime import datetime
            from collections import defaultdict
            from app.dashboard_cientifico.calendario import info_data

            # Só analisar DIAS ABERTOS. Dia com faturamento ~0 é loja fechada
            # (domingo/feriado), não uma "queda brusca" — era isso que enchia o
            # painel de falsos alertas de domingos passados.
            def _dia_aberto(s):
                v = s.get('total')
                return v is not None and float(v) > 1.0

            abertos = []
            for s in sales_timeseries:
                if not _dia_aberto(s) or not isinstance(s.get("data"), str):
                    continue
                try:
                    d = datetime.strptime(s["data"][:10], "%Y-%m-%d").date()
                except ValueError:
                    continue
                abertos.append((d, float(s["total"])))

            if len(abertos) < 7:
                return anomalies

            # Referência por DIA DA SEMANA (não pela mediana geral): um sábado
            # fraco não é "queda" só porque domingo vende pouco.
            por_semana = defaultdict(list)
            for d, v in abertos:
                por_semana[d.weekday()].append(v)

            for d, v in abertos:
                base = por_semana[d.weekday()]
                if len(base) < 2:
                    continue
                esperado = statistics.median(base)
                if esperado <= 0:
                    continue
                desvio = (v - esperado) / esperado * 100  # %
                if abs(desvio) < 30:  # abaixo disso não é anomalia
                    continue

                info = info_data(d)
                if info["feriado"]:
                    # Feriado explica o movimento: reporta como explicado, não
                    # como "variação atípica" — o lojista já sabe que feriado
                    # não é dia normal.
                    tipo = "Feriado"
                    causa = f"Feriado ({info['feriado_nome'] or 'nacional'})"
                else:
                    tipo = "Pico de Vendas" if desvio > 0 else "Queda de Vendas"
                    causa = "Variação atípica vs. o mesmo dia da semana"

                severidade = "alta" if abs(desvio) >= 60 else "media"
                anomalies.append({
                    "tipo": f"Vendas: {tipo}",
                    "descricao": (
                        f"Em {d.isoformat()} você vendeu R$ {v:,.2f} "
                        f"({desvio:+.0f}% vs. uma {info['dia_semana'].lower()} típica). "
                        f"{'Explicado por feriado.' if info['feriado'] else 'Verifique o que mudou.'}"
                    ),
                    "data": d.isoformat(),
                    "valor": v,
                    "media_esperada": round(esperado, 2),
                    "desvio_percentual": round(desvio, 1),
                    "impacto_estimado": round(v - esperado, 2),
                    "severidade": severidade,
                    "causa_provavel": causa,
                    "feriado": info["feriado"],
                    "feriado_nome": info["feriado_nome"],
                    "dia_semana": info["dia_semana"],
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
