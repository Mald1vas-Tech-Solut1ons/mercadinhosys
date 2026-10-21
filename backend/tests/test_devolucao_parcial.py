"""Pós-venda: devolução parcial por lote e troca, com estoque, títulos, gaveta, DRE e comissão."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (Caixa, CategoriaProduto, Cliente, ContaReceber, DevolucaoVenda, Estabelecimento, Funcionario,
                        MovimentacaoCaixa, MovimentacaoEstoque, Produto, ProdutoLote, Venda, VendaItem)
from app.utils.timezone import hoje_local


def _headers(f):
    token = create_access_token(identity=str(f.id), additional_claims={"estabelecimento_id": f.estabelecimento_id,
                                                                       "role": f.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    vendedor = Funcionario(estabelecimento_id=estab.id, nome="Vera Vendas", cpf="40000000001", username="vera",
                           role="vendedor", ativo=True, data_nascimento=date(1990, 1, 1), celular="1", email="v@t.test",
                           cargo="Vendedor", data_admissao=date(2024, 1, 1))
    caixa_user = Funcionario(estabelecimento_id=estab.id, nome="Caio Caixa", cpf="40000000002", username="caio",
                             role="caixa", ativo=True, data_nascimento=date(1990, 1, 1), celular="1", email="c@t.test",
                             cargo="Caixa", data_admissao=date(2024, 1, 1))
    for f in (vendedor, caixa_user):
        f.set_password("x")
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Mercearia")
    session.add_all([vendedor, caixa_user, cat])
    session.flush()
    cliente = Cliente(estabelecimento_id=estab.id, nome="Mercadinho Bom Preço", cpf="52998224725", celular="11999999999",
                      cep="01000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                      limite_credito=Decimal("5000"), saldo_devedor=Decimal("0"), vendedor_id=vendedor.id)
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Café 500g", preco_custo=Decimal("6"),
                   preco_venda=Decimal("10"), quantidade=Decimal("10"))
    session.add_all([cliente, prod])
    session.flush()
    curto = ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="CAFE-CURTO", quantidade=4,
                        quantidade_inicial=4, data_entrada=hoje_local(), data_validade=hoje_local() + timedelta(days=30),
                        preco_custo_unitario=6, ativo=True)
    longo = ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="CAFE-LONGO", quantidade=6,
                        quantidade_inicial=6, data_entrada=hoje_local(), data_validade=hoje_local() + timedelta(days=200),
                        preco_custo_unitario=6, ativo=True)
    gaveta = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="PDV-1", saldo_inicial=100,
                   saldo_atual=100, status="aberto")
    session.add_all([curto, longo, gaveta])
    session.commit()
    return dict(estab=estab, admin=admin, vendedor=vendedor, caixa_user=caixa_user, cliente=cliente, prod=prod,
                curto=curto, longo=longo, gaveta=gaveta, h=_headers(admin), h_vend=_headers(vendedor),
                h_caixa=_headers(caixa_user))


def _vender(client, ctx, quantidade=6, forma="dinheiro", desconto=0):
    bruto = quantidade * 10
    resposta = client.post("/api/pdv/finalizar", headers=ctx["h"], json={
        "subtotal": bruto, "total": bruto - desconto, "desconto": desconto, "cliente_id": ctx["cliente"].id,
        "items": [{"id": ctx["prod"].id, "quantidade": quantidade, "preco_unitario": 10}],
        "pagamentos": [{"forma": forma, "valor": bruto - desconto}]})
    assert resposta.status_code == 201, resposta.get_json()
    venda = Venda.query.order_by(Venda.id.desc()).first()
    return venda, VendaItem.query.filter_by(venda_id=venda.id).first()


def _devolver(client, ctx, venda, item, quantidade, headers=None, **extra):
    corpo = {"motivo": "Cliente desistiu", "forma_reembolso": "dinheiro",
             "itens": [{"venda_item_id": item.id, "quantidade": quantidade, **({"lote_id": extra.pop("lote_id")} if "lote_id" in extra else {})}],
             **extra}
    return client.post(f"/api/crm/vendas/{venda.id}/devolucoes", headers=headers or ctx["h"], json=corpo)


def _get(session, modelo, pk):
    session.expire_all()
    return session.get(modelo, pk)


def test_devolucao_parcial_volta_ao_lote_de_origem_e_sai_da_gaveta(client, session, ctx):
    venda, item = _vender(client, ctx, 6)  # FEFO: 4 do lote curto + 2 do longo
    assert _get(session, ProdutoLote, ctx["curto"].id).quantidade == 0
    gaveta_antes = Decimal(str(_get(session, Caixa, ctx["gaveta"].id).saldo_atual))

    resposta = _devolver(client, ctx, venda, item, 3)
    assert resposta.status_code == 201, resposta.get_json()
    dados = resposta.get_json()["data"]
    assert dados["valor_total"] == 30 and dados["itens"][0]["lote_id"] == ctx["curto"].id

    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("7")
    assert _get(session, ProdutoLote, ctx["curto"].id).quantidade == Decimal("3")
    assert Decimal(str(_get(session, Caixa, ctx["gaveta"].id).saldo_atual)) == gaveta_antes - 30
    sangria = MovimentacaoCaixa.query.filter_by(venda_id=venda.id, tipo="sangria").one()
    assert Decimal(str(sangria.valor)) == 30  # o fechamento do caixa enxerga a saída
    assert _get(session, Venda, venda.id).status == "finalizada"


def test_lote_escolhido_e_limite_por_lote_e_por_item(client, ctx):
    venda, item = _vender(client, ctx, 6)
    assert _devolver(client, ctx, venda, item, 2, lote_id=ctx["longo"].id).status_code == 201
    esgotado = _devolver(client, ctx, venda, item, 1, lote_id=ctx["longo"].id)
    assert esgotado.status_code == 400 and "restam 0" in esgotado.get_json()["error"]
    assert _devolver(client, ctx, venda, item, 5).status_code == 400  # só restam 4
    resumo = client.get(f"/api/crm/vendas/{venda.id}/devolucao", headers=ctx["h"]).get_json()["data"]
    assert resumo["itens"][0]["restante"] == 4
    assert {l["numero_lote"]: l["restante"] for l in resumo["itens"][0]["lotes"]} == {"CAFE-CURTO": 4, "CAFE-LONGO": 0}


def test_venda_com_devolucao_nao_pode_ser_cancelada(client, session, ctx):
    admin = _get(session, Funcionario, ctx["admin"].id)
    admin.set_pin("4321")
    session.commit()
    venda, item = _vender(client, ctx, 2)
    assert _devolver(client, ctx, venda, item, 1).status_code == 201
    cancelar = client.post(f"/api/vendas/{venda.id}/cancelar", headers=ctx["h"], json={"pin_cancelamento": "4321"})
    assert cancelar.status_code == 409
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("9")  # 10 - 2 + 1, sem estorno duplo


def test_venda_cancelada_nao_aceita_devolucao(client, session, ctx):
    admin = _get(session, Funcionario, ctx["admin"].id)
    admin.set_pin("4321")
    session.commit()
    venda, item = _vender(client, ctx, 2)
    assert client.post(f"/api/vendas/{venda.id}/cancelar", headers=ctx["h"], json={"pin_cancelamento": "4321"}).status_code == 200
    assert _devolver(client, ctx, venda, item, 1).status_code == 409


def test_fiado_abate_titulo_e_nao_devolve_dinheiro_que_nao_entrou(client, session, ctx):
    venda, item = _vender(client, ctx, 5, forma="fiado")
    cliente = _get(session, Cliente, ctx["cliente"].id)
    assert Decimal(str(cliente.saldo_devedor)) == 50
    em_dinheiro = _devolver(client, ctx, venda, item, 1)
    assert em_dinheiro.status_code == 400 and "pagou" in em_dinheiro.get_json()["error"]

    assert _devolver(client, ctx, venda, item, 2, forma_reembolso="abater_titulo").status_code == 201
    titulo = ContaReceber.query.filter_by(venda_id=venda.id).one()
    assert Decimal(str(titulo.valor_atual)) == 30 and titulo.status == "aberto"
    assert Decimal(str(_get(session, Cliente, ctx["cliente"].id).saldo_devedor)) == 30
    assert _devolver(client, ctx, venda, item, 3, forma_reembolso="abater_titulo").status_code == 201
    titulo = _get(session, ContaReceber, titulo.id)
    assert Decimal(str(titulo.valor_atual)) == 0 and titulo.status == "cancelado"
    assert Decimal(str(_get(session, Cliente, ctx["cliente"].id).saldo_devedor)) == 0


def test_avaria_nao_volta_para_o_saldo_vendavel(client, session, ctx):
    venda, item = _vender(client, ctx, 3)
    assert _devolver(client, ctx, venda, item, 1, destino="avaria").status_code == 201
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("7")
    mov = MovimentacaoEstoque.query.filter_by(venda_id=venda.id, tipo="devolucao_avaria").one()
    assert mov.quantidade_anterior == mov.quantidade_atual


def test_troca_pelo_mesmo_produto_sem_efeito_financeiro(client, session, ctx):
    venda, item = _vender(client, ctx, 2)
    gaveta = Decimal(str(_get(session, Caixa, ctx["gaveta"].id).saldo_atual))
    resposta = client.post(f"/api/crm/vendas/{venda.id}/devolucoes", headers=ctx["h"], json={
        "tipo": "troca", "destino": "avaria", "motivo": "Embalagem furada",
        "itens": [{"venda_item_id": item.id, "quantidade": 1}]})
    assert resposta.status_code == 201, resposta.get_json()
    dados = resposta.get_json()["data"]
    assert dados["forma_reembolso"] == "troca" and dados["custo_reposicao"] == 6
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("7")  # 10 - 2 vendidos - 1 reposto
    assert Decimal(str(_get(session, Caixa, ctx["gaveta"].id).saldo_atual)) == gaveta


def test_desconto_da_venda_e_rateado_e_a_ultima_fecha_os_centavos(client, ctx):
    venda, item = _vender(client, ctx, 3, desconto=Decimal("1"))  # 30 - 1 = 29
    primeira = _devolver(client, ctx, venda, item, 1).get_json()["data"]
    assert primeira["valor_total"] == 9.67
    segunda = _devolver(client, ctx, venda, item, 1).get_json()["data"]
    assert segunda["valor_total"] == 9.67
    ultima = _devolver(client, ctx, venda, item, 1).get_json()["data"]
    assert ultima["valor_total"] == 9.66  # soma exata de 29,00


def test_repetir_a_mesma_operacao_nao_devolve_duas_vezes(client, session, ctx):
    venda, item = _vender(client, ctx, 4)
    primeira = _devolver(client, ctx, venda, item, 1, idempotency_key="dev-abc")
    repetida = _devolver(client, ctx, venda, item, 1, idempotency_key="dev-abc")
    assert primeira.status_code == 201 and repetida.status_code == 200 and repetida.get_json()["repetida"] is True
    assert DevolucaoVenda.query.count() == 1
    assert _get(session, Produto, ctx["prod"].id).quantidade == Decimal("7")


def test_so_gerencia_registra_devolucao_e_vendedor_ve_so_carteira(client, session, ctx):
    venda, item = _vender(client, ctx, 2)
    assert _devolver(client, ctx, venda, item, 1, headers=ctx["h_vend"]).status_code == 403
    assert _devolver(client, ctx, venda, item, 1, headers=ctx["h_caixa"]).status_code == 403
    assert client.get(f"/api/crm/vendas/{venda.id}/devolucao", headers=ctx["h_vend"]).status_code == 200
    _get(session, Cliente, ctx["cliente"].id).vendedor_id = None
    session.commit()
    assert client.get(f"/api/crm/vendas/{venda.id}/devolucao", headers=ctx["h_vend"]).status_code == 403


def test_dre_desconta_devolucao_da_receita_e_custo_do_cmv(client, ctx):
    venda, item = _vender(client, ctx, 5)
    assert _devolver(client, ctx, venda, item, 2).status_code == 201
    hoje = hoje_local().isoformat()
    dre = client.get(f"/api/despesas/resumo-financeiro/?data_inicio={hoje}&data_fim={hoje}", headers=ctx["h"]).get_json()
    consolidado = dre["dre_consolidado"]
    assert consolidado["receita_bruta"] == 50 and consolidado["devolucoes"] == 20
    assert consolidado["receita_liquida"] == 30
    assert consolidado["custo_mercadoria"] == 18  # 5 × 6 saiu, 2 × 6 voltou vendável


def test_devolucao_desconta_comissao_no_mes_em_que_acontece(client, session, ctx):
    venda, item = _vender(client, ctx, 5)
    _get(session, Venda, venda.id).funcionario_id = ctx["vendedor"].id
    session.commit()
    assert client.put("/api/crm/comissoes/regras", headers=ctx["h"], json={"percentual": 10}).status_code == 200
    assert _devolver(client, ctx, venda, item, 1).status_code == 201
    extrato = client.get("/api/crm/comissoes/extrato", headers=ctx["h_vend"]).get_json()["data"]
    assert extrato["base_vendas"] == 50 and extrato["base_devolucoes"] == -10 and extrato["valor_comissao"] == 4


def test_chamado_de_avaria_registra_a_devolucao(client, ctx):
    venda, item = _vender(client, ctx, 2)
    chamado = client.post("/api/crm/chamados", headers=ctx["h"], json={
        "cliente_id": ctx["cliente"].id, "venda_id": venda.id, "tipo": "avaria", "assunto": "Pacote rasgado"}).get_json()["data"]
    assert _devolver(client, ctx, venda, item, 1, chamado_id=chamado["id"]).status_code == 201
    detalhe = client.get(f"/api/crm/chamados/{chamado['id']}", headers=ctx["h"]).get_json()["data"]
    assert len(detalhe["devolucoes"]) == 1 and detalhe["devolucoes"][0]["valor_total"] == 10
