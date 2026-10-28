"""Busca global (Ctrl+K): tolerante a acento e erro de digitação, filtros de estado, isolada por loja."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Cliente, Estabelecimento, Fornecedor, Funcionario, Produto
from app.services.busca_service import interpretar, pontuar


def test_interpretar_separa_filtros():
    assert interpretar("Ômega 3 vencendo") == (["omega", "3"], ["vencendo"])
    assert interpretar("tênis sem estoque") == (["tenis"], ["sem_estoque"])
    assert interpretar("coca 2l") == (["coca", "2", "l"], [])


def test_pontuar_tolera_acento_prefixo_e_erro():
    assert pontuar(["agua"], "Água Mineral 500ml") > 0
    assert pontuar(["agau"], "Água Mineral 500ml") > 0          # erro de digitação
    assert pontuar(["coca", "2", "l"], "Coca-Cola 2L") > 0
    assert pontuar(["tenis", "38", "preto"], "Tênis Corrida 38 Preto") > 0
    assert pontuar(["tenis", "39"], "Tênis Corrida 38 Preto") == 0  # número não é tolerado
    assert pontuar(["arroz"], "Feijão Carioca") == 0


END = dict(cep="07000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="Guarulhos", estado="SP")


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Geral")
    session.add(cat)
    session.flush()
    hoje = date.today()
    session.add_all([
        Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Água Mineral 500ml", codigo_barras="7891234567895",
                preco_custo=Decimal("1"), preco_venda=Decimal("2.5"), quantidade=Decimal("30"), quantidade_minima=Decimal("5")),
        Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Ômega 3 1000mg 120 cápsulas",
                preco_custo=Decimal("30"), preco_venda=Decimal("60"), quantidade=Decimal("4"), quantidade_minima=Decimal("1"),
                controlar_validade=True, data_validade=hoje + timedelta(days=10)),
        Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Tênis Corrida 38 Preto",
                preco_custo=Decimal("90"), preco_venda=Decimal("199.9"), quantidade=Decimal("0"), quantidade_minima=Decimal("1")),
        Cliente(estabelecimento_id=estab.id, nome="Vera Moreti", cpf="529.982.247-25", celular="11999990000", **END),
        Fornecedor(estabelecimento_id=estab.id, nome_fantasia="Distribuidora Água Viva", razao_social="Agua Viva LTDA",
                   cnpj="11222333000181", telefone="1133334444", email="av@example.test", **END, pais="Brasil"),
    ])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


def _busca(client, h, q):
    r = client.get("/api/busca", query_string={"q": q}, headers=h)
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


def test_busca_global_acha_por_tipo(client, ctx):
    r = _busca(client, ctx, "agau")
    assert [p["nome"] for p in r["produtos"]] == ["Água Mineral 500ml"]
    assert [f["nome"] for f in r["fornecedores"]] == ["Distribuidora Água Viva"]
    assert _busca(client, ctx, "vera")["clientes"][0]["nome"] == "Vera Moreti"
    assert _busca(client, ctx, "52998224725")["clientes"][0]["nome"] == "Vera Moreti"


def test_busca_por_codigo_de_barras(client, ctx):
    assert _busca(client, ctx, "7891234567895")["produtos"][0]["nome"] == "Água Mineral 500ml"


def test_filtros_de_estado(client, ctx):
    assert [p["nome"] for p in _busca(client, ctx, "vencendo")["produtos"]] == ["Ômega 3 1000mg 120 cápsulas"]
    assert [p["nome"] for p in _busca(client, ctx, "sem estoque")["produtos"]] == ["Tênis Corrida 38 Preto"]
    assert [p["nome"] for p in _busca(client, ctx, "omega vencendo")["produtos"]] == ["Ômega 3 1000mg 120 cápsulas"]
    assert _busca(client, ctx, "tenis vencendo")["produtos"] == []


def test_busca_vazia_e_isolamento_de_loja(client, session, ctx):
    from app.models import allow_all_tenants
    assert _busca(client, ctx, "")["produtos"] == []
    estab = session.query(Estabelecimento).first()
    cat = session.query(CategoriaProduto).filter_by(estabelecimento_id=estab.id).first()
    with allow_all_tenants():
        session.add(Produto(estabelecimento_id=estab.id + 999, categoria_id=cat.id, nome="Água de Outra Loja",
                            preco_custo=Decimal("1"), preco_venda=Decimal("2"), quantidade=Decimal("9")))
        session.commit()
    nomes = [p["nome"] for p in _busca(client, ctx, "agua")["produtos"]]
    assert nomes == ["Água Mineral 500ml"]
