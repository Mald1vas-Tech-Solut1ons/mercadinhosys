"""App do vendedor: catálogo completo, sem custo, e fila de aprovação real."""
from datetime import date
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Cliente, Estabelecimento, Funcionario, PedidoVenda, Produto, Rota


@pytest.fixture
def sfa(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    vendedor = Funcionario(estabelecimento_id=estab.id, nome="Vendedor Externo", cpf="98765432100",
                           username="vendedor_sfa", role="VENDEDOR", ativo=True, data_nascimento=date(1990, 1, 1),
                           celular="11999999999", email="vend@example.test", cargo="Vendedor",
                           data_admissao=date(2024, 1, 1), salario_base=Decimal("1"))
    vendedor.set_password("vendedor-teste")
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Catálogo grande")
    session.add_all([vendedor, cat])
    session.flush()
    rota = Rota(estabelecimento_id=estab.id, nome="Rota Centro", vendedor_id=vendedor.id, ativa=True)
    session.add(rota)
    session.flush()
    session.add_all([Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome=f"SKU {i:04d}",
                             preco_custo=Decimal("7.3100"), preco_venda=Decimal("10"), quantidade=Decimal("5"))
                     for i in range(1203)])
    session.add_all([Cliente(estabelecimento_id=estab.id, nome=f"Cliente {i:03d}", cpf=f"{10000000000 + i}",
                             celular="11999999999", cep="01000000", logradouro="Rua", numero="1", bairro="Centro",
                             cidade="São Paulo", estado="SP", rota_id=rota.id,
                             limite_credito=Decimal("5000"), saldo_devedor=Decimal("0"))
                     for i in range(130)])
    session.commit()

    def headers(funcionario):
        token = create_access_token(identity=str(funcionario.id), additional_claims={
            "estabelecimento_id": estab.id, "role": funcionario.role})
        return {"Authorization": f"Bearer {token}"}
    return dict(estab=estab, admin=admin, vendedor=vendedor, vendedor_h=headers(vendedor), admin_h=headers(admin))


def _baixar_tudo(client, headers):
    primeira = client.get("/api/sfa/sync-data", headers=headers)
    assert primeira.status_code == 200, primeira.get_json()
    corpo = primeira.get_json()
    produtos, clientes = list(corpo["data"]["produtos"]), list(corpo["data"]["clientes"])
    for rota, destino, cursor in (("/api/sfa/sync-data/produtos", produtos, corpo["paginacao"]["proximo_produto"]),
                                  ("/api/sfa/sync-data/clientes", clientes, corpo["paginacao"]["proximo_cliente"])):
        while cursor:
            pagina = client.get(rota, headers=headers, query_string={"apos": cursor}).get_json()
            destino.extend(pagina["data"])
            cursor = pagina["proximo"]
    return corpo, produtos, clientes


def test_sync_entrega_catalogo_e_carteira_completos_em_paginas(client, sfa):
    corpo, produtos, clientes = _baixar_tudo(client, sfa["vendedor_h"])
    assert len(corpo["data"]["produtos"]) == 500
    assert len(produtos) == 1203
    assert len({p["id"] for p in produtos}) == 1203
    assert len(clientes) == 130


def test_sync_nao_leva_custo_ao_celular(client, sfa):
    _, produtos, _ = _baixar_tudo(client, sfa["vendedor_h"])
    assert all("preco_custo" not in p for p in produtos)
    assert "7.31" not in client.get("/api/sfa/sync-data", headers=sfa["vendedor_h"]).get_data(as_text=True)


def test_produtos_ocultam_custo_e_margem_para_vendedor(client, sfa):
    vendedor = client.get("/api/produtos/?por_pagina=5", headers=sfa["vendedor_h"]).get_json()
    assert vendedor["produtos"], vendedor
    for produto in vendedor["produtos"]:
        assert not [k for k in produto if "custo" in k or "margem" in k or "lucro" in k], produto.keys()
    detalhe = client.get(f"/api/produtos/{vendedor['produtos'][0]['id']}", headers=sfa["vendedor_h"]).get_data(as_text=True)
    assert "preco_custo" not in detalhe and "margem" not in detalhe
    admin = client.get("/api/produtos/?por_pagina=5", headers=sfa["admin_h"]).get_json()
    assert "preco_custo" in admin["produtos"][0]


def test_gerente_ve_fila_da_loja_com_itens_e_rejeita(client, session, sfa):
    produto = session.query(Produto).first()
    cliente = session.query(Cliente).first()
    enviado = client.post("/api/sfa/sync-pedidos", headers=sfa["vendedor_h"], json={"pedidos": [{
        "cliente_id": cliente.id, "subtotal": 20, "total": 20,
        "itens": [{"produto_id": produto.id, "quantidade": 2, "preco_unitario": 10, "total_item": 20}]}]})
    assert enviado.status_code == 200, enviado.get_json()

    fila = client.get("/api/sfa/pedidos", headers=sfa["admin_h"], query_string={"status": "pendente"}).get_json()
    assert len(fila["data"]) == 1
    pedido = fila["data"][0]
    assert pedido["vendedor_nome"] == "Vendedor Externo"
    assert [(i["produto_nome"], float(i["quantidade"])) for i in pedido["itens"]] == [(produto.nome, 2.0)]

    assert client.get("/api/sfa/pedidos", headers=sfa["vendedor_h"]).get_json()["data"][0]["id"] == pedido["id"]
    assert client.post(f"/api/sfa/pedidos/{pedido['id']}/rejeitar", headers=sfa["vendedor_h"]).status_code == 403
    assert client.post(f"/api/sfa/pedidos/{pedido['id']}/rejeitar", headers=sfa["admin_h"]).status_code == 200
    session.expire_all()
    assert session.get(PedidoVenda, pedido["id"]).status == "cancelado"
    assert client.post(f"/api/sfa/pedidos/{pedido['id']}/aprovar", headers=sfa["admin_h"]).status_code == 400
