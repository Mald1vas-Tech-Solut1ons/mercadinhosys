"""Entrada de estoque pelo QR Code da NFC-e (consulta pública SEFAZ-SP), sem certificado.

Porte do MiseOn. Nenhum teste acessa a internet: a busca na SEFAZ é simulada.
Amostra: tests/fixtures/nfce_sp_tenda.html (cupom real do Tenda Atacado, do teste do MiseOn).
"""
from decimal import Decimal
from pathlib import Path

import pytest

from app.models import ContaPagar, MovimentacaoEstoque, NotaFiscalEntrada, Produto, Fornecedor
from app.services.fiscal import nfce_qrcode
from app.services.fiscal.chave_acesso import digito_verificador
from app.services.fiscal.nfce_qrcode import (
    MSG_SO_SP, QRCodeErro, buscar_html, gtin_valido, para_nota_entrada, parse_html_sefaz_sp,
    validar_url_qrcode,
)
from test_entrada_nfe_xml import loja, _contagens  # noqa: F401  (fixture da loja no plano Grátis)

CHAVE = "35260801157555004878651070001051029721313325"
URL = f"https://www.nfce.fazenda.sp.gov.br/qrcode?p={CHAVE}|2|1|1|A1B2C3D4E5F6"
HTML = (Path(__file__).parent / "fixtures" / "nfce_sp_tenda.html").read_text(encoding="utf-8")


def _chave(cuf="35", modelo="65"):
    base = f"{cuf}260801157555004878{modelo}107000105102972131332"
    assert len(base) == 43
    return base + digito_verificador(base)


# ───────────────────────── Parser ─────────────────────────

def test_parser_le_a_pagina_real_da_sefaz_sp():
    dados = parse_html_sefaz_sp(HTML, CHAVE)
    itens = dados["itens"]
    assert len(itens) == 6
    assert itens[0] == {"num_item": 1, "descricao": "TOMATE SALADA kg", "gtin": None, "codigo_fornecedor": "2410",
                        "qtd": Decimal("1.022"), "unidade": "KG", "valor_unitario": Decimal("6.99"),
                        "valor_total": Decimal("7.14")}
    assert itens[1]["descricao"] == "SALSA un"
    assert itens[3]["descricao"] == "CARNE MOIDA SUINA CONG PAMPLONA 500g" and itens[3]["gtin"] is None
    assert itens[4]["qtd"] == Decimal("0.582") and itens[4]["valor_total"] == Decimal("9.27")
    assert itens[5]["gtin"] == "7891962057019" and itens[5]["qtd"] == Decimal("3")
    assert dados["emitente"] == {"razao_social": "TENDA ATACADO LTDA (VL GALVAO)", "cnpj": "01.157.555/0048-78"}
    assert dados["valor_total"] == Decimal("60.00")  # "Valor a pagar", já com desconto
    assert dados["desconto"] == Decimal("4.42")
    assert dados["data_emissao"] == "2026-08-04T18:43:08"


def test_pagina_sem_itens_e_erro_da_sefaz():
    assert parse_html_sefaz_sp("<html><body>QR Code inválido</body></html>", CHAVE)["itens"] == []
    pagina = "<script>alert('Erro(s): - Hash QR Code inválido')</script>"
    assert nfce_qrcode.motivo_erro_sefaz(pagina) == "Hash QR Code inválido"


def test_gtin():
    assert gtin_valido("7891962057019") and not gtin_valido("2410") and not gtin_valido("7891962057010")


def test_rateio_do_desconto_fecha_no_centavo():
    info = validar_url_qrcode(URL)
    nota = para_nota_entrada(parse_html_sefaz_sp(HTML, CHAVE), info["dados_chave"])
    assert nota["modelo"] == "65" and nota["numero"] == "105102" and nota["serie"] == "107"
    assert nota["emitente"]["cnpj"] == "01157555004878"
    assert sum(i["desconto"] for i in nota["itens"]) == Decimal("4.42")
    liquido = sum(i["valor_total"] - i["desconto"] for i in nota["itens"])
    assert liquido == Decimal("60.00") == nota["total"]


# ───────────────────────── URL / SSRF ─────────────────────────

def test_url_valida_e_reconstruida_em_https():
    info = validar_url_qrcode(URL.replace("https://", "http://"))
    assert info["url"].startswith("https://www.nfce.fazenda.sp.gov.br/qrcode?p=") and info["chave"] == CHAVE


