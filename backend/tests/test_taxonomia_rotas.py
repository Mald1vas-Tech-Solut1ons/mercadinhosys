"""Cadastro e edição com taxonomia oficial (PLANO §3.3, linhas 1 e 2): nada fora da lista entra."""
import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto
from app.services.view_schema_service import invalidar_cache_view_schema


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"
    session.commit()
    invalidar_cache_view_schema()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id,
                                                                           "role": "admin"})
    yield dict(estab=estab, headers={"Authorization": f"Bearer {token}"})
    # Não vazar schema cacheado para os outros arquivos de teste.
    invalidar_cache_view_schema()


def _criar(client, ctx, **campos):
    base = {"nome": "PANELA ANTIADERENTE 24CM", "preco_custo": 20, "preco_venda": 39.9,
            "quantidade": 5, "familia_produto": "bazar", "subcategoria": "Panelas"}
    base.update(campos)
    return client.post("/api/produtos/", headers=ctx["headers"], json=base)


def test_cadastro_com_subcategoria_valida_grava_as_colunas(client, session, ctx):
    r = _criar(client, ctx)
    assert r.status_code == 201, r.get_data(as_text=True)

    produto = session.get(Produto, r.get_json()["produto"]["id"])
    assert produto.categoria_oficial == "bazar.cozinha"
    assert produto.subcategoria_oficial == "bazar.cozinha.panela"
    categoria = session.get(CategoriaProduto, produto.categoria_id)
    assert categoria.codigo == "bazar.cozinha"
    assert categoria.nome.endswith("› Cozinha")  # nome qualificado pela família
    # O JSON já sai com as chaves e os nomes de exibição.
    dados = r.get_json()["produto"]
    assert dados["categoria_oficial"] == "bazar.cozinha"
    assert dados["subcategoria_oficial_nome"] == "Panelas"


def test_subcategoria_inventada_recusa_com_400(client, ctx):
    r = _criar(client, ctx, subcategoria="panela inventada")
    assert r.status_code == 400
    corpo = r.get_json()
    assert corpo["success"] is False and corpo["code"] == "categoria_invalida"
    assert "Cozinha" not in corpo["message"]  # mensagem aponta a família, não a lista inteira


def test_subcategoria_de_outra_familia_recusa_com_400(client, ctx):
    r = _criar(client, ctx, subcategoria="Ração para Cães")
    assert r.status_code == 400 and r.get_json()["code"] == "categoria_invalida"


def test_categoria_sozinha_serve_de_fallback_e_escrita_livre_resolve(client, ctx, session):
    # "categoria" (campo antigo) vale quando "subcategoria" não vem, e a escrita é resolvida
    # pela chave canônica: minúsculas e sem acento.
    sem_acento = _criar(client, ctx, nome="JOGO DE LENCOL CASAL", familia_produto="cama_mesa_banho",
                        subcategoria="jogos de lencol")
    assert sem_acento.status_code == 201, sem_acento.get_data(as_text=True)
    assert session.get(Produto, sem_acento.get_json()["produto"]["id"]).subcategoria_oficial == \
        "cama_mesa_banho.cama.jogo_lencol"

    minuscula = _criar(client, ctx, nome="PANO DE PRATO ESTAMPADO", familia_produto="cama_mesa_banho",
                       subcategoria=None, categoria="panos de prato")
    assert minuscula.status_code == 201, minuscula.get_data(as_text=True)
    assert session.get(Produto, minuscula.get_json()["produto"]["id"]).subcategoria_oficial == \
        "cama_mesa_banho.mesa_cozinha.pano_prato"


def test_edicao_trocando_familia_sem_subcategoria_recusa_com_400(client, session, ctx):
    criado = _criar(client, ctx)
    assert criado.status_code == 201, criado.get_data(as_text=True)

    r = client.put(f"/api/produtos/{criado.get_json()['produto']['id']}", headers=ctx["headers"],
                   json={"familia_produto": "pet"})
    assert r.status_code == 400
    assert r.get_json()["code"] == "categoria_invalida"


def test_edicao_com_subcategoria_da_familia_nova_troca_a_classificacao(client, session, ctx):
    criado = _criar(client, ctx)
    produto_id = criado.get_json()["produto"]["id"]

    r = client.put(f"/api/produtos/{produto_id}", headers=ctx["headers"],
                   json={"familia_produto": "pet", "subcategoria": "Ração para Cães"})
    assert r.status_code == 200, r.get_data(as_text=True)

    produto = session.get(Produto, produto_id)
    assert produto.familia_produto == "pet"
    assert produto.subcategoria_oficial == "pet.alimentacao.racao_cae"
    assert session.get(CategoriaProduto, produto.categoria_id).codigo == "pet.alimentacao"


def test_edicao_com_subcategoria_inventada_recusa_com_400(client, session, ctx):
    criado = _criar(client, ctx)
    r = client.put(f"/api/produtos/{criado.get_json()['produto']['id']}", headers=ctx["headers"],
                   json={"subcategoria": "panela voadora"})
    assert r.status_code == 400 and r.get_json()["code"] == "categoria_invalida"


def test_cadastro_e_edicao_com_chave_de_subcategoria_acima_de_50_chars(client, session, ctx):
    """Regressão 31/10: cadastrar 'LIVRO + ESPONJA' com `brinquedos.educativo_criativo.arte_pintura_massinha`
    (51 chars) ou a maior chave da taxonomia (68 chars) não pode exceder a largura de `Produto.subcategoria`.
    """
    chave_51 = "brinquedos.educativo_criativo.arte_pintura_massinha"
    assert len(chave_51) == 51
    r = _criar(
        client,
        ctx,
        nome="LIVRO + ESPONJA",
        codigo_barras="2000000000800",
        familia_produto="brinquedos",
        subcategoria=chave_51,
        preco_custo=5,
        preco_venda=12,
        quantidade=3,
    )
    assert r.status_code == 201, r.get_data(as_text=True)
    prod = session.get(Produto, r.get_json()["produto"]["id"])
    assert prod.subcategoria_oficial == chave_51
    assert len(prod.subcategoria or "") <= Produto.__table__.c.subcategoria.type.length

    chave_68 = "embalagem_descartavel.embalagen_delivery.marmitex_embalagen_delivery"
    assert len(chave_68) == 68
    r_put = client.put(
        f"/api/produtos/{prod.id}",
        headers=ctx["headers"],
        json={"familia_produto": "embalagem_descartavel", "subcategoria": chave_68},
    )
    assert r_put.status_code == 200, r_put.get_data(as_text=True)
    session.expire_all()
    prod = session.get(Produto, prod.id)
    assert prod.subcategoria_oficial == chave_68
    assert len(prod.subcategoria or "") <= Produto.__table__.c.subcategoria.type.length
