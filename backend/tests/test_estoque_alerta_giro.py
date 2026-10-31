"""FASE 3.3 — alerta de estoque por giro (cobertura), não só por mínimo estático.

O gatilho antigo era `quantidade <= quantidade_minima` com default 10 para todo
mundo. Quem vende 30 cervejas no fim de semana chega na sexta com 8 unidades e o
sistema fica quieto — na segunda acabou e o cliente foi embora.

Aqui a matemática é a que JÁ existe (Produto.calcular_giro_metrica, alimentada
pelo agregado cacheado do giro_cache) e a decisão fica testável em função pura.
"""
from datetime import date
from types import SimpleNamespace

import pytest

from app.routes.dashboard import (
    COBERTURA_ALERTA_DIAS,
    _deve_alertar_por_cobertura,
    _fator_contexto,
)


def _produto(nome, quantidade=8):
    return SimpleNamespace(nome=nome, quantidade=quantidade, id=1, estabelecimento_id=1)


def test_cobertura_curta_gera_alerta():
    metrica = {"vmd": 2.0, "cobertura_dias": 4.0, "classe": "rapido"}

    alertar, cobertura = _deve_alertar_por_cobertura(metrica, _produto("Arroz 5kg", 8), date(2026, 10, 28))

    assert alertar is True
    assert cobertura == 4.0


def test_cobertura_folgada_nao_gera_alerta():
    metrica = {"vmd": 0.4, "cobertura_dias": 20.0, "classe": "normal"}

    alertar, _ = _deve_alertar_por_cobertura(metrica, _produto("Arroz 5kg", 8), date(2026, 10, 28))

    assert alertar is False


def test_produto_sem_giro_nao_gera_alerta_de_cobertura():
    """Item recém-cadastrado não pode parecer 'acabando'."""
    for metrica in ({"vmd": 0.0, "cobertura_dias": None}, {"vmd": 0.0, "cobertura_dias": 2.0}):
        alertar, _ = _deve_alertar_por_cobertura(metrica, _produto("Novo", 3), date(2026, 10, 28))
        assert alertar is False


def test_bebida_no_fim_de_semana_sobe_antes():
    """Mesma bebida, mesma cobertura: sexta alerta mais cedo que segunda."""
    metrica = {"vmd": 1.0, "cobertura_dias": 6.0}  # 6 dias: acima do limite em dia comum
    sexta = date(2026, 10, 30)   # weekday 4
    segunda = date(2026, 10, 26)  # weekday 0

    alertar_sexta, cobertura_sexta = _deve_alertar_por_cobertura(metrica, _produto("Cerveja Lata 350"), sexta)
    alertar_segunda, cobertura_segunda = _deve_alertar_por_cobertura(metrica, _produto("Cerveja Lata 350"), segunda)

    assert cobertura_sexta < cobertura_segunda
    assert (alertar_sexta, alertar_segunda) == (True, False)


def test_panetone_em_dezembro_tem_urgencia_dobrada():
    metrica = {"vmd": 1.0, "cobertura_dias": 8.0}

    fator = _fator_contexto(_produto("Panetone Tradicional"), date(2026, 12, 10))

    assert fator == 0.5
    assert 8.0 * fator < COBERTURA_ALERTA_DIAS
