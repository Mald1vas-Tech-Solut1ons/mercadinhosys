import time
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import get_jwt, get_jwt_identity
from app import db
from app.decorators.decorator_jwt import funcionario_required
from app.decorators.plan_guards import plan_required
from app.utils.query_helpers import get_authorized_establishment_id
from app.services.consultor.quota import verificar_quota_consultor, verificar_quota_insight
from app.utils.llm_client import gerar_resposta, llm_disponivel
from app.models import ConsultorInteracao, Funcionario
from app.services.consultor.rag import recuperar_evidencias, mensagens_rag

# Importando os builders
from app.services.consultor.contextos import financeiro, vendas, estoque, rh, compras, geral, clientes, auditoria

consultor_bp = Blueprint("consultor", __name__)

BUILDERS = {
    "financeiro": financeiro.montar_contexto,
    "vendas": vendas.montar_contexto,
    "estoque": estoque.montar_contexto,
    "rh": rh.montar_contexto,
    "compras": compras.montar_contexto,
    "fornecedores": compras.montar_contexto,
    "clientes": clientes.montar_contexto,
    "auditoria": auditoria.montar_contexto,
    "geral": geral.montar_contexto,
}

SYSTEM_PROMPTS = {
    "financeiro": "Você é o Consultor M-IA Financeiro do MercadinhoSys. Fale com o dono da loja de forma EXTREMAMENTE resumida, humana e informal. Vá direto aos números do fluxo de caixa e DRE. PROIBIDO usar 'Além disso', 'Em resumo', 'É importante notar'. Use tópicos curtos e práticos.",
    "vendas": "Você é o Consultor M-IA de Vendas do MercadinhoSys. Seja super direto, curto e humano. Mostre o faturamento e ticket médio sem firulas. PROIBIDO usar frases de IA como 'No entanto' ou 'É importante'. Sugira uma ação prática e rápida baseada nos números.",
    "estoque": "Você é o Consultor M-IA de Estoque do MercadinhoSys. Avise sobre rupturas e produtos parados como um parceiro de negócio de forma super rápida e fácil de ler. PROIBIDO jargões e enrolação. Seja objetivo, em poucas linhas.",
    "rh": "Você é o Consultor M-IA de RH do MercadinhoSys. Mostre os custos com funcionários de forma ultrarresumida e direta. Haja como um colega humano, sem frases feitas. Vá direto ao ponto.",
    "compras": "Você é o Consultor M-IA de Compras do MercadinhoSys. Avalie fornecedores e pedidos de forma informal, curta e precisa. PROIBIDO ser repetitivo ou enfadonho.",
    "fornecedores": "Você é o Consultor M-IA de Fornecedores do MercadinhoSys. Avalie a relação com fornecedores, contas a pagar e prazos de forma informal, curta e precisa. PROIBIDO ser repetitivo ou enfadonho.",
    "clientes": "Você é o Consultor M-IA de Clientes e CRM do MercadinhoSys. Foque no comportamento de compra, clientes VIPs e risco de inadimplência. PROIBIDO ser vago ou robótico. Seja estratégico e humano.",
    "auditoria": "Você é o Consultor M-IA de Segurança e Auditoria do MercadinhoSys. Seu foco é analisar logs de ações dos funcionários, identificar anomalias (estornos, descontos excessivos) e informar o administrador de forma direta e sem jargões complexos.",
    "geral": "Você é o Consultor M-IA Master do MercadinhoSys. REGRAS CRÍTICAS: 1. NUNCA seja enfadonho ou repetitivo. 2. PROIBIDO usar clichês de IA (ex: 'Além disso', 'É importante notar que', 'Em resumo'). 3. Fale como um parceiro de negócios informal e humano. 4. Vá DIRETO aos números cruciais e dê no máximo 3 insights rápidos e práticos em tópicos curtos."
}

def _pode_consultar(role, especialista):
    if role in ('admin', 'gerente'):
        return True
    if role == 'rh':
        return especialista == 'rh'
    return role in ('caixa', 'estoque', 'estoquista', 'repositor', 'operador', 'funcionario', 'vendedor') and especialista in ('estoque', 'vendas')


