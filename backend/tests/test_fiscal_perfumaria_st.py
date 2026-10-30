"""Perfumaria/higiene: PIS/COFINS monofásico por NCM e ICMS por substituição tributária.

Prova: (1) a detecção de monofásico (Lei 10.147/2000) por NCM, inclusive o Ex 01
excluído; (2) a família "perfumaria_higiene" entra no mix e pergunta a ST em vez
de marcar; (3) produto marcado com ST sai na NFC-e com CSOSN 500 / CST 60 e CFOP
5405 e exige CEST; (4) produto sem ST e alimentos/vestuário continuam iguais.
"""
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto, db
from app.services.fiscal import emissao_service, gateways
from app.services.fiscal.tributacao import (
    cst_pis_cofins_saida,
    eh_pis_cofins_monofasico,
)
from app.services.view_schema_service import (
    MIX_PADRAO_POR_SEGMENTO,
    inferir_perfil_fiscal_padrao,
    resolver_view_schema,
    sugestao_fiscal_para_familia,
)


# ---------------------------------------------------------------------------
# 1. Detecção de monofásico por NCM (função pura)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("ncm", [
    "33030010",      # perfume
    "3303.00.20",    # água-de-colônia, com pontuação
    "33049990",      # creme
    "33051000",      # xampu
    "33061000",      # creme dental (33.06 está no intervalo "33.03 a 33.07")
    "33072010",      # desodorante
    "34011190",      # sabonete
    "34012010",      # sabão de toucador em outras formas
    "96032100",      # escova de dentes
])
def test_ncm_monofasico_positivo(ncm):
    assert eh_pis_cofins_monofasico(ncm) is True


@pytest.mark.parametrize("ncm", [
    "33021000",   # 33.02 (misturas odoríferas) fica fora
    "33080000",   # fora do intervalo
    "34011110",   # 3401.11.10 não é um dos códigos da lei
    "34012090",   # 3401.20.90 também não
    "96032900",   # outras escovas
    "22021000",   # refrigerante
    "61091000",   # camiseta
    "3303",       # NCM incompleto não é classificado
    "00000000",
    "",
    None,
])
def test_ncm_monofasico_negativo(ncm):
    assert eh_pis_cofins_monofasico(ncm) is False


def test_sabonete_ex_01_fica_fora_do_monofasico():
    assert eh_pis_cofins_monofasico("34011190", ex_tipi="01") is False
    assert eh_pis_cofins_monofasico("34011190", ex_tipi="1") is False
    assert eh_pis_cofins_monofasico("34011190", ex_tipi="02") is True
    # O Ex só exclui o 3401.11.90; em outro código não muda nada.
    assert eh_pis_cofins_monofasico("33051000", ex_tipi="01") is True


def test_cst_pis_cofins_por_regime():
    assert cst_pis_cofins_saida("33051000", "LUCRO PRESUMIDO") == "04"
    assert cst_pis_cofins_saida("33051000", "LUCRO REAL") == "04"
    assert cst_pis_cofins_saida("33051000", "SIMPLES NACIONAL") == "49"
    assert cst_pis_cofins_saida("22021000", "LUCRO PRESUMIDO") == "49"
    assert cst_pis_cofins_saida("22021000", "SIMPLES NACIONAL") == "49"


# ---------------------------------------------------------------------------
# 2. Família nova no mix e sugestão fiscal
# ---------------------------------------------------------------------------
def test_familia_perfumaria_no_mix_padrao():
    for segmento in ("mercearia", "generico", "vestuario"):
        assert "perfumaria_higiene" in MIX_PADRAO_POR_SEGMENTO[segmento]
    assert inferir_perfil_fiscal_padrao("perfumaria_higiene") == "perfumaria_higiene"


def test_sugestao_perfumaria_pergunta_st_e_nao_marca():
    sug = sugestao_fiscal_para_familia("perfumaria_higiene")
    assert sug["icms_st_a_confirmar"] is True
    # Não decide a ST: segue CSOSN 102 / CFOP 5102 até o operador marcar.
    assert sug["csosn_sugerido"] == "102"
    assert sug["cfop_padrao_sugerido"] == "5102"
    assert "contador" in sug["observacao_fiscal"]
    assert {e["ncm"] for e in sug["ncm_exemplos"]} >= {"33030010", "33049990", "33051000", "34011190"}


