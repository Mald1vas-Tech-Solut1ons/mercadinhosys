"""Lote backend: família/fiscal na importação, família "eletro", /api/health enxuto e
nenhuma senha fixa criada pelo backend.

1. Importação por planilha resolve a família como o cadastro individual (coluna "familia"
   ou NCM), grava perfil fiscal/CFOP/CSOSN/alíquota sugeridos e registra o EAN novo no
   Catálogo Mestre (via='csv').
2. Família "eletro": no mix de mercearia e genérico, sugestão 102/5102 que pergunta a ST,
   atributos de eletro no schema, e com ST + CEST sai CSOSN 500 / CFOP 5405 na NFC-e.
3. GET /api/health sem login não expõe CPU, memória nem disco.
4. A conta demo não nasce (nem continua) com a senha fixa "demo123".
"""
import io
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from flask_jwt_extended import create_access_token

from app.models import CatalogoMestre, Estabelecimento, Funcionario, Produto
from app.services.fiscal import emissao_service
from app.services.taxonomia_service import nome_categoria_loja
from app.services.view_schema_service import (
    MIX_PADRAO_POR_SEGMENTO,
    inferir_perfil_fiscal_padrao,
    invalidar_cache_view_schema,
    resolver_view_schema,
    sugestao_fiscal_para_familia,
)

CABECALHO = "nome;categoria;preco_custo;preco_venda;codigo_barras;codigo_interno;marca;unidade;estoque;lote;data_validade;ncm"


def _ean(base12: str) -> str:
    soma = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(base12))
    return base12 + str((10 - soma % 10) % 10)


def _ctx(session, segmento="mercearia", configuracoes=None):
    invalidar_cache_view_schema()
    estab = session.query(Estabelecimento).first()
    estab.segmento = segmento
    estab.configuracoes = configuracoes or {}
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "ADMIN"})
    return dict(estab=estab, admin=admin, headers={"Authorization": f"Bearer {token}"})


def _importar(client, ctx, texto):
    r = client.post("/api/produtos/importar", headers=ctx["headers"], content_type="multipart/form-data",
                    data={"arquivo": (io.BytesIO(texto.encode("utf-8")), "planilha.csv")})
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


def _p(nome):
    return Produto.query.filter_by(nome=nome).one()


# ---------------------------------------------------------------------------
# 1. Importação com família e fiscal
# ---------------------------------------------------------------------------
def test_importacao_infere_familia_pelo_ncm_na_mercearia(client, session):
    ctx = _ctx(session, "mercearia")
    ean_perfume = _ean("789700000001")
    body = _importar(client, ctx, CABECALHO + "\n"
                     f"Perfume Floral 100ml;Perfumes Femininos;40;89,90;{ean_perfume};;;UN;5;;;33030010\n"
                                          "Camiseta Preta M;Outros Alimentos;15;39,90;;;;UN;8;;;61091000\n"
                                          "Liquidificador 600W;Outros Eletro;80;149,90;;;;UN;3;;;85094050\n"
                                          "Arroz 5kg;Arroz;19;27,90;;;;UN;10;;;10063021\n"
                                          "Pao Frances;Pães e Bolos Industrializados;9;16,90;;;;KG;8;;;\n")
    assert body["total_importados"] == 5, body

    perfume = _p("Perfume Floral 100ml")
    assert perfume.familia_produto == "perfumaria_higiene"
    assert perfume.perfil_fiscal == "perfumaria_higiene"
    assert (perfume.csosn, perfume.cst_icms, perfume.cfop_padrao) == ("102", "00", "5102")
    assert perfume.icms_aliquota == Decimal("18")
    assert perfume.icms_st is False  # ST nunca é marcada pela importação

    # Vestuário não está no mix da mercearia: cai na família padrão do segmento.
    assert _p("Camiseta Preta M").familia_produto == "alimento"

    liquidificador = _p("Liquidificador 600W")
    assert liquidificador.familia_produto == "eletro"
    assert liquidificador.perfil_fiscal == "eletro"
    assert (liquidificador.csosn, liquidificador.cfop_padrao) == ("102", "5102")

    for nome in ("Arroz 5kg", "Pao Frances"):
        prod = _p(nome)
        assert prod.familia_produto == "alimento"
        assert prod.perfil_fiscal == "mercearia_padrao"
        assert prod.icms_aliquota == Decimal("7")
        assert prod.tipo_item == "produto"


