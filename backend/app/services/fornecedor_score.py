"""Pontuação de fornecedor a partir do que de fato aconteceu nos recebimentos.

Regras (cada uma corrige um erro da versão anterior):
- Pontualidade só considera pedido com data de recebimento registrada. Antes, pedido sem data
  usava a data do próprio pedido como recebimento e contava como "no prazo".
- Recebimento parcial não é entrega concluída: só entra na conta se o prazo prometido já
  venceu (conta como atraso até hoje). Antes contava como entregue no prazo.
- Fill rate: quantidade aproveitável (recebida menos avariada) sobre a solicitada, nos pedidos
  encerrados. Faltas e avarias passam a pesar na nota.
- Amostra mínima: com menos de MIN_AMOSTRA entregas avaliadas a nota é neutra e marcada como
  não confiável; classificação não muda. Antes, fornecedor novo saía com 80+ pontos.
- Atraso médio é a média dos pedidos atrasados (antes dividia pelo total, diluindo o atraso).
- Prazo de pagamento é a média dos títulos (antes usava o maior prazo, que um título isolado
  inflava).
- O cálculo é puro: calcular_metricas() não grava nada; quem grava é aplicar_metricas().
"""
import re
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func

from app.models import ContaPagar, MovimentacaoEstoque, PedidoCompra, Produto, db

MIN_AMOSTRA = 3
SCORE_NEUTRO = 70
STATUS_ENCERRADOS = ("concluido", "recebido")
STATUS_PARCIAL = ("parcial",)
STATUS_EFETIVADOS = STATUS_ENCERRADOS + STATUS_PARCIAL

PESOS = {"pontualidade": 0.40, "atraso": 0.15, "fill_rate": 0.25, "comercial": 0.20}


def _dec(valor) -> Decimal:
    return Decimal(str(valor if valor is not None else 0))


def _data(valor):
    if isinstance(valor, datetime):
        return valor.date()
    return valor


def avaliar_entregas(pedidos, prazo_padrao_dias, hoje=None) -> dict:
    """Pontualidade, atraso e fill rate de uma lista de pedidos de compra."""
    hoje = hoje or date.today()
    avaliadas = no_prazo = sem_data_recebimento = 0
    atrasos = []
    solicitado = utilizavel = avariado = Decimal("0")
    for pedido in pedidos:
        if pedido.status not in STATUS_EFETIVADOS:
            continue
        data_pedido = _data(pedido.data_pedido)
        previsao = _data(pedido.data_previsao_entrega)
        if previsao is None and data_pedido is not None:
            previsao = data_pedido + timedelta(days=int(prazo_padrao_dias or 7))
        if previsao is None:
            continue

        if pedido.status in STATUS_ENCERRADOS:
            recebimento = _data(pedido.data_recebimento)
            if recebimento is None:
                sem_data_recebimento += 1
                continue
            dias = (recebimento - previsao).days
            for item in pedido.itens or []:
                solicitado += _dec(item.quantidade_solicitada)
                avaria = _dec(item.quantidade_avariada)
                avariado += avaria
                utilizavel += max(Decimal("0"), _dec(item.quantidade_recebida) - avaria)
        else:
            if previsao >= hoje:
                continue  # ainda dentro do prazo prometido
            dias = (hoje - previsao).days

        avaliadas += 1
        if dias <= 0:
            no_prazo += 1
        else:
            atrasos.append(dias)

    return {
        "amostra": avaliadas,
        "no_prazo": no_prazo,
        "sem_data_recebimento": sem_data_recebimento,
        "percentual_no_prazo": (no_prazo / avaliadas * 100) if avaliadas else None,
        "atraso_medio_dias": (sum(atrasos) / len(atrasos)) if atrasos else 0.0,
        "fill_rate": float(utilizavel / solicitado * 100) if solicitado > 0 else None,
        "taxa_avaria": float(avariado / solicitado * 100) if solicitado > 0 else None,
    }


def desconto_medio(pedidos) -> float:
    """Desconto efetivo (itens + global) sobre o valor bruto, em %."""
    bruto_total = desconto_total = Decimal("0")
    for pedido in pedidos:
        if pedido.status not in STATUS_EFETIVADOS:
            continue
        bruto = desconto = Decimal("0")
        for item in pedido.itens or []:
            valor = _dec(item.quantidade_solicitada) * _dec(item.preco_unitario)
            bruto += valor
            desconto += valor * _dec(item.desconto_percentual) / Decimal("100")
        if bruto == 0:
            bruto = _dec(pedido.subtotal) + _dec(pedido.desconto)
        bruto_total += bruto
        desconto_total += desconto + _dec(pedido.desconto)
    return float(desconto_total / bruto_total * 100) if bruto_total > 0 else 0.0


