"""Calendário BR local — feriados nacionais e ponto facultativo, sem rede.

O horário de verão acabou em 2019; as datas móveis (Páscoa → Sexta-feira Santa,
Corpus Christi e Carnaval) são calculadas localmente pelo algoritmo de Meeus,
sem depender de `tzdata`/`zoneinfo` nem de chamada HTTP. As datas fixas são os
feriados nacionais oficiais (Lei 10.607/2002 e alterações).

O objetivo é dar ao motor analítico a resposta a "este dia é feriado?" — para a
previsão (sazonalidade semanal + feriado) e para a explicação de anomalias —
sem fabricar dados externos.
"""

from datetime import date, timedelta

# (mês, dia) → nome dos feriados nacionais fixos.
_FERIADOS_FIXOS = {
    (1, 1): "Confraternização Universal",
    (4, 21): "Tiradentes",
    (5, 1): "Dia do Trabalho",
    (9, 7): "Independência do Brasil",
    (10, 12): "Nossa Senhora Aparecida",
    (11, 2): "Finados",
    (11, 15): "Proclamação da República",
    (12, 25): "Natal",
}

# Convenção de fluxo de caixa: folha salarial costuma sair até o 5º dia útil do
# mês. Usado apenas para SINALIZAR dias de saída de caixa na previsão; não é um
# número de negócio fabricado — é uma convenção declarada, substituível por
# configuração da loja quando existir.
DIA_PAGAMENTO_FOLHA_PADRAO = 5

_DIAS_SEMANA = ("Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo")


def pascoa(ano: int) -> date:
    """Domingo de Páscoa de um ano (algoritmo de Meeus/Jones/Butcher)."""
    a = ano % 19
    b = ano // 100
    c = ano % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(ano, mes, dia)


def feriados_nacionais(ano: int) -> list[date]:
    """Feriados nacionais de um ano (fixos + Sexta-feira Santa + Corpus Christi).

    Carnaval e vésperas não são feriados nacionais oficiais — são ponto
    facultativo (ver `pontos_facultativos`), mas têm forte efeito de sazonalidade
    no varejo.
    """
    p = pascoa(ano)
    feriados = [date(ano, m, d) for (m, d) in _FERIADOS_FIXOS]
    feriados.append(p - timedelta(days=2))  # Sexta-feira Santa
    feriados.append(p + timedelta(days=60))  # Corpus Christi
    return sorted(feriados)


def pontos_facultativos(ano: int) -> list[date]:
    """Carnaval (segunda e terça) — ponto facultativo, relevante para o varejo."""
    p = pascoa(ano)
    return sorted([p - timedelta(days=48), p - timedelta(days=47)])


def _por_ano(d: date) -> dict:
    return {
        "feriados": feriados_nacionais(d.year),
        "facultativos": pontos_facultativos(d.year),
    }


def eh_feriado(d: date) -> bool:
    """True se a data é feriado nacional (loja provavelmente fechada)."""
    return d in _por_ano(d)["feriados"]


def eh_ponto_facultativo(d: date) -> bool:
    """True se a data é ponto facultativo (Carnaval — loja costuma abrir)."""
    return d in _por_ano(d)["facultativos"]


def nome_feriado(d: date) -> str | None:
    """Nome do feriado, ou None se não for feriado."""
    if (d.month, d.day) in _FERIADOS_FIXOS:
        return _FERIADOS_FIXOS[(d.month, d.day)]
    p = pascoa(d.year)
    if d == p - timedelta(days=2):
        return "Sexta-feira Santa"
    if d == p + timedelta(days=60):
        return "Corpus Christi"
    return None


def info_data(d: date) -> dict:
    """Resumo de calendário de uma data: feriado/ponto facultativo/dia útil."""
    return {
        "data": d.isoformat(),
        "dia_semana": _DIAS_SEMANA[d.weekday()],
        "feriado": eh_feriado(d),
        "feriado_nome": nome_feriado(d),
        "ponto_facultativo": eh_ponto_facultativo(d),
        "fim_de_semana": d.weekday() >= 5,
    }


def dia_util_seguinte(d: date) -> date:
    """Próximo dia útil (seg-sex) após `d`, sem pular feriados nacionais."""
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5 or eh_feriado(nxt):
        nxt += timedelta(days=1)
    return nxt


def eh_dia_de_pagamento(d: date, dia: int = DIA_PAGAMENTO_FOLHA_PADRAO) -> bool:
    """True no dia da folha do mês (convenção declarada, ver constante)."""
    return d.day == dia
