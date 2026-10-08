from datetime import timezone
"""
MÓDULO DE INTELIGÊNCIA DE NEGÓCIOS - RELATÓRIOS AVANÇADOS
Sistema de análise preditiva e business intelligence para MercadinhoSys

FEATURES IMPLEMENTADAS:
- Análise RFM (Recency, Frequency, Monetary) com segmentação de clientes
- Análise ABC de produtos com rentabilidade e CMP
- Previsão de esgotamento de estoque baseada em média móvel
- Relatórios de margem negativa e produtos de baixo giro
- Exportação otimizada com metadados para Power BI
- Queries otimizadas com SQLAlchemy para performance em PostgreSQL
"""

from flask import Blueprint, request, jsonify, send_file, current_app
from app import db
from app.utils.custo import custo_efetivo
from app.models import (
    Venda,
    Produto,
    Cliente,
    Funcionario,
    MovimentacaoEstoque,
    Configuracao,
    VendaItem,
    Estabelecimento,
    CategoriaProduto,
)
from datetime import datetime, timedelta, date
from decimal import Decimal
# NOTA: pandas é importado localmente apenas nas funções de exportação que o
# usam (exportar_clientes_em_risco / exportar_backup_local). Import no nível do
# módulo carregava pandas+numpy (~120MB) no boot de CADA worker gunicorn e
# contribuía para o estouro de memória no Render Starter (512MB).
import io
import json
import zipfile
from sqlalchemy import func, extract, and_, or_, cast, String, desc
from app.decorators.decorator_jwt import funcionario_required, gerente_ou_admin_required
from app.decorators.plan_guards import plan_required
from app.utils.timezone import fmt_local, iso_local
from collections import defaultdict
from typing import Dict, List, Any, Tuple
from app.utils.metrics_calculator import MetricsCalculator

relatorios_bp = Blueprint("relatorios", __name__)

# ==================== CONSTANTES ====================

# Thresholds para análise RFM (em dias)
RFM_RECENCY_THRESHOLDS = [30, 60, 90, 120]  # Quanto menor, melhor
RFM_FREQUENCY_THRESHOLDS = [1, 3, 5, 7, 10]  # Quanto maior, melhor
RFM_MONETARY_THRESHOLDS = [100, 250, 500, 1000]  # Quanto maior, melhor

# Classificação ABC
ABC_CLASS_A_THRESHOLD = 0.80  # 80% do faturamento
ABC_CLASS_B_THRESHOLD = 0.95  # 95% do faturamento
# Classe C = resto

# Previsão de estoque
STOCK_PREDICTION_DAYS = 7  # Média móvel dos últimos 7 dias


# ==================== FUNÇÕES AUXILIARES - RFM ====================

def calcular_score_rfm(recency_days: int, frequency: int, monetary: float) -> Tuple[int, int, int]:
    """
    Calcula scores RFM (1-5) baseado em thresholds.
    
    Returns:
        Tuple[recency_score, frequency_score, monetary_score]
    """
    # Recency: quanto menor, melhor (invertido)
    r_score = 5
    for threshold in RFM_RECENCY_THRESHOLDS:
        if recency_days > threshold:
            r_score -= 1
    r_score = max(1, r_score)
    
    # Frequency: quanto maior, melhor
    f_score = 1
    for threshold in RFM_FREQUENCY_THRESHOLDS:
        if frequency >= threshold:
            f_score += 1
    f_score = min(5, f_score)
    
    # Monetary: quanto maior, melhor
    m_score = 1
    for threshold in RFM_MONETARY_THRESHOLDS:
        if monetary >= threshold:
            m_score += 1
    m_score = min(5, m_score)
    
    return (r_score, f_score, m_score)


def segmentar_cliente_rfm(r_score: int, f_score: int, m_score: int) -> str:
    """
    Segmenta cliente baseado nos scores RFM.
    
    Segmentos:
    - Campeões: R≥4, F≥4, M≥4
    - Fiéis: R≥4, F≥3
    - Em Risco: R≤2, (F≥3 ou M≥3)
    - Perdidos: R=1, F≤2
    - Regular: Demais
    """
    if r_score >= 4 and f_score >= 4 and m_score >= 4:
        return "Campeão"
    elif r_score >= 4 and f_score >= 3:
        return "Fiel"
    elif r_score <= 2 and (f_score >= 3 or m_score >= 3):
        return "Em Risco"
    elif r_score == 1 and f_score <= 2:
        return "Perdido"
    else:
        return "Regular"



