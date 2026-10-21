"""Ordem única de locks para checkout PostgreSQL, dentro da transação da venda."""
import hashlib
import json
from decimal import Decimal
from sqlalchemy import text
from flask import g
from app import db
from app.models import Caixa, Cliente, Produto


_CHAVES_PRODUTO = ('id', 'productId', 'produto_id')
_CHAVES_QUANTIDADE = ('quantity', 'quantidade')
_CHAVES_PRECO = ('price', 'preco_unitario')


def _unificar(item, chaves, rotulo, conversor):
    """Exige que as chaves sinônimas presentes concordem e grava o valor em todas."""
    presentes = [c for c in chaves if item.get(c) not in (None, '')]
    if not presentes:
        return None
    try:
        valores = {conversor(item[c]) for c in presentes}
    except (TypeError, ValueError, ArithmeticError):
        raise ValueError(f'Item com {rotulo} inválido')
    if len(valores) > 1:
        raise ValueError(f'Item com {rotulo} divergente')
    original = item[presentes[0]]
    for chave in chaves:
        item[chave] = original
    return valores.pop()


def normalizar_itens_checkout(items):
    """Uma única leitura de produto/quantidade/preço por item, para todo o checkout.

    Cada rota lia as chaves numa ordem (``id or productId`` x ``productId or id``):
    o validador de preço conferia um produto e a rota vendia outro. Aqui as chaves
    sinônimas precisam concordar e são reescritas IN PLACE com o mesmo valor, então
    lock, validação de preço e baixa enxergam exatamente o mesmo item.
    """
    if not isinstance(items, list) or not items or len(items) > 1000:
        raise ValueError('Carrinho inválido')
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Item inválido')
        produto_id = _unificar(item, _CHAVES_PRODUTO, 'identificação de produto', int)
        if not produto_id or produto_id <= 0:
            raise ValueError('Item sem produto válido')
        for chave in _CHAVES_PRODUTO:
            item[chave] = produto_id
        _unificar(item, _CHAVES_QUANTIDADE, 'quantidade', lambda v: Decimal(str(v)))
        _unificar(item, _CHAVES_PRECO, 'preço', lambda v: Decimal(str(v)))
    return items


def lock_checkout(tenant_id, actor_id, items, client_id=None, offline_uuid=None):
    normalizar_itens_checkout(items)
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
    ids = sorted({i['produto_id'] for i in items})
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
    normalizar_itens_checkout(items)  # idempotente: mesma leitura de item que o lock e a rota
    catalog_total = Decimal(0)
    charged = Decimal(0)
    for item in items:
        product = getattr(g, 'checkout_products', {}).get(item['produto_id'])
        if not product:
            # Nunca pular: item fora da conferência de preço é item vendido sem limite.
            raise ValueError(f"Produto {item['produto_id']} não encontrado nesta loja")
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
        validar_sem_atraso(client, valor_novo=credit)
        limit = Decimal(str(client.limite_credito or 0))
        if limit <= 0 or Decimal(str(client.saldo_devedor or 0)) + credit > limit:
            raise ValueError('Limite de crédito excedido ou não aprovado')
