from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import func
from app import db
from app.models import Venda, VendaItem, Pagamento, Produto
from app.services.consultor.contextos._datas import hoje_local, ini, fim

def montar_contexto(estabelecimento_id: int, is_manager: bool = True) -> dict:
    """Monta o contexto de vendas para o consultor IA.
    Se is_manager=False, oculta dados financeiros agregados.
    """
    hoje = hoje_local()
    ontem = hoje - timedelta(days=1)
    semana_inicio = hoje - timedelta(days=6)
    mes_atual_inicio = hoje.replace(day=1)
    
    if hoje.month == 1:
        mes_anterior_inicio = hoje.replace(year=hoje.year-1, month=12, day=1)
    else:
        mes_anterior_inicio = hoje.replace(month=hoje.month-1, day=1)
    mes_anterior_fim = mes_atual_inicio - timedelta(days=1)

    contexto = {}

    def get_vendas_stats(dia_ini, dia_fim):
        q = db.session.query(
            func.count(Venda.id).label("qtd"),
            func.sum(Venda.total).label("total")
        ).filter(
            Venda.status != 'cancelada',
            Venda.data_venda >= ini(dia_ini),
            Venda.data_venda <= fim(dia_fim)
        )
        if estabelecimento_id != 'all':
            q = q.filter(Venda.estabelecimento_id == estabelecimento_id)
        res = q.first()
        qtd = int(res.qtd or 0)
        total = float(res.total or 0.0)
        tm = round(total / qtd, 2) if qtd > 0 else 0.0
        
        if not is_manager:
            return {"qtd": qtd, "faturamento": "Restrito", "ticket_medio": "Restrito"}
            
        return {"qtd": qtd, "faturamento": round(total, 2), "ticket_medio": tm}

    # 1. Faturamento e Ticket Médio
    contexto["hoje"] = get_vendas_stats(hoje, hoje)
    contexto["ontem"] = get_vendas_stats(ontem, ontem)
    contexto["semana"] = get_vendas_stats(semana_inicio, hoje)
    # Comparações que a IA usa para explicar o "porquê": mesma janela na semana
    # anterior e o mesmo dia da semana na semana passada.
    contexto["semana_anterior"] = get_vendas_stats(semana_inicio - timedelta(days=7), semana_inicio - timedelta(days=1))
    contexto["mesmo_dia_semana_anterior"] = get_vendas_stats(hoje - timedelta(days=7), hoje - timedelta(days=7))
    contexto["mes_atual"] = get_vendas_stats(mes_atual_inicio, hoje)
    contexto["mes_anterior"] = get_vendas_stats(mes_anterior_inicio, mes_anterior_fim)

    # 2. Formas de Pagamento (%) no Mês Atual
    q_pagamentos = db.session.query(
        Pagamento.forma_pagamento,
        func.sum(Pagamento.valor).label("total")
    ).join(Venda).filter(
        Venda.status != 'cancelada',
        Venda.data_venda >= ini(mes_atual_inicio),
        Venda.data_venda <= fim(hoje)
    )
    if estabelecimento_id != 'all':
        q_pagamentos = q_pagamentos.filter(Venda.estabelecimento_id == estabelecimento_id)
        
    pagamentos_agrupados = q_pagamentos.group_by(Pagamento.forma_pagamento).all()
    total_pagamentos = sum(float(p.total or 0) for p in pagamentos_agrupados)
    
    contexto["formas_pagamento_mes_atual"] = [
        {
            "forma": p.forma_pagamento or "Desconhecida",
            "valor": float(p.total or 0),
            "percentual": round((float(p.total or 0) / total_pagamentos * 100), 1) if total_pagamentos > 0 else 0.0
        }
        for p in pagamentos_agrupados
    ]

    # 3. Top 10 Produtos Vendidos no Mês Atual
    q_top_produtos = db.session.query(
        Produto.nome,
        func.sum(VendaItem.quantidade).label("qtd_vendida"),
        func.sum(VendaItem.total_item).label("valor_total")
    ).join(VendaItem.produto).join(VendaItem.venda).filter(
        Venda.status != 'cancelada',
        Venda.data_venda >= ini(mes_atual_inicio),
        Venda.data_venda <= fim(hoje)
    )
    if estabelecimento_id != 'all':
        q_top_produtos = q_top_produtos.filter(Venda.estabelecimento_id == estabelecimento_id)
        
    top_produtos = q_top_produtos.group_by(Produto.nome).order_by(func.sum(VendaItem.total_item).desc()).limit(10).all()
    contexto["top_10_produtos_vendidos_mes_atual"] = [
        {
            "produto": p.nome,
            "quantidade": float(p.qtd_vendida or 0),
            "valor_total": float(p.valor_total or 0) if is_manager else "Restrito"
        }
        for p in top_produtos
    ]

    # 4. Cancelamentos (Mês Atual)
    q_canceladas = db.session.query(
        func.count(Venda.id).label("qtd"),
        func.sum(Venda.total).label("total")
    ).filter(
        Venda.status == 'cancelada',
        Venda.data_venda >= ini(mes_atual_inicio),
        Venda.data_venda <= fim(hoje)
    )
    if estabelecimento_id != 'all':
        q_canceladas = q_canceladas.filter(Venda.estabelecimento_id == estabelecimento_id)
    
    res_canc = q_canceladas.first()
    contexto["vendas_canceladas_mes_atual"] = {
        "qtd": int(res_canc.qtd or 0),
        "total": float(res_canc.total or 0.0) if is_manager else "Restrito"
    }

    # 5. Fiado em aberto (Contas a Receber)
    from app.models import ContaReceber
    q_fiado = db.session.query(func.sum(ContaReceber.valor_atual)).filter(
        ContaReceber.status == 'aberto'
    )
    if estabelecimento_id != 'all':
        q_fiado = q_fiado.filter(ContaReceber.estabelecimento_id == estabelecimento_id)
        
    contexto["fiado_em_aberto"] = float(q_fiado.scalar() or 0.0)

    return contexto
