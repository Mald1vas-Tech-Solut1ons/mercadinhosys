# app/utils.py
import numpy as np
try:
    from scipy import stats
except ImportError:
    stats = None
import math
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
import json
from flask import current_app
import re
from app.utils.timezone import hoje_local


def calcular_tendencia(series: List[float]) -> Dict[str, Any]:
    """
    Calcula tendência linear de uma série temporal.
    Retorna direção, inclinação, R² e previsão para próximo período.
    """
    if len(series) < 2:
        return {
            "direcao": "estavel",
            "inclinacao": 0,
            "r_quadrado": 0,
            "previsao": series[0] if series else 0,
            "confianca": "baixa",
        }

    try:
        x = np.arange(len(series))
        y = np.array(series, dtype=np.float64)

        # Remover valores NaN/Inf
        mask = np.isfinite(y)
        if not np.any(mask):
            return {
                "direcao": "estavel",
                "inclinacao": 0,
                "r_quadrado": 0,
                "previsao": 0,
                "confianca": "baixa",
            }

        x_clean = x[mask]
        y_clean = y[mask]

        if len(x_clean) < 2:
            return {
                "direcao": "estavel",
                "inclinacao": 0,
                "r_quadrado": 0,
                "previsao": np.mean(y_clean) if len(y_clean) > 0 else 0,
                "confianca": "baixa",
            }

        # Regressão linear
        if stats:
            slope, intercept, r_value, p_value, std_err = stats.linregress(x_clean, y_clean)
        else:
            # Fallback usando numpy se scipy não estiver disponível
            A = np.vstack([x_clean, np.ones(len(x_clean))]).T
            slope, intercept = np.linalg.lstsq(A, y_clean, rcond=None)[0]
            
            # Calcular R² manualmente
            y_pred = slope * x_clean + intercept
            ss_tot = np.sum((y_clean - np.mean(y_clean)) ** 2)
            ss_res = np.sum((y_clean - y_pred) ** 2)
            r_value = np.sqrt(1 - ss_res / ss_tot) if ss_tot > 0 else 0
            
            p_value = 0.05 # Valor dummy
            std_err = 0 # Valor dummy

        # Determinar direção
        if slope > 0.1:
            direcao = "crescendo"
        elif slope < -0.1:
            direcao = "decrescendo"
        else:
            direcao = "estavel"

        # Calcular previsão para próximo ponto
        previsao = intercept + slope * (len(series))

        # Avaliar confiança baseada em R² e tamanho da amostra
        r_quadrado = r_value**2
        if r_quadrado > 0.7 and len(series) >= 5:
            confianca = "alta"
        elif r_quadrado > 0.4:
            confianca = "media"
        else:
            confianca = "baixa"

        return {
            "direcao": direcao,
            "inclinacao": float(slope),
            "r_quadrado": float(r_quadrado),
            "p_value": float(p_value),
            "previsao": float(max(0, previsao)),  # Não permite valores negativos
            "confianca": confianca,
            "intervalo_confianca": [
                float(max(0, previsao - 1.96 * std_err)),
                float(previsao + 1.96 * std_err),
            ],
        }

    except Exception as e:
        current_app.logger.error(f"Erro ao calcular tendência: {str(e)}")
        return {
            "direcao": "estavel",
            "inclinacao": 0,
            "r_quadrado": 0,
            "previsao": np.mean(series) if series else 0,
            "confianca": "baixa",
            "erro": str(e),
        }


def calcular_moving_average(
    series: List[float], window: int = 7, forecast_days: int = 7
) -> List[float]:
    """
    Calcula média móvel simples e previsão para dias futuros.
    """
    if not series:
        return [0] * forecast_days

    if len(series) < window:
        # Se não tem dados suficientes, retorna a média dos disponíveis
        avg = np.mean(series) if series else 0
        return [float(avg)] * forecast_days

    # Calcular média móvel
    ma = []
    for i in range(len(series) - window + 1):
        window_slice = series[i : i + window]
        ma.append(np.mean(window_slice))

    # Previsão: usar a última média móvel para os próximos dias
    last_ma = ma[-1] if ma else np.mean(series)
    forecast = [float(last_ma)] * forecast_days

    # Retorna as últimas N médias móveis + previsão
    return ma[-forecast_days:] + forecast