@pytest.mark.parametrize("url,trecho", [
    (f"https://evil.example.com/qrcode?p={CHAVE}|2|1|1|HASH", "SEFAZ-SP"),
    (f"https://www.nfce.fazenda.sp.gov.br.evil.com/qrcode?p={CHAVE}|2|1|1|HASH", "SEFAZ-SP"),
    (f"https://www.nfce.fazenda.sp.gov.br@169.254.169.254/qrcode?p={CHAVE}|2|1|1|HASH", "SEFAZ-SP"),
    (f"https://user:pw@www.nfce.fazenda.sp.gov.br/qrcode?p={CHAVE}|2|1|1|HASH", "SEFAZ-SP"),
    (f"https://www.nfce.fazenda.sp.gov.br:8080/qrcode?p={CHAVE}|2|1|1|HASH", "SEFAZ-SP"),
    (f"file:///etc/passwd?p={CHAVE}|2|1|1|HASH", "não é uma URL"),
    ("https://www.nfce.fazenda.sp.gov.br/consulta", "consulta impressa"),
    (f"https://www.nfce.fazenda.sp.gov.br/qrcode?p={CHAVE}|2|1|1|", "incompleto"),
    (f"https://www.nfce.fazenda.sp.gov.br/qrcode?p={CHAVE[:-1]}0|2|1|1|HASH", "inválida"),
    (f"https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?p={_chave(cuf='43')}|2|1|1|HASH", MSG_SO_SP),
    (f"https://www.nfce.fazenda.sp.gov.br/qrcode?p={_chave(modelo='55')}|2|1|1|HASH", "não é de NFC-e"),
    ("", "Informe"),
])
def test_url_recusada(url, trecho):
    with pytest.raises(QRCodeErro) as e:
        validar_url_qrcode(url)
    assert trecho in str(e.value)


class _Resp:
    def __init__(self, status=200, body=b"", headers=None):
        self.status_code, self._body, self.headers, self.encoding = status, body, headers or {}, "utf-8"

    def iter_content(self, n):
        yield self._body


class _Sessao:
    def __init__(self, *respostas):
        self.respostas, self.urls = list(respostas), []

    def get(self, url, **kw):
        assert kw["allow_redirects"] is False and kw["timeout"]
        self.urls.append(url)
        return self.respostas.pop(0)


def test_redirect_para_fora_da_sefaz_e_abortado():
    s = _Sessao(_Resp(302, headers={"Location": "http://169.254.169.254/latest/meta-data"}))
    with pytest.raises(QRCodeErro, match="não oficial"):
        buscar_html(validar_url_qrcode(URL)["url"], session=s)
    assert len(s.urls) == 1


def test_redirect_dentro_da_sefaz_e_seguido():
    s = _Sessao(_Resp(302, headers={"Location": "/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=x"}),
                _Resp(200, HTML.encode("utf-8")))
    assert "TENDA" in buscar_html(validar_url_qrcode(URL)["url"], session=s)
    assert s.urls[1].startswith("https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/")


def test_resposta_grande_demais_e_abortada(monkeypatch):
    monkeypatch.setattr(nfce_qrcode, "TAMANHO_MAXIMO", 100)
    with pytest.raises(QRCodeErro, match="grande demais"):
        buscar_html(validar_url_qrcode(URL)["url"], session=_Sessao(_Resp(200, b"x" * 500)))


# ───────────────────────── API ponta a ponta ─────────────────────────

@pytest.fixture
def sefaz(monkeypatch):
    """Simula a SEFAZ-SP: devolve a amostra e registra as URLs pedidas."""
    chamadas = []

    def falso(url, session=None):
        chamadas.append(url)
        return HTML
    monkeypatch.setattr(nfce_qrcode, "buscar_html", falso)
    return chamadas


