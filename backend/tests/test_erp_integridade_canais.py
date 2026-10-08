"""Integridade de estoque, custo e dinheiro entre PDV, SFA, entrega e compras.

Complementa as provas ERP-01..09: cada canal usa a mesma regra de saldo
vendável (lote vencido em quarentena), grava custo histórico, estorna
exatamente o que consumiu e o recebimento parcial mantém título e custo certos.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Cliente, ContaPagar, ContaReceber, Estabelecimento, Funcionario, Fornecedor,
    MovimentacaoEstoque, Pagamento, PedidoCompra, PedidoCompraItem, PedidoVenda, Produto, ProdutoLote,
    TabelaPreco, TabelaPrecoItem, Venda, VendaItem,
)


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Integridade")
    forn = Fornecedor(
        estabelecimento_id=estab.id, nome_fantasia="Distribuidora Teste", razao_social="Distribuidora Teste LTDA",
        cnpj="11222333000155", telefone="11999999999", email="forn@example.test", cep="01000000",
        logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP", pais="Brasil",
    )
    cliente = Cliente(
        estabelecimento_id=estab.id, nome="Mercado Cliente", cpf="12345678901", celular="11999999999",
        cep="01000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
        limite_credito=Decimal("10000"), saldo_devedor=Decimal("0"),
    )
    session.add_all([cat, forn, cliente])
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz 5kg", preco_custo=Decimal("4"),
                   preco_venda=Decimal("10"), quantidade=Decimal("10"), controlar_validade=True)
    session.add(prod)
    session.flush()
    lote = ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, fornecedor_id=forn.id, numero_lote="L-OK",
                       quantidade=10, quantidade_inicial=10, data_entrada=date.today(),
                       data_validade=date.today() + timedelta(days=30), preco_custo_unitario=4, ativo=True)
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="INT-1",
                  saldo_inicial=0, saldo_atual=0, status="aberto")
    session.add_all([lote, caixa])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, forn=forn, cliente=cliente, prod=prod, lote=lote, caixa=caixa, cat=cat,
                headers={"Authorization": f"Bearer {token}"})


def _get(session, model, pk):
    session.expire_all()
    return session.get(model, pk)


def _pdv(client, ctx, quantidade, preco=10, produto=None):
    total = Decimal(str(quantidade)) * Decimal(str(preco))
    return client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "subtotal": float(total), "total": float(total), "desconto": 0,
        "items": [{"id": (produto or ctx["prod"]).id, "quantidade": quantidade, "preco_unitario": preco}],
        "pagamentos": [{"forma": "dinheiro", "valor": float(total)}],
    })


def _cancelar(client, ctx, venda_id):
    return client.post(f"/api/vendas/{venda_id}/cancelar", headers=ctx["headers"],
                       json={"motivo": "Teste", "senha_admin": "industrial-secret"})


# ── Saldo vendável e lotes ────────────────────────────────────────────────

def test_lote_vencido_fica_em_quarentena_no_pdv(client, session, ctx):
    session.add(ProdutoLote(estabelecimento_id=ctx["estab"].id, produto_id=ctx["prod"].id, numero_lote="L-VENC",
                            quantidade=4, quantidade_inicial=4, data_entrada=date.today() - timedelta(days=90),
                            data_validade=date.today() - timedelta(days=1), preco_custo_unitario=4, ativo=True))
    _get(session, Produto, ctx["prod"].id).quantidade = Decimal("14")
    session.commit()

    bloqueada = _pdv(client, ctx, 11)
    assert bloqueada.status_code == 400
    assert "lote vencido" in bloqueada.get_json()["error"]

    assert _pdv(client, ctx, 10).status_code == 201
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("4")
    assert session.query(ProdutoLote).filter_by(numero_lote="L-VENC").one().quantidade == 4
    assert _get(session, ProdutoLote, ctx["lote"].id).quantidade == 0


def test_descarte_consome_primeiro_o_lote_vencido(session, ctx):
    vencido = ProdutoLote(estabelecimento_id=ctx["estab"].id, produto_id=ctx["prod"].id, numero_lote="L-DESC",
                          quantidade=3, quantidade_inicial=3, data_entrada=date.today() - timedelta(days=90),
                          data_validade=date.today() - timedelta(days=2), preco_custo_unitario=4, ativo=True)
    session.add(vencido)
    session.commit()
    prod = _get(session, Produto, ctx["prod"].id)
    consumidos = prod.consumir_estoque_fifo(Decimal("3"), incluir_vencidos=True)
    assert [c["lote_id"] for c in consumidos] == [vencido.id]


def test_venda_fracionada_preserva_kg(client, session, ctx):
    granel = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["cat"].id, nome="Feijão granel kg",
                     unidade_medida="KG", preco_custo=Decimal("6"), preco_venda=Decimal("9.90"),
                     quantidade=Decimal("2.500"), controlar_validade=False)
    session.add(granel)
    session.commit()
    resposta = _pdv(client, ctx, 1.25, preco=9.9, produto=granel)
    assert resposta.status_code == 201, resposta.get_json()
    assert _get(session, Produto, granel.id).quantidade == Decimal("1.250")


def test_servico_nao_movimenta_estoque(client, session, ctx):
    servico = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["cat"].id, nome="Montagem",
                      tipo_item="servico", controlar_estoque=False, preco_custo=Decimal("0"),
                      preco_venda=Decimal("30"), quantidade=Decimal("0"))
    session.add(servico)
    session.commit()
    assert _pdv(client, ctx, 1, preco=30, produto=servico).status_code == 201
    assert session.query(MovimentacaoEstoque).filter_by(produto_id=servico.id).count() == 0


# ── Cancelamento estorna exatamente o que saiu ─────────────────────────────

def test_cancelamento_pdv_devolve_agregado_e_lote_uma_vez(client, session, ctx):
    venda_id = _pdv(client, ctx, 3).get_json()["venda"]["id"]
    assert _get(session, ProdutoLote, ctx["lote"].id).quantidade == 7

    assert _cancelar(client, ctx, venda_id).status_code == 200
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("10")
    assert _get(session, ProdutoLote, ctx["lote"].id).quantidade == 10
    assert _cancelar(client, ctx, venda_id).status_code == 400
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("10")


def test_cancelar_venda_entrega_legada_nao_infla_estoque(client, session, ctx):
    # Antes da correção a venda-entrega não baixava estoque nem gerava movimento.
    venda = Venda(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id, codigo="VE-LEGADA",
                  subtotal=20, total=20, status="finalizada", tipo_venda="delivery")
    session.add(venda)
    session.flush()
    session.add(VendaItem(estabelecimento_id=ctx["estab"].id, venda_id=venda.id, produto_id=ctx["prod"].id,
                          produto_nome="Arroz 5kg", quantidade=2, preco_unitario=10, total_item=20))
    session.commit()
    assert _cancelar(client, ctx, venda.id).status_code == 200
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("10")


# ── Venda com entrega ─────────────────────────────────────────────────────

def _entrega(client, ctx, pagamentos, quantidade=5, total=None, extra=None):
    bruto = 10 * quantidade
    payload = {"cliente_id": ctx["cliente"].id, "subtotal": bruto, "total": bruto if total is None else total,
               "itens": [{"produto_id": ctx["prod"].id, "quantidade": quantidade, "preco_unitario": 10,
                          "total_item": bruto}],
               "pagamentos": pagamentos}
    payload.update(extra or {})
    return client.post("/api/delivery/venda-entrega", headers=ctx["headers"], json=payload)


def test_entrega_paga_misto_so_soma_dinheiro_na_gaveta(client, session, ctx):
    resposta = _entrega(client, ctx, [{"forma_pagamento": "dinheiro", "valor": 20},
                                      {"forma_pagamento": "cartao_credito", "valor": 30}])
    assert resposta.status_code == 201, resposta.get_json()
    assert _get(session, Caixa, ctx["caixa"].id).saldo_atual == Decimal("20")
    item = session.query(VendaItem).filter_by(venda_id=resposta.get_json()["venda_id"]).one()
    assert item.custo_unitario == Decimal("4")
    assert _get(session, ProdutoLote, ctx["lote"].id).quantidade == 5


def test_entrega_rejeita_total_manipulado(client, session, ctx):
    resposta = _entrega(client, ctx, [{"forma_pagamento": "dinheiro", "valor": 1}], total=1)
    assert resposta.status_code == 400
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("10")


def test_entrega_produto_inexistente_nao_e_ignorado(client, session, ctx):
    resposta = client.post("/api/delivery/venda-entrega", headers=ctx["headers"], json={
        "subtotal": 10, "total": 10, "itens": [{"produto_id": 999999, "quantidade": 1, "preco_unitario": 10}],
        "pagamentos": [{"forma_pagamento": "dinheiro", "valor": 10}]})
    assert resposta.status_code in (400, 404)
    assert session.query(Venda).count() == 0


def test_entrega_sem_caixa_aceita_pix_e_porta_mas_nao_dinheiro(client, session, ctx):
    _get(session, Caixa, ctx["caixa"].id).status = "fechado"
    session.commit()
    assert _entrega(client, ctx, [{"forma_pagamento": "dinheiro", "valor": 50}]).status_code == 403
    assert _entrega(client, ctx, [{"forma_pagamento": "pix", "valor": 50}], quantidade=5).status_code == 201
    resposta = _entrega(client, ctx, [{"forma_pagamento": "entrega", "valor": 50}])
    assert resposta.status_code == 201, resposta.get_json()
    pagamento = session.query(Pagamento).filter_by(venda_id=resposta.get_json()["venda_id"]).one()
    assert pagamento.status == "pendente"


def test_entrega_no_fiado_gera_titulo_e_consome_credito(client, session, ctx):
    resposta = _entrega(client, ctx, [{"forma_pagamento": "fiado", "valor": 50}])
    assert resposta.status_code == 201, resposta.get_json()
    conta = session.query(ContaReceber).filter_by(venda_id=resposta.get_json()["venda_id"]).one()
    assert conta.valor_original == Decimal("50")
    assert _get(session, Cliente, ctx["cliente"].id).saldo_devedor == Decimal("50")


# ── Força de vendas ────────────────────────────────────────────────────────

def _sync(client, ctx, preco, quantidade=2, total=None):
    bruto = preco * quantidade
    return client.post("/api/sfa/sync-pedidos", headers=ctx["headers"], json={"pedidos": [{
        "cliente_id": ctx["cliente"].id, "subtotal": bruto, "total": bruto if total is None else total,
        "itens": [{"produto_id": ctx["prod"].id, "quantidade": quantidade, "preco_unitario": preco,
                   "total_item": bruto}]}]})


def test_sfa_respeita_piso_da_tabela_do_cliente(client, session, ctx):
    tabela = TabelaPreco(estabelecimento_id=ctx["estab"].id, nome="Atacado", ativa=True)
    session.add(tabela)
    session.flush()
    session.add(TabelaPrecoItem(estabelecimento_id=ctx["estab"].id, tabela_id=tabela.id, produto_id=ctx["prod"].id,
                                preco_venda=Decimal("8"), preco_minimo=Decimal("7.50")))
    _get(session, Cliente, ctx["cliente"].id).tabela_preco_id = tabela.id
    session.commit()
    assert _sync(client, ctx, 7).status_code == 400
    assert _sync(client, ctx, 7.5).status_code == 200
    assert session.query(PedidoVenda).one().total == Decimal("15")


def test_sfa_sem_tabela_permite_ate_dez_por_cento(client, session, ctx):
    assert _sync(client, ctx, 8.99).status_code == 400
    assert _sync(client, ctx, 9).status_code == 200


def test_sfa_aprovacao_idempotente_e_cancelamento_devolve_lote(client, session, ctx):
    assert _sync(client, ctx, 10).status_code == 200
    pedido = session.query(PedidoVenda).one()
    primeira = client.post(f"/api/sfa/pedidos/{pedido.id}/aprovar", headers=ctx["headers"])
    assert primeira.status_code == 200, primeira.get_json()
    assert client.post(f"/api/sfa/pedidos/{pedido.id}/aprovar", headers=ctx["headers"]).status_code == 200
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("8")
    assert _get(session, ProdutoLote, ctx["lote"].id).quantidade == 8

    venda_id = primeira.get_json()["data"]["venda_id"]
    item = session.query(VendaItem).filter_by(venda_id=venda_id).one()
    assert item.custo_unitario == Decimal("4")
    assert _cancelar(client, ctx, venda_id).status_code == 200
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("10")
    assert _get(session, ProdutoLote, ctx["lote"].id).quantidade == 10


def test_sfa_sem_estoque_nao_fatura_nem_cobra(client, session, ctx):
    assert _sync(client, ctx, 10, quantidade=11).status_code == 200
    pedido = session.query(PedidoVenda).one()
    resposta = client.post(f"/api/sfa/pedidos/{pedido.id}/aprovar", headers=ctx["headers"])
    assert resposta.status_code == 400
    assert session.query(ContaReceber).count() == 0
    assert _get(session, PedidoVenda, pedido.id).status == "pendente"


# ── Compras: recebimento parcial, título e custo ─────────────────────────

def _compra(client, session, ctx, quantidade=10, preco=4, frete=0):
    resposta = client.post("/api/pedidos-compra/", headers=ctx["headers"], json={
        "fornecedor_id": ctx["forn"].id, "frete": frete,
        "itens": [{"produto_id": ctx["prod"].id, "quantidade": quantidade, "preco_unitario": preco}]})
    assert resposta.status_code == 201, resposta.get_json()
    pedido_id = resposta.get_json()["pedido"]["id"]
    return pedido_id, session.query(PedidoCompraItem).filter_by(pedido_id=pedido_id).one().id


def _receber(client, ctx, pedido_id, item_id, **qtd):
    linha = {"item_id": item_id, "data_validade": (date.today() + timedelta(days=90)).isoformat(), **qtd}
    return client.post("/api/pedidos-compra/receber", headers=ctx["headers"], json={"pedido_id": pedido_id, "itens": [linha]})


def test_recebimento_em_duas_cargas_fecha_pedido_e_estoque(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    primeira = _receber(client, ctx, pedido_id, item_id, quantidade_recebida=3)
    assert primeira.status_code == 200, primeira.get_json()
    assert _get(session, PedidoCompra, pedido_id).status == "parcial"
    assert _receber(client, ctx, pedido_id, item_id, quantidade_recebida=8).status_code == 400
    assert _receber(client, ctx, pedido_id, item_id, quantidade_recebida=7).status_code == 200

    assert _get(session, PedidoCompra, pedido_id).status == "recebido"
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("20")
    lotes = session.query(ProdutoLote).filter_by(pedido_compra_id=pedido_id).all()
    assert sorted(l.quantidade for l in lotes) == [3, 7]
    assert len({l.numero_lote for l in lotes}) == 2
    assert session.query(ContaPagar).filter_by(pedido_compra_id=pedido_id).one().valor_original == Decimal("40")


def test_falta_reduz_titulo_preservando_baixa(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    conta = session.query(ContaPagar).filter_by(pedido_compra_id=pedido_id).one()
    assert client.post(f"/api/boletos/{conta.id}/pagar", headers=ctx["headers"], json={"valor_pago": 30}).status_code == 200

    resposta = _receber(client, ctx, pedido_id, item_id, quantidade_recebida=6, quantidade_faltante=4)
    assert resposta.status_code == 200, resposta.get_json()
    conta = _get(session, ContaPagar, conta.id)
    assert conta.valor_original == Decimal("24")
    assert conta.valor_atual == Decimal("0")
    assert conta.status == "pago"
    assert "Crédito com fornecedor: R$ 6.00" in conta.observacoes
    assert _get(session, PedidoCompra, pedido_id).status == "recebido"


def test_frete_entra_no_custo_do_lote_e_no_medio(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx, frete=8)  # 10 × 4 + frete 8 = 48
    assert _receber(client, ctx, pedido_id, item_id, quantidade_recebida=10).status_code == 200
    lote = session.query(ProdutoLote).filter_by(pedido_compra_id=pedido_id).one()
    assert lote.preco_custo_unitario == Decimal("4.8000")
    # (10 × 4 + 10 × 4,80) / 20
    assert _get(session, Produto, ctx["prod"].id).preco_custo == Decimal("4.4000")
    assert session.query(ContaPagar).filter_by(pedido_compra_id=pedido_id).one().valor_original == Decimal("48")


def test_bonificacao_dilui_custo_sem_aumentar_titulo(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    resposta = _receber(client, ctx, pedido_id, item_id, quantidade_recebida=10, quantidade_bonificada=2)
    assert resposta.status_code == 200, resposta.get_json()
    lote = session.query(ProdutoLote).filter_by(pedido_compra_id=pedido_id).one()
    assert lote.quantidade == 12
    assert lote.preco_custo_unitario == Decimal("3.3333")  # 40 / 12
    # (10 × 4 + 12 × 3,3333) / 22
    assert _get(session, Produto, ctx["prod"].id).preco_custo == Decimal("3.6363")
    assert session.query(ContaPagar).filter_by(pedido_compra_id=pedido_id).one().valor_original == Decimal("40")


def test_avaria_nao_entra_no_estoque_nem_no_titulo(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    resposta = _receber(client, ctx, pedido_id, item_id, quantidade_recebida=10, quantidade_avariada=2)
    assert resposta.status_code == 200, resposta.get_json()
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("18")
    assert session.query(ContaPagar).filter_by(pedido_compra_id=pedido_id).one().valor_original == Decimal("32")


def test_validade_obrigatoria_so_para_produto_controlado(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    sem_data = client.post("/api/pedidos-compra/receber", headers=ctx["headers"], json={
        "pedido_id": pedido_id, "itens": [{"item_id": item_id, "quantidade_recebida": 1}]})
    assert sem_data.status_code == 400
    _get(session, Produto, ctx["prod"].id).controlar_validade = False
    session.commit()
    sem_data = client.post("/api/pedidos-compra/receber", headers=ctx["headers"], json={
        "pedido_id": pedido_id, "itens": [{"item_id": item_id, "quantidade_recebida": 1}]})
    assert sem_data.status_code == 200, sem_data.get_json()


def test_compra_fracionada_nao_trunca(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx, quantidade=2.5, preco=6)
    item = _get(session, PedidoCompraItem, item_id)
    assert item.quantidade_solicitada == Decimal("2.500")
    assert _get(session, PedidoCompra, pedido_id).total == Decimal("15.00")