def analise_rfm_clientes(estabelecimento_id: int, days: int = 180, data_inicio: datetime = None, data_fim: datetime = None) -> List[Dict[str, Any]]:
    """
    Análise RFM completa de clientes com queries otimizadas.
    
    OTIMIZAÇÃO: Usa SQLAlchemy aggregations para processar no banco.
    """
    # O banco grava datetimes UTC "naive" (utcnow). Usar datetime.now(timezone.utc)
    # (aware) quebrava a subtração `now - ultima_compra` com o erro
    # "can't subtract offset-naive and offset-aware datetimes" (RFM e resumo davam 500).
    if data_inicio:
        if not data_fim:
            data_fim = datetime.utcnow()
    else:
        # Padrão: últimos X dias
        data_fim = datetime.utcnow()
        data_inicio = data_fim - timedelta(days=days)
    
    # Query otimizada: agrupa no banco de dados
    resultados = db.session.query(
        Venda.cliente_id,
        Cliente.nome.label('cliente_nome'),
        Cliente.email.label('cliente_email'),
        Cliente.celular.label('cliente_celular'),
        func.count(Venda.id).label('frequency'),
        func.sum(Venda.total).label('monetary'),
        func.max(Venda.data_venda).label('ultima_compra')
    ).join(
        Cliente, Venda.cliente_id == Cliente.id
    ).filter(
        Venda.estabelecimento_id == estabelecimento_id if str(estabelecimento_id).lower() != 'all' else True,
        Venda.data_venda >= data_inicio,
        Venda.data_venda <= data_fim,
        Venda.status == 'finalizada',
        Venda.cliente_id.isnot(None)
    ).group_by(
        Venda.cliente_id,
        Cliente.nome,
        Cliente.email,
        Cliente.celular
    ).all()
    
    if not resultados:
        return []
    
    # Processar resultados (now naive UTC, coerente com o banco)
    now = datetime.utcnow()
    clientes_rfm = []

    for row in resultados:
        recency_days = (now - row.ultima_compra).days if row.ultima_compra else days
        frequency = int(row.frequency or 0)
        monetary = float(row.monetary or 0)
        
        # Calcular scores
        r_score, f_score, m_score = calcular_score_rfm(recency_days, frequency, monetary)
        
        # Segmentar
        segmento = segmentar_cliente_rfm(r_score, f_score, m_score)
        
        # Flag de risco
        em_risco = segmento in ["Em Risco", "Perdido"]
        
        clientes_rfm.append({
            "cliente_id": row.cliente_id,
            "nome": row.cliente_nome,
            "email": row.cliente_email,
            "celular": row.cliente_celular,
            "recency_days": recency_days,
            "recency_score": r_score,
            "frequency": frequency,
            "frequency_score": f_score,
            "monetary": round(monetary, 2),
            "monetary_score": m_score,
            "segmento": segmento,
            "em_risco": em_risco,
            "ultima_compra": iso_local(row.ultima_compra),
            "ultima_compra_fmt": fmt_local(row.ultima_compra, "%d/%m/%Y"),
            "rfm_score": f"{r_score}{f_score}{m_score}"
        })
    
    # Ordenar por valor monetário (clientes mais valiosos primeiro)
    clientes_rfm.sort(key=lambda x: x['monetary'], reverse=True)
    
    return clientes_rfm



# ==================== FUNÇÕES AUXILIARES - ANÁLISE ABC E RENTABILIDADE ====================

