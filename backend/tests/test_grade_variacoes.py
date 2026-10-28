"""Grade real: cada número/cor é um Produto vendável com estoque próprio; o modelo não vende."""
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import Caixa, CategoriaProduto, Estabelecimento, Funcionario, MovimentacaoEstoque, Produto


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Tênis")
    session.add(cat)
    session.flush()
    modelo = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Tênis Corrida Masculino",
                     codigo_interno="TEN-01", preco_custo=Decimal("90"), preco_venda=Decimal("199.90"),
                     quantidade=Decimal("0"), quantidade_minima=Decimal("1"), familia_produto="calcados",
                     controlar_validade=False, ncm="64041100")
    session.add_all([modelo, Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="GR-1",
                                   saldo_inicial=0, saldo_atual=0, status="aberto")])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, modelo=modelo, headers={"Authorization": f"Bearer {token}"})


def _grade(client, ctx, produto_id, **body):
    return client.post(f"/api/produtos/{produto_id}/grade", headers=ctx["headers"], json=body)


def _vender(client, ctx, produto_id, qtd=1):
    total = 199.9 * qtd
    return client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "subtotal": total, "total": total, "desconto": 0,
        "items": [{"id": produto_id, "quantidade": qtd, "preco_unitario": 199.9}],
        "pagamentos": [{"forma": "dinheiro", "valor": total}],
    })


def test_gera_variacoes_com_estoque_por_numero(client, session, ctx):
    r = _grade(client, ctx, ctx["modelo"].id, numeracoes=["39", "38", "40"], cores=["Preto"],
               quantidades={"38|Preto": 2, "39|Preto": 1})
    assert r.status_code == 201, r.get_data(as_text=True)
    grade = r.get_json()["grade"]
    assert r.get_json()["criadas"] == 3
    assert grade["numeracoes"] == ["38", "39", "40"]
    assert grade["cores"] == ["Preto"]
    assert grade["total"] == 3
    por_numero = {c["numeracao"]: c for c in grade["celulas"]}
    assert por_numero["38"]["quantidade"] == 2 and por_numero["40"]["quantidade"] == 0
    assert por_numero["38"]["nome"] == "Tênis Corrida Masculino 38 Preto"
    assert por_numero["38"]["codigo_interno"] == "TEN-01-38-PRET"

    session.expire_all()
    variacao = session.get(Produto, por_numero["38"]["id"])
    # Herda preço, família e fiscal; tem estoque e trilha próprios.
    assert variacao.preco_venda == Decimal("199.90") and variacao.familia_produto == "calcados"
    assert variacao.ncm == "64041100" and variacao.produto_pai_id == ctx["modelo"].id
    assert session.query(MovimentacaoEstoque).filter_by(produto_id=variacao.id, tipo="entrada").count() == 1
    modelo = session.get(Produto, ctx["modelo"].id)
    assert modelo.eh_grade_modelo is True and modelo.ativo is False


def test_grade_pela_variacao_e_acrescimo_sem_duplicar(client, session, ctx):
    r = _grade(client, ctx, ctx["modelo"].id, numeracoes=["38"], cores=[])
    vid = r.get_json()["grade"]["celulas"][0]["id"]
    assert client.get(f"/api/produtos/{vid}/grade", headers=ctx["headers"]).get_json()["grade"]["modelo"]["id"] == ctx["modelo"].id
    r = _grade(client, ctx, vid, numeracoes=["38", "41"])
    assert r.status_code == 201 and r.get_json()["criadas"] == 1
    assert r.get_json()["grade"]["numeracoes"] == ["38", "41"]


def test_vende_por_numero_e_baixa_so_aquele_numero(client, session, ctx):
    grade = _grade(client, ctx, ctx["modelo"].id, numeracoes=["37", "38"],
                   quantidades={"37|": 1, "38|": 3}).get_json()["grade"]
    n38 = next(c for c in grade["celulas"] if c["numeracao"] == "38")
    assert _vender(client, ctx, n38["id"], 2).status_code == 201
    grade = client.get(f"/api/produtos/{n38['id']}/grade", headers=ctx["headers"]).get_json()["grade"]
    assert {c["numeracao"]: c["quantidade"] for c in grade["celulas"]} == {"37": 1, "38": 1}


def test_modelo_nao_vende_nem_aparece_na_lista(client, session, ctx):
    _grade(client, ctx, ctx["modelo"].id, numeracoes=["38"], quantidades={"38|": 1})
    r = _vender(client, ctx, ctx["modelo"].id)
    assert r.status_code == 400
    lista = client.get("/api/produtos/?por_pagina=200", headers=ctx["headers"]).get_json()
    ids = {p["id"] for p in (lista.get("produtos") or lista.get("data") or [])}
    assert ctx["modelo"].id not in ids
    ajuste = client.post(f"/api/produtos/{ctx['modelo'].id}/estoque", headers=ctx["headers"],
                         json={"tipo": "entrada", "quantidade": 1, "motivo": "teste"})
    assert ajuste.status_code == 400


def test_recusa_grade_com_estoque_sem_numero(client, session, ctx):
    ctx["modelo"].quantidade = Decimal("5")
    session.commit()
    r = _grade(client, ctx, ctx["modelo"].id, numeracoes=["38"])
    assert r.status_code == 400
    assert "Zere o estoque" in r.get_json()["error"]
    assert session.query(Produto).filter_by(produto_pai_id=ctx["modelo"].id).count() == 0


def test_recusa_grade_vazia(client, session, ctx):
    assert _grade(client, ctx, ctx["modelo"].id, numeracoes=[]).status_code == 400
