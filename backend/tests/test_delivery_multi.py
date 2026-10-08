import pytest
from datetime import date
from app.models import (
    db, Venda, Pagamento, Produto, Estabelecimento, Motorista,
    Veiculo, Cliente, Entrega, CategoriaProduto, Funcionario, Caixa
)
from flask_jwt_extended import create_access_token
from decimal import Decimal


def test_venda_entrega_multi_pagamento_sucesso(client, session):
    """Testa venda com entrega e múltiplos pagamentos atomicamente."""
    # Use existing Estabelecimento + Funcionario from conftest session fixture
    estab = session.query(Estabelecimento).first()
    # Espelha tenant autenticado: sem g, o guard fail-closed filtra por -1.
    from flask import g, has_request_context
    if has_request_context():
        g.estabelecimento_id = estab.id
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

    cat = CategoriaProduto(nome="Geral", estabelecimento_id=estab.id)
    session.add(cat)
    session.flush()

    prod = Produto(
        estabelecimento_id=estab.id,
        categoria_id=cat.id,
        nome="Pizza Calabresa",
        preco_venda=45.00,
        preco_custo=20.00,
        quantidade=50
    )
    session.add(prod)

    # Motorista and Veiculo
    mot = Motorista(
        estabelecimento_id=estab.id,
        nome="Flash Entregador",
        cpf="12345678901",
        cnh="123456789",
        telefone="92988888888",
        celular="92999999999",
        ativo=True
    )
    vei = Veiculo(
        estabelecimento_id=estab.id,
        tipo="MOTO",
        placa="ABC1234",
        marca="Honda",
        modelo="CG 160",
        consumo_medio=30
    )
    session.add_all([mot, vei])

    cust = Cliente(
        nome="Cliente Delivery",
        cpf="98765432100",
        estabelecimento_id=estab.id,
        celular="11999999999",
        cep="01001-000",
        logradouro="Rua Delivery",
        numero="500",
        bairro="Centro",
        cidade="São Paulo",
        estado="SP"
    )
    session.add(cust)
    # Os R$ 20 em dinheiro entram na gaveta de quem vendeu.
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="DELIVERY",
                  saldo_inicial=0, saldo_atual=0, status="aberto")
    session.add(caixa)
    session.commit()

    # Use the admin Funcionario's ID as JWT identity
    token = create_access_token(
        identity=str(admin.id),
        additional_claims={"estabelecimento_id": estab.id}
    )
    headers = {"Authorization": f"Bearer {token}"}

    # Total: Pizza (45) + Taxa (5) = 50.00
    # Pagamento: R$ 20.00 Dinheiro + R$ 30.00 Cartão
    payload = {
        "cliente_id": cust.id,
        "itens": [
            {"produto_id": prod.id, "quantidade": 1, "preco_unitario": 45.00}
        ],
        "subtotal": 45.00,
        "total": 50.00,
        "taxa_entrega": 5.00,
        "motorista_id": mot.id,
        "veiculo_id": vei.id,
        "pagamentos": [
            {"forma_pagamento": "dinheiro", "valor": 20.00},
            {"forma_pagamento": "cartao_credito", "valor": 30.00}
        ],
        "endereco_cep": "00000-000",
        "endereco_logradouro": "Rua de Cima",
        "endereco_numero": "123",
        "endereco_bairro": "Centro"
    }

    response = client.post("/api/delivery/venda-entrega", json=payload, headers=headers)
    
    # Accept both 201 and 200
    assert response.status_code in (200, 201), f"Expected 200/201, got {response.status_code}: {response.get_json()}"
    data = response.get_json()
    assert data["success"] is True

    # Verify Database State
    venda = session.query(Venda).filter_by(codigo=data["codigo"]).first()
    assert venda is not None
    assert float(venda.total) == 50.00
    assert len(venda.pagamentos) == 2

    # Check if Entrega was created
    entrega = session.query(Entrega).filter_by(venda_id=venda.id).first()
    assert entrega is not None
    assert entrega.motorista_id == mot.id
    assert float(venda.total) == 50.00
    session.expire_all()
    assert session.get(Caixa, caixa.id).saldo_atual == Decimal("20")
    assert session.get(Produto, prod.id).quantidade == 49
