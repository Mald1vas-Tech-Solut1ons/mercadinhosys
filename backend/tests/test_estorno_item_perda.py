"""FASE 1.8 — cancelamento em que o item NÃO volta para a prateleira.

O cliente devolve o leite aberto, o pão mordido, a lata que o operador bipou
errado. Devolver tudo ao estoque faz o produto voltar a ser vendável e o
inventário mentir — o dono só descobre na contagem da semana.

Aqui o cancelamento aceita ``itens_perda``: esses itens não entram no estorno de
estoque, e a saída original da venda passa a estar titulada como perda
("Perda em cancelamento de venda"), então o DRE lê perda, não venda. O razão
continua fechando com o saldo do produto (uma saída, não duas).
"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (Caixa, CategoriaProduto, Estabelecimento, Funcionario,
                        MovimentacaoEstoque, Produto)

PIN = "4321"


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    admin.set_pin(PIN)

    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Estorno 1.8")
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="EST-18",
                  saldo_inicial=Decimal("100"), saldo_atual=Decimal("100"), status="aberto",
                  data_abertura=datetime.now(timezone.utc))
    session.add_all([cat, caixa])
    session.flush()

    produtos = []
    for nome in ("Leite 1L", "Arroz 5kg", "Sabão 1kg"):
        p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome=nome,
                    preco_custo=Decimal("2"), preco_venda=Decimal("10"),
                    quantidade=Decimal("20"))
        session.add(p)
        produtos.append(p)
    session.commit()

    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, produtos=produtos,
                headers={"Authorization": f"Bearer {token}"})


def _vender_3_itens(client, ctx):
    r = client.post("/api/vendas/", headers=ctx["headers"], json={
        "items": [{"id": p.id, "quantity": 1, "discount": 0, "price": 10.0} for p in ctx["produtos"]],
        "subtotal": 30.0,
        "total": 30.0,
        "pagamentos": [{"forma": "dinheiro", "valor": 30.0}],
    })
    assert r.status_code in (200, 201), r.get_json()
    corpo = r.get_json() or {}
    return corpo["venda"]["id"] if "venda" in corpo else corpo["venda_id"]


def _cancelar(client, ctx, venda_id, itens_perda=None):
    payload = {"motivo": "Cliente devolveu", "pin_cancelamento": PIN}
    if itens_perda is not None:
        payload["itens_perda"] = itens_perda
    return client.post(f"/api/vendas/{venda_id}/cancelar", headers=ctx["headers"], json=payload)


def test_item_marcado_como_perda_nao_volta_ao_estoque(client, ctx, session):
    leite, arroz, sabao = ctx["produtos"]
    venda_id = _vender_3_itens(client, ctx)

    session.expire_all()
    assert float(Produto.query.get(leite.id).quantidade) == 19.0  # baixa da venda

    r = _cancelar(client, ctx, venda_id, itens_perda=[leite.id])
    assert r.status_code == 200, r.get_json()

    session.expire_all()
    # perda: continua baixado (não volta a ser vendável)
    assert float(Produto.query.get(leite.id).quantidade) == 19.0
    # os outros dois voltam
    assert float(Produto.query.get(arroz.id).quantidade) == 20.0
    assert float(Produto.query.get(sabao.id).quantidade) == 20.0


def test_perda_e_estorno_tem_motivos_distintos_e_um_unico_movimento(client, ctx, session):
    leite = ctx["produtos"][0]
    venda_id = _vender_3_itens(client, ctx)

    assert _cancelar(client, ctx, venda_id, itens_perda=[leite.id]).status_code == 200

    session.expire_all()
    movs = MovimentacaoEstoque.query.filter_by(venda_id=venda_id).all()
    perda = [m for m in movs if m.motivo == "Perda em cancelamento de venda"]
    devolvidos = [m for m in movs if (m.motivo or "").startswith("Cancelamento da venda")]

    assert len(perda) == 1
    assert perda[0].tipo == "saida"
    assert perda[0].funcionario_id == ctx["admin"].id
    # uma saída por item da venda: o razão fecha com o saldo do produto
    assert len([m for m in movs if m.tipo == "saida" and m.produto_id == leite.id]) == 1
    assert len(devolvidos) == 2


def test_sem_itens_perda_mantem_o_comportamento_antigo(client, ctx, session):
    venda_id = _vender_3_itens(client, ctx)

    assert _cancelar(client, ctx, venda_id).status_code == 200

    session.expire_all()
    assert all(float(Produto.query.get(p.id).quantidade) == 20.0 for p in ctx["produtos"])


def test_produto_fora_da_venda_vira_400(client, ctx):
    venda_id = _vender_3_itens(client, ctx)
    intruso = 999999

    r = _cancelar(client, ctx, venda_id, itens_perda=[intruso])

    assert r.status_code == 400
    assert "não fazem parte desta venda" in r.get_json()["error"]
