"""Contratos do smoke: resposta degradada e escopo incorreto reprovam a release."""


def require_success(body):
    if not isinstance(body, dict) or body.get("success") is not True or body.get("degraded"):
        raise RuntimeError("Resposta ausente, sem sucesso explícito ou degradada")


def validate_suppliers(body, expected):
    require_success(body)
    rows = body.get("fornecedores")
    if not isinstance(rows, list) or type(body.get("total")) is not int or body["total"] != len(expected):
        raise RuntimeError("Contrato ou total de fornecedores divergiu do banco")
    expected_by_id = {row["id"]: row for row in expected}
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or row.get("id") in seen:
            raise RuntimeError("Fornecedor inválido ou duplicado")
        original = expected_by_id.get(row.get("id"))
        if original is None or row.get("estabelecimento_id") != original["estabelecimento_id"]:
            raise RuntimeError("Fornecedor fora do escopo autorizado")
        count = row.get("produtos_ativos")
        if type(count) is not int or count < 0 or count != original["produtos_ativos"]:
            raise RuntimeError("Métrica de produtos ausente ou diferente do banco")
        seen.add(row["id"])
    if len(rows) != min(200, len(expected)):
        raise RuntimeError("Página de fornecedores incompleta")


def validate_products(body, tenant=None):
    require_success(body)
    rows = body.get("produtos")
    if not isinstance(rows, list):
        raise RuntimeError("Contrato de produtos inválido")
    for row in rows:
        if not isinstance(row, dict) or type(row.get("estabelecimento_id")) is not int:
            raise RuntimeError("Produto sem estabelecimento numérico")
        if tenant is not None and row["estabelecimento_id"] != tenant:
            raise RuntimeError("Produto de outro estabelecimento")


def validate_orders(body, expected):
    require_success(body)
    rows = body.get("pedidos")
    if not isinstance(rows, list) or type(body.get("total")) is not int or body["total"] != len(expected):
        raise RuntimeError("Contrato ou total de pedidos divergiu do banco")
    by_id = {row["id"]: row for row in expected}
    seen = set()
    for row in rows:
        original = by_id.get(row.get("id")) if isinstance(row, dict) else None
        if original is None or row["id"] in seen:
            raise RuntimeError("Pedido fora do escopo ou duplicado")
        if type(row.get("quantidade_itens")) is not int or row["quantidade_itens"] != original["quantidade_itens"]:
            raise RuntimeError("Contagem de itens do pedido divergente")
        if row.get("total") != original["total"]:
            raise RuntimeError("Valor do pedido divergente")
        seen.add(row["id"])
    if len(rows) != min(20, len(expected)):
        raise RuntimeError("Página de pedidos incompleta")
