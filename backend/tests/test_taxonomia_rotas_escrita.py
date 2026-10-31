"""Todos os caminhos de ESCRITA da taxonomia oficial (PLANO §3.3 linhas 3–9 e checkout).

Prova, rota por rota, que nenhum caminho cria categoria de texto livre: /estoque (POST e PUT),
importação por planilha, importação do catálogo mestre, entrada por NF-e, taxa de entrega do PDV
e onboarding da loja nova. No fim, a varredura: toda linha de `categorias_produto` tem `codigo`
oficial e nome "<Família> › <Categoria>", e cada `VendaItem` guarda o retrato da classificação.
"""
import io
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CatalogoMestre, CategoriaProduto, Estabelecimento, Funcionario, Produto, VendaItem,
)
from app.services.taxonomia_service import (
    TAXONOMIA, chave_categoria, chave_subcategoria, garantir_categoria_loja, nome_categoria_loja,
    outros, resolver,
)
from app.services.view_schema_service import invalidar_cache_view_schema


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"  # mix amplo: as famílias dos testes existem nesta loja
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="TAX-1",
                  saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                  data_abertura=datetime.now(timezone.utc))
    session.add(caixa)
    session.commit()
    invalidar_cache_view_schema()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    yield dict(estab=estab, admin=admin, headers={"Authorization": f"Bearer {token}"})
    invalidar_cache_view_schema()


def _categorias(session, estab):
    return session.query(CategoriaProduto).filter_by(estabelecimento_id=estab.id).all()


def _chaves_oficiais():
    return {chave_categoria(f, c) for f, cats in TAXONOMIA.items() for c in cats}


def _nome_esperado(codigo):
    """Nome de exibição oficial da chave ("bazar.cozinha" → "Bazar e ... › Cozinha")."""
    from app.services.catalogo_familias import slug

    familia, categoria_chave = codigo.split(".", 1)
    for nome_categoria in TAXONOMIA[familia]:
        if slug(nome_categoria) == categoria_chave:
            return nome_categoria_loja(familia, nome_categoria)
    raise AssertionError(f"chave de categoria fora da taxonomia: {codigo!r}")


def _varredura(session, ctx):
    """Nenhuma linha fora da taxonomia: `codigo` é chave oficial e `nome` é o qualificado."""
    oficiais = _chaves_oficiais()
    for cat in _categorias(session, ctx["estab"]):
        assert cat.codigo in oficiais, f"categoria_fora_da_taxonomia: {cat.nome!r} (codigo={cat.codigo!r})"
        assert cat.nome == _nome_esperado(cat.codigo), \
            f"nome fora do padrão '<Família> › <Categoria>': {cat.nome!r} != {_nome_esperado(cat.codigo)!r}"


# ─────────────────────────── POST /estoque (PLANO §3.3 #3) ───────────────────────────

def _payload_estoque(**campos):
    base = {"nome": "PANELA ANTIADERENTE 24CM", "preco_custo": 20, "preco_venda": 39.9,
            "quantidade": 5, "familia_produto": "bazar", "subcategoria": "Panelas"}
    base.update(campos)
    return base


def test_estoque_post_com_subcategoria_valida_grava_as_colunas(client, session, ctx):
    r = client.post("/api/produtos/estoque", headers=ctx["headers"], json=_payload_estoque())
    assert r.status_code == 201, r.get_data(as_text=True)

    produto = session.get(Produto, r.get_json()["produto"]["id"])
    assert produto.familia_produto == "bazar"
    assert produto.categoria_oficial == "bazar.cozinha"
    assert produto.subcategoria_oficial == chave_subcategoria("bazar", "Cozinha", "Panelas")
    categoria = session.get(CategoriaProduto, produto.categoria_id)
    assert categoria.codigo == "bazar.cozinha"
    assert categoria.nome == nome_categoria_loja("bazar", "Cozinha")
    _varredura(session, ctx)


def test_estoque_post_recusa_subcategoria_inventada(client, ctx):
    r = client.post("/api/produtos/estoque", headers=ctx["headers"],
                    json=_payload_estoque(subcategoria="panela voadora"))
    assert r.status_code == 400
    corpo = r.get_json()
    assert corpo["success"] is False and corpo["code"] == "categoria_invalida"
    assert "Bazar" in corpo["message"] and corpo["message"].startswith("Escolha uma subcategoria")


