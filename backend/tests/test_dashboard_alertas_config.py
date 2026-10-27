"""Alertas operacionais do dashboard respeitam Configurações > Estoque da loja.

Antes o endpoint ignorava `alerta_estoque_minimo`/`controlar_validade` e usava
30 dias fixos: a loja desligava o alerta e a lista de estoque crítico seguia lá.
"""
from datetime import date, timedelta
from decimal import Decimal

from flask_jwt_extended import create_access_token

from app.models import db, Estabelecimento, Funcionario, CategoriaProduto, Produto, Configuracao


def _setup(session, **config):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Geral")
    session.add(cat)
    session.flush()
    cfg = session.query(Configuracao).filter_by(estabelecimento_id=estab.id).first()
    if not cfg:
        cfg = Configuracao(estabelecimento_id=estab.id)
        session.add(cfg)
    for k, v in config.items():
        setattr(cfg, k, v)
    # Ruptura (1 <= mínimo 1) e validade em 20 dias.
    session.add(Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Air Fryer",
                        preco_custo=Decimal("100"), preco_venda=Decimal("150"),
                        quantidade=1, quantidade_minima=1))
    session.add(Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Iogurte",
                        preco_custo=Decimal("2"), preco_venda=Decimal("4"),
                        quantidade=50, quantidade_minima=1, controlar_validade=True,
                        data_validade=date.today() + timedelta(days=20)))
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin", "nome": "Admin",
    })
    return {"Authorization": f"Bearer {token}"}


def _tipos(client, h):
    r = client.get("/api/dashboard/alertas", headers=h)
    assert r.status_code == 200, r.get_data(as_text=True)
    corpo = r.get_json()
    assert corpo["total"] == len(corpo["alertas"])
    return sorted(a["tipo"] for a in corpo["alertas"])


def test_tudo_ligado_traz_ruptura_e_vencimento(client, session):
    h = _setup(session, alerta_estoque_minimo=True, controlar_validade=True, dias_alerta_validade=30)
    assert _tipos(client, h) == ["ruptura", "vencimento"]


def test_alerta_estoque_minimo_desligado_some_a_ruptura(client, session):
    h = _setup(session, alerta_estoque_minimo=False, controlar_validade=True, dias_alerta_validade=30)
    assert _tipos(client, h) == ["vencimento"]


def test_dias_alerta_validade_da_loja_e_respeitado(client, session):
    h = _setup(session, alerta_estoque_minimo=True, controlar_validade=True, dias_alerta_validade=10)
    assert _tipos(client, h) == ["ruptura"]


def test_tudo_desligado_nao_traz_nada(client, session):
    h = _setup(session, alerta_estoque_minimo=False, controlar_validade=False)
    assert _tipos(client, h) == []
