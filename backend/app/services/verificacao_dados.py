"""Verificação noturna de consistência: acha número divergente antes do cliente.

Cada checagem compara um valor gravado (denormalizado) com a fonte que o originou.
Só lê; quem corrige é o comando próprio de cada caso (ex.: `flask backfill-vendas-produto`).
Roda por `flask verificar-dados` (cron diário na VM) e manda resumo ao Sentry quando
encontra divergência; o super admin consulta em GET /api/saas/verificacao-dados.
"""
from decimal import Decimal

from sqlalchemy import func

from app.models import Produto, ProdutoLote, Venda, VendaItem, allow_all_tenants, db

TOL_QTD = Decimal("0.001")
TOL_VALOR = Decimal("0.05")
LIMITE_POR_CHECAGEM = 50


def _d(v) -> Decimal:
    return Decimal(str(v or 0))


def _item(checagem, estab_id, ref, descricao, esperado, encontrado):
    return {"checagem": checagem, "estabelecimento_id": estab_id, "ref": ref, "descricao": descricao,
            "esperado": float(esperado), "encontrado": float(encontrado)}


def _filtrar(q, modelo, estab_id):
    return q.filter(modelo.estabelecimento_id == estab_id) if estab_id is not None else q


def estoque_negativo(estab_id=None):
    q = _filtrar(Produto.query.filter(Produto.quantidade < 0, Produto.deleted_at.is_(None)), Produto, estab_id)
    return [_item("estoque_negativo", p.estabelecimento_id, f"produto:{p.id}", p.nome, 0, p.quantidade)
            for p in q.limit(LIMITE_POR_CHECAGEM)]


def lotes_acima_do_estoque(estab_id=None):
    """Soma dos lotes ativos maior que o estoque do produto: o agregado perdeu baixa ou entrada."""
    soma = func.coalesce(func.sum(ProdutoLote.quantidade), 0)
    q = db.session.query(Produto, soma.label("lotes")).join(
        ProdutoLote, (ProdutoLote.produto_id == Produto.id) & (ProdutoLote.estabelecimento_id == Produto.estabelecimento_id)
    ).filter(ProdutoLote.ativo.is_(True), ProdutoLote.quantidade > 0, Produto.deleted_at.is_(None)) \
        .group_by(Produto.id)
    q = _filtrar(q, Produto, estab_id)
    saida = []
    for p, lotes in q.all():
        if _d(lotes) - _d(p.quantidade) > TOL_QTD:
            saida.append(_item("lotes_acima_do_estoque", p.estabelecimento_id, f"produto:{p.id}", p.nome, lotes, p.quantidade))
    return saida[:LIMITE_POR_CHECAGEM]


def vendas_do_produto(estab_id=None):
    """quantidade_vendida/total_vendido do produto x itens de vendas não canceladas (mesma regra do backfill)."""
    ledger = db.session.query(
        VendaItem.produto_id.label("pid"),
        func.sum(VendaItem.quantidade).label("qtd"),
        func.sum(VendaItem.total_item).label("total"),
    ).join(Venda, Venda.id == VendaItem.venda_id) \
        .filter(func.lower(func.coalesce(Venda.status, "")) != "cancelada")
    ledger = _filtrar(ledger, Venda, estab_id).group_by(VendaItem.produto_id).subquery()
    q = db.session.query(Produto, ledger.c.qtd, ledger.c.total).outerjoin(ledger, ledger.c.pid == Produto.id) \
        .filter(Produto.deleted_at.is_(None))
    q = _filtrar(q, Produto, estab_id)
    saida = []
    for p, qtd, total in q.all():
        if abs(_d(p.quantidade_vendida) - _d(qtd)) > TOL_QTD:
            saida.append(_item("vendas_do_produto_qtd", p.estabelecimento_id, f"produto:{p.id}", p.nome, qtd, p.quantidade_vendida))
        elif abs(_d(p.total_vendido) - _d(total)) > TOL_VALOR:
            saida.append(_item("vendas_do_produto_total", p.estabelecimento_id, f"produto:{p.id}", p.nome, total, p.total_vendido))
    return saida[:LIMITE_POR_CHECAGEM]


def total_da_venda(estab_id=None):
    """Subtotal da venda x soma dos itens, e total x subtotal - desconto."""
    soma = func.coalesce(func.sum(VendaItem.total_item), 0)
    q = db.session.query(Venda, soma.label("itens")).outerjoin(VendaItem, VendaItem.venda_id == Venda.id) \
        .filter(Venda.deleted_at.is_(None)).group_by(Venda.id)
    q = _filtrar(q, Venda, estab_id)
    saida = []
    for v, itens in q.all():
        if abs(_d(v.subtotal) - _d(itens)) > TOL_VALOR:
            saida.append(_item("venda_subtotal", v.estabelecimento_id, f"venda:{v.id}", v.codigo, itens, v.subtotal))
        elif abs(_d(v.total) - (_d(v.subtotal) - _d(v.desconto))) > TOL_VALOR:
            saida.append(_item("venda_total", v.estabelecimento_id, f"venda:{v.id}", v.codigo,
                               _d(v.subtotal) - _d(v.desconto), v.total))
    return saida[:LIMITE_POR_CHECAGEM]


def modelo_de_grade(estab_id=None):
    """Modelo de grade não vende nem guarda estoque: tem que estar inativo e zerado."""
    q = Produto.query.filter(Produto.eh_grade_modelo.is_(True),
                             (Produto.ativo.is_(True)) | (Produto.quantidade != 0))
    q = _filtrar(q, Produto, estab_id)
    return [_item("modelo_de_grade", p.estabelecimento_id, f"produto:{p.id}", p.nome, 0, p.quantidade)
            for p in q.limit(LIMITE_POR_CHECAGEM)]


CHECAGENS = (estoque_negativo, lotes_acima_do_estoque, vendas_do_produto, total_da_venda, modelo_de_grade)


def verificar(estab_id=None) -> dict:
    """Roda todas as checagens (todas as lojas quando estab_id é None)."""
    divergencias, falhas = [], []
    with allow_all_tenants():
        for checagem in CHECAGENS:
            try:
                divergencias.extend(checagem(estab_id))
            except Exception as erro:  # uma checagem quebrada não esconde as outras
                db.session.rollback()
                falhas.append({"checagem": checagem.__name__, "erro": str(erro)[:300]})
    por_checagem = {}
    for d in divergencias:
        por_checagem[d["checagem"]] = por_checagem.get(d["checagem"], 0) + 1
    return {"ok": not divergencias and not falhas, "total": len(divergencias),
            "por_checagem": por_checagem, "divergencias": divergencias, "falhas": falhas}