def calcular_previsao_esgotamento(produto_id: int, estabelecimento_id: int) -> Dict[str, Any]:
    """
    Calcula previsão de esgotamento baseada na média móvel de vendas.
    
    Fórmula: dias_restantes = estoque_atual / média_vendas_diárias
    """
    # Buscar produto
    produto = Produto.query.get(produto_id)
    if not produto:
        return {"erro": "Produto não encontrado"}
    
    estoque_atual = int(produto.quantidade or 0)
    
    # Se estoque já está zerado
    if estoque_atual <= 0:
        return {
            "produto_id": produto_id,
            "produto_nome": produto.nome,
            "estoque_atual": estoque_atual,
            "media_vendas_diarias": 0,
            "dias_ate_esgotamento": 0,
            "data_esgotamento_prevista": datetime.now().date().isoformat(),
            "status": "ESGOTADO"
        }
    
    # Calcular média de vendas dos últimos N dias
    data_inicio = datetime.now() - timedelta(days=STOCK_PREDICTION_DAYS)
    
    vendas_recentes = db.session.query(
        func.sum(VendaItem.quantidade).label('total_vendido')
    ).join(
        Venda, VendaItem.venda_id == Venda.id
    ).filter(
        VendaItem.produto_id == produto_id,
        Venda.estabelecimento_id == estabelecimento_id if str(estabelecimento_id).lower() != 'all' else True,
        Venda.data_venda >= data_inicio,
        Venda.status == 'finalizada'
    ).scalar()
    
    total_vendido = float(vendas_recentes or 0)
    media_vendas_diarias = total_vendido / STOCK_PREDICTION_DAYS
    
    # Se não há vendas, não há previsão
    if media_vendas_diarias == 0:
        return {
            "produto_id": produto_id,
            "produto_nome": produto.nome,
            "estoque_atual": estoque_atual,
            "media_vendas_diarias": 0,
            "dias_ate_esgotamento": None,
            "data_esgotamento_prevista": None,
            "status": "SEM_MOVIMENTO"
        }
    
    # Calcular dias até esgotamento
    dias_ate_esgotamento = int(estoque_atual / media_vendas_diarias)
    data_esgotamento = datetime.now() + timedelta(days=dias_ate_esgotamento)
    
    # Determinar status
    if dias_ate_esgotamento <= 3:
        status = "CRÍTICO"
    elif dias_ate_esgotamento <= 7:
        status = "ATENÇÃO"
    else:
        status = "NORMAL"
    
    return {
        "produto_id": produto_id,
        "produto_nome": produto.nome,
        "estoque_atual": estoque_atual,
        "media_vendas_diarias": round(media_vendas_diarias, 2),
        "dias_ate_esgotamento": dias_ate_esgotamento,
        "data_esgotamento_prevista": data_esgotamento.date().isoformat(),
        "status": status
    }