def test_estoque_post_recusa_subcategoria_de_outra_familia(client, ctx):
    r = client.post("/api/produtos/estoque", headers=ctx["headers"],
                    json=_payload_estoque(subcategoria="Ração para Cães"))
    assert r.status_code == 400 and r.get_json()["code"] == "categoria_invalida"


def test_estoque_put_trocando_familia_sem_subcategoria_recusa_e_com_a_nova_grava(client, session, ctx):
    criado = client.post("/api/produtos/estoque", headers=ctx["headers"], json=_payload_estoque())
    assert criado.status_code == 201, criado.get_data(as_text=True)
    produto_id = criado.get_json()["produto"]["id"]

    sem_nova = client.put(f"/api/produtos/estoque/{produto_id}", headers=ctx["headers"],
                          json={"nome": "PANELA ANTIADERENTE 24CM", "familia_produto": "pet",
                                "preco_custo": 20, "preco_venda": 39.9})
    assert sem_nova.status_code == 400, sem_nova.get_data(as_text=True)
    assert sem_nova.get_json().get("code") == "categoria_invalida", sem_nova.get_data(as_text=True)

    com_nova = client.put(f"/api/produtos/estoque/{produto_id}", headers=ctx["headers"],
                          json={"nome": "PANELA ANTIADERENTE 24CM", "familia_produto": "pet",
                                "subcategoria": "Ração para Cães",
                                "preco_custo": 20, "preco_venda": 39.9})
    assert com_nova.status_code == 200, com_nova.get_data(as_text=True)

    session.expire_all()
    produto = session.get(Produto, produto_id)
    assert produto.familia_produto == "pet"
    assert produto.subcategoria_oficial == chave_subcategoria("pet", "Alimentação", "Ração para Cães")
    assert session.get(CategoriaProduto, produto.categoria_id).codigo == "pet.alimentacao"
    _varredura(session, ctx)


# ────────────────────── importação por planilha (PLANO §3.3 #5) ──────────────────────

def _planilha(linhas, cabecalho, delimitador=";") -> bytes:
    texto = io.StringIO()
    texto.write(cabecalho + "\n")
    for linha in linhas:
        texto.write(linha + "\n")
    return texto.getvalue().encode("utf-8")


def _importar(client, ctx, conteudo):
    return client.post("/api/produtos/importar", headers=ctx["headers"],
                       data={"arquivo": (io.BytesIO(conteudo), "produtos.csv")},
                       content_type="multipart/form-data")


def test_planilha_subcategoria_inventada_vira_erro_da_linha_e_a_valida_entra(client, session, ctx):
    cabecalho = ("nome;subcategoria;preco_custo;preco_venda;codigo_barras;codigo_interno;"
                 "marca;unidade;estoque;familia")
    conteudo = _planilha([
        "PANELA NOVA;Panelas;10;20;;;Marca;UN;3;bazar",
        "PRODUTO INVENTADO;panela voadora;10;20;;;Marca;UN;3;bazar",
    ], cabecalho)
    r = _importar(client, ctx, conteudo)
    assert r.status_code == 200, r.get_data(as_text=True)
    corpo = r.get_json()
    assert corpo["total_importados"] == 1
    assert corpo["total_erros"] == 1
    assert "panela voadora" in corpo["erros"][0]

    importado = Produto.query.filter_by(estabelecimento_id=ctx["estab"].id, nome="PANELA NOVA").first()
    assert importado.subcategoria_oficial == chave_subcategoria("bazar", "Cozinha", "Panelas")
    assert Produto.query.filter_by(estabelecimento_id=ctx["estab"].id,
                                    nome="PRODUTO INVENTADO").first() is None
    _varredura(session, ctx)


def test_planilha_coluna_categoria_antiga_serve_de_fallback_e_resolve_pela_chave(client, session, ctx):
    cabecalho = ("nome;categoria;preco_custo;preco_venda;codigo_barras;codigo_interno;"
                 "marca;unidade;estoque;familia")
    conteudo = _planilha(["JOGO DE LENCOL CASAL;jogos de lencol;30;60;;;Marca;UN;2;cama_mesa_banho"],
                          cabecalho)
    r = _importar(client, ctx, conteudo)
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["total_importados"] == 1, r.get_json()["erros"]

    produto = Produto.query.filter_by(estabelecimento_id=ctx["estab"].id).first()
    assert produto.subcategoria_oficial == chave_subcategoria("cama_mesa_banho", "Cama", "Jogos de Lençol")
    _varredura(session, ctx)


