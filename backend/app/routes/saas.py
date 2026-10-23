from datetime import timezone
# app/routes/saas.py
from flask import Blueprint, request, jsonify
from app.models import (
    db, Lead, Estabelecimento, Funcionario, Configuracao, 
    ConfiguracaoHorario, Caixa, CategoriaProduto
)
from app.decorators.decorator_jwt import super_admin_required
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from datetime import datetime, date, time, timedelta
import logging
from app.services.email_service import email_service
import json
from app.middleware.rate_limit import limiter
from app.decorators.plan_guards import normalize_plan

saas_bp = Blueprint("saas", __name__)
logger = logging.getLogger(__name__)


def _invalidar_cache_plano(tenant_id):
    """Invalida o cache de plano_status (usado no before_request p/ bloqueio de
    inadimplência) para que ativar/inativar loja tenha efeito imediato."""
    try:
        from app import cache
        cache.delete(f"plano_status:{tenant_id}")
        cache.delete(f"plano:{tenant_id}")  # gate Grátis x Pro do access_control
    except Exception:
        pass

# ==================== LEAD MANAGEMENT ====================

@saas_bp.route("/leads/registrar", methods=["POST"])
@limiter.limit("5 per minute")
def registrar_lead():
    """
    Captura leads do formulário da Landing Page
    """
    try:
        data = request.get_json()
        if not data or not data.get("email"):
            return jsonify({
                "success": False, 
                "error": "Dados incompletos", 
                "message": "Nome e WhatsApp são recomendados, mas Email é obrigatório."
            }), 400
        
        # Verificar duplicados recentemente (opcional, mas bom para evitar spam)
        # Por enquanto, apenas registramos
        
        novo_lead = Lead(
            nome=data.get("nome", "Interessado"),
            email=data.get("email"),
            whatsapp=data.get("whatsapp", ""),
            origem=data.get("origem", "landing_page"),
            observacao=data.get("mensagem", "")
        )
        db.session.add(novo_lead)
        db.session.commit()
        
        logger.info(f"🆕 NOVO LEAD: {novo_lead.email} ({novo_lead.nome})")
        
        # Enviar email de boas-vindas (assíncrono futuramente)
        try:
            email_service.send_welcome_email(novo_lead.email, novo_lead.nome)
        except Exception as e:
            logger.error(f"Erro ao disparar email de boas-vindas: {e}")
        
        return jsonify({
            "success": True, 
            "message": "Obrigado pelo interesse! Nossa equipe entrará em contato em breve."
        }), 201
        
    except Exception as e:
        db.session.rollback()
        logger.error(f"Erro ao registrar lead: {e}")
        return jsonify({"success": False, "error": "Erro ao processar sua solicitação"}), 500