def test_importacao_no_generico_separa_roupa_e_calcado_pelo_capitulo(client, session):
    ctx = _ctx(session, "generico")
    body = _importar(client, ctx, CABECALHO + "\n"
                     "Calca Jeans 40;Jeans;55;119,90;;;;UN;4;;;62034200\n"
                                          "Tenis Corrida 41;Tênis Esportivo;90;199,90;;;;PAR;2;;;64041100\n")
    assert body["total_importados"] == 2, body
    calca = _p("Calca Jeans 40")
    assert calca.familia_produto == "vestuario"
    assert calca.perfil_fiscal == "vestuario_padrao"
    assert calca.csosn == "500" and calca.cfop_padrao == "5102"
    tenis = _p("Tenis Corrida 41")
    assert tenis.familia_produto == "calcados"
    assert tenis.perfil_fiscal == "calcados"
    assert tenis.csosn == "102" and tenis.cfop_padrao == "5102"


def test_importacao_sem_eletro_no_mix_usa_familia_padrao(client, session):
    ctx = _ctx(session, "mercearia", {"mix_produtos": ["bebida", "alimento"]})
    body = _importar(client, ctx, CABECALHO + "\nSecador 2000W;Refrigerantes;60;129,90;;;;UN;2;;;85163100\n")
    assert body["total_importados"] == 1, body
    assert _p("Secador 2000W").familia_produto == "bebida"  # 1ª do mix configurado


def test_importacao_coluna_familia_por_chave_ou_nome(client, session):
    ctx = _ctx(session, "mercearia")
    body = _importar(client, ctx, CABECALHO + ";Família\n"
                     "Air Fryer 4L;Outros Eletro;250;399,90;;;;UN;2;;;;eletro e eletroportateis\n"
                                          "Assadeira Redonda;Panelas;20;39,90;;;;UN;6;;;;  BAZAR \n"
                                          "Sabonete 85g;Outros Cosméticos;1;2,49;;;;UN;60;;;34011190;Perfumaria e Higiene\n"
                                          "Coisa Estranha;Outros Alimentos;1;2;;;;UN;1;;;;foguetes\n"
                                          "Pastilha de Freio;Outros Alimentos;30;59,90;;;;UN;1;;;;Autopeças\n")
    assert body["total_importados"] == 3, body
    assert body["total_erros"] == 2, body
    assert _p("Air Fryer 4L").familia_produto == "eletro"
    assert _p("Assadeira Redonda").familia_produto == "bazar"
    assert _p("Assadeira Redonda").perfil_fiscal == "bazar_padrao"
    assert _p("Sabonete 85g").familia_produto == "perfumaria_higiene"
    assert any("foguetes" in e and "não existe" in e for e in body["erros"]), body["erros"]
    assert any("Autopeças" in e and "mix" in e for e in body["erros"]), body["erros"]


def test_importacao_coluna_familia_vence_o_ncm(client, session):
    ctx = _ctx(session, "generico")
    _importar(client, ctx, CABECALHO + ";familia\nKit Presente;Panelas;20;49,90;;;;UN;3;;;33030010;bazar\n")
    assert _p("Kit Presente").familia_produto == "bazar"


def test_importacao_registra_ean_novo_no_catalogo_mestre(client, session):
    ctx = _ctx(session, "mercearia")
    ean = _ean("789700000099")
    _importar(client, ctx, CABECALHO + f"\nCafe Especial 250g;Café;20;34,90;{ean};;Torra Boa;UN;5;;;09012100\n")
    item = CatalogoMestre.query.filter_by(ean=ean).one()
    assert item.descoberto_via == "csv"
    assert item.nome == "Cafe Especial 250g"
    assert item.ncm == "09012100"
    # Catálogo guarda o nome OFICIAL qualificado da categoria (taxonomia, PLANO §3.3 #6)
    assert item.categoria == nome_categoria_loja("alimento", "Café, Chá e Achocolatados")
    assert item.descoberto_por_estabelecimento_id == ctx["estab"].id


