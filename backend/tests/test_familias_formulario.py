"""Formulário por família: validade/fabricação/lote no cadastro, categorias prontas e campos certos."""
from datetime import date, timedelta

import pytest
from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Funcionario, Produto, ProdutoLote, MovimentacaoEstoque
from app.services.view_schema_service import (FAMILIAS_PRODUTO, MIX_PADRAO_POR_SEGMENTO, invalidar_cache_view_schema,
                                              resolver_view_schema)


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"
    session.commit()
    invalidar_cache_view_schema()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id,
                                                                           "role": "admin"})
    return dict(estab=estab, headers={"Authorization": f"Bearer {token}"})


def _hoje(dias=0):
    return (date.today() + timedelta(days=dias)).isoformat()


def _criar(client, ctx, **campos):
    base = {"nome": "VITAMINA C 1G 30 COMPRIMIDOS", "categoria": "Vitamina C", "preco_custo": 10,
            "preco_venda": 25, "quantidade": 12, "familia_produto": "suplementos"}
    base.update(campos)
    return client.post("/api/produtos/", headers=ctx["headers"], json=base)


def test_toda_familia_tem_categorias_prontas_e_entra_no_mix_generico():
    for chave, info in FAMILIAS_PRODUTO.items():
        if chave == "servico":
            continue
        assert len(info.get("categorias") or []) >= 6, chave
        assert len(set(info["categorias"])) == len(info["categorias"]), f"categoria repetida em {chave}"
    for nova in ("bebe", "pet", "limpeza", "jardinagem", "cama_mesa_banho", "papelaria", "brinquedos"):
        assert nova in MIX_PADRAO_POR_SEGMENTO["generico"]


def test_schema_leva_categorias_e_regras_de_validade(ctx):
    schema = resolver_view_schema(ctx["estab"], familia_produto="suplementos")
    assert "Vitamina C" in schema["categorias_sugeridas"]
    assert schema["flags"]["validade_obrigatoria"] is True and schema["flags"]["exige_fabricacao"] is True
    bazar = resolver_view_schema(ctx["estab"], familia_produto="bazar")
    assert bazar["flags"]["usa_validade"] is False and bazar["flags"]["validade_obrigatoria"] is False
    assert "Panelas" in bazar["categorias_sugeridas"]


@pytest.mark.parametrize("familia, tem, nao_tem", [
    ("suplementos", {"forma_apresentacao", "nutriente_principal", "publico"}, {"cor", "embalagem"}),
    ("bebe", {"idade_indicada", "livre_bpa", "certificacao_inmetro", "cor"}, {"embalagem"}),
    ("cama_mesa_banho", {"tamanho_cama", "fios", "cor"}, {"controlar_validade", "embalagem"}),
    ("jardinagem", {"tipo_jardim", "luminosidade"}, {"embalagem"}),
    ("pet", {"especie_pet", "porte_pet", "fase_pet"}, {"cor"}),
    ("limpeza", {"ambiente_limpeza", "fragrancia"}, {"cor"}),
    ("bebida", {"embalagem_bebida", "alcoolica"}, {"cor"}),
])
def test_cada_familia_mostra_so_os_campos_dela(ctx, familia, tem, nao_tem):
    chaves = {c["chave"] for c in resolver_view_schema(ctx["estab"], familia_produto=familia)["campos"]}
    assert tem <= chaves, tem - chaves
    assert not (nao_tem & chaves), nao_tem & chaves


def test_suplemento_com_estoque_exige_validade_e_fabricacao(client, session, ctx):
    r = _criar(client, ctx)
    assert r.status_code == 400 and "validade" in r.get_json()["message"]
    r = _criar(client, ctx, data_validade=_hoje(365))
    assert r.status_code == 400 and "fabricação" in r.get_json()["message"]


def test_fabricacao_depois_da_validade_e_recusada(client, session, ctx):
    r = _criar(client, ctx, data_validade=_hoje(30), data_fabricacao=_hoje(40))
    assert r.status_code == 400


def test_cadastro_com_validade_cria_o_lote_e_liga_a_movimentacao(client, session, ctx):
    r = _criar(client, ctx, data_validade=_hoje(365), data_fabricacao=_hoje(-10), lote="L2026A")
    assert r.status_code == 201, r.get_data(as_text=True)
    produto = session.get(Produto, r.get_json()["produto"]["id"])
    assert produto.controlar_validade is True
    lote = ProdutoLote.query.filter_by(produto_id=produto.id).one()
    assert lote.numero_lote == "L2026A" and float(lote.quantidade) == 12
    assert lote.data_validade.isoformat() == _hoje(365) and lote.data_fabricacao.isoformat() == _hoje(-10)
    mov = MovimentacaoEstoque.query.filter_by(produto_id=produto.id).one()
    assert mov.lote_id == lote.id


def test_lote_sem_numero_ganha_numero_automatico(client, session, ctx):
    r = _criar(client, ctx, nome="OMEGA 3 1000MG 120 CAPSULAS", data_validade=_hoje(200),
               data_fabricacao=_hoje(-5))
    assert r.status_code == 201, r.get_data(as_text=True)
    lote = ProdutoLote.query.filter_by(produto_id=r.get_json()["produto"]["id"]).one()
    assert lote.numero_lote.startswith("CAD-")


def test_bazar_nao_pede_validade(client, session, ctx):
    r = _criar(client, ctx, nome="PANELA ANTIADERENTE 24CM", categoria="Panelas", familia_produto="bazar",
               atributos={"cor": "Vermelho", "material": "Alumínio"})
    assert r.status_code == 201, r.get_data(as_text=True)
    produto = session.get(Produto, r.get_json()["produto"]["id"])
    assert produto.data_validade is None and ProdutoLote.query.filter_by(produto_id=produto.id).count() == 0
    assert produto.atributos == {"cor": "Vermelho", "material": "Alumínio"}


def test_atributo_de_outra_familia_e_descartado(client, session, ctx):
    """A "cor" da mamadeira não pode sobrar num suplemento (formulário trocou de família)."""
    r = _criar(client, ctx, nome="COLAGENO VERISOL 300G", data_validade=_hoje(300), data_fabricacao=_hoje(-3),
               atributos={"cor": "Rosa", "forma_apresentacao": "Pó"})
    assert r.status_code == 201, r.get_data(as_text=True)
    assert session.get(Produto, r.get_json()["produto"]["id"]).atributos == {"forma_apresentacao": "Pó"}


def test_grafico_dos_cards_usa_o_catalogo_inteiro(client, session, ctx):
    """Card dizia 3 esgotados e o gráfico (montado com a página da lista) mostrava 1 = 100%."""
    r = client.get("/api/produtos/estatisticas?ativos=true", headers=ctx["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)
    est = r.get_json()["estatisticas"]
    dist = est["distribuicao_categoria"]
    assert sum(c["value"] for c in dist["esgotado"]) == est["produtos_esgotados"]
    assert sum(c["value"] for c in dist["baixo"]) == est["produtos_baixo_estoque"]
    assert sum(c["value"] for c in dist["all"]) == est["total_produtos"]
    assert len(dist["all"]) <= 7  # 6 maiores + "Outras"
