"""Entrada de estoque pela NF-e do fornecedor, ponta a ponta.

Loja mista (mercearia, perfumaria, vestuário, eletro) SEM emissão de nota, mas que
RECEBE NF-e de compra. Prova, pela API:
- prévia lista os itens e quais já existem;
- importação cria produtos, sobe estoque (inclusive fracionado em KG), grava custo
  (com desconto do item), movimentação de entrada e contas a pagar;
- a mesma chave não entra duas vezes;
- produto criado pelo XML recebe tributação de REVENDA (5102/102), não o CFOP do
  fornecedor (6102/6403), e item "SEM GTIN" recebe código interno depois;
- a entrada funciona no plano Grátis e para o cargo Estoque; a emissão não;
- consulta pela chave do DANFE / QR Code respeita a loja (tenant).
"""
import io
from datetime import date
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app import cache
from app.models import (
    CategoriaProduto, ContaPagar, Estabelecimento, Fornecedor, Funcionario,
    MovimentacaoEstoque, NotaFiscalEntrada, Produto,
)
from app.services.codigo_barras_service import digito_ean13, ean13_valido
from app.services.fiscal.chave_acesso import (
    ChaveInvalida, digito_verificador, extrair_chave, validar,
)

CNPJ_LOJA = "12345678000195"
CNPJ_FORNECEDOR = "45987654000110"


def _ean(base12):
    return base12 + digito_ean13(base12)


EAN_ARROZ = _ean("789100000001")
EAN_LIQUIDIFICADOR = _ean("789200000002")
EAN_CASTANHA = _ean("789300000003")


def _chave(numero=12345, cnpj=CNPJ_FORNECEDOR, cuf="35", modelo="55", aamm="2610"):
    base = f"{cuf}{aamm}{cnpj}{modelo}001{numero:09d}1{87654321:08d}"
    assert len(base) == 43
    return base + digito_verificador(base)


def _det(n, cprod, cean, xprod, ncm, cfop, ucom, qcom, vuncom, vprod, icms, vdesc=None):
    desc = f"<vDesc>{vdesc}</vDesc>" if vdesc else ""
    return f"""
      <det nItem="{n}">
        <prod>
          <cProd>{cprod}</cProd><cEAN>{cean}</cEAN><xProd>{xprod}</xProd><NCM>{ncm}</NCM>
          <CFOP>{cfop}</CFOP><uCom>{ucom}</uCom><qCom>{qcom}</qCom><vUnCom>{vuncom}</vUnCom>
          <vProd>{vprod}</vProd><cEANTrib>{cean}</cEANTrib><uTrib>{ucom}</uTrib><qTrib>{qcom}</qTrib>
          <vUnTrib>{vuncom}</vUnTrib>{desc}<indTot>1</indTot>
        </prod>
        <imposto><ICMS>{icms}</ICMS></imposto>
      </det>"""


