"""Fluxo de caixa sem dupla contagem de fiado, entradas com contas a receber e DRE com impostos."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.utils.timezone import hoje_local
from app.models import (Caixa, CategoriaProduto, Cliente, Configuracao, ContaReceber, Estabelecimento, Funcionario,
                        Produto, ProdutoLote)


@pytest.fixture
def fin(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Financeiro")
    session.add(cat)
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item", preco_custo=Decimal("40"),
                   preco_venda=Decimal("100"), quantidade=Decimal("10"))
    cliente = Cliente(estabelecimento_id=estab.id, nome="Cliente fiado", cpf="52998224725", celular="11999999999",
                      cep="01000000", logradouro="Rua", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                      limite_credito=Decimal("1000"), saldo_devedor=Decimal("0"))
    session.add_all([prod, cliente])
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="FIN", quantidade=10,
                    quantidade_inicial=10, data_entrada=date.today(), data_validade=date.today() + timedelta(days=90),
                    preco_custo_unitario=40, ativo=True),
        Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="FIN", saldo_inicial=0,
              saldo_atual=0, status="aberto"),
    ])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, prod=prod, cliente=cliente, headers={"Authorization": f"Bearer {token}"})


def _venda_mista(client, fin):
    """Venda de R$ 100: R$ 50 em dinheiro e R$ 50 no fiado."""
    resposta = client.post("/api/pdv/finalizar", headers=fin["headers"], json={
        "cliente_id": fin["cliente"].id, "subtotal": 100, "total": 100, "desconto": 0,
        "items": [{"id": fin["prod"].id, "quantidade": 1, "preco_unitario": 100}],
        "pagamentos": [{"forma": "dinheiro", "valor": 50}, {"forma": "fiado", "valor": 50}]})
    assert resposta.status_code == 201, resposta.get_json()


def _resumo(client, fin):
    hoje = hoje_local().isoformat()  # dia da loja: o CI roda em UTC e o dia local pode ser o anterior
    resposta = client.get(f"/api/despesas/resumo-financeiro/?data_inicio={hoje}&data_fim={hoje}", headers=fin["headers"])
    assert resposta.status_code == 200, resposta.get_json()
    return resposta.get_json()


def test_fiado_nao_entra_como_dinheiro_no_fluxo_de_caixa(client, session, fin):
    _venda_mista(client, fin)
    assert _resumo(client, fin)["fluxo_caixa_real"]["entradas"] == pytest.approx(50.0)

    pago = client.post(f"/api/clientes/{fin['cliente'].id}/pagar_fiado", headers=fin["headers"], json={"valor": 50})
    assert pago.status_code == 200, pago.get_json()
    # R$ 50 do ato da venda + R$ 50 recebidos do fiado = R$ 100, e não R$ 150.
    assert _resumo(client, fin)["fluxo_caixa_real"]["entradas"] == pytest.approx(100.0)


def test_troco_nao_e_entrada_de_caixa(client, session, fin):
    resposta = client.post("/api/pdv/finalizar", headers=fin["headers"], json={
        "subtotal": 100, "total": 100, "desconto": 0,
        "items": [{"id": fin["prod"].id, "quantidade": 1, "preco_unitario": 100}],
        "pagamentos": [{"forma": "dinheiro", "valor": 120}]})
    assert resposta.status_code == 201, resposta.get_json()
    assert _resumo(client, fin)["fluxo_caixa_real"]["entradas"] == pytest.approx(100.0)


def test_entrada_esperada_inclui_contas_a_receber_do_periodo(client, session, fin):
    hoje = date.today()
    session.add_all([
        ContaReceber(estabelecimento_id=fin["estab"].id, cliente_id=fin["cliente"].id, numero_documento="R7",
                     valor_original=300, valor_atual=300, data_emissao=hoje, data_vencimento=hoje + timedelta(days=3),
                     status="aberto"),
        ContaReceber(estabelecimento_id=fin["estab"].id, cliente_id=fin["cliente"].id, numero_documento="R20",
                     valor_original=200, valor_atual=200, data_emissao=hoje, data_vencimento=hoje + timedelta(days=20),
                     status="aberto"),
        ContaReceber(estabelecimento_id=fin["estab"].id, cliente_id=fin["cliente"].id, numero_documento="RV",
                     valor_original=150, valor_atual=150, data_emissao=hoje - timedelta(days=60),
                     data_vencimento=hoje - timedelta(days=30), status="aberto"),
    ])
    session.commit()
    receber = _resumo(client, fin)["contas_receber"]
    assert receber["total_aberto"] == pytest.approx(650.0)
    assert receber["vencido"] == pytest.approx(150.0)
    assert receber["vence_7_dias"] == pytest.approx(300.0)
    assert receber["vence_30_dias"] == pytest.approx(500.0)
    indicadores = _resumo(client, fin)["indicadores_gestao"]
    assert indicadores["entrada_esperada_7d"] >= 300.0  # inclui o título que vence em 3 dias


def test_dre_deduz_impostos_configurados_e_avisa_quando_nao(client, session, fin):
    _venda_mista(client, fin)
    sem = _resumo(client, fin)["dre_consolidado"]
    assert sem["impostos_configurados"] is False
    assert sem["impostos_sobre_vendas"] == 0
    assert sem["receita_liquida"] == pytest.approx(sem["receita_bruta"])

    config = session.query(Configuracao).filter_by(estabelecimento_id=fin["estab"].id).first()
    config.aliquota_impostos_venda = Decimal("6.00")
    session.commit()
    com = _resumo(client, fin)["dre_consolidado"]
    assert com["impostos_configurados"] is True
    assert com["impostos_sobre_vendas"] == pytest.approx(com["receita_bruta"] * 0.06)
    assert com["receita_liquida"] == pytest.approx(com["receita_bruta"] * 0.94)
    assert com["lucro_bruto"] == pytest.approx(com["receita_liquida"] - com["custo_mercadoria"])
    assert com["lucro_liquido"] == pytest.approx(
        com["lucro_bruto"] - com["despesas_operacionais"] - com["despesas_pessoal"])


def test_aliquota_de_impostos_validada_na_configuracao(client, session, fin):
    for invalida in (-1, 100.5, "abc", float("nan")):
        resposta = client.put("/api/configuracao/", headers=fin["headers"], json={"aliquota_impostos_venda": invalida})
        assert resposta.status_code == 400, (invalida, resposta.get_json())

    ok = client.put("/api/configuracao/", headers=fin["headers"], json={"aliquota_impostos_venda": "6,5"})
    assert ok.status_code == 200, ok.get_json()
    assert float(session.query(Configuracao).filter_by(estabelecimento_id=fin["estab"].id).one()
                 .aliquota_impostos_venda) == pytest.approx(6.5)

    limpa = client.put("/api/configuracao/", headers=fin["headers"], json={"aliquota_impostos_venda": ""})
    assert limpa.status_code == 200
    session.expire_all()
    assert session.query(Configuracao).filter_by(estabelecimento_id=fin["estab"].id).one().aliquota_impostos_venda is None
