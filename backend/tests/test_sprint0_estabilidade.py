"""Sprint 0 (29/10): vencimento do fiado no PDV, despesa paga de rescisão e medição de lentidão."""
from datetime import timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.utils.timezone import hoje_local
from app.models import (Caixa, CategoriaProduto, Cliente, ContaReceber, Despesa, Estabelecimento, Funcionario,
                        Produto, ProdutoLote)

CPF_OK = "52998224725"


@pytest.fixture
def loja(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Sprint0")
    session.add(cat)
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item", preco_custo=Decimal("40"),
                   preco_venda=Decimal("100"), quantidade=Decimal("50"))
    session.add(prod)
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="S0", quantidade=50,
                    quantidade_inicial=50, data_entrada=hoje_local(), data_validade=hoje_local() + timedelta(days=90),
                    preco_custo_unitario=40, ativo=True),
        Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="S0", saldo_inicial=0,
              saldo_atual=0, status="aberto"),
    ])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, prod=prod, headers={"Authorization": f"Bearer {token}"})


def _cliente(session, loja, **extra):
    campos = dict(estabelecimento_id=loja["estab"].id, nome="Cliente", cpf=CPF_OK, celular="11999999999",
                  cep="01000000", logradouro="Rua", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                  limite_credito=Decimal("1000"), saldo_devedor=Decimal("0"))
    campos.update(extra)
    cliente = Cliente(**campos)
    session.add(cliente)
    session.commit()
    return cliente


def _venda_fiado(client, loja, cliente, valor=100, extra=None):
    payload = {
        "cliente_id": cliente.id, "subtotal": valor, "total": valor, "desconto": 0,
        "items": [{"id": loja["prod"].id, "quantidade": 1, "preco_unitario": valor}],
        "pagamentos": [{"forma": "fiado", "valor": valor}]}
    if extra:
        payload.update(extra)
    return client.post("/api/pdv/finalizar", headers=loja["headers"], json=payload)


def test_fiado_pdv_usa_vencimento_escolhido(client, session, loja):
    hoje = hoje_local()
    cliente = _cliente(session, loja)
    resposta = _venda_fiado(client, loja, cliente, extra={"data_vencimento_fiado": (hoje + timedelta(days=10)).isoformat()})
    assert resposta.status_code == 201, resposta.get_json()
    conta = ContaReceber.query.filter_by(cliente_id=cliente.id).first()
    assert conta.data_vencimento == hoje + timedelta(days=10)


def test_fiado_pdv_sem_vencimento_fica_30_dias(client, session, loja):
    hoje = hoje_local()
    cliente = _cliente(session, loja)
    resposta = _venda_fiado(client, loja, cliente)
    assert resposta.status_code == 201, resposta.get_json()
    conta = ContaReceber.query.filter_by(cliente_id=cliente.id).first()
    assert conta.data_vencimento == hoje + timedelta(days=30)


def test_fiado_pdv_recusa_vencimento_antes_da_venda(client, session, loja):
    cliente = _cliente(session, loja)
    resposta = _venda_fiado(client, loja, cliente, extra={"data_vencimento_fiado": (hoje_local() - timedelta(days=1)).isoformat()})
    assert resposta.status_code == 400
    assert resposta.get_json()["error"] == "VENCIMENTO_INVALIDO"
    assert ContaReceber.query.filter_by(cliente_id=cliente.id).count() == 0


def test_fiado_pdv_recusa_vencimento_mal_formatado(client, session, loja):
    cliente = _cliente(session, loja)
    resposta = _venda_fiado(client, loja, cliente, extra={"data_vencimento_fiado": "31/12/2026"})
    assert resposta.status_code == 400
    assert resposta.get_json()["error"] == "VENCIMENTO_INVALIDO"


def _despesa_rescisao(session, loja, vencimento):
    despesa = Despesa(estabelecimento_id=loja["estab"].id, descricao="Rescisão Trabalhista - X",
                      categoria="Rescisão Trabalhista", valor=Decimal("1000"),
                      data_despesa=hoje_local() - timedelta(days=5), data_vencimento=vencimento)
    session.add(despesa)
    session.commit()
    return despesa


def test_cancelar_rescisao_mantem_despesa_ja_paga(session, loja):
    from app.routes.rh import _desfazer_despesa_rescisao
    despesa = _despesa_rescisao(session, loja, hoje_local() - timedelta(days=5))
    mantida = _desfazer_despesa_rescisao(despesa, "Rescisão cancelada")
    session.commit()
    assert mantida is True
    assert "valor já pago mantido" in Despesa.query.get(despesa.id).observacoes


def test_cancelar_rescisao_apaga_despesa_futura(session, loja):
    from app.routes.rh import _desfazer_despesa_rescisao
    despesa = _despesa_rescisao(session, loja, hoje_local() + timedelta(days=5))
    despesa_id = despesa.id
    mantida = _desfazer_despesa_rescisao(despesa, "Rescisão cancelada")
    session.commit()
    assert mantida is False
    assert Despesa.query.get(despesa_id) is None


def test_resposta_traz_server_timing(client):
    resposta = client.get("/api/health")
    assert resposta.headers["Server-Timing"].startswith("app;dur=")
