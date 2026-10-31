"""DeepSeek para RAG e Groq para textos curtos; com fallback real entre provedores e telemetria de uso."""
import logging
import os
import requests

logger = logging.getLogger(__name__)
PROVIDERS = {
    'deepseek': {
        'url': 'https://api.deepseek.com/chat/completions',
        'key_env': 'DEEPSEEK_API',
        'model_env': 'DEEPSEEK_MODEL',
        'model_default': 'deepseek-flash',
        # Preços de referência por 1M tokens (USD) para estimativa de custo de operação
        'input_per_1m': 0.14,
        'output_per_1m': 0.28,
    },
    'groq': {
        'url': 'https://api.groq.com/openai/v1/chat/completions',
        'key_env': 'GROQ_API_KEY',
        'model_env': 'GROQ_MODEL',
        'model_default': 'openai/gpt-oss-20b',
        'input_per_1m': 0.10,
        'output_per_1m': 0.30,
    },
}
TIMEOUT_SEGUNDOS = 45


def llm_disponivel(provider='deepseek') -> bool:
    config = PROVIDERS.get(provider, PROVIDERS['deepseek'])
    if bool(os.getenv(config['key_env'], '').strip()):
        return True
    # Se o provedor pedido não tiver chave, mas o fallback tiver, a IA está disponível
    return any(bool(os.getenv(cfg['key_env'], '').strip()) for cfg in PROVIDERS.values())


def _provider_configurado(provider: str) -> bool:
    config = PROVIDERS.get(provider)
    if not config:
        return False
    return bool(os.getenv(config['key_env'], '').strip())


def _providers_para(provider: str) -> list[str]:
    """Ordem de tentativa: o pedido primeiro, o outro configurado depois.

    O Consultor pede DeepSeek. Se a DeepSeek cair (5xx, timeout, chave inválida),
    o lojista não pode ler "não foi possível gerar" — ele não tem nada a ver com
    a disponibilidade do provedor.
    """
    pedido = provider if provider in PROVIDERS else 'deepseek'
    return [pedido] + [nome for nome in PROVIDERS if nome != pedido]


def _estimar_custo_usd(provider: str, prompt_tokens: int, completion_tokens: int) -> float:
    config = PROVIDERS.get(provider, PROVIDERS['deepseek'])
    custo_in = (max(0, int(prompt_tokens or 0)) / 1_000_000) * float(config.get('input_per_1m', 0.14))
    custo_out = (max(0, int(completion_tokens or 0)) / 1_000_000) * float(config.get('output_per_1m', 0.28))
    return round(custo_in + custo_out, 6)


def _chamar_provider_detalhado(provider: str, messages: list[dict], max_tokens: int,
                               temperature: float) -> dict | None:
    config = PROVIDERS[provider]
    if not _provider_configurado(provider):
        return None
    try:
        configured_limit = int(os.getenv('DEEPSEEK_MAX_TOKENS', '1024'))
        limit = max(64, min(int(max_tokens), configured_limit, 2048))
        payload = {
            'model': os.getenv(config['model_env']) or config['model_default'],
            'messages': messages,
            'max_tokens': limit,
            'temperature': temperature,
            'stream': False,
        }
        if provider == 'deepseek':
            payload['thinking'] = {'type': 'disabled'}
        elif 'gpt-oss' in payload['model']:
            payload['reasoning_effort'] = 'low'
        response = requests.post(
            config['url'],
            headers={
                'Authorization': 'Bearer ' + os.environ[config['key_env']].strip(),
                'Content-Type': 'application/json',
            },
            json=payload,
            timeout=TIMEOUT_SEGUNDOS,
        )
        if response.status_code != 200:
            logger.warning('LLM %s indisponível: HTTP %s', provider, response.status_code)
            return None
        data = response.json()
        if provider == 'groq':
            logger.info(
                'Groq limites: requests_dia=%s tokens_minuto=%s',
                response.headers.get('x-ratelimit-limit-requests'),
                response.headers.get('x-ratelimit-limit-tokens'),
            )
        content = data.get('choices', [{}])[0].get('message', {}).get('content')
        usage = data.get('usage') or {}
        prompt_tokens = int(usage.get('prompt_tokens') or 0)
        completion_tokens = int(usage.get('completion_tokens') or 0)
        logger.info('LLM %s uso: input=%s output=%s', provider, prompt_tokens, completion_tokens)
        if not isinstance(content, str) or not content.strip():
            return None
        return {
            'texto': content.strip(),
            'provider': provider,
            'prompt_tokens': prompt_tokens,
            'completion_tokens': completion_tokens,
            'custo_estimado_usd': _estimar_custo_usd(provider, prompt_tokens, completion_tokens),
        }
    except (requests.RequestException, ValueError, TypeError, IndexError, KeyError):
        logger.warning('LLM %s: falha de rede ou resposta inválida.', provider)
        return None


def _chamar_provider(provider: str, messages: list[dict], max_tokens: int,
                     temperature: float) -> str | None:
    detalhe = _chamar_provider_detalhado(provider, messages, max_tokens, temperature)
    return detalhe['texto'] if detalhe else None


def gerar_resposta_com_meta(messages: list[dict], provider: str = 'deepseek',
                            max_tokens: int = 1024, temperature: float = 0.2) -> dict | None:
    """Tenta o provedor pedido e, se falhar, faz fallback para o próximo configurado.

    Devolve dict com: texto, provider (o que realmente respondeu), prompt_tokens,
    completion_tokens e custo_estimado_usd.
    """
    for nome in _providers_para(provider):
        if not _provider_configurado(nome):
            continue
        detalhe = _chamar_provider_detalhado(nome, messages, max_tokens, temperature)
        if detalhe:
            if nome != provider:
                logger.warning('LLM fallback: %s respondeu no lugar de %s', nome, provider)
            return detalhe
    return None


def gerar_resposta(messages: list[dict], provider: str = 'deepseek',
                   max_tokens: int = 1024, temperature: float = 0.2) -> str | None:
    """Compatível com chamadores que esperam apenas o texto da resposta."""
    detalhe = gerar_resposta_com_meta(
        messages, provider=provider, max_tokens=max_tokens, temperature=temperature
    )
    return detalhe['texto'] if detalhe else None
