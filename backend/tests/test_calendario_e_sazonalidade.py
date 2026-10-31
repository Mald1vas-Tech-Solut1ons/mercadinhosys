"""Calendário BR, sazonalidade/anomalias da previsão e janela local (unidade, datas fixas)."""
from datetime import date, timedelta

import pytest

from app.dashboard_cientifico.calendario import (
    eh_feriado,
    feriados_nacionais,
    nome_feriado,
    pascoa,
    pontos_facultativos,
)
from app.dashboard_cientifico.models_layer import PracticalModels


def _serie(inicio, valores):
    return [
        {"data": (inicio + timedelta(days=i)).isoformat(), "total": v}
        for i, v in enumerate(valores)
    ]


# --- Calendário BR (sem rede) ---

@pytest.mark.parametrize(
    "ano,esperado",
    [(2024, "2024-03-31"), (2025, "2025-04-20"), (2026, "2026-04-05")],
)
def test_pascoa(ano, esperado):
    assert pascoa(ano).isoformat() == esperado


def test_feriados_fixos_2026():
    fs = set(feriados_nacionais(2026))
    assert date(2026, 1, 1) in fs
    assert date(2026, 12, 25) in fs
    assert date(2026, 9, 7) in fs


def test_carnaval_eh_facultativo_nao_feriado():
    assert date(2026, 2, 16) in pontos_facultativos(2026)
    assert not eh_feriado(date(2026, 2, 17))


def test_nome_feriado():
    assert nome_feriado(date(2026, 12, 25)) == "Natal"
    assert nome_feriado(date(2026, 3, 10)) is None


# --- Janela local (datas fixas) ---

def test_local_date_to_utc_naive_meia_noite():
    from app.utils.timezone import local_date_to_utc_naive

    dt = local_date_to_utc_naive(date(2026, 10, 31))
    # meia-noite em São Paulo (UTC-3) = 03:00 UTC
    assert (dt.hour, dt.minute, dt.second) == (3, 0, 0)


def test_local_date_to_utc_naive_fim_do_dia():
    from app.utils.timezone import local_date_to_utc_naive

    dt = local_date_to_utc_naive(date(2026, 10, 31), fim_do_dia=True)
    assert dt.date() == date(2026, 11, 1)  # 23:59:59 local vira o dia seguinte em UTC
    assert dt.hour == 2


# --- Previsão com sazonalidade semanal ---

def test_previsao_reflete_padrao_semanal():
    inicio = date(2026, 1, 5)  # segunda-feira
    vals = [100 if (inicio + timedelta(days=i)).weekday() < 5 else 20 for i in range(28)]
    r = PracticalModels.generate_forecast(_serie(inicio, vals), days_ahead=7)
    assert r["available"] is True
    assert r["method"] == "regressao_linear_sazonal_semanal_feriados"
    # primeira previsão: 2026-02-02 (segunda)
    segunda = r["forecast"][0]
    assert segunda["data"] == "2026-02-02"
    # 2026-02-08 (domingo) prevista BEM abaixo da segunda (sinal sazonal)
    domingo = [f for f in r["forecast"] if f["data"] == "2026-02-08"][0]
    assert domingo["valor_previsto"] < segunda["valor_previsto"]
    # fatores semanais presentes: domingo (6) abaixo da média, segunda (0) acima
    fatores = r["seasonality"]["fatores"]
    assert fatores["6"] < 0.5
    assert fatores["0"] > 1.0


# --- Anomalias comparadas ao mesmo dia da semana ---

def test_anomalia_pico_na_terca_e_domingo_nao_flagado():
    inicio = date(2026, 1, 5)  # segunda
    vals = [100 if (inicio + timedelta(days=i)).weekday() < 5 else 20 for i in range(28)]
    vals[8] = 300  # terça 2026-01-13 com pico
    r = PracticalModels.detect_anomalies(_serie(inicio, vals), [])
    pico = [a for a in r if a["data"] == "2026-01-13"]
    assert pico and pico[0]["severidade"] == "alta"
    assert pico[0]["feriado"] is False
    # domingo (20) não deve ser flagado só porque é menor que a média geral
    assert not any(a["data"] == "2026-01-11" for a in r)


def test_anomalia_explicada_por_feriado():
    inicio = date(2025, 12, 15)  # segunda
    vals = [100 if (inicio + timedelta(days=i)).weekday() < 5 else 20 for i in range(21)]
    vals[10] = 500  # Natal 2025-12-25 (quinta), loja aberta com venda atípica
    r = PracticalModels.detect_anomalies(_serie(inicio, vals), [])
    natal = [a for a in r if a["data"] == "2025-12-25"]
    assert natal and natal[0]["feriado"] is True
    assert "Feriado" in natal[0]["causa_provavel"]
