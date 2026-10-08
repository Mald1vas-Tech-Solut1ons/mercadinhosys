"""Concorrência real de baixas: cada worker usa sua conexão/transação HTTP."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest

from app import db
from app.models import ContaPagar, ContaPagarBaixa, Despesa
from test_fin01_boleto_payments import boleto_context


@pytest.fixture
def postgres_boleto(app, session, boleto_context):
    if db.engine.dialect.name != 'postgresql':
        pytest.skip('Exige PostgreSQL audit_security_* isolado')
    boleto, headers = boleto_context
    return boleto.id, headers


def parallel_payments(app, context, keys):
    boleto_id, headers = context
    barrier = Barrier(len(keys))
    def pay(key):
        with app.test_client() as client:
            barrier.wait(timeout=20)
            response = client.post(f'/api/boletos/{boleto_id}/pagar',
                                   headers={**headers, 'Idempotency-Key': key},
                                   json={'valor_pago': '10'})
            return response.status_code, response.get_json()
    with ThreadPoolExecutor(max_workers=len(keys)) as executor:
        return list(executor.map(pay, keys))


def test_parallel_boleto_payments_accumulate_without_lost_updates(app, session, postgres_boleto):
    results = parallel_payments(app, postgres_boleto, [f'payment-{i}' for i in range(4)])
    assert [status for status, _ in results] == [200] * 4, results
    session.expire_all()
    title = session.get(ContaPagar, postgres_boleto[0])
    assert title.valor_pago == Decimal('40') and title.valor_atual == Decimal('0')
    assert title.status == 'pago'
    assert session.query(Despesa).count() == session.query(ContaPagarBaixa).count() == 4


def test_parallel_boleto_replay_has_one_financial_effect(app, session, postgres_boleto):
    results = parallel_payments(app, postgres_boleto, ['same-payment'] * 4)
    assert [status for status, _ in results] == [200] * 4, results
    assert all(body == results[0][1] for _, body in results)
    session.expire_all()
    assert session.get(ContaPagar, postgres_boleto[0]).valor_pago == Decimal('10')
    assert session.query(Despesa).count() == session.query(ContaPagarBaixa).count() == 1
