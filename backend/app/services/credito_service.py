"""Crédito do cliente: score pelo comportamento de pagamento e bloqueio por atraso.

O score (0 a 1000) sai dos títulos a receber do próprio cliente, não de um valor
fixo: pontualidade dos pagos, atraso médio, títulos vencidos em aberto e tempo de
relacionamento. Cada componente é devolvido para a decisão ser explicável.
Cliente sem histórico fica em 500 (neutro) e nunca é tratado como "bom pagador"
só por ainda não ter devido.
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import func

from app.models import ContaReceber

# Dias de atraso tolerados antes de bloquear nova venda a prazo.
DIAS_TOLERANCIA_ATRASO = 5
SCORE_NEUTRO = 500


def _hoje(hoje=None) -> date:
    return hoje or date.today()


def titulos_vencidos(cliente, hoje=None, tolerancia=DIAS_TOLERANCIA_ATRASO):
    """Títulos em aberto, com saldo, vencidos além da tolerância."""
    limite = _hoje(hoje).toordinal() - tolerancia
    abertos = ContaReceber.query.filter(
        ContaReceber.cliente_id == cliente.id,
        ContaReceber.estabelecimento_id == cliente.estabelecimento_id,
        ContaReceber.status == 'aberto',
        ContaReceber.valor_atual > 0,
    ).all()
    return [t for t in abertos if t.data_vencimento and t.data_vencimento.toordinal() < limite]


def validar_sem_atraso(cliente, hoje=None):
    """Recusa venda a prazo para cliente com título vencido além da tolerância."""
    vencidos = titulos_vencidos(cliente, hoje)
    if vencidos:
        total = sum((Decimal(str(t.valor_atual)) for t in vencidos), Decimal('0'))
        mais_antigo = min(t.data_vencimento for t in vencidos)
        dias = (_hoje(hoje) - mais_antigo).days
        raise ValueError(
            f'Cliente com {len(vencidos)} título(s) vencido(s), R$ {total:.2f}, o mais antigo há {dias} dias. '
            f'Regularize o atraso antes de vender a prazo; pagamento à vista é permitido.')


def calcular_score(cliente, hoje=None) -> dict:
    """Score de crédito explicável a partir dos títulos do cliente (sem gravar)."""
    hoje = _hoje(hoje)
    titulos = ContaReceber.query.filter(
        ContaReceber.cliente_id == cliente.id,
        ContaReceber.estabelecimento_id == cliente.estabelecimento_id,
        ContaReceber.status.in_(['aberto', 'pago']),
    ).all()
    pagos = [t for t in titulos if t.status == 'pago' and t.data_recebimento and t.data_vencimento]
    pontuais = sum(1 for t in pagos if t.data_recebimento <= t.data_vencimento)
    atrasos = [max(0, (t.data_recebimento - t.data_vencimento).days) for t in pagos]
    vencidos_abertos = [t for t in titulos if t.status == 'aberto' and Decimal(str(t.valor_atual or 0)) > 0
                        and t.data_vencimento and t.data_vencimento < hoje]
    atrasos += [(hoje - t.data_vencimento).days for t in vencidos_abertos]
    atraso_medio = (sum(atrasos) / len(atrasos)) if atrasos else 0.0
    maior_atraso = max((hoje - t.data_vencimento).days for t in vencidos_abertos) if vencidos_abertos else 0
    tem_historico = bool(pagos or vencidos_abertos)

    if not tem_historico:
        score = SCORE_NEUTRO
        componentes = {'historico': 'sem histórico de pagamento; score neutro'}
    else:
        pontualidade = (pontuais / len(pagos)) if pagos else 0.0
        componentes = {
            'base': SCORE_NEUTRO,
            'pontualidade': round(300 * pontualidade),
            'atraso_medio': -round(min(atraso_medio * 5, 200)),
            'vencidos_em_aberto': -150 * min(len(vencidos_abertos), 3),
            'relacionamento': 5 * min(len(pagos), 20),
        }
        score = max(0, min(1000, sum(componentes.values())))

    if vencidos_abertos and (score < 400 or maior_atraso > 60):
        risco = 'ALTO'
    elif vencidos_abertos or score < 700 and tem_historico:
        risco = 'MEDIO'
    else:
        risco = 'BAIXO'
    return {
        'score': int(score),
        'risco': risco,
        'bom_pagador': (not vencidos_abertos) and tem_historico and score >= 600,
        'atraso_medio_dias': round(atraso_medio, 1),
        'titulos_pagos': len(pagos),
        'titulos_vencidos_em_aberto': len(vencidos_abertos),
        'maior_atraso_dias': maior_atraso,
        'componentes': componentes,
    }


def recalcular_credito(cliente, hoje=None) -> dict:
    """Calcula e grava score, risco e atraso médio no cliente (o commit é do chamador)."""
    resultado = calcular_score(cliente, hoje)
    cliente.score_credito = resultado['score']
    cliente.risco_inadimplencia = resultado['risco']
    cliente.bom_pagador = resultado['bom_pagador']
    cliente.atraso_medio_dias = resultado['atraso_medio_dias']
    return resultado
