"""Acompanhamento da venda por dose: a única fonte das contas de dose.

Dashboard (aba Doses), DRE, alertas, resumo diário e Consultor leem daqui, então a tela e a IA
nunca discordam. Plano: PLANO-VENDA-POR-DOSE.md, seção 5.4.

Conceitos:
- venda de dose = ``VendaItem`` com ``ml_total`` (``eh_dose``) de venda finalizada;
- rendimento = ml vendidos (líquidos de estorno) ÷ volume das garrafas ENCERRADAS no período; só a
  garrafa que terminou mostra se a dose foi generosa ou se houve venda fora do PDV (o razão fecha por construção);
- perda no DRE = custo em R$ do ml que saiu sem venda (perda, cortesia, degustação, descarte, desvio) mais
  ajuste de contagem negativo (positivo abate). Sem isso o custo da garrafa só apareceria nas doses vendidas.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func

from app import db
from app.models import Funcionario, Produto, Venda, VendaItem
from app.models_dose import DoseMovimento, GarrafaAberta, ProdutoDose
from app.services import dose_config_service
from app.utils.query_helpers import get_hour_extract
from app.utils.timezone import hoje_local, local_date_to_utc_naive

# Saídas de ml sem venda que o DRE trata como perda.
TIPOS_PERDA = ("perda", "cortesia", "degustacao", "descarte", "desvio")
ROTULO_TIPO = {
    "perda": "Perda / derramamento", "cortesia": "Cortesia", "degustacao": "Degustação",
    "descarte": "Descarte de garrafa aberta", "desvio": "Diferença ao encerrar a garrafa",
    "ajuste": "Ajuste de contagem",
}
LIMITE_ALERTAS = 12


def _f(valor, casas=2) -> float:
    try:
        return round(float(valor or 0), casas)
    except (TypeError, ValueError):
        return 0.0


def _brl(valor) -> str:
    """R$ 1.234,56 (o texto do alerta vai direto para a tela e para a IA)."""
    texto = f"{float(valor or 0):,.2f}"
    return "R$ " + texto.replace(",", "X").replace(".", ",").replace("X", ".")


def _d(valor) -> Decimal:
    return Decimal(str(valor if valor is not None else 0))


def _limites(inicio: date, fim: date):
    return local_date_to_utc_naive(inicio), local_date_to_utc_naive(fim, fim_do_dia=True)


def _perda_sql():
    """Custo de perda de um movimento: ajuste negativo conta, positivo abate (o ``custo`` guarda o módulo)."""
    return case(
        (DoseMovimento.tipo == "ajuste", case((DoseMovimento.ml < 0, DoseMovimento.custo), else_=-DoseMovimento.custo)),
        else_=DoseMovimento.custo)


def custo_perdas(estabelecimento_id, inicio: date, fim: date) -> dict:
    """Custo em R$ do ml perdido no período, por tipo. Usado pelo DRE e pela aba Doses (mesmo número)."""
    ini, fim_utc = _limites(inicio, fim)
    linhas = db.session.query(
        DoseMovimento.tipo,
        func.coalesce(func.sum(func.abs(DoseMovimento.ml)), 0),
        func.coalesce(func.sum(_perda_sql()), 0),
    ).filter(
        DoseMovimento.estabelecimento_id == estabelecimento_id,
        DoseMovimento.tipo.in_(TIPOS_PERDA + ("ajuste",)),
        DoseMovimento.created_at >= ini, DoseMovimento.created_at <= fim_utc,
    ).group_by(DoseMovimento.tipo).all()
    por_tipo = [{"tipo": t, "rotulo": ROTULO_TIPO.get(t, t), "ml": _f(ml), "custo": _f(custo)}
                for t, ml, custo in linhas if _d(ml) != 0 or _d(custo) != 0]
    por_tipo.sort(key=lambda x: -x["custo"])
    return {"total": round(sum(i["custo"] for i in por_tipo), 2), "por_tipo": por_tipo}


def custo_perdas_total(estabelecimento_id, inicio: date, fim: date) -> float:
    return custo_perdas(estabelecimento_id, inicio, fim)["total"]


def _vendas_por_produto(estabelecimento_id, ini, fim_utc, *, dose: bool):
    filtro_dose = VendaItem.ml_total.isnot(None) if dose else VendaItem.ml_total.is_(None)
    return db.session.query(
        VendaItem.produto_id,
        func.coalesce(func.sum(VendaItem.quantidade), 0),
        func.coalesce(func.sum(VendaItem.ml_total), 0),
        func.coalesce(func.sum(VendaItem.total_item), 0),
        func.coalesce(func.sum(func.coalesce(VendaItem.custo_unitario, 0) * VendaItem.quantidade), 0),
        func.coalesce(func.sum(VendaItem.quantidade_base), 0),
    ).join(Venda, Venda.id == VendaItem.venda_id).filter(
        VendaItem.estabelecimento_id == estabelecimento_id, Venda.estabelecimento_id == estabelecimento_id,
        Venda.status == "finalizada", Venda.data_venda >= ini, Venda.data_venda <= fim_utc, filtro_dose,
    ).group_by(VendaItem.produto_id).all()


def _rendimento(estabelecimento_id, ini, fim_utc) -> dict:
    """Por produto: garrafas encerradas no período, volume, ml vendido líquido, desvio e rendimento."""
    garrafas = GarrafaAberta.query.filter(
        GarrafaAberta.estabelecimento_id == estabelecimento_id, GarrafaAberta.status == "vazia",
        GarrafaAberta.encerrada_em >= ini, GarrafaAberta.encerrada_em <= fim_utc).all()
    if not garrafas:
        return {}
    ids = [g.id for g in garrafas]
    soma = defaultdict(lambda: defaultdict(lambda: Decimal(0)))
    for gid, tipo, ml in db.session.query(
            DoseMovimento.garrafa_id, DoseMovimento.tipo, func.coalesce(func.sum(DoseMovimento.ml), 0)
    ).filter(DoseMovimento.garrafa_id.in_(ids)).group_by(DoseMovimento.garrafa_id, DoseMovimento.tipo).all():
        soma[gid][tipo] = _d(ml)
    saida = {}
    for g in garrafas:
        s = soma[g.id]
        item = saida.setdefault(g.produto_id, {"garrafas": 0, "volume_ml": Decimal(0), "vendido_ml": Decimal(0),
                                               "desvio_ml": Decimal(0)})
        item["garrafas"] += 1
        item["volume_ml"] += _d(g.volume_inicial_ml)
        item["vendido_ml"] += -(s["venda"] + s["estorno"])
        item["desvio_ml"] += -s["desvio"]
    return saida


def _abertas_agora(estabelecimento_id, alerta_dias) -> dict:
    hoje = hoje_local()
    linhas = db.session.query(GarrafaAberta, Produto.nome).join(
        Produto, Produto.id == GarrafaAberta.produto_id).filter(
        GarrafaAberta.estabelecimento_id == estabelecimento_id, GarrafaAberta.status == "aberta").order_by(
        GarrafaAberta.aberta_em).all()
    itens, saldo_total, valor_total, vencidas = [], Decimal(0), Decimal(0), 0
    for g, nome in linhas:
        dias = max(0, (hoje - g.aberta_em.date()).days) if g.aberta_em else 0
        valor = _d(g.saldo_ml) * g.custo_por_ml
        vencida = g.validade_aberta is not None and g.validade_aberta < hoje
        vencidas += 1 if vencida else 0
        saldo_total += _d(g.saldo_ml)
        valor_total += valor
        itens.append({"id": g.id, "produto_id": g.produto_id, "produto": nome, "saldo_ml": _f(g.saldo_ml),
                      "volume_inicial_ml": _f(g.volume_inicial_ml), "dias_aberta": dias, "valor_custo": _f(valor),
                      "vencida": vencida, "velha": bool(alerta_dias and dias >= alerta_dias)})
    return {"quantidade": len(itens), "saldo_ml": _f(saldo_total), "valor_custo": _f(valor_total),
            "vencidas": vencidas, "itens": itens[:20]}


def _pico_por_hora(estabelecimento_id, ini, fim_utc) -> list:
    hora = get_hour_extract(Venda.data_venda)
    linhas = db.session.query(hora, func.coalesce(func.sum(VendaItem.quantidade), 0),
                              func.coalesce(func.sum(VendaItem.total_item), 0)).join(
        Venda, Venda.id == VendaItem.venda_id).filter(
        VendaItem.estabelecimento_id == estabelecimento_id, Venda.estabelecimento_id == estabelecimento_id,
        Venda.status == "finalizada", Venda.data_venda >= ini, Venda.data_venda <= fim_utc,
        VendaItem.ml_total.isnot(None)).group_by(hora).order_by(hora).all()
    return [{"hora": int(h), "doses": _f(q, 2), "receita": _f(r)} for h, q, r in linhas if h is not None]


def _por_funcionario(estabelecimento_id, ini, fim_utc) -> list:
    """Quem registrou perda/cortesia/desvio (identifica dose generosa ou venda sem registro)."""
    linhas = db.session.query(
        Funcionario.nome, DoseMovimento.tipo,
        func.coalesce(func.sum(func.abs(DoseMovimento.ml)), 0), func.coalesce(func.sum(_perda_sql()), 0),
    ).outerjoin(Funcionario, Funcionario.id == DoseMovimento.funcionario_id).filter(
        DoseMovimento.estabelecimento_id == estabelecimento_id, DoseMovimento.tipo.in_(TIPOS_PERDA + ("ajuste",)),
        DoseMovimento.created_at >= ini, DoseMovimento.created_at <= fim_utc,
    ).group_by(Funcionario.nome, DoseMovimento.tipo).all()
    por_nome = defaultdict(lambda: {"ml": 0.0, "custo": 0.0, "tipos": {}})
    for nome, tipo, ml, custo in linhas:
        reg = por_nome[nome or "Sem funcionário"]
        reg["ml"] += _f(ml)
        reg["custo"] += _f(custo)
        reg["tipos"][tipo] = _f(ml)
    lista = [{"funcionario": n, "ml": round(v["ml"], 2), "custo": round(v["custo"], 2), "tipos": v["tipos"]}
             for n, v in por_nome.items()]
    lista.sort(key=lambda x: -x["custo"])
    return lista


def _margem_das_doses(estabelecimento_id, meta) -> list:
    """Doses ativas com margem abaixo da meta da loja (custo sobe, preço fica parado)."""
    if not meta:
        return []
    alertas = []
    linhas = db.session.query(ProdutoDose, Produto).join(Produto, Produto.id == ProdutoDose.produto_id).filter(
        ProdutoDose.estabelecimento_id == estabelecimento_id, ProdutoDose.ativa.is_(True),
        Produto.vende_por_dose.is_(True), Produto.deleted_at.is_(None), Produto.ativo.isnot(False),
        Produto.volume_embalagem_ml.isnot(None), Produto.preco_custo.isnot(None)).all()
    for dose, p in linhas:
        preco, volume = _d(dose.preco_venda), _d(p.volume_embalagem_ml)
        if preco <= 0 or volume <= 0:
            continue
        custo_dose = _d(p.preco_custo) / volume * _d(dose.volume_ml)
        margem = float((preco - custo_dose) / preco * 100)
        if margem < float(meta):
            alertas.append({"produto_id": p.id, "produto": p.nome, "dose": dose.nome, "margem_pct": round(margem, 1),
                            "meta_pct": float(meta)})
    alertas.sort(key=lambda x: x["margem_pct"])
    return alertas


def metricas(estabelecimento_id, inicio: date, fim: date) -> dict:
    ini, fim_utc = _limites(inicio, fim)
    n_dias = max(1, (fim - inicio).days + 1)
    cfg = dose_config_service.ler_config_loja(estabelecimento_id)

    vendas_dose = {pid: (q, ml, rec, custo, base) for pid, q, ml, rec, custo, base in
                   _vendas_por_produto(estabelecimento_id, ini, fim_utc, dose=True)}
    vendas_garrafa = {pid: (q, rec, custo) for pid, q, _ml, rec, custo, _b in
                      _vendas_por_produto(estabelecimento_id, ini, fim_utc, dose=False)}
    rend = _rendimento(estabelecimento_id, ini, fim_utc)
    perdas = custo_perdas(estabelecimento_id, inicio, fim)
    abertas = _abertas_agora(estabelecimento_id, cfg.get("alerta_garrafa_aberta_dias"))

    ids = set(vendas_dose) | set(rend)
    produtos = {p.id: p for p in Produto.query.filter(
        Produto.estabelecimento_id == estabelecimento_id, Produto.id.in_(ids)).all()} if ids else {}
    saldo_aberto = defaultdict(lambda: Decimal(0))
    for item in GarrafaAberta.query.filter_by(estabelecimento_id=estabelecimento_id, status="aberta").all():
        saldo_aberto[item.produto_id] += _d(item.saldo_ml)
    dose_padrao = {}
    if ids:
        for d in ProdutoDose.query.filter(ProdutoDose.produto_id.in_(ids), ProdutoDose.ativa.is_(True)).order_by(
                ProdutoDose.padrao.desc(), ProdutoDose.ordem, ProdutoDose.id).all():
            dose_padrao.setdefault(d.produto_id, d)

    linhas, tot = [], {"doses": 0.0, "ml": 0.0, "receita": 0.0, "custo": 0.0, "garrafas_equivalentes": 0.0}
    for pid, (q, ml, rec, custo, base) in vendas_dose.items():
        p = produtos.get(pid)
        garrafas_eq, receita = _f(base, 4), _f(rec)
        volume = _d(p.volume_embalagem_ml) if p is not None and p.volume_embalagem_ml else None
        ml_dia = float(_d(ml)) / n_dias
        disponivel_ml = (float(volume) * float(_d(p.quantidade)) if volume is not None else 0.0) + float(saldo_aberto[pid])
        dose = dose_padrao.get(pid)
        r = rend.get(pid)
        garrafa = vendas_garrafa.get(pid)
        linhas.append({
            "produto_id": pid, "produto": p.nome if p is not None else f"Produto {pid}",
            "doses": _f(q, 2), "ml": _f(ml), "receita": receita, "custo": _f(custo), "margem": round(receita - _f(custo), 2),
            "margem_pct": round((receita - _f(custo)) / receita * 100, 1) if receita else None,
            "garrafas_equivalentes": garrafas_eq,
            # receita que cada garrafa rendeu vendida em dose × o preço dela fechada
            "receita_por_garrafa": round(receita / garrafas_eq, 2) if garrafas_eq else None,
            "preco_garrafa": _f(p.preco_venda) if p is not None else None,
            "garrafas_fechadas_vendidas": _f(garrafa[0], 2) if garrafa else 0.0,
            "rendimento_pct": round(float(r["vendido_ml"] / r["volume_ml"] * 100), 1) if r and r["volume_ml"] > 0 else None,
            "garrafas_encerradas": r["garrafas"] if r else 0,
            "desvio_ml": _f(r["desvio_ml"]) if r else 0.0,
            "cobertura_dias": round(disponivel_ml / ml_dia, 1) if ml_dia > 0 and volume is not None else None,
            "cobertura_doses": int(disponivel_ml // float(dose.volume_ml)) if dose is not None and float(dose.volume_ml) > 0 else None,
        })
        tot["doses"] += float(_d(q))
        tot["ml"] += float(_d(ml))
        tot["receita"] += receita
        tot["custo"] += _f(custo)
        tot["garrafas_equivalentes"] += garrafas_eq
    linhas.sort(key=lambda x: -x["receita"])

    volume_enc = sum(float(v["volume_ml"]) for v in rend.values())
    vendido_enc = sum(float(v["vendido_ml"]) for v in rend.values())
    rendimento_pct = round(vendido_enc / volume_enc * 100, 1) if volume_enc > 0 else None
    resumo = {
        "doses": round(tot["doses"], 2), "ml": round(tot["ml"], 2), "receita": round(tot["receita"], 2),
        "custo": round(tot["custo"], 2), "margem": round(tot["receita"] - tot["custo"], 2),
        "margem_pct": round((tot["receita"] - tot["custo"]) / tot["receita"] * 100, 1) if tot["receita"] else None,
        "garrafas_equivalentes": round(tot["garrafas_equivalentes"], 3),
        "perdas_custo": perdas["total"],
        # lucro de dose depois das perdas: o que o bar de fato ganhou com as garrafas
        "margem_liquida": round(tot["receita"] - tot["custo"] - perdas["total"], 2),
        "garrafas_encerradas": sum(v["garrafas"] for v in rend.values()),
        "rendimento_pct": rendimento_pct,
    }

    alertas = alertas_da_loja(estabelecimento_id, cfg=cfg, abertas=abertas, rendimento_pct=rendimento_pct,
                              resumo=resumo)
    return {
        "periodo": {"inicio": inicio.isoformat(), "fim": fim.isoformat(), "dias": n_dias},
        "resumo": resumo, "produtos": linhas, "perdas": perdas, "abertas": abertas,
        "por_funcionario": _por_funcionario(estabelecimento_id, ini, fim_utc),
        "pico_por_hora": _pico_por_hora(estabelecimento_id, ini, fim_utc),
        "alertas": alertas, "config": {k: cfg.get(k) for k in (
            "margem_alvo_dose_pct", "perda_esperada_pct", "alerta_garrafa_aberta_dias", "alerta_rendimento_pct")},
    }


def alertas_da_loja(estabelecimento_id, *, cfg=None, abertas=None, rendimento_pct=None, resumo=None) -> list:
    """Alertas de dose (PainelDoDia/AlertsPanel e Consultor): só o que o lojista pediu para vigiar."""
    cfg = cfg or dose_config_service.ler_config_loja(estabelecimento_id)
    abertas = abertas or _abertas_agora(estabelecimento_id, cfg.get("alerta_garrafa_aberta_dias"))
    saida = []
    for g in abertas["itens"]:
        if g["vencida"]:
            saida.append({"tipo": "garrafa_vencida", "severidade": "alta", "produto_id": g["produto_id"],
                          "titulo": f"{g['produto']}: garrafa aberta vencida",
                          "descricao": f"Aberta há {g['dias_aberta']} dias com {g['saldo_ml']:g} ml. Descarte para não vender.",
                          "acao": "Descartar a garrafa"})
        elif g["velha"]:
            saida.append({"tipo": "garrafa_aberta_velha", "severidade": "media", "produto_id": g["produto_id"],
                          "titulo": f"{g['produto']}: garrafa aberta há {g['dias_aberta']} dias",
                          "descricao": f"Restam {g['saldo_ml']:g} ml ({_brl(g['valor_custo'])} a custo). Venda logo ou confira a garrafa.",
                          "acao": "Conferir a garrafa"})
    limite = cfg.get("alerta_rendimento_pct")
    if limite is not None and rendimento_pct is not None and rendimento_pct < float(limite):
        saida.append({"tipo": "rendimento_baixo", "severidade": "alta",
                      "titulo": f"Rendimento das garrafas em {rendimento_pct:g}%",
                      "descricao": f"O mínimo que você definiu é {float(limite):g}%. Garrafa está terminando com menos dose vendida que o esperado: dose generosa, derramamento ou venda fora do sistema.",
                      "acao": "Ver desvio por garrafa"})
    for m in _margem_das_doses(estabelecimento_id, cfg.get("margem_alvo_dose_pct"))[:5]:
        saida.append({"tipo": "margem_dose_baixa", "severidade": "media", "produto_id": m["produto_id"],
                      "titulo": f"{m['produto']} ({m['dose']}): margem {m['margem_pct']:g}%",
                      "descricao": f"Abaixo da meta de {m['meta_pct']:g}%. O custo da garrafa pode ter subido.",
                      "acao": "Reajustar o preço da dose"})
    if resumo is not None and resumo["doses"] > 0 and resumo["garrafas_encerradas"] == 0:
        saida.append({"tipo": "sem_garrafa_encerrada", "severidade": "baixa",
                      "titulo": "Rendimento ainda não medido",
                      "descricao": "Nenhuma garrafa foi encerrada no período. Toque em \"Terminou a garrafa\" quando acabar uma para o sistema mostrar a diferença.",
                      "acao": "Encerrar garrafas"})
    return saida[:LIMITE_ALERTAS]
