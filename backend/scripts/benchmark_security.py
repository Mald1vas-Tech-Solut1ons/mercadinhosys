"""Benchmark em banco isolado: SQLite ou AUDIT_DATABASE_URL PostgreSQL.

Execute a partir de backend com o Python das dependências do projeto.
"""
import argparse
import json
import logging
import statistics
import sys
import time
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import conftest  # permite PostgreSQL somente em banco audit_security_* descartável
from app import db
from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto, ProdutoLote
from flask_jwt_extended import create_access_token
from sqlalchemy import event

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--products', type=int, default=5000)
parser.add_argument('--requests', type=int, default=30)
parser.add_argument('--concurrency', default='1')
args = parser.parse_args()
app_generator = conftest.app.__wrapped__()
app = next(app_generator)
session_generator = conftest.session.__wrapped__(app)
session = next(session_generator)
app.config['RATELIMIT_ENABLED'] = False
logging.disable(logging.CRITICAL)
try:
    est = session.query(Estabelecimento).first()
    actor = session.query(Funcionario).first()
    category = CategoriaProduto(estabelecimento_id=est.id, nome='Benchmark')
    session.add(category)
    session.flush()
    session.bulk_insert_mappings(Produto, [{'estabelecimento_id': est.id, 'categoria_id': category.id,
        'nome': f'Produto benchmark {index:06d}', 'codigo_barras': f'{7900000000000 + index}',
        'preco_custo': 5, 'preco_venda': 10, 'quantidade': 100, 'ativo': True}
        for index in range(args.products)])
    session.commit()
    product_ids = [row[0] for row in session.query(Produto.id).all()]
    session.bulk_insert_mappings(ProdutoLote, [{'estabelecimento_id': est.id, 'produto_id': pid,
        'numero_lote': f'BENCH-{pid}-{lot}', 'quantidade': 50, 'quantidade_inicial': 50,
        'preco_custo_unitario': 5, 'data_validade': date(2030, 1, 1 + lot), 'ativo': True}
        for pid in product_ids for lot in range(2)])
    session.commit()
    token = create_access_token(identity=str(actor.id), additional_claims={
        'estabelecimento_id': est.id, 'role': 'ADMIN'})
    client = app.test_client()
    headers = {'Authorization': f'Bearer {token}'}
    report = {'database': db.engine.dialect.name, 'products': args.products, 'lots': args.products * 2,
              'requests_per_route': args.requests, 'transport': 'Flask test client / WSGI direto',
              'pool_size': app.config.get('SQLALCHEMY_ENGINE_OPTIONS', {}).get('pool_size'), 'routes': {}}
    sql_stats = threading.local()
    for path in ('/api/produtos/?por_pagina=20', '/api/pdv/buscar-produtos?q=7900000000010'):
        def count_sql(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith('SELECT') and hasattr(sql_stats, 'queries'):
                sql_stats.queries += 1
        event.listen(db.engine, 'before_cursor_execute', count_sql)
        try:
            def request_once(_):
                with app.app_context():
                    sql_stats.queries = 0
                    start = time.perf_counter()
                    response = app.test_client().get(path, headers=headers)
                    return (time.perf_counter() - start) * 1000, sql_stats.queries, response.status_code
            for concurrency in map(int, args.concurrency.split(',')):
                db.session.remove()
                for _ in range(3):
                    request_once(0)
                start = time.perf_counter()
                with ThreadPoolExecutor(max_workers=concurrency) as executor:
                    samples = list(executor.map(request_once, range(args.requests)))
                duration = time.perf_counter() - start
                ordered = sorted(s[0] for s in samples)
                counts = [s[1] for s in samples]
                errors = sum(s[2] != 200 for s in samples)
                report['routes'][f'{path} [concurrency={concurrency}]'] = {
                    'p50_ms': round(statistics.median(ordered), 2),
                    'p95_ms': round(ordered[math.ceil(len(ordered)*.95)-1], 2),
                    'p99_ms': round(ordered[math.ceil(len(ordered)*.99)-1], 2),
                    'errors': errors, 'error_rate': errors / len(samples),
                    'requests_per_second': round(len(samples)/duration, 2),
                    'selects_median': statistics.median(counts), 'selects_max': max(counts)}
        finally:
            event.remove(db.engine, 'before_cursor_execute', count_sql)
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
finally:
    session_generator.close()
    app_generator.close()
