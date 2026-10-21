"""Entrada por XML: caixa vira unidades e custo leva frete/IPI/ST. Sangria não deixa o caixa negativo."""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import Caixa, Estabelecimento, Funcionario
from app.services.fiscal.entrada_service import ImportacaoError, _custo_unitario, quantidade_estoque


def _item(**k):
    base = {"descricao": "Produto", "quantidade": Decimal("10"), "unidade": "UN", "quantidade_tributavel": Decimal("10"),
            "unidade_tributavel": "UN", "valor_total": Decimal("0"), "desconto": Decimal("0"), "frete": Decimal("0"),
            "seguro": Decimal("0"), "outras": Decimal("0"), "ipi": Decimal("0"), "icms_st": Decimal("0")}
    base.update(k)
    return base


def test_caixa_com_12_unidades_entra_como_12_e_frete_entra_no_custo():
    item = _item(descricao="Refri lata", quantidade=Decimal("1"), unidade="CX", quantidade_tributavel=Decimal("12"),
                 valor_total=Decimal("24.00"), frete=Decimal("2.40"))
    assert quantidade_estoque(item) == (Decimal("12"), "UN")
    assert _custo_unitario(item) == Decimal("2.2000")


def test_mesma_unidade_custo_com_desconto_ipi_e_st():
    item = _item(valor_total=Decimal("50"), desconto=Decimal("5"), ipi=Decimal("2.5"), icms_st=Decimal("2.5"))
    assert quantidade_estoque(item) == (Decimal("10"), "UN")
    assert _custo_unitario(item) == Decimal("5.0000")


def test_quantidade_zero_e_recusada():
    with pytest.raises(ImportacaoError):
        quantidade_estoque(_item(quantidade=Decimal("0"), quantidade_tributavel=Decimal("0")))


def test_sangria_maior_que_o_caixa_e_recusada(client, session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="T-1", saldo_inicial=Decimal("50"),
                  saldo_atual=Decimal("50"), status="aberto", data_abertura=datetime.now(timezone.utc))
    admin.nivel_acesso = 1  # o PIN que libera sangria precisa ser de admin/gerente
    admin.set_pin("4321")
    session.add(caixa)
    session.commit()
    headers = {"Authorization": "Bearer " + create_access_token(
        identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})}

    r = client.post("/api/caixas/movimentacao", headers=headers,
                    json={"tipo": "sangria", "valor": 80, "forma_pagamento": "dinheiro", "descricao": "teste", "pin": "4321"})
    assert r.status_code == 400 and "Sangria maior" in r.get_json()["error"], r.get_json()
    r = client.post("/api/caixas/movimentacao", headers=headers,
                    json={"tipo": "sangria", "valor": 30, "forma_pagamento": "dinheiro", "descricao": "teste", "pin": "4321"})
    assert r.status_code in (200, 201), r.get_json()
    session.expire_all()
    assert float(session.get(Caixa, caixa.id).saldo_atual) == 20.0