def test_schema_mercearia_lista_perfumaria_e_expoe_regras(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "mercearia"
    estab.configuracoes = {}
    session.commit()

    schema = resolver_view_schema(estab, familia_produto="perfumaria_higiene")

    assert schema["familia_produto"]["chave"] == "perfumaria_higiene"
    assert schema["familia_produto"]["nome"] == "Perfumaria e Higiene"
    assert schema["familia_produto"]["perfil_fiscal_padrao"] == "perfumaria_higiene"
    assert "perfumaria_higiene" in [f["chave"] for f in schema["familias_disponiveis"]]
    assert schema["sugestao_fiscal"]["icms_st_a_confirmar"] is True
    regras = schema["regras_fiscais"]
    assert "3306" in regras["pis_cofins_monofasico"]["posicoes"]
    assert regras["icms_st"] == {"csosn": "500", "cst_icms": "60", "cfop": "5405", "exige_cest": True}


def test_sugestao_de_alimento_e_vestuario_nao_mudou():
    alimento = sugestao_fiscal_para_familia("alimento")
    vestuario = sugestao_fiscal_para_familia("vestuario")
    assert (alimento["csosn_sugerido"], alimento["cst_icms_sugerido"], alimento["cfop_padrao_sugerido"],
            alimento["icms_aliquota_sugerida"]) == ("102", "00", "5102", 7.0)
    assert (vestuario["csosn_sugerido"], vestuario["cst_icms_sugerido"], vestuario["cfop_padrao_sugerido"],
            vestuario["icms_aliquota_sugerida"]) == ("500", "60", "5102", 18.0)
    assert alimento["icms_st_a_confirmar"] is False and vestuario["icms_st_a_confirmar"] is False
    assert alimento["ncm_exemplos"] == [] and vestuario["ncm_exemplos"] == []


# ---------------------------------------------------------------------------
# 3. Payload da NFC-e (sem SEFAZ): ST, monofásico e comportamento inalterado
# ---------------------------------------------------------------------------
def _produto_fake(**campos):
    base = dict(id=1, ncm="22021000", origem=0, cest=None, cfop_padrao="5102", csosn="102",
                cst_icms="00", icms_st=False, unidade_medida="UN", unidade_tributavel=None)
    base.update(campos)
    return SimpleNamespace(**base)


def _payload(prod, regime="SIMPLES NACIONAL"):
    estab = SimpleNamespace(regime_tributario=regime, cnpj="12345678000195", estado="SP",
                            razao_social="Loja Mista Ltda")
    item = SimpleNamespace(produto=prod, produto_unidade="UN", quantidade=Decimal("1"),
                           preco_unitario=Decimal("10"), total_item=Decimal("10"),
                           produto_codigo="P1", produto_nome="Item")
    venda = SimpleNamespace(itens=[item], pagamentos=[], total=Decimal("10"),
                            data_venda=datetime(2026, 10, 22, 15, 0), cliente=None)
    return emissao_service._build_payload(venda, estab, numero=1, serie=1)["items"][0]


def test_produto_com_st_no_simples_sai_csosn_500_cfop_5405():
    item = _payload(_produto_fake(ncm="33030010", icms_st=True, cest="2000100"))
    assert item["icms_situacao_tributaria"] == "500"
    assert item["cfop"] == "5405"
    assert item["codigo_cest"] == "2000100"
    assert item["pis_situacao_tributaria"] == "49"   # Simples: CST que o emissor já usava


def test_produto_com_st_no_regime_normal_sai_cst_60_e_pis_04():
    item = _payload(_produto_fake(ncm="33051000", icms_st=True, cest="2002800"), regime="LUCRO PRESUMIDO")
    assert item["icms_situacao_tributaria"] == "60"
    assert item["cfop"] == "5405"
    assert item["pis_situacao_tributaria"] == "04"
    assert item["cofins_situacao_tributaria"] == "04"


def test_sabonete_em_bazar_sem_st_e_monofasico_no_regime_normal():
    """A regra do monofásico vale por NCM, qualquer que seja a família."""
    item = _payload(_produto_fake(ncm="34011190", csosn="102", cst_icms="00"), regime="LUCRO REAL")
    assert item["pis_situacao_tributaria"] == "04"
    assert item["icms_situacao_tributaria"] == "00"
    assert item["cfop"] == "5102"


@pytest.mark.parametrize("regime", ["SIMPLES NACIONAL", "LUCRO PRESUMIDO"])
def test_produto_sem_st_mantem_o_cadastro(regime):
    # Alimento comum
    item = _payload(_produto_fake(ncm="19053100", csosn="102", cst_icms="00", cfop_padrao="5102"), regime)
    assert item["cfop"] == "5102"
    assert item["icms_situacao_tributaria"] == ("102" if "SIMPLES" in regime else "00")
    assert item["pis_situacao_tributaria"] == "49"
    assert "codigo_cest" not in item
    # Vestuário com o CSOSN 500 que a sugestão da família já punha: nada muda.
    item = _payload(_produto_fake(ncm="61091000", csosn="500", cst_icms="60", cfop_padrao="5102"), regime)
    assert item["cfop"] == "5102"
    assert item["icms_situacao_tributaria"] == ("500" if "SIMPLES" in regime else "60")
    assert item["pis_situacao_tributaria"] == "49"


# ---------------------------------------------------------------------------
# 4. Cadastro pela API e trava de produção
# ---------------------------------------------------------------------------
@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "mercearia"
    estab.configuracoes = {}
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Perfumaria")
    session.add(cat)
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, cat=cat, headers={"Authorization": f"Bearer {token}"})


