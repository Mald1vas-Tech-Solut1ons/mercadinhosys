"""Provas de aceitação para migração ERP; xfail identifica bloqueios conhecidos.

Não altera código de produção. Usa apenas o banco isolado das fixtures.
Remover o xfail de cada caso quando a respectiva regra for corrigida.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Cliente, ContaPagar, Estabelecimento, Funcionario,
    Fornecedor, PedidoCompra, PedidoCompraItem, PedidoVenda, Produto, ProdutoLote, VendaItem,
)


@pytest.fixture
def erp_context(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Auditoria ERP")
    forn = Fornecedor(
        estabelecimento_id=estab.id, nome_fantasia="Fornecedor Auditoria",
        razao_social="Fornecedor Auditoria LTDA", cnpj="11222333000144",
        telefone="11999999999", email="auditoria@example.test",
        cep="01000000", logradouro="Rua A", numero="1", bairro="Centro",
        cidade="São Paulo", estado="SP", pais="Brasil",
    )
    customer = Cliente(
        estabelecimento_id=estab.id, nome="Cliente Auditoria", cpf="12345678901",
        celular="11999999999", cep="01000000", logradouro="Rua A", numero="1",
        bairro="Centro", cidade="São Paulo", estado="SP",
        limite_credito=Decimal("10000"), saldo_devedor=Decimal("0"),
    )
    session.add_all([cat, forn, customer])
    session.flush()
    prod = Produto(
        estabelecimento_id=estab.id, categoria_id=cat.id, nome="Produto Auditoria",
        preco_custo=Decimal("4"), preco_venda=Decimal("10"), quantidade=Decimal("10"),
    )
    session.add(prod)
    session.flush()
    lot = ProdutoLote(
        estabelecimento_id=estab.id, produto_id=prod.id, fornecedor_id=forn.id,
        numero_lote="ERP-AUDIT", quantidade=10, quantidade_inicial=10,
        data_entrada=date.today(), data_validade=date.today() + timedelta(days=30),
        preco_custo_unitario=4, ativo=True,
    )
    session.add(lot)
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin",
    })
    return dict(estab=estab, admin=admin, forn=forn, customer=customer,
                prod=prod, lot=lot, headers={"Authorization": f"Bearer {token}"})


def _purchase(client, ctx):
    response = client.post("/api/pedidos-compra/", headers=ctx["headers"], json={
        "fornecedor_id": ctx["forn"].id,
        "itens": [{"produto_id": ctx["prod"].id, "quantidade": 10, "preco_unitario": 4}],
    })
    assert response.status_code == 201, response.get_json()
    return response.get_json()["pedido"]["id"]


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="ERP-01: recebimento parcial encerra o pedido")
def test_recebimento_parcial_permite_complemento(client, session, erp_context):
    ctx = erp_context
    purchase_id = _purchase(client, ctx)
    item = session.query(PedidoCompraItem).filter_by(pedido_id=purchase_id).first()
    response = client.post("/api/pedidos-compra/receber", headers=ctx["headers"], json={
        "pedido_id": purchase_id,
        "itens": [{"item_id": item.id, "quantidade_recebida": 3}],
    })
    assert response.status_code == 200, response.get_json()
    session.expire_all()
    purchase = session.query(PedidoCompra).filter_by(id=purchase_id).first()
    assert purchase.status in {"pendente", "parcial"}, f"observado: {purchase.status}"


def test_fornecedor_aceita_segundo_pagamento_parcial(client, session, erp_context):
    ctx = erp_context
    purchase_id = _purchase(client, ctx)
    payable = session.query(ContaPagar).filter_by(pedido_compra_id=purchase_id).first()
    path = f"/api/boletos/{payable.id}/pagar"
    first = client.post(path, headers=ctx["headers"], json={"valor_pago": 10})
    assert first.status_code == 200, first.get_json()
    second = client.post(path, headers=ctx["headers"], json={"valor_pago": 30})
    assert second.status_code == 200, second.get_json()


def test_fornecedor_rejeita_pagamento_negativo(client, session, erp_context):
    ctx = erp_context
    purchase_id = _purchase(client, ctx)
    payable = session.query(ContaPagar).filter_by(pedido_compra_id=purchase_id).first()
    response = client.post(f"/api/boletos/{payable.id}/pagar", headers=ctx["headers"],
                           json={"valor_pago": -10})
    assert response.status_code == 400, response.get_json()


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="ERP-04: SFA aceita totais incompatíveis com os itens")
def test_sfa_rejeita_total_incoerente(client, erp_context):
    ctx = erp_context
    response = client.post("/api/sfa/sync-pedidos", headers=ctx["headers"], json={
        "pedidos": [{"cliente_id": ctx["customer"].id, "subtotal": 1, "total": 1,
                     "itens": [{"produto_id": ctx["prod"].id, "quantidade": 2,
                                "preco_unitario": 10, "total_item": 20}]}],
    })
    assert response.status_code == 400, response.get_json()


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="ERP-05: venda por entrega não baixa Produto.quantidade")
def test_delivery_baixa_estoque(client, session, erp_context):
    ctx = erp_context
    response = client.post("/api/delivery/venda-entrega", headers=ctx["headers"], json={
        "cliente_id": ctx["customer"].id, "subtotal": 20, "total": 20,
        "itens": [{"produto_id": ctx["prod"].id, "quantidade": 2,
                   "preco_unitario": 10, "total_item": 20}],
        "pagamentos": [{"forma_pagamento": "dinheiro", "valor": 20}],
    })
    assert response.status_code == 201, response.get_json()
    session.expire_all()
    assert session.query(Produto).filter_by(id=ctx["prod"].id).first().quantidade == 8


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="ERP-06: faturamento SFA não consome lotes")
def test_sfa_baixa_lotes(client, session, erp_context):
    ctx = erp_context
    synced = client.post("/api/sfa/sync-pedidos", headers=ctx["headers"], json={
        "pedidos": [{"cliente_id": ctx["customer"].id, "subtotal": 20, "total": 20,
                     "itens": [{"produto_id": ctx["prod"].id, "quantidade": 2,
                                "preco_unitario": 10, "total_item": 20}]}],
    })
    assert synced.status_code == 200, synced.get_json()
    order = session.query(PedidoVenda).first()
    response = client.post(f"/api/sfa/pedidos/{order.id}/aprovar", headers=ctx["headers"])
    assert response.status_code == 200, response.get_json()
    session.expire_all()
    assert session.query(Produto).filter_by(id=ctx["prod"].id).first().quantidade == 8
    assert session.query(ProdutoLote).filter_by(id=ctx["lot"].id).first().quantidade == 8


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="ERP-07: CMP trunca quantidades fracionárias")
def test_custo_medio_preserva_quantidade_fracionaria(erp_context):
    prod = erp_context["prod"]
    prod.quantidade = Decimal("1.5")
    prod.preco_custo = Decimal("10")
    prod.recalcular_preco_custo_ponderado(Decimal("0.5"), Decimal("20"), registrar_historico=False)
    assert prod.preco_custo == Decimal("12.50"), f"observado: {prod.preco_custo}"


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="ERP-08: lote vencido é elegível para consumo")
def test_consumo_nao_seleciona_lote_vencido(session, erp_context):
    ctx = erp_context
    ctx["lot"].data_validade = date.today() - timedelta(days=1)
    session.commit()
    selected = ctx["prod"].get_lotes_disponiveis()
    assert ctx["lot"].id not in {lot.id for lot in selected}


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="ERP-09: PDV não persiste custo unitário para CMV")
def test_pdv_registra_custo_historico_do_item(client, session, erp_context):
    ctx = erp_context
    session.add(Caixa(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id,
                      numero_caixa="ERP-AUDIT", saldo_inicial=0, saldo_atual=0, status="aberto"))
    session.commit()
    response = client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "subtotal": 20, "total": 20, "desconto": 0,
        "items": [{"id": ctx["prod"].id, "quantidade": 2, "preco_unitario": 10}],
        "pagamentos": [{"forma": "dinheiro", "valor": 20}],
    })
    assert response.status_code in (200, 201), response.get_json()
    item = session.query(VendaItem).filter_by(produto_id=ctx["prod"].id).first()
    assert item is not None
    assert item.custo_unitario == Decimal("4"), f"observado: {item.custo_unitario}"
