"""Reproduções da auditoria: nenhum teste acessa serviços externos."""
from decimal import Decimal
from datetime import datetime

import pytest
from flask import g
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto, Venda
from test_tenant_isolation import dois_tenants


@pytest.mark.parametrize('path', ['/api/health', '/api/ready'])
def test_public_health_failure_does_not_disclose_connection_details(client, session, monkeypatch, path):
    from app import db
    def unavailable(*args, **kwargs):
        raise RuntimeError('postgresql://internal-user:private-password@internal-host/database')
    monkeypatch.setattr(db.session, 'execute', unavailable)
    response = client.get(path)
    assert response.status_code == 503
    assert 'private-password' not in response.get_data(as_text=True)
    assert 'internal-host' not in response.get_data(as_text=True)


@pytest.mark.parametrize('path', ['/api/auth/setup-db', '/api/auth/bootstrap'])
def test_public_database_mutations_are_retired(client, session, path):
    assert client.post(path, json={}).status_code in (404, 410)


def test_schema_diagnostics_require_authentication(client, session):
    assert client.get('/api/auth/db-schema').status_code in (401, 404)


@pytest.mark.parametrize('secret', ['', None])
def test_cloud_sync_fails_closed_without_secret(client, app, session, monkeypatch, secret):
    monkeypatch.setitem(app.config, 'CLOUD_SYNC_TOKEN', secret)
    assert client.post('/api/sync/receive', json={'tabela': 'produtos'}).status_code == 401


@pytest.mark.parametrize('suffix,method', [('/export', 'get'), ('/restore', 'post'), ('/upload', 'post')])
def test_sync_platform_operations_deny_store_admin(client, session, suffix, method):
    est = session.query(Estabelecimento).first()
    token = create_access_token(identity='1', additional_claims={'estabelecimento_id': est.id, 'role': 'admin'})
    response = getattr(client, method)('/api/sync-hybrid' + suffix, headers={'Authorization': f'Bearer {token}'}, json={})
    assert response.status_code == 403


def test_limit_offset_and_bulk_mutations_keep_tenant_scope(dois_tenants, session):
    a, b = dois_tenants
    g.estabelecimento_id = a.id
    assert {p.estabelecimento_id for p in Produto.query.limit(20).all()} == {a.id}
    assert Produto.query.offset(1).count() == 0
    assert Produto.query.filter_by(estabelecimento_id=b.id).update({'quantidade': 0}) == 0
    assert Produto.query.filter_by(estabelecimento_id=b.id).delete() == 0


@pytest.fixture
def sale_context(session):
    est = session.query(Estabelecimento).first()
    cat = CategoriaProduto(estabelecimento_id=est.id, nome='Auditoria')
    session.add(cat)
    session.flush()
    product = Produto(estabelecimento_id=est.id, categoria_id=cat.id, nome='Produto seguro',
                      preco_custo=Decimal('5'), preco_venda=Decimal('10'), quantidade=100)
    session.add(product)
    session.commit()
    token = create_access_token(identity='1', additional_claims={'estabelecimento_id': est.id, 'role': 'admin'})
    return product, {'Authorization': f'Bearer {token}'}


def test_pdv_search_excludes_deleted_and_preserves_partial_search(client, session, sale_context):
    product, headers = sale_context
    product.codigo_barras = '7900000000010'
    session.commit()
    for term in ('7900000000010', '7900000000', 'Produto seguro'):
        response = client.get('/api/pdv/buscar-produtos', query_string={'q': term}, headers=headers)
        assert response.status_code == 200
        assert [p['id'] for p in response.json['produtos']] == [product.id]
    product.deleted_at = datetime.now()
    session.commit()
    assert client.get('/api/pdv/buscar-produtos?q=7900000000010', headers=headers).json['produtos'] == []


@pytest.mark.parametrize('page,size', [(0, 0), (-1, -1), (1, 1000000)])
def test_product_pagination_is_bounded(client, sale_context, page, size):
    _, headers = sale_context
    response = client.get('/api/produtos/', query_string={'pagina': page, 'por_pagina': size}, headers=headers)
    assert response.status_code == 200
    assert 1 <= response.json['paginacao']['itens_por_pagina'] <= 200