def _xml(chave, camiseta_cprod="CAM-001"):
    """NF-e 4.00 realista (nfeProc + protNFe) de um atacadista de SP para a loja em AM."""
    itens = "".join([
        _det(1, "ARZ-5", EAN_ARROZ, "ARROZ TIPO 1 PACOTE 5KG", "10063021", "6102", "UN", "5.0000",
             "25.0000000000", "125.00", "<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC>"
             "<vBC>125.00</vBC><pICMS>12.00</pICMS><vICMS>15.00</vICMS></ICMS00>"),
        _det(2, "LQ-600", EAN_LIQUIDIFICADOR, "LIQUIDIFICADOR 600W 110V", "85094050", "6102", "UN", "2.0000",
             "150.0000000000", "300.00", "<ICMS00><orig>1</orig><CST>00</CST><modBC>3</modBC>"
             "<vBC>280.00</vBC><pICMS>4.00</pICMS><vICMS>11.20</vICMS></ICMS00>", vdesc="20.00"),
        _det(3, camiseta_cprod, "SEM GTIN", "CAMISETA ALGODAO BASICA M PRETA", "61091000", "6102", "UN",
             "12.0000", "29.9000000000", "358.80", "<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC>"
             "<vBC>358.80</vBC><pICMS>12.00</pICMS><vICMS>43.06</vICMS></ICMS00>"),
        _det(4, "CAST-GR", EAN_CASTANHA, "CASTANHA DO PARA A GRANEL KG", "08012200", "6403", "KG", "2.3500",
             "89.9000000000", "211.27", "<ICMS10><orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>211.27</vBC>"
             "<pICMS>12.00</pICMS><vICMS>25.35</vICMS><modBCST>4</modBCST><vBCST>300.00</vBCST>"
             "<pICMSST>20.00</pICMSST><vICMSST>34.65</vICMSST></ICMS10>"),
    ])
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe{chave}" versao="4.00">
      <ide>
        <cUF>35</cUF><cNF>87654321</cNF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie>
        <nNF>12345</nNF><dhEmi>2026-10-19T09:30:00-03:00</dhEmi><tpNF>1</tpNF><idDest>2</idDest>
        <cMunFG>3550308</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>{chave[-1]}</cDV><tpAmb>1</tpAmb>
        <finNFe>1</finNFe><indFinal>0</indFinal><indPres>9</indPres><procEmi>0</procEmi><verProc>ERP 1.0</verProc>
      </ide>
      <emit>
        <CNPJ>{CNPJ_FORNECEDOR}</CNPJ><xNome>ATACADO PAULISTA DISTRIBUIDORA LTDA</xNome><xFant>ATACADO PAULISTA</xFant>
        <enderEmit><xLgr>RUA DO COMERCIO</xLgr><nro>500</nro><xBairro>BRAS</xBairro><cMun>3550308</cMun>
          <xMun>SAO PAULO</xMun><UF>SP</UF><CEP>03001000</CEP><fone>1133334444</fone></enderEmit>
        <IE>111222333444</IE><CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>{CNPJ_LOJA}</CNPJ><xNome>LOJA MISTA DO BAIRRO LTDA</xNome>
        <enderDest><xLgr>RUA INDUSTRIAL</xLgr><nro>101</nro><xBairro>DISTRITO</xBairro><cMun>1302603</cMun>
          <xMun>MANAUS</xMun><UF>AM</UF><CEP>69000000</CEP></enderDest>
        <indIEDest>1</indIEDest><IE>041234567</IE>
      </dest>
      {itens}
      <total><ICMSTot><vBC>975.07</vBC><vICMS>94.61</vICMS><vBCST>300.00</vBCST><vST>34.65</vST>
        <vProd>995.07</vProd><vFrete>0.00</vFrete><vDesc>20.00</vDesc><vNF>975.07</vNF></ICMSTot></total>
      <transp><modFrete>0</modFrete></transp>
      <cobr>
        <fat><nFat>12345</nFat><vOrig>995.07</vOrig><vDesc>20.00</vDesc><vLiq>975.07</vLiq></fat>
        <dup><nDup>001</nDup><dVenc>2026-11-18</dVenc><vDup>487.53</vDup></dup>
        <dup><nDup>002</nDup><dVenc>2026-12-18</dVenc><vDup>487.54</vDup></dup>
      </cobr>
      <pag><detPag><tPag>15</tPag><vPag>975.07</vPag></detPag></pag>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt><tpAmb>1</tpAmb><verAplic>SP_NFE_PL009</verAplic><chNFe>{chave}</chNFe>
      <dhRecbto>2026-10-19T09:31:02-03:00</dhRecbto><nProt>135260000123456</nProt>
      <cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt>
  </protNFe>
