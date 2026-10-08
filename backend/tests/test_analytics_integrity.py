"""ANA-01/02: contrato de indisponibilidade e cálculos reais (unidade)."""
import math
from datetime import date, timedelta

import pytest

from app.dashboard_cientifico.models_layer import PracticalModels


def _series(values, start=date(2026, 1, 1)):
    return [
        {"data": (start + timedelta(days=i)).isoformat(), "total": v}
        for i, v in enumerate(values)
    ]


def test_previsao_sem_historico_informa_motivo():
    r = PracticalModels.generate_forecast([], days_ahead=7)
    assert r["available"] is False
    assert r["forecast"] == []
    assert r["reason"]
    assert r["confidence"] is None


@pytest.mark.parametrize("n", [1, 3, 6])
def test_previsao_abaixo_do_minimo_nao_gera_valores(n):
    r = PracticalModels.generate_forecast(_series([100.0] * n), days_ahead=7)
    assert r["available"] is False
    assert r["method"] == "insufficient_data"
    assert r["forecast"] == []
    assert str(n) in r["reason"]
    assert r["observations"] == n


def test_previsao_ignora_valores_nao_finitos_e_datas_invalidas():
    series = _series([100.0] * 5) + [
        {"data": "2026-02-01", "total": float("nan")},
        {"data": "nao-e-data", "total": 10},
        {"data": "2026-02-02", "total": None},
    ]
    r = PracticalModels.generate_forecast(series)
    assert r["available"] is False and r["observations"] == 5


def test_previsao_linear_exata_tem_intervalo_zerado_e_datas_reais():
    # y = 100 + 10*dia, sem ruído => resíduo 0 => intervalo colapsa na previsão
    series = _series([100 + 10 * i for i in range(10)])
    r = PracticalModels.generate_forecast(series, days_ahead=3)
    assert r["available"] is True and r["reason"] is None
    assert [f["data"] for f in r["forecast"]] == ["2026-01-11", "2026-01-12", "2026-01-13"]
    assert [f["valor_previsto"] for f in r["forecast"]] == [200.0, 210.0, 220.0]
    for f in r["forecast"]:
        assert f["lower_bound"] == f["upper_bound"] == f["valor_previsto"]


def test_previsao_usa_calendario_com_lacunas():
    # Dias 0..6 e 9: série com lacuna; o eixo x é a data real, não o índice.
    days = [0, 1, 2, 3, 4, 5, 6, 9]
    series = [
        {"data": (date(2026, 1, 1) + timedelta(days=d)).isoformat(), "total": 100 + 10 * d}
        for d in days
    ]
    r = PracticalModels.generate_forecast(series, days_ahead=1)
    assert r["forecast"][0]["data"] == "2026-01-11"
    assert r["forecast"][0]["valor_previsto"] == 200.0


def test_previsao_com_ruido_tem_intervalo_calculado_dos_residuos():
    values = [100, 120, 90, 130, 95, 125, 105, 140, 100, 135]
    r = PracticalModels.generate_forecast(_series(values), days_ahead=2)
    assert r["available"] is True
    f = r["forecast"][0]
    assert f["lower_bound"] < f["valor_previsto"] < f["upper_bound"]
    # não é a faixa fixa antiga de +/-20%
    assert not math.isclose(f["upper_bound"], f["valor_previsto"] * 1.2, rel_tol=1e-3)
    assert r["interval"]["level"] == 0.95


def test_pearson_exige_minimo_de_pares():
    result, why = PracticalModels._pearson([1, 2, 3], [2, 4, 6], 10, "teste")
    assert result is None and "mínimo" in why


def test_pearson_serie_constante_e_indefinida():
    result, why = PracticalModels._pearson(list(range(12)), [5.0] * 12, 10, "teste")
    assert result is None and "não varia" in why


def test_pearson_descarta_pares_nao_finitos():
    x = list(range(12)) + [float("nan")]
    y = [2 * i for i in range(12)] + [1.0]
    result, _ = PracticalModels._pearson(x, y, 10, "teste")
    assert result["n"] == 12
    assert result["correlacao"] == pytest.approx(1.0)
    assert result["significancia"] < 0.001  # p-valor calculado, não constante


def test_correlacao_vendas_despesas_alinha_por_data_sem_ruido(app):
    sales = _series([100 + i for i in range(12)])
    expenses = [
        {"data": s["data"], "valor": 50 + 2 * (s["total"] - 100), "estabelecimento_id": None}
        for s in sales
    ]
    with app.app_context():
        corr, reasons = PracticalModels.calculate_correlations_detailed(sales, expenses, None)
    assert len(corr) == 1
    c = corr[0]
    assert c["correlacao"] == pytest.approx(1.0)
    assert c["n"] == 12
    assert c["significancia"] != 0.05  # nunca o valor fixo antigo
    assert "causa" in c["insight"] or "associa" in c["insight"]


def test_correlacoes_nunca_trazem_coeficientes_de_reserva(app):
    with app.app_context():
        corr, reasons = PracticalModels.calculate_correlations_detailed(
            _series([100, 120, 90]), [{"data": "2026-01-01", "valor": 10}], None
        )
    assert corr == []
    assert reasons  # motivo explicado ao frontend