def relatorio_rentabilidade_abc(estabelecimento_id: int, days: int = 30, data_inicio: datetime = None, data_fim: datetime = None) -> Dict[str, Any]:
    """
    Relatório de rentabilidade com análise ABC e alertas de margem negativa.
    """
    if data_inicio:
        # Se data_inicio foonecida, usa o range explícito
        if not data_fim:
            data_fim = datetime.now()
    else:
        # Padrão: últimos X dias
        data_fim = datetime.now()
        data_inicio = data_fim - timedelta(days=days)

    # Query otimizada: usa custo_unitario da venda SE existir, senão usa preco_custo atual (fallback)
    lucro_real_expr = func.sum(
        (VendaItem.preco_unitario - custo_efetivo()) * VendaItem.quantidade
    ).label('lucro_real_total')
    
    # Query otimizada: faturamento por produto
    faturamento_produtos = db.session.query(
        Produto.id.label('produto_id'),
        Produto.nome.label('produto_nome'),
        Produto.categoria_id.label('categoria_id'),
        Produto.preco_custo.label('preco_custo'),
        Produto.preco_venda.label('preco_venda'),
        Produto.margem_lucro.label('margem_lucro'),
        Produto.quantidade.label('estoque_atual'),
        Produto.classificacao_abc.label('classe_abc'),
        func.sum(VendaItem.quantidade).label('quantidade_vendida'),
        func.sum(VendaItem.total_item).label('faturamento'),
        lucro_real_expr
    ).join(
        VendaItem, Produto.id == VendaItem.produto_id
    ).join(
        Venda, VendaItem.venda_id == Venda.id
    ).filter(
        Venda.estabelecimento_id == estabelecimento_id if str(estabelecimento_id).lower() != 'all' else True,
        Venda.data_venda >= data_inicio,
        Venda.data_venda <= data_fim,
        Venda.status == 'finalizada'
    ).group_by(
        Produto.id,
        Produto.nome,
        Produto.categoria_id,
        Produto.preco_custo,
        Produto.preco_venda,
        Produto.margem_lucro,
        Produto.quantidade,
        Produto.classificacao_abc
    ).all()
    
    if not faturamento_produtos:
        return {
            "total_produtos": 0,
            "faturamento_total": 0,
            "lucro_total": 0,
            "produtos": [],
            "classe_a": [],
            "classe_b": [],
            "classe_c": [],
            "margem_negativa": [],
            "baixo_giro": []
        }
    
    # Processar dados
    produtos_data = []
    faturamento_total = 0
    lucro_total = 0
    
    for row in faturamento_produtos:
        faturamento = float(row.faturamento or 0)
        lucro_real = float(row.lucro_real_total or 0)
        quantidade_vendida = int(row.quantidade_vendida or 0)
        
        faturamento_total += faturamento
        lucro_total += lucro_real
        
        # Calcular margem real
        margem_real = (lucro_real / faturamento * 100) if faturamento > 0 else 0
        
        produtos_data.append({
            "produto_id": row.produto_id,
            "produto_nome": row.produto_nome,
            "categoria_id": row.categoria_id,
            "preco_custo": float(row.preco_custo or 0),
            "preco_venda": float(row.preco_venda or 0),
            "margem_lucro_percentual": float(row.margem_lucro or 0),
            "estoque_atual": int(row.estoque_atual or 0),
            "classe_abc": row.classe_abc or "C",
            "quantidade_vendida": quantidade_vendida,
            "faturamento": round(faturamento, 2),
            "lucro_real": round(lucro_real, 2),
            "margem_real": round(margem_real, 2)
        })
    
    # Ordenar por faturamento (Pareto)
    produtos_data.sort(key=lambda x: x['faturamento'], reverse=True)
    
    # Classificar ABC (se não tiver classificação)
    acumulado = 0
    for produto in produtos_data:
        acumulado += produto['faturamento']
        percentual_acumulado = (acumulado / faturamento_total) if faturamento_total > 0 else 0
        
        if not produto['classe_abc'] or produto['classe_abc'] == 'C':
            if percentual_acumulado <= ABC_CLASS_A_THRESHOLD:
                produto['classe_abc'] = 'A'
            elif percentual_acumulado <= ABC_CLASS_B_THRESHOLD:
                produto['classe_abc'] = 'B'
            else:
                produto['classe_abc'] = 'C'
        
        produto['percentual_faturamento'] = round((produto['faturamento'] / faturamento_total * 100), 2) if faturamento_total > 0 else 0
    
    # Separar por classe
    classe_a = [p for p in produtos_data if p['classe_abc'] == 'A']
    classe_b = [p for p in produtos_data if p['classe_abc'] == 'B']
    classe_c = [p for p in produtos_data if p['classe_abc'] == 'C']
    
    # Identificar problemas
    margem_negativa = [p for p in produtos_data if p['margem_real'] < 0]
    baixo_giro = [p for p in classe_c if p['quantidade_vendida'] < 5]  # Menos de 5 vendas no período
    
    return {
        "periodo_dias": days,
        "total_produtos": len(produtos_data),
        "faturamento_total": round(faturamento_total, 2),
        "lucro_total": round(lucro_total, 2),
        "margem_media": round((lucro_total / faturamento_total * 100), 2) if faturamento_total > 0 else 0,
        "produtos": produtos_data,
        "classe_a": classe_a,
        "classe_b": classe_b,
        "classe_c": classe_c,
        "margem_negativa": margem_negativa,
        "baixo_giro": baixo_giro,
        "resumo": {
            "classe_a_count": len(classe_a),
            "classe_b_count": len(classe_b),
            "classe_c_count": len(classe_c),
            "margem_negativa_count": len(margem_negativa),
            "baixo_giro_count": len(baixo_giro)
        }
    }



# ==================== ROTAS DA API ====================

