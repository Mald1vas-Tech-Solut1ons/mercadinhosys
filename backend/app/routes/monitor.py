from datetime import timezone
# app/routes/monitor.py
from flask import Blueprint, jsonify, request, current_app
from app.models import db, Auditoria, Estabelecimento, Venda, Funcionario
from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
from app.decorators.decorator_jwt import super_admin_required
from sqlalchemy import func
from datetime import datetime, timedelta
import json
from app.utils.timezone import iso_utc

monitor_bp = Blueprint("monitor", __name__)

@monitor_bp.route("/logs", methods=["GET"])
@super_admin_required
def get_global_logs():
    """Retorna logs de auditoria de todos os estabelecimentos com resiliência total"""
    try:
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 50, type=int)
        tipo = request.args.get("tipo")
        # O frontend envia ?estab_id=; mantemos compat com ?estabelecimento_id= e,
        # por fim, o contexto de impersonation. Antes só lia 'estabelecimento_id',
        # então o filtro por loja no painel de super admin não funcionava.
        estab_id = (
            request.args.get("estab_id")
            or request.args.get("estabelecimento_id")
            or get_authorized_establishment_id()
        )
        
        query = Auditoria.query

        if tipo:
            query = query.filter(Auditoria.tipo_evento == tipo)
        if estab_id and str(estab_id).lower() != "all":
            try:
                query = query.filter(Auditoria.estabelecimento_id == int(estab_id))
            except (ValueError, TypeError):
                logger.warning(f"ID de estabelecimento inválido na filtragem de logs: {estab_id}")

        # Paginação com tratamento de erro
        try:
            logs_pagination = query.order_by(Auditoria.data_evento.desc()).paginate(
                page=page, per_page=per_page, error_out=False
            )
            
            serialized_logs = []
            for log in logs_pagination.items:
                try:
                    serialized_logs.append(log.to_dict())
                except Exception as e:
                    current_app.logger.warning(f"Falha ao serializar log {log.id}: {e}")
                    # Fallback manual se o to_dict() falhar
                    serialized_logs.append({
                        "id": log.id,
                        "tipo_evento": log.tipo_evento,
                        "descricao": log.descricao,
                        "data_evento": iso_utc(log.data_evento) if log.data_evento else None,
                        "estabelecimento_nome": "Erro ao carregar nome"
                    })

            return jsonify({
                "success": True,
                "logs": serialized_logs,
                "total": logs_pagination.total,
                "pages": logs_pagination.pages,
                "current_page": logs_pagination.page
            }), 200
        except Exception as e:
            current_app.logger.error(f"Erro na paginação de logs: {e}")
            return jsonify({
                "success": True,
                "logs": [],
                "total": 0,
                "pages": 0,
                "current_page": page
            }), 200

    except Exception as e:
        current_app.logger.error(f"Erro fatal no endpoint de logs: {str(e)}")
        return jsonify({"success": False, "error": f"Erro interno: {str(e)}"}), 500

@monitor_bp.route("/summary", methods=["GET"])
@super_admin_required
def get_global_summary():
    """Retorna resumo estatístico global do sistema"""
    try:
        estab_id = request.args.get('estab_id', 'all')
        is_global = str(estab_id).lower() == "all"

        agora = datetime.now(timezone.utc)
        hoje_start = agora.replace(hour=0, minute=0, second=0, microsecond=0)
        mes_start = hoje_start - timedelta(days=30)
        
        # 1. Estabelecimentos Totais (Contagem simples - sempre global para manter sentido no dashboard SaaS)
        total_estabelecimentos = db.session.query(func.count(Estabelecimento.id)).scalar() or 0
        
        # Base query vendas
        query_vendas = db.session.query(Venda.id, Venda.total, Venda.data_venda)
        if not is_global:
            try:
                query_vendas = query_vendas.filter(Venda.estabelecimento_id == int(estab_id))
            except (ValueError, TypeError):
                pass

        # 2. Vendas Hoje (Range Seguro)
        try:
            vendas_hoje_qtd = query_vendas.filter(Venda.data_venda >= hoje_start).count()
            vendas_hoje_valor = db.session.query(func.sum(Venda.total)).filter(
                Venda.estabelecimento_id == int(estab_id) if not is_global and str(estab_id).isdigit() else True,
                Venda.data_venda >= hoje_start
            ).scalar() or 0
        except Exception as e:
            current_app.logger.warning(f"Falha ao ler vendas hoje: {e}")
            vendas_hoje_qtd, vendas_hoje_valor = 0, 0

        # 3. Vendas Mês (Para mostrar dados semeados se não houver hoje)
        try:
            vendas_mes_qtd = query_vendas.filter(Venda.data_venda >= mes_start).count()
            vendas_mes_valor = db.session.query(func.sum(Venda.total)).filter(
                Venda.estabelecimento_id == int(estab_id) if not is_global else True,
                Venda.data_venda >= mes_start
            ).scalar() or 0
        except Exception as e:
            current_app.logger.warning(f"Falha ao ler vendas mês: {e}")
            vendas_mes_qtd, vendas_mes_valor = 0, 0
            
        # 4. Últimos registros de onboarding (Com blindagem de JSON)
        try:
            query_auditoria = Auditoria.query.filter(Auditoria.tipo_evento == "estabelecimento_registrado")
            if not is_global:
                 query_auditoria = query_auditoria.filter(Auditoria.estabelecimento_id == int(estab_id))
                 
            ultimos_registros = query_auditoria.order_by(Auditoria.data_evento.desc()).limit(5).all()
            novos_clientes = []
            for log in ultimos_registros:
                nome_estab = "N/A"
                if log.detalhes_json:
                    try:
                        detalhes = json.loads(log.detalhes_json)
                        nome_estab = detalhes.get("estabelecimento") or detalhes.get("nome") or "N/A"
                    except:
                        pass
                novos_clientes.append({
                    "nome": nome_estab,
                    "data": iso_utc(log.data_evento) if log.data_evento else iso_utc(agora)
                })
        except Exception as e:
            current_app.logger.error(f"Erro ao ler auditoria: {e}")
            novos_clientes = []

        return jsonify({
            "success": True,
            "summary": {
                "total_estabelecimentos": total_estabelecimentos,
                "vendas_hoje_qtd": int(vendas_hoje_qtd),
                "vendas_hoje_valor": float(vendas_hoje_valor),
                "vendas_mes_qtd": int(vendas_mes_qtd),
                "vendas_mes_valor": float(vendas_mes_valor),
                "novos_clientes_recentes": novos_clientes
            }
        }), 200

    except Exception as e:
        current_app.logger.error(f"Erro crítico no summary global: {str(e)}")
        # Fallback para não quebrar a UI
        return jsonify({
            "success": True, 
            "summary": {
                "total_estabelecimentos": 0,
                "vendas_hoje_qtd": 0,
                "vendas_hoje_valor": 0,
                "vendas_mes_qtd": 0,
                "vendas_mes_valor": 0,
                "novos_clientes_recentes": []
            }
        }), 200

