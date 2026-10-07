"""Ciclo real Efí homologação; não consulta credenciais de produção."""
import json
import os
from efipay import EfiPay

client_id = os.getenv('EFI_CLIENT_ID_HOMOL')
secret = os.getenv('EFI_CLIENT_SECRET_HOMOL')
if not client_id or not secret:
    print(json.dumps({'sandbox': True, 'result': 'missing_homologation_credentials'}))
    raise SystemExit(2)
provider = EfiPay({'client_id': client_id, 'client_secret': secret, 'sandbox': True})
charge_id = None
results = {'sandbox': True}
try:
    created = provider.create_charge(body={'items': [{'name': 'Auditoria MercadinhoSys Sandbox', 'value': 100, 'amount': 1}]})
    results['create_code'] = created.get('code')
    charge_id = created.get('data', {}).get('charge_id')
    if charge_id:
        detail = provider.detail_charge(params={'id': charge_id})
        results['detail_code'] = detail.get('code')
        results['status'] = detail.get('data', {}).get('status')
except Exception as exc:
    # SDK pode conter autorização/tokens na mensagem; só registra o tipo.
    results['error_type'] = type(exc).__name__
finally:
    if charge_id:
        try:
            canceled = provider.cancel_charge(params={'id': charge_id})
            results['cancel_code'] = canceled.get('code')
        except Exception as exc:
            results['cancel_error_type'] = type(exc).__name__
    print(json.dumps(results))
