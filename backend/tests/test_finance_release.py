"""Validação de efeito financeiro, replay, conflitos e rollback."""
from decimal import Decimal
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import inspect
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app import db
from app.models import ContaPagar, ContaPagarBaixa, Despesa
from test_fin01_boleto_payments import boleto_context


@pytest.mark.parametrize('payload', [
    {'valor_pago': 'Infinity'}, {'valor_pago': '-Infinity'}, {'valor_pago': True},
    {'valor_pago': None}, {'valor_pago': '0.001'}, {'valor_pago': '1e1000'},
    {'valor_pago': '10', 'data_pagamento': '2026-02-30'},
    {'valor_pago': '10', 'forma_pagamento': 'x' * 31}, [],
])
def test_invalid_payment_preserves_balance(client, session, boleto_context, payload):
    boleto, headers = boleto_context
    response = client.post(f'/api/boletos/{boleto.id}/pagar', json=payload, headers=headers)
    assert response.status_code == 400, response.get_json()
    session.expire_all()
    assert session.get(ContaPagar, boleto.id).valor_pago == Decimal('0')
    assert session.query(Despesa).count() == session.query(ContaPagarBaixa).count() == 0


def test_paid_title_replay_and_conflicting_amount(client, session, boleto_context):
    boleto, headers = boleto_context
    headers = {**headers, 'Idempotency-Key': 'release-complete-payment'}
    first = client.post(f'/api/boletos/{boleto.id}/pagar', json={'valor_pago': '40'}, headers=headers)
    replay = client.post(f'/api/boletos/{boleto.id}/pagar', json={'valor_pago': '40.00'}, headers=headers)
    conflict = client.post(f'/api/boletos/{boleto.id}/pagar', json={'valor_pago': '10'}, headers=headers)
    assert first.status_code == replay.status_code == 200
    assert first.get_json() == replay.get_json()
    assert conflict.status_code == 409
    assert session.query(Despesa).count() == session.query(ContaPagarBaixa).count() == 1


def test_conflicting_header_and_body_keys_rejected(client, session, boleto_context):
    boleto, headers = boleto_context
    response = client.post(f'/api/boletos/{boleto.id}/pagar',
                           headers={**headers, 'Idempotency-Key': 'header'},
                           json={'valor_pago': '10', 'idempotency_key': 'body'})
    assert response.status_code == 400
    assert session.query(Despesa).count() == 0


def test_commit_failure_rolls_back_title_history_and_expense(client, session, boleto_context, monkeypatch):
    boleto, headers = boleto_context
    boleto_id = boleto.id
    def fail():
        raise RuntimeError('injected database failure')
    monkeypatch.setattr(db.session, 'commit', fail)
    response = client.post(f'/api/boletos/{boleto_id}/pagar',
                           headers=headers, json={'valor_pago': '10', 'idempotency_key': 'rollback'})
    assert response.status_code == 500
    assert 'injected' not in str(response.get_json())
    session.expire_all()
    assert session.get(ContaPagar, boleto_id).valor_pago == Decimal('0')
    assert session.query(Despesa).count() == session.query(ContaPagarBaixa).count() == 0


def test_financial_history_migration_roundtrip_preserves_title(app, session, boleto_context):
    boleto, _ = boleto_context
    boleto_id = boleto.id
    path = Path(__file__).resolve().parents[1] / 'migrations/versions/f5d7b9c1e3a6_conta_pagar_baixas.py'
    spec = importlib.util.spec_from_file_location('finance_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with db.engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
            migration.upgrade()
        assert 'contas_pagar_baixas' in inspect(connection).get_table_names()
    assert session.get(ContaPagar, boleto_id).valor_atual == Decimal('40')