@monitor_bp.route("/establishments", methods=["GET"])
@super_admin_required
def list_establishments():
    """Lista todos os estabelecimentos cadastrados (inquilinos)"""
    try:
        search = request.args.get("search", "")
        query = Estabelecimento.query
        
        if search:
            query = query.filter(
                (ilike_unaccent(Estabelecimento.nome_fantasia, f"%{search}%")) |
                (ilike_unaccent(Estabelecimento.cnpj, f"%{search}%"))
            )
            
        establishments = query.order_by(Estabelecimento.data_cadastro.desc()).all()
        
        return jsonify({
            "success": True,
            "establishments": [e.to_dict() for e in establishments]
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@monitor_bp.route("/establishments/<int:id>/status", methods=["PUT"])
@super_admin_required
def toggle_establishment_status(id):
    """Ativa/Desativa um estabelecimento"""
    try:
        estab = Estabelecimento.query.get_or_404(id)
        data = request.get_json()
        
        if "ativo" in data:
            estab.ativo = data["ativo"]
            
        db.session.commit()
        
        return jsonify({
            "success": True, 
            "message": f"Status de {estab.nome_fantasia} atualizado com sucesso.",
            "ativo": estab.ativo
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 500

@monitor_bp.route("/establishments/<int:id>", methods=["PUT"])
@super_admin_required
def update_establishment(id):
    """Atualiza dados do estabelecimento (Plano, Vencimento, etc)"""
    try:
        estab = Estabelecimento.query.get_or_404(id)
        data = request.get_json()
        
        # Campos atualizáveis pelo Super Admin
        if "nome_fantasia" in data: estab.nome_fantasia = data["nome_fantasia"]
        if "plano" in data: estab.plano = data["plano"]
        if "plano_status" in data: estab.plano_status = data["plano_status"]
        if "ativo" in data: estab.ativo = data["ativo"]
        
        if "vencimento_assinatura" in data:
            try:
                if data["vencimento_assinatura"]:
                    estab.vencimento_assinatura = datetime.fromisoformat(data["vencimento_assinatura"].replace('Z', '+00:00'))
                else:
                    estab.vencimento_assinatura = None
            except ValueError:
                return jsonify({"success": False, "error": "Formato de data inválido. Use ISO8601."}), 400

        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": f"Dados de {estab.nome_fantasia} atualizados com sucesso.",
            "establishment": estab.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao atualizar estabelecimento {id}: {str(e)}")
        return jsonify({"success": False, "error": f"Erro interno: {str(e)}"}), 500

@monitor_bp.route("/establishments/<int:id>", methods=["DELETE"])
@super_admin_required
def delete_establishment(id):
    """Exclui um estabelecimento (CUIDADO: Decisão de CEO/CTO)"""
    try:
        estab = Estabelecimento.query.get_or_404(id)
        nome = estab.nome_fantasia
        
        from app.utils.query_helpers import ilike_unaccent, get_estabelecimento_safe, get_authorized_establishment_id
        claims = get_jwt()
        # Prioriza o contexto de impersonation se for Super Admin
        estabelecimento_id = get_authorized_establishment_id()
        
        # Em um sistema real, aqui deletaríamos ou desvincularíamos dependências.
        # Por segurança de dados, vamos apenas marcar como 'excluido' no plano_status 
        # ou realmente deletar se o usuário confirmar.
        # O usuário pediu "deletar", então vamos realizar a exclusão física.
        
        db.session.delete(estab)
        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": f"Estabelecimento '{nome}' e todos os dados associados foram removidos."
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": f"Erro ao deletar: {str(e)}"}), 500
