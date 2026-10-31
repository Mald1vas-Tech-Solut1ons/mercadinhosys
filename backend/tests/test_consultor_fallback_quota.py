"""Consultor: o que não pode quebrar é a entrega (fallback) e o dia da cota.

1. llm_client tentava UM provedor: se a DeepSeek devolvesse 5xx o lojista lia
   "não foi possível gerar o resumo" — sem ter nada a ver com o provedor.
2. A cota do dia era contada no dia UTC: em Brasília ela virava às 21h e o
   lojista perdia a noite inteira de consultas.
"""
from datetime import datetime, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.services.consultor import quota as quota_mod
from app.utils import llm_client


class _Resposta:
    def __init__(self, status=200, conteudo="ok", usage=None):
        self.status_code = status
        self._conteudo = conteudo
        self.headers = {}
        self._usage = usage or {"prompt_tokens": 1, "completion_tokens": 1}

    def json(self):
        return {"choices": [{"message": {"content": self._conteudo}}], "usage": self._usage}


def test_fallback_usa_o_outro_provedor_quando_o_primeiro_falha(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API", "chave-deepseek")
    monkeypatch.setenv("GROQ_API_KEY", "chave-groq")
    chamadas = []

    def post(url, **kwargs):
        chamadas.append(url)
        if "deepseek" in url:
            return _Resposta(status=503)
        return _Resposta(conteudo="resumo gerado pelo groq")

    monkeypatch.setattr(llm_client.requests, "post", post)

    texto = llm_client.gerar_resposta([{"role": "user", "content": "oi"}], provider="deepseek")

    assert texto == "resumo gerado pelo groq"
    assert len(chamadas) == 2, "um provedor por tentativa, sem retry do mesmo"
    assert "deepseek" in chamadas[0] and "groq" in chamadas[1]


def test_sem_chave_no_fallback_nao_quebra(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API", "chave-deepseek")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(llm_client.requests, "post", lambda url, **k: _Resposta(status=500))

    assert llm_client.gerar_resposta([{"role": "user", "content": "oi"}]) is None


def test_ordem_de_tentativa_respeita_o_provedor_pedido():
    assert llm_client._providers_para("deepseek")[0] == "deepseek"
    assert llm_client._providers_para("groq")[0] == "groq"
    assert set(llm_client._providers_para("deepseek")) == set(llm_client.PROVIDERS)


def test_cota_comeca_a_meia_noite_de_brasilia():
    inicio = quota_mod._inicio_dia_local_em_utc()
    agora_local = datetime.now(ZoneInfo("America/Sao_Paulo"))
    esperado_local = agora_local.replace(hour=0, minute=0, second=0, microsecond=0)
    esperado_utc = esperado_local.astimezone(timezone.utc).replace(tzinfo=None)

    assert inicio == esperado_utc
    # 00:00 em Brasília é 03:00 UTC (UTC-3, sem horário de verão desde 2019)
    assert inicio.hour == 3
