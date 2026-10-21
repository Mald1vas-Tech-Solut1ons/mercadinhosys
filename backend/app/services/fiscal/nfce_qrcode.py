"""
Entrada de estoque pelo QR Code da NFC-e (consulta pública da SEFAZ-SP).

Porte do MiseOn (supabase/functions/nfe-importar-qrcode/{index,parser}.ts).
Quem compra no atacarejo leva o cupom (NFC-e, modelo 65); o QR Code impresso
traz a URL da consulta pública com ``?p=<chave>|<versão>|<ambiente>|<idCSC>|<hash>``.
O hash é um HMAC com o CSC do emitente: sem ele a SEFAZ responde "Hash QR Code
inválido", por isso a chave sozinha não basta e a URL tem que vir inteira.

Não exige certificado digital: é a mesma página que qualquer consumidor abre.

Segurança (SSRF): o servidor só busca URLs cujo host está na lista oficial da
SEFAZ-SP abaixo, em HTTPS, sem usuário/senha/porta na URL e sem seguir redirect
para fora da lista. Resposta limitada em tamanho e tempo.

Limites:
- só SP (o layout da página muda por UF; outras UFs → importar o XML);
- NF-e modelo 55 de fornecedor (DANFE) não tem consulta pública com itens sem
  captcha/certificado → XML que o fornecedor manda por e-mail.
"""
from __future__ import annotations

import html as html_lib
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit, unquote

from app.services.fiscal.chave_acesso import ChaveInvalida, validar as validar_chave

MSG_SO_SP = "Leitura por QR Code disponível para NFC-e de SP. Para outras UFs, importe o XML."

# Hosts oficiais da consulta pública de NFC-e da SEFAZ-SP (produção e homologação).
HOSTS_SEFAZ_SP = frozenset({
    "www.nfce.fazenda.sp.gov.br",
    "nfce.fazenda.sp.gov.br",
    "www.homologacao.nfce.fazenda.sp.gov.br",
    "homologacao.nfce.fazenda.sp.gov.br",
})

TIMEOUT_SEGUNDOS = (5, 15)  # conexão, leitura
TAMANHO_MAXIMO = 3 * 1024 * 1024
MAX_REDIRECTS = 3
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


class QRCodeErro(ValueError):
    """Erro com mensagem pronta para o operador. ``status`` sugere o HTTP."""

    def __init__(self, mensagem: str, status: int = 422):
        super().__init__(mensagem)
        self.status = status


# ───────────────────────── URL ─────────────────────────

def _parametro_p(query: str) -> Optional[str]:
    m = re.search(r"(?:^|&)p=([^&\s]+)", query or "", re.I)
    return unquote(m.group(1)) if m else None


def validar_url_qrcode(url: str) -> Dict[str, Any]:
    """Valida a URL lida do QR Code e devolve ``{"url", "chave", "dados_chave"}``.

    Ordem das checagens: formato → chave → UF (mensagem de "só SP") → host oficial.
    """
    url = (url or "").strip()
    if not url:
        raise QRCodeErro("Informe a URL do QR Code da NFC-e.", 400)
    if len(url) > 2048:
        raise QRCodeErro("URL do QR Code longa demais.", 400)
    try:
        partes = urlsplit(url)
    except ValueError:
        raise QRCodeErro("URL do QR Code inválida.", 400)
    if partes.scheme.lower() not in ("http", "https") or not partes.hostname:
        raise QRCodeErro("O conteúdo lido não é uma URL de consulta da NFC-e. "
                         "Escaneie o QR Code impresso no cupom.", 400)

    p = _parametro_p(partes.query)
    if not p:
        if re.search(r"(?:^|&)chNFe=", partes.query or "", re.I):
            # QR versão 1 (chNFe=...&cHashQRCode=...): layout antigo, fora de uso em SP.
            raise QRCodeErro("QR Code em layout antigo. Importe o XML da nota.", 422)
        raise QRCodeErro(
            "Esse endereço é o da consulta impressa no cupom, não o conteúdo do QR Code. "
            "O QR Code guarda uma URL com \"?p=\" seguida da chave e do código de segurança. "
            "Escaneie o QR pela câmera ou pela foto do cupom.", 422)
    campos = p.split("|")
    chave = re.sub(r"\D", "", campos[0])
    try:
        dados = validar_chave(chave)
    except ChaveInvalida as e:
        raise QRCodeErro(f"Chave da NFC-e inválida: {e}", 400)
    if dados["uf"] != "SP":
        raise QRCodeErro(MSG_SO_SP, 422)
    if dados["modelo"] != "65":
        raise QRCodeErro("Este QR Code não é de NFC-e (modelo 65). Para NF-e de fornecedor, importe o XML.", 422)
    if len(campos) < 4 or not campos[-1].strip():
        raise QRCodeErro(
            "O QR Code está incompleto: falta o código de segurança. "
            "Escaneie de novo ou use a foto do cupom.", 422)

    host = partes.hostname.lower()
    if (host not in HOSTS_SEFAZ_SP or partes.username or partes.password
            or partes.port not in (None, 80, 443)):
        raise QRCodeErro("O endereço lido não é da consulta oficial da SEFAZ-SP.", 400)
    # Reconstrói a URL só com partes validadas e força HTTPS.
    segura = urlunsplit(("https", host, partes.path or "/", partes.query, ""))
    return {"url": segura, "chave": chave, "dados_chave": dados}


