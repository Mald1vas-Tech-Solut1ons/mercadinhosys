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

# Duração do período de teste gratuito: 2 meses, o tempo em que a loja é implantada
# junto com o lojista e ele passa a andar sozinho no sistema. A oferta comercial
# (landing e panfleto) promete exatamente isso; mudar aqui muda a promessa.
TRIAL_DIAS = 60

from app.decorators.rbac import super_admin_required
from app.utils.timezone import iso_utc, hoje_local

# Tipo de loja escolhido no cadastro -> (segmento, departamentos iniciais). Antes o cadastro não
# gravava nada disso e toda loja nascia "mercearia" (a loja de artigos religiosos via alimentos
# e bebidas e não via Velas/Imagens). None = mix padrão do segmento.
TIPOS_LOJA = {
    "mercearia": ("mercearia", None),
    "roupas": ("vestuario", None),
    "construcao": ("construcao", None),
    "autopecas": ("autopecas", None),
    "motopecas": ("autopecas", ["motopecas", "autopecas", "servico"]),
    "religioso": ("generico", ["religioso", "perfumaria_higiene", "decoracao", "bazar"]),
    "outro": ("generico", None),
}


def segmento_e_mix(tipo_loja):
    """(segmento, configuracoes iniciais) para o(s) tipo(s) de loja; desconhecido = mercearia.

    Aceita um tipo ou uma lista: loja que vende de tudo (bazar + religioso + motopeças +
    autopeças) nasce "generico" com a SOMA dos departamentos marcados. Depois o dono liga ou
    desliga departamentos em Configurações > Segmento.
    """
    from app.services.view_schema_service import MIX_PADRAO_POR_SEGMENTO
    tipos = tipo_loja if isinstance(tipo_loja, (list, tuple)) else [tipo_loja]
    tipos = [str(t or "").strip().lower() for t in tipos if str(t or "").strip().lower() in TIPOS_LOJA]
    if not tipos:
        return TIPOS_LOJA["mercearia"][0], {}
    if len(tipos) == 1:
        segmento, mix = TIPOS_LOJA[tipos[0]]
        return segmento, ({"mix_produtos": list(mix)} if mix else {})
    soma = []
    for tipo in tipos:
        segmento, mix = TIPOS_LOJA[tipo]
        for familia in (mix or MIX_PADRAO_POR_SEGMENTO.get(segmento, [])):
            if familia not in soma:
                soma.append(familia)
    return "generico", {"mix_produtos": soma}

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
            # 1. Criar Estabelecimento (já no segmento e com os departamentos do tipo de loja)
            segmento_loja, config_inicial = segmento_e_mix(data.get("tipos_loja") or data.get("tipo_loja") or data.get("segmento"))
            novo_estabelecimento = Estabelecimento(
                segmento=segmento_loja,
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
                data_abertura=hoje_local(),
                plano="trial",
                plano_status="experimental",                        # Período de teste self-service
                vencimento_plano=hoje_local() + timedelta(days=TRIAL_DIAS),
                ativo=True                                          # Trial ativo imediatamente
            )
            if config_inicial:
                novo_estabelecimento.configuracoes = config_inicial
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
                data_admissao=hoje_local(),
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

            # Todo cadastro de teste vira lead no CRM (etapa "teste"), ligado à loja e,
            # se o visitante aceitou cookies, à origem e à jornada dele no site.
            from app.models import Lead
            from app.routes.site_crm import vincular_visitante, registrar_historico
            lead = Lead(
                nome=str(data.get("nome_admin") or nome_fantasia)[:150], email=str(email_admin or "")[:100],
                whatsapp=str(celular_admin or "")[:30], origem="cadastro_teste", etapa="teste",
                nome_loja=str(nome_fantasia)[:150], loja_criada_id=novo_estabelecimento.id,
                segmento=(",".join(data["tipos_loja"]) if isinstance(data.get("tipos_loja"), list) and data["tipos_loja"] else str(data.get("tipo_loja") or data.get("segmento") or ""))[:60] or None,
            )
            db.session.add(lead)
            db.session.flush()
            vincular_visitante(lead, data.get("visitante_id"))
            registrar_historico(lead.id, "sistema", f"Criou a conta de teste ({TRIAL_DIAS} dias).")

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
                    "vencimento": iso_utc((hoje_local() + timedelta(days=TRIAL_DIAS))),
                },
            })), 201

        except Exception as intern_e:
            db.session.rollback()
            current_app.logger.error(f"Erro transacional ao registrar conta SaaS: {str(intern_e)}")
            return jsonify({"success": False, "error": "Erro interno ao processar cadastro. Tente novamente."}), 500

    except Exception as e:
        current_app.logger.error(f"Erro grave no onboarding: {str(e)}")
        return jsonify({"success": False, "error": f"Falha no servidor: {str(e)}"}), 500
