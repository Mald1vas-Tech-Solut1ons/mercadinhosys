"""Regressão do retorno ausente no fallback de listagem de fornecedores."""
from datetime import date, datetime, timezone

import pytest
from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Fornecedor, Funcionario, TenantQuery


@pytest.fixture
def supplier_context(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    supplier = Fornecedor(
        estabelecimento_id=estab.id, nome_fantasia="Água Atacado", razao_social="Água LTDA",
        cnpj="11222333000144", telefone="11999999999", email="supplier@example.test",
        cep="01000000", logradouro="Rua A", numero="1", bairro="Centro",
        cidade="São Paulo", estado="SP", ativo=True, classificacao="A",
    )
    session.add(supplier)
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin",
    })
    return supplier, {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("fallback", [False, True])
def test_supplier_listing_returns_response(client, session, supplier_context, monkeypatch, fallback):
    supplier, headers = supplier_context
    if fallback:
        def fail_primary(*args, **kwargs):
            raise RuntimeError("falha de consulta principal reproduzida")
        monkeypatch.setattr(TenantQuery, "paginate", fail_primary)
    response = client.get("/api/fornecedores/?busca=agua&ativo=true&classificacao=A", headers=headers)
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["success"] is True
    assert body["total"] == 1
    assert [row["id"] for row in body["fornecedores"]] == [supplier.id]


def test_supplier_fallback_preserves_filters_and_soft_delete(client, session, supplier_context, monkeypatch):
    supplier, headers = supplier_context
    def fail_primary(*args, **kwargs):
        raise RuntimeError("falha principal reproduzida")
    monkeypatch.setattr(TenantQuery, "paginate", fail_primary)
    response = client.get("/api/fornecedores/?ativo=false", headers=headers)
    assert response.status_code == 200
    assert response.get_json()["total"] == 0
    supplier.deleted_at = datetime.now(timezone.utc)
    session.commit()
    response = client.get("/api/fornecedores/", headers=headers)
    assert response.status_code == 200
    assert response.get_json()["fornecedores"] == []


def test_supplier_double_failure_returns_json(client, session, supplier_context, monkeypatch):
    _, headers = supplier_context
    def fail_primary(*args, **kwargs):
        raise RuntimeError("erro primário")
    def fail_fallback(*args, **kwargs):
        raise RuntimeError("erro fallback")
    monkeypatch.setattr(TenantQuery, "paginate", fail_primary)
    monkeypatch.setattr(session, "query", fail_fallback)
    response = client.get("/api/fornecedores/", headers=headers)
    assert response.status_code == 500
    assert response.get_json() == {"success": False, "message": "Erro interno ao listar fornecedores"}


def test_supplier_fallback_excludes_other_store(client, session, supplier_context, monkeypatch):
    supplier, headers = supplier_context
    other_store = Estabelecimento(
        nome_fantasia="Outra Loja", razao_social="Outra Loja LTDA", cnpj="99888777000166",
        email="other@example.test", telefone="11999999999", data_abertura=date(2024, 1, 1),
        cep="01000000", logradouro="Rua B", numero="2", bairro="Centro",
        cidade="São Paulo", estado="SP", pais="Brasil",
    )
    session.add(other_store)
    session.flush()
    foreign = Fornecedor(
        estabelecimento_id=other_store.id, nome_fantasia="Fornecedor Estrangeiro ao Tenant",
        razao_social="Outro Fornecedor LTDA", cnpj="22333444000155", telefone="11999999999",
        email="foreign@example.test", cep="01000000", logradouro="Rua B", numero="2",
        bairro="Centro", cidade="São Paulo", estado="SP",
    )
    session.add(foreign)
    session.commit()
    def fail_primary(*args, **kwargs):
        raise RuntimeError("falha principal reproduzida")
    monkeypatch.setattr(TenantQuery, "paginate", fail_primary)
    response = client.get("/api/fornecedores/", headers=headers)
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["total"] == 1
    assert [row["id"] for row in response.get_json()["fornecedores"]] == [supplier.id]
