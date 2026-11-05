"""Resumo Diário da Loja — montado direto do banco, sem texto livre de LLM.

Por que não é LLM: o resumo antigo recebia só 2 tópicos (o roteador cortava estoque),
afirmava "não há ruptura" com 15 itens abaixo do mínimo, e diante de mês zerado mandava
o lojista "verificar a sincronização". O dono da loja precisa de um resumo que nunca
contradiga a tela: cada frase aqui sai de uma consulta e diz o período a que se refere.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func

from app import db
from app.models import ContaPagar, Produto, Venda
from app.services.consultor.contextos._datas import fim, hoje_local, ini
from app.utils.timezone import to_local

# A partir de quantos dias sem venda registrada isso vira a prioridade do dia.
DIAS_SEM_VENDA_ALERTA = 2
MAX_ITENS_NOMEADOS = 3


def _brl(valor: float) -> str:
    s = f"{valor:,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def _qtd(valor: float) -> str:
    return str(int(valor)) if float(valor).is_integer() else f"{valor:.3f}".rstrip("0").replace(".", ",")


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def _vendas(est_id: int, dia_ini, dia_fim) -> tuple[int, float]:
    qtd, total = (
        db.session.query(func.count(Venda.id), func.coalesce(func.sum(Venda.total), 0))
        .filter(
            Venda.estabelecimento_id == est_id,
            Venda.status != "cancelada",
            Venda.data_venda >= ini(dia_ini),
            Venda.data_venda <= fim(dia_fim),
        )
        .one()
    )
    return int(qtd or 0), float(total or 0)


def montar_resumo_diario(est_id: int) -> dict[str, Any]:
    hoje = hoje_local()
    ontem = hoje - timedelta(days=1)
    mes_ini = hoje.replace(day=1)

    # ── Vendas ──────────────────────────────────────────────────────────────
    qtd_hoje, tot_hoje = _vendas(est_id, hoje, hoje)
    qtd_ontem, tot_ontem = _vendas(est_id, ontem, ontem)
    qtd_mes, tot_mes = _vendas(est_id, mes_ini, hoje)

    ultima = (
        db.session.query(func.max(Venda.data_venda))
        .filter(Venda.estabelecimento_id == est_id, Venda.status != "cancelada")
        .scalar()
    )
    ultima_dia = to_local(ultima).date() if ultima else None
    dias_sem_venda = (hoje - ultima_dia).days if ultima_dia else None

    partes = [
        f"Hoje: {_plural(qtd_hoje, 'venda', 'vendas')}, {_brl(tot_hoje)}.",
        f"Ontem: {_plural(qtd_ontem, 'venda', 'vendas')}, {_brl(tot_ontem)}.",
        f"Mês ({mes_ini:%d/%m} a {hoje:%d/%m}): {_plural(qtd_mes, 'venda', 'vendas')}, {_brl(tot_mes)}.",
    ]
    if ultima_dia is None:
        partes.append("Nenhuma venda registrada no sistema até agora.")
    elif dias_sem_venda and dias_sem_venda >= 1:
        partes.append(f"Última venda registrada em {ultima_dia:%d/%m/%Y}.")
    texto_vendas = " ".join(partes)

    # ── Estoque abaixo do mínimo (só produtos com mínimo definido) ─────────
    q_alerta = Produto.query.filter(
        Produto.estabelecimento_id == est_id,
        Produto.ativo.is_(True),
        Produto.quantidade_minima > 0,
        Produto.quantidade <= Produto.quantidade_minima,
    )
    total_alerta = q_alerta.count()
    zerados = q_alerta.filter(Produto.quantidade <= 0).count()
    criticos = q_alerta.order_by(
        (Produto.quantidade / Produto.quantidade_minima).asc(), Produto.nome.asc()
    ).limit(MAX_ITENS_NOMEADOS).all()

    if total_alerta == 0:
        texto_estoque = "Nenhum produto abaixo do estoque mínimo."
    else:
        nomes = ", ".join(
            f"{p.nome} ({_qtd(float(p.quantidade or 0))} de mín. {_qtd(float(p.quantidade_minima or 0))})"
            for p in criticos
        )
        texto_estoque = (
            f"{_plural(total_alerta, 'produto está', 'produtos estão')} no mínimo ou abaixo"
            + (f", {_plural(zerados, 'zerado', 'zerados')}" if zerados else "")
            + f". Mais críticos: {nomes}."
        )

    # ── Contas a pagar ──────────────────────────────────────────────────────
    valor_cp = func.coalesce(ContaPagar.valor_atual, ContaPagar.valor_original, 0)
    base_cp = db.session.query(func.count(ContaPagar.id), func.coalesce(func.sum(valor_cp), 0)).filter(
        ContaPagar.estabelecimento_id == est_id, ContaPagar.status == "aberto"
    )
    qtd_atras, tot_atras = base_cp.filter(ContaPagar.data_vencimento < hoje).one()
    qtd_venc, tot_venc = base_cp.filter(
        ContaPagar.data_vencimento >= hoje, ContaPagar.data_vencimento <= hoje + timedelta(days=7)
    ).one()
    qtd_atras, tot_atras = int(qtd_atras or 0), float(tot_atras or 0)
    qtd_venc, tot_venc = int(qtd_venc or 0), float(tot_venc or 0)

    if qtd_atras == 0 and qtd_venc == 0:
        texto_contas = "Nenhuma conta a pagar atrasada nem vencendo nos próximos 7 dias."
    else:
        frases = []
        if qtd_atras:
            frases.append(f"{_plural(qtd_atras, 'conta atrasada', 'contas atrasadas')} ({_brl(tot_atras)})")
        if qtd_venc:
            frases.append(f"{_plural(qtd_venc, 'conta vence', 'contas vencem')} em até 7 dias ({_brl(tot_venc)})")
        texto_contas = "; ".join(frases) + "."

    # ── Prioridade do dia: uma só, por regra fixa ──────────────────────────
    if ultima_dia is None or (dias_sem_venda is not None and dias_sem_venda >= DIAS_SEM_VENDA_ALERTA):
        desde = f"desde {ultima_dia:%d/%m}" if ultima_dia else "até agora"
        prioridade = {
            "tipo": "risco",
            "texto": (
                f"Nenhuma venda registrada {desde}. Passe todas as vendas pelo PDV: "
                "sem isso o estoque, o caixa e estes relatórios ficam errados."
            ),
            "rota": "/pdv",
            "rotulo": "Abrir o PDV",
        }
    elif qtd_atras:
        prioridade = {
            "tipo": "risco",
            "texto": f"Quitar ou renegociar {_plural(qtd_atras, 'conta atrasada', 'contas atrasadas')} ({_brl(tot_atras)}).",
            "rota": "/expenses",
            "rotulo": "Ver contas",
        }
    elif zerados:
        prioridade = {
            "tipo": "risco",
            "texto": f"Repor {_plural(zerados, 'produto zerado', 'produtos zerados')}: sem estoque não há venda.",
            "rota": "/products",
            "rotulo": "Ver produtos",
        }
    elif total_alerta:
        prioridade = {
            "tipo": "oportunidade",
            "texto": f"Programar a reposição de {_plural(total_alerta, 'produto', 'produtos')} no mínimo.",
            "rota": "/products",
            "rotulo": "Ver produtos",
        }
    else:
        prioridade = {"tipo": "ok", "texto": "Nada urgente. Bom dia de vendas!", "rota": None, "rotulo": None}

    itens = [
        {"chave": "vendas", "titulo": "Vendas", "tipo": "info", "texto": texto_vendas},
        {"chave": "estoque", "titulo": "Estoque", "tipo": "alerta" if total_alerta else "ok", "texto": texto_estoque},
        {"chave": "contas", "titulo": "Contas a pagar", "tipo": "alerta" if qtd_atras else "ok", "texto": texto_contas},
    ]

    resumo_texto = "\n".join(
        [f"**{i['titulo']}:** {i['texto']}" for i in itens] + [f"**Prioridade de hoje:** {prioridade['texto']}"]
    )

    return {
        "data": hoje.isoformat(),
        "itens": itens,
        "prioridade": prioridade,
        "resumo": resumo_texto,
        "numeros": {
            "vendas_hoje": {"qtd": qtd_hoje, "total": round(tot_hoje, 2)},
            "vendas_ontem": {"qtd": qtd_ontem, "total": round(tot_ontem, 2)},
            "vendas_mes": {"qtd": qtd_mes, "total": round(tot_mes, 2)},
            "ultima_venda": ultima_dia.isoformat() if ultima_dia else None,
            "produtos_abaixo_minimo": total_alerta,
            "produtos_zerados": zerados,
            "contas_atrasadas": {"qtd": qtd_atras, "total": round(tot_atras, 2)},
            "contas_vencendo_7d": {"qtd": qtd_venc, "total": round(tot_venc, 2)},
        },
    }
