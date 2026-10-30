"""Reimpressão de cupom (2ª via), inclusive de venda feita offline.

Prova: (1) /pdv/configuracoes entrega o cabeçalho da loja que o PDV guarda para
montar o cupom sem internet; (2) a venda offline que sincroniza aparece em
/pdv/vendas-hoje com o offline_uuid (o PDV casa com a cópia local e não lista
duas vezes); (3) o comprovante dela sai pelo servidor para a 2ª via; (4) a lista
aceita limite maior que o painel, com teto.
"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import Caixa, CategoriaProduto, Estabelecimento, Funcionario, Produto


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Reimpressão")
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="REIMP-1",
                  saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                  data_abertura=datetime.now(timezone.utc))
    session.add_all([cat, caixa])
    session.flush()
    produto = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Café 500g",
                      preco_custo=Decimal("10"), preco_venda=Decimal("20"), quantidade=Decimal("50"))
    session.add(produto)
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, produto=produto, headers={"Authorization": f"Bearer {token}"})


def _vender(client, ctx, offline_uuid=None):
    payload = {
        "items": [{"id": ctx["produto"].id, "quantity": 1, "discount": 0, "price": 20.0}],
        "subtotal": 20.0, "desconto": 0, "total": 20.0,
        "pagamentos": [{"forma": "dinheiro", "valor": 20.0}], "cliente_id": None,
    }
    if offline_uuid:
        payload.update(offline_uuid=offline_uuid, offline_criadoEm=datetime.now(timezone.utc).isoformat())
    r = client.post("/api/pdv/finalizar", headers=ctx["headers"], json=payload)
    assert r.status_code in (200, 201), r.get_json()
    return r.get_json()["venda"]


def test_configuracoes_trazem_cabecalho_do_cupom(client, ctx):
    r = client.get("/api/pdv/configuracoes", headers=ctx["headers"])
    assert r.status_code == 200
    cab = r.get_json()["configuracoes"]["cupom_cabecalho"]
    assert cab["nome_fantasia"] == ctx["estab"].nome_fantasia
    assert "endereco" in cab and "cnpj" in cab


def test_venda_offline_sincronizada_aparece_para_reimpressao(client, ctx):
    uuid = "a1b2c3d4-0000-4000-8000-00000000abcd"
    venda = _vender(client, ctx, offline_uuid=uuid)

    r = client.get("/api/pdv/vendas-hoje?limite=50", headers=ctx["headers"])
    assert r.status_code == 200
    linha = next(v for v in r.get_json()["ultimas_vendas"] if v["id"] == venda["id"])
    assert linha["offline_uuid"] == uuid

    comp = client.get(f"/api/pdv/comprovante/{venda['id']}", headers=ctx["headers"])
    assert comp.status_code == 200
    corpo = comp.get_json()
    assert corpo["venda"]["codigo"] == venda["codigo"]
    assert corpo["comprovante"]["itens"][0]["nome"] == "Café 500g"
    assert corpo["estabelecimento"]["nome_fantasia"] == ctx["estab"].nome_fantasia


def test_vendas_hoje_respeita_limite(client, ctx):
    for _ in range(3):
        _vender(client, ctx)
    assert len(client.get("/api/pdv/vendas-hoje?limite=2", headers=ctx["headers"]).get_json()["ultimas_vendas"]) == 2
    assert len(client.get("/api/pdv/vendas-hoje?limite=0", headers=ctx["headers"]).get_json()["ultimas_vendas"]) == 1
    assert len(client.get("/api/pdv/vendas-hoje", headers=ctx["headers"]).get_json()["ultimas_vendas"]) >= 3
