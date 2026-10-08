import pytest
from datetime import date, timedelta
from decimal import Decimal
from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Fornecedor, Funcionario, ContaPagar

@pytest.fixture
def boleto_context(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

    fornecedor = Fornecedor(
        estabelecimento_id=estab.id, nome_fantasia="Fornecedor FIN01", razao_social="FIN01 LTDA",
        cnpj="11222333000199", telefone="11999999999", email="fin01@example.test",
        cep="01000000", logradouro="Rua A", numero="1", bairro="Centro",
        cidade="São Paulo", estado="SP", ativo=True, classificacao="A",
    )
    session.add(fornecedor)
    session.flush()

    boleto = ContaPagar(
        estabelecimento_id=estab.id,
        fornecedor_id=fornecedor.id,
        numero_documento="BOL-FIN01-1",
        tipo_documento="boleto",
        valor_original=Decimal("40.00"),
        valor_atual=Decimal("40.00"),
        valor_pago=Decimal("0.00"),
        data_emissao=date.today(),
        data_vencimento=date.today() + timedelta(days=10),
        status="aberto"
    )
    session.add(boleto)
    session.commit()

    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin",
    })
    return boleto, {"Authorization": f"Bearer {token}"}

def test_sucessive_payments_boleto(client, session, boleto_context):
    boleto, headers = boleto_context
    boleto_id = boleto.id

    # Pagamento 1: R$ 10,00
    res1 = client.post(f"/api/boletos/{boleto_id}/pagar", json={
        "valor_pago": 10.00,
        "data_pagamento": date.today().isoformat()
    }, headers=headers)
    assert res1.status_code == 200, res1.get_json()

    session.expire_all()
    b = session.query(ContaPagar).get(boleto_id)
    assert b.status == "parcial"
    assert b.valor_pago == Decimal("10.00")
    assert b.valor_atual == Decimal("30.00")

    # Pagamento 2: R$ 30,00
    res2 = client.post(f"/api/boletos/{boleto_id}/pagar", json={
        "valor_pago": 30.00,
        "data_pagamento": date.today().isoformat()
    }, headers=headers)
    assert res2.status_code == 200, res2.get_json()

    session.expire_all()
    b = session.query(ContaPagar).get(boleto_id)
    assert b.status == "pago"
    assert b.valor_pago == Decimal("40.00")
    assert b.valor_atual == Decimal("0.00")

def test_payment_exceeds_current_value(client, session, boleto_context):
    boleto, headers = boleto_context
    boleto_id = boleto.id

    # Pagamento de 50.00 para um boleto de 40.00
    res = client.post(f"/api/boletos/{boleto_id}/pagar", json={
        "valor_pago": 50.00
    }, headers=headers)
    assert res.status_code == 400
    assert "não pode ser maior que o saldo devedor atual" in res.get_json()["error"]
