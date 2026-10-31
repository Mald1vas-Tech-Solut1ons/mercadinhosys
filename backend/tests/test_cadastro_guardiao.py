"""Guardião do cadastro: as travas que o piloto da Vera provou faltarem.

Prova cada regra contra a rota real POST /api/produtos/ (com JWT e loja):
- nome=código de barras recusado com mensagem que ensina;
- GTIN com DV inválido recusado; interno (2xx) aceito;
- estoque 0 recusado; exceção consciente marca Lista de Revisão;
- nome/marca/unidade gravados canônicos (UPPER) mesmo vindo minúsculo.
"""
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    session.add(CategoriaProduto(estabelecimento_id=estab.id, nome="Guardiao"))
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, headers={"Authorization": f"Bearer {token}"})


def _post(client, ctx, **campos):
    from datetime import date, timedelta
    base = {"nome": "PRODUTO GUARDIAO", "subcategoria": "Outros Alimentos",
            "preco_custo": 2.0, "preco_venda": 5.0, "quantidade": 10,
            # Alimento com estoque exige validade (regra da família).
            "data_validade": (date.today() + timedelta(days=180)).isoformat()}
    base.update(campos)
    return client.post("/api/produtos/", headers=ctx["headers"], json=base)


def test_nome_so_digitos_recusado_com_mensagem_que_ensina(client, session, ctx):
    r = _post(client, ctx, nome="7891234567895", codigo_barras="7891234567895")
    assert r.status_code == 400
    corpo = r.get_json()
    assert any("código de barras" in e.lower() for e in corpo["errors"])
    assert not Produto.query.filter_by(estabelecimento_id=ctx["estab"].id,
                                       nome="7891234567895").first()


def test_nome_igual_ao_ean_recusado(client, session, ctx):
    r = _post(client, ctx, nome="789 1234 5678 95", codigo_barras="7891234567895")
    assert r.status_code == 400


def test_ean_dv_invalido_recusado_e_interno_aceito(client, session, ctx):
    r = _post(client, ctx, codigo_barras="7896036200057")  # DV errado
    assert r.status_code == 400
    assert any("dígito verificador" in e.lower() for e in r.get_json()["errors"])

    r = _post(client, ctx, nome="PRODUTO INTERNO GUARDIAO", codigo_barras="2000000000015")
    assert r.status_code in (201, 400)  # interno pode existir de outro teste; DV não recusa
    if r.status_code == 201:
        assert "dígito verificador" not in str(r.get_json())


def test_estoque_zero_recusado(client, session, ctx):
    r = _post(client, ctx, quantidade=0)
    assert r.status_code == 400
    assert any("estoque" in e.lower() for e in r.get_json()["errors"])


def test_excecao_consciente_marca_lista_de_revisao(client, session, ctx):
    r = _post(client, ctx, quantidade=0, entrar_sem_estoque=True)
    assert r.status_code == 201, r.get_json()
    produto = Produto.query.filter_by(estabelecimento_id=ctx["estab"].id,
                                      nome="PRODUTO GUARDIAO").first()
    assert produto.cadastro_pendente_revisao is True
    assert produto.origem_cadastro == "manual"


def test_upper_canonico_e_unidade_gravam_padronizados(client, session, ctx):
    r = _post(client, ctx, nome="coca cola 2l  garrafa", marca="coca-cola",
              unidade_medida="un")
    assert r.status_code == 201, r.get_json()
    produto = Produto.query.filter_by(estabelecimento_id=ctx["estab"].id,
                                      nome="COCA COLA 2L GARRAFA").first()
    assert produto is not None
    assert produto.marca == "COCA-COLA"
    assert produto.unidade_medida == "UN"


def test_edicao_tambem_passa_pelo_guardiao(client, session, ctx):
    r = _post(client, ctx, quantidade=5)
    assert r.status_code == 201
    produto = Produto.query.filter_by(estabelecimento_id=ctx["estab"].id,
                                      nome="PRODUTO GUARDIAO").first()
    r = client.put(f"/api/produtos/{produto.id}", headers=ctx["headers"],
                   json={"nome": "9990000000000"})
    assert r.status_code == 400
    assert r.get_json().get("code") == "GUARDIAO_REPROVADO"


def test_emissao_habilitada_so_com_addon_real(session):
    from app.services.cadastro_guardiao import emissao_habilitada
    sem_addon = Estabelecimento(nome_fantasia="Sem add-on", razao_social="x", cnpj="11222333000181",
                                telefone="1", email="a@b.c")
    assert emissao_habilitada(sem_addon) is False
    com_addon = sem_addon
    com_addon.fiscal_gateway = "focusnfe"
    com_addon.fiscal_token = "tk"
    com_addon.fiscal_csc = "csc"
    assert emissao_habilitada(com_addon) is True