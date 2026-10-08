"""Verifica RAG com dados reais do seed na Oracle; não imprime tokens/senhas."""
import json
import os
import urllib.request
from pathlib import Path

base = 'http://127.0.0.1:5000/api'
def request(path, data, token=None, tenant=None):
    headers = {'Content-Type':'application/json', 'Origin':'https://mercadinhosys.vercel.app'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if tenant: headers['X-Establishment-ID'] = str(tenant)
    req = urllib.request.Request(base + path, data=json.dumps(data).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=120) as response:
        result = json.load(response)
        print(f'HTTP_{response.status} {path}')
        return result

password = Path('/home/ubuntu/mercadinhosys/infra/oracle/.admin.env').read_text().strip().split('=',1)[1]
admin = request('/auth/login', {'username':'maldivas','password':password})
insight = request('/consultor/insights', {'especialista':'geral'}, admin['access_token'], 'all')
assert insight.get('insights'), insight.get('aviso')
assert insight.get('provider') == 'deepseek'
print('GLOBAL_RAG_OK fontes=' + ','.join(insight['fontes']))
print(insight['insights'])

demo_password = os.environ.get('VERIFY_DEMO_PASSWORD')
if not demo_password:
    raise SystemExit('Configure VERIFY_DEMO_PASSWORD; não há senha padrão no script.')
demo = request('/auth/login', {'username': os.environ.get('VERIFY_DEMO_USERNAME', 'admin1'), 'password': demo_password})
chat = request('/consultor/chat', {'especialista':'geral','mensagem':'Qual é a quantidade de produtos ativos desta loja? Cite a fonte, sem inventar valores.'}, demo['access_token'], 3)
assert chat.get('success') and chat.get('resposta')
assert chat.get('provider') == 'deepseek' and 'estoque' in chat.get('fontes', [])
print('TENANT_RAG_OK fontes=' + ','.join(chat['fontes']))
print(chat['resposta'])
