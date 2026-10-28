"""Comparação de períodos e "por que o faturamento mudou".

O período atual é comparado com o imediatamente anterior, de mesma duração, em dias
da loja (não UTC). A ponte é uma identidade exata, sem resíduo:

    F = n · t   (vendas × ticket)
    ΔF = (n1 − n0) · t0   [efeito quantidade de vendas]
       + (t1 − t0) · n1   [efeito ticket]

Ao lado, os produtos que mais ganharam e mais perderam faturamento, e os que venderam
no período anterior mas estão sem estoque e não venderam agora (venda perdida por ruptura).
"""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func

from app.models import Produto, Venda, VendaItem, db
from app.utils.timezone import hoje_local, local_date_to_utc_naive

CENT = Decimal("0.01")


def _janela(estab_id, inicio: date, fim: date):
    de = local_date_to_utc_naive(inicio)
    ate = local_date_to_utc_naive(fim, fim_do_dia=True)
    return (Venda.estabelecimento_id == estab_id, Venda.deleted_at.is_(None),
            func.lower(func.coalesce(Venda.status, "")) != "cancelada",
            Venda.data_venda >= de, Venda.data_venda <= ate)


def _resumo(estab_id, inicio, fim) -> dict:
    n, total, desconto = db.session.query(
        func.count(Venda.id), func.coalesce(func.sum(Venda.total), 0), func.coalesce(func.sum(Venda.desconto), 0)
    ).filter(*_janela(estab_id, inicio, fim)).one()
    total = Decimal(str(total))
    n = int(n or 0)
    ticket = (total / n) if n else Decimal("0")
    itens = db.session.query(func.coalesce(func.sum(VendaItem.quantidade), 0)).join(Venda, Venda.id == VendaItem.venda_id) \
        .filter(*_janela(estab_id, inicio, fim)).scalar()
    return {"inicio": inicio.isoformat(), "fim": fim.isoformat(), "vendas": n, "faturamento": total,
            "ticket": ticket, "itens": Decimal(str(itens or 0)), "descontos": Decimal(str(desconto or 0))}


def _por_produto(estab_id, inicio, fim) -> dict:
    linhas = db.session.query(VendaItem.produto_id, func.coalesce(func.sum(VendaItem.total_item), 0),
                              func.coalesce(func.sum(VendaItem.quantidade), 0)) \
        .join(Venda, Venda.id == VendaItem.venda_id).filter(*_janela(estab_id, inicio, fim)) \
        .group_by(VendaItem.produto_id).all()
    return {pid: (Decimal(str(t)), Decimal(str(q))) for pid, t, q in linhas}


def _f(v) -> float:
    return float(Decimal(str(v)).quantize(CENT))


def periodos(dias: int = None, inicio: date = None, fim: date = None):
    """(início, fim) atual e anterior, em dias da loja, com a mesma duração."""
    if inicio is None or fim is None:
        fim = hoje_local()
        inicio = fim - timedelta(days=max(1, int(dias or 30)) - 1)
    duracao = (fim - inicio).days + 1
    fim_ant = inicio - timedelta(days=1)
    return (inicio, fim), (fim_ant - timedelta(days=duracao - 1), fim_ant)


def comparar(estab_id, dias: int = None, inicio: date = None, fim: date = None, top: int = 5) -> dict:
    (i1, f1), (i0, f0) = periodos(dias, inicio, fim)
    atual, anterior = _resumo(estab_id, i1, f1), _resumo(estab_id, i0, f0)

    n0, n1, t0, t1 = anterior["vendas"], atual["vendas"], anterior["ticket"], atual["ticket"]
    efeito_qtd = Decimal(n1 - n0) * t0
    efeito_ticket = (t1 - t0) * Decimal(n1)
    delta = atual["faturamento"] - anterior["faturamento"]

    prod1, prod0 = _por_produto(estab_id, i1, f1), _por_produto(estab_id, i0, f0)
    ids = set(prod1) | set(prod0)
    nomes = {p.id: p for p in Produto.query.filter(Produto.id.in_(ids), Produto.estabelecimento_id == estab_id)} if ids else {}
    variacoes = []
    for pid in ids:
        a, b = prod1.get(pid, (Decimal(0), Decimal(0))), prod0.get(pid, (Decimal(0), Decimal(0)))
        p = nomes.get(pid)
        if p is None:
            continue
        variacoes.append({"produto_id": pid, "nome": p.nome, "atual": _f(a[0]), "anterior": _f(b[0]),
                          "variacao": _f(a[0] - b[0]), "estoque": float(p.quantidade or 0)})
    variacoes.sort(key=lambda x: x["variacao"])
    perdas = [v for v in variacoes if v["variacao"] < 0][:top]
    ganhos = [v for v in reversed(variacoes) if v["variacao"] > 0][:top]
    ruptura = [v for v in variacoes if v["anterior"] > 0 and v["atual"] == 0 and v["estoque"] <= 0]
    ruptura.sort(key=lambda x: x["anterior"], reverse=True)

    def pct(novo, velho):
        return None if not velho else round(float((Decimal(str(novo)) - Decimal(str(velho))) / Decimal(str(velho)) * 100), 1)

    def saida(r):
        return {"inicio": r["inicio"], "fim": r["fim"], "vendas": r["vendas"], "faturamento": _f(r["faturamento"]),
                "ticket": _f(r["ticket"]), "itens": float(r["itens"]), "descontos": _f(r["descontos"])}

    return {
        "atual": saida(atual), "anterior": saida(anterior),
        "variacao": {"faturamento": _f(delta), "faturamento_pct": pct(atual["faturamento"], anterior["faturamento"]),
                     "vendas": n1 - n0, "vendas_pct": pct(n1, n0),
                     "ticket": _f(t1 - t0), "ticket_pct": pct(t1, t0)},
        "ponte": {"anterior": _f(anterior["faturamento"]), "efeito_quantidade": _f(efeito_qtd),
                  "efeito_ticket": _f(efeito_ticket), "atual": _f(atual["faturamento"])},
        "produtos": {"ganhos": ganhos, "perdas": perdas, "ruptura": ruptura[:top],
                     "ruptura_valor_anterior": _f(sum(Decimal(str(v["anterior"])) for v in ruptura))},
    }
