"""Integração real: nunca simula locks PostgreSQL com SQLite."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import date
from decimal import Decimal
from uuid import uuid4
import pytest
from flask_jwt_extended import create_access_token
from app import db
from app.models import Caixa, CategoriaProduto, Cliente, Estabelecimento, Funcionario, Produto, ProdutoLote, Venda


@pytest.fixture
def checkout(app, session):
    if db.engine.dialect.name != 'postgresql':
        pytest.skip('Exige AUDIT_DATABASE_URL PostgreSQL isolado')
    tenant = session.query(Estabelecimento).first()
    actor = session.query(Funcionario).first()
    category = CategoriaProduto(estabelecimento_id=tenant.id, nome='Concorrência')
    session.add(category)
    session.flush()
    product = Produto(estabelecimento_id=tenant.id, categoria_id=category.id, nome='Produto concorrente',
                      preco_custo=5, preco_venda=10, quantidade=5, ativo=True)
    client = Cliente(estabelecimento_id=tenant.id, nome='Crédito concorrente', cpf='12345678901', celular='11999999999',
                     cep='69000000', logradouro='Rua de teste', numero='1', bairro='Centro', cidade='Manaus', estado='AM',
                     limite_credito=30, saldo_devedor=0)
    cashier = Caixa(estabelecimento_id=tenant.id, funcionario_id=actor.id, numero_caixa='AUDIT', saldo_inicial=100, saldo_atual=100, status='aberto')
    session.add_all([product, client, cashier])
    session.flush()
    for i, qty in enumerate((3, 2)):
        session.add(ProdutoLote(estabelecimento_id=tenant.id, produto_id=product.id, numero_lote=f'AUDIT-{i}',
                               quantidade=qty, quantidade_inicial=qty, preco_custo_unitario=5, data_validade=date(2030, 1, 1+i), ativo=True))
    session.commit()
    token = create_access_token(identity=str(actor.id), additional_claims={'estabelecimento_id': tenant.id, 'role': 'ADMIN'})
    return {'product_id': product.id, 'client_id': client.id, 'cashier_id': cashier.id, 'headers': {'Authorization': f'Bearer {token}'}}


def parallel_sales(app, checkout, path, count, method='dinheiro', key=None, qty=1):
    payload = {'items': [{'productId': checkout['product_id'], 'quantity': qty, 'price': 10}],
               'subtotal': qty*10, 'total': qty*10, 'pagamentos': [{'forma': method, 'valor': qty*10}]}
    if method == 'fiado':
        payload['cliente_id'] = checkout['client_id']
    if key:
        payload['offline_uuid'] = key
    def run(_):
        with app.test_client() as client:
            response = client.post(path, json=payload, headers=checkout['headers'])
            return response.status_code, response.get_json()
    with ThreadPoolExecutor(max_workers=count) as executor:
        return list(executor.map(run, range(count)))


@pytest.mark.parametrize('path', ['/api/pdv/finalizar', '/api/vendas/'])
def test_parallel_checkout_cannot_oversell(app, session, checkout, path):
    results = parallel_sales(app, checkout, path, 6)
    assert sorted(status for status, _ in results) == [201]*5 + [400], results
    db.session.expire_all()
    assert session.get(Produto, checkout['product_id']).quantidade == 0
    assert session.get(Caixa, checkout['cashier_id']).saldo_atual == Decimal('150')
    assert session.query(Venda).count() == 5
    assert sum(l.quantidade for l in session.query(ProdutoLote).all()) == 0


@pytest.mark.parametrize('path', ['/api/pdv/finalizar', '/api/vendas/'])
def test_parallel_credit_obeys_limit(app, session, checkout, path):
    results = parallel_sales(app, checkout, path, 5, method='fiado')
    assert sorted(status for status, _ in results) == [201]*3 + [400]*2, results
    db.session.expire_all()
    assert session.get(Cliente, checkout['client_id']).saldo_devedor == Decimal('30')
    assert session.get(Produto, checkout['product_id']).quantidade == 2


@pytest.mark.parametrize('path', ['/api/pdv/finalizar', '/api/vendas/'])
def test_parallel_offline_retry_creates_one_sale(app, session, checkout, path):
    results = parallel_sales(app, checkout, path, 4, key=str(uuid4()))
    assert sorted(status for status, _ in results) == [200]*3 + [201], results
    db.session.expire_all()
    assert session.query(Venda).count() == 1
    assert session.get(Produto, checkout['product_id']).quantidade == 4
    assert session.get(Caixa, checkout['cashier_id']).saldo_atual == Decimal('110')


@pytest.mark.parametrize('path', ['/api/pdv/finalizar', '/api/vendas/'])
def test_checkout_consumes_earliest_lots_first(app, session, checkout, path):
    results = parallel_sales(app, checkout, path, 1, qty=4)
    assert results[0][0] == 201, results
    db.session.expire_all()
    lots = session.query(ProdutoLote).order_by(ProdutoLote.data_validade).all()
    assert [lot.quantidade for lot in lots] == [0, 1]


def test_parallel_close_and_checkout_keep_cash_balance_consistent(app, session, checkout):
    barrier = Barrier(2)
    payload = {'items': [{'productId': checkout['product_id'], 'quantity': 1, 'price': 10}],
               'subtotal': 10, 'total': 10, 'pagamentos': [{'forma': 'dinheiro', 'valor': 10}]}
    def request(path, body):
        with app.test_client() as client:
            barrier.wait(timeout=10)
            response = client.post(path, json=body, headers=checkout['headers'])
            return response.status_code, response.get_json()
    with ThreadPoolExecutor(max_workers=2) as executor:
        sale = executor.submit(request, '/api/pdv/finalizar', payload)
        close = executor.submit(request, '/api/caixas/fechar', {'valor_informado': 100})
        sale_result, close_result = sale.result(), close.result()
    assert close_result[0] == 200, close_result
    assert sale_result[0] in (201, 403), sale_result
    db.session.expire_all()
    cash = session.get(Caixa, checkout['cashier_id'])
    sold = 1 if sale_result[0] == 201 else 0
    assert cash.status == 'fechado'
    assert cash.saldo_final == Decimal(100 + sold * 10)
    assert cash.saldo_atual == Decimal(100 + sold * 10)
    assert session.get(Produto, checkout['product_id']).quantidade == 5 - sold