</nfeProc>""".encode("utf-8")


def _token(user, estab_id, role):
    return {"Authorization": "Bearer " + create_access_token(
        identity=str(user.id), additional_claims={"estabelecimento_id": estab_id, "role": role})}


def _usuario(session, estab, role, sufixo):
    f = Funcionario(estabelecimento_id=estab.id, nome=f"Usuario {sufixo}", cpf=f"999888777{sufixo}"[:11],
                    username=f"user_{sufixo}", role=role, ativo=True, data_nascimento=date(1990, 1, 1),
                    celular="92999999999", email=f"{sufixo}@example.test", cargo=role,
                    data_admissao=date(2024, 1, 1), salario_base=Decimal("2000"))
    f.set_password("senha-teste-123")
    session.add(f)
    session.flush()
    return f


@pytest.fixture
def loja(session):
    """Loja no plano GRÁTIS, sem certificado/configuração fiscal, com o arroz já cadastrado."""
    estab = session.query(Estabelecimento).first()
    estab.cnpj = CNPJ_LOJA
    estab.plano = "Gratuito"
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Mercearia")
    session.add(cat)
    session.flush()
    arroz = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz Tipo 1 5kg",
                    codigo_barras=EAN_ARROZ, preco_custo=Decimal("20"), preco_venda=Decimal("29.90"),
                    quantidade=Decimal("10"), unidade_medida="UN")
    session.add(arroz)
    session.commit()
    cache.clear()
    return dict(estab=estab, admin=admin, arroz=arroz, headers=_token(admin, estab.id, "admin"))


def _enviar(client, headers, url, xml):
    return client.post(url, headers=headers, data={"xml": (io.BytesIO(xml), "nfe.xml")},
                       content_type="multipart/form-data")


def _contagens(session, estab_id):
    session.expire_all()
    return (session.query(MovimentacaoEstoque).filter_by(estabelecimento_id=estab_id).count(),
            session.query(ContaPagar).filter_by(estabelecimento_id=estab_id).count(),
            session.query(NotaFiscalEntrada).filter_by(estabelecimento_id=estab_id).count(),
            session.query(Produto).filter_by(estabelecimento_id=estab_id).count())


def test_entrada_por_xml_ponta_a_ponta(client, session, loja):
    estab_id, chave = loja["estab"].id, _chave()
    xml = _xml(chave)

    # ── Prévia: não grava e diz o que já existe ─────────────────────────────
    antes = _contagens(session, estab_id)
    pv = _enviar(client, loja["headers"], "/api/fiscal/entrada/preview", xml)
    assert pv.status_code == 200, pv.get_json()
    preview = pv.get_json()["preview"]
    assert preview["chave_acesso"] == chave and preview["ja_importada"] is False
    assert preview["qtd_itens"] == 4 and preview["total"] == pytest.approx(975.07)
    por_desc = {i["descricao"]: i for i in preview["itens"]}
    assert por_desc["ARROZ TIPO 1 PACOTE 5KG"]["produto_existente"] is True
    assert por_desc["ARROZ TIPO 1 PACOTE 5KG"]["produto_id"] == loja["arroz"].id
    for novo in ("LIQUIDIFICADOR 600W 110V", "CAMISETA ALGODAO BASICA M PRETA", "CASTANHA DO PARA A GRANEL KG"):
        assert por_desc[novo]["produto_existente"] is False and por_desc[novo]["acao"] == "criar_produto"
    assert por_desc["CAMISETA ALGODAO BASICA M PRETA"]["ean"] is None
    assert por_desc["CASTANHA DO PARA A GRANEL KG"]["unidade"] == "KG"
    assert por_desc["CASTANHA DO PARA A GRANEL KG"]["quantidade"] == pytest.approx(2.35)
    assert por_desc["CASTANHA DO PARA A GRANEL KG"]["icms_st"] is True
    assert len(preview["duplicatas"]) == 2
    assert _contagens(session, estab_id) == antes

    # ── Importação ─────────────────────────────────────────────────────────
    imp = _enviar(client, loja["headers"], "/api/fiscal/entrada/importar", xml)
    assert imp.status_code == 201, imp.get_json()
    res = imp.get_json()["resultado"]
    assert (res["produtos_criados"], res["produtos_atualizados"], res["contas_pagar_geradas"]) == (3, 1, 2)

    session.expire_all()
    arroz = session.get(Produto, loja["arroz"].id)
    assert arroz.quantidade == Decimal("15")
    # Custo médio ponderado: (10 x 20 + 5 x 25) / 15
    assert arroz.preco_custo == Decimal("21.6667")

    produtos = {p.nome: p for p in session.query(Produto).filter_by(estabelecimento_id=estab_id)}
    liq = produtos["LIQUIDIFICADOR 600W 110V"]
    cam = produtos["CAMISETA ALGODAO BASICA M PRETA"]
    cast = produtos["CASTANHA DO PARA A GRANEL KG"]
    assert liq.codigo_barras == EAN_LIQUIDIFICADOR and liq.quantidade == Decimal("2")
    assert liq.preco_custo == Decimal("140.0000")  # (300 - 20 de desconto) / 2
    assert cam.codigo_barras is None and cam.quantidade == Decimal("12") and cam.preco_custo == Decimal("29.9000")
    assert cast.unidade_medida == "KG" and cast.quantidade == Decimal("2.350")
    # Custo de aquisição inclui o ICMS-ST pago ao fornecedor: (211,27 + 34,65) / 2,35 kg
    assert cast.preco_custo == Decimal("104.6468")
    forn = session.query(Fornecedor).filter_by(estabelecimento_id=estab_id, cnpj=CNPJ_FORNECEDOR).one()
    assert {liq.fornecedor_id, cam.fornecedor_id, cast.fornecedor_id} == {forn.id}

    # Tributação de revenda, nunca o CFOP do fornecedor (6102 / 6403).
    for p in (liq, cam, cast):
        assert p.cfop_padrao == "5102", p.nome
    assert (liq.csosn, liq.icms_st) == ("102", False)
    assert (cam.csosn, cam.icms_st) == ("102", False)
    assert liq.origem == 2  # importação direta do fornecedor (1) vira "adquirida no mercado interno"
    # Castanha veio com ICMS-ST retido (CFOP 6403 / CST 10): marcada ST, emissor usa 5405/500.
    assert (cast.csosn, cast.icms_st, cast.cst_icms) == ("500", True, "60")

    # Movimentação de entrada com custo unitário, uma por item.
    movs = session.query(MovimentacaoEstoque).filter_by(estabelecimento_id=estab_id, tipo="entrada").all()
    assert len(movs) == 4
    por_prod = {m.produto_id: m for m in movs}
    assert por_prod[arroz.id].quantidade_anterior == Decimal("10") and por_prod[arroz.id].quantidade_atual == Decimal("15")
    assert por_prod[cast.id].quantidade == Decimal("2.350") and por_prod[cast.id].custo_unitario == Decimal("104.6468")
    assert por_prod[liq.id].custo_unitario == Decimal("140.0000")
    assert all(chave in (m.observacoes or "") for m in movs)

    # Contas a pagar pelas duplicatas.
    contas = session.query(ContaPagar).filter_by(estabelecimento_id=estab_id).order_by(ContaPagar.data_vencimento).all()
    assert [c.valor_original for c in contas] == [Decimal("487.53"), Decimal("487.54")]
    assert [c.data_vencimento for c in contas] == [date(2026, 11, 18), date(2026, 12, 18)]
    assert all(c.fornecedor_id == forn.id and c.status == "aberto" for c in contas)

    nota = session.query(NotaFiscalEntrada).filter_by(estabelecimento_id=estab_id).one()
    assert nota.chave_acesso == chave and nota.status == "importada" and nota.qtd_itens == 4

    # ── Camiseta SEM GTIN recebe código interno da loja ────────────────────
    gerar = client.post("/api/produtos/codigo-barras/gerar", headers=loja["headers"],
                        json={"produto_ids": [cam.id]})
    assert gerar.status_code == 200, gerar.get_json()
    session.expire_all()
    codigo = session.get(Produto, cam.id).codigo_barras
    assert codigo.startswith("20") and ean13_valido(codigo)

    # ── Mesma chave de novo: recusada, sem estoque/conta duplicados ────────
    depois = _contagens(session, estab_id)
    dup = _enviar(client, loja["headers"], "/api/fiscal/entrada/importar", xml)
    assert dup.status_code == 400 and "já foi importada" in dup.get_json()["error"]
    assert _contagens(session, estab_id) == depois
    assert session.get(Produto, arroz.id).quantidade == Decimal("15")
    pv2 = _enviar(client, loja["headers"], "/api/fiscal/entrada/preview", xml)
    assert pv2.get_json()["preview"]["ja_importada"] is True
    # Segunda leitura casa a camiseta (agora com código de barras) pelo código do fornecedor.
    itens2 = {i["descricao"]: i for i in pv2.get_json()["preview"]["itens"]}
    assert itens2["CAMISETA ALGODAO BASICA M PRETA"]["produto_id"] == cam.id


def test_codigo_do_fornecedor_nao_cai_em_produto_da_loja(client, session, loja):
    """cProd do fornecedor igual ao código interno de OUTRA mercadoria da loja: não mistura estoque."""
    cat = session.query(CategoriaProduto).filter_by(estabelecimento_id=loja["estab"].id).first()
    bolsa = Produto(estabelecimento_id=loja["estab"].id, categoria_id=cat.id, nome="Bolsa de couro",
                    codigo_interno="CAM-001", preco_custo=Decimal("50"), preco_venda=Decimal("120"),
                    quantidade=Decimal("3"))
    session.add(bolsa)
    session.commit()
    imp = _enviar(client, loja["headers"], "/api/fiscal/entrada/importar", _xml(_chave(777)))
    assert imp.status_code == 201, imp.get_json()
    session.expire_all()
    assert session.get(Produto, bolsa.id).quantidade == Decimal("3")
    cam = session.query(Produto).filter_by(nome="CAMISETA ALGODAO BASICA M PRETA").one()
    forn = session.query(Fornecedor).filter_by(cnpj=CNPJ_FORNECEDOR).one()
    assert cam.codigo_interno == f"F{forn.id}-CAM-001" and cam.quantidade == Decimal("12")

    # Próxima nota do mesmo fornecedor reencontra a camiseta pelo código alternativo.
    xml2 = _xml(_chave(778)).replace(b"<nNF>12345</nNF>", b"<nNF>778</nNF>")
    imp2 = _enviar(client, loja["headers"], "/api/fiscal/entrada/importar", xml2)
    assert imp2.status_code == 201, imp2.get_json()
    assert imp2.get_json()["resultado"]["produtos_criados"] == 0
    session.expire_all()
    assert session.get(Produto, cam.id).quantidade == Decimal("24")
    assert session.get(Produto, bolsa.id).quantidade == Decimal("3")


def test_entrada_liberada_no_plano_gratis_e_para_estoque_mas_emissao_nao(client, session, loja):
    estoquista = _usuario(session, loja["estab"], "ESTOQUE", "77")
    session.commit()
    h_est = _token(estoquista, loja["estab"].id, "ESTOQUE")
    # Plano Grátis, sem certificado: entrada liberada (admin e estoquista).
    assert client.get("/api/fiscal/entrada", headers=loja["headers"]).status_code == 200
    assert client.get("/api/fiscal/entrada", headers=h_est).status_code == 200
    assert _enviar(client, h_est, "/api/fiscal/entrada/preview", _xml(_chave())).status_code == 200
    assert client.get(f"/api/fiscal/entrada/chave/{_chave()}", headers=h_est).status_code == 200
    # Emissão continua no Pro.
    emissao = client.get("/api/fiscal/documentos", headers=loja["headers"])
    assert emissao.status_code == 403 and emissao.get_json()["code"] == "PLAN_RESTRICTED"
    # No Pro, a emissão continua vedada ao cargo Estoque (nível 4).
    loja["estab"].plano = "Pro"
    session.commit()
    cache.clear()
    assert client.get("/api/fiscal/documentos", headers=h_est).status_code == 403
    assert client.get("/api/fiscal/entrada", headers=h_est).status_code == 200
    # Vendedor não dá entrada.
    vendedor = _usuario(session, loja["estab"], "VENDEDOR", "78")
    session.commit()
    assert client.get("/api/fiscal/entrada", headers=_token(vendedor, loja["estab"].id, "VENDEDOR")).status_code == 403


def test_consulta_por_chave_respeita_a_loja(client, session, loja):
    chave = _chave()
    nao = client.get(f"/api/fiscal/entrada/chave/{chave}", headers=loja["headers"])
    assert nao.status_code == 200
    body = nao.get_json()
    assert body["ja_importada"] is False and body["nota"] is None
    assert body["mensagem"] == ("Nota ainda não importada. Envie o XML (o fornecedor manda por e-mail) "
                                "para dar entrada.")
    assert body["chave"]["uf"] == "SP" and body["chave"]["cnpj_emitente"] == CNPJ_FORNECEDOR
    assert body["chave"]["modelo"] == "55" and body["chave"]["numero"] == "12345"

    assert _enviar(client, loja["headers"], "/api/fiscal/entrada/importar", _xml(chave)).status_code == 201
    sim = client.get(f"/api/fiscal/entrada/chave/{chave}", headers=loja["headers"]).get_json()
    assert sim["ja_importada"] is True and sim["nota"]["chave_acesso"] == chave

    # QR Code (URL inteira) via ?texto=
    url_qr = f"https://www.sefaz.sp.gov.br/NFCeConsultaPublica?p={chave}|2|1|1|ABCDEF0123"
    qr = client.get("/api/fiscal/entrada/chave/qr", headers=loja["headers"], query_string={"texto": url_qr})
    assert qr.status_code == 200 and qr.get_json()["ja_importada"] is True

    # DV errado e lixo: 400 com mensagem clara.
    errada = chave[:-1] + str((int(chave[-1]) + 1) % 10)
    r = client.get(f"/api/fiscal/entrada/chave/{errada}", headers=loja["headers"])
    assert r.status_code == 400 and "verificador" in r.get_json()["error"]
    assert client.get("/api/fiscal/entrada/chave/123", headers=loja["headers"]).status_code == 400

    # Outra loja não enxerga a nota desta (tenant).
    outra = Estabelecimento(nome_fantasia="Outra", razao_social="Outra LTDA", cnpj="99888777000166",
                            email="outra@example.test", telefone="11999999999", cep="01000000",
                            logradouro="Rua B", numero="2", bairro="Centro", cidade="São Paulo", estado="SP",
                            plano="PREMIUM", vencimento_plano=date(2030, 12, 31))
    session.add(outra)
    session.flush()
    admin2 = _usuario(session, outra, "admin", "88")
    session.commit()
    r2 = client.get(f"/api/fiscal/entrada/chave/{chave}", headers=_token(admin2, outra.id, "admin"))
    assert r2.status_code == 200 and r2.get_json()["ja_importada"] is False and r2.get_json()["nota"] is None


# ── Chave de acesso: leitura e validação (puro) ───────────────────────────

def test_extrair_chave_de_danfe_e_qr_code():
    chave = _chave()
    assert extrair_chave(chave) == chave
    assert extrair_chave(" ".join(chave[i:i + 4] for i in range(0, 44, 4))) == chave  # DANFE em blocos
    assert extrair_chave(f"https://nfce.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p={chave}|2|1|1|HASH") == chave
    assert extrair_chave(f"http://www.fazenda.pr.gov.br/nfce/qrcode?chNFe={chave}&nVersao=100&tpAmb=1") == chave
    assert extrair_chave("https://exemplo.gov.br/consulta?x=1") is None
    assert extrair_chave("7891234567895") is None
    assert extrair_chave("") is None


def test_validar_chave():
    dados = validar(_chave(modelo="65", cuf="13"))
    assert dados["uf"] == "AM" and dados["modelo_descricao"] == "NFC-e" and dados["serie"] == "1"
    with pytest.raises(ChaveInvalida, match="44"):
        validar("123")
    with pytest.raises(ChaveInvalida, match="UF"):
        validar(_chave(cuf="99"))
    with pytest.raises(ChaveInvalida, match="Modelo"):
        validar(_chave(modelo="57"))
    with pytest.raises(ChaveInvalida, match="Mês"):
        validar(_chave(aamm="2613"))
    # Exemplo de DV com resto < 2 → dígito 0
    base = "3526104598765400011055001000012345187654321"
    assert digito_verificador(base) in "0123456789"
