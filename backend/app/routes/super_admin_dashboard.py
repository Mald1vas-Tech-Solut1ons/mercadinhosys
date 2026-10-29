"""
Super Admin Dashboard - Interface centralizada e otimizada
Permite ao Super Admin gerenciar todos os clientes de forma organizada
"""

from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from app.models import (
    db,
    Estabelecimento,
    Venda,
    Funcionario,
    Produto,
    DashboardMetrica,
    Auditoria,
    LoginHistory,
    CatalogoMestre,
)
from app.decorators.rbac import super_admin_required
from datetime import datetime, timedelta
from sqlalchemy import func, and_, or_
import logging
from app.utils.timezone import iso_utc

logger = logging.getLogger(__name__)
super_admin_dashboard_bp = Blueprint("super_admin_dashboard", __name__)

# Preço mensal de referência por plano (R$). Ajuste conforme a tabela comercial.
PLAN_PRICES = {
    "gratuito": 0.0,
    "bronze": 0.0,
    "premium": 99.90,
    "pro": 99.90,
    "advanced": 149.90,
    "enterprise": 249.90,
    "premium master": 0.0,  # HQ interno
}


def _preco_plano(plano: str) -> float:
    return PLAN_PRICES.get((plano or "gratuito").strip().lower(), 0.0)


def _is_pago(plano: str) -> bool:
    return _preco_plano(plano) > 0

