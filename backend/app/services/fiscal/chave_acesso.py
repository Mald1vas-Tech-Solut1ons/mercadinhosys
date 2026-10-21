"""
Chave de acesso de NF-e (modelo 55) e NFC-e (modelo 65).

Leitura da chave a partir do que o operador tem na mão:
- código de barras do DANFE (Code-128 com os 44 dígitos, ou digitado em blocos de 4);
- QR Code da NFC-e: URL da SEFAZ com o parâmetro ``p=`` (versão 2, ``chave|versão|...``)
  ou ``chNFe=`` (versão 1).

Layout (Manual de Orientação do Contribuinte, 44 dígitos):
  cUF(2) AAMM(4) CNPJ/CPF(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)

O dígito verificador é o módulo 11 com pesos 2..9 aplicados da direita para a
esquerda sobre os 43 primeiros dígitos; resto 0 ou 1 → DV 0.

Este módulo só VALIDA e DECOMPÕE a chave. Baixar o XML na SEFAZ a partir da
chave (NFeDistribuicaoDFe / manifestação do destinatário) exige certificado
digital A1 do CNPJ destinatário — não é feito aqui (ver rota de consulta).
"""
from __future__ import annotations

import re
from typing import Dict, Optional
from urllib.parse import parse_qs, urlparse

# Códigos IBGE das UFs usados na chave.
UF_POR_CODIGO = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
    "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
    "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
}
MODELOS = {"55": "NF-e", "65": "NFC-e"}


class ChaveInvalida(ValueError):
    pass


def digito_verificador(base43: str) -> str:
    soma, peso = 0, 2
    for d in reversed(base43):
        soma += int(d) * peso
        peso = 2 if peso == 9 else peso + 1
    resto = soma % 11
    return "0" if resto < 2 else str(11 - resto)


def extrair_chave(texto: str) -> Optional[str]:
    """Extrai os 44 dígitos do texto lido (código de barras, QR Code ou digitação).

    Retorna None quando não encontra 44 dígitos; não valida o DV (ver ``validar``).
    """
    texto = (texto or "").strip()
    if not texto:
        return None
    if "://" in texto or "?" in texto:
        try:
            qs = parse_qs(urlparse(texto).query)
        except ValueError:
            qs = {}
        for chave_param in ("p", "chNFe", "chnfe"):
            for valor in qs.get(chave_param, []):
                # QR v2: p=<chave>|<versão>|<ambiente>|...
                digitos = re.sub(r"\D", "", valor.split("|", 1)[0])
                if len(digitos) == 44:
                    return digitos
        corrida = re.search(r"(?<!\d)\d{44}(?!\d)", texto)
        return corrida.group(0) if corrida else None
    digitos = re.sub(r"[\s.\-/]", "", texto)
    return digitos if len(digitos) == 44 and digitos.isdigit() else None


def validar(chave: str) -> Dict[str, str]:
    """Valida a chave (tamanho, DV módulo 11, UF e modelo) e devolve seus campos."""
    chave = re.sub(r"\s", "", chave or "")
    if len(chave) != 44 or not chave.isdigit():
        raise ChaveInvalida("A chave de acesso deve ter 44 dígitos.")
    if digito_verificador(chave[:43]) != chave[43]:
        raise ChaveInvalida("Dígito verificador da chave não confere. Confira a leitura ou digitação.")
    cuf, modelo = chave[0:2], chave[20:22]
    if cuf not in UF_POR_CODIGO:
        raise ChaveInvalida("Código de UF da chave inválido.")
    if modelo not in MODELOS:
        raise ChaveInvalida("Modelo do documento inválido (esperado 55 NF-e ou 65 NFC-e).")
    mes = int(chave[4:6])
    if not 1 <= mes <= 12:
        raise ChaveInvalida("Mês de emissão da chave inválido.")
    return {
        "chave_acesso": chave,
        "uf": UF_POR_CODIGO[cuf],
        "codigo_uf": cuf,
        "ano_mes": f"20{chave[2:4]}-{chave[4:6]}",
        "cnpj_emitente": chave[6:20],
        "modelo": modelo,
        "modelo_descricao": MODELOS[modelo],
        "serie": str(int(chave[22:25])),
        "numero": str(int(chave[25:34])),
        "tipo_emissao": chave[34],
    }
