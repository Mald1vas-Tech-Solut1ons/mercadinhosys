"""BigDataCorp (Plataforma de Dados, API de Produtos): ficha do produto por EAN.

Contrato (Anexo I): as primeiras 500 consultas de cada serviço por mês-calendário são grátis.
O contador fica no banco (ConsumoApiExterna) e a vaga é reservada ANTES da chamada; ao chegar
no limite a BigDataCorp é pulada até virar o mês, então a franquia nunca é ultrapassada.

Credenciais só do ambiente: API_BIG_DATA_CORP (AccessToken, JWT gerado no BDC Center) e
API_BIG_DATA_CORP_TOKEN_ID (o "Token Id" da mesma linha no BDC Center, não é o jti do JWT).
"""
import os
import unicodedata

import requests
from flask import current_app
from sqlalchemy.exc import IntegrityError

from app.models import db, ConsumoApiExterna
from app.utils.timezone import hoje_local

PROVEDOR = "bigdatacorp"
URL_PRODUTOS = "https://plataforma.bigdatacorp.com.br/produtos"
DATASET = "extra_info_data"  # Ficha Técnica: marca, tipo, sabor, volume, NCM quando a loja informa


def limite_mensal() -> int:
    try:
        return max(0, int(os.environ.get("BIGDATACORP_LIMITE_MENSAL", "500")))
    except ValueError:
        return 500


def configurado() -> bool:
    return bool(os.environ.get("API_BIG_DATA_CORP", "").strip()
                and os.environ.get("API_BIG_DATA_CORP_TOKEN_ID", "").strip())


def _mes_atual() -> str:
    return hoje_local().strftime("%Y-%m")


def consumo_do_mes() -> dict:
    linha = ConsumoApiExterna.query.filter_by(provedor=PROVEDOR, mes=_mes_atual()).first()
    usadas = linha.consultas if linha else 0
    return {"provedor": PROVEDOR, "mes": _mes_atual(), "consultas": usadas,
            "encontrados": linha.encontrados if linha else 0,
            "limite": limite_mensal(), "restantes": max(0, limite_mensal() - usadas),
            "configurado": configurado()}


def reservar_consulta() -> bool:
    """Reserva 1 consulta do mês com trava de linha; False quando a franquia acabou."""
    mes, limite = _mes_atual(), limite_mensal()
    for _ in range(2):
        linha = (ConsumoApiExterna.query.filter_by(provedor=PROVEDOR, mes=mes)
                 .with_for_update().first())
        if linha is None:
            try:
                linha = ConsumoApiExterna(provedor=PROVEDOR, mes=mes, consultas=0, encontrados=0)
                db.session.add(linha)
                db.session.flush()
            except IntegrityError:  # outra loja criou a linha do mês ao mesmo tempo
                db.session.rollback()
                continue
        if linha.consultas >= limite:
            db.session.commit()
            return False
        linha.consultas += 1
        db.session.commit()  # solta a trava antes da chamada externa
        return True
    return False


def registrar_encontrado():
    linha = ConsumoApiExterna.query.filter_by(provedor=PROVEDOR, mes=_mes_atual()).with_for_update().first()
    if linha:
        linha.encontrados += 1


def _chave(texto) -> str:
    sem_acento = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode()
    return " ".join(sem_acento.upper().split())


def _primeiro(atributos: list, *chaves):
    for attrs in atributos:
        for chave in chaves:
            valor = str(attrs.get(chave) or "").strip()
            if valor:
                return valor
    return ""


def mapear(resultado: dict) -> dict:
    """Monta nome/marca/categoria/NCM a partir dos atributos de todas as lojas de origem.

    A API não devolve um nome pronto: o nome é "tipo + marca + sabor + volume"
    (ex.: "Refrigerante Coca-Cola Cola Original 2 L"). Sem tipo e sem marca, não há nome.
    """
    fontes = ((resultado.get("ExtraInfoData") or {}).get("ExtraInfoPerSource") or {}).values()
    atributos = [{_chave(k): v for k, v in ((f or {}).get("UncategorizedExtraInfo") or {}).items()}
                 for f in fontes]
    # Loja com mais atributos primeiro: costuma ser a ficha mais completa.
    atributos.sort(key=len, reverse=True)
    tipo = _primeiro(atributos, "NOME PRINCIPAL DO ITEM", "TIPO DE PRODUTO", "TIPO", "PRODUTO")
    marca = _primeiro(atributos, "MARCA", "FABRICANTE")
    sabor = _primeiro(atributos, "SABOR", "FRAGRANCIA", "AROMA", "VARIACAO")
    volume = _primeiro(atributos, "VOLUME", "PESO LIQUIDO", "CONTEUDO")
    if not volume:
        quantidade = _primeiro(atributos, "CONTEUDO LIQUIDO")
        unidade = _primeiro(atributos, "UNID CONTEUDO LIQUIDO", "UNID CONT LIQUIDO")
        volume = f"{quantidade} {unidade}".strip() if quantidade else ""
    partes, vistos = [], set()
    for parte in (tipo, marca, sabor, volume):
        if parte and _chave(parte) not in vistos:
            partes.append(parte)
            vistos.add(_chave(parte))
    ncm = "".join(c for c in _primeiro(atributos, "NCM", "CODIGO NCM") if c.isdigit())[:8]
    return {
        "nome": " ".join(partes)[:200] if (tipo or marca) else "",
        "marca": marca[:100] or None,
        "categoria": tipo[:60] or None,
        "ncm": ncm or None,
    }


def consultar_ean(ean: str):
    """Devolve ``(motivo, resultado|None)``.

    motivo: 'encontrado' | 'nao_encontrado' | 'sem_cota' | 'nao_configurado' | 'erro'.
    A vaga do mês é gasta antes da chamada, inclusive em erro (conta conservadora).
    """
    if not configurado():
        return "nao_configurado", None
    if not reservar_consulta():
        return "sem_cota", None
    headers = {
        "AccessToken": os.environ["API_BIG_DATA_CORP"].strip(),
        "TokenId": os.environ["API_BIG_DATA_CORP_TOKEN_ID"].strip(),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        resp = requests.post(URL_PRODUTOS, json={"Datasets": DATASET, "q": f"ean{{{ean}}}", "Limit": 1},
                             headers=headers, timeout=8)
        dados = resp.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        current_app.logger.warning(f"BigDataCorp sem resposta para {ean}: {e}")
        return "erro", None
    status = dados.get("Status") or {}
    erros_login = [s for s in (status.get("login") or []) if s.get("Code") not in (0, None)]
    if erros_login:
        current_app.logger.error(f"BigDataCorp recusou o acesso: {erros_login[0].get('Message')}")
        return "erro", None
    resultado = (dados.get("Result") or [None])[0]
    if not resultado:
        return "nao_encontrado", None
    return "encontrado", resultado
