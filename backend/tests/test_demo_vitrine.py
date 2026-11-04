"""Demonstração da landing: entra na loja-vitrine do segmento e é somente leitura.

Antes o botão "Ver funcionando" entrava numa loja demo vazia (0 produtos, 0 vendas):
o visitante via um painel em branco. Agora cai numa vitrine com dados, sem poder alterá-los.
"""
from datetime import date

from app.models import db, Estabelecimento, Funcionario, allow_all_tenants


def _vitrine(cnpj, nome, plano="Pro"):
    est = Estabelecimento(
        nome_fantasia=nome, razao_social=f"{nome} LTDA", cnpj=cnpj, telefone="11999999999",
        email=f"{cnpj}@vitrine.test", data_abertura=date(2020, 1, 1), cep="07000-000",
        logradouro="Rua A", numero="1", bairro="Centro", cidade="Guarulhos", estado="SP",
        plano=plano, plano_status="ativo", ativo=True,
    )
    db.session.add(est)
    db.session.commit()
    return est


def _entrar(client, segmento=None):
    r = client.post("/api/auth/demo", json={"segmento": segmento} if segmento else {})
    assert r.status_code == 200, r.get_data(as_text=True)
    dados = r.get_json()["data"]
    return dados, {"Authorization": f"Bearer {dados['access_token']}"}


def test_demo_entra_na_vitrine_do_segmento(client, session):
    mercado = _vitrine("11222333000144", "Mercado Vitrine")
    moto = _vitrine("77888999000111", "Moto Vitrine", plano="Gratuito")

    dados, _ = _entrar(client, "moto-pecas")
    assert dados["estabelecimento"]["id"] == moto.id
    assert dados["user"]["is_demo"] is True

    dados, _ = _entrar(client, "tabacaria")  # sem vitrine própria: cai no mercado
    assert dados["estabelecimento"]["id"] == mercado.id

    dados, _ = _entrar(client)  # botão da página inicial
    assert dados["estabelecimento"]["id"] == mercado.id

    with allow_all_tenants():
        assert Funcionario.query.filter_by(estabelecimento_id=moto.id, username="demo").count() == 1


def test_demo_le_mas_nao_altera(client, session):
    _vitrine("11222333000144", "Mercado Vitrine")
    _, headers = _entrar(client)

    assert client.get("/api/produtos/", headers=headers).status_code == 200

    r = client.post("/api/produtos/", json={"nome": "Invasor", "preco_venda": 1}, headers=headers)
    assert r.status_code == 403
    assert "demonstração" in r.get_data(as_text=True)

    r = client.post("/api/clientes/", json={"nome": "Invasor"}, headers=headers)
    assert r.status_code == 403