def buscar_html(url_segura: str, session=None) -> str:
    """Baixa a página da SEFAZ-SP; redirects só são seguidos dentro da lista oficial."""
    import requests
    http = session or requests
    atual = url_segura
    for _ in range(MAX_REDIRECTS + 1):
        try:
            resp = http.get(atual, timeout=TIMEOUT_SEGUNDOS, allow_redirects=False, stream=True, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9",
            })
        except requests.Timeout:
            raise QRCodeErro("A SEFAZ-SP demorou para responder. Tente de novo em instantes.", 504)
        except requests.RequestException:
            raise QRCodeErro("Não foi possível acessar a SEFAZ-SP agora. Tente de novo em instantes.", 502)
        if resp.status_code in (301, 302, 303, 307, 308):
            destino = resp.headers.get("Location") or ""
            prox = urlsplit(requests.compat.urljoin(atual, destino))
            if (prox.hostname or "").lower() not in HOSTS_SEFAZ_SP or prox.scheme not in ("http", "https"):
                raise QRCodeErro("A SEFAZ redirecionou para um endereço não oficial; consulta abortada.", 502)
            atual = urlunsplit(("https", prox.hostname.lower(), prox.path or "/", prox.query, ""))
            continue
        if resp.status_code != 200:
            raise QRCodeErro(f"Não foi possível acessar a SEFAZ (status {resp.status_code}). Verifique o QR Code.", 502)
        corpo = b""
        for bloco in resp.iter_content(64 * 1024):
            corpo += bloco
            if len(corpo) > TAMANHO_MAXIMO:
                raise QRCodeErro("Resposta da SEFAZ grande demais; consulta abortada.", 502)
        encoding = resp.encoding or "utf-8"
        try:
            return corpo.decode(encoding, errors="replace")
        except LookupError:
            return corpo.decode("utf-8", errors="replace")
    raise QRCodeErro("A SEFAZ redirecionou vezes demais; consulta abortada.", 502)


# ───────────────────────── Parser (porte do parser.ts) ─────────────────────────

def gtin_valido(codigo: str) -> bool:
    """GTIN de 8, 12, 13 ou 14 dígitos com DV correto."""
    if not codigo or not codigo.isdigit() or len(codigo) not in (8, 12, 13, 14):
        return False
    digitos = [int(c) for c in codigo]
    dv = digitos.pop()
    soma = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digitos)))
    return (10 - soma % 10) % 10 == dv


def texto(trecho: str) -> str:
    t = re.sub(r"<[^>]+>", " ", trecho)
    t = html_lib.unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def numero_br(valor: Optional[str]) -> Decimal:
    """'1.234,56' -> Decimal('1234.56')."""
    if not valor:
        return Decimal("0")
    try:
        return Decimal(valor.replace(".", "").replace(",", "."))
    except Exception:
        return Decimal("0")


