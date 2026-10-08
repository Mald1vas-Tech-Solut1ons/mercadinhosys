import pytest
from app.utils import release_smoke_contracts as contracts


@pytest.mark.parametrize("metric", [None, -1, True, 0])
def test_200_success_with_invalid_supplier_metric_fails_smoke(metric):
    row = {"id": 1, "estabelecimento_id": 2, "produtos_ativos": 1}
    body = {"success": True, "total": 1, "fornecedores": [{**row, "produtos_ativos": metric}]}
    with pytest.raises(RuntimeError):
        contracts.validate_suppliers(body, [row])


def test_degraded_200_success_fails_smoke():
    with pytest.raises(RuntimeError):
        contracts.validate_suppliers({"success": True, "degraded": True, "total": 0, "fornecedores": []}, [])


def test_cross_tenant_supplier_fails_smoke():
    expected = {"id": 1, "estabelecimento_id": 2, "produtos_ativos": 1}
    body = {"success": True, "total": 1, "fornecedores": [{**expected, "estabelecimento_id": 3}]}
    with pytest.raises(RuntimeError):
        contracts.validate_suppliers(body, [expected])


def test_valid_supplier_contract_passes():
    row = {"id": 1, "estabelecimento_id": 2, "produtos_ativos": 1}
    contracts.validate_suppliers({"success": True, "total": 1, "fornecedores": [row]}, [row])


def test_cross_tenant_product_fails_smoke():
    with pytest.raises(RuntimeError):
        contracts.validate_products({"success": True, "produtos": [{"estabelecimento_id": 3}]}, tenant=2)


@pytest.mark.parametrize("item_count", [None, True, 0])
def test_invalid_order_item_count_fails_smoke(item_count):
    row = {"id": 1, "quantidade_itens": 2, "total": 40}
    with pytest.raises(RuntimeError):
        contracts.validate_orders({"success": True, "total": 1, "pedidos": [{**row, "quantidade_itens": item_count}]}, [row])


def test_valid_order_contract_passes():
    row = {"id": 1, "quantidade_itens": 2, "total": 40}
    contracts.validate_orders({"success": True, "total": 1, "pedidos": [row]}, [row])
