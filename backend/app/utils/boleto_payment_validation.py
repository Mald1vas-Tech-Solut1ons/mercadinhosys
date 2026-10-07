"""Contrato monetário e fingerprint de requisição para baixas de fornecedores."""
import hashlib
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation


def money(value):
    if isinstance(value, bool) or len(str(value)) > 64:
        raise ValueError('Valor pago inválido')
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0 or amount > Decimal('999999999999999.99'):
            raise ValueError('Valor pago deve ser positivo e finito')
        rounded = amount.quantize(Decimal('0.01'))
        if amount != rounded:
            raise ValueError('Valor pago deve ter no máximo duas casas decimais')
        return rounded
    except (InvalidOperation, TypeError):
        raise ValueError('Valor pago inválido') from None


def payment_request(data, header_key, conta_id):
    if not isinstance(data, dict):
        raise ValueError('Envie um objeto JSON válido')
    body_key = data.get('idempotency_key')
    if header_key and body_key and header_key != body_key:
        raise ValueError('Chaves de idempotência divergentes')
    key = header_key if header_key is not None else body_key
    if key is not None and (not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', key)):
        raise ValueError('Chave de idempotência inválida')
    amount = money(data['valor_pago']) if 'valor_pago' in data else None
    raw_date = data.get('data_pagamento')
    if raw_date is not None:
        try:
            if not isinstance(raw_date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw_date):
                raise ValueError()
            paid_on = datetime.strptime(raw_date, '%Y-%m-%d').date()
        except ValueError:
            raise ValueError('Data de pagamento inválida; use AAAA-MM-DD') from None
    else:
        paid_on = date.today()
    method = data.get('forma_pagamento', 'Transferência')
    notes = data.get('observacoes')
    if not isinstance(method, str) or not method.strip() or len(method) > 30:
        raise ValueError('Forma de pagamento inválida')
    if notes is not None and (not isinstance(notes, str) or len(notes) > 5000):
        raise ValueError('Observações inválidas')
    canonical = {'conta_id': conta_id, 'valor_pago': str(amount) if amount is not None else None,
                 'data_pagamento': raw_date, 'forma_pagamento': method, 'observacoes': notes,
                 'observacoes_informadas': 'observacoes' in data}
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return key, digest, amount, paid_on, method
