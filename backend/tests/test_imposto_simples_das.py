"""FASE 3.4 — imposto honesto: Simples Nacional não vira número inventado.

O sistema não calcula imposto de Simples por venda. O DAS é mensal, sobre o
faturamento, e quem apura é o contador. O DRE passa a devolver:

    impostos_sobre_vendas = None
    imposto_rotulo = "Simples Nacional — DAS mensal"

Em vez de multiplicar a receita por uma alíquota que ninguém configurou só para
preencher a coluna — número errado com cara de certo numa tela de lucro é risco
contábil, não estimativa.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="DRE 3.4")
    session.add(cat)
    session.flush()
    session.add(Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item DRE",
                        preco_custo=Decimal("5"), preco_venda=Decimal("10"),
                        quantidade=Decimal("10")))
    session.commit()

    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": admin.role or "admin"})
    return dict(estab=estab, headers={"Authorization": f"Bearer {token}"})


def _resumo(client, ctx):
    hoje = date.today().isoformat()
    r = client.get(f"/api/despesas/resumo-financeiro/?data_inicio={hoje}&data_fim={hoje}",
                   headers=ctx["headers"])
    assert r.status_code == 200, r.get_json()
    return r.get_json()["dre_consolidado"]


def test_simples_nacional_nao_calcula_imposto_por_venda(client, ctx, session):
    estab = session.query(Estabelecimento).filter_by(id=ctx["estab"].id).first()
    estab.regime_tributario = "SIMPLES NACIONAL"
    session.commit()

    dre = _resumo(client, ctx)

    assert dre["impostos_sobre_vendas"] is None, "Simples não tem imposto calculado por venda"
    assert "DAS" in (dre["imposto_rotulo"] or "")
    assert dre["receita_liquida"] == dre["receita_bruta"]


def test_regime_com_imposto_configurado_continua_calculando(client, ctx, session):
    """Não regride o regime que realmente apura imposto por dentro da nota."""
    from app.models import Configuracao

    estab = session.query(Estabelecimento).filter_by(id=ctx["estab"].id).first()
    estab.regime_tributario = "LUCRO PRESUMIDO"
    config = session.query(Configuracao).filter_by(estabelecimento_id=estab.id).first()
    if config is None:
        config = Configuracao(estabelecimento_id=estab.id)
        session.add(config)
    config.aliquota_impostos_venda = Decimal("5.00")
    session.commit()

    dre = _resumo(client, ctx)

    assert dre["impostos_sobre_vendas"] is not None
    assert dre["imposto_rotulo"] is None
