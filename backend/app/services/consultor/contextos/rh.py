from datetime import datetime, timedelta
from app.services.rh_calculator_service import calcular_custo_folha_detalhado
from app.models import Funcionario, JustificativaPonto, Rescisao, Venda, RegistroPonto
from app import db
from sqlalchemy import func
from app.services.consultor.contextos._datas import hoje_local, ini, fim

def montar_contexto(estabelecimento_id: int, is_manager: bool = True) -> dict:
    """Monta o contexto de RH para o consultor IA."""
    agora = datetime.now()
    hoje = hoje_local()
    mes_atual_inicio = hoje.replace(day=1)
    
    if hoje.month == 1:
        mes_anterior_inicio = hoje.replace(year=hoje.year-1, month=12, day=1)
    else:
        mes_anterior_inicio = hoje.replace(month=hoje.month-1, day=1)
    mes_anterior_fim = mes_atual_inicio - timedelta(days=1)

    contexto = {}

    try:
        folha_atual = calcular_custo_folha_detalhado(estabelecimento_id, mes_atual_inicio, hoje)
        folha_anterior = calcular_custo_folha_detalhado(estabelecimento_id, mes_anterior_inicio, mes_anterior_fim)
    except Exception:
        folha_atual = {}
        folha_anterior = {}

    custo_total_atual = float(folha_atual.get("custo_folha", {}).get("custo_real_total", 0.0))
    custo_total_anterior = float(folha_anterior.get("custo_folha", {}).get("custo_real_total", 0.0))
    
    contexto["custo_folha"] = {
        "mes_atual": custo_total_atual,
        "mes_anterior": custo_total_anterior
    }

    # % sobre faturamento (Receita)
    q_vendas = db.session.query(func.sum(Venda.total)).filter(
        Venda.status != 'cancelada',
        Venda.data_venda >= ini(mes_atual_inicio),
        Venda.data_venda <= fim(hoje)
    )
    if estabelecimento_id != 'all':
        q_vendas = q_vendas.filter(Venda.estabelecimento_id == estabelecimento_id)
        
    receita_mes_atual = float(q_vendas.scalar() or 0.0)
    contexto["receita_mes_atual"] = receita_mes_atual
    
    if receita_mes_atual > 0:
        contexto["custo_folha_percentual_faturamento"] = round((custo_total_atual / receita_mes_atual) * 100, 2)
    else:
        contexto["custo_folha_percentual_faturamento"] = 0.0

    # Nomes reais dos funcionários e listar horas extras/atrasos do mês
    detalhes_funcionarios = folha_atual.get("detalhamento_funcionarios", [])
    funcionarios_detalhes = []
    
    for f in detalhes_funcionarios:
        func_id = f.get("funcionario_id", 0)
        funcionario_db = db.session.query(Funcionario).get(func_id)
        nome = funcionario_db.nome if funcionario_db else f"ID {func_id}"
        funcionarios_detalhes.append({
            "nome": nome,
            "horas_extras_valor": f.get("horas_extras", 0.0),
            "atrasos_descontos": f.get("atrasos_faltas", 0.0),
            "custo_real": f.get("custo_real", 0.0)
        })
    
    contexto["funcionarios_desempenho_mes"] = funcionarios_detalhes

    # Quem bateu ponto hoje (Registros de Ponto do dia atual)
    q_pontos = db.session.query(RegistroPonto).filter(RegistroPonto.data == hoje)
    if estabelecimento_id != 'all':
        q_pontos = q_pontos.filter(RegistroPonto.estabelecimento_id == estabelecimento_id)
    
    pontos_hoje = q_pontos.all()
    lista_pontos_hoje = []
    for p in pontos_hoje:
        funcionario_db = db.session.query(Funcionario).get(p.funcionario_id)
        nome = funcionario_db.nome if funcionario_db else f"ID {p.funcionario_id}"
        lista_pontos_hoje.append({
            "nome": nome,
            "hora": p.hora.strftime('%H:%M:%S') if p.hora else "",
            "tipo": p.tipo_registro,
            "atraso_minutos": p.minutos_atraso or 0
        })
    
    contexto["pontos_batidos_hoje"] = lista_pontos_hoje

    # Faltas e Justificativas pendentes
    q_just = db.session.query(func.count(JustificativaPonto.id)).filter(
        JustificativaPonto.status == 'pendente'
    )
    if estabelecimento_id != 'all':
        q_just = q_just.filter(JustificativaPonto.estabelecimento_id == estabelecimento_id)
    
    contexto["justificativas_ponto_pendentes"] = q_just.scalar() or 0

    # Custo estimado de rescisão acumulado
    # Seriam os custos na tabela de ProvisaoTrabalhista + total_liquido de Rescisao
    q_rescisao = db.session.query(func.sum(Rescisao.total_liquido)).filter(
        Rescisao.data_demissao >= mes_atual_inicio,
        Rescisao.data_demissao <= hoje
    )
    if estabelecimento_id != 'all':
        q_rescisao = q_rescisao.filter(Rescisao.estabelecimento_id == estabelecimento_id)
    
    contexto["custo_rescisao_pago_mes_atual"] = float(q_rescisao.scalar() or 0.0)

    return contexto