def _tenant_registro(tenant):
    if tenant != 'all':
        return tenant
    # A visão global não é uma chave estrangeira. Usa a loja do usuário
    # autenticado para quota e auditoria, sem depender do claim de impersonação.
    return db.session.execute(db.select(Funcionario.estabelecimento_id).where(
        Funcionario.id == int(get_jwt_identity())
    )).scalar_one()


def _recuperar(especialista, tenant, is_manager, pergunta):
    try:
        return recuperar_evidencias(especialista, tenant, is_manager, BUILDERS, pergunta)
    except ValueError:
        return {'fontes': []}


@consultor_bp.route("/chat", methods=["POST"], strict_slashes=False)
@funcionario_required
@plan_required('Elite')
def chat_consultor():
    """Recebe mensagem do usuário, injeta contexto determinístico e responde usando LLM."""
    if not llm_disponivel():
        return jsonify({"success": False, "error": "Serviço de IA não configurado."}), 503

    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento inválido."}), 400

    claims = get_jwt()
    registro_est_id = _tenant_registro(estabelecimento_id)
    if not verificar_quota_consultor(registro_est_id):
        return jsonify({"success": False, "error": "Limite diário de interações no chat excedido. Faça upgrade do seu plano."}), 429

    dados = request.get_json() or {}
    especialista = dados.get("especialista", "geral")
    mensagem = dados.get("mensagem")
    provider_solicitado = 'deepseek'

    if not isinstance(mensagem, str) or not mensagem.strip() or len(mensagem) > 4000:
        return jsonify({"success": False, "error": "Mensagem é obrigatória."}), 400

    if especialista not in BUILDERS:
        return jsonify({"success": False, "error": "Especialista desconhecido."}), 400

    # RBAC: Verificação de Cargo (Role)
    claims = get_jwt()
    # Pega a role e garante que esteja em lowercase para validação
    role = str(claims.get('role', 'caixa')).lower()
    
    # Validação de Perfil (RBAC base)
    
    if not _pode_consultar(role, especialista):
        return jsonify({"error": "Acesso negado: Perfil não autorizado"}), 403

    # Define se é gestor
    is_manager = role in ['admin', 'gerente']

    if not is_manager:
        if especialista in ['geral', 'financeiro', 'compras']:
            return jsonify({"success": False, "error": f"Acesso negado. O cargo '{role}' não possui permissão para acessar o painel estratégico '{especialista}'."}), 403
        
        if role == 'rh' and especialista != 'rh':
            return jsonify({"success": False, "error": "Acesso negado. Seu perfil tem permissão apenas para o painel de RH."}), 403
            
        if role in ['caixa', 'estoquista', 'repositor', 'operador', 'funcionario'] and especialista not in ['estoque', 'vendas']:
            return jsonify({"success": False, "error": "Acesso negado. Seu perfil tem permissão apenas para Estoque ou Vendas."}), 403

    start_time = time.time()
    
    # 1. Obter contexto cacheado (passando is_manager para o cache e builder)
    context_data = _recuperar(especialista, estabelecimento_id, is_manager, mensagem)
    if not context_data['fontes']:
        return jsonify({'success': False, 'error': 'Não foi possível recuperar dados confiáveis da loja.'}), 503
    
    # 2. Montar prompt
    sys_prompt = SYSTEM_PROMPTS[especialista]
    mensagens = mensagens_rag(sys_prompt, context_data, mensagem)
    
    # 3. Chamar LLM
    resposta_texto = gerar_resposta(mensagens, provider=provider_solicitado)
    duracao_ms = int((time.time() - start_time) * 1000)
    
    if not resposta_texto:
        return jsonify({"success": False, "error": "Falha ao gerar resposta da IA (provedores indisponíveis)."}), 500
        
    # 4. Salvar Interação
    # Para salvar quem fez a requisição, pegamos do request (caso esteja na flag)
    # A depender do jwt, `request.funcionario_id` estaria preenchido. Assumindo request.user.
    funcionario_id = getattr(request, 'funcionario_id', None) 
    
    interacao = ConsultorInteracao(
        estabelecimento_id=registro_est_id,
        funcionario_id=funcionario_id,
        especialista=especialista,
        pergunta=str(mensagem),
        resposta=resposta_texto,
        provider=provider_solicitado,
        duracao_ms=duracao_ms
    )
    db.session.add(interacao)
    db.session.commit()
    
    return jsonify({
        "success": True,
        "resposta": resposta_texto,
        "interacao_id": interacao.id,
        "duracao_ms": duracao_ms,
        "fontes": [s['fonte'] for s in context_data['fontes']], "provider": 'deepseek'
    }), 200