@pytest.mark.parametrize('change', [
    {'quantity': -2}, {'quantity': 0}, {'quantity': 'NaN'}, {'price': -10}, {'price': 'Infinity'},
    {'total': 1}, {'payment': -1}, {'forma': 'inventado'},
])
@pytest.mark.parametrize('path', ['/api/vendas/', '/api/pdv/finalizar'])
def test_manipulated_sale_is_rejected_without_stock_changes(client, session, sale_context, change, path):
    product, headers = sale_context
    payload = {'items': [{'productId': product.id, 'quantity': 1, 'price': 10}],
               'subtotal': 10, 'total': 10, 'pagamentos': [{'forma': 'dinheiro', 'valor': 10}]}
    for key, value in change.items():
        if key in ('quantity', 'price'):
            payload['items'][0][key] = value
        elif key == 'payment':
            payload['pagamentos'][0]['valor'] = value
        elif key == 'forma':
            payload['pagamentos'][0]['forma'] = value
        else:
            payload[key] = value
    response = client.post(path, headers=headers, json=payload)
    assert response.status_code == 400, response.get_data(as_text=True)
    session.refresh(product)
    assert product.quantidade == 100
    assert Venda.query.count() == 0


def test_establishment_lookup_uses_one_select(session):
    from sqlalchemy import event
    from app import db
    from app.utils.query_helpers import get_estabelecimento_safe
    est_id = session.query(Estabelecimento).first().id
    selects = []
    def count_select(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            selects.append(statement)
    event.listen(db.engine, 'before_cursor_execute', count_select)
    try:
        assert get_estabelecimento_safe(est_id)['id'] == est_id
        assert len(selects) == 1
    finally:
        event.remove(db.engine, 'before_cursor_execute', count_select)


def test_rh_cannot_promote_account(client, session):
    user = session.query(Funcionario).first()
    user.role = 'RH'
    session.commit()
    token = create_access_token(identity=str(user.id), additional_claims={
        'estabelecimento_id': user.estabelecimento_id, 'role': 'RH'})
    response = client.put(f'/api/funcionarios/{user.id}', json={'role': 'ADMIN'},
                          headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 403
    session.refresh(user)
    assert user.role == 'RH'


def test_refresh_rejects_deactivated_user(client, session):
    from flask_jwt_extended import create_refresh_token
    user = session.query(Funcionario).first()
    token = create_refresh_token(identity=str(user.id), additional_claims={
        'estabelecimento_id': user.estabelecimento_id, 'role': 'ADMIN', 'status': 'ativo'})
    user.ativo = False
    session.commit()
    response = client.post('/api/auth/refresh', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 401


@pytest.mark.parametrize('revoked,expected', [('ativo', 401), ('role', 403)])
def test_old_access_token_cannot_keep_revoked_privileges(client, session, revoked, expected):
    user = session.query(Funcionario).first()
    token = create_access_token(identity=str(user.id), additional_claims={
        'estabelecimento_id': user.estabelecimento_id, 'role': 'ADMIN', 'status': 'ativo'})
    setattr(user, revoked, False if revoked == 'ativo' else 'ENTREGADOR')
    session.commit()
    response = client.get('/api/produtos/', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == expected


@pytest.mark.parametrize('path', ['/api/vendas/', '/api/pdv/finalizar'])
def test_cash_change_reconciles_with_closing(client, session, sale_context, path):
    from app.models import Caixa, MovimentacaoCaixa
    product, headers = sale_context
    caixa = Caixa(estabelecimento_id=product.estabelecimento_id, funcionario_id=1,
                  numero_caixa='AUDIT-CASH', saldo_inicial=100, saldo_atual=100, status='aberto')
    session.add(caixa)
    session.commit()
    payload = {'items': [{'productId': product.id, 'quantity': 1, 'price': 10}],
               'subtotal': 10, 'total': 10, 'pagamentos': [{'forma': 'dinheiro', 'valor': 20}]}
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    session.refresh(caixa)
    assert caixa.saldo_atual == Decimal('110')
    mov = MovimentacaoCaixa.query.filter_by(caixa_id=caixa.id, tipo='venda').first()
    assert mov.valor == Decimal('10')
    closing = client.post('/api/caixas/fechar', json={'valor_informado': 110}, headers=headers)
    assert closing.status_code == 200, closing.get_data(as_text=True)
    assert closing.get_json()['resumo_fechamento']['quebra_gaveta'] == 0


@pytest.mark.parametrize('path', ['/api/pdv/finalizar', '/api/vendas/'])
def test_cancellation_restores_lots_and_cash_once(client, session, sale_context, path):
    from datetime import date
    from app.models import Caixa, ProdutoLote
    product, headers = sale_context
    user = session.get(Funcionario, 1)
    user.set_pin('1234')
    session.add(Caixa(estabelecimento_id=product.estabelecimento_id, funcionario_id=1,
                     numero_caixa='AUDIT-CANCEL', saldo_inicial=100, saldo_atual=100, status='aberto'))
    for i, qty in enumerate((3, 2)):
        session.add(ProdutoLote(estabelecimento_id=product.estabelecimento_id, produto_id=product.id,
                               numero_lote=f'CANCEL-{i}', quantidade=qty, quantidade_inicial=qty,
                               preco_custo_unitario=5, data_validade=date(2030, 1, 1+i), ativo=True))
    session.commit()
    response = client.post(path, headers=headers, json={'items': [{'productId': product.id, 'quantity': 4, 'price': 10}],
        'subtotal': 40, 'total': 40, 'pagamentos': [{'forma': 'dinheiro', 'valor': 50}]})
    assert response.status_code == 201, response.get_json()
    sale = Venda.query.first()
    cancellation = f'/api/vendas/{sale.id}/cancelar' if path == '/api/vendas/' else f'/api/pdv/cancelar-venda/{sale.id}'
    response = client.post(cancellation, headers=headers, json={'pin_cancelamento': '1234'})
    assert response.status_code == 200, response.get_json()
    assert client.post(cancellation, headers=headers, json={'pin_cancelamento': '1234'}).status_code == 400
    session.expire_all()
    assert session.get(Produto, product.id).quantidade == 100
    assert [lot.quantidade for lot in ProdutoLote.query.order_by(ProdutoLote.id).all()] == [3, 2]
    assert Caixa.query.first().saldo_atual == Decimal('100')
    closing = client.post('/api/caixas/fechar', headers=headers, json={'valor_informado': 100})
    assert closing.status_code == 200
    assert closing.get_json()['resumo_fechamento']['quebra_gaveta'] == 0


@pytest.mark.parametrize('result,status', [(True, 200), (False, 502), ('exception', 503)])
def test_billing_webhook_only_acknowledges_confirmed_notification(client, monkeypatch, result, status):
    class Provider:
        def handle_webhook(self, token):
            assert token == 'sandbox-notification'
            if result == 'exception':
                raise RuntimeError('upstream unavailable')
            return result
    monkeypatch.setattr('app.routes.billing_routes._get_billing_service', lambda: Provider())
    response = client.post('/api/billing/webhook', json={'notification': 'sandbox-notification'})
    assert response.status_code == status
    assert 'upstream unavailable' not in response.get_data(as_text=True)


@pytest.mark.parametrize('path', ['/api/funcionarios/me', '/api/configuracao/estabelecimentos', '/api/view-schema/'])
def test_unmapped_and_self_service_routes_reject_disabled_account(client, session, path):
    user = session.query(Funcionario).first()
    token = create_access_token(identity=str(user.id), additional_claims={'estabelecimento_id': user.estabelecimento_id, 'role': 'ADMIN'})
    user.ativo = False
    session.commit()
    assert client.get(path, headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_raw_product_helper_keeps_tenant_scope(app, session, dois_tenants):
    from app.utils.query_helpers import get_produto_safe
    a, b = dois_tenants
    target = session.query(Produto).filter_by(estabelecimento_id=b.id).first()
    with app.test_request_context('/api/produtos/'):
        g.estabelecimento_id = a.id
        assert get_produto_safe(target.id) is None


def test_employee_helper_reuses_authenticated_user_without_sql(app, session):
    from flask import request
    from sqlalchemy import event
    from app import db
    from app.utils.query_helpers import get_funcionario_safe
    user = session.query(Funcionario).first()
    queries = []
    def record(*args):
        queries.append(args[2])
    with app.test_request_context('/api/pdv/finalizar'):
        request.current_user = user
        event.listen(db.engine, 'before_cursor_execute', record)
        try:
            assert get_funcionario_safe(user.id)['id'] == user.id
            assert queries == []
        finally:
            event.remove(db.engine, 'before_cursor_execute', record)


@pytest.mark.parametrize('path', ['/api/pdv/finalizar', '/api/vendas/'])
@pytest.mark.parametrize('price,discount,status', [(10, 1, 201), (10, 2, 400), (1, 0, 400)])
def test_checkout_enforces_discount_including_hidden_price_reduction(client, session, sale_context, path, price, discount, status):
    import json
    from app.models import Caixa
    product, _ = sale_context
    user = session.get(Funcionario, 1)
    user.role = 'GERENTE'
    user.permissoes_json = json.dumps({'pode_dar_desconto': True, 'limite_desconto': 10})
    session.add(Caixa(estabelecimento_id=product.estabelecimento_id, funcionario_id=1,
                     numero_caixa='AUDIT-DISCOUNT', saldo_inicial=100, saldo_atual=100, status='aberto'))
    session.commit()
    token = create_access_token(identity='1', additional_claims={'estabelecimento_id': user.estabelecimento_id, 'role': 'GERENTE'})
    response = client.post(path, headers={'Authorization': f'Bearer {token}'}, json={
        'items': [{'productId': product.id, 'quantity': 1, 'price': price}], 'subtotal': price,
        'desconto': discount, 'total': price-discount, 'pagamentos': [{'forma': 'dinheiro', 'valor': price-discount}]})
    assert response.status_code == status, response.get_json()


def test_logo_rejects_html_disguised_as_image(client, session):
    from io import BytesIO
    user = session.query(Funcionario).first()
    token = create_access_token(identity=str(user.id), additional_claims={'estabelecimento_id': user.estabelecimento_id, 'role': 'ADMIN'})
    response = client.post('/api/configuracao/logo', headers={'Authorization': f'Bearer {token}'},
        data={'logo': (BytesIO(b'<script>alert(1)</script>'), 'logo.png', 'text/html')})
    assert response.status_code == 400


def test_logo_accepts_valid_image_and_derives_mime_from_content(client, session):
    from io import BytesIO
    from PIL import Image
    user = session.query(Funcionario).first()
    token = create_access_token(identity=str(user.id), additional_claims={'estabelecimento_id': user.estabelecimento_id, 'role': 'ADMIN'})
    image = BytesIO()
    Image.new('RGB', (2, 2)).save(image, format='PNG')
    image.seek(0)
    response = client.post('/api/configuracao/logo', headers={'Authorization': f'Bearer {token}'},
        data={'logo': (image, 'logo.png', 'text/html')})
    assert response.status_code == 200, response.get_json()
    assert response.get_json()['logo_url'].startswith('data:image/png;base64,')


def test_xml_rejects_entity_expansion():
    from app.services.fiscal.xml_parser import parse_nfe_xml, XMLNotaError
    with pytest.raises(XMLNotaError, match='DTD'):
        parse_nfe_xml(b'<!DOCTYPE NFe [<!ENTITY x "payload">]><NFe>&x;</NFe>')


def test_excel_rejects_compressed_memory_bomb():
    from app.utils.import_utils import read_import_file
    from io import BytesIO
    import zipfile
    from werkzeug.datastructures import FileStorage
    stream = BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/worksheets/sheet1.xml', b'0' * (51 * 1024 * 1024))
    stream.seek(0)
    with pytest.raises(ValueError, match='descompressão'):
        read_import_file(FileStorage(stream=stream, filename='seed.xlsx'))


def test_payment_notification_replay_does_not_renew_subscription_again(app, session):
    from app.models import Estabelecimento, EfiWebhookEvent
    from app.services.billing_service import BillingService
    establishment = session.query(Estabelecimento).first()
    establishment.gateway_subscription_id = '12345'
    session.commit()
    class Provider:
        def get_notification(self, params):
            return {'code': 200, 'data': [{'type': 'charge', 'status': {'current': status},
                'identifiers': {'charge_id': 12345}} for status in ('paid', 'settled')]}
    service = BillingService.__new__(BillingService)
    service.efi = Provider()
    assert service.handle_webhook('verified-token')
    session.refresh(establishment)
    expiration = establishment.vencimento_assinatura
    assert expiration
    assert service.handle_webhook('verified-token')
    session.refresh(establishment)
    assert establishment.vencimento_assinatura == expiration
    assert EfiWebhookEvent.query.count() == 1


def test_payment_event_migration_round_trip_and_repeated_upgrade(app, session):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect
    from app import db
    path = Path(__file__).resolve().parents[1] / 'migrations/versions/f4c6a8b0d2e4_efi_webhook_idempotency.py'
    spec = importlib.util.spec_from_file_location('efi_migration_test', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    db.session.remove()
    with db.engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
            migration.upgrade()
            migration.upgrade()
        assert 'efi_webhook_events' in inspect(connection).get_table_names()


@pytest.mark.parametrize('prefix', ['/uploads/', '/api/uploads/'])
def test_private_document_requires_current_user_and_matching_store(app, client, session, tmp_path, monkeypatch, dois_tenants, prefix):
    from datetime import date
    from app.models import JustificativaPonto
    user = session.query(Funcionario).first()
    folder = tmp_path / 'justificativas'
    folder.mkdir()
    (folder / 'audit.pdf').write_bytes(b'%PDF-1.4\nseed')
    monkeypatch.setitem(app.config, 'UPLOAD_FOLDER', str(tmp_path))
    document = JustificativaPonto(estabelecimento_id=user.estabelecimento_id, funcionario_id=user.id,
        tipo='atestado', data=date.today(), motivo='Seed', documento_url='/uploads/justificativas/audit.pdf')
    session.add(document)
    session.commit()
    path = prefix + 'justificativas/audit.pdf'
    assert client.get(path).status_code == 401
    assert client.get(prefix + 'logos/%2e%2e/justificativas/audit.pdf').status_code == 404
    token = create_access_token(identity=str(user.id), additional_claims={'estabelecimento_id': user.estabelecimento_id, 'role': user.role})
    headers = {'Authorization': f'Bearer {token}'}
    response = client.get(path, headers=headers)
    assert response.status_code == 200
    assert response.data.startswith(b'%PDF')
    assert response.headers['Cache-Control'] == 'private, no-store'
    document.estabelecimento_id = dois_tenants[1].id
    session.commit()
    assert client.get(path, headers=headers).status_code == 404
    user.ativo = False
    session.commit()
    assert client.get(path, headers=headers).status_code == 401


@pytest.mark.parametrize('path', ['/api/vendas/', '/api/pdv/finalizar'])
def test_cancellation_multiple_credit_payments_clears_all_open_debt(client, session, sale_context, path):
    from app.models import Cliente, ContaReceber, Caixa
    product, headers = sale_context
    actor = session.get(Funcionario, 1)
    actor.set_pin('1234')
    session.add(Caixa(estabelecimento_id=product.estabelecimento_id, funcionario_id=actor.id,
        numero_caixa='AUDIT-MULTI-CREDIT', saldo_inicial=0, saldo_atual=0, status='aberto'))
    customer = Cliente(estabelecimento_id=product.estabelecimento_id, nome='Seed fiado', cpf='12345678901', celular='11999999999',
        cep='69000000', logradouro='Rua Seed', numero='1', bairro='Centro', cidade='Manaus', estado='AM', limite_credito=100, saldo_devedor=0)
    session.add(customer)
    session.commit()
    response = client.post(path, headers=headers, json={'items': [{'productId': product.id, 'quantity': 1, 'price': 10}],
        'subtotal': 10, 'total': 10, 'cliente_id': customer.id, 'pagamentos': [{'forma': 'fiado', 'valor': 5}, {'forma': 'fiado', 'valor': 5}]})
    assert response.status_code == 201, response.get_json()
    sale = Venda.query.first()
    session.refresh(customer)
    assert customer.saldo_devedor == Decimal('10')
    cancel = f'/api/vendas/{sale.id}/cancelar' if path == '/api/vendas/' else f'/api/pdv/cancelar-venda/{sale.id}'
    response = client.post(cancel, headers=headers, json={'pin_cancelamento': '1234'})
    assert response.status_code == 200, response.get_json()
    session.refresh(customer)
    assert customer.saldo_devedor == 0
    assert all(account.status == 'cancelado' for account in ContaReceber.query.filter_by(venda_id=sale.id).all())


@pytest.fixture
def sfa_context(session, sale_context):
    from app.models import Cliente
    product, headers = sale_context
    customer = Cliente(estabelecimento_id=product.estabelecimento_id, nome='Seed SFA', cpf='12345678901', celular='11999999999',
        cep='69000000', logradouro='Rua Seed', numero='1', bairro='Centro', cidade='Manaus', estado='AM', limite_credito=100, saldo_devedor=0)
    session.add(customer)
    session.commit()
    return product, headers, customer


@pytest.mark.parametrize('reference', ['product', 'customer', 'seller'])
def test_sfa_rejects_foreign_product_reference(client, session, sfa_context, dois_tenants, reference):
    from app.models import PedidoVenda
    product, headers, customer = sfa_context
    foreign = session.query(Produto).filter_by(estabelecimento_id=dois_tenants[1].id).first()
    seller_id = 1
    if reference == 'customer':
        customer.estabelecimento_id = dois_tenants[1].id
    if reference == 'seller':
        from datetime import date
        seller = Funcionario(estabelecimento_id=dois_tenants[1].id, nome='Vendedor Seed', username='foreign-seller', cpf='23456789012',
            data_nascimento=date(1990, 1, 1), celular='11999999999', email='seed@example.invalid', cargo='Vendedor',
            data_admissao=date.today(), role='VENDEDOR', ativo=True)
        seller.set_password('seed-test-password')
        session.add(seller)
        session.flush()
        seller_id = seller.id
    session.commit()
    response = client.post('/api/sfa/sync-pedidos', headers=headers, json={'pedidos': [{
        'cliente_id': customer.id, 'vendedor_id': seller_id, 'subtotal': 10, 'total': 10,
        'itens': [{'produto_id': foreign.id if reference == 'product' else product.id, 'quantidade': 1, 'preco_unitario': 10, 'total_item': 10}]}]})
    assert response.status_code == 400, response.get_json()
    assert PedidoVenda.query.count() == 0


@pytest.mark.parametrize('quantity,status', [(1, 200), ('NaN', 400), (-1, 400)])
def test_sfa_validates_numeric_items_and_preserves_valid_orders(client, session, sfa_context, quantity, status):
    from app.models import PedidoVenda
    product, headers, customer = sfa_context
    order = {'cliente_id': customer.id, 'vendedor_id': 1, 'subtotal': 10, 'total': 10,
        'itens': [{'produto_id': product.id, 'quantidade': quantity, 'preco_unitario': 10, 'total_item': 10}]}
    response = client.post('/api/sfa/sync-pedidos', headers=headers, json={'pedidos': [order, order]})
    assert response.status_code == status, response.get_json()
    if status == 200:
        assert PedidoVenda.query.count() == 2