@saas_bp.route("/leads", methods=["GET"])
@super_admin_required
def listar_leads():
    """
    Lista todos os leads capturados (Apenas para Super Admin SaaS)
    """
    try:
        leads = Lead.query.order_by(Lead.data_cadastro.desc()).all()
        return jsonify({
            "success": True,
            "count": len(leads),
            "data": [lead.to_dict() for lead in leads]
        }), 200
    except Exception as e:
        logger.error(f"Erro ao listar leads: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== TENANT ONBOARDING ====================

@saas_bp.route("/onboarding", methods=["POST"])
@super_admin_required
def tenant_onboarding():
    """
    Onboarding Atômico de Novo Cliente (Tenant)
    Cria todo o ecossistema básico do cliente em uma única transação
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "success": False,
                "error": "Dados não fornecidos",
                "message": "Envie os dados do estabelecimento e administrador"
            }), 400

        # Validação dos campos obrigatórios
        campos_obrigatorios = [
            'nome_fantasia', 'razao_social', 'telefone', 'email_estabelecimento',
            'nome_admin', 'email_admin'
        ]
        
        campos_faltantes = [campo for campo in campos_obrigatorios if not data.get(campo)]
        if campos_faltantes:
            return jsonify({
                "success": False,
                "error": "Campos obrigatórios faltando",
                "missing_fields": campos_faltantes
            }), 400

        # Validação de documento (CNPJ ou CPF)
        documento = data.get('cnpj') or data.get('cpf')
        if not documento:
            return jsonify({
                "success": False,
                "error": "É necessário fornecer CNPJ ou CPF"
            }), 400

        # CPF do administrador (dono): obrigatório e VALIDADO.
        # Histórico: antes derivava documento[:11] do CNPJ — um CNPJ truncado
        # nunca é um CPF válido e o @validates do Funcionario reprova dentro
        # do commit, estourando 500 genérico ("Falha ao provisionar") sem
        # dizer ao operador onde errou. Aceita dígitos crus ou formatado.
        from app.utils.validators import normalizar_documento, validar_cpf
        cpf_admin = normalizar_documento(data.get('cpf_admin') or '')
        if not cpf_admin:
            return jsonify({
                "success": False,
                "error": "Informe o CPF do administrador (dono da loja)"
            }), 400
        if not validar_cpf(cpf_admin):
            return jsonify({
                "success": False,
                "error": "CPF do administrador inválido"
            }), 400

        # Início da transação atômica

        # Plano inicial: padrão agora é TRIAL PRO (experimental) com N dias
        # grátis — configurável por chamada. Antes nascia 'Gratuito'/'ativo',
        # travando a loja nos limites do plano grátis para sempre.
        # IMPORTANTE: gravar plano='trial' cru (como no onboarding self-service);
        # normalize_plan('trial') viraria 'Gratuito'. O liberador de módulos é o
        # plano_efetivo(), que conta trial+experimental como Pro (plan_guards).
        pedido_plano = str(data.get('plano') or 'trial').lower().strip()
        em_trial = pedido_plano in ('trial', 'experimental') or data.get('plano_status') == 'experimental'
        if em_trial:
            plano_inicial = 'trial'
            plano_status_inicial = 'experimental'
        else:
            plano_inicial = normalize_plan(pedido_plano)
            plano_status_inicial = 'ativo'
        try:
            trial_dias = int(data.get('trial_dias')) if data.get('trial_dias') is not None else 30
        except (TypeError, ValueError):
            trial_dias = 30
        if trial_dias < 1: trial_dias = 1
        if trial_dias > 365: trial_dias = 365
        if em_trial:
            vencimento_plano_inicial = date.today() + timedelta(days=trial_dias)
            if isinstance(data.get('vencimento_plano'), str) and data.get('vencimento_plano'):
                try:
                    vencimento_plano_inicial = datetime.strptime(data['vencimento_plano'], "%Y-%m-%d").date()
                except ValueError:
                    pass
        else:
            vencimento_plano_inicial = None
        logger.info(f"🚀 Iniciando onboarding atômico: {data['nome_fantasia']} (plano={plano_inicial}, status={plano_status_inicial}, vence em {vencimento_plano_inicial})")

        # 1. Criar Estabelecimento

        estabelecimento = Estabelecimento(
            nome_fantasia=data['nome_fantasia'].strip(),
            razao_social=data['razao_social'].strip(),
            cnpj=documento,
            telefone=data['telefone'].strip(),
            email=data['email_estabelecimento'].strip(),
            plano=plano_inicial,
            plano_status=plano_status_inicial,
            vencimento_plano=vencimento_plano_inicial,
            data_abertura=date.today(),
            ativo=True,
            regime_tributario='SIMPLES NACIONAL',
            cep=(data.get('cep') or '00000-000').strip() or '00000-000',
            logradouro=(data.get('logradouro') or 'Nao Informado').strip() or 'Nao Informado',
            numero=(data.get('numero') or 'S/N').strip() or 'S/N',
            bairro=(data.get('bairro') or 'Centro').strip() or 'Centro',
            cidade=(data.get('cidade') or 'Manaus').strip() or 'Manaus',
            estado=(data.get('estado') or 'AM').strip() or 'AM',
            pais='Brasil',
        )
        
        db.session.add(estabelecimento)
        db.session.flush()  # Obter ID do estabelecimento
        logger.info(f"✅ Estabelecimento criado: ID {estabelecimento.id}")

        # 2. Criar Funcionário Administrador
        admin_funcionario = Funcionario(
            estabelecimento_id=estabelecimento.id,
            nome=data['nome_admin'].strip(),
            username=data['email_admin'].strip().split('@')[0],  # Usa parte do email como username
            email=data['email_admin'].strip(),
            cpf=cpf_admin,
            data_nascimento=date(1990, 1, 1),
            celular=(data.get('celular_admin') or data['telefone'].strip()),
            role='ADMIN',
            nivel_acesso=1,  # sem isso cai no default 4 (Caixa) e o PIN/gates de gerente recusam o dono
            cargo='Proprietário',
            salario_base=0.0,  # Define zero para proprietário inicial
            status='ativo',
            ativo=True,
            data_admissao=date.today(),
            data_cadastro=datetime.now(timezone.utc),
            permissoes_json=json.dumps({
                "pdv": True,
                "estoque": True,
                "compras": True,
                "financeiro": True,
                "configuracoes": True,
                "funcionarios": True,
                "relatorios": True
            })
        )
        
        # Senha é opcional: sem ela o dono cria a própria pelo link de ativação.
        import secrets
        admin_funcionario.set_senha(data.get('senha_admin') or secrets.token_urlsafe(24))
        db.session.add(admin_funcionario)
        db.session.flush()
        logger.info(f"✅ Administrador criado: {admin_funcionario.username}")

        # 3. Criar Configuração padrão
        config = Configuracao(
            estabelecimento_id=estabelecimento.id,
            formas_pagamento=json.dumps([
                "Dinheiro", "Pix", "Cartão de Crédito", 
                "Cartão de Débito", "Fiado"
            ]),
            logo_url="https://placehold.co/200x100?text=Logo",
            controlar_validade=True,
            alerta_estoque_minimo=True,
            permitir_venda_sem_estoque=False,
            impressao_automatica=False
        )
        db.session.add(config)
        logger.info(f"✅ Configuração padrão criada")

        # 4. Criar ConfiguraçãoHorario padrão
        config_horario = ConfiguracaoHorario(
            estabelecimento_id=estabelecimento.id,
            hora_entrada=time(8, 0),
            hora_saida_almoco=time(12, 0),
            hora_retorno_almoco=time(13, 0),
            hora_saida=time(18, 0)
        )
        db.session.add(config_horario)
        logger.info(f"✅ Horário comercial criado")

        # 5. Criar Caixa inicial
        caixa = Caixa(
            estabelecimento_id=estabelecimento.id,
            funcionario_id=admin_funcionario.id,
            numero_caixa="PDV-01",
            status="fechado",
            saldo_inicial=0.0,
            saldo_atual=0.0,
            data_abertura=datetime.now(timezone.utc)
        )
        db.session.add(caixa)
        logger.info(f"✅ Caixa inicial criado")

        # 6. Criar Categorias padrão
        categorias_padrao = [
            {"nome": "Geral", "codigo": "CAT001"},
            {"nome": "Bebidas", "codigo": "CAT002"},
            {"nome": "Mercearia", "codigo": "CAT003"}
        ]
        
        for cat_data in categorias_padrao:
            categoria = CategoriaProduto(
                estabelecimento_id=estabelecimento.id,
                nome=cat_data["nome"],
                codigo=cat_data["codigo"],
                ativo=True
            )
            db.session.add(categoria)
        
        logger.info(f"✅ Categorias padrão criadas")

        # Commit da transação atômica
        db.session.commit()
        logger.info(f"🎉 ONBOARDING CONCLUÍDO: {estabelecimento.nome_fantasia}")

        # E-mail de ativação com link de uso único (nunca a senha). O link também
        # volta para o super admin: se o e-mail não chegar, ele manda por WhatsApp.
        from app.services.acesso_conta_service import enviar_ativacao, url_app
        try:
            ativacao = enviar_ativacao(admin_funcionario, estabelecimento.nome_fantasia)
        except Exception as e:
            db.session.rollback()
            logger.warning(f"Loja criada, mas o link de ativação falhou: {type(e).__name__}")
            ativacao = {"enviado": False, "link": None}

        # Retorno sucesso com dados de acesso
        # Security: Sanitize response to ensure no password fields are exposed
        # Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
        from app.utils.response_utils import sanitize_response
        
        return jsonify(sanitize_response({
            "success": True,
            "message": "Ambiente do cliente provisionado com sucesso!",
            "data": {
                "estabelecimento": {
                    "id": estabelecimento.id,
                    "nome_fantasia": estabelecimento.nome_fantasia,
                    "plano": estabelecimento.plano,
                    "plano_status": estabelecimento.plano_status,
                    "vencimento_plano": estabelecimento.vencimento_plano.isoformat() if estabelecimento.vencimento_plano else None,
                    "data_cadastro": estabelecimento.data_cadastro.isoformat() if estabelecimento.data_cadastro else None
                },
                "administrador": {
                    "id": admin_funcionario.id,
                    "nome": admin_funcionario.nome,
                    "username": admin_funcionario.username,
                    "email": admin_funcionario.email,
                    "role": admin_funcionario.role,
                    "cargo": admin_funcionario.cargo
                },
                "acesso": {
                    "login": admin_funcionario.username,
                    "senha": "*****",  # Retorno mascarado por segurança
                    "url_acesso": f"{url_app()}/login"
                },
                "ativacao": {
                    "email_enviado": ativacao["enviado"],
                    "link_ativacao": ativacao["link"],
                    "validade_horas": 72
                },
                "recursos_criados": [
                    "Estabelecimento",
                    "Usuário Administrador", 
                    "Configurações Básicas",
                    "Horário Comercial",
                    "Caixa PDV-01",
                    "3 Categorias de Produtos"
                ]
            }
        })), 201

    except Exception as e:
        # Rollback em caso de qualquer erro
        db.session.rollback()
        logger.error(f"❌ FALHA NO ONBOARDING: {str(e)}")
        
        return jsonify({
            "success": False,
            "error": "Falha ao provisionar ambiente do cliente",
            "details": str(e) if logger.isEnabledFor(logging.DEBUG) else "Erro interno. Contate o suporte."
        }), 500


@saas_bp.route("/tenants/<int:id>/enviar-acesso", methods=["POST"])
@super_admin_required
@limiter.limit("10 per minute")
def enviar_acesso_tenant(id):
    """Gera um novo link de ativação para o admin da loja (invalida o anterior) e tenta enviar por e-mail."""
    from app.models import allow_all_tenants
    from app.services.acesso_conta_service import enviar_ativacao
    estabelecimento = Estabelecimento.query.get(id)
    if not estabelecimento:
        return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404
    # Operação de plataforma: o super admin age sobre o admin de OUTRA loja.
    with allow_all_tenants():
        admin = (Funcionario.query.filter(Funcionario.estabelecimento_id == id, Funcionario.ativo.is_(True),
                                          db.func.upper(Funcionario.role) == "ADMIN")
                 .order_by(Funcionario.id.asc()).first())
    if not admin or not admin.email:
        return jsonify({"success": False, "error": "A loja não tem administrador ativo com e-mail"}), 400
    try:
        ativacao = enviar_ativacao(admin, estabelecimento.nome_fantasia)
    except Exception as e:
        db.session.rollback()
        logger.error(f"Falha ao gerar link de acesso da loja {id}: {type(e).__name__}")
        return jsonify({"success": False, "error": "Não foi possível gerar o link agora"}), 500
    logger.info(f"Link de acesso gerado para a loja {id} (e-mail enviado={ativacao['enviado']})")
    return jsonify({
        "success": True,
        "email_enviado": ativacao["enviado"],
        "email": admin.email,
        "username": admin.username,
        "link_ativacao": ativacao["link"],
        "validade_horas": 72,
        "message": ("Link enviado para " + admin.email) if ativacao["enviado"]
                   else "E-mail não configurado ou falhou: copie o link e envie ao cliente.",
    }), 200


@saas_bp.route("/ativar-tenant/<int:id>", methods=["POST"])
@super_admin_required
def ativar_tenant(id):
    """
    Ativa um estabelecimento (Tenant) e seus usuários após aprovação
    """
    try:
        estabelecimento = Estabelecimento.query.get(id)
        if not estabelecimento:
            return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404
        
        # 1. Ativar Estabelecimento
        estabelecimento.ativo = True
        estabelecimento.plano_status = 'ativo'
        
        # 2. Ativar Funcionários do Estabelecimento
        funcionarios = Funcionario.query.filter_by(estabelecimento_id=id).all()
        for f in funcionarios:
            f.ativo = True
            if f.status == 'pendente':
                f.status = 'ativo'
        
        db.session.commit()
        _invalidar_cache_plano(id)

        logger.info(f"🔓 TENANT ATIVADO: {estabelecimento.nome_fantasia} (ID: {id})")
        
        return jsonify({
            "success": True, 
            "message": f"Estabelecimento '{estabelecimento.nome_fantasia}' e seus usuários foram ativados com sucesso."
        }), 200
        
    except Exception as e:
        db.session.rollback()
        logger.error(f"Erro ao ativar tenant {id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@saas_bp.route("/inativar-tenant/<int:id>", methods=["POST"])
@super_admin_required
def inativar_tenant(id):
    """
    Inativa (suspende) um estabelecimento e seus usuários. Super Admins não são
    desativados, para o dono da plataforma nunca perder o acesso.
    """
    try:
        estabelecimento = Estabelecimento.query.get(id)
        if not estabelecimento:
            return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404

        estabelecimento.ativo = False
        estabelecimento.plano_status = 'suspenso'

        funcionarios = Funcionario.query.filter_by(estabelecimento_id=id).all()
        for f in funcionarios:
            if not getattr(f, 'is_super_admin', False):
                f.ativo = False

        db.session.commit()
        _invalidar_cache_plano(id)
        logger.info(f"🔒 TENANT INATIVADO: {estabelecimento.nome_fantasia} (ID: {id})")
        return jsonify({
            "success": True,
            "message": f"Estabelecimento '{estabelecimento.nome_fantasia}' foi inativado."
        }), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Erro ao inativar tenant {id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== SUBSCRIPTION & PAYMENTS ====================


@saas_bp.route("/trial-status", methods=["GET"])
@jwt_required()
def trial_status():
    """
    Status do período de teste do estabelecimento logado. Usado pelos modais de
    aviso de vencimento (10/5/1 dias) e pelo bloqueio pós-vencimento.
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        eid = get_authorized_establishment_id()
        if not eid:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400
        if str(eid).lower() == 'all':
            return jsonify({"success": True, "data": None}), 200

        est = Estabelecimento.query.get(eid)
        if not est:
            return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404

        venc = est.vencimento_plano
        dias = (venc - date.today()).days if venc else None
        em_trial = (est.plano_status == 'experimental')
        vencido = (dias is not None and dias < 0)

        return jsonify({
            "success": True,
            "data": {
                "plano": est.plano,
                "plano_status": est.plano_status,
                "ativo": bool(est.ativo),
                "vencimento_plano": venc.isoformat() if venc else None,
                "dias_restantes": dias,
                "em_trial": em_trial,
                "vencido": vencido,
            }
        }), 200

    except Exception as e:
        logger.error(f"Erro em trial_status: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@saas_bp.route("/assinatura/status", methods=["GET"])
@jwt_required()
def get_assinatura_status():
    """Retorna o status do plano do estabelecimento atual via utilitário safe"""
    try:
        from app.utils.query_helpers import get_estabelecimento_safe
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        # Usa o utilitário centralizado que é blindado contra colunas ausentes
        dados = get_estabelecimento_safe(estabelecimento_id)

        if not dados:
            return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404

        vencimento = dados.get("vencimento_assinatura")
        plano_status_val = dados.get("plano_status", "experimental")

        return jsonify({
            "success": True,
            "data": {
                "plano": dados.get("plano", "Gratuito"),
                "status": plano_status_val,
                "vencimento": vencimento.isoformat() if vencimento and hasattr(vencimento, 'isoformat') else None,
                "is_active": plano_status_val in ["ativo", "experimental"],
                "nome_estabelecimento": dados.get("nome_fantasia"),
            }
        }), 200

    except Exception as e:
        logger.error(f"Erro ao buscar status de assinatura: {e}")
        return jsonify({"success": False, "error": str(e)}), 500





@saas_bp.route("/monitor/estabelecimentos", methods=["GET"])
@jwt_required()
def listar_estabelecimentos_monitor():
    """
    Lista todos os estabelecimentos para o Seletor de Unidades (Super-Admin)
    """
    try:
        claims = get_jwt()
        if not claims.get("is_super_admin"):
            return jsonify({"success": False, "error": "Acesso restrito"}), 403
            
        estabelecimentos = Estabelecimento.query.all()
        
        # Security: Sanitize response to ensure no password fields are exposed
        # Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
        from app.utils.response_utils import sanitize_response
        return jsonify(sanitize_response({
            "success": True,
            "estabelecimentos": [e.to_dict() for e in estabelecimentos]
        })), 200
    except Exception as e:
        logger.error(f"Erro ao listar estabelecimentos monitor: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@saas_bp.route("/estabelecimentos/<int:id>/plano", methods=["PUT"])
@super_admin_required
def alterar_plano_estabelecimento(id):
    """Altera o plano de um estabelecimento (Apenas Super Admin)"""
    try:
        data = request.get_json()
        if not data or "plano" not in data:
            return jsonify({"success": False, "error": "O campo 'plano' é obrigatório"}), 400
            
        estabelecimento = Estabelecimento.query.get(id)
        if not estabelecimento:
            return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404
            
        estabelecimento.plano = data["plano"]
        if "plano_status" in data:
            estabelecimento.plano_status = data["plano_status"]

        db.session.commit()
        _invalidar_cache_plano(id)

        logger.info(f"🔄 PLANO ALTERADO: Estabelecimento {id} mudou para {estabelecimento.plano}")
        
        # Security: Sanitize response to ensure no password fields are exposed
        # Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
        from app.utils.response_utils import sanitize_response
        return jsonify(sanitize_response({
            "success": True, 
            "message": "Plano atualizado com sucesso",
            "estabelecimento": estabelecimento.to_dict()
        })), 200
    except Exception as e:
        db.session.rollback()
        logger.error(f"Erro ao alterar plano do estabelecimento {id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@saas_bp.route("/estabelecimentos/<int:id>", methods=["PUT"])
@super_admin_required
def update_estabelecimento_admin(id):
    """
    Atualiza os dados de um estabelecimento (Apenas Super Admin)
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Nenhum dado fornecido"}), 400
            
        estabelecimento = Estabelecimento.query.get(id)
        if not estabelecimento:
            return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404
            
        # Atualiza campos permitidos
        campos_permitidos = [
            "nome_fantasia", "razao_social", "cnpj", "inscricao_estadual", "regime_tributario",
            "telefone", "email", "logradouro", "numero", "complemento", "bairro", "cidade", 
            "estado", "cep", "gateway_customer_id", "gateway_subscription_id",
            "plano", "plano_status", "ativo"
        ]
        
        for campo in campos_permitidos:
            if campo in data:
                setattr(estabelecimento, campo, data[campo])
                
        if "vencimento_assinatura" in data:
            if data["vencimento_assinatura"]:
                try:
                    estabelecimento.vencimento_assinatura = datetime.strptime(data["vencimento_assinatura"], "%Y-%m-%d").date()
                except Exception as e:
                    pass
            else:
                estabelecimento.vencimento_assinatura = None

        # Vencimento do plano/trial (data pura): permite ao superadmin prolongar
        # ou encerrar um trial sem mexer no status. Trial vencido bloqueia o
        # tenant no middleware (experimental + vencimento < hoje → 403).
        if "vencimento_plano" in data:
            if data["vencimento_plano"]:
                try:
                    estabelecimento.vencimento_plano = datetime.strptime(data["vencimento_plano"], "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    return jsonify({"success": False, "error": "vencimento_plano inválido (use YYYY-MM-DD)"}), 400
            else:
                estabelecimento.vencimento_plano = None
            _invalidar_cache_plano(id)

        db.session.commit()
        
        logger.info(f"🔄 DADOS ALTERADOS: Estabelecimento {id} atualizado pelo Super Admin.")
        
        from app.utils.response_utils import sanitize_response
        return jsonify(sanitize_response({
            "success": True, 
            "message": "Estabelecimento atualizado com sucesso",
            "estabelecimento": estabelecimento.to_dict()
        })), 200
        
    except Exception as e:
        db.session.rollback()
        logger.error(f"Erro ao atualizar estabelecimento {id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
