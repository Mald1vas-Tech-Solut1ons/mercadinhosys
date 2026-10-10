"""Aprovação de pedido do vendedor: à vista não consome limite nem é barrado por atraso; a prazo exige cliente em dia."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (CategoriaProduto, Cliente, ContaReceber, Estabelecimento, Funcionario, PedidoVenda, Produto,
                        ProdutoLote)


def hoje_local():
    """Data do dia na loja (o servidor roda em UTC e os títulos usam a data local)."""
    from datetime import datetime, timezone
    from app.utils.timezone import to_local
    return to_local(datetime.now(timezone.utc)).date()


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="SFA crédito")
    cliente = Cliente(estabelecimento_id=estab.id, nome="Mercado Prazo", cpf="52998224725", celular="11999999999",
                      cep="01000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                      limite_credito=Decimal("100"), saldo_devedor=Decimal("0"))
    session.add_all([cat, cliente])
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz 5kg", preco_custo=Decimal("4"),
                   preco_venda=Decimal("10"), quantidade=Decimal("100"))
    session.add(prod)
    session.flush()
    session.add(ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="L1", quantidade=100,
                            quantidade_inicial=100, data_entrada=date.today(),
                            data_validade=date.today() + timedelta(days=60), preco_custo_unitario=4, ativo=True))
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, cliente=cliente, prod=prod, headers={"Authorization": f"Bearer {token}"})


def _pedido(client, ctx, condicao, quantidade=20):
    """Pedido de R$ 200 (limite do cliente é R$ 100)."""
    total = 10 * quantidade
    resposta = client.post("/api/sfa/sync-pedidos", headers=ctx["headers"], json={"pedidos": [{
        "cliente_id": ctx["cliente"].id, "subtotal": total, "total": total, "condicao_pagamento": condicao,
        "itens": [{"produto_id": ctx["prod"].id, "quantidade": quantidade, "preco_unitario": 10, "total_item": total}]}]})
    assert resposta.status_code == 200, resposta.get_json()
    return PedidoVenda.query.order_by(PedidoVenda.id.desc()).first()


def _vencido(session, ctx, dias=30):
    session.add(ContaReceber(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cliente"].id, numero_documento="VENC",
                             valor_original=50, valor_atual=50, data_emissao=date.today() - timedelta(days=dias + 30),
                             data_vencimento=date.today() - timedelta(days=dias), status="aberto"))
    session.commit()


def _aprovar(client, ctx, pedido):
    return client.post(f"/api/sfa/pedidos/{pedido.id}/aprovar", headers=ctx["headers"])


def test_pedido_a_vista_acima_do_limite_e_aprovado(client, session, ctx):
    resposta = _aprovar(client, ctx, _pedido(client, ctx, "A Vista"))
    assert resposta.status_code == 200, resposta.get_json()
    session.expire_all()
    # O título à vista vence hoje (cobrança na entrega) e o saldo do cliente bate com os títulos abertos.
    titulo = ContaReceber.query.filter_by(cliente_id=ctx["cliente"].id).one()
    assert titulo.valor_atual == Decimal("200.00") and titulo.data_vencimento == hoje_local()
    assert session.get(Cliente, ctx["cliente"].id).saldo_devedor == Decimal("200.00")


def test_pedido_a_vista_de_cliente_em_atraso_e_aprovado(client, session, ctx):
    _vencido(session, ctx)
    resposta = _aprovar(client, ctx, _pedido(client, ctx, "A Vista", quantidade=5))
    assert resposta.status_code == 200, resposta.get_json()


def test_pedido_a_prazo_acima_do_limite_e_recusado(client, session, ctx):
    pedido = _pedido(client, ctx, "30 Dias")
    resposta = _aprovar(client, ctx, pedido)
    assert resposta.status_code == 400
    assert "Limite de crédito excedido" in resposta.get_json()["message"]
    session.expire_all()
    assert session.get(PedidoVenda, pedido.id).status == "pendente"


def test_pedido_a_prazo_de_cliente_em_atraso_e_recusado_mesmo_dentro_do_limite(client, session, ctx):
    _vencido(session, ctx)
    pedido = _pedido(client, ctx, "30 Dias", quantidade=5)  # R$ 50, dentro do limite de R$ 100
    resposta = _aprovar(client, ctx, pedido)
    assert resposta.status_code == 400
    assert "vencido" in resposta.get_json()["message"].lower()
    session.expire_all()
    assert session.get(PedidoVenda, pedido.id).status == "pendente"


def test_pedido_a_prazo_de_cliente_em_dia_dentro_do_limite_gera_titulo(client, session, ctx):
    pedido = _pedido(client, ctx, "30 Dias", quantidade=5)
    resposta = _aprovar(client, ctx, pedido)
    assert resposta.status_code == 200, resposta.get_json()
    titulo = ContaReceber.query.filter_by(cliente_id=ctx["cliente"].id).one()
    assert titulo.valor_atual == Decimal("50.00")
    assert titulo.data_vencimento == hoje_local() + timedelta(days=30)


def test_cliente_cadastrado_pelo_vendedor_entra_na_carteira_dele(client, session, ctx):
    from app.models import Rota
    vendedor = Funcionario(estabelecimento_id=ctx["estab"].id, nome="Vendedor Rota", cpf="98765432100",
                           username="vend_rota", role="VENDEDOR", ativo=True, data_nascimento=date(1990, 1, 1),
                           celular="11999999999", email="rota@example.test", cargo="Vendedor",
                           data_admissao=date(2024, 1, 1), salario_base=Decimal("1"))
    vendedor.set_password("vendedor-teste")
    session.add(vendedor)
    session.flush()
    rota = Rota(estabelecimento_id=ctx["estab"].id, nome="Rota Norte", vendedor_id=vendedor.id, ativa=True)
    session.add(rota)
    session.commit()
    token = create_access_token(identity=str(vendedor.id), additional_claims={
        "estabelecimento_id": ctx["estab"].id, "role": "VENDEDOR"})
    headers = {"Authorization": f"Bearer {token}"}

    criado = client.post("/api/clientes/", headers=headers, json={
        "nome": "Mercadinho Novo", "cpf": "11144477735", "celular": "11977776666"})
    assert criado.status_code == 201, criado.get_json()
    assert session.get(Cliente, criado.get_json()["cliente"]["id"]).rota_id == rota.id

    carteira = client.get("/api/sfa/sync-data", headers=headers).get_json()["data"]["clientes"]
    assert "Mercadinho Novo" in [c["nome"] for c in carteira]


def _vendedor_com_rota(session, ctx, username, cpf, nome_rota):
    from app.models import Rota
    func = Funcionario(estabelecimento_id=ctx["estab"].id, nome=f"Vend {username}", cpf=cpf, username=username,
                       role="VENDEDOR", ativo=True, data_nascimento=date(1990, 1, 1), celular="11999999999",
                       email=f"{username}@example.test", cargo="Vendedor", data_admissao=date(2024, 1, 1),
                       salario_base=Decimal("1"))
    func.set_password("vendedor-teste")
    session.add(func)
    session.flush()
    rota = Rota(estabelecimento_id=ctx["estab"].id, nome=nome_rota, vendedor_id=func.id, ativa=True)
    session.add(rota)
    session.commit()
    token = create_access_token(identity=str(func.id), additional_claims={
        "estabelecimento_id": ctx["estab"].id, "role": "VENDEDOR"})
    return func, rota, {"Authorization": f"Bearer {token}"}


def _cliente_na_rota(ctx, nome, cpf, rota=None, **extra):
    return Cliente(estabelecimento_id=ctx["estab"].id, nome=nome, cpf=cpf, celular="11999999999", cep="01000000",
                   logradouro="Rua", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                   rota_id=rota.id if rota else None, **extra)


def test_vendedor_so_enxerga_a_propria_carteira(client, session, ctx):
    _, rota_a, headers_a = _vendedor_com_rota(session, ctx, "vend_a", "11111111111", "Rota A")
    _, rota_b, _ = _vendedor_com_rota(session, ctx, "vend_b", "22222222222", "Rota B")
    meu = _cliente_na_rota(ctx, "Do Vendedor A", "39053344705", rota_a)
    alheio = _cliente_na_rota(ctx, "Do Vendedor B", "11144477735", rota_b)
    session.add_all([meu, alheio])
    session.commit()

    def nomes(resposta):
        return [c["nome"] for c in resposta.get_json()["clientes"]]

    assert nomes(client.get("/api/clientes/", headers=headers_a)) == ["Do Vendedor A"]
    assert {"Do Vendedor A", "Do Vendedor B"} <= set(nomes(client.get("/api/clientes/", headers=ctx["headers"])))
    assert nomes(client.get("/api/clientes/buscar?q=Vendedor", headers=headers_a)) == ["Do Vendedor A"]

    assert client.get(f"/api/clientes/{meu.id}", headers=headers_a).status_code == 200
    assert client.get(f"/api/clientes/{alheio.id}", headers=headers_a).status_code == 404
    assert client.get(f"/api/clientes/{alheio.id}/credito", headers=headers_a).status_code == 404


def test_vendedor_nao_acessa_base_toda_nem_cobranca(client, session, ctx):
    _, rota, headers = _vendedor_com_rota(session, ctx, "vend_c", "33333333333", "Rota C")
    cliente = _cliente_na_rota(ctx, "Da Rota", "39053344705", rota, saldo_devedor=Decimal("100"))
    session.add(cliente)
    session.commit()
    for metodo, caminho in (("get", "/api/clientes/exportar"), ("get", "/api/clientes/estatisticas"),
                            ("get", "/api/clientes/rfm"), ("get", "/api/clientes/relatorio/analitico"),
                            ("post", f"/api/clientes/{cliente.id}/pagar_fiado"), ("delete", f"/api/clientes/{cliente.id}"),
                            ("put", f"/api/clientes/{cliente.id}"), ("post", "/api/clientes/importar")):
        resposta = getattr(client, metodo)(caminho, headers=headers, json={"valor": 10, "limite_credito": 99999})
        assert resposta.status_code == 403, (metodo, caminho, resposta.status_code)
    session.expire_all()
    assert session.get(Cliente, cliente.id).saldo_devedor == Decimal("100.00")
    assert session.get(Cliente, cliente.id).limite_credito != 99999


def test_cliente_do_vendedor_nasce_sem_limite_de_credito(client, session, ctx):
    _, rota, headers = _vendedor_com_rota(session, ctx, "vend_d", "44444444444", "Rota D")
    criado = client.post("/api/clientes/", headers=headers, json={
        "nome": "Novo Sem Limite", "cpf": "11144477735", "celular": "11977776666", "limite_credito": 50000})
    assert criado.status_code == 201, criado.get_json()
    assert session.get(Cliente, criado.get_json()["cliente"]["id"]).limite_credito == 0


def test_gerencia_continua_vendo_toda_a_base(client, session, ctx):
    session.add(_cliente_na_rota(ctx, "Sem Rota", "39053344705"))
    session.commit()
    nomes = [c["nome"] for c in client.get("/api/clientes/", headers=ctx["headers"]).get_json()["clientes"]]
    assert "Sem Rota" in nomes
    assert client.get("/api/clientes/estatisticas", headers=ctx["headers"]).status_code == 200
