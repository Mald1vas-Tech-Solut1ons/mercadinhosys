"""DeepSeek para RAG e Groq para textos curtos; sem chamadas duplicadas."""
import logging
import os
import requests

logger = logging.getLogger(__name__)
PROVIDERS = {'deepseek': {'url': 'https://api.deepseek.com/chat/completions',
                         'key_env': 'DEEPSEEK_API', 'model_env': 'DEEPSEEK_MODEL',
                         'model_default': 'deepseek-flash'},
             'groq': {'url':'https://api.groq.com/openai/v1/chat/completions',
                      'key_env':'GROQ_API_KEY', 'model_env':'GROQ_MODEL',
                      'model_default':'openai/gpt-oss-20b'}}
TIMEOUT_SEGUNDOS = 45

def llm_disponivel(provider='deepseek') -> bool:
    config = PROVIDERS.get(provider, PROVIDERS['deepseek'])
    return bool(os.getenv(config['key_env'], '').strip())

def gerar_resposta(messages: list[dict], provider: str = 'deepseek',
                   max_tokens: int = 1024, temperature: float = 0.2) -> str | None:
    """O servidor escolhe o provedor pela tarefa; Gemini legado vira DeepSeek.

    Não registra chave, prompt ou conteúdo recebido. Não repete chamadas pagas
    automaticamente. Em falha, o chamador mantém seu fallback de interface.
    """
    provider = provider if provider in PROVIDERS else 'deepseek'
    config = PROVIDERS[provider]
    if not llm_disponivel(provider):
        return None
    try:
        configured_limit = int(os.getenv('DEEPSEEK_MAX_TOKENS', '1024'))
        limit = max(64, min(int(max_tokens), configured_limit, 2048))
        payload = {'model': os.getenv(config['model_env']) or config['model_default'],
                   'messages': messages, 'max_tokens': limit,
                   'temperature': temperature, 'stream': False}
        if provider == 'deepseek':
            payload['thinking'] = {'type':'disabled'}
        elif 'gpt-oss' in payload['model']:
            payload['reasoning_effort'] = 'low'
        response = requests.post(
            config['url'],
            headers={'Authorization': 'Bearer ' + os.environ[config['key_env']].strip(),
                     'Content-Type': 'application/json'},
            json=payload,
            timeout=TIMEOUT_SEGUNDOS,
        )
        if response.status_code != 200:
            logger.warning('LLM %s indisponível: HTTP %s', provider, response.status_code)
            return None
        data = response.json()
        if provider == 'groq':
            logger.info('Groq limites: requests_dia=%s tokens_minuto=%s',
                        response.headers.get('x-ratelimit-limit-requests'),
                        response.headers.get('x-ratelimit-limit-tokens'))
        content = data.get('choices', [{}])[0].get('message', {}).get('content')
        usage = data.get('usage', {})
        logger.info('LLM %s uso: input=%s output=%s', provider,
                    usage.get('prompt_tokens'), usage.get('completion_tokens'))
        return content.strip() if isinstance(content, str) and content.strip() else None
    except (requests.RequestException, ValueError, TypeError, IndexError, KeyError):
        logger.warning('LLM %s: falha de rede ou resposta inválida; sem fallback externo.', provider)
        return None