def _novo(client, ctx, **campos):
    # O foco destes testes é o fiscal; o estoque entra pela exceção consciente
    # do guardião (entrar_sem_estoque) — o mesmo caminho do lojista real.
    corpo = {"nome": "Perfume Floral 100ml", "categoria": "Perfumaria", "preco_custo": 40,
             "preco_venda": 89.9, "familia_produto": "perfumaria_higiene", "ncm": "33030010",
             "entrar_sem_estoque": True}
    corpo.update(campos)
    corpo.setdefault("entrar_sem_estoque", True)  # guardião: estoque 0 só com exceção consciente
    corpo.setdefault("entrar_sem_estoque", True)  # guardião: estoque 0 só com exceção consciente
    return client.post("/api/produtos/", headers=ctx["headers"], json=corpo)


def test_cadastro_perfumaria_sem_st_nao_marca_st_sozinho(client, ctx):
    r = _novo(client, ctx)
    assert r.status_code == 201, r.get_data(as_text=True)
    prod = r.get_json()["produto"]
    assert prod["familia_produto"] == "perfumaria_higiene"
    assert prod["perfil_fiscal"] == "perfumaria_higiene"
    assert prod["icms_st"] is False
    assert prod["csosn"] == "102" and prod["cfop_padrao"] == "5102"
    assert prod["pis_cofins_monofasico"] is True
    assert prod["ncm"] == "33030010"   # o NCM é o que o operador digitou


def test_cadastro_com_st_exige_cest(client, ctx):
    r = _novo(client, ctx, icms_st=True)
    assert r.status_code == 400
    assert any("CEST" in e for e in r.get_json()["errors"])

    r = _novo(client, ctx, icms_st=True, cest="2000100", codigo_barras="7890000000017")
    assert r.status_code == 201, r.get_data(as_text=True)
    prod = r.get_json()["produto"]
    assert prod["icms_st"] is True and prod["cest"] == "2000100"

    # Edição: marcar ST num produto sem CEST é recusado; com CEST passa.
    sem_cest = _novo(client, ctx, nome="Xampu 350ml", ncm="33051000", codigo_barras="7890000000024")
    pid = sem_cest.get_json()["produto"]["id"]
    r = client.put(f"/api/produtos/{pid}", headers=ctx["headers"], json={"icms_st": True})
    assert r.status_code == 400
    assert db.session.get(Produto, pid).icms_st is False
    r = client.put(f"/api/produtos/{pid}", headers=ctx["headers"], json={"icms_st": True, "cest": "2002800"})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert db.session.get(Produto, pid).icms_st is True


def test_producao_bloqueia_item_com_st_sem_cest(client, session, ctx):
    p = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["cat"].id, nome="Perfume",
                preco_custo=Decimal("40"), preco_venda=Decimal("90"), quantidade=Decimal("5"),
                ncm="33030010", cfop_padrao="5102", csosn="102", icms_st=True, cest=None)
    session.add(p)
    session.commit()
    estab = ctx["estab"]
    venda = SimpleNamespace(itens=[SimpleNamespace(produto=p, produto_nome="Perfume")])
    with pytest.raises(emissao_service.EmissaoError) as exc:
        emissao_service._validar_cadastro_fiscal_producao(venda, estab)
    assert "CEST" in str(exc.value)

    p.cest = "2000100"
    session.commit()
    emissao_service._validar_cadastro_fiscal_producao(venda, estab)  # não levanta


def test_emissao_real_envia_st_ao_gateway(client, session, ctx, monkeypatch):
    """Venda pela API → emitir_nfce em produção (gateway mockado): o item com ST
    chega ao gateway com CSOSN 500, CFOP 5405 e CEST."""
    estab = ctx["estab"]
    p = Produto(estabelecimento_id=estab.id, categoria_id=ctx["cat"].id, nome="Desodorante Aerosol",
                preco_custo=Decimal("8"), preco_venda=Decimal("15"), quantidade=Decimal("10"),
                ncm="33072010", cfop_padrao="5102", csosn="102", origem=0, icms_st=True, cest="2001000")
    session.add(p)
    session.commit()
    resp = client.post("/api/vendas/", headers=ctx["headers"], json={
        "items": [{"productId": p.id, "quantity": 1, "price": 15.0}],
        "subtotal": 15.0, "total": 15.0,
        "pagamentos": [{"forma_pagamento": "dinheiro", "valor": 15.0}],
    })
    assert resp.status_code in (200, 201), resp.get_data(as_text=True)
    from app.models import Venda
    venda = Venda.query.filter_by(codigo=resp.get_json()["venda"]["codigo"]).first()

    estab.regime_tributario = "SIMPLES NACIONAL"
    estab.fiscal_ambiente = "producao"
    estab.fiscal_gateway = "focusnfe"
    estab.fiscal_token = "tok_fake"
    session.commit()

    enviados = []

    def _emitir(self, payload, ref):
        enviados.append(payload)
        return {"status": "autorizado", "chave": "1" * 44, "protocolo": "X", "numero": "1", "serie": "1"}

    monkeypatch.setattr(gateways.FocusNFeGateway, "emitir", _emitir)
    doc = emissao_service.emitir_nfce(venda, estab, funcionario_id=1)
    assert doc.status == "autorizado"
    item = enviados[0]["items"][0]
    assert item["icms_situacao_tributaria"] == "500"
    assert item["cfop"] == "5405"
    assert item["codigo_cest"] == "2001000"
