"""
SMOKE TEST do fluxo de demonstração — caminha o happy-path que o Rafael mostra
para o cliente, batendo nos ENDPOINTS REAIS da API:

    cadastrar cliente → cadastrar produto → abrir venda → emitir comprovante

Se qualquer um quebrar, a demo quebra. Este teste é a prova de que não quebra.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    db, Estabelecimento, Funcionario, CategoriaProduto, Produto, ProdutoLote, Caixa, Cliente,
)


def _headers(estab_id, func_id):
    token = create_access_token(identity=str(func_id), additional_claims={
        "estabelecimento_id": estab_id, "role": "admin", "nome": "Admin Demo",
    })
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def ctx(session):
    """Contexto de demo: loja, admin, caixa ABERTO (venda exige) e categoria."""
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

    caixa = Caixa(
        estabelecimento_id=estab.id, funcionario_id=admin.id,
        numero_caixa="PDV-01", saldo_inicial=Decimal("100"), saldo_atual=Decimal("100"),
        status="aberto", data_abertura=datetime.now(timezone.utc),
    )
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Geral")
    session.add_all([caixa, cat])
    session.commit()
    return {"estab": estab, "admin": admin, "cat": cat}


def test_demo_cadastrar_cliente(client, ctx):
    r = client.post("/api/clientes/", json={
        "nome": "Cliente Demonstração",
        "cpf": "390.533.447-05",   # CPF válido
        "celular": "(92) 99123-4567",
        "email": "cliente@demo.com",
    }, headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code in (200, 201), r.get_data(as_text=True)
    assert r.get_json().get("success") is not False


def test_demo_cadastrar_produto(client, ctx):
    r = client.post("/api/produtos/", json={
        "nome": "Refrigerante Cola 2L",
        "subcategoria": "Outros Alimentos",
        "preco_custo": 4.50,
        "preco_venda": 8.90,
        "quantidade": 100, "data_validade": "2099-12-31",
        "codigo_barras": "7890000000017",
    }, headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code in (200, 201), r.get_data(as_text=True)
    assert r.get_json().get("success") is not False


def test_demo_validar_produto_por_codigo_barras_retorna_aliases_estoque(client, ctx):
    estab, admin = ctx["estab"], ctx["admin"]
    produto = Produto(
        estabelecimento_id=estab.id,
        categoria_id=ctx["cat"].id,
        nome="Hellmann's 500g",
        preco_custo=Decimal("8.50"),
        preco_venda=Decimal("12.90"),
        quantidade=24,
        codigo_barras="7890000000024",
    )
    db.session.add(produto)
    db.session.commit()

    r = client.post("/api/pdv/validar-produto", json={
        "codigo_barras": produto.codigo_barras,
        "quantidade": 1,
    }, headers=_headers(estab.id, admin.id))
    assert r.status_code == 200, r.get_data(as_text=True)

    body = r.get_json()
    assert body.get("valido") is True, body

    payload = body.get("produto") or {}
    assert payload.get("quantidade") == 24.0, payload
    assert payload.get("quantidade_estoque") == 24.0, payload
    assert payload.get("estoque_atual") == 24.0, payload


def test_demo_ajuste_corrige_lote_existente_sem_criar_outro(client, ctx):
    estab, admin = ctx["estab"], ctx["admin"]
    produto = Produto(
        estabelecimento_id=estab.id,
        categoria_id=ctx["cat"].id,
        nome="Maionese Tradicional",
        preco_custo=Decimal("7.00"),
        preco_venda=Decimal("10.50"),
        quantidade=24,
    )
    db.session.add(produto)
    db.session.flush()

    lote = ProdutoLote(
        estabelecimento_id=estab.id,
        produto_id=produto.id,
        numero_lote="LOTE-PC000607-1",
        quantidade=Decimal("24"),
        quantidade_inicial=Decimal("24"),
        data_fabricacao=None,
        data_validade=date(2027, 7, 14),
        data_entrada=date(2026, 7, 14),
        preco_custo_unitario=Decimal("7.00"),
        preco_venda=Decimal("10.50"),
        ativo=True,
    )
    db.session.add(lote)
    db.session.commit()

    r = client.post(f"/api/produtos/{produto.id}/estoque", json={
        "tipo": "entrada",
        "quantidade": 0,
        "motivo": "Corrigir dados do lote recebido",
        "lote_id": lote.id,
        "corrigir_lote_existente": True,
        "lote": "XD1D221409J",
        "data_fabricacao": "2026-06-01",
        "data_validade": "2026-12-17",
    }, headers=_headers(estab.id, admin.id))
    assert r.status_code == 200, r.get_data(as_text=True)

    db.session.refresh(produto)
    db.session.refresh(lote)

    assert ProdutoLote.query.filter_by(produto_id=produto.id).count() == 1
    assert lote.numero_lote == "XD1D221409J"
    assert lote.data_fabricacao.isoformat() == "2026-06-01"
    assert lote.data_validade.isoformat() == "2026-12-17"
    assert float(produto.quantidade) == 24.0


def test_demo_product_hub_atualiza_lote_existente(client, ctx):
    estab, admin = ctx["estab"], ctx["admin"]
    produto = Produto(
        estabelecimento_id=estab.id,
        categoria_id=ctx["cat"].id,
        nome="Ketchup Tradicional",
        preco_custo=Decimal("6.00"),
        preco_venda=Decimal("9.50"),
        quantidade=12,
    )
    db.session.add(produto)
    db.session.flush()

    lote = ProdutoLote(
        estabelecimento_id=estab.id,
        produto_id=produto.id,
        numero_lote="KETCHUP-OLD",
        quantidade=Decimal("12"),
        quantidade_inicial=Decimal("12"),
        data_fabricacao=None,
        data_validade=date(2026, 11, 30),
        data_entrada=date(2026, 7, 14),
        preco_custo_unitario=Decimal("6.00"),
        preco_venda=Decimal("9.50"),
        ativo=True,
    )
    db.session.add(lote)
    db.session.commit()

    r = client.patch(f"/api/produtos/{produto.id}/lotes/{lote.id}", json={
        "numero_lote": "KETCHUP-REV-1",
        "data_fabricacao": "2026-05-10",
        "data_validade": "2026-12-20",
    }, headers=_headers(estab.id, admin.id))
    assert r.status_code == 200, r.get_data(as_text=True)

    db.session.refresh(produto)
    db.session.refresh(lote)

    assert lote.numero_lote == "KETCHUP-REV-1"
    assert lote.data_fabricacao.isoformat() == "2026-05-10"
    assert lote.data_validade.isoformat() == "2026-12-20"
    assert produto.lote == "KETCHUP-REV-1"
    assert produto.data_validade.isoformat() == "2026-12-20"


def test_demo_venda_e_comprovante(client, ctx):
    estab, admin = ctx["estab"], ctx["admin"]
    estab.plano = "Pro"
    db.session.commit()

    # Produto para vender (via ORM p/ isolar o teste da venda em si)
    p = Produto(
        estabelecimento_id=estab.id, categoria_id=ctx["cat"].id,
        nome="Pão Francês", preco_custo=Decimal("0.30"), preco_venda=Decimal("0.75"),
        quantidade=500,
    )
    db.session.add(p)
    db.session.commit()

    headers = _headers(estab.id, admin.id)

    # 1) Finalizar venda pelo PDV (dinheiro)
    venda_payload = {
        "items": [{"id": p.id, "quantity": 4, "price": 0.75}],
        "subtotal": 3.00, "desconto": 0, "total": 3.00,
        "pagamentos": [{"forma": "dinheiro", "valor": 5.00}],
        "valor_recebido": 5.00, "troco": 2.00,
    }
    r = client.post("/api/pdv/finalizar", json=venda_payload, headers=headers)
    assert r.status_code in (200, 201), r.get_data(as_text=True)
    body = r.get_json()
    assert body.get("success") is not False, body
    venda = body.get("venda") or body.get("data") or {}
    venda_id = venda.get("id") or body.get("id")
    assert venda_id, f"venda sem id: {body}"

    # 2) Emitir/visualizar o comprovante da venda
    r2 = client.get(f"/api/pdv/comprovante/{venda_id}", headers=headers)
    assert r2.status_code == 200, r2.get_data(as_text=True)
    comp = r2.get_json()
    assert comp.get("success") is True
    assert len(comp["comprovante"]["itens"]) >= 1
    assert comp["comprovante"]["funcionario"] == admin.nome
    # Lei da Transparência: o comprovante carrega o campo de tributos (mesmo que 0).
    assert "valor_tributos" in comp["comprovante"]

    # 3) Painel de vendas precisa voltar com indicadores e série histórica,
    # sem quebrar a rota de estatísticas.
    r3 = client.get("/api/vendas/estatisticas", headers=headers)
    assert r3.status_code == 200, r3.get_data(as_text=True)
    stats = r3.get_json()
    assert stats["estatisticas_gerais"]["quantidade_vendas"] >= 1
    assert stats["estatisticas_gerais"]["total_valor"] >= 3.0
    assert len(stats["formas_pagamento"]) >= 1


def test_demo_plano_gratuito_bloqueia_vendas_analiticas_e_compras(client, ctx):
    estab, admin = ctx["estab"], ctx["admin"]
    estab.plano = "Gratuito"
    db.session.commit()

    headers = _headers(estab.id, admin.id)

    r_vendas = client.get("/api/vendas/estatisticas", headers=headers)
    assert r_vendas.status_code == 403, r_vendas.get_data(as_text=True)
    assert r_vendas.get_json().get("code") == "PLAN_RESTRICTED"

    r_compras = client.get("/api/pedidos-compra", headers=headers)
    assert r_compras.status_code == 403, r_compras.get_data(as_text=True)
    assert r_compras.get_json().get("code") == "PLAN_RESTRICTED"


def test_demo_venda_bloqueada_sem_caixa(client, session):
    """Regra de negócio: sem caixa aberto, a venda é bloqueada (não some silenciosa)."""
    estab = session.query(Estabelecimento).first()
    # Funcionário SEM caixa aberto
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Sem Caixa")
    session.add(cat); session.flush()
    p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item",
                preco_custo=Decimal("1"), preco_venda=Decimal("2"), quantidade=10)
    session.add(p); session.commit()

    r = client.post("/api/pdv/finalizar", json={
        "items": [{"id": p.id, "quantity": 1, "price": 2.0}],
        "subtotal": 2.0, "total": 2.0,
        "pagamentos": [{"forma": "dinheiro", "valor": 2.0}],
    }, headers=_headers(estab.id, admin.id))
    assert r.status_code == 403
    assert r.get_json().get("error") == "CAIXA_FECHADO"


def test_demo_health_and_readiness_endpoints(client):
    health = client.get("/api/health")
    assert health.status_code == 200, health.get_data(as_text=True)
    body = health.get_json()
    assert body["service"] == "mercadinhosys-api"
    assert body["database"]["status"] == "connected"

    ready = client.get("/api/ready")
    assert ready.status_code == 200, ready.get_data(as_text=True)
    ready_body = ready.get_json()
    assert ready_body["status"] == "ready"
    assert ready_body["checks"]["database"]["status"] == "ok"
    assert ready_body["checks"]["cache"]["status"] == "ok"


def test_demo_pdv_fiado_liberado_para_plano_pro(client, session, ctx):
    estab = ctx["estab"]
    estab.plano = "Pro"
    admin = ctx["admin"]

    operador = Funcionario(
        estabelecimento_id=estab.id,
        nome="Operador Pro",
        username="operador_pro",
        email="operador.pro@demo.com",
        cpf="12345678901",
        data_nascimento=date(1995, 1, 10),
        celular="92999990000",
        role="CAIXA",
        cargo="Caixa",
        ativo=True,
        status="ativo",
        data_admissao=date.today(),
    )
    operador.set_password("123456")
    session.add(operador)
    session.flush()

    caixa_operador = Caixa(
        estabelecimento_id=estab.id,
        funcionario_id=operador.id,
        numero_caixa="PDV-PRO-02",
        saldo_inicial=Decimal("50"),
        saldo_atual=Decimal("50"),
        status="aberto",
        data_abertura=datetime.now(timezone.utc),
    )
    session.add(caixa_operador)

    cliente = Cliente(
        estabelecimento_id=estab.id,
        nome="Cliente Fiado",
        cpf="390.533.447-05",
        celular="92999991111",
        cep="69000-000",
        logradouro="Rua Demo",
        numero="123",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
        limite_credito=Decimal("100.00"),
        saldo_devedor=Decimal("0.00"),
    )
    session.add(cliente)
    session.flush()

    produto = Produto(
        estabelecimento_id=estab.id,
        categoria_id=ctx["cat"].id,
        nome="Arroz Pro",
        preco_custo=Decimal("10.00"),
        preco_venda=Decimal("15.00"),
        quantidade=30,
    )
    session.add(produto)
    session.commit()

    token = create_access_token(identity=str(operador.id), additional_claims={
        "estabelecimento_id": estab.id,
        "role": "CAIXA",
        "nome": operador.nome,
    })
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/pdv/finalizar", json={
        "cliente_id": cliente.id,
        "items": [{"id": produto.id, "quantity": 1, "price": 15.0}],
        "subtotal": 15.0,
        "total": 15.0,
        "pagamentos": [{"forma": "fiado", "valor": 15.0}],
    }, headers=headers)
    assert r.status_code in (200, 201), r.get_data(as_text=True)
    body = r.get_json()
    assert body.get("success") is not False, body
