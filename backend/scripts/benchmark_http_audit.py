"""Measure the isolated HTTP service; never target the published database.

Run inside mercadinhosys-http-audit. Seed credentials only, no token output.
"""
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
import requests

BASE = 'http://127.0.0.1:5000'
login = requests.post(BASE + '/api/auth/login', json={'username': 'admin1', 'password': 'admin123'}, timeout=30)
if login.status_code != 200:
    raise SystemExit(f'Seed login failed: HTTP {login.status_code}')
body = login.json()
token = body.get('access_token') or body.get('data', {}).get('access_token')
if not token:
    raise SystemExit('Seed login did not return an access token')
headers = {'Authorization': 'Bearer ' + token}
listing = requests.get(BASE + '/api/produtos/?por_pagina=20', headers=headers, timeout=30)
if listing.status_code != 200:
    raise SystemExit(f'Product lookup failed: HTTP {listing.status_code}')
data = listing.json()
products = data.get('produtos', data.get('data', []))
if isinstance(products, dict):
    products = products.get('produtos', products.get('items', []))
if not isinstance(products, list) or not products:
    raise SystemExit('Seed product list is empty or has unexpected format')
barcode = next((str(product['codigo_barras']) for product in products if product.get('codigo_barras')), None)
if not barcode:
    raise SystemExit('No seed barcode found')
results = []
for path in ('/api/produtos/?por_pagina=20', '/api/pdv/buscar-produtos?q=' + quote(barcode)):
    for concurrency in (1, 4, 8):
        def sample(_):
            start = time.perf_counter()
            try:
                response = requests.get(BASE + path, headers=headers, timeout=30)
                return (time.perf_counter() - start) * 1000, response.status_code
            except requests.RequestException:
                return (time.perf_counter() - start) * 1000, 0
        for _ in range(3):
            sample(0)
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            samples = list(executor.map(sample, range(100)))
        elapsed = time.perf_counter() - start
        times = sorted(sample[0] for sample in samples)
        statuses = {str(status): sum(value == status for _, value in samples) for _, status in samples}
        result = {'route': path.split('?')[0], 'concurrency': concurrency, 'samples': len(samples),
                  'p95_ms': round(times[math.ceil(len(times) * .95)-1], 2),
                  'p99_ms': round(times[math.ceil(len(times) * .99)-1], 2),
                  'requests_per_second': round(len(samples) / elapsed, 2),
                  'errors': sum(status != 200 for _, status in samples), 'statuses': statuses}
        results.append(result)
        print(json.dumps(result), flush=True)
with open('/app/audit-http-output.json', 'w') as output:
    json.dump({'transport': 'HTTP loopback/Gunicorn, PostgreSQL restored seed, Redis db3',
               'external_network_tls': False, 'results': results}, output, indent=2)