def detectar_anomalias(
    series: List[float], method: str = "zscore", threshold: float = 2.5
) -> List[int]:
    """
    Detecta anomalias em uma série temporal.
    Retorna índices dos pontos anômalos.
    """
    if len(series) < 3:
        return []

    try:
        series_array = np.array(series, dtype=np.float64)

        if method == "zscore":
            # Método Z-Score
            mean = np.mean(series_array)
            std = np.std(series_array)

            if std == 0:
                return []

            z_scores = np.abs((series_array - mean) / std)
            anomalias = np.where(z_scores > threshold)[0]

        elif method == "iqr":
            # Método IQR (Interquartile Range)
            q1 = np.percentile(series_array, 25)
            q3 = np.percentile(series_array, 75)
            iqr = q3 - q1

            if iqr == 0:
                return []

            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr

            anomalias = np.where(
                (series_array < lower_bound) | (series_array > upper_bound)
            )[0]

        else:
            return []

        return [int(idx) for idx in anomalias]

    except Exception as e:
        current_app.logger.error(f"Erro ao detectar anomalias: {str(e)}")
        return []


def calcular_confianca_previsao(
    series_historica: List[float], previsao: List[float]
) -> float:
    """
    Calcula um score de confiança para a previsão baseado na volatilidade histórica.
    """
    if len(series_historica) < 2:
        return 0.0

    try:
        # Coeficiente de variação (CV) - quanto menor, mais confiável
        mean = np.mean(series_historica)
        std = np.std(series_historica)

        if mean == 0:
            return 0.0

        cv = std / mean

        # Converter CV para score de confiança (0-100)
        # CV baixo = alta confiança
        confianca = max(0, min(100, 100 * (1 - min(cv, 1))))

        # Ajustar pelo tamanho da amostra
        tamanho_penalty = min(
            1.0, len(series_historica) / 30
        )  # Penalidade se menos de 30 pontos
        confianca *= tamanho_penalty

        return round(confianca, 2)

    except Exception as e:
        current_app.logger.error(f"Erro ao calcular confiança da previsão: {str(e)}")
        return 0.0


def segmentar_valores(
    valores: List[float], n_segmentos: int = 3
) -> Dict[str, List[int]]:
    """
    Segmenta valores em grupos (baixo, médio, alto).
    Retorna índices para cada segmento.
    """
    if not valores:
        return {"baixo": [], "medio": [], "alto": []}

    try:
        sorted_indices = np.argsort(valores)
        n = len(valores)

        segment_size = n // n_segmentos

        segmentos = {}
        for i in range(n_segmentos):
            start = i * segment_size
            end = (i + 1) * segment_size if i < n_segmentos - 1 else n

            if i == 0:
                key = "baixo"
            elif i == 1:
                key = "medio"
            else:
                key = "alto"

            segmentos[key] = sorted_indices[start:end].tolist()

        return segmentos

    except Exception as e:
        current_app.logger.error(f"Erro ao segmentar valores: {str(e)}")
        return {"baixo": [], "medio": [], "alto": []}


