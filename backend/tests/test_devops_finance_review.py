"""Aceites independentes que reproduziram falhas antes da correção de release."""
from decimal import Decimal

import pytest

from app.models import ContaPagar, ContaPagarBaixa, Despesa
from test_fin01_boleto_payments import boleto_context  # fixture existente


@pytest.mark.parametrize('value', ['NaN', 'valor-invalido'])
def test_invalid_numeric_payment_returns_client_error(client, session, boleto_context, value):
    boleto, headers = boleto_context
    response = client.post(f'/api/boletos/{boleto.id}/pagar',
                           headers=headers, json={'valor_pago': value})
    assert response.status_code == 400, response.get_json()
    session.expire_all()
    assert session.get(ContaPagar, boleto.id).valor_atual == Decimal('40')
    assert session.query(Despesa).count() == 0


def test_payment_retry_same_key_has_one_financial_effect(client, session, boleto_context):
    boleto, headers = boleto_context
    headers = {**headers, 'Idempotency-Key': 'review-finance-retry-001'}
    payload = {'valor_pago': '10.00', 'idempotency_key': 'review-finance-retry-001'}
    first = client.post(f'/api/boletos/{boleto.id}/pagar', headers=headers, json=payload)
    retry = client.post(f'/api/boletos/{boleto.id}/pagar', headers=headers, json=payload)
    assert first.status_code == 200, first.get_json()
    assert retry.status_code == 200, retry.get_json()
    session.expire_all()
    assert session.get(ContaPagar, boleto.id).valor_pago == Decimal('10')
    assert session.query(Despesa).count() == 1
    assert session.query(ContaPagarBaixa).count() == 1
    assert first.get_json() == retry.get_json()