# ---------------------------------------------------------------------------
# 2. Família eletro
# ---------------------------------------------------------------------------
def test_familia_eletro_no_mix_e_sugestao():
    for segmento in ("mercearia", "generico"):
        assert "eletro" in MIX_PADRAO_POR_SEGMENTO[segmento]
    assert inferir_perfil_fiscal_padrao("eletro") == "eletro"
    sug = sugestao_fiscal_para_familia("eletro")
    assert (sug["csosn_sugerido"], sug["cst_icms_sugerido"], sug["cfop_padrao_sugerido"]) == ("102", "00", "5102")
    assert sug["icms_st_a_confirmar"] is True
    assert "confirme com o contador se este NCM tem ICMS-ST no seu estado" in sug["observacao_fiscal"]
    assert {e["ncm"] for e in sug["ncm_exemplos"]} == {"8509", "8516", "8418", "8450"}


def test_schema_eletro_tem_voltagem_garantia_e_modelo(session):
    ctx = _ctx(session, "mercearia")
    schema = resolver_view_schema(ctx["estab"], familia_produto="eletro")
    assert schema["familia_produto"]["chave"] == "eletro"
    assert schema["familia_produto"]["nome"] == "Eletroportáteis e Eletrodomésticos"
    assert schema["familia_produto"]["perfil_fiscal_padrao"] == "eletro"
    assert "eletro" in [f["chave"] for f in schema["familias_disponiveis"]]
    campos = {c["chave"]: c for c in schema["campos"]}
    assert campos["voltagem_eletro"]["opcoes"] == ["110V", "220V", "Bivolt"]
    assert campos["garantia_meses"]["unidade"] == "meses"
    assert "modelo" in campos
    assert "controlar_validade" not in campos
    assert schema["flags"]["usa_validade"] is False
    # Os campos de eletro não vazam para outras famílias.
    alimento = resolver_view_schema(ctx["estab"], familia_produto="alimento")
    assert not {"voltagem_eletro", "garantia_meses", "modelo"} & {c["chave"] for c in alimento["campos"]}


def test_atributo_cor_nas_familias_nao_alimentares(client, session):
    ctx = _ctx(session, "generico")
    for familia in ("bazar", "eletro", "embalagem_descartavel", "construcao_leve", "construcao_eletrica",
                    "construcao_hidraulica", "construcao_ferragem", "cama_mesa_banho", "brinquedos", "bebe"):
        campos = {c["chave"]: c for c in resolver_view_schema(ctx["estab"], familia_produto=familia)["campos"]}
        assert "cor" in campos, familia
        assert campos["cor"]["tipo"] == "select" and campos["cor"]["permite_custom"] is True
    # Comida, suplemento, limpeza e cosmético não têm cor (cosmético usa "tom"); vestuário segue com a grade "cores".
    for familia in ("alimento", "bebida", "vestuario", "suplementos", "perfumaria_higiene", "limpeza", "pet"):
        chaves = {c["chave"] for c in resolver_view_schema(ctx["estab"], familia_produto=familia)["campos"]}
        assert "cor" not in chaves, familia

    r = client.post("/api/produtos/", headers=ctx["headers"], json={
        "entrar_sem_estoque": True,  # guardião: estoque 0 só com exceção consciente
        "nome": "Assadeira Redonda 28cm", "subcategoria": "Panelas", "preco_custo": 20, "preco_venda": 39.9,
        "familia_produto": "bazar", "atributos": {"cor": "Vermelho"}, "entrar_sem_estoque": True,
    })
    assert r.status_code == 201, r.get_data(as_text=True)
    assert session.get(Produto, r.get_json()["produto"]["id"]).atributos == {"cor": "Vermelho"}


