"""Regressão do retorno ausente no fallback de listagem de fornecedores."""
from datetime import date, datetime, timezone

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Fornecedor, Funcionario, Produto, TenantQuery


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
    assert (body.get("degraded") is True) == fallback
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


@pytest.fixture
def supplier_global_context(session, supplier_context):
    supplier, tenant_headers = supplier_context
    actor = Funcionario(
        estabelecimento_id=supplier.estabelecimento_id, nome="Superadmin Fornecedores",
        cpf="99988877766", username="super-supplier", role="superadmin", ativo=True, is_super_admin=True,
        data_nascimento=date(1990, 1, 1), celular="11999999999", email="super-supplier@example.test",
        cargo="Administrador", data_admissao=date(2024, 1, 1), salario_base=5000,
    )
    actor.set_password("test-only-super-supplier")
    session.add(actor)
    other_store = Estabelecimento(
        nome_fantasia="Outra Loja", razao_social="Outra Loja LTDA", cnpj="99888777000166",
        email="other-global@example.test", telefone="11999999999", data_abertura=date(2024, 1, 1),
        cep="01000000", logradouro="Rua B", numero="2", bairro="Centro",
        cidade="São Paulo", estado="SP", pais="Brasil",
    )
    session.add(other_store)
    session.flush()
    foreign = Fornecedor(
        estabelecimento_id=other_store.id, nome_fantasia="Água Outra Loja", razao_social="Água Outra LTDA",
        cnpj="22333444000155", telefone="11999999999", email="other-supplier@example.test",
        cep="01000000", logradouro="Rua B", numero="2", bairro="Centro", cidade="São Paulo", estado="SP",
    )
    categories = [CategoriaProduto(estabelecimento_id=store_id, nome="Geral")
                  for store_id in (supplier.estabelecimento_id, other_store.id)]
    session.add_all([foreign, *categories])
    session.flush()
    for index, (owner, category, count) in enumerate(((supplier, categories[0], 1), (foreign, categories[1], 2))):
        for number in range(count):
            session.add(Produto(estabelecimento_id=owner.estabelecimento_id, categoria_id=category.id,
                                fornecedor_id=owner.id, nome=f"Produto {index}-{number}", preco_custo=1,
                                preco_venda=2, quantidade=10, ativo=True))
    session.add(Produto(estabelecimento_id=supplier.estabelecimento_id, categoria_id=categories[0].id,
                        fornecedor_id=supplier.id, nome="Inativo", preco_custo=1, preco_venda=2, ativo=False))
    session.add(Produto(estabelecimento_id=supplier.estabelecimento_id, categoria_id=categories[0].id,
                        fornecedor_id=supplier.id, nome="Excluído", preco_custo=1, preco_venda=2, ativo=True,
                        deleted_at=datetime.now(timezone.utc)))
    session.commit()
    token = create_access_token(identity=str(actor.id), additional_claims={
        "estabelecimento_id": "all", "role": "superadmin", "is_super_admin": True,
    })
    return supplier, foreign, {"Authorization": f"Bearer {token}"}, tenant_headers


@pytest.mark.parametrize("mode", ["global", "mirror", "tenant", "tenant-forged-all"])
def test_supplier_listing_has_complete_metrics_in_each_scope(client, supplier_global_context, mode):
    supplier, foreign, global_headers, tenant_headers = supplier_global_context
    headers = dict(tenant_headers if mode.startswith("tenant") else global_headers)
    if mode == "tenant-forged-all":
        headers["X-Establishment-ID"] = "all"
    if mode == "mirror":
        headers["X-Establishment-ID"] = str(supplier.estabelecimento_id)
    response = client.get("/api/fornecedores/?estabelecimento_id=2", headers=headers)
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body.get("degraded") is not True
    actual = {row["id"]: row["produtos_ativos"] for row in body["fornecedores"]}
    expected = {supplier.id: 1, foreign.id: 2} if mode == "global" else {supplier.id: 1}
    assert actual == expected


@pytest.mark.parametrize("mode", ["global", "mirror", "tenant"])
@pytest.mark.parametrize("operation", ["detail", "orders", "search", "statistics", "report", "export", "intelligence"])
def test_supplier_read_operations_preserve_scope(client, supplier_global_context, mode, operation):
    supplier, foreign, global_headers, tenant_headers = supplier_global_context
    headers = dict(tenant_headers if mode == "tenant" else global_headers)
    if mode == "mirror":
        headers["X-Establishment-ID"] = str(supplier.estabelecimento_id)
    paths = {"detail": f"/{supplier.id}", "orders": f"/{supplier.id}/pedidos", "search": "/busca?q=agua",
             "statistics": "/estatisticas", "report": "/relatorio/analitico", "export": "/exportar?formato=csv",
             "intelligence": f"/{supplier.id}/inteligencia"}
    response = client.get("/api/fornecedores" + paths[operation], headers=headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    expected_ids = {supplier.id, foreign.id} if mode == "global" else {supplier.id}
    if operation == "export":
        text = response.get_data(as_text=True)
        assert supplier.nome_fantasia in text
        assert (foreign.nome_fantasia in text) == (mode == "global")
        return
    body = response.get_json()
    assert body["success"] is True
    if operation == "detail":
        assert body["fornecedor"]["id"] == supplier.id
        assert body["metricas"]["total_produtos"] == 1
    elif operation == "orders":
        assert body["pedidos"] == []
    elif operation == "search":
        assert {row["id"] for row in body["fornecedores"]} == expected_ids
    elif operation == "statistics":
        assert body["estatisticas"]["total"] == len(expected_ids)
        assert sum(body["estatisticas"]["por_estado"].values()) == len(expected_ids)
    elif operation == "report":
        assert {row["fornecedor"]["id"] for row in body["relatorio"]} == expected_ids
    elif operation == "intelligence":
        assert isinstance(body["inteligencia"], dict)
        assert isinstance(body["timeline"], list)


@pytest.mark.parametrize("suffix", ["", "/pedidos", "/inteligencia"])
def test_tenant_cannot_read_supplier_from_other_store(client, supplier_global_context, suffix):
    _, foreign, _, tenant_headers = supplier_global_context
    response = client.get(f"/api/fornecedores/{foreign.id}{suffix}", headers=tenant_headers)
    assert response.status_code == 404


def test_global_supplier_statistics_exclude_soft_deleted_rows(client, session, supplier_global_context):
    _, foreign, headers, _ = supplier_global_context
    foreign.deleted_at = datetime.now(timezone.utc)
    session.commit()
    body = client.get("/api/fornecedores/estatisticas", headers=headers).get_json()
    assert body["success"] is True
    assert body["estatisticas"]["total"] == 1
    assert sum(body["estatisticas"]["por_estado"].values()) == 1
