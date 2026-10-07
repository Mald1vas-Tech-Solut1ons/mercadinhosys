"""Consulta limites retornados pelo Groq sem imprimir credenciais.

Os headers demonstram as quotas, não substituem a consulta ao plano no Billing.
"""
import os
import requests

response = requests.post('https://api.groq.com/openai/v1/chat/completions',
    headers={'Authorization': 'Bearer ' + os.environ['GROQ_API_KEY']},
    json={'model': 'openai/gpt-oss-20b', 'messages': [{'role': 'user', 'content': 'Responda apenas OK.'}],
          'max_tokens': 64, 'reasoning_effort': 'low'}, timeout=45)
print('GROQ_HTTP=' + str(response.status_code))
print('REQUESTS_DIA=' + str(response.headers.get('x-ratelimit-limit-requests')))
print('TOKENS_MINUTO=' + str(response.headers.get('x-ratelimit-limit-tokens')))
response.raise_for_status()