def prazo_pagamento_medio(fornecedor) -> float:
    prazos = [(t.data_vencimento - t.data_emissao).days
              for t in ContaPagar.query.filter_by(fornecedor_id=fornecedor.id,
                                                  estabelecimento_id=fornecedor.estabelecimento_id).all()
              if t.data_emissao and t.data_vencimento]
    if prazos:
        return sum(prazos) / len(prazos)
    numeros = [int(n) for n in re.findall(r"\d+", str(fornecedor.forma_pagamento or ""))]
    return float(max(numeros)) if numeros else 0.0


def calcular_score(entregas: dict, desconto_pct: float, prazo_pagamento: float, valor_total: float) -> dict:
    """Nota 0-100. Abaixo da amostra mínima devolve nota neutra, não confiável, sem classificação."""
    if entregas["amostra"] < MIN_AMOSTRA:
        return {"score": SCORE_NEUTRO, "confiavel": False, "classificacao": None, "componentes": {}}
    pontualidade = entregas["percentual_no_prazo"]
    atraso = 100 - min(100.0, entregas["atraso_medio_dias"] * 10)
    fill_rate = entregas["fill_rate"] if entregas["fill_rate"] is not None else pontualidade
    comercial = min(prazo_pagamento / 60.0, 1.0) * 50 + min(max(desconto_pct, 0) / 10.0, 1.0) * 50
    componentes = {"pontualidade": pontualidade, "atraso": atraso, "fill_rate": fill_rate, "comercial": comercial}
    score = int(round(max(0.0, min(100.0, sum(PESOS[k] * v for k, v in componentes.items())))))
    if score >= 85 and valor_total > 50000:
        classificacao = "PREMIUM"
    elif score >= 75:
        classificacao = "A"
    elif score >= 50:
        classificacao = "B"
    else:
        classificacao = "C"
    return {"score": score, "confiavel": True, "classificacao": classificacao,
            "componentes": {k: round(v, 1) for k, v in componentes.items()}}


def calcular_metricas(fornecedor, hoje=None) -> dict:
    """Todas as métricas do fornecedor, sem gravar nada."""
    pedidos = PedidoCompra.query.filter(
        PedidoCompra.fornecedor_id == fornecedor.id,
        PedidoCompra.estabelecimento_id == fornecedor.estabelecimento_id,
        PedidoCompra.status.in_(STATUS_EFETIVADOS),
    ).all()
    valor_total = float(sum(_dec(p.total) for p in pedidos))
    if valor_total == 0:
        # Sem pedido de compra, as entradas manuais de estoque são a única evidência de compra.
        entradas = db.session.query(func.sum(MovimentacaoEstoque.valor_total)).join(Produto).filter(
            MovimentacaoEstoque.tipo == "entrada",
            MovimentacaoEstoque.venda_id.is_(None),  # estorno de venda não é compra
            Produto.fornecedor_id == fornecedor.id,
            MovimentacaoEstoque.estabelecimento_id == fornecedor.estabelecimento_id,
        ).scalar()
        valor_total = float(entradas or 0)

    entregas = avaliar_entregas(pedidos, fornecedor.prazo_entrega, hoje)
    desconto_pct = desconto_medio(pedidos)
    prazo_pagamento = prazo_pagamento_medio(fornecedor)
    nota = calcular_score(entregas, desconto_pct, prazo_pagamento, valor_total)
    return {"total_compras": len(pedidos), "valor_total_comprado": valor_total, "entregas": entregas,
            "desconto_medio_percentual": desconto_pct, "prazo_pagamento_medio_dias": prazo_pagamento, **nota}


def aplicar_metricas(fornecedor, metricas: dict) -> None:
    """Grava as métricas calculadas no cadastro (só chamar em fluxo de escrita, nunca em GET)."""
    entregas = metricas["entregas"]
    fornecedor.total_compras = metricas["total_compras"]
    fornecedor.valor_total_comprado = metricas["valor_total_comprado"]
    fornecedor.percentual_entregas_no_prazo = entregas["percentual_no_prazo"] if entregas["amostra"] else 100.0
    fornecedor.atraso_medio_dias = entregas["atraso_medio_dias"]
    fornecedor.desconto_medio_percentual = metricas["desconto_medio_percentual"]
    fornecedor.prazo_pagamento_medio_dias = metricas["prazo_pagamento_medio_dias"]
    fornecedor.score_geral = metricas["score"]
    if metricas["classificacao"]:
        fornecedor.classificacao = metricas["classificacao"]
