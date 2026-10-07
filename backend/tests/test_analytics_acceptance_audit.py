"""Bloqueios de confiança analítica: nenhuma saída inventada sem observações.

ANA-01/ANA-02 corrigidos: os testes abaixo passam normalmente (sem xfail).
Somente banco isolado das fixtures; nenhuma consulta ao ambiente publicado.
"""
from app.dashboard_cientifico.models_layer import PracticalModels


def test_sem_historico_nao_inventa_previsao():
    result = PracticalModels.generate_forecast([], days_ahead=7)
    assert result["method"] in {"insufficient_data", "no_data"}
    assert result["forecast"] == [], result["forecast"]


def test_sem_observacoes_nao_inventa_correlacoes(app):
    with app.app_context():
        result = PracticalModels.calculate_correlations([], [], establishment_id=None)
    assert result == [], result
