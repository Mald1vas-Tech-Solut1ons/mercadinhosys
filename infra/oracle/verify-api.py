"""Run on the Oracle host; keep passwords and JWTs out of logs."""
import json
import os
import urllib.request
from pathlib import Path

base = 'http://127.0.0.1:5000/api'
def request(path, data=None, token=None, method=None):
    headers = {'Origin': 'https://mercadinhosys.vercel.app'}
    if data is not None:
        data = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as response:
        body = json.load(response)
        print(f'PASS {path}: HTTP {response.status}; CORS={response.headers.get("Access-Control-Allow-Origin")}')
        return body

health = request('/health')
password = Path('/home/ubuntu/mercadinhosys/infra/oracle/.admin.env').read_text().strip().split('=',1)[1]
login = request('/auth/login', {'username':'maldivas','password':password})
assert login.get('success') is True and login['data']['user']['is_super_admin'] is True
token = login['access_token']
request('/super-admin/health', token=token)
demo_password = os.environ.get('VERIFY_DEMO_PASSWORD')
if not demo_password:
    raise SystemExit('Configure VERIFY_DEMO_PASSWORD; não há senha padrão no script.')
demo = request('/auth/login', {'username': os.environ.get('VERIFY_DEMO_USERNAME', 'admin1'), 'password': demo_password})
assert demo.get('success') is True
request('/produtos/', token=demo['access_token'])
print('VERIFICATION_OK: admin login, demo login, authenticated queries, and CORS.')
