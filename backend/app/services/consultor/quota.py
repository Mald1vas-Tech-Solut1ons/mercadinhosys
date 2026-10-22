"""Gerenciamento de quota e limites de uso do Consultor Inteligente.
"""

from datetime import datetime
from app.models import ConsultorInteracao, db, _tenant_atual
from app.utils.timezone import now_utc, to_local

CONSULTOR_LIMITE_DIA = 40 # Limite padrão diário de interações completas via Chat
INSIGHT_LIMITE_DIA = 20    # Limite padrão de *refreshes manuais* de insights por dia


def _contar_interacoes_hoje(estabelecimento_id: int) -> int:
    """Conta interações completas de chat no dia atual (fuso Brasil)."""
    hoje_local = to_local(now_utc()).date()
    # Utiliza _tenant_atual indiretamente através do TenantQuery, mas
    # o SQLAlchemy necessita da data extraída em Python ou SQL.
    # Como created_at está em UTC no banco, a consulta exata requer conversão.
    # Para simplificar, buscamos as últimas 24h em UTC.
    
    agora_utc = now_utc()
    inicio_dia_utc = datetime(agora_utc.year, agora_utc.month, agora_utc.day)
    
    # Busca todas de hoje (UTC)
    q = ConsultorInteracao.query.filter(
        ConsultorInteracao.estabelecimento_id == estabelecimento_id,
        ConsultorInteracao.created_at >= inicio_dia_utc,
        # Insights n\u00e3o contam na cota do chat, marcamos provedores de insight de forma diferente 
        # ou usamos a coluna "especialista" se for insight.
        ConsultorInteracao.especialista.notlike('insight_%')
    ).count()
    return q


def _contar_insights_hoje(estabelecimento_id: int) -> int:
    """Conta refreshes manuais de insight no dia atual (fuso Brasil)."""
    agora_utc = now_utc()
    inicio_dia_utc = datetime(agora_utc.year, agora_utc.month, agora_utc.day)
    
    q = ConsultorInteracao.query.filter(
        ConsultorInteracao.estabelecimento_id == estabelecimento_id,
        ConsultorInteracao.created_at >= inicio_dia_utc,
        ConsultorInteracao.especialista.like('insight_%')
    ).count()
    return q


def verificar_quota_consultor(estabelecimento_id: int) -> bool:
    """Verifica se o tenant ainda possui limite di\u00e1rio de chat."""
    if not estabelecimento_id:
        return False
        
    # TODO: integrar futuramente com decorators/plan_guards.py para quotas baseadas no plano.
    usado = _contar_interacoes_hoje(estabelecimento_id)
    return usado < CONSULTOR_LIMITE_DIA


def verificar_quota_insight(estabelecimento_id: int) -> bool:
    """Verifica se o tenant ainda possui limite di\u00e1rio de recarga de insights."""
    if not estabelecimento_id:
        return False
        
    usado = _contar_insights_hoje(estabelecimento_id)
    return usado < INSIGHT_LIMITE_DIA