def _texto_com_separador(html: str) -> str:
    """Texto da página com fronteira visível ( | ) entre elementos vizinhos."""
    h = re.sub(r"</(td|tr|span|div|p|table|h1|h2|h3|h4|li)>", " | ", html, flags=re.I)
    h = re.sub(r"<br\s*/?>", " | ", h, flags=re.I)
    return texto(h)


# Trabalha sobre o TEXTO visível, não sobre classes/ids (que já derrubaram duas
# versões no MiseOn: id="Item + 1" e "Qtde.:"):
#   TOMATE SALADA kg (Código: 2410 ) Qtde.:1,022 UN: kg Vl. Unit.: 6,99 Vl. Total 7,14
_REGEX_ITEM = re.compile(
    r"([^|]{2,120}?)\s*\|?\s*\(\s*C[óo]digo:\s*(\d+)\s*\)[\s\S]{0,40}?Qtde?\.?:\s*([\d.,]+)"
    r"[\s\S]{0,40}?UN:?\s*([A-Za-zÀ-ÿ]{1,6})[\s\S]{0,40}?Vl\.?\s*Unit\.?:?\s*([\d.,]+)"
    r"[\s\S]{0,120}?Vl\.?\s*Total\s*\|?\s*([\d.,]+)",
    re.I,
)


def parse_itens(html: str) -> List[Dict[str, Any]]:
    plano = _texto_com_separador(html)
    itens = []
    for m in _REGEX_ITEM.finditer(plano):
        descricao_bruta, codigo, qtd_t, unidade, unit_t, total_t = m.groups()
        descricao = re.sub(r"^\d+\s+", "", descricao_bruta.split("|")[-1].strip())
        if not descricao:
            continue
        qtd = numero_br(qtd_t)
        unit = numero_br(unit_t)
        total = numero_br(total_t)
        itens.append({
            "num_item": len(itens) + 1,
            "descricao": descricao,
            # "(Código: N)" é o cProd do emitente; só vira EAN se for GTIN válido.
            "gtin": codigo if gtin_valido(codigo) else None,
            "codigo_fornecedor": codigo,
            "qtd": qtd or Decimal("1"),
            "unidade": (unidade or "UN").upper(),
            "valor_unitario": unit or ((total / qtd).quantize(Decimal("0.0001")) if qtd > 0 else total),
            "valor_total": total or (qtd * unit),
        })
    return itens


def parse_html_sefaz_sp(html: str, chave: str) -> Dict[str, Any]:
    h = re.sub(r"\r?\n|\r", " ", html or "")
    plano = _texto_com_separador(h)
    itens = parse_itens(h)

    topo = re.search(r"class=[\"'][^\"']*txtTopo[^\"']*[\"'][^>]*>([\s\S]*?)<", h, re.I)
    por_classe = texto(topo.group(1)) if topo else ""
    antes_cnpj = re.search(r"\|\s*([^|]{4,90}?)\s*\|\s*CNPJ:", plano, re.I)
    razao = por_classe or (antes_cnpj.group(1).strip() if antes_cnpj else "") or "Fornecedor (NFC-e)"
    cnpj_m = re.search(r"CNPJ:\s*([\d./-]{14,20})", plano, re.I)

    desconto_m = re.search(r"Descontos?\s*(?:R\$)?\s*\|?\s*([\d.,]+)", plano, re.I)
    produtos_m = re.search(r"(?:Valor\s+dos\s+)?produtos\s*(?:R\$)?\s*\|?\s*([\d.,]+)", plano, re.I)
    # "Valor a pagar" é o que saiu do caixa (já com desconto); senão "Valor total".
    pagar_m = re.search(r"Valor\s+a\s+pagar\s*(?:R\$)?\s*\|?\s*([\d.,]+)", plano, re.I)
    total_m = (pagar_m or re.search(r"Valor\s+total\s*(?:R\$)?\s*\|?\s*([\d.,]+)", plano, re.I)
               or re.search(r"txtMax[^>]*>\s*([\d.,]+)", h, re.I))

    data_m = re.search(r"(\d{2})/(\d{2})/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})", plano)
    data_emissao = (f"{data_m.group(3)}-{data_m.group(2)}-{data_m.group(1)}T"
                    f"{data_m.group(4)}:{data_m.group(5)}:{data_m.group(6)}") if data_m else None

    soma = sum((i["valor_total"] for i in itens), Decimal("0"))
    total = numero_br(total_m.group(1)) if total_m else Decimal("0")
    return {
        "chave": chave,
        "uf": "SP",
        "emitente": {"razao_social": razao, "cnpj": cnpj_m.group(1).strip() if cnpj_m else None},
        "data_emissao": data_emissao,
        "valor_total": total or soma,
        "valor_produtos": numero_br(produtos_m.group(1)) if produtos_m else None,
        "desconto": numero_br(desconto_m.group(1)) if desconto_m else Decimal("0"),
        "itens": itens,
    }


