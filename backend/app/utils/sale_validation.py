"""Validação estrita comum às APIs de vendas e PDV."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

CENT = Decimal('0.01')
PAYMENT_METHODS = {'dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'fiado',
                   'vale_alimentacao', 'vale_refeicao'}


def number(value, label, positive=False):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or result < 0 or result > Decimal('1000000000000') or (positive and result <= 0):
            raise ValueError
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(f'{label}: valor numérico inválido') from None


def validate_sale(data, payments, delivery_fee=0):
    if not isinstance(data, dict) or not isinstance(data.get('items'), list) or not data['items']:
        raise ValueError('Carrinho inválido')
    if len(data['items']) > 1000:
        raise ValueError('Máximo de 1000 itens por venda')
    subtotal = number(data.get('subtotal', 0), 'Subtotal')
    discount = number(data.get('desconto', 0), 'Desconto')
    total = number(data.get('total', 0), 'Total', positive=True)
    item_total = Decimal(0)
    for item in data['items']:
        if not isinstance(item, dict):
            raise ValueError('Item inválido')
        quantity = number(item.get('quantity', item.get('quantidade', 1)), 'Quantidade', positive=True)
        price = number(item.get('price', item.get('preco_unitario', 0)), 'Preço', positive=True)
        # Este fluxo não aplica desconto por item; não aceitar um campo que
        # seria gravado sem refletir no preço/financeiro.
        if number(item.get('desconto_item', 0), 'Desconto do item') != 0:
            raise ValueError('Use o desconto geral da venda')
        try:
            item_total += (quantity * price).quantize(CENT, rounding=ROUND_HALF_UP)
        except InvalidOperation:
            raise ValueError('Valor do item inválido') from None
    if abs(item_total - subtotal) > CENT:
        raise ValueError('Subtotal não corresponde aos itens')
    if discount > subtotal or abs(subtotal - discount + number(delivery_fee, 'Taxa de entrega') - total) > CENT:
        raise ValueError('Total não corresponde ao subtotal, desconto e entrega')
    if not isinstance(payments, list) or not payments:
        raise ValueError('Pagamentos inválidos')
    paid = Decimal(0)
    cash = Decimal(0)
    for payment in payments:
        if not isinstance(payment, dict):
            raise ValueError('Pagamento inválido')
        method = payment.get('forma_pagamento') or payment.get('forma') or 'dinheiro'
        if not isinstance(method, str) or method.lower() not in PAYMENT_METHODS:
            raise ValueError('Forma de pagamento inválida')
        method = method.lower()
        payment['forma'] = method
        payment['forma_pagamento'] = method
        value = number(payment.get('valor', 0), 'Pagamento', positive=True)
        paid += value
        if method == 'dinheiro':
            cash += value
    if paid - total > cash:
        raise ValueError('Troco só pode sair do pagamento em dinheiro')
    return subtotal, discount, total
