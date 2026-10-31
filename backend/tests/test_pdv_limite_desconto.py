"""FASE 1.7 — o limite de desconto chega ao PDV ANTES do F9.

Prova três contratos:
(1) /pdv/configuracoes entrega `limite_desconto_loja` — o teto da loja
    (Configuracao.desconto_maximo_funcionario) que `validate_pricing` aplica
    junto com o limite do funcionário. Sem ele o operador só descobria o limite
    ao apertar F9, com a fila esperando.
(2) O servidor continua recusando desconto acima do teto para operador de caixa:
    o aviso antecipado na tela é conveniência, o guardião é o backend.
(3) Admin (nível 1) segue com limite de 100% — política existente do PDV, não
    pode regredir.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import Caixa, CategoriaProduto, Configuracao, Estabelecimento, Funcionario, Produto
from app.utils.smart_cache import SmartCache

PERMISSOES_CAIXA = '{"pode_dar_desconto": true, "limite_desconto": 10}'


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

    config = session.query(Configuracao).filter_by(estabelecimento_id=estab.id).first()
    if config is None:
        config = Configuracao(estabelecimento_id=estab.id)
        session.add(config)
    config.desconto_maximo_funcionario = Decimal("12.50")
    config.desconto_maximo_percentual = Decimal("12.50")

    caixa = Funcionario(
        estabelecimento_id=estab.id, nome="Operadora Caixa FASE 1.7", cpf="99988877701",
        username="caixa_desc_17", role="caixa", ativo=True,
        data_nascimento=date(1995, 5, 5), celular="92988887777",
        email="caixa_desc_17@mercadinho.sys", cargo="Operadora de Caixa",
        data_admissao=date(2024, 1, 1), salario_base=Decimal("1800.00"),
        permissoes_json=PERMISSOES_CAIXA,
    )
    caixa.set_password("senha-caixa-17")

    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Desconto FASE 1.7")
    session.add_all([caixa, cat])
    session.flush()

    caixa_aberto = Caixa(estabelecimento_id=estab.id, funcionario_id=caixa.id, numero_caixa="DESC-1",
                         saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                         data_abertura=datetime.now(timezone.utc))
    # O turno é por operador: o admin também precisa do caixa dele aberto para vender.
    caixa_admin = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="DESC-ADM",
                        saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                        data_abertura=datetime.now(timezone.utc))
    produto = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item de teste",
                      preco_custo=Decimal("40"), preco_venda=Decimal("100"), quantidade=Decimal("10"))
    session.add_all([caixa_aberto, caixa_admin, produto])
    session.commit()
    SmartCache.clear()  # o config vem de cache de 5 min; sem isso o teste lê o valor antigo

    def token_de(user):
        return {"Authorization": "Bearer " + create_access_token(identity=str(user.id), additional_claims={
            "estabelecimento_id": estab.id, "role": user.role})}

    return dict(estab=estab, produto=produto, headers=token_de(caixa), headers_admin=token_de(admin))


def _vender(client, ctx, desconto, headers=None):
    payload = {
        "items": [{"id": ctx["produto"].id, "quantity": 1, "discount": desconto, "price": 100.0}],
        "subtotal": 100.0, "desconto": desconto, "total": 100.0 - desconto,
        "pagamentos": [{"forma": "dinheiro", "valor": 100.0 - desconto}], "cliente_id": None,
    }
    return client.post("/api/pdv/finalizar", headers=headers or ctx["headers"], json=payload)


def test_configuracoes_entrega_o_teto_de_desconto_da_loja(client, ctx):
    r = client.get("/api/pdv/configuracoes", headers=ctx["headers"])
    assert r.status_code == 200

    funcionario = r.get_json()["configuracoes"]["funcionario"]
    assert "limite_desconto" in funcionario
    assert funcionario["limite_desconto_loja"] == 12.5


def test_finalizar_recusa_desconto_acima_do_teto(client, ctx):
    r = _vender(client, ctx, desconto=40.0)

    assert r.status_code == 400
    assert "desconto" in r.get_json()["error"].lower()


def test_finalizar_aceita_desconto_dentro_do_teto(client, ctx):
    r = _vender(client, ctx, desconto=10.0)

    assert r.status_code in (200, 201), r.get_json()


def test_admin_continua_com_limite_total(client, ctx):
    r = _vender(client, ctx, desconto=40.0, headers=ctx["headers_admin"])

    assert r.status_code in (200, 201), r.get_json()
