# app/routes/onboarding.py
"""
Módulo de Onboarding SaaS
Rotas públicas para registro de novos clientes/lojas (Self-Service).
"""

from datetime import datetime, date, timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from app.models import db, Estabelecimento, Funcionario, Configuracao, Auditoria
from app.utils.response_utils import sanitize_response
import json

onboarding_bp = Blueprint("onboarding", __name__)

# Duração do período de teste gratuito (self-service)
TRIAL_DIAS = 30

from app.decorators.rbac import super_admin_required
from app.utils.timezone import iso_utc

@onboarding_bp.route("/registrar", methods=["POST"])
def registrar_conta():
    """
    Endpoint público para registrar um novo Estabelecimento e seu Usuário Administrador.
    Tudo é feito em uma única transação atômica.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Nenhum dado fornecido"}), 400

        # Dados da Loja (Estabelecimento)
        nome_fantasia = data.get("nome_fantasia")
        razao_social = data.get("razao_social") or nome_fantasia
        cnpj = data.get("cnpj")
        telefone_loja = data.get("telefone_loja")
        email_loja = data.get("email_loja")
        cep = data.get("cep", "00000-000")
        logradouro = data.get("logradouro", "Não informado")
        numero = data.get("numero", "S/N")
        bairro = data.get("bairro", "Não informado")
        cidade = data.get("cidade", "Não informado")
        estado = data.get("estado", "XX")
        
        # Dados do Usuário (Dono/Admin)
        nome_admin = data.get("nome_admin")
        cpf_admin = data.get("cpf_admin")
        celular_admin = data.get("celular_admin")
        email_admin = data.get("email_admin") or email_loja
        username = data.get("username")
        data_nascimento_str = data.get("data_nascimento")

        # Validações Básicas
        if not all([nome_fantasia, cnpj, telefone_loja, email_loja, nome_admin, cpf_admin, celular_admin, username]):
            return jsonify({"success": False, "error": "Dados incompletos. Preencha todos os campos obrigatórios."}), 400

        # Validação de Duplicidade (CNPJ e Username - global)
        if Estabelecimento.query.filter_by(cnpj=cnpj).first():
            return jsonify({"success": False, "error": f"O CNPJ {cnpj} já está registrado no sistema."}), 400
            
        if Funcionario.query.filter_by(username=username).first():
            return jsonify({"success": False, "error": f"O usuário '{username}' já existe. Escolha outro username."}), 400

        data_nascimento = date(1900, 1, 1) # Default
        if data_nascimento_str:
            try:
                data_nascimento = datetime.strptime(data_nascimento_str, "%Y-%m-%d").date()
            except:
                pass

        # Senha definida pelo próprio cliente (self-service). Sem senha → gera temporária.
        # A senha é obrigatória: o envio de credenciais por e-mail não existe de fato, então uma
        # senha gerada pelo sistema nunca chegaria ao dono e a conta ficaria inacessível.
        senha_escolhida = (data.get("senha") or "").strip()
        from app.services.acesso_conta_service import validar_forca_senha
        erro_senha = validar_forca_senha(senha_escolhida)
        if erro_senha:
            return jsonify({"success": False, "error": erro_senha}), 400
        senha_temporaria = senha_escolhida
        senha_foi_gerada = False

        # Não logamos a senha do cliente — apenas o evento.
        current_app.logger.info(f"🔑 [ONBOARDING] Nova conta trial: {username}")

        # Início da Transação Atômica
        try:
            # 1. Criar Estabelecimento
            novo_estabelecimento = Estabelecimento(
                nome_fantasia=nome_fantasia,
                razao_social=razao_social,
                cnpj=cnpj,
                telefone=telefone_loja,
                email=email_loja,
                cep=cep,
                logradouro=logradouro,
                numero=numero,
                bairro=bairro,
                cidade=cidade,
                estado=estado,
                data_abertura=date.today(),
                plano="trial",
                plano_status="experimental",                        # Período de teste self-service
                vencimento_plano=date.today() + timedelta(days=TRIAL_DIAS),
                ativo=True                                          # Trial ativo imediatamente
            )
            db.session.add(novo_estabelecimento)
            db.session.flush()

            # 2. Criar Lead (Marketing/SaaS Control)
            try:
                from app.models import Lead
                novo_lead = Lead(
                    nome=nome_admin,
                    email=email_admin,
                    whatsapp=celular_admin,
                    origem='onboarding_publico',
                    observacao=f"Novo cadastro pendente: {nome_fantasia} (CNPJ: {cnpj})"
                )
                db.session.add(novo_lead)
            except Exception as e_lead:
                current_app.logger.warning(f"Erro ao criar lead no onboarding: {e_lead}")

            # 3. Criar Configuração Padrão
            permissoes_admin = {
                "pdv": True,
                "estoque": True,
                "compras": True,
                "financeiro": True,
                "configuracoes": True,
                "rh": True,
                "pode_dar_desconto": True,
                "limite_desconto": 100,
                "pode_cancelar_venda": True
            }

            nova_config = Configuracao(
                estabelecimento_id=novo_estabelecimento.id,
                emitir_nfe=False,
                emitir_nfce=True,
                arredondamento_valores=True,
                controlar_validade=True,
                alerta_estoque_minimo=True
            )
            db.session.add(nova_config)

            # 3. Criar Funcionário Administrador (Dono)
            novo_admin = Funcionario(
                estabelecimento_id=novo_estabelecimento.id,
                nome=nome_admin,
                cpf=cpf_admin,
                data_nascimento=data_nascimento,
                celular=celular_admin,
                telefone=celular_admin,
                email=email_admin,
                cargo="Propietário",
                data_admissao=date.today(),
                username=username,
                role="ADMIN",
                nivel_acesso=1,  # sem isso cai no default 4 (Caixa) e o PIN/gates de gerente recusam o dono
                status="ativo",
                ativo=True,
                permissoes_json=json.dumps(permissoes_admin)
            )
            novo_admin.set_senha(senha_temporaria)
            db.session.add(novo_admin)
            db.session.flush()

            # Auditoria SaaS (Log de Onboarding)
            Auditoria.registrar(
                estabelecimento_id=novo_estabelecimento.id,
                tipo_evento="estabelecimento_registrado",
                descricao=f"Novo estabelecimento: {nome_fantasia} (CNPJ: {cnpj})",
                usuario_id=novo_admin.id,
                detalhes={"estabelecimento": nome_fantasia, "admin": username, "email": email_admin}
            )

            # Confirmar tudo!
            db.session.commit()

            # Senha gerada pelo sistema: o cliente cria a dele pelo link de ativação
            # (o e-mail nunca leva senha).
            if senha_foi_gerada:
                try:
                    from app.services.acesso_conta_service import enviar_ativacao
                    enviar_ativacao(novo_admin, novo_estabelecimento.nome_fantasia)
                except Exception as email_e:
                    db.session.rollback()
                    current_app.logger.warning(f"Conta criada, mas o link de ativação falhou: {type(email_e).__name__}")

            return jsonify(sanitize_response({
                "success": True,
                "message": f"Conta criada! Seu teste gratuito de {TRIAL_DIAS} dias começou.",
                "estabelecimento_id": novo_estabelecimento.id,
                "username": username,
                # Só devolve a senha quando foi gerada (cliente que escolheu já a conhece).
                "senha_temporaria": senha_temporaria if senha_foi_gerada else None,
                "trial": {
                    "dias": TRIAL_DIAS,
                    "vencimento": iso_utc((date.today() + timedelta(days=TRIAL_DIAS))),
                },
            })), 201

        except Exception as intern_e:
            db.session.rollback()
            current_app.logger.error(f"Erro transacional ao registrar conta SaaS: {str(intern_e)}")
            return jsonify({"success": False, "error": "Erro interno ao processar cadastro. Tente novamente."}), 500

    except Exception as e:
        current_app.logger.error(f"Erro grave no onboarding: {str(e)}")
        return jsonify({"success": False, "error": f"Falha no servidor: {str(e)}"}), 500