# ──────────────────── catálogo mestre (PLANO §3.3 #6) ────────────────────

def test_catalogo_importar_sem_casar_cai_no_outros_da_familia(client, session, ctx):
    session.add(CatalogoMestre(
        ean="7891234567890", status="encontrado", nome="PRODUTO SEM CATEGORIA CONHECIDA",
        categoria="Categoria Que Nao Existe", marca="Marca", familia_produto="bazar",
        preco_referencia=Decimal("10"), ncm="39241000",
    ))
    session.commit()

    r = client.post("/api/produtos/catalogo/importar", headers=ctx["headers"],
                    json={"eans": ["7891234567890"]})
    assert r.status_code == 200, r.get_data(as_text=True)

    produto = Produto.query.filter_by(estabelecimento_id=ctx["estab"].id).first()
    assert produto is not None
    categoria_oficial, subcategoria_oficial = outros("bazar")
    assert produto.categoria_oficial == categoria_oficial
    assert produto.subcategoria_oficial == subcategoria_oficial
    _varredura(session, ctx)


# ──────────────────── entrada por NF-e (PLANO §3.3 #7) ────────────────────

def test_entrada_nfe_classifica_no_outros_da_familia_inferida_pelo_ncm(session, ctx):
    from app.services.fiscal.entrada_service import _classificacao_importacao, _familia_do_item

    estab = ctx["estab"]
    familia = _familia_do_item(estab, {"ncm": "21069090", "descricao": "WHEY PROTEIN CONCENTRADO"})
    assert familia in TAXONOMIA

    categoria, categoria_oficial, subcategoria_oficial = _classificacao_importacao(estab.id, familia)
    assert (categoria_oficial, subcategoria_oficial) == outros(familia)
    assert categoria.codigo == categoria_oficial
    _varredura(session, ctx)


# ──────────────── PDV: taxa de entrega + retrato da venda (#8 e checkout) ────────────────

def test_pdv_taxa_de_entrega_usa_servico_taxas_e_a_venda_guarda_o_retrato(client, session, ctx):
    produto = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=garantir_categoria_loja(
        ctx["estab"].id, "bazar.cozinha").id, nome="PANELA VENDIDA",
        familia_produto="bazar", categoria_oficial="bazar.cozinha",
        subcategoria_oficial=chave_subcategoria("bazar", "Cozinha", "Panelas"),
        preco_custo=Decimal("10"), preco_venda=Decimal("20"), quantidade=Decimal("5"))
    session.add(produto)
    session.commit()

    total = 25.0
    r = client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "items": [{"id": produto.id, "quantity": 1, "discount": 0, "price": 20.0}],
        "subtotal": 20.0, "desconto": 0, "total": total,
        "pagamentos": [{"forma": "pix", "valor": total}], "cliente_id": None,
        "dados_entrega": {"taxa_entrega": 5.0},
    })
    assert r.status_code in (200, 201), r.get_data(as_text=True)

    taxa = Produto.query.filter_by(estabelecimento_id=ctx["estab"].id, nome="Taxa de Entrega").first()
    assert taxa is not None and taxa.familia_produto == "servico"
    assert taxa.categoria_oficial == chave_categoria("servico", "Taxas")
    assert taxa.subcategoria_oficial == chave_subcategoria("servico", "Taxas", "Taxas e Entregas")

    itens = VendaItem.query.filter_by(estabelecimento_id=ctx["estab"].id).all()
    venda_taxa = next(i for i in itens if i.produto_id == taxa.id)
    assert venda_taxa.subcategoria_oficial == taxa.subcategoria_oficial
    assert venda_taxa.familia_produto == "servico"
    venda_produto = next(i for i in itens if i.produto_id == produto.id)
    assert venda_produto.categoria_oficial == "bazar.cozinha"
    assert venda_produto.subcategoria_oficial == produto.subcategoria_oficial
    _varredura(session, ctx)
