"""Ordem única de locks para checkout PostgreSQL, dentro da transação da venda."""
import hashlib
import json
from decimal import Decimal
from sqlalchemy import text
from flask import g
from app import db
from app.models import Caixa, Cliente, Produto


def lock_checkout(tenant_id, actor_id, items, client_id=None, offline_uuid=None):
    if not isinstance(items, list) or not items or len(items) > 1000:
        raise ValueError('Carrinho inválido')
    if offline_uuid:
        if not isinstance(offline_uuid, str) or len(offline_uuid) > 36:
            raise ValueError('Identificador offline inválido')
        if db.engine.dialect.name == 'postgresql':
            key = int.from_bytes(hashlib.sha256(f'{tenant_id}:{offline_uuid}'.encode()).digest()[:8], 'big', signed=True)
            db.session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': key})
    # Serializa saldo/fechamento do mesmo caixa, depois crédito e estoque.
    Caixa.query.filter_by(estabelecimento_id=tenant_id, funcionario_id=actor_id, status='aberto').order_by(Caixa.id).populate_existing().with_for_update().all()
    client = None
    if client_id:
        client = Cliente.query.filter_by(id=client_id, estabelecimento_id=tenant_id).populate_existing().with_for_update().first()
    ids = sorted({int(i.get('productId') or i.get('produto_id') or i.get('id')) for i in items if isinstance(i, dict)})
    if ids:
        products = Produto.query.filter(Produto.estabelecimento_id == tenant_id, Produto.id.in_(ids)).order_by(Produto.id).populate_existing().with_for_update().all()
        g.checkout_products = {p.id: p for p in products}
    return client


def validate_pricing(user, items, discount, tenant_id):
    """Aplica os limites já exibidos pela configuração do PDV no servidor."""
    from app.decorators.rbac import nivel_do_role
    from app.models import Configuracao
    if user.is_super_admin or nivel_do_role(user.role) == 1:
        return  # política existente do PDV: administrador tem limite de 100%
    permissions = json.loads(user.permissoes_json or '{}')
    if not isinstance(permissions, dict):
        permissions = {}
    limit = Decimal(str(permissions.get('limite_desconto', 0))) if permissions.get('pode_dar_desconto') else Decimal(0)
    config = Configuracao.query.filter_by(estabelecimento_id=tenant_id).first()
    if config:
        limit = min(limit, Decimal(str(config.desconto_maximo_percentual)), Decimal(str(config.desconto_maximo_funcionario)))
    catalog_total = Decimal(0)
    charged = Decimal(0)
    for item in items:
        product_id = int(item.get('productId') or item.get('produto_id') or item.get('id'))
        product = getattr(g, 'checkout_products', {}).get(product_id)
        if not product:
            continue  # a rota devolve 404 para produto inexistente
        quantity = Decimal(str(item.get('quantity', item.get('quantidade', 1))))
        price = Decimal(str(item.get('price', item.get('preco_unitario', 0))))
        catalog_total += Decimal(str(product.preco_venda)) * quantity
        charged += price * quantity
    effective_discount = max(Decimal(0), catalog_total - charged) + Decimal(str(discount))
    if catalog_total and effective_discount * 100 > catalog_total * max(Decimal(0), min(limit, Decimal(100))):
        raise ValueError('Desconto excede a permissão do operador e o limite da loja')


def validate_credit(client, payments):
    credit = sum((Decimal(str(p['valor'])) for p in payments if p['forma'] == 'fiado'), Decimal(0))
    if credit:
        if not client:
            raise ValueError('Fiado exige cliente da loja')
        from app.services.credito_service import validar_sem_atraso
        validar_sem_atraso(client)
        limit = Decimal(str(client.limite_credito or 0))
        if limit <= 0 or Decimal(str(client.saldo_devedor or 0)) + credit > limit:
            raise ValueError('Limite de crédito excedido ou não aprovado')
