"""Pedido B2B: reserva de estoque, expedição parcial, saldo em carteira e cancelamento."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (Caixa, CategoriaProduto, Cliente, ContaReceber, Estabelecimento, Funcionario, PedidoVenda,
                        PedidoVendaExpedicao, PedidoVendaItem, Produto, ProdutoLote, Venda)


def hoje_local():
    """Data do dia na loja (o servidor roda em UTC e os títulos usam a data local)."""
    from datetime import datetime, timezone
    from app.utils.timezone import to_local
    return to_local(datetime.now(timezone.utc)).date()


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="B2B")
    cliente = Cliente(estabelecimento_id=estab.id, nome="Mercado Atacado", cpf="52998224725", celular="11999999999",
                      cep="01000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                      limite_credito=Decimal("100000"), saldo_devedor=Decimal("0"))
    session.add_all([cat, cliente])
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz 5kg", preco_custo=Decimal("4"),
                   preco_venda=Decimal("10"), quantidade=Decimal("10"))
    outro = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Feijão 1kg", preco_custo=Decimal("3"),
                    preco_venda=Decimal("8"), quantidade=Decimal("20"))
    session.add_all([prod, outro])
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="ARROZ-CURTO", quantidade=4,
                    quantidade_inicial=4, data_entrada=date.today(), data_validade=date.today() + timedelta(days=20),
                    preco_custo_unitario=4, ativo=True),
        ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="ARROZ-LONGO", quantidade=6,
                    quantidade_inicial=6, data_entrada=date.today(), data_validade=date.today() + timedelta(days=120),
                    preco_custo_unitario=4, ativo=True),
        ProdutoLote(estabelecimento_id=estab.id, produto_id=outro.id, numero_lote="FEIJAO", quantidade=20,
                    quantidade_inicial=20, data_entrada=date.today(), data_validade=date.today() + timedelta(days=90),
                    preco_custo_unitario=3, ativo=True),
        Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="B2B-1", saldo_inicial=0,
              saldo_atual=0, status="aberto"),
    ])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, cliente=cliente, prod=prod, outro=outro,
                headers={"Authorization": f"Bearer {token}"})


def _pedido(client, ctx, quantidade=10, preco=10, condicao="30 Dias", desconto=0, produto=None):
    bruto = round(quantidade * preco, 2)
    resposta = client.post("/api/sfa/sync-pedidos", headers=ctx["headers"], json={"pedidos": [{
        "cliente_id": ctx["cliente"].id, "subtotal": bruto, "total": round(bruto - desconto, 2), "desconto": desconto,
        "condicao_pagamento": condicao,
        "itens": [{"produto_id": (produto or ctx["prod"]).id, "quantidade": quantidade, "preco_unitario": preco,
                   "total_item": bruto}]}]})
    assert resposta.status_code == 200, resposta.get_json()
    return PedidoVenda.query.order_by(PedidoVenda.id.desc()).first()


def _post(client, ctx, pedido, acao, json=None):
    return client.post(f"/api/sfa/pedidos/{pedido.id}/{acao}", headers=ctx["headers"], json=json or {})


def _recarregar(session, modelo, pk):
    session.expire_all()
    return session.get(modelo, pk)


def _item(session, pedido):
    session.expire_all()
    return PedidoVendaItem.query.filter_by(pedido_id=pedido.id).order_by(PedidoVendaItem.id).first()


def _pdv(client, ctx, quantidade=1, produto=None):
    produto = produto or ctx["prod"]
    total = float(quantidade * 10)
    return client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "subtotal": total, "total": total, "desconto": 0,
        "items": [{"id": produto.id, "quantidade": quantidade, "preco_unitario": 10}],
        "pagamentos": [{"forma": "dinheiro", "valor": total}]})


# ───────────────────────── reserva ─────────────────────────

def test_reserva_tira_o_estoque_da_venda_de_balcao(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=10)
    resposta = _post(client, ctx, pedido, "reservar")
    assert resposta.status_code == 200, resposta.get_json()
    assert resposta.get_json()["data"]["pedido_status"] == "aprovado"
    assert _item(session, pedido).quantidade_reservada == Decimal("10")
    assert _recarregar(session, Produto, ctx["prod"].id).quantidade == Decimal("10")  # nada saiu ainda

    balcao = _pdv(client, ctx, 1)
    assert balcao.status_code == 400
    assert "reservado" in str(balcao.get_json()).lower()
    # Produto sem reserva continua vendendo normalmente.
    assert _pdv(client, ctx, 1, ctx["outro"]).status_code == 201


def test_reserva_tudo_ou_nada_e_com_falta_permitida(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=14)  # estoque físico: 10
    recusada = _post(client, ctx, pedido, "reservar")
    assert recusada.status_code == 400
    assert recusada.get_json()["faltas"][0]["falta"] == "4"
    assert _item(session, pedido).quantidade_reservada == 0
    assert _recarregar(session, PedidoVenda, pedido.id).status == "pendente"

    parcial = _post(client, ctx, pedido, "reservar", {"permitir_falta": True})
    assert parcial.status_code == 200, parcial.get_json()
    dados = parcial.get_json()["data"]
    assert dados["pedido_status"] == "aprovado" and dados["faltas"][0]["falta"] == "4"
    assert _item(session, pedido).quantidade_reservada == Decimal("10")


def test_segunda_reserva_completa_o_que_faltava_quando_chega_mercadoria(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=14)
    _post(client, ctx, pedido, "reservar", {"permitir_falta": True})
    _recarregar(session, Produto, ctx["prod"].id).quantidade = Decimal("14")  # recebimento de compra
    session.commit()
    resposta = _post(client, ctx, pedido, "reservar")
    assert resposta.status_code == 200, resposta.get_json()
    assert _item(session, pedido).quantidade_reservada == Decimal("14")


def test_dois_pedidos_nao_reservam_o_mesmo_estoque(client, session, ctx):
    primeiro = _pedido(client, ctx, quantidade=7)
    segundo = _pedido(client, ctx, quantidade=7)
    assert _post(client, ctx, primeiro, "reservar").status_code == 200
    recusado = _post(client, ctx, segundo, "reservar")
    assert recusado.status_code == 400
    assert recusado.get_json()["faltas"][0]["livre"] == "3"


def test_reserva_nao_pode_ser_pedida_para_pedido_encerrado(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=2)
    assert _post(client, ctx, pedido, "aprovar").status_code == 200
    assert _post(client, ctx, pedido, "reservar").status_code == 400


# ───────────────────────── expedição ─────────────────────────

def test_expedicao_parcial_baixa_estoque_gera_titulo_so_do_que_saiu(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=10)  # R$ 100 a 30 dias
    _post(client, ctx, pedido, "reservar")
    item = _item(session, pedido)

    primeira = _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 4}]})
    assert primeira.status_code == 200, primeira.get_json()
    dados = primeira.get_json()["data"]
    assert dados["total"] == pytest.approx(40.0) and dados["pedido_status"] == "parcial" and dados["expedicao"] == 1

    session.expire_all()
    assert session.get(Produto, ctx["prod"].id).quantidade == Decimal("6")
    item = _item(session, pedido)
    assert (item.quantidade_atendida, item.quantidade_reservada) == (Decimal("4"), Decimal("6"))
    titulos = ContaReceber.query.filter_by(cliente_id=ctx["cliente"].id).all()
    assert [t.valor_atual for t in titulos] == [Decimal("40.00")]
    assert titulos[0].data_vencimento == hoje_local() + timedelta(days=30)
    assert session.get(Cliente, ctx["cliente"].id).saldo_devedor == Decimal("40.00")

    segunda = _post(client, ctx, pedido, "expedir")  # sem corpo: tudo que está reservado
    assert segunda.status_code == 200, segunda.get_json()
    assert segunda.get_json()["data"]["total"] == pytest.approx(60.0)
    assert segunda.get_json()["data"]["pedido_status"] == "faturado"
    session.expire_all()
    assert session.get(Produto, ctx["prod"].id).quantidade == Decimal("0")
    assert sum(t.valor_atual for t in ContaReceber.query.filter_by(cliente_id=ctx["cliente"].id)) == Decimal("100.00")
    assert session.get(Cliente, ctx["cliente"].id).saldo_devedor == Decimal("100.00")
    assert _item(session, pedido).quantidade_reservada == 0


def test_cada_expedicao_grava_custo_historico_e_consome_o_lote_mais_curto(client, session, ctx):
    from app.models import VendaItem
    pedido = _pedido(client, ctx, quantidade=5)
    _post(client, ctx, pedido, "reservar")
    resposta = _post(client, ctx, pedido, "expedir")
    venda_id = resposta.get_json()["data"]["venda_id"]
    session.expire_all()
    assert VendaItem.query.filter_by(venda_id=venda_id).one().custo_unitario == Decimal("4")
    lotes = {l.numero_lote: l.quantidade for l in ProdutoLote.query.filter_by(produto_id=ctx["prod"].id)}
    assert lotes == {"ARROZ-CURTO": 0, "ARROZ-LONGO": 5}  # FEFO: 4 do curto + 1 do longo


def test_desconto_do_pedido_e_proporcional_e_a_ultima_saida_fecha_os_centavos(client, session, ctx):
    barato = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["prod"].categoria_id, nome="Sal 1kg",
                     preco_custo=Decimal("1"), preco_venda=Decimal("3.00"), quantidade=Decimal("30"))
    session.add(barato)
    session.flush()
    session.add(ProdutoLote(estabelecimento_id=ctx["estab"].id, produto_id=barato.id, numero_lote="SAL", quantidade=30,
                            quantidade_inicial=30, data_entrada=date.today(), data_validade=date.today() + timedelta(days=300),
                            preco_custo_unitario=1, ativo=True))
    session.commit()
    pedido = _pedido(client, ctx, quantidade=3, preco=3.33, desconto=1.00, produto=barato)  # itens 9,99; total 8,99
    _post(client, ctx, pedido, "reservar")
    item = _item(session, pedido)
    _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 1}]})
    _post(client, ctx, pedido, "expedir")
    session.expire_all()
    vendas = Venda.query.filter(Venda.tipo_venda == "sfa").order_by(Venda.id).all()
    assert [v.total for v in vendas] == [Decimal("3.00"), Decimal("5.99")]
    assert sum(v.total for v in vendas) == Decimal("8.99")
    assert sum(v.desconto for v in vendas) == Decimal("1.00")
    assert sum(t.valor_atual for t in ContaReceber.query.filter_by(cliente_id=ctx["cliente"].id)) == Decimal("8.99")


def test_expedicao_recusa_quantidade_acima_da_reserva_e_itens_invalidos(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=14)
    _post(client, ctx, pedido, "reservar", {"permitir_falta": True})  # reserva 10 de 14
    item = _item(session, pedido)
    assert _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 11}]}).status_code == 400
    assert _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": 99999, "quantidade": 1}]}).status_code == 400
    assert _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 0}]}).status_code == 400
    assert _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 1},
                                                           {"item_id": item.id, "quantidade": 1}]}).status_code == 400
    assert _post(client, ctx, pedido, "expedir", {"itens": []}).status_code == 400
    assert Venda.query.filter(Venda.tipo_venda == "sfa").count() == 0
    assert _recarregar(session, Produto, ctx["prod"].id).quantidade == Decimal("10")


def test_nao_expede_pedido_sem_reserva(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=2)
    resposta = _post(client, ctx, pedido, "expedir")
    assert resposta.status_code == 400 and "Reserve" in resposta.get_json()["message"]


def test_aprovar_continua_faturando_tudo_de_uma_vez(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=3)
    resposta = _post(client, ctx, pedido, "aprovar")
    assert resposta.status_code == 200, resposta.get_json()
    assert resposta.get_json()["data"]["total"] == pytest.approx(30.0)
    assert _recarregar(session, PedidoVenda, pedido.id).status == "faturado"
    assert _post(client, ctx, pedido, "aprovar").status_code == 200  # idempotente
    assert Venda.query.filter(Venda.tipo_venda == "sfa").count() == 1


def test_aprovar_fatura_o_saldo_de_pedido_ja_expedido_em_parte(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=10)
    _post(client, ctx, pedido, "reservar")
    item = _item(session, pedido)
    _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 6}]})
    resposta = _post(client, ctx, pedido, "aprovar")
    assert resposta.status_code == 200, resposta.get_json()
    assert resposta.get_json()["data"]["total"] == pytest.approx(40.0)
    assert _recarregar(session, PedidoVenda, pedido.id).status == "faturado"


# ───────────────────────── saldo e cancelamento ─────────────────────────

def test_cancelar_saldo_libera_a_reserva_para_outros_canais(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=10)
    _post(client, ctx, pedido, "reservar")
    item = _item(session, pedido)
    _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 4}]})
    assert _pdv(client, ctx, 1).status_code == 400  # 6 ainda reservados, 6 em estoque

    cancelado = _post(client, ctx, pedido, "cancelar-saldo", {"motivo": "Cliente desistiu do restante"})
    assert cancelado.status_code == 200, cancelado.get_json()
    assert cancelado.get_json()["data"]["pedido_status"] == "faturado"
    item = _item(session, pedido)
    assert (item.quantidade_atendida, item.quantidade_cancelada, item.quantidade_reservada) == (Decimal("4"), Decimal("6"), 0)
    assert _pdv(client, ctx, 1).status_code == 201


def test_cancelar_saldo_sem_nada_expedido_cancela_o_pedido(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=10)
    _post(client, ctx, pedido, "reservar")
    assert _post(client, ctx, pedido, "cancelar-saldo").get_json()["data"]["pedido_status"] == "cancelado"
    assert _pdv(client, ctx, 10).status_code == 201
    assert _post(client, ctx, pedido, "cancelar-saldo").status_code == 400  # já encerrado


def test_cancelar_a_venda_da_expedicao_reabre_o_saldo_do_pedido(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=10)
    _post(client, ctx, pedido, "reservar")
    item = _item(session, pedido)
    saida = _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 4}]})
    venda_id = saida.get_json()["data"]["venda_id"]

    cancelamento = client.post(f"/api/vendas/{venda_id}/cancelar", headers=ctx["headers"],
                               json={"motivo": "Devolvido na doca", "senha_admin": "industrial-secret"})
    assert cancelamento.status_code == 200, cancelamento.get_json()
    session.expire_all()
    item = _item(session, pedido)
    assert item.quantidade_atendida == 0 and item.quantidade_reservada == Decimal("6")
    assert session.get(PedidoVenda, pedido.id).status == "aprovado"
    assert session.get(Produto, ctx["prod"].id).quantidade == Decimal("10")
    assert session.get(Cliente, ctx["cliente"].id).saldo_devedor == 0
    assert PedidoVendaExpedicao.query.one().cancelada_em is not None

    # O saldo reaberto pode ser reservado de novo e expedido.
    assert _post(client, ctx, pedido, "reservar").status_code == 200
    assert _item(session, pedido).quantidade_reservada == Decimal("10")
    final = _post(client, ctx, pedido, "expedir")
    assert final.status_code == 200 and final.get_json()["data"]["total"] == pytest.approx(100.0)


# ───────────────────────── crédito ─────────────────────────

def _vencido(session, ctx):
    session.add(ContaReceber(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cliente"].id, numero_documento="VENC",
                             valor_original=50, valor_atual=50, data_emissao=date.today() - timedelta(days=60),
                             data_vencimento=date.today() - timedelta(days=30), status="aberto"))
    session.commit()


def test_cliente_em_atraso_nao_reserva_a_prazo_mas_reserva_a_vista(client, session, ctx):
    _vencido(session, ctx)
    a_prazo = _pedido(client, ctx, quantidade=2)
    recusado = _post(client, ctx, a_prazo, "reservar")
    assert recusado.status_code == 400 and "vencido" in recusado.get_json()["message"].lower()
    a_vista = _pedido(client, ctx, quantidade=2, condicao="A Vista")
    assert _post(client, ctx, a_vista, "reservar").status_code == 200


def test_credito_e_conferido_de_novo_na_expedicao(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=2)
    assert _post(client, ctx, pedido, "reservar").status_code == 200
    _vencido(session, ctx)  # o cliente atrasou depois da reserva
    barrada = _post(client, ctx, pedido, "expedir")
    assert barrada.status_code == 400 and "vencido" in barrada.get_json()["message"].lower()
    assert _item(session, pedido).quantidade_atendida == 0 and Venda.query.filter(Venda.tipo_venda == "sfa").count() == 0


def test_limite_de_credito_vale_para_a_parte_expedida(client, session, ctx):
    ctx["cliente"].limite_credito = Decimal("45")
    session.commit()
    pedido = _pedido(client, ctx, quantidade=10)  # R$ 100: o pedido todo não cabe no limite
    assert _post(client, ctx, pedido, "reservar").status_code == 400
    cliente = _recarregar(session, Cliente, ctx["cliente"].id)
    cliente.limite_credito = Decimal("100000")
    session.commit()
    assert _post(client, ctx, pedido, "reservar").status_code == 200
    cliente = _recarregar(session, Cliente, ctx["cliente"].id)
    cliente.limite_credito = Decimal("45")
    session.commit()
    item = _item(session, pedido)
    cabe = _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 4}]})  # R$ 40
    assert cabe.status_code == 200, cabe.get_json()
    nao_cabe = _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 1}]})  # +10 > 45
    assert nao_cabe.status_code == 400 and "Limite de crédito" in nao_cabe.get_json()["message"]


# ───────────────────────── leitura: fila, separação e catálogo ─────────────────────────

def test_fila_lista_pedidos_por_varios_status_com_o_andamento_dos_itens(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=10)
    _post(client, ctx, pedido, "reservar")
    item = _item(session, pedido)
    _post(client, ctx, pedido, "expedir", {"itens": [{"item_id": item.id, "quantidade": 4}]})
    _pedido(client, ctx, quantidade=1)  # este fica pendente

    fila = client.get("/api/sfa/pedidos?status=aprovado,parcial", headers=ctx["headers"]).get_json()["data"]
    assert [p["id"] for p in fila] == [pedido.id]
    linha = fila[0]["itens"][0]
    assert (float(linha["quantidade_atendida"]), float(linha["quantidade_reservada"]), linha["item_id"]) == (4.0, 6.0, item.id)
    todos = client.get("/api/sfa/pedidos", headers=ctx["headers"]).get_json()["data"]
    assert len(todos) == 2


def test_lista_de_separacao_sugere_os_lotes_de_validade_mais_curta(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=7)
    _post(client, ctx, pedido, "reservar")
    separacao = client.get(f"/api/sfa/pedidos/{pedido.id}/separacao", headers=ctx["headers"]).get_json()["data"]
    linha = separacao["itens"][0]
    assert linha["reservado"] == 7.0 and linha["em_falta"] == 0.0
    assert [(l["lote"], l["quantidade"]) for l in linha["lotes"]] == [("ARROZ-CURTO", 4.0), ("ARROZ-LONGO", 3.0)]


def test_catalogo_do_vendedor_mostra_disponivel_descontando_a_reserva(client, session, ctx):
    pedido = _pedido(client, ctx, quantidade=7)
    _post(client, ctx, pedido, "reservar")
    produtos = client.get("/api/sfa/sync-data", headers=ctx["headers"]).get_json()["data"]["produtos"]
    arroz = next(p for p in produtos if p["id"] == ctx["prod"].id)
    assert float(arroz["quantidade"]) == 10.0 and float(arroz["quantidade_reservada"]) == 7.0
    assert arroz["quantidade_disponivel"] == 3.0
    assert next(p for p in produtos if p["id"] == ctx["outro"].id)["quantidade_disponivel"] == 20.0


def test_vendedor_nao_reserva_nem_expede(client, session, ctx):
    vendedor = Funcionario(estabelecimento_id=ctx["estab"].id, nome="Vendedor", cpf="98765432100", username="vend_b2b",
                           role="VENDEDOR", ativo=True, data_nascimento=date(1990, 1, 1), celular="11999999999",
                           email="vend@example.test", cargo="Vendedor", data_admissao=date(2024, 1, 1),
                           salario_base=Decimal("1"))
    vendedor.set_password("vendedor-teste")
    session.add(vendedor)
    session.commit()
    token = create_access_token(identity=str(vendedor.id), additional_claims={
        "estabelecimento_id": ctx["estab"].id, "role": "VENDEDOR"})
    pedido = _pedido(client, ctx, quantidade=1)
    for acao in ("reservar", "expedir", "cancelar-saldo"):
        resposta = client.post(f"/api/sfa/pedidos/{pedido.id}/{acao}", headers={"Authorization": f"Bearer {token}"})
        assert resposta.status_code == 403, acao


def test_pedido_de_outra_loja_nao_e_encontrado(client, session, ctx):
    outra = Estabelecimento(nome_fantasia="Outra", razao_social="Outra LTDA", cnpj="99888777000166", email="o@x.com",
                            telefone="92988887777", data_abertura=date(2024, 1, 1), plano="PREMIUM",
                            vencimento_plano=date(2030, 12, 31), cep="69000-000", logradouro="Rua", numero="9",
                            bairro="Centro", cidade="Manaus", estado="AM", pais="Brasil")
    session.add(outra)
    session.flush()
    gerente = Funcionario(estabelecimento_id=outra.id, nome="Gerente Outra", cpf="11122233344", username="ger_outra",
                          role="admin", ativo=True, data_nascimento=date(1990, 1, 1), celular="92999999999",
                          email="ger@outra.com", cargo="Gerente", data_admissao=date(2024, 1, 1), salario_base=Decimal("1"))
    gerente.set_password("outra-senha")
    session.add(gerente)
    session.commit()
    token = create_access_token(identity=str(gerente.id), additional_claims={"estabelecimento_id": outra.id, "role": "admin"})
    pedido = _pedido(client, ctx, quantidade=1)
    resposta = client.post(f"/api/sfa/pedidos/{pedido.id}/reservar", headers={"Authorization": f"Bearer {token}"})
    assert resposta.status_code == 404