@super_admin_dashboard_bp.route("/estabelecimentos-ativos", methods=["GET"])
@super_admin_required
def listar_estabelecimentos_ativos():
    """Lista estabelecimentos com métricas rápidas"""
    try:
        estabelecimentos = Estabelecimento.query.filter_by(ativo=True).all()
        
        lista = []
        for est in estabelecimentos:
            # Métricas rápidas
            vendas_hoje = db.session.query(func.count(Venda.id)).filter(
                and_(
                    Venda.estabelecimento_id == est.id,
                    Venda.data_venda >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                )
            ).scalar() or 0
            
            total_vendas = db.session.query(func.count(Venda.id)).filter(
                Venda.estabelecimento_id == est.id
            ).scalar() or 0
            
            produtos_count = db.session.query(func.count(Produto.id)).filter(
                and_(
                    Produto.estabelecimento_id == est.id,
                    Produto.ativo == True
                )
            ).scalar() or 0
            
            funcionarios_count = db.session.query(func.count(Funcionario.id)).filter(
                and_(
                    Funcionario.estabelecimento_id == est.id,
                    Funcionario.ativo == True
                )
            ).scalar() or 0
            
            lista.append({
                "id": est.id,
                "nome_fantasia": est.nome_fantasia,
                "razao_social": est.razao_social,
                "cnpj": est.cnpj,
                "cidade": est.cidade,
                "estado": est.estado,
                "plano": getattr(est, 'plano', 'Gratuito'),
                "plano_status": getattr(est, 'plano_status', 'experimental'),
                "ativo": est.ativo,
                "vendas_hoje": vendas_hoje,
                "total_vendas": total_vendas,
                "produtos_count": produtos_count,
                "funcionarios_count": funcionarios_count,
                "created_at": iso_utc(est.created_at) if est.created_at else None,
                "vencimento_assinatura": iso_utc(est.vencimento_assinatura) if est.vencimento_assinatura else None
            })
        
        return jsonify({
            "success": True,
            "estabelecimentos": lista,
            "total": len(lista)
        })
        
    except Exception as e:
        logger.error(f"❌ Erro ao listar estabelecimentos ativos: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@super_admin_dashboard_bp.route("/selecionar-estabelecimento/<int:estabelecimento_id>", methods=["GET"])
@super_admin_required
def dashboard_estabelecimento_especifico(estabelecimento_id):
    """Dashboard de um estabelecimento específico (visão Super Admin)"""
    try:
        # Verificar se estabelecimento existe
        estabelecimento = Estabelecimento.query.get(estabelecimento_id)
        if not estabelecimento:
            return jsonify({
                "success": False, 
                "error": "Estabelecimento não encontrado"
            }), 404
        
        # Parâmetros
        days = request.args.get("days", default=30, type=int)
        
        # Métricas do estabelecimento
        hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        dias_atras = datetime.now() - timedelta(days=days)
        
        # Vendas
        vendas_periodo = db.session.query(
            func.count(Venda.id).label('quantidade'),
            func.sum(Venda.total).label('valor')
        ).filter(
            and_(
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.data_venda >= dias_atras
            )
        ).first()
        
        vendas_hoje = db.session.query(
            func.count(Venda.id).label('quantidade'),
            func.sum(Venda.total).label('valor')
        ).filter(
            and_(
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.data_venda >= hoje
            )
        ).first()
        
        # Produtos
        produtos_ativos = db.session.query(func.count(Produto.id)).filter(
            and_(
                Produto.estabelecimento_id == estabelecimento_id,
                Produto.ativo == True
            )
        ).scalar() or 0
        
        produtos_baixo_estoque = db.session.query(func.count(Produto.id)).filter(
            and_(
                Produto.estabelecimento_id == estabelecimento_id,
                Produto.quantidade <= Produto.quantidade_minima,
                Produto.quantidade > 0
            )
        ).scalar() or 0
        
        # Funcionários
        funcionarios_ativos = db.session.query(func.count(Funcionario.id)).filter(
            and_(
                Funcionario.estabelecimento_id == estabelecimento_id,
                Funcionario.ativo == True
            )
        ).scalar() or 0
        
        dashboard_data = {
            "estabelecimento": {
                "id": estabelecimento.id,
                "nome_fantasia": estabelecimento.nome_fantasia,
                "razao_social": estabelecimento.razao_social,
                "cnpj": estabelecimento.cnpj,
                "cidade": estabelecimento.cidade,
                "estado": estabelecimento.estado,
                "plano": getattr(estabelecimento, 'plano', 'Gratuito'),
                "plano_status": getattr(estabelecimento, 'plano_status', 'experimental')
            },
            "metricas": {
                "vendas_periodo": {
                    "quantidade": int(vendas_periodo.quantidade or 0),
                    "valor": float(vendas_periodo.valor or 0)
                },
                "vendas_hoje": {
                    "quantidade": int(vendas_hoje.quantidade or 0),
                    "valor": float(vendas_hoje.valor or 0)
                },
                "produtos": {
                    "ativos": produtos_ativos,
                    "baixo_estoque": produtos_baixo_estoque
                },
                "funcionarios": {
                    "ativos": funcionarios_ativos
                }
            },
            "periodo_analise": days,
            "data_geracao": iso_utc(datetime.now())
        }
        
        return jsonify({
            "success": True,
            "dashboard": dashboard_data
        })
        
    except Exception as e:
        logger.error(f"❌ Erro no dashboard do estabelecimento: {e}")
        return jsonify({
            "success": False,
            "error": f"Erro interno: {str(e)}"
        }), 500

@super_admin_dashboard_bp.route("/resumo-sistema", methods=["GET"])
@super_admin_required
def resumo_completo_sistema():
    """Resumo completo do sistema para Super Admin"""
    try:
        # Estatísticas gerais
        total_estabelecimentos = db.session.query(func.count(Estabelecimento.id)).filter_by(ativo=True).scalar() or 0
        total_funcionarios = db.session.query(func.count(Funcionario.id)).filter_by(ativo=True).scalar() or 0
        total_produtos = db.session.query(func.count(Produto.id)).filter_by(ativo=True).scalar() or 0
        
        # Vendas totais
        vendas_totais = db.session.query(
            func.count(Venda.id).label('quantidade'),
            func.sum(Venda.total).label('valor')
        ).first()
        
        # Vendas dos últimos 30 dias
        trinta_dias_atras = datetime.now() - timedelta(days=30)
        vendas_30_dias = db.session.query(
            func.count(Venda.id).label('quantidade'),
            func.sum(Venda.total).label('valor')
        ).filter(Venda.data_venda >= trinta_dias_atras).first()
        
        # Top estabelecimentos por vendas (últimos 30 dias)
        top_estabelecimentos = db.session.query(
            Venda.estabelecimento_id,
            Estabelecimento.nome_fantasia,
            func.count(Venda.id).label('vendas_qtd'),
            func.sum(Venda.total).label('vendas_valor')
        ).join(Estabelecimento).filter(
            and_(
                Venda.data_venda >= trinta_dias_atras,
                Estabelecimento.ativo == True
            )
        ).group_by(
            Venda.estabelecimento_id, Estabelecimento.nome_fantasia
        ).order_by(func.sum(Venda.total).desc()).limit(5).all()
        
        resumo = {
            "sistema": {
                "total_estabelecimentos": total_estabelecimentos,
                "total_funcionarios": total_funcionarios,
                "total_produtos": total_produtos,
                "vendas_totais": {
                    "quantidade": int(vendas_totais.quantidade or 0),
                    "valor": float(vendas_totais.valor or 0)
                },
                "vendas_30_dias": {
                    "quantidade": int(vendas_30_dias.quantidade or 0),
                    "valor": float(vendas_30_dias.valor or 0)
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
            ],
            "data_geracao": iso_utc(datetime.now())
        }
        
        return jsonify({
            "success": True,
            "resumo": resumo
        })
        
    except Exception as e:
        logger.error(f"❌ Erro no resumo do sistema: {e}")
        return jsonify({
            "success": False,
            "error": f"Erro interno: {str(e)}"
        }), 500

@super_admin_dashboard_bp.route("/saas-metrics", methods=["GET"])
@super_admin_required
def saas_metrics():
    """
    Dashboard do Product Owner: saúde do negócio SaaS.
    Churn, MRR/ARPU, distribuição de planos, trials, tenants em risco.
    """
    try:
        agora = datetime.now()
        ha_30 = agora - timedelta(days=30)
        inativo_dias = int(request.args.get("inativo_dias", 14))
        limite_inatividade = agora - timedelta(days=inativo_dias)

        ests = Estabelecimento.query.all()
        ativos = [e for e in ests if e.ativo]

        # Distribuição de planos e status
        por_plano, por_status = {}, {}
        mrr = 0.0
        pagantes = 0
        for e in ativos:
            plano = (e.plano or "gratuito")
            status = (e.plano_status or "experimental")
            por_plano[plano] = por_plano.get(plano, 0) + 1
            por_status[status] = por_status.get(status, 0) + 1
            if _is_pago(plano) and status not in ("cancelado", "suspenso"):
                mrr += _preco_plano(plano)
                pagantes += 1

        # Churn: cancelados/suspensos vs base que já foi paga
        cancelados = sum(1 for e in ests if (e.plano_status or "") in ("cancelado", "suspenso"))
        base_paga = pagantes + cancelados
        churn_rate = round((cancelados / base_paga) * 100, 2) if base_paga else 0.0

        # Novos tenants (30 dias)
        novos_30 = sum(1 for e in ests if e.data_cadastro and e.data_cadastro >= ha_30)

        # Trials expirando em 7 dias
        em_7 = agora + timedelta(days=7)
        trials_expirando = [
            {"id": e.id, "nome": e.nome_fantasia,
             "vencimento": iso_utc(e.vencimento_assinatura) if e.vencimento_assinatura else None}
            for e in ativos
            if (e.plano_status or "") == "experimental" and e.vencimento_assinatura
            and agora <= e.vencimento_assinatura <= em_7
        ]

        # Tenants EM RISCO (anti-churn): sem vendas recentes
        ultimas_vendas = dict(
            db.session.query(Venda.estabelecimento_id, func.max(Venda.data_venda))
            .group_by(Venda.estabelecimento_id).all()
        )
        em_risco = []
        for e in ativos:
            if _preco_plano(e.plano) == 0 and (e.plano_status or "") != "experimental":
                continue  # foca em pagantes e trials
            ult = ultimas_vendas.get(e.id)
            if ult is None or ult < limite_inatividade:
                dias = (agora - ult).days if ult else None
                em_risco.append({
                    "id": e.id, "nome": e.nome_fantasia, "plano": e.plano,
                    "plano_status": e.plano_status,
                    "ultima_venda": iso_utc(ult) if ult else None,
                    "dias_sem_vender": dias,
                })
        em_risco.sort(key=lambda x: (x["dias_sem_vender"] is not None, x["dias_sem_vender"] or 0), reverse=True)

        return jsonify({
            "success": True,
            "data": {
                "resumo": {
                    "total_tenants": len(ests),
                    "tenants_ativos": len(ativos),
                    "tenants_pagantes": pagantes,
                    "novos_30_dias": novos_30,
                    "mrr": round(mrr, 2),
                    "arr": round(mrr * 12, 2),
                    "arpu": round(mrr / pagantes, 2) if pagantes else 0.0,
                    "churn_rate_pct": churn_rate,
                    "tenants_em_risco": len(em_risco),
                },
                "distribuicao_planos": por_plano,
                "distribuicao_status": por_status,
                "trials_expirando_7d": trials_expirando,
                "tenants_em_risco": em_risco[:20],
                "parametros": {"inatividade_dias": inativo_dias},
                "data_geracao": iso_utc(agora),
            }
        })
    except Exception as e:
        logger.error(f"Erro em saas_metrics: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@super_admin_dashboard_bp.route("/logs-auditoria", methods=["GET"])
@super_admin_required
def logs_auditoria():
    """Visualizador de logs de auditoria do sistema (todos os tenants)."""
    try:
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = min(request.args.get("por_pagina", 50, type=int), 200)
        tipo = request.args.get("tipo_evento")
        est_id = request.args.get("estabelecimento_id", type=int)

        q = Auditoria.query
        # Auditoria é MultiTenant; super admin precisa ver todos → bypass do filtro de g
        q = db.session.query(Auditoria)
        if tipo:
            q = q.filter(Auditoria.tipo_evento == tipo)
        if est_id:
            q = q.filter(Auditoria.estabelecimento_id == est_id)
        q = q.order_by(Auditoria.data_evento.desc())
        total = q.count()
        itens = q.limit(por_pagina).offset((pagina - 1) * por_pagina).all()

        return jsonify({
            "success": True,
            "data": [a.to_dict() for a in itens],
            "total": total, "pagina": pagina, "por_pagina": por_pagina,
        })
    except Exception as e:
        logger.error(f"Erro em logs_auditoria: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@super_admin_dashboard_bp.route("/catalogo-mestre", methods=["GET"])
@super_admin_required
def catalogo_mestre():
    """Navegação do Catálogo Mestre global (todos os itens, de todas as fontes)."""
    try:
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = min(request.args.get("por_pagina", 50, type=int), 200)
        categoria = request.args.get("categoria")
        fonte = request.args.get("fonte")
        busca = request.args.get("busca")
        segmento_origem = request.args.get("segmento_origem")

        q = db.session.query(CatalogoMestre)
        if segmento_origem:
            q = q.join(
                Estabelecimento,
                Estabelecimento.id == CatalogoMestre.descoberto_por_estabelecimento_id,
            ).filter(Estabelecimento.segmento == segmento_origem)
        if categoria:
            q = q.filter(CatalogoMestre.categoria == categoria)
        if fonte:
            q = q.filter(CatalogoMestre.fonte == fonte)
        if busca:
            termo = f"%{busca}%"
            q = q.filter(or_(CatalogoMestre.nome.ilike(termo), CatalogoMestre.ean.ilike(termo)))

        q = q.order_by(CatalogoMestre.updated_at.desc())
        total = q.count()
        itens = q.limit(por_pagina).offset((pagina - 1) * por_pagina).all()

        return jsonify({
            "success": True,
            "data": [c.to_dict() for c in itens],
            "total": total, "pagina": pagina, "por_pagina": por_pagina,
        })
    except Exception as e:
        logger.error(f"Erro em catalogo_mestre: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@super_admin_dashboard_bp.route("/consumo-apis", methods=["GET"])
@super_admin_required
def consumo_apis():
    """Consumo do mês das APIs pagas: BigDataCorp, um serviço por linha, 500 consultas grátis cada."""
    from app.services.bigdatacorp_service import consumo_do_mes
    return jsonify({"success": True, "data": consumo_do_mes()})


@super_admin_dashboard_bp.route("/logs-acesso", methods=["GET"])
@super_admin_required
def logs_acesso():
    """Histórico de logins (sucesso/falha) para monitoramento de segurança."""
    try:
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = min(request.args.get("por_pagina", 50, type=int), 200)
        q = db.session.query(LoginHistory).order_by(LoginHistory.data_cadastro.desc())
        total = q.count()
        itens = q.limit(por_pagina).offset((pagina - 1) * por_pagina).all()
        return jsonify({
            "success": True,
            "data": [l.to_dict() for l in itens],
            "total": total, "pagina": pagina, "por_pagina": por_pagina,
        })
    except Exception as e:
        logger.error(f"Erro em logs_acesso: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@super_admin_dashboard_bp.route("/sincronizar-dados", methods=["POST"])
@super_admin_required
def forcar_sincronizacao():
    """Força sincronização REAL dos dados locais para o Aiven (bulk upsert idempotente)."""
    try:
        from scripts.force_sync_to_aiven import force_sync
        resultado = force_sync(app=current_app._get_current_object(), silent=True)
        if resultado.get("success"):
            return jsonify({
                "success": True,
                "message": f"Sincronização concluída: {resultado.get('total_registros', 0)} registros enviados ao Aiven.",
                "total_registros": resultado.get("total_registros", 0),
                "timestamp": iso_utc(datetime.now()),
            })
        return jsonify({
            "success": False,
            "error": resultado.get("erro", "Falha na sincronização"),
        }), 500
    except Exception as e:
        logger.error(f"Erro ao sincronizar dados: {e}")
        return jsonify({"success": False, "error": f"Erro na sincronização: {str(e)}"}), 500

@super_admin_dashboard_bp.route("/health", methods=["GET"])
def health_check():
    """Health check do Super Admin Dashboard"""
    return jsonify({
        "success": True,
        "message": "Super Admin Dashboard funcionando",
        "timestamp": iso_utc(datetime.now())
    })
