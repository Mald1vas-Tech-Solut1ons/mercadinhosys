"""
Dashboard Super Admin - Com filtro por estabelecimento
Permite ao Super Admin visualizar dados de clientes específicos
"""

from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from app.dashboard_cientifico import DashboardOrchestrator
from app.models import db, Estabelecimento, Venda, Funcionario, DashboardMetrica
from app.decorators.rbac import super_admin_required
import logging
from datetime import datetime, timedelta
from sqlalchemy import func
from app.utils.timezone import iso_utc

logger = logging.getLogger(__name__)
dashboard_super_admin_bp = Blueprint("dashboard_super_admin", __name__)


@dashboard_super_admin_bp.route("/estabelecimentos", methods=["GET"])
@super_admin_required
def listar_estabelecimentos():
    """Lista todos os estabelecimentos para o Super Admin selecionar"""
    try:
        estabelecimentos = Estabelecimento.query.filter_by(ativo=True).all()
        
        lista = []
        for est in estabelecimentos:
            # Obter métricas básicas
            vendas_mes = db.session.query(func.count(Venda.id)).filter(
                Venda.estabelecimento_id == est.id,
                Venda.data_venda >= datetime.now() - timedelta(days=30)
            ).scalar() or 0
            
            total_vendas = db.session.query(func.count(Venda.id)).filter(
                Venda.estabelecimento_id == est.id
            ).scalar() or 0
            
            lista.append({
                "id": est.id,
                "nome_fantasia": est.nome_fantasia,
                "razao_social": est.razao_social,
                "cnpj": est.cnpj,
                "cidade": est.cidade,
                "estado": est.estado,
                "ativo": est.ativo,
                "vendas_mes": vendas_mes,
                "total_vendas": total_vendas,
                "criado_em": iso_utc(est.created_at) if est.created_at else None
            })
        
        return jsonify({
            "success": True,
            "estabelecimentos": lista,
            "total": len(lista)
        })
        
    except Exception as e:
        logger.error(f"Erro ao listar estabelecimentos: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@dashboard_super_admin_bp.route("/visualizar/<int:estabelecimento_id>", methods=["GET"])
@super_admin_required
def dashboard_por_estabelecimento(estabelecimento_id):
    """
    Dashboard do Super Admin visualizando dados de UM estabelecimento específico
    """
    try:
        # Verificar se estabelecimento existe
        estabelecimento = Estabelecimento.query.get(estabelecimento_id)
        if not estabelecimento:
            return jsonify({
                "success": False, 
                "error": "Estabelecimento não encontrado"
            }), 404
        
        # Obter parâmetros da requisição
        days = request.args.get("days", default=30, type=int)
        start_date_str = request.args.get('start_date', default=None, type=str)
        end_date_str = request.args.get('end_date', default=None, type=str)
        
        # Processar datas
        start_date_obj = None
        end_date_obj = None
        
        if start_date_str and end_date_str:
            try:
                from datetime import datetime as dt
                start_date_obj = dt.fromisoformat(start_date_str.replace('Z', '').replace('+00:00', ''))
                end_date_obj = dt.fromisoformat(end_date_str.replace('Z', '').replace('+00:00', ''))
                days = (end_date_obj - start_date_obj).days
                if days < 1:
                    days = 1
                logger.info(f"📊 Dashboard Super Admin com datas específicas: {start_date_str} a {end_date_str} ({days} dias)")
            except Exception as date_err:
                logger.warning(f"Datas inválidas: {date_err}, usando days={days}")
                start_date_obj = None
                end_date_obj = None
        else:
            logger.info(f"📊 Dashboard Super Admin solicitado para {days} dias")
        
        if days < 1:
            days = 1
        elif days > 365:
            days = 365
        
        # Gerar dashboard para o estabelecimento específico
        orchestrator = DashboardOrchestrator(estabelecimento_id)
        data = orchestrator.get_scientific_dashboard(
            days=days,
            start_date=start_date_obj,
            end_date=end_date_obj
        )
        
        # Adicionar informações do estabelecimento
        data["estabelecimento"] = {
            "id": estabelecimento.id,
            "nome_fantasia": estabelecimento.nome_fantasia,
            "razao_social": estabelecimento.razao_social,
            "cnpj": estabelecimento.cnpj,
            "cidade": estabelecimento.cidade,
            "estado": estabelecimento.estado
        }
        
        # Adicionar contexto de Super Admin
        data["super_admin_context"] = {
            "viewing_as": "estabelecimento_specific",
            "can_switch": True,
            "total_estabelecimentos": Estabelecimento.query.filter_by(ativo=True).count()
        }
        
        if not data.get("success", True):
            logger.error(f"❌ Orchestrator returned success=False: {data.get('error')}")
            return jsonify(data), 500
        
        logger.info(f"✅ Dashboard Super Admin para estabelecimento {estabelecimento_id} retornado com sucesso")
        return jsonify(data)
        
    except Exception as e:
        logger.error(f"Erro no dashboard Super Admin: {e}")
        return jsonify({
            "success": False,
            "error": f"Erro interno: {str(e)}"
        }), 500


@dashboard_super_admin_bp.route("/comparativo", methods=["GET"])
@super_admin_required
def dashboard_comparativo():
    """
    Dashboard comparativo entre múltiplos estabelecimentos
    """
    try:
        # Obter estabelecimentos selecionados
        estabelecimentos_ids = request.args.getlist("estabelecimentos")
        days = request.args.get("days", default=30, type=int)
        
        if not estabelecimentos_ids:
            # Se não especificar, usar todos os estabelecimentos ativos
            estabelecimentos = Estabelecimento.query.filter_by(ativo=True).all()
            estabelecimentos_ids = [est.id for est in estabelecimentos]
        
        comparativo = []
        
        for est_id in estabelecimentos_ids:
            try:
                estabelecimento = Estabelecimento.query.get(est_id)
                if not estabelecimento:
                    continue
                
                orchestrator = DashboardOrchestrator(est_id)
                data = orchestrator.get_scientific_dashboard(days=days)
                
                if data.get("success"):
                    comparativo.append({
                        "estabelecimento_id": est_id,
                        "nome_fantasia": estabelecimento.nome_fantasia,
                        "dados": data
                    })
                    
            except Exception as e:
                logger.warning(f"Erro ao obter dados do estabelecimento {est_id}: {e}")
                continue
        
        return jsonify({
            "success": True,
            "comparativo": comparativo,
            "periodo_dias": days,
            "estabelecimentos_analisados": len(comparativo)
        })
        
    except Exception as e:
        logger.error(f"Erro no dashboard comparativo: {e}")
        return jsonify({
            "success": False,
            "error": f"Erro interno: {str(e)}"
        }), 500


@dashboard_super_admin_bp.route("/resumo_geral", methods=["GET"])
@super_admin_required
def resumo_geral():
    """
    Resumo geral de todos os estabelecimentos (visão macro)
    """
    try:
        # Estatísticas gerais
        total_estabelecimentos = db.session.query(func.count(Estabelecimento.id)).filter_by(ativo=True).scalar() or 0
        total_funcionarios = db.session.query(func.count(Funcionario.id)).filter_by(ativo=True).scalar() or 0
        
        # Vendas totais do sistema
        vendas_totais_qtd = db.session.query(func.count(Venda.id)).scalar() or 0
        vendas_totais_valor = db.session.query(func.sum(Venda.total)).scalar() or 0
        
        # Vendas dos últimos 30 dias
        trinta_dias_atras = datetime.now() - timedelta(days=30)
        vendas_30_qtd = db.session.query(func.count(Venda.id)).filter(Venda.data_venda >= trinta_dias_atras).scalar() or 0
        vendas_30_valor = db.session.query(func.sum(Venda.total)).filter(Venda.data_venda >= trinta_dias_atras).scalar() or 0
        
        # Top estabelecimentos por vendas
        top_estabelecimentos = db.session.query(
            Venda.estabelecimento_id,
            Estabelecimento.nome_fantasia,
            func.count(Venda.id).label('total_vendas'),
            func.sum(Venda.total).label('valor_total')
        ).join(Estabelecimento).filter(
            Venda.data_venda >= trinta_dias_atras
        ).group_by(
            Venda.estabelecimento_id, Estabelecimento.nome_fantasia
        ).order_by(func.sum(Venda.total).desc()).limit(5).all()
        
        return jsonify({
            "success": True,
            "resumo_geral": {
                "total_estabelecimentos": total_estabelecimentos,
                "total_funcionarios": total_funcionarios,
                "vendas_totais": {
                    "quantidade": int(vendas_totais_qtd),
                    "valor": float(vendas_totais_valor)
                },
                "vendas_30_dias": {
                    "quantidade": int(vendas_30_qtd),
                    "valor": float(vendas_30_valor)
                }
            },
            "top_estabelecimentos": [
                {
                    "estabelecimento_id": est[0],
                    "nome_fantasia": est[1],
                    "vendas_quantidade": int(est[2]),
                    "vendas_valor": float(est[3])
                }
                for est in top_estabelecimentos
            ]
        })
        
    except Exception as e:
        logger.error(f"Erro no resumo geral: {e}")
        return jsonify({
            "success": False,
            "error": f"Erro interno: {str(e)}"
        }), 500