@relatorios_bp.route("/rfm/clientes", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def get_rfm_clientes():
    """
    GET /api/relatorios/rfm/clientes
    
    Retorna análise RFM completa de clientes.
    
    Query Params:
    - days: Período de análise em dias (default: 180)
    - segmento: Filtrar por segmento (Campeão, Fiel, Em Risco, Perdido, Regular)
    - em_risco: true/false - Filtrar apenas clientes em risco
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400
        
        # Parâmetros
        days = request.args.get('days', 180, type=int)
        data_inicio_str = request.args.get('data_inicio')
        data_fim_str = request.args.get('data_fim')
        segmento_filtro = request.args.get('segmento', type=str)
        em_risco_filtro = request.args.get('em_risco', type=str)
        
        data_inicio = None
        data_fim = None
        
        try:
            if data_inicio_str:
                data_inicio = datetime.fromisoformat(data_inicio_str.replace('Z', '+00:00'))
            if data_fim_str:
                data_fim = datetime.fromisoformat(data_fim_str.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            # Fallback para parsing simples se ISO falhar
            try:
                if data_inicio_str:
                    data_inicio = datetime.strptime(data_inicio_str.split('T')[0], "%Y-%m-%d")
                if data_fim_str:
                    data_fim = datetime.strptime(data_fim_str.split('T')[0], "%Y-%m-%d")
                    # Ajustar para final do dia se for apenas data
                    if len(data_fim_str) <= 10 or 'T' not in data_fim_str:
                        data_fim = data_fim.replace(hour=23, minute=59, second=59, microsecond=999999)
            except:
                pass

        # Análise RFM
        clientes_rfm = analise_rfm_clientes(
            estabelecimento_id, 
            days=days, 
            data_inicio=data_inicio, 
            data_fim=data_fim
        )
        
        # Aplicar filtros
        if segmento_filtro:
            clientes_rfm = [c for c in clientes_rfm if c['segmento'] == segmento_filtro]
        
        if em_risco_filtro and em_risco_filtro.lower() == 'true':
            clientes_rfm = [c for c in clientes_rfm if c['em_risco']]
        
        # Estatísticas
        total_clientes = len(clientes_rfm)
        segmentos_count = {}
        for cliente in clientes_rfm:
            seg = cliente['segmento']
            segmentos_count[seg] = segmentos_count.get(seg, 0) + 1
        
        clientes_em_risco = [c for c in clientes_rfm if c['em_risco']]
        
        return jsonify({
            "success": True,
            "periodo_dias": days,
            "total_clientes": total_clientes,
            "clientes_em_risco": len(clientes_em_risco),
            "segmentos": segmentos_count,
            "clientes": clientes_rfm
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Erro ao gerar relatório RFM: {str(e)}")
        return jsonify({"error": "Erro ao gerar relatório RFM"}), 500


@relatorios_bp.route("/rfm/clientes/em-risco/exportar", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def exportar_clientes_em_risco():
    """
    GET /api/relatorios/rfm/clientes/em-risco/exportar
    
    Exporta lista de clientes em risco para campanhas de marketing (CSV).
    """
    try:
        import pandas as pd  # lazy: só carrega quando alguém exporta
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400

        days = request.args.get('days', 180, type=int)

        # Análise RFM
        clientes_rfm = analise_rfm_clientes(estabelecimento_id, days)
        clientes_em_risco = [c for c in clientes_rfm if c['em_risco']]
        
        if not clientes_em_risco:
            return jsonify({"error": "Nenhum cliente em risco encontrado"}), 404
        
        # Criar DataFrame
        df = pd.DataFrame(clientes_em_risco)
        
        # Selecionar colunas relevantes para marketing
        df_export = df[[
            'nome', 'email', 'celular', 'segmento',
            'recency_days', 'frequency', 'monetary',
            'ultima_compra'
        ]]
        
        # Renomear colunas
        df_export.columns = [
            'Nome', 'Email', 'Celular', 'Segmento',
            'Dias Sem Comprar', 'Total de Compras', 'Valor Total Gasto',
            'Última Compra'
        ]
        
        # Gerar CSV
        output = io.StringIO()
        df_export.to_csv(output, index=False, encoding='utf-8-sig')
        output.seek(0)
        
        # Converter para bytes
        csv_bytes = output.getvalue().encode('utf-8-sig')
        mem_file = io.BytesIO(csv_bytes)
        
        filename = f"clientes_em_risco_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        return send_file(
            mem_file,
            mimetype='text/csv',
            as_attachment=True,
            download_name=filename
        )
        
    except Exception as e:
        current_app.logger.error(f"Erro ao exportar clientes em risco: {str(e)}")
        return jsonify({"error": "Erro ao exportar dados"}), 500



@relatorios_bp.route("/rentabilidade/abc", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def get_rentabilidade_abc():
    """
    GET /api/relatorios/rentabilidade/abc
    
    Retorna análise de rentabilidade com classificação ABC.
    
    Query Params:
    - days: Período de análise em dias (default: 30)
    - classe: Filtrar por classe ABC (A, B, C)
    - apenas_problemas: true/false - Retornar apenas produtos com problemas
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400
        
        # Parâmetros
        days = request.args.get('days', 30, type=int)
        classe_filtro = request.args.get('classe', type=str)
        apenas_problemas = request.args.get('apenas_problemas', 'false', type=str).lower() == 'true'
        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')

        dt_inicio = None
        dt_fim = None

        if data_inicio:
            try:
                dt_inicio = datetime.strptime(data_inicio, '%Y-%m-%d')
            except ValueError:
                pass
        
        if data_fim:
            try:
                dt_fim = datetime.strptime(data_fim, '%Y-%m-%d') + timedelta(days=1) - timedelta(seconds=1)
            except ValueError:
                pass
        
        # Análise de rentabilidade
        relatorio = relatorio_rentabilidade_abc(estabelecimento_id, days, dt_inicio, dt_fim)
        
        # Aplicar filtros
        if classe_filtro:
            relatorio['produtos'] = [p for p in relatorio['produtos'] if p['classe_abc'] == classe_filtro.upper()]
        
        if apenas_problemas:
            # Retornar apenas produtos com margem negativa ou baixo giro
            problemas = set()
            problemas.update([p['produto_id'] for p in relatorio['margem_negativa']])
            problemas.update([p['produto_id'] for p in relatorio['baixo_giro']])
            relatorio['produtos'] = [p for p in relatorio['produtos'] if p['produto_id'] in problemas]
        
        return jsonify({
            "success": True,
            **relatorio
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Erro ao gerar relatório de rentabilidade: {str(e)}")
        return jsonify({"error": "Erro ao gerar relatório"}), 500


@relatorios_bp.route("/estoque/previsao-esgotamento", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def get_previsao_esgotamento():
    """
    GET /api/relatorios/estoque/previsao-esgotamento
    
    Retorna previsão de esgotamento para todos os produtos ou produto específico.
    
    Query Params:
    - produto_id: ID do produto (opcional)
    - status: Filtrar por status (CRÍTICO, ATENÇÃO, NORMAL, ESGOTADO, SEM_MOVIMENTO)
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400
        
        produto_id = request.args.get('produto_id', type=int)
        status_filtro = request.args.get('status', type=str)
        
        # Se produto específico
        if produto_id:
            previsao = calcular_previsao_esgotamento(produto_id, estabelecimento_id)
            return jsonify({
                "success": True,
                "previsao": previsao
            }), 200
        
        # Todos os produtos
        query_prod = Produto.query.filter_by(ativo=True)
        if str(estabelecimento_id).lower() != 'all':
            query_prod = query_prod.filter_by(estabelecimento_id=estabelecimento_id)
        
        produtos = query_prod.all()
        
        previsoes = []
        for produto in produtos:
            previsao = calcular_previsao_esgotamento(produto.id, estabelecimento_id)
            previsoes.append(previsao)
        
        # Aplicar filtro de status
        if status_filtro:
            previsoes = [p for p in previsoes if p.get('status') == status_filtro.upper()]
        
        # Ordenar por dias até esgotamento (críticos primeiro)
        previsoes_com_dias = [p for p in previsoes if p.get('dias_ate_esgotamento') is not None]
        previsoes_sem_dias = [p for p in previsoes if p.get('dias_ate_esgotamento') is None]
        
        previsoes_com_dias.sort(key=lambda x: x['dias_ate_esgotamento'])
        previsoes = previsoes_com_dias + previsoes_sem_dias
        
        # Estatísticas
        criticos = len([p for p in previsoes if p.get('status') == 'CRÍTICO'])
        atencao = len([p for p in previsoes if p.get('status') == 'ATENÇÃO'])
        
        return jsonify({
            "success": True,
            "total_produtos": len(previsoes),
            "criticos": criticos,
            "atencao": atencao,
            "previsoes": previsoes
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Erro ao calcular previsão de esgotamento: {str(e)}")
        return jsonify({"error": "Erro ao calcular previsão"}), 500



@relatorios_bp.route("/backup/exportar", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def exportar_backup_local():
    """
    GET /api/relatorios/backup/exportar
    
    Exporta backup completo do sistema com metadados para Power BI.
    
    FEATURES:
    - Exportação otimizada com Pandas
    - Dicionário de dados incluído
    - Formato compatível com Power BI
    - Compressão ZIP
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400
        
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Criar dicionário de dados (metadados)
        dicionario_dados = {
            "metadata": {
                "sistema": "MercadinhoSys",
                "versao": "2.0.0",
                "data_exportacao": datetime.now().isoformat(),
                "estabelecimento_id": estabelecimento_id,
                "exportado_por": "Super Admin" if str(estabelecimento_id).lower() == 'all' else "Funcionário Autenticado"
            },
            "tabelas": {
                "produtos": {
                    "descricao": "Catálogo de produtos",
                    "colunas": {
                        "id": "ID único do produto",
                        "nome": "Nome do produto",
                        "preco_custo": "Custo Médio Ponderado (CMP)",
                        "preco_venda": "Preço de venda ao consumidor",
                        "margem_lucro": "Margem de lucro percentual",
                        "quantidade": "Estoque atual",
                        "classificacao_abc": "Classificação ABC (A=alto giro, B=médio, C=baixo)"
                    }
                },
                "clientes": {
                    "descricao": "Base de clientes",
                    "colunas": {
                        "id": "ID único do cliente",
                        "nome": "Nome completo",
                        "cpf": "CPF",
                        "total_compras": "Número total de compras",
                        "valor_total_gasto": "Valor total gasto"
                    }
                },
                "vendas": {
                    "descricao": "Histórico de vendas",
                    "colunas": {
                        "id": "ID único da venda",
                        "codigo": "Código da venda",
                        "data_venda": "Data e hora da venda",
                        "total": "Valor total da venda",
                        "forma_pagamento": "Forma de pagamento utilizada",
                        "status": "Status da venda (finalizada, cancelada)"
                    }
                },
                "venda_itens": {
                    "descricao": "Itens vendidos (detalhamento)",
                    "colunas": {
                        "id": "ID único do item",
                        "venda_id": "ID da venda (FK)",
                        "produto_id": "ID do produto (FK)",
                        "quantidade": "Quantidade vendida",
                        "preco_unitario": "Preço unitário no momento da venda",
                        "total_item": "Total do item (quantidade × preço)",
                        "margem_lucro_real": "Lucro real usando CMP"
                    }
                }
            }
        }
        
        # Exportar dados usando Pandas (otimizado)
        import pandas as pd  # lazy: só carrega quando alguém exporta backup
        current_app.logger.info("Iniciando exportação de backup...")
        
        # Produtos
        produtos_query = Produto.query.filter_by(estabelecimento_id=estabelecimento_id).all()
        df_produtos = pd.DataFrame([p.to_dict() for p in produtos_query])
        
        # Clientes
        clientes_query = Cliente.query.filter_by(estabelecimento_id=estabelecimento_id).all()
        df_clientes = pd.DataFrame([c.to_dict() for c in clientes_query])
        
        # Vendas
        vendas_query = Venda.query.filter_by(estabelecimento_id=estabelecimento_id).all()
        df_vendas = pd.DataFrame([v.to_dict() for v in vendas_query])
        
        # Itens de venda
        venda_ids = [v.id for v in vendas_query]
        if venda_ids:
            itens_query = VendaItem.query.filter(VendaItem.venda_id.in_(venda_ids)).all()
            df_itens = pd.DataFrame([i.to_dict() for i in itens_query])
        else:
            df_itens = pd.DataFrame()
        
        # Criar arquivo Excel com múltiplas abas
        excel_buffer = io.BytesIO()
        with pd.ExcelWriter(excel_buffer, engine='openpyxl') as writer:
            # Dicionário de dados
            df_metadata = pd.DataFrame([dicionario_dados])
            df_metadata.to_excel(writer, sheet_name='Dicionário de Dados', index=False)
            
            # Dados
            if not df_produtos.empty:
                df_produtos.to_excel(writer, sheet_name='Produtos', index=False)
            if not df_clientes.empty:
                df_clientes.to_excel(writer, sheet_name='Clientes', index=False)
            if not df_vendas.empty:
                df_vendas.to_excel(writer, sheet_name='Vendas', index=False)
            if not df_itens.empty:
                df_itens.to_excel(writer, sheet_name='Itens de Venda', index=False)
        
        excel_buffer.seek(0)
        
        # Criar ZIP
        mem_zip = io.BytesIO()
        with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"mercadinhosys_backup_{ts}.xlsx", excel_buffer.getvalue())
            
            # Adicionar JSON também (para compatibilidade)
            data_json = {
                "timestamp": ts,
                "metadata": dicionario_dados["metadata"],
                "produtos": df_produtos.to_dict('records') if not df_produtos.empty else [],
                "clientes": df_clientes.to_dict('records') if not df_clientes.empty else [],
                "vendas": df_vendas.to_dict('records') if not df_vendas.empty else [],
                "itens_venda": df_itens.to_dict('records') if not df_itens.empty else []
            }
            json_bytes = json.dumps(data_json, ensure_ascii=False, indent=2).encode("utf-8")
            zf.writestr(f"backup_{ts}.json", json_bytes)
        
        mem_zip.seek(0)
        
        filename = f"mercadinhosys_backup_{ts}.zip"
        
        current_app.logger.info(f"Backup exportado com sucesso: {filename}")
        
        return send_file(
            mem_zip,
            mimetype="application/zip",
            as_attachment=True,
            download_name=filename
        )
        
    except Exception as e:
        current_app.logger.error(f"Erro ao exportar backup: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": "Falha ao exportar backup"}), 500


@relatorios_bp.route("/dashboard/resumo", methods=["GET"])
@funcionario_required
def get_dashboard_resumo():
    """
    GET /api/relatorios/dashboard/resumo
    
    Retorna resumo executivo para dashboard de relatórios.
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400
        
        # RFM Summary
        clientes_rfm = analise_rfm_clientes(estabelecimento_id, 180)
        clientes_em_risco = len([c for c in clientes_rfm if c['em_risco']])
        
        # Rentabilidade Summary
        rentabilidade = relatorio_rentabilidade_abc(estabelecimento_id, 30)
        
        # Previsão de Estoque Summary
        produtos = Produto.query.filter_by(
            estabelecimento_id=estabelecimento_id,
            ativo=True
        ).limit(100).all()  # Limitar para performance
        
        previsoes = []
        for produto in produtos:
            prev = calcular_previsao_esgotamento(produto.id, estabelecimento_id)
            previsoes.append(prev)
        
        criticos = len([p for p in previsoes if p.get('status') == 'CRÍTICO'])
        
        return jsonify({
            "success": True,
            "rfm": {
                "total_clientes": len(clientes_rfm),
                "clientes_em_risco": clientes_em_risco,
                "percentual_risco": round((clientes_em_risco / len(clientes_rfm) * 100), 2) if clientes_rfm else 0
            },
            "rentabilidade": {
                "faturamento_total": rentabilidade['faturamento_total'],
                "lucro_total": rentabilidade['lucro_total'],
                "margem_media": rentabilidade['margem_media'],
                "produtos_margem_negativa": rentabilidade['resumo']['margem_negativa_count'],
                "produtos_baixo_giro": rentabilidade['resumo']['baixo_giro_count']
            },
            "estoque": {
                "produtos_criticos": criticos,
                "total_analisado": len(previsoes)
            }
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Erro ao gerar resumo do dashboard: {str(e)}")
        return jsonify({"error": "Erro ao gerar resumo"}), 500