def calcular_seasonal_decomposition(
    series: List[float], period: int = 7
) -> Dict[str, List[float]]:
    """
    Decomposição sazonal simples (tendência, sazonalidade, resíduo).
    """
    if len(series) < period * 2:
        return {
            "tendencia": series,
            "sazonalidade": [0] * len(series),
            "residuo": [0] * len(series),
        }

    try:
        n = len(series)

        # Calcular tendência com média móvel
        trend = []
        for i in range(n):
            start = max(0, i - period // 2)
            end = min(n, i + period // 2 + 1)
            trend.append(np.mean(series[start:end]))

        # Calcular sazonalidade
        seasonal = []
        for i in range(n):
            seasonal.append(series[i] - trend[i])

        # Média da sazonalidade por período
        seasonal_avg = [0] * period
        counts = [0] * period

        for i in range(n):
            idx = i % period
            seasonal_avg[idx] += seasonal[i]
            counts[idx] += 1

        for i in range(period):
            if counts[i] > 0:
                seasonal_avg[i] /= counts[i]

        # Aplicar padrão sazonal
        seasonal_pattern = []
        for i in range(n):
            seasonal_pattern.append(seasonal_avg[i % period])

        # Calcular resíduo
        residual = []
        for i in range(n):
            residual.append(series[i] - trend[i] - seasonal_pattern[i])

        return {
            "tendencia": [float(x) for x in trend],
            "sazonalidade": [float(x) for x in seasonal_pattern],
            "residuo": [float(x) for x in residual],
        }

    except Exception as e:
        current_app.logger.error(f"Erro na decomposição sazonal: {str(e)}")
        return {
            "tendencia": series,
            "sazonalidade": [0] * len(series),
            "residuo": [0] * len(series),
        }


def formatar_dinheiro(valor: float) -> str:
    """Formata valor monetário."""
    if valor is None:
        return "R$ 0,00"
    return f"R$ {valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def calcular_crescimento_percentual(valor_atual: float, valor_anterior: float) -> float:
    """Calcula crescimento percentual."""
    if valor_anterior == 0:
        return 100.0 if valor_atual > 0 else 0.0
    try:
        return round(((valor_atual - valor_anterior) / valor_anterior) * 100, 2)
    except:
        return 0.0


def normalizar_serie(series: List[float]) -> List[float]:
    """Normaliza série para escala 0-1."""
    if not series:
        return []

    try:
        min_val = min(series)
        max_val = max(series)

        if max_val == min_val:
            return [0.5] * len(series)

        return [float((x - min_val) / (max_val - min_val)) for x in series]
    except:
        return series


def gerar_cor_por_percentual(percentual: float) -> str:
    """Gera cor CSS baseada em percentual (vermelho para negativo, verde para positivo)."""
    try:
        if percentual > 0:
            intensidade = min(255, int(abs(percentual) * 2))
            return f"rgb({max(0, 150 - intensidade)}, 200, {max(0, 150 - intensidade)})"
        else:
            intensidade = min(255, int(abs(percentual) * 2))
            return f"rgb(200, {max(0, 150 - intensidade)}, {max(0, 150 - intensidade)})"
    except:
        return "rgb(150, 150, 150)"


def calcular_margem_lucro(preco_venda, preco_custo):
    """
    Calcula a margem de lucro em porcentagem.
    Fórmula: (Preço Venda - Preço Custo) / Preço Custo * 100
    
    Exemplo: Custo=10, Venda=15 => (15-10)/10*100 = 50%
    """
    preco_custo_float = float(preco_custo) if preco_custo else 0
    preco_venda_float = float(preco_venda) if preco_venda else 0
    
    # Se custo é zero ou negativo, não pode calcular margem
    if preco_custo_float <= 0:
        return 0.0
    
    try:
        lucro = preco_venda_float - preco_custo_float
        margem = (lucro / preco_custo_float) * 100
        return round(margem, 2)
    except (ValueError, TypeError, ZeroDivisionError):
        return 0.0


def validar_cpf(cpf):
    """Valida CPF (Implementação Simplificada)"""
    if not cpf:
        return False
    # Remove caracteres não numéricos
    cpf = re.sub(r"[^0-9]", "", str(cpf))
    return len(cpf) == 11


def validar_cnpj(cnpj):
    """Valida CNPJ (Implementação Simplificada)"""
    if not cnpj:
        return False
    cnpj = re.sub(r"[^0-9]", "", str(cnpj))
    return len(cnpj) == 14


def formatar_moeda(valor):
    """Formata float para moeda BRL"""
    try:
        return f"R$ {float(valor):.2f}".replace(".", ",")
    except (ValueError, TypeError):
        return "R$ 0,00"


def calcular_meta_atingida(valor_atual: float, meta: float) -> Dict[str, Any]:
    """Calcula status de meta atingida."""
    if meta == 0:
        return {"atingida": False, "percentual": 0, "restante": 0}

    try:
        percentual = (valor_atual / meta) * 100
        return {
            "atingida": valor_atual >= meta,
            "percentual": round(percentual, 2),
            "restante": max(0, meta - valor_atual),
            "excedente": max(0, valor_atual - meta),
        }
    except:
        return {"atingida": False, "percentual": 0, "restante": meta}


def calcular_classificacao_abc(
    valores: List[float], percentuais: List[float] = None
) -> List[str]:
    """
    Classificação ABC (Pareto) para valores.
    A: 80% do valor total (top 20% dos itens)
    B: 15% do valor total (próximos 30% dos itens)
    C: 5% do valor total (restante 50% dos itens)
    """
    if not valores:
        return []

    if percentuais is None:
        percentuais = [80, 15, 5]  # A, B, C

    try:
        # Ordenar valores do maior para o menor
        sorted_indices = np.argsort(valores)[::-1]
        sorted_values = np.array(valores)[sorted_indices]

        # Calcular valor total e percentuais acumulados
        total = np.sum(sorted_values)
        cumsum = np.cumsum(sorted_values)
        cumsum_percent = (cumsum / total) * 100

        # Classificar
        classificacao = ["C"] * len(valores)

        # Encontrar índices para A e B
        a_limit = percentuais[0]
        b_limit = a_limit + percentuais[1]

        for i, percent in enumerate(cumsum_percent):
            if percent <= a_limit:
                classificacao[sorted_indices[i]] = "A"
            elif percent <= b_limit:
                classificacao[sorted_indices[i]] = "B"
            else:
                classificacao[sorted_indices[i]] = "C"

        return classificacao

    except Exception as e:
        current_app.logger.error(f"Erro na classificação ABC: {str(e)}")
        return ["C"] * len(valores)


def calcular_rfm_score(
    recencia: int, frequencia: int, valor_monetario: float
) -> Tuple[str, float]:
    """
    Calcula score RFM e segmento para um cliente.
    Retorna (segmento, score)
    """
    try:
        # Normalizar valores (quanto menor a recência, melhor; maior frequência e valor, melhor)
        score_recencia = (
            max(0, 100 - min(recencia, 365) / 365 * 100) if recencia is not None else 0
        )
        score_frequencia = min(frequencia, 100) if frequencia is not None else 0
        score_valor = (
            min(valor_monetario / 1000 * 100, 100) if valor_monetario is not None else 0
        )

        # Score total (pesos: 40% recência, 30% frequência, 30% valor)
        score_total = score_recencia * 0.4 + score_frequencia * 0.3 + score_valor * 0.3

        # Determinar segmento
        if score_total >= 80:
            segmento = "champion"
        elif score_total >= 60:
            segmento = "loyal"
        elif score_total >= 40:
            segmento = "potential"
        elif score_total >= 20:
            segmento = "new"
        elif score_total >= 10:
            segmento = "at_risk"
        else:
            segmento = "lost"

        return segmento, round(score_total, 2)

    except Exception as e:
        current_app.logger.error(f"Erro no cálculo RFM: {str(e)}")
        return "new", 0.0


def calcular_giro_estoque(quantidade_vendida: int, estoque_medio: float) -> float:
    """
    Calcula giro de estoque (vezes/ano).
    """
    if estoque_medio == 0:
        return 0.0

    try:
        return round(quantidade_vendida / estoque_medio, 2)
    except:
        return 0.0


def calcular_dias_estoque(quantidade_atual: int, demanda_diaria: float) -> int:
    """
    Calcula dias de estoque disponível.
    """
    if demanda_diaria == 0:
        return 999

    try:
        return int(quantidade_atual / demanda_diaria)
    except:
        return 0


def prever_demanda_holt_winters(
    series: List[float], period: int = 7, forecast_periods: int = 7
) -> List[float]:
    """
    Previsão de demanda usando método Holt-Winters (simplificado).
    """
    if len(series) < period * 2:
        # Retorna média se dados insuficientes
        avg = np.mean(series) if series else 0
        return [float(avg)] * forecast_periods

    try:
        # Implementação simplificada do Holt-Winters
        alpha = 0.3  # Nível
        beta = 0.1  # Tendência
        gamma = 0.2  # Sazonalidade

        n = len(series)

        # Inicializar componentes
        level = series[0]
        trend = 0
        seasonal = [series[i] - level for i in range(period)]

        # Suavização
        for i in range(1, n):
            if i >= period:
                m = i - period
                seasonal_value = seasonal[m]
            else:
                seasonal_value = 0

            last_level = level
            level = alpha * (series[i] - seasonal_value) + (1 - alpha) * (level + trend)
            trend = beta * (level - last_level) + (1 - beta) * trend

            if i >= period:
                seasonal[m] = gamma * (series[i] - level) + (1 - gamma) * seasonal_value

        # Previsão
        forecasts = []
        for i in range(1, forecast_periods + 1):
            m = (n - period + i - 1) % period
            forecast = level + i * trend + seasonal[m]
            forecasts.append(max(0, float(forecast)))  # Não permite valores negativos

        return forecasts

    except Exception as e:
        current_app.logger.error(f"Erro na previsão Holt-Winters: {str(e)}")
        avg = np.mean(series) if series else 0
        return [float(avg)] * forecast_periods


def detectar_padroes_sazonais(series: List[float], period: int = 7) -> Dict[str, Any]:
    """
    Detecta padrões sazonais em séries temporais.
    """
    if len(series) < period * 2:
        return {"detectado": False, "forca": 0, "padrao": [0] * period}

    try:
        # Decomposição
        decomp = calcular_seasonal_decomposition(series, period)
        seasonal = decomp["sazonalidade"]

        # Calcular força da sazonalidade
        var_total = np.var(series)
        var_seasonal = np.var(seasonal)

        if var_total == 0:
            forca = 0
        else:
            forca = min(1.0, var_seasonal / var_total)

        # Extrair padrão para um período
        padrao_periodo = seasonal[:period]

        return {
            "detectado": forca > 0.1,  # Limiar de 10%
            "forca": round(forca, 3),
            "padrao": [float(x) for x in padrao_periodo],
            "periodo": period,
        }

    except Exception as e:
        current_app.logger.error(f"Erro na detecção de sazonalidade: {str(e)}")
        return {"detectado": False, "forca": 0, "padrao": [0] * period}


def calcular_correlacao_cruzada(
    serie1: List[float], serie2: List[float]
) -> Dict[str, Any]:
    """
    Calcula correlação cruzada entre duas séries.
    """
    if len(serie1) != len(serie2) or len(serie1) < 3:
        return {"correlacao": 0, "lag": 0, "significancia": False}

    try:
        # Correlação de Pearson
        corr, p_value = stats.pearsonr(serie1, serie2)

        # Calcular lag ótimo (simplificado)
        max_lag = min(10, len(serie1) // 2)
        best_lag = 0
        best_corr = abs(corr)

        for lag in range(1, max_lag + 1):
            if lag < len(serie1):
                corr_lag, _ = stats.pearsonr(serie1[lag:], serie2[:-lag])
                if abs(corr_lag) > best_corr:
                    best_corr = abs(corr_lag)
                    best_lag = lag

        return {
            "correlacao": round(corr, 3),
            "p_value": round(p_value, 4),
            "lag": best_lag,
            "significancia": p_value < 0.05,
            "interpretacao": (
                "forte"
                if abs(corr) > 0.7
                else "moderada" if abs(corr) > 0.3 else "fraca"
            ),
        }

    except Exception as e:
        current_app.logger.error(f"Erro no cálculo de correlação: {str(e)}")
        return {"correlacao": 0, "lag": 0, "significancia": False}


# Funções específicas para dashboard
def gerar_insight_automatico(
    metrica: float, limite: float, tipo: str
) -> Dict[str, Any]:
    """
    Gera insight automático baseado em métrica e limite.
    """
    try:
        if tipo == "crescimento":
            if metrica > limite:
                return {
                    "tipo": "positivo",
                    "mensagem": f"Crescimento excelente de {metrica}%",
                    "acao": "Mantenha a estratégia atual",
                    "prioridade": "baixa",
                }
            elif metrica > 0:
                return {
                    "tipo": "neutro",
                    "mensagem": f"Crescimento moderado de {metrica}%",
                    "acao": "Considere ajustes para acelerar",
                    "prioridade": "media",
                }
            else:
                return {
                    "tipo": "negativo",
                    "mensagem": f"Queda de {abs(metrica)}% nas vendas",
                    "acao": "Analise causas e tome ações corretivas",
                    "prioridade": "alta",
                }

        elif tipo == "estoque":
            if metrica < limite * 0.5:
                return {
                    "tipo": "negativo",
                    "mensagem": f"Estoque muito baixo ({metrica} unidades)",
                    "acao": "Reponha urgentemente",
                    "prioridade": "alta",
                }
            elif metrica < limite:
                return {
                    "tipo": "alerta",
                    "mensagem": f"Estoque próximo do mínimo ({metrica} unidades)",
                    "acao": "Programe reposição",
                    "prioridade": "media",
                }
            else:
                return {
                    "tipo": "positivo",
                    "mensagem": f"Estoque adequado ({metrica} unidades)",
                    "acao": "Mantenha monitoramento",
                    "prioridade": "baixa",
                }

        elif tipo == "validade":
            dias = int(metrica)
            if dias <= 7:
                return {
                    "tipo": "urgente",
                    "mensagem": f"Produto vence em {dias} dias",
                    "acao": "Promova ou doe urgentemente",
                    "prioridade": "critica",
                }
            elif dias <= 15:
                return {
                    "tipo": "alerta",
                    "mensagem": f"Produto vence em {dias} dias",
                    "acao": "Crie promoção específica",
                    "prioridade": "alta",
                }
            elif dias <= 30:
                return {
                    "tipo": "atenção",
                    "mensagem": f"Produto vence em {dias} dias",
                    "acao": "Monitore e planeje ações",
                    "prioridade": "media",
                }
            else:
                return {
                    "tipo": "ok",
                    "mensagem": f"Validade adequada ({dias} dias)",
                    "acao": "Controle regular",
                    "prioridade": "baixa",
                }

        else:
            return {
                "tipo": "informação",
                "mensagem": f"Métrica: {metrica}",
                "acao": "Monitore regularmente",
                "prioridade": "baixa",
            }

    except Exception as e:
        current_app.logger.error(f"Erro ao gerar insight: {str(e)}")
        return {
            "tipo": "erro",
            "mensagem": "Erro na análise",
            "acao": "Verifique os dados",
            "prioridade": "baixa",
        }


def formatar_codigo_barras(codigo):
    """Formata ou valida código de barras simples"""
    if not codigo:
        return ""
    # Remove caracteres não numéricos
    return re.sub(r"[^0-9]", "", str(codigo))


def validar_email(email):
    """Valida formato de email básico"""
    if not email:
        return False
    # Regex simples para validação
    padrao = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return re.match(padrao, email) is not None


def formatar_telefone(telefone):
    """Formata telefone para (XX) XXXXX-XXXX ou (XX) XXXX-XXXX"""
    if not telefone:
        return ""
    # Remove tudo que não for número
    nums = re.sub(r"[^0-9]", "", str(telefone))

    if len(nums) == 11:
        return f"({nums[:2]}) {nums[2:7]}-{nums[7:]}"
    elif len(nums) == 10:
        return f"({nums[:2]}) {nums[2:6]}-{nums[6:]}"
    return telefone


def calcular_idade(data_nascimento):
    """Calcula idade a partir da data de nascimento (string ou data)"""
    if not data_nascimento:
        return 0

    try:
        if isinstance(data_nascimento, str):
            nasc = datetime.strptime(data_nascimento, "%Y-%m-%d")
        else:
            nasc = data_nascimento

        hoje = hoje_local()
        idade = (
            hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))
        )
        return idade
    except Exception:
        return 0
