"""Rotas que chamavam nomes inexistentes (pyflakes: undefined name) — NameError = HTTP 500.

Encontrado em 06/11/2026: criar/editar/excluir despesa (get_jwt_identity sem import), ativar/desativar
produto (get_current_user inexistente) e relatório diário de vendas (_norm fora de escopo).
Nenhum teste chamava essas rotas; por isso o erro chegou a produção.
"""
from decimal import Decimal

from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Despesa, Funcionario, Pagamento, Produto, Venda


def _headers(funcionario):
    token = create_access_token(identity=str(funcionario.id), additional_claims={
        "estabelecimento_id": funcionario.estabelecimento_id, "role": "ADMIN",
        "is_super_admin": bool(funcionario.is_super_admin)})
    return {"Authorization": f"Bearer {token}"}


def test_despesa_cria_edita_e_exclui(client, session):
    admin = session.query(Funcionario).first()
    h = _headers(admin)
    r = client.post("/api/despesas/", headers=h, json={"descricao": "Conta de luz", "valor": 120.5})
    assert r.status_code == 201, r.get_data(as_text=True)
    despesa_id = r.get_json()["data"]["id"]

    r = client.put(f"/api/despesas/{despesa_id}", headers=h, json={"descricao": "Conta de luz (out)", "valor": 130})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert session.get(Despesa, despesa_id).descricao == "Conta de luz (out)"

    r = client.delete(f"/api/despesas/{despesa_id}", headers=h)
    assert r.status_code == 200, r.get_data(as_text=True)


def test_produto_ativa_e_desativa(client, session):
    admin = session.query(Funcionario).first()
    categoria = CategoriaProduto(estabelecimento_id=admin.estabelecimento_id, nome="Teste Toggle")
    session.add(categoria)
    session.flush()
    produto = Produto(estabelecimento_id=admin.estabelecimento_id, categoria_id=categoria.id, nome="PRODUTO TOGGLE",
                      preco_custo=Decimal("1"), preco_venda=Decimal("2"), quantidade=Decimal("1"), ativo=True)
    session.add(produto)
    session.commit()

    r = client.patch(f"/api/produtos/{produto.id}/toggle-ativo", headers=_headers(admin), json={"ativo": False})
    assert r.status_code == 200, r.get_data(as_text=True)
    session.refresh(produto)
    assert produto.ativo is False


def test_relatorio_diario_agrupa_formas_de_pagamento(client, session):
    admin = session.query(Funcionario).first()
    venda = Venda(estabelecimento_id=admin.estabelecimento_id, funcionario_id=admin.id, codigo="V-TESTE-RD-1",
                  subtotal=Decimal("10"), desconto=Decimal("0"), total=Decimal("10"), status="finalizada")
    session.add(venda)
    session.flush()
    session.add(Pagamento(estabelecimento_id=admin.estabelecimento_id, venda_id=venda.id, forma_pagamento="Cartão de Crédito",
                          valor=Decimal("10"), status="aprovado"))
    session.commit()

    r = client.get("/api/vendas/relatorio-diario", headers=_headers(admin))
    assert r.status_code == 200, r.get_data(as_text=True)
