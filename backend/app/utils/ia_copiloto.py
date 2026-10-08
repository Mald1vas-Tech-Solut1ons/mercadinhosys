"""
IA Copiloto — Groq para textos curtos; DeepSeek reservado ao Consultor com RAG.

Uso genérico: qualquer feature do sistema que precise de um texto gerado por
IA (mensagem de cliente, explicação de indicador, resumo diário) passa por
`gerar_texto()`. Sem GROQ_API_KEY configurada, retorna None e quem chamou
decide o fallback (aqui: usar o template fixo) — nunca quebra a tela.
"""
import os
from .llm_client import gerar_resposta, llm_disponivel

def ia_disponivel() -> bool:
    return llm_disponivel('groq')


def gerar_texto(system_prompt: str, user_prompt: str, max_tokens: int = 300) -> str | None:
    """Delega textos curtos para a Groq com o contexto autorizado do chamador.
    Retorna None em qualquer falha (sem chave, rede, erro da API) — o
    chamador deve ter um fallback pronto (nunca deixar a tela sem resposta)."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    return gerar_resposta(messages=messages, provider="groq", max_tokens=max_tokens, temperature=0.2)
