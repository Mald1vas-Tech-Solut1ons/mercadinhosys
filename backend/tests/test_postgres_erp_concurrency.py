"""Concorrência real dos fluxos ERP; nunca simula locks PostgreSQL com SQLite."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app import db
from app.models import (
    Caixa, CategoriaProduto, Cliente, ContaReceber, Estabelecimento, Fornecedor, Funcionario, PedidoCompra,
    PedidoCompraItem, PedidoVenda, Produto, ProdutoLote, Venda,
)


@pytest.fixture
def erp(app, session):
    if db.engine.dialect.name != 'postgresql':
        pytest.skip('Exige AUDIT_DATABASE_URL PostgreSQL isolado')
    tenant = session.query(Estabelecimento).first()
    actor = session.query(Funcionario).first()
    category = CategoriaProduto(estabelecimento_id=tenant.id, nome='Concorrência ERP')
    supplier = Fornecedor(estabelecimento_id=tenant.id, nome_fantasia='Fornecedor', razao_social='Fornecedor LTDA',
                          cnpj='11222333000166', telefone='11999999999', email='f@example.test', cep='01000000',
                          logradouro='Rua A', numero='1', bairro='Centro', cidade='São Paulo', estado='SP', pais='Brasil')
    customer = Cliente(estabelecimento_id=tenant.id, nome='Cliente B2B', cpf='12345678901', celular='11999999999',
                       cep='69000000', logradouro='Rua', numero='1', bairro='Centro', cidade='Manaus', estado='AM',
                       limite_credito=Decimal('10000'), saldo_devedor=0)
    session.add_all([category, supplier, customer])
    session.flush()
    product = Produto(estabelecimento_id=tenant.id, categoria_id=category.id, nome='Produto disputado',
                      preco_custo=4, preco_venda=10, quantidade=10, controlar_validade=True, ativo=True)
    session.add(product)
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=tenant.id, produto_id=product.id, numero_lote='OK', quantidade=6,
                    quantidade_inicial=6, preco_custo_unitario=4, data_validade=date.today() + timedelta(days=30), ativo=True),
        ProdutoLote(estabelecimento_id=tenant.id, produto_id=product.id, numero_lote='VENCIDO', quantidade=4,
                    quantidade_inicial=4, preco_custo_unitario=4, data_validade=date.today() - timedelta(days=1), ativo=True),
        Caixa(estabelecimento_id=tenant.id, funcionario_id=actor.id, numero_caixa='ERP', saldo_inicial=0,
              saldo_atual=0, status='aberto'),
    ])
    session.commit()
    token = create_access_token(identity=str(actor.id), additional_claims={'estabelecimento_id': tenant.id, 'role': 'ADMIN'})
    return {'tenant': tenant.id, 'product': product.id, 'customer': customer.id, 'supplier': supplier.id,
            'headers': {'Authorization': f'Bearer {token}'}}


def parallel(app, count, call):
    def run(_):
        with app.test_client() as client:
            response = call(client)
            return response.status_code, response.get_json()
    with ThreadPoolExecutor(max_workers=count) as executor:
        return list(executor.map(run, range(count)))


def test_pdv_concorrente_nao_vende_lote_vencido(app, session, erp):
    payload = {'items': [{'productId': erp['product'], 'quantity': 1, 'price': 10}], 'subtotal': 10, 'total': 10,
               'pagamentos': [{'forma': 'dinheiro', 'valor': 10}]}
    results = parallel(app, 8, lambda c: c.post('/api/pdv/finalizar', json=payload, headers=erp['headers']))
    assert sorted(status for status, _ in results) == [201] * 6 + [400] * 2, results
    db.session.expire_all()
    assert session.get(Produto, erp['product']).quantidade == 4
    assert session.query(ProdutoLote).filter_by(numero_lote='VENCIDO').one().quantidade == 4


def test_aprovacao_sfa_concorrente_fatura_uma_vez(app, session, erp):
    with app.test_client() as client:
        synced = client.post('/api/sfa/sync-pedidos', headers=erp['headers'], json={'pedidos': [{
            'cliente_id': erp['customer'], 'subtotal': 30, 'total': 30,
            'itens': [{'produto_id': erp['product'], 'quantidade': 3, 'preco_unitario': 10, 'total_item': 30}]}]})
    assert synced.status_code == 200, synced.get_json()
    order_id = session.query(PedidoVenda).one().id
    results = parallel(app, 4, lambda c: c.post(f'/api/sfa/pedidos/{order_id}/aprovar', headers=erp['headers']))
    assert all(status == 200 for status, _ in results), results
    db.session.expire_all()
    assert session.query(Venda).count() == 1
    assert session.get(Produto, erp['product']).quantidade == 7
    assert session.query(ContaReceber).count() == 1
    assert session.get(Cliente, erp['customer']).saldo_devedor == Decimal('30')


def test_recebimento_concorrente_nao_ultrapassa_pedido(app, session, erp):
    with app.test_client() as client:
        created = client.post('/api/pedidos-compra/', headers=erp['headers'], json={
            'fornecedor_id': erp['supplier'], 'itens': [{'produto_id': erp['product'], 'quantidade': 10, 'preco_unitario': 4}]})
    assert created.status_code == 201, created.get_json()
    order_id = created.get_json()['pedido']['id']
    item_id = session.query(PedidoCompraItem).filter_by(pedido_id=order_id).one().id
    validity = (date.today() + timedelta(days=90)).isoformat()
    payload = {'pedido_id': order_id, 'itens': [{'item_id': item_id, 'quantidade_recebida': 7, 'data_validade': validity}]}
    results = parallel(app, 3, lambda c: c.post('/api/pedidos-compra/receber', json=payload, headers=erp['headers']))
    assert sorted(status for status, _ in results) == [200, 400, 400], results
    db.session.expire_all()
    assert session.get(Produto, erp['product']).quantidade == 17
    assert session.get(PedidoCompra, order_id).status == 'parcial'
