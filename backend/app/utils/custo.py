"""Custo da saída de mercadoria: uma única definição para CMV, margem e lucro.

O custo gravado no item da venda é o do momento da saída. Itens antigos, de antes
de o custo passar a ser gravado, usam o custo atual do produto; nunca ficam de fora
do CMV (o que inflaria o lucro).
"""
from sqlalchemy import func


def custo_efetivo():
    """Expressão SQL do custo unitário efetivo de um item de venda."""
    from app.models import Produto, VendaItem
    return func.coalesce(VendaItem.custo_unitario, Produto.preco_custo, 0)


def com_custo_efetivo(query):
    """Junta o produto (LEFT JOIN) para a expressão de custo efetivo funcionar."""
    from app.models import Produto, VendaItem
    return query.outerjoin(Produto, Produto.id == VendaItem.produto_id)
