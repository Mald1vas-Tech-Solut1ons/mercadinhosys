"""Converte a resposta do LLM dos insights numa lista segura para a tela.

O LLM às vezes devolve o JSON cortado (teto de tokens) ou embrulhado em markdown.
Antes, qualquer falha de `json.loads` mandava o texto cru — colchetes, chaves e frase
cortada — direto para o lojista. Regra agora: a tela só recebe itens completos.
"""
from __future__ import annotations

import json
import re
from typing import Any

TIPOS = {"excecao", "risco", "oportunidade"}


def _objetos_completos(texto: str) -> list[dict[str, Any]]:
    """Extrai, em ordem, cada objeto JSON de topo que esteja fechado dentro de um array."""
    inicio = texto.find("[")
    if inicio < 0:
        return []
    decoder = json.JSONDecoder()
    itens: list[dict[str, Any]] = []
    i = inicio + 1
    n = len(texto)
    while i < n:
        while i < n and texto[i] in " \t\r\n,":
            i += 1
        if i >= n or texto[i] != "{":
            break
        try:
            obj, fim = decoder.raw_decode(texto, i)
        except json.JSONDecodeError:
            break  # objeto cortado: descarta ele e o que vier depois
        if isinstance(obj, dict):
            itens.append(obj)
        i = fim
    return itens


def _texto_limpo(valor: Any) -> str:
    if valor is None:
        return ""
    texto = str(valor).strip()
    # Tags de fonte ("[geral]", "[estoque]") são para auditoria, não para o lojista.
    texto = re.sub(r"\s*\[(geral|financeiro|vendas|estoque|compras|rh|clientes|auditoria|sistema|fornecedores)\]", "", texto)
    return re.sub(r"\s{2,}", " ", texto).strip()


def para_exibir(resposta: Any) -> list[dict[str, Any]] | str | None:
    """O que pode ir para a tela: itens completos, texto simples limpo, ou None.

    Texto simples (formato antigo, uma linha por insight) continua válido. Resposta com
    cara de JSON que não deu para aproveitar vira None: nunca chega crua ao lojista.
    """
    itens = normalizar_insights(resposta)
    if itens:
        return itens
    if isinstance(resposta, str):
        txt = resposta.strip()
        if txt and not txt.startswith(("[", "{", "`")):
            linhas = [_texto_limpo(linha) for linha in txt.splitlines()]
            return "\n".join(linha for linha in linhas if linha) or None
    return None


def normalizar_insights(resposta: Any) -> list[dict[str, Any]] | None:
    """Lista de {tipo, texto, acao?} só com itens completos; None se nada aproveitável."""
    if isinstance(resposta, list):
        brutos = resposta
    elif isinstance(resposta, str):
        txt = resposta.strip()
        if txt.startswith("```"):
            txt = re.sub(r"^```[a-zA-Z]*\s*", "", txt)
            txt = re.sub(r"```\s*$", "", txt)
        try:
            parsed = json.loads(txt)
            brutos = parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            brutos = _objetos_completos(txt)
    else:
        return None

    itens: list[dict[str, Any]] = []
    for b in brutos:
        if not isinstance(b, dict):
            continue
        texto = _texto_limpo(b.get("texto"))
        if not texto:
            continue
        item: dict[str, Any] = {"tipo": b.get("tipo") if b.get("tipo") in TIPOS else "excecao", "texto": texto}
        acao = b.get("acao")
        if isinstance(acao, dict) and acao.get("tipo"):
            item["acao"] = {"tipo": str(acao["tipo"]), "payload": acao.get("payload") or {}}
        itens.append(item)
    return itens or None