@consultor_bp.route("/insights", methods=["POST"], strict_slashes=False)
@funcionario_required
@plan_required('Elite')
def gerar_insights():
    """Gera 3 pontos curtos de insight baseados unicamente no contexto atual do especialista."""
    if not llm_disponivel():
        # Fallback suave (sem 500) para cards de insight
        return jsonify({"success": True, "insights": None, "aviso": "IA não configurada"}), 200

    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento inválido."}), 400

    dados = request.get_json() or {}
    especialista = dados.get("especialista", "geral")
    provider_solicitado = 'deepseek'

    claims = get_jwt()
    registro_est_id = _tenant_registro(estabelecimento_id)
    role = str(claims.get('role', 'caixa')).lower()
    is_manager = role in ['admin', 'gerente']
    if especialista not in BUILDERS:
        return jsonify({'success': False, 'error': 'Especialista desconhecido.'}), 400
    if not _pode_consultar(role, especialista):
        return jsonify({'success': False, 'error': 'Acesso negado para este especialista.'}), 403
    if not verificar_quota_insight(registro_est_id):
        # Tenta buscar a última resposta gerada
        ultima = ConsultorInteracao.query.filter_by(
            estabelecimento_id=registro_est_id,
            especialista=f"insight_{especialista}"
        ).order_by(ConsultorInteracao.created_at.desc()).first()
        
        if ultima:
            return jsonify({
                "success": True, 
                "insights": ultima.resposta, 
                "aviso": "Limite diário de atualizações atingido. Mostrando última análise."
            }), 200
            
        return jsonify({"success": False, "error": "Limite diário de atualizações de insight excedido."}), 429

    start_time = time.time()
    
    # 1. Obter contexto cacheado
    context_data = _recuperar(especialista, estabelecimento_id, is_manager, '')
    if not context_data['fontes']:
        return jsonify({'success': True, 'insights': None, 'aviso': 'Dados indisponíveis para análise.'}), 200
    
    # 2. Montar prompt para insight estruturado
    sys_prompt = SYSTEM_PROMPTS[especialista]
    mensagens = mensagens_rag(sys_prompt, context_data,
        'Gere 3 tópicos curtos: destaque, risco e ação recomendada. Cite as fontes e os períodos. '
        'Se não houver um destaque positivo, diga isso. Não invente números.')
    
    resposta_texto = gerar_resposta(mensagens, provider=provider_solicitado, max_tokens=512)
    duracao_ms = int((time.time() - start_time) * 1000)
    
    if not resposta_texto:
        return jsonify({"success": True, "insights": None, "aviso": "Falha na resposta do LLM."}), 200
        
    # Registro de auditoria do insight gerado (Marcamos especialista como insight_...)
    funcionario_id = getattr(request, 'funcionario_id', None)
    interacao = ConsultorInteracao(
        estabelecimento_id=registro_est_id,
        funcionario_id=funcionario_id,
        especialista=f"insight_{especialista}",
        pergunta="Gere os insights agora.",
        resposta=resposta_texto,
        provider=provider_solicitado,
        duracao_ms=duracao_ms
    )
    db.session.add(interacao)
    db.session.commit()
    
    return jsonify({
        "success": True,
        "insights": resposta_texto,
        "duracao_ms": duracao_ms,
        "fontes": [s['fonte'] for s in context_data['fontes']], "provider": 'deepseek'
    }), 200
