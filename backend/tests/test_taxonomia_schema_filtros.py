"""Leitura da taxonomia oficial: schema com a árvore (PLANO §3.4) e filtros por chave.

Prova que `resolver_view_schema` devolve `taxonomia` da família (mantendo `categorias_sugeridas`),
que a sugestão do catálogo traz a subcategoria resolvida (ou None) e que a lista de produtos
filtra por `categoria_oficial`/`subcategoria_oficial`, aceitando chave ou nome.
"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CatalogoMestre, CategoriaProduto, Estabelecimento, Funcionario, Produto,
)
from app.services.taxonomia_service import chave_categoria, chave_subcategoria, garantir_categoria_loja
from app.services.view_schema_service import invalidar_cache_view_schema


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    session.add(Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="TAX-S",
                      saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                      data_abertura=datetime.now(timezone.utc)))
    session.commit()
    invalidar_cache_view_schema()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    yield dict(estab=estab, admin=admin, headers={"Authorization": f"Bearer {token}"})
    invalidar_cache_view_schema()


def _sub_chave(familia, categoria, indice=0):
    """Chave da subcategoria de posição `indice` na categoria (sem adivinhar nomes)."""
    from app.services.catalogo_familias import TAXONOMIA

    return chave_subcategoria(familia, categoria, TAXONOMIA[familia][categoria][indice])


def _produto(session, ctx, nome, subcategoria_chave, quantidade=5):
    from app.services.catalogo_familias import TAXONOMIA, slug
    familia, categoria_chave, _sub = subcategoria_chave.split(".")
    categoria_nome = next(n for n in TAXONOMIA[familia] if slug(n) == categoria_chave)
    produto = Produto(
        estabelecimento_id=ctx["estab"].id,
        categoria_id=garantir_categoria_loja(ctx["estab"].id,
                                             chave_categoria(familia, categoria_nome)).id,
        nome=nome, familia_produto=familia,
        categoria_oficial=chave_categoria(familia, categoria_nome),
        subcategoria_oficial=subcategoria_chave,
        preco_custo=Decimal("10"), preco_venda=Decimal("20"), quantidade=Decimal(str(quantidade)),
    )
    session.add(produto)
    session.commit()
    return produto


# ───────────────────────── schema com a árvore (PLANO §3.4) ─────────────────────────

def test_view_schema_de_bazar_traz_a_arvore_com_cozinha_e_panelas(client, ctx):
    r = client.get("/api/view-schema/?familia_produto=bazar", headers=ctx["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)
    schema = r.get_json()["schema"]

    assert schema["familia_produto"]["chave"] == "bazar"
    assert "categorias_sugeridas" in schema  # o front atual não pode quebrar
    arvore = schema["taxonomia"]
    assert isinstance(arvore, list) and arvore

    cozinha = next(c for c in arvore if c["nome"] == "Cozinha")
    assert cozinha["chave"] == chave_categoria("bazar", "Cozinha")
    panelas = next(s for s in cozinha["subcategorias"] if s["nome"] == "Panelas")
    assert panelas["chave"] == chave_subcategoria("bazar", "Cozinha", "Panelas")
    # Toda categoria traz subcategorias com chave e nome (contrato do CategoriaPicker).
    for categoria in arvore:
        assert categoria["chave"] and categoria["nome"]
        for sub in categoria["subcategorias"]:
            assert sub["chave"].startswith(categoria["chave"] + ".")
            assert sub["nome"]


def test_view_schema_de_cada_familia_tem_outros_e_chave_coerente(client, ctx):
    from app.services.catalogo_familias import TAXONOMIA

    for familia in ("alimento", "bebida", "bazar", "servico"):
        r = client.get(f"/api/view-schema/?familia_produto={familia}", headers=ctx["headers"])
        assert r.status_code == 200
        arvore = r.get_json()["schema"]["taxonomia"]
        assert [c["nome"] for c in arvore] == list(TAXONOMIA[familia])


# ───────────────────── sugestão do catálogo com subcategoria ─────────────────────

def test_sugestao_do_catalogo_devolve_a_subcategoria_resolvida_ou_none(client, session, ctx):
    session.add_all([
        CatalogoMestre(ean="7894900011517", status="encontrado", nome="PANELA DE PRESSÃO 4,5L",
                       categoria="Panelas", familia_produto="bazar", marca="Marca",
                       preco_referencia=Decimal("10"), ncm="76151000"),
        CatalogoMestre(ean="7894900011524", status="encontrado", nome="TRELA INVENTADA",
                       categoria="Categoria Que Nao Existe", familia_produto="bazar", marca="Marca",
                       preco_referencia=Decimal("10"), ncm="76151000"),
    ])
    session.commit()

    ok = client.get("/api/produtos/catalogo/lookup/7894900011517", headers=ctx["headers"])
    assert ok.status_code == 200, ok.get_data(as_text=True)
    sugestoes = ok.get_json()["data"]["sugestoes"]
    assert sugestoes["familia_produto"] == "bazar"
    assert sugestoes["subcategoria"] == chave_subcategoria("bazar", "Cozinha", "Panelas")

    sem_casar = client.get("/api/produtos/catalogo/lookup/7894900011524", headers=ctx["headers"])
    assert sem_casar.status_code == 200
    assert sem_casar.get_json()["data"]["sugestoes"]["subcategoria"] is None


# ─────────────────── filtros da lista por chave oficial (PLANO §3.4) ───────────────────

def _lista(client, ctx, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return client.get(f"/api/produtos/?{query}", headers=ctx["headers"])


def _nomes(resposta):
    corpo = resposta.get_json()
    itens = corpo.get("produtos") if isinstance(corpo, dict) else corpo
    return sorted(p["nome"] for p in itens)


def test_filtro_por_subcategoria_oficial_devolve_so_os_produtos_dela(client, session, ctx):
    _produto(session, ctx, "PANELA 24CM", _sub_chave("bazar", "Cozinha", 0))
    _produto(session, ctx, "PANELA 20CM", _sub_chave("bazar", "Cozinha", 0))
    _produto(session, ctx, "PANO DE PRATO", _sub_chave("cama_mesa_banho", "Mesa e Cozinha", 0))

    r = _lista(client, ctx, subcategoria_oficial=_sub_chave("bazar", "Cozinha", 0))
    assert r.status_code == 200, r.get_data(as_text=True)
    assert _nomes(r) == ["PANELA 20CM", "PANELA 24CM"]

    # O mesmo filtro aceita o nome canônico ("PANELAS"), sem depender da chave.
    from app.services.catalogo_familias import TAXONOMIA

    por_nome = _lista(client, ctx, subcategoria_oficial=TAXONOMIA["bazar"]["Cozinha"][0].upper())
    assert _nomes(por_nome) == ["PANELA 20CM", "PANELA 24CM"]


def test_filtro_por_categoria_oficial_agrupa_as_subcategorias(client, session, ctx):
    _produto(session, ctx, "PANELA 24CM", _sub_chave("bazar", "Cozinha", 0))
    _produto(session, ctx, "COPO DE VIDRO", _sub_chave("bazar", "Cozinha", 1))
    _produto(session, ctx, "PANO DE PRATO", _sub_chave("cama_mesa_banho", "Mesa e Cozinha", 0))

    r = _lista(client, ctx, categoria_oficial=chave_categoria("bazar", "Cozinha"))
    assert r.status_code == 200, r.get_data(as_text=True)
    nomes = _nomes(r)
    assert "PANELA 24CM" in nomes and "COPO DE VIDRO" in nomes
    assert "PANO DE PRATO" not in nomes


def test_filtro_com_chave_fora_da_taxonomia_recusa_com_400(client, ctx):
    inventada = _lista(client, ctx, subcategoria_oficial="panela voadora")
    assert inventada.status_code == 400
    assert "taxonomia" in inventada.get_json()["error"]

    inventada_cat = _lista(client, ctx, categoria_oficial="categoria inventada")
    assert inventada_cat.status_code == 400
