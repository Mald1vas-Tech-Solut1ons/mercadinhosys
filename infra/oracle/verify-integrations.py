"""Testes pequenos de autenticação/geração; não cria cobranças ou envia mensagens."""
import os
from pathlib import Path
import requests
from app.utils.llm_client import gerar_resposta

for provider in ('deepseek', 'groq'):
    result = gerar_resposta([{'role':'user','content':'Responda apenas: integração funcionando.'}],
                           provider=provider, max_tokens=128)
    print(f'LLM_{provider.upper()}=' + ('OK' if result else 'FAIL'))

try:
    import cloudinary.api
    ping = cloudinary.api.ping()
    print('CLOUDINARY=' + ('OK' if ping.get('status') == 'ok' else 'FAIL'))
except Exception as exc:
    print('CLOUDINARY=FAIL tipo=' + type(exc).__name__)

for suffix, host in (('HOMOL', 'https://cobrancas-h.api.efipay.com.br'),
                     ('PROD', 'https://cobrancas.api.efipay.com.br')):
    client_id, secret = os.getenv(f'EFI_CLIENT_ID_{suffix}'), os.getenv(f'EFI_CLIENT_SECRET_{suffix}')
    if not client_id or not secret:
        print(f'EFI_{suffix}=NOT_CONFIGURED')
        continue
    try:
        response = requests.post(host + '/v1/authorize', auth=(client_id, secret),
                                 json={'grant_type':'client_credentials'}, timeout=20)
        print(f'EFI_{suffix}_AUTH_HTTP={response.status_code}')
    except requests.RequestException:
        print(f'EFI_{suffix}=NETWORK_ERROR')

for name in ('homologacao.p12', 'producao.p12'):
    print(f'CERT_{name}=' + ('PRESENT' if Path('/app/certs', name).is_file() else 'MISSING'))
print('SMTP=' + ('CONFIGURED' if os.getenv('MAIL_USERNAME') and os.getenv('MAIL_PASSWORD') else 'NOT_CONFIGURED'))
