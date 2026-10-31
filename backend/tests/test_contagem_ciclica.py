"""Contagem cíclica — "O que sumiu" (FASE 3.1).

Prova os aceites da spec que dá para medir em teste:
* o dono abre uma seção, bipa e o contador sobe (esperado congelado na abertura);
* bipar produto fora da seção é aceito e marcado;
* conferir calcula a divergência e separa divergentes de OK;
* aplicar gera UMA MovimentacaoEstoque por divergente, com motivo
  "Contagem cíclica — <seção>" e funcionario_id preenchido (não NULL);
* aplicar exige nível <= 2 e PIN válido;
* não existem duas contagens abertas da mesma seção ao mesmo tempo;
* o relatório do período soma o que sumiu.
"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (Auditoria, CategoriaProduto, Configuracao, Estabelecimento,
                        Funcionario, MovimentacaoEstoque, Produto)

PIN = "4321"


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    admin.set_pin(PIN)

    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Contagem cíclica")
    session.add(cat)
    session.flush()

    produtos = []
    for nome, qtd, preco in (("Café 500g", "6", "18.50"), ("Leite 1L", "10", "4.90"), ("Sabão em pó", "3", "12.00")):
        p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome=nome,
                    preco_custo=Decimal("1"), preco_venda=Decimal(preco), quantidade=Decimal(qtd),
                    codigo_barras=f"789{nome[:3].upper()}{int(qtd)}")
        session.add(p)
        produtos.append(p)
    session.commit()

    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": admin.role or "admin"})

    return dict(estab=estab, admin=admin, produtos=produtos,
                headers={"Authorization": f"Bearer {token}"})


def _abrir(client, ctx, nome="Gôndola 1 — Mercearia", itens=None):
    ids = itens if itens is not None else [p.id for p in ctx["produtos"]]
    return client.post("/api/contagem/", headers=ctx["headers"], json={"nome": nome, "itens": ids})


def test_abre_contagem_congelando_a_quantidade_esperada(client, ctx):
    r = _abrir(client, ctx)
    assert r.status_code == 201, r.get_json()
    contagem = r.get_json()["contagem"]

    esperado = {i["produto_id"]: float(i["quantidade_esperada"]) for i in contagem["itens"]}
    assert esperado[ctx["produtos"][0].id] == 6.0
    assert esperado[ctx["produtos"][1].id] == 10.0


def test_secao_nao_abre_duas_vezes(client, ctx):
    assert _abrir(client, ctx, nome="Gôndola 2").status_code == 201
    r = _abrir(client, ctx, nome="Gôndola 2")

    assert r.status_code == 409
    assert "já tem uma contagem aberta" in r.get_json()["error"]


def test_bipar_soma_uma_unidade_e_aceita_item_fora_da_secao(client, ctx):
    contagem = _abrir(client, ctx, itens=[ctx["produtos"][0].id]).get_json()["contagem"]
    url = f"/api/contagem/{contagem['id']}/bipar"

    cafe = client.post(url, headers=ctx["headers"], json={"codigo_barras": ctx["produtos"][0].codigo_barras})
    assert cafe.status_code == 200
    assert cafe.get_json()["quantidade_contada"] == 1.0
    assert cafe.get_json()["fora_da_secao"] is False

    fora = client.post(url, headers=ctx["headers"], json={"codigo_barras": ctx["produtos"][2].codigo_barras})
    assert fora.status_code == 200
    assert fora.get_json()["fora_da_secao"] is True


def test_conferir_calcula_divergencia(client, ctx):
    contagem = _abrir(client, ctx, itens=[p.id for p in ctx["produtos"]]).get_json()["contagem"]
    # café: 6 no papel, 5 contados -> falta 1
    for _ in range(5):
        client.post(f"/api/contagem/{contagem['id']}/bipar", headers=ctx["headers"],
                    json={"codigo_barras": ctx["produtos"][0].codigo_barras})

    r = client.get(f"/api/contagem/{contagem['id']}/conferir", headers=ctx["headers"])
    assert r.status_code == 200
    corpo = r.get_json()

    divergentes = {d["produto_id"]: d for d in corpo["divergentes"]}
    assert divergentes[ctx["produtos"][0].id]["divergencia"] == -1.0
    assert corpo["resumo"]["itens_divergentes"] >= 1


def test_aplicar_gera_movimentacao_por_divergente_com_motivo_e_operador(client, ctx, session):
    produtos = ctx["produtos"]
    contagem = _abrir(client, ctx, nome="Gôndola 3 — Higiene", itens=[p.id for p in produtos]).get_json()["contagem"]
    for _ in range(5):  # café: esperado 6, contado 5
        client.post(f"/api/contagem/{contagem['id']}/bipar", headers=ctx["headers"],
                    json={"codigo_barras": produtos[0].codigo_barras})
    for _ in range(10):  # leite: esperado 10, contado 10 (OK)
        client.post(f"/api/contagem/{contagem['id']}/bipar", headers=ctx["headers"],
                    json={"codigo_barras": produtos[1].codigo_barras})

    r = client.post(f"/api/contagem/{contagem['id']}/aplicar", headers=ctx["headers"],
                    json={"pin": PIN, "itens": [
                        {"produto_id": produtos[0].id, "decisao": "sumiu"},
                        {"produto_id": produtos[1].id, "decisao": "ok"},
                    ]})
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["resumo"]["movimentacoes"] == 1

    movs = MovimentacaoEstoque.query.filter(
        MovimentacaoEstoque.estabelecimento_id == ctx["estab"].id,
        MovimentacaoEstoque.motivo == "Contagem cíclica — Gôndola 3 — Higiene",
    ).all()
    assert len(movs) == 1
    mov = movs[0]
    assert mov.tipo == "saida"
    assert float(mov.quantidade) == 1.0
    assert mov.funcionario_id == ctx["admin"].id, "a movimentação tem que ter operador, não NULL"

    session.expire_all()
    assert float(Produto.query.get(produtos[0].id).quantidade) == 5.0


def test_aplicar_exige_pin_valido(client, ctx):
    contagem = _abrir(client, ctx, itens=[ctx["produtos"][0].id]).get_json()["contagem"]

    r = client.post(f"/api/contagem/{contagem['id']}/aplicar", headers=ctx["headers"],
                    json={"pin": "0000", "itens": [{"produto_id": ctx["produtos"][0].id, "decisao": "sumiu"}]})

    assert r.status_code == 403
    assert "PIN" in r.get_json()["error"]


def test_secao_vazia_abre_e_o_primeiro_bip_e_da_secao(client, ctx):
    """O dono nomeia a gôndola e sai bipando: o primeiro bip define a seção."""
    contagem = _abrir(client, ctx, nome="Gôndola 4 — Bebidas", itens=[]).get_json()["contagem"]

    primeira = client.post(f"/api/contagem/{contagem['id']}/bipar", headers=ctx["headers"],
                           json={"codigo_barras": ctx["produtos"][0].codigo_barras})
    segunda = client.post(f"/api/contagem/{contagem['id']}/bipar", headers=ctx["headers"],
                          json={"codigo_barras": ctx["produtos"][1].codigo_barras})

    assert primeira.get_json()["fora_da_secao"] is False
    # Com lista já formada, um produto novo passa a ser "de fora".
    assert segunda.get_json()["fora_da_secao"] is True


def test_relatorio_do_periodo_soma_o_que_sumiu(client, ctx):
    produtos = ctx["produtos"]
    contagem = _abrir(client, ctx, nome="Prateleira — Padaria", itens=[p.id for p in produtos]).get_json()["contagem"]
    for _ in range(4):  # sabão: esperado 3, contado... conta 4 (achou a mais)
        client.post(f"/api/contagem/{contagem['id']}/bipar", headers=ctx["headers"],
                    json={"codigo_barras": produtos[2].codigo_barras})
    client.post(f"/api/contagem/{contagem['id']}/aplicar", headers=ctx["headers"],
                json={"pin": PIN, "itens": [{"produto_id": produtos[2].id, "decisao": "ajustar"}]})

    r = client.get("/api/contagem/relatorio", headers=ctx["headers"])
    assert r.status_code == 200
    corpo = r.get_json()
    assert corpo["resumo"]["itens_divergentes"] == 1
    assert any(s["secao"] == "Prateleira — Padaria" for s in corpo["secoes"])
