"""
Parser de XML de NF-e de entrada (compra) — modelo 55.

Lê o XML que o FORNECEDOR emitiu (nfeProc/NFe) e extrai os dados necessários
para dar entrada no estoque, cadastrar/atualizar produtos, vincular o fornecedor
e gerar contas a pagar. Não depende de bibliotecas externas (usa xml.etree).

Não emite nada na SEFAZ nem exige certificado: é só leitura do documento já
autorizado pelo fornecedor.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional


class XMLNotaError(ValueError):
    """Erro de XML inválido ou não suportado."""


def _strip_ns(tag: str) -> str:
    """Remove o namespace de uma tag: '{http://...}NFe' -> 'NFe'."""
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _localname_tree(root: ET.Element) -> ET.Element:
    """Reescreve as tags do elemento (e filhos) sem namespace, para navegação simples."""
    for el in root.iter():
        el.tag = _strip_ns(el.tag)
    return root


def _find(el: Optional[ET.Element], path: str) -> Optional[ET.Element]:
    return el.find(path) if el is not None else None


def _text(el: Optional[ET.Element], path: str, default: Optional[str] = None) -> Optional[str]:
    node = _find(el, path)
    if node is None or node.text is None:
        return default
    return node.text.strip()


def _dec(value: Optional[str], default: str = "0") -> Decimal:
    if value is None or str(value).strip() == "":
        value = default
    try:
        return Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        return Decimal(default)


def _only_digits(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def parse_nfe_xml(xml_bytes: bytes | str) -> Dict[str, Any]:
    """
    Faz o parsing de um XML de NF-e (modelo 55) e retorna um dicionário normalizado.

    Estrutura retornada:
        {
          "chave_acesso": "<44 dígitos>",
          "modelo": "55", "numero": "123", "serie": "1",
          "data_emissao": "2024-...",
          "natureza_operacao": "...",
          "emitente": {"cnpj","nome","fantasia","ie","uf","municipio"},
          "destinatario": {"cnpj","nome"},
          "itens": [{"codigo","ean","descricao","ncm","cfop","cest","unidade",
                     "quantidade": Decimal, "valor_unitario": Decimal,
                     "valor_total": Decimal}],
          "total": Decimal,
          "duplicatas": [{"numero","vencimento","valor": Decimal}],
        }

    Lança XMLNotaError se o XML não for uma NF-e válida.
    """
    if isinstance(xml_bytes, str):
        xml_bytes = xml_bytes.encode("utf-8")
    if len(xml_bytes) > 5 * 1024 * 1024:
        raise XMLNotaError('XML excede o limite de 5MB')
    declarations = xml_bytes.replace(b'\x00', b'').upper()
    if b'<!DOCTYPE' in declarations or b'<!ENTITY' in declarations:
        raise XMLNotaError('Declarações DTD e entidades não são permitidas')
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        raise XMLNotaError(f"XML inválido: {e}") from e

    _localname_tree(root)

    # Aceita tanto <nfeProc> quanto <NFe> na raiz
    nfe = root if root.tag == "NFe" else root.find("NFe")
    if nfe is None:
        raise XMLNotaError("XML não contém uma NF-e (elemento <NFe> não encontrado).")

    inf = nfe.find("infNFe")
    if inf is None:
        raise XMLNotaError("NF-e sem <infNFe>.")

    # Chave de acesso: atributo Id = 'NFe<44 dígitos>'
    chave = _only_digits(inf.get("Id"))
    if len(chave) != 44:
        # fallback: protNFe/infProt/chNFe
        chave = _only_digits(_text(root, ".//chNFe") or "")
    if len(chave) != 44:
        raise XMLNotaError("Chave de acesso ausente ou inválida (esperado 44 dígitos).")

    ide = inf.find("ide")
    emit = inf.find("emit")
    dest = inf.find("dest")

    emitente = {
        "cnpj": _only_digits(_text(emit, "CNPJ") or _text(emit, "CPF")),
        "nome": _text(emit, "xNome"),
        "fantasia": _text(emit, "xFant"),
        "ie": _text(emit, "IE"),
        "uf": _text(emit, "enderEmit/UF"),
        "municipio": _text(emit, "enderEmit/xMun"),
        "telefone": _text(emit, "enderEmit/fone"),
        "cep": _only_digits(_text(emit, "enderEmit/CEP")),
        "logradouro": _text(emit, "enderEmit/xLgr"),
        "numero": _text(emit, "enderEmit/nro"),
        "bairro": _text(emit, "enderEmit/xBairro"),
    }

    destinatario = {
        "cnpj": _only_digits(_text(dest, "CNPJ") or _text(dest, "CPF")),
        "nome": _text(dest, "xNome"),
    }

    itens: List[Dict[str, Any]] = []
    for det in inf.findall("det"):
        prod = det.find("prod")
        if prod is None:
            continue
        ean = _text(prod, "cEAN") or ""
        if ean.upper() in ("SEM GTIN", "SEMGTIN"):
            ean = ""
        itens.append({
            "codigo": _text(prod, "cProd"),
            "ean": _only_digits(ean) or None,
            "descricao": _text(prod, "xProd"),
            "ncm": _text(prod, "NCM"),
            "cest": _text(prod, "CEST"),
            "cfop": _text(prod, "CFOP"),
            "unidade": _text(prod, "uCom"),
            "quantidade": _dec(_text(prod, "qCom")),
            "valor_unitario": _dec(_text(prod, "vUnCom")),
            "valor_total": _dec(_text(prod, "vProd")),
        })

    if not itens:
        raise XMLNotaError("NF-e sem itens (<det>/<prod>).")

    total = _dec(_text(inf, "total/ICMSTot/vNF") or _text(inf, "total/ICMSTot/vProd"))

    duplicatas = []
    cobr = inf.find("cobr")
    if cobr is not None:
        for dup in cobr.findall("dup"):
            duplicatas.append({
                "numero": _text(dup, "nDup"),
                "vencimento": _text(dup, "dVenc"),
                "valor": _dec(_text(dup, "vDup")),
            })

    return {
        "chave_acesso": chave,
        "modelo": _text(ide, "mod", "55"),
        "numero": _text(ide, "nNF"),
        "serie": _text(ide, "serie"),
        "data_emissao": _text(ide, "dhEmi") or _text(ide, "dEmi"),
        "natureza_operacao": _text(ide, "natOp"),
        "emitente": emitente,
        "destinatario": destinatario,
        "itens": itens,
        "total": total,
        "duplicatas": duplicatas,
    }