def motivo_erro_sefaz(html: str) -> Optional[str]:
    m = re.search(r"Erro\(s\):\s*-?\s*([^'<]+)", html or "", re.I)
    return m.group(1).strip() if m else None


# ───────────────────────── Ponte para a entrada (formato do parse_nfe_xml) ─────────────────────────

def para_nota_entrada(dados: Dict[str, Any], dados_chave: Dict[str, str]) -> Dict[str, Any]:
    """Converte a NFC-e lida no MESMO formato do ``parse_nfe_xml`` (preview/importar reaproveitados).

    O desconto da nota é rateado nos itens pela proporção do valor de cada um,
    para o custo de estoque bater com o que saiu do caixa.
    """
    itens = dados["itens"]
    soma = sum((i["valor_total"] for i in itens), Decimal("0"))
    desconto = Decimal(str(dados.get("desconto") or 0))
    if desconto <= 0 or desconto >= soma:
        desconto = Decimal("0")
    convertidos, rateado = [], Decimal("0")
    for idx, it in enumerate(itens):
        if desconto and idx == len(itens) - 1:
            parte = desconto - rateado  # a última leva o resto: a soma fecha no centavo
        elif desconto:
            parte = (desconto * it["valor_total"] / soma).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            parte = Decimal("0")
        rateado += parte
        convertidos.append({
            "codigo": it["codigo_fornecedor"],
            "ean": it["gtin"],
            "descricao": it["descricao"],
            "ncm": None, "cest": None, "cfop": None,
            "unidade": it["unidade"],
            "quantidade": it["qtd"],
            "valor_unitario": it["valor_unitario"],
            "valor_total": it["valor_total"],
            "desconto": parte,
            "icms_orig": None, "icms_cst": None, "icms_csosn": None,
        })
    cnpj = re.sub(r"\D", "", dados["emitente"].get("cnpj") or "") or dados_chave["cnpj_emitente"]
    return {
        "chave_acesso": dados_chave["chave_acesso"],
        "modelo": "65",
        "numero": dados_chave["numero"],
        "serie": dados_chave["serie"],
        "data_emissao": dados.get("data_emissao"),
        "natureza_operacao": "NFC-e (QR Code SEFAZ-SP)",
        "emitente": {"cnpj": cnpj, "nome": dados["emitente"].get("razao_social"),
                     "fantasia": dados["emitente"].get("razao_social"), "uf": "SP"},
        # Cupom do atacarejo raramente identifica o comprador; sem destinatário não há checagem.
        "destinatario": {},
        "itens": convertidos,
        "total": Decimal(str(dados["valor_total"])),
        "duplicatas": [],
    }


def ler_nfce_por_qrcode(url: str, session=None) -> Dict[str, Any]:
    """URL do QR Code → nota no formato de entrada. Lança QRCodeErro com mensagem pronta."""
    info = validar_url_qrcode(url)
    pagina = buscar_html(info["url"], session=session)
    dados = parse_html_sefaz_sp(pagina, info["chave"])
    if not dados["itens"]:
        motivo = motivo_erro_sefaz(pagina)
        raise QRCodeErro(
            f"A SEFAZ recusou a consulta: {motivo}" if motivo else
            "A SEFAZ respondeu, mas nenhum produto foi encontrado na nota. O QR Code pode estar incompleto.",
            422)
    return para_nota_entrada(dados, info["dados_chave"])