def test_comprovante_mostra_hora_da_loja_e_nao_utc():
    from app.routes.pdv import _data_venda_local
    utc_naive = datetime(2026, 10, 27, 19, 10, 0)  # como o banco grava (UTC)
    assert _data_venda_local(utc_naive, "SP") == "27/10/2026 16:10:00"
    assert _data_venda_local(utc_naive, "AM") == "27/10/2026 15:10:00"
    assert _data_venda_local(utc_naive, None) == "27/10/2026 16:10:00"
    # Virada do dia: 01h UTC ainda é o dia anterior na loja.
    assert _data_venda_local(datetime(2026, 10, 28, 1, 30), "SP") == "27/10/2026 22:30:00"
    assert _data_venda_local("2026-10-27T19:10:00Z", "SP") == "27/10/2026 16:10:00"
    assert _data_venda_local("2026-10-27T16:10:00-03:00", "SP") == "27/10/2026 16:10:00"


def test_produto_eletro_com_st_sai_csosn_500_cfop_5405(client, session):
    ctx = _ctx(session, "mercearia")
    r = client.post("/api/produtos/", headers=ctx["headers"], json={
        "entrar_sem_estoque": True,  # guardião: estoque 0 só com exceção consciente
        "nome": "Liquidificador 600W 2L", "subcategoria": "Liquidificadores", "preco_custo": 80, "preco_venda": 149.9,
        "familia_produto": "eletro", "ncm": "85094050", "icms_st": True, "cest": "2104400",
        "atributos": {"voltagem_eletro": "Bivolt", "garantia_meses": 12, "modelo": "L-99"},
        "entrar_sem_estoque": True,
    })
    assert r.status_code == 201, r.get_data(as_text=True)
    prod = session.get(Produto, r.get_json()["produto"]["id"])
    assert prod.familia_produto == "eletro" and prod.perfil_fiscal == "eletro"
    assert prod.csosn == "102" and prod.cfop_padrao == "5102"  # a sugestão; a ST decide na emissão
    assert prod.atributos == {"voltagem_eletro": "Bivolt", "garantia_meses": 12.0, "modelo": "L-99"}

    estab = SimpleNamespace(regime_tributario="SIMPLES NACIONAL", cnpj="12345678000195", estado="SP",
                            razao_social="Loja Mista Ltda")
    item = SimpleNamespace(produto=prod, produto_unidade="UN", quantidade=Decimal("1"),
                           preco_unitario=Decimal("149.9"), total_item=Decimal("149.9"),
                           produto_codigo="P1", produto_nome=prod.nome)
    venda = SimpleNamespace(itens=[item], pagamentos=[], total=Decimal("149.9"),
                            data_venda=datetime(2026, 10, 20, 15, 0), cliente=None)
    linha = emissao_service._build_payload(venda, estab, numero=1, serie=1)["items"][0]
    assert linha["icms_situacao_tributaria"] == "500"
    assert linha["cfop"] == "5405"
    assert linha["codigo_cest"] == "2104400"


# ---------------------------------------------------------------------------
# 3. /api/health público
# ---------------------------------------------------------------------------
def test_health_publico_nao_expoe_metricas_da_maquina(client, session):
    r = client.get("/api/health")
    assert r.status_code == 200, r.get_data(as_text=True)
    body = r.get_json()
    assert set(body) == {"status", "service", "version", "timestamp", "database", "cache"}
    assert body["status"] == "healthy" and body["database"] == {"status": "connected"}
    texto = r.get_data(as_text=True)
    for proibido in ("system", "cpu", "memory", "disk"):
        assert proibido not in texto
    assert client.get("/api/ready").status_code == 200


# ---------------------------------------------------------------------------
# 4. Sem senha fixa na conta demo
# ---------------------------------------------------------------------------
def test_conta_demo_nao_usa_senha_fixa(client, session):
    r = client.post("/api/auth/demo", json={})
    assert r.status_code == 200, r.get_data(as_text=True)
    demo = Funcionario.query.filter_by(username="demo").one()
    assert demo.check_senha("demo123") is False

    # Conta demo antiga, criada com a senha fixa, é trocada no próximo acesso.
    demo.set_senha("demo123")
    session.commit()
    r = client.post("/api/auth/demo", json={})
    assert r.status_code == 200, r.get_data(as_text=True)
    session.expire_all()
    assert Funcionario.query.filter_by(username="demo").one().check_senha("demo123") is False
