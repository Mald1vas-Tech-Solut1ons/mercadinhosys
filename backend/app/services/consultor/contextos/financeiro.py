from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import func
from app import db
from app.models import Despesa, ContaPagar, Venda
from app.services.rh_calculator_service import calcular_custo_folha_detalhado
from app.utils.financeiro_constants import sem_categorias_integradas
from app.services.consultor.contextos._datas import hoje_local, ini, fim
from app.utils.timezone import iso_utc


def _sem_categorias_integradas(query):
    return sem_categorias_integradas(query, Despesa.categoria)

def montar_contexto(estabelecimento_id: int, is_manager: bool = True) -> dict:
    """Monta o contexto financeiro para o consultor IA.
    Retorna apenas dados puros e determinísticos.
    """
    hoje = hoje_local()
    mes_atual_inicio = hoje.replace(day=1)
    
    # Mês anterior
    if hoje.month == 1:
        mes_anterior_inicio = hoje.replace(year=hoje.year-1, month=12, day=1)
    else:
        mes_anterior_inicio = hoje.replace(month=hoje.month-1, day=1)
    mes_anterior_fim = mes_atual_inicio - timedelta(days=1)
    
    # Sete dias para frente
    daqui_7_dias = hoje + timedelta(days=7)

    # 1. Receita (Vendas) do mês atual
    q_vendas = db.session.query(func.sum(Venda.total)).filter(
        Venda.status != 'cancelada',
        Venda.data_venda >= ini(mes_atual_inicio),
        Venda.data_venda <= fim(hoje)
    )
    if estabelecimento_id != 'all':
        q_vendas = q_vendas.filter(Venda.estabelecimento_id == estabelecimento_id)
    receita_mes_atual = float(q_vendas.scalar() or 0.0)

    # 2. Despesas (Gerais)
    def desp_query(inicio, fim):
        q = db.session.query(func.sum(Despesa.valor)).filter(
            Despesa.data_despesa >= inicio,
            Despesa.data_despesa <= fim
        )
        if estabelecimento_id != 'all':
            q = q.filter(Despesa.estabelecimento_id == estabelecimento_id)
        return _sem_categorias_integradas(q).scalar() or 0.0

    desp_mes_atual = float(desp_query(mes_atual_inicio, hoje))
    desp_mes_anterior = float(desp_query(mes_anterior_inicio, mes_anterior_fim))

    # 3. Contas a Pagar (Boletos pagos)
    def cp_query(inicio, fim):
        q = db.session.query(func.sum(ContaPagar.valor_pago)).filter(
            ContaPagar.status.in_(['pago', 'parcial']),
            ContaPagar.data_pagamento >= inicio,
            ContaPagar.data_pagamento <= fim
        )
        if estabelecimento_id != 'all':
            q = q.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
        return q.scalar() or 0.0

    cp_mes_atual = float(cp_query(mes_atual_inicio, hoje))
    cp_mes_anterior = float(cp_query(mes_anterior_inicio, mes_anterior_fim))

    # 4. Folha de Pagamento
    try:
        folha_atual_dict = calcular_custo_folha_detalhado(estabelecimento_id, mes_atual_inicio, hoje)
        folha_mes_atual = float(folha_atual_dict.get("custo_folha", {}).get("custo_real_total", 0.0))
        
        folha_anterior_dict = calcular_custo_folha_detalhado(estabelecimento_id, mes_anterior_inicio, mes_anterior_fim)
        folha_mes_anterior = float(folha_anterior_dict.get("custo_folha", {}).get("custo_real_total", 0.0))
    except Exception:
        folha_mes_atual = 0.0
        folha_mes_anterior = 0.0

    total_despesas_mes_atual = desp_mes_atual + cp_mes_atual + folha_mes_atual
    total_despesas_mes_anterior = desp_mes_anterior + cp_mes_anterior + folha_mes_anterior

    # 5. Top 5 Categorias (Mês atual)
    q_cats = db.session.query(
        Despesa.categoria,
        func.sum(Despesa.valor).label("total")
    ).filter(
        Despesa.data_despesa >= mes_atual_inicio,
        Despesa.data_despesa <= hoje
    )
    if estabelecimento_id != 'all':
        q_cats = q_cats.filter(Despesa.estabelecimento_id == estabelecimento_id)
    q_cats = _sem_categorias_integradas(q_cats)
    categorias = q_cats.group_by(Despesa.categoria).order_by(func.sum(Despesa.valor).desc()).limit(5).all()
    
    top_categorias = [{"categoria": c[0] or "Sem categoria", "total": float(c[1])} for c in categorias]

    # 6. Boletos Vencidos / A Vencer (Próximos 7 dias)
    q_boletos = db.session.query(ContaPagar).filter(
        ContaPagar.status == 'aberto',
        ContaPagar.data_vencimento <= daqui_7_dias
    )
    if estabelecimento_id != 'all':
        q_boletos = q_boletos.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
    
    boletos_pendentes = []
    total_boletos_atrasados = 0.0
    for cp in q_boletos.all():
        fornecedor_nome = cp.fornecedor.nome_fantasia or cp.fornecedor.razao_social if cp.fornecedor else "Desconhecido"
        valor = float(cp.valor_atual if cp.valor_atual else (cp.valor_original or 0))
        atrasado = cp.data_vencimento < hoje
        if atrasado:
            total_boletos_atrasados += valor
        boletos_pendentes.append({
            "fornecedor": fornecedor_nome,
            "valor": valor,
            "vencimento": iso_utc(cp.data_vencimento) if cp.data_vencimento else None,
            "status": "atrasado" if atrasado else "a_vencer"
        })

    # Total Boletos Atrasados conta na despesa de hoje
    total_despesas_mes_atual += total_boletos_atrasados

    # Resultado (Receita - Despesa)
    resultado = receita_mes_atual - total_despesas_mes_atual

    return {
        "periodo": "mes_atual",
        "mes_atual_inicio": iso_utc(mes_atual_inicio),
        "hoje": iso_utc(hoje),
        "receita_mes_atual": round(receita_mes_atual, 2),
        "total_despesas_mes_atual": round(total_despesas_mes_atual, 2),
        "total_despesas_mes_anterior": round(total_despesas_mes_anterior, 2),
        "resultado_mes_atual": round(resultado, 2),
        "custo_folha_mes_atual": round(folha_mes_atual, 2),
        "total_boletos_atrasados": round(total_boletos_atrasados, 2),
        "top_5_categorias": top_categorias,
        "boletos_pendentes_7d": boletos_pendentes,
    }
