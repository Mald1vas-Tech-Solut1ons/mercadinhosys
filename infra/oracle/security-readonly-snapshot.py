"""Inventário agregado; não imprime credenciais nem dados pessoais."""
import json
import subprocess

def docker(*args):
    return subprocess.run(['sudo', 'docker', *args], check=True, text=True, capture_output=True).stdout

environment = json.loads(docker('inspect', 'oracle-backend-1'))[0]['Config']['Env']
settings = dict(pair.split('=', 1) for pair in environment if '=' in pair)
sql = """SELECT json_build_object(
 'stores', (SELECT json_agg(x) FROM (SELECT estabelecimento_id, count(*) AS products FROM produtos WHERE deleted_at IS NULL AND ativo GROUP BY estabelecimento_id ORDER BY estabelecimento_id) x),
 'pool_connections', (SELECT count(*) FROM pg_stat_activity),
 'max_connections', current_setting('max_connections'),
 'offline_unique_constraint', EXISTS(SELECT 1 FROM pg_constraint WHERE conname='uq_venda_estab_offline_uuid'),
 'fiscal', (SELECT json_agg(x) FROM (SELECT coalesce(fiscal_gateway,'simulado') AS gateway, coalesce(fiscal_ambiente,'homologacao') AS environment, count(*) AS stores, count(*) FILTER (WHERE fiscal_token IS NOT NULL AND fiscal_token <> '') AS configured_tokens FROM estabelecimentos GROUP BY 1,2) x))"""
result = json.loads(docker('exec', 'oracle-postgres-1', 'psql', '-U', 'mercadinho_user', '-d', 'mercadinhosys', '-tAc', sql))
result['backend'] = {key: settings.get(key) for key in ('DB_POOL_SIZE', 'DB_MAX_OVERFLOW', 'WEB_CONCURRENCY', 'GUNICORN_THREADS')}
result['backend']['redis_cache_configured'] = bool(settings.get('REDIS_URL'))
info = docker('exec', 'oracle-redis-1', 'redis-cli', 'INFO')
wanted = {'keyspace_hits', 'keyspace_misses', 'evicted_keys', 'used_memory', 'maxmemory', 'maxmemory_policy', 'connected_clients'}
result['redis'] = {key: value.strip() for row in info.splitlines() if ':' in row for key, value in [row.split(':', 1)] if key in wanted}
print(json.dumps(result, indent=2))