def test_qrcode_previa_e_importacao_com_as_regras_do_xml(client, session, loja, sefaz):
    estab_id = loja["estab"].id
    # O Toddy já existe na loja pelo EAN.
    cat_id = loja["arroz"].categoria_id
    toddy = Produto(estabelecimento_id=estab_id, categoria_id=cat_id, nome="Biscoito Toddy 130g",
                    codigo_barras="7891962057019", preco_custo=Decimal("2"), preco_venda=Decimal("3.99"),
                    quantidade=Decimal("4"))
    session.add(toddy)
    session.commit()

    antes = _contagens(session, estab_id)
    pv = client.post("/api/fiscal/entrada/qrcode", headers=loja["headers"], json={"url_qrcode": URL})
    assert pv.status_code == 200, pv.get_json()
    preview = pv.get_json()["preview"]
    assert preview["origem"] == "qrcode" and preview["chave_acesso"] == CHAVE and preview["ja_importada"] is False
    assert len(preview["itens"]) == 6 and preview["total"] == pytest.approx(60.0)
    por = {i["descricao"]: i for i in preview["itens"]}
    assert por["BISC REC TODDY CHOC 130g"]["produto_existente"] is True
    assert por["TOMATE SALADA kg"]["produto_existente"] is False and por["TOMATE SALADA kg"]["unidade"] == "KG"
    assert _contagens(session, estab_id) == antes
    assert sefaz[0].startswith("https://www.nfce.fazenda.sp.gov.br/")

    imp = client.post("/api/fiscal/entrada/qrcode/importar", headers=loja["headers"], json={"url_qrcode": URL})
    assert imp.status_code == 201, imp.get_json()
    res = imp.get_json()["resultado"]
    assert (res["produtos_criados"], res["produtos_atualizados"]) == (5, 1)

    session.expire_all()
    assert session.get(Produto, toddy.id).quantidade == Decimal("7")
    tomate = session.query(Produto).filter_by(estabelecimento_id=estab_id, nome="TOMATE SALADA kg").one()
    assert tomate.quantidade == Decimal("1.022") and tomate.unidade_medida == "KG"
    assert tomate.codigo_barras is None and tomate.codigo_interno == "2410"
    assert tomate.cfop_padrao == "5102" and tomate.csosn == "102"
    # Custo líquido: 7,14 menos a fatia do desconto (4,42 x 7,14 / 64,42 = 0,49) / 1,022 kg
    assert tomate.preco_custo == (Decimal("6.65") / Decimal("1.022")).quantize(Decimal("0.0001"))
    forn = session.query(Fornecedor).filter_by(estabelecimento_id=estab_id, cnpj="01157555004878").one()
    assert tomate.fornecedor_id == forn.id
    movs = session.query(MovimentacaoEstoque).filter_by(estabelecimento_id=estab_id, tipo="entrada").count()
    assert movs == 6
    custo_total = sum(m.valor_total for m in session.query(MovimentacaoEstoque).filter_by(estabelecimento_id=estab_id))
    assert abs(custo_total - Decimal("60.00")) < Decimal("0.01")  # estoque entra pelo que saiu do caixa
    nota = session.query(NotaFiscalEntrada).filter_by(estabelecimento_id=estab_id).one()
    assert nota.modelo == "65" and nota.chave_acesso == CHAVE
    conta = session.query(ContaPagar).filter_by(estabelecimento_id=estab_id).one()
    assert conta.valor_original == Decimal("60.00")

    # Mesma chave: recusada, nada duplica. E a consulta por chave enxerga a nota.
    depois = _contagens(session, estab_id)
    dup = client.post("/api/fiscal/entrada/qrcode/importar", headers=loja["headers"], json={"url_qrcode": URL})
    assert dup.status_code == 400 and "já foi importada" in dup.get_json()["error"]
    assert _contagens(session, estab_id) == depois
    assert client.get(f"/api/fiscal/entrada/chave/{CHAVE}", headers=loja["headers"]).get_json()["ja_importada"]

    # Segunda compra no mesmo atacado reencontra o tomate pelo código do fornecedor (2410).
    outra = f"https://www.nfce.fazenda.sp.gov.br/qrcode?p={_outra_chave()}|2|1|1|FFFF"
    imp2 = client.post("/api/fiscal/entrada/qrcode/importar", headers=loja["headers"], json={"url_qrcode": outra})
    assert imp2.status_code == 201 and imp2.get_json()["resultado"]["produtos_criados"] == 0
    session.expire_all()
    assert session.get(Produto, tomate.id).quantidade == Decimal("2.044")


def _outra_chave():
    base = "352608011575550048786510700010510397213133"[:43]
    base = base.ljust(43, "1")
    return base + digito_verificador(base)


def test_qrcode_fora_de_sp_e_erros_da_sefaz_nao_buscam_nada(client, session, loja, sefaz, monkeypatch):
    url_rs = f"https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?p={_chave(cuf='43')}|2|1|1|HASH"
    r = client.post("/api/fiscal/entrada/qrcode", headers=loja["headers"], json={"url_qrcode": url_rs})
    assert r.status_code == 422 and r.get_json()["error"] == MSG_SO_SP
    r = client.post("/api/fiscal/entrada/qrcode", headers=loja["headers"],
                    json={"url_qrcode": "http://127.0.0.1:5000/admin?p=" + CHAVE + "|2|1|1|H"})
    assert r.status_code == 400
    assert sefaz == []  # nenhuma requisição saiu para host não oficial

    monkeypatch.setattr(nfce_qrcode, "buscar_html",
                        lambda url, session=None: "<script>alert('Erro(s): - Hash QR Code inválido')</script>")
    r = client.post("/api/fiscal/entrada/qrcode", headers=loja["headers"], json={"url_qrcode": URL})
    assert r.status_code == 422 and "Hash QR Code inválido" in r.get_json()["error"]


def test_qrcode_liberado_no_plano_gratis_para_estoque(client, session, loja, sefaz):
    from test_entrada_nfe_xml import _usuario, _token
    est = _usuario(session, loja["estab"], "ESTOQUE", "61")
    session.commit()
    r = client.post("/api/fiscal/entrada/qrcode", headers=_token(est, loja["estab"].id, "ESTOQUE"),
                    json={"url_qrcode": URL})
    assert r.status_code == 200, r.get_json()
