import time
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import get_jwt, get_jwt_identity
from app import db
from app.decorators.decorator_jwt import funcionario_required
from app.decorators.plan_guards import plan_required
from app.utils.query_helpers import get_authorized_establishment_id
from app.utils.timezone import hoje_local, local_date_to_utc_naive, iso_utc
from app.services.consultor.quota import (
    verificar_quota_consultor,
    verificar_quota_insight,
)
from app.utils.llm_client import (
    gerar_resposta as _gerar_resposta_original,
    gerar_resposta_com_meta,
    llm_disponivel,
)
from app.models import Configuracao, ConsultorInteracao, Funcionario
from app.services.consultor.rag import recuperar_evidencias, mensagens_rag
from app.services.consultor.acoes import (
    executar_acao_confirmada,
    obter_resumo_diario_cache,
    salvar_resumo_diario_cache,
    sugerir_acoes,
)

# Mantém referência pública para testes que fazem monkeypatch de `routes.gerar_resposta`
gerar_resposta = _gerar_resposta_original

# Importando os builders
from app.services.consultor.contextos import (
    financeiro,
    vendas,
    estoque,
    rh,
    compras,
    geral,
    clientes,
    auditoria,
    sistema,
)

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
    "sistema": sistema.montar_contexto,
}

DESCRICAO_FONTES: dict[str, dict[str, str]] = {
    "financeiro": {
        "fonte": "financeiro",
        "titulo": "Financeiro e Fluxo de Caixa",
        "descricao": "Contas a pagar/receber, despesas e vendas concluídas dos últimos 30 dias",
    },
    "vendas": {
        "fonte": "vendas",
        "titulo": "Vendas e PDV",
        "descricao": "Cupons concluídos, ticket médio e ranking de produtos vendidos (30 dias)",
    },
    "estoque": {
        "fonte": "estoque",
        "titulo": "Estoque e Lotes",
        "descricao": "Saldos físicos atuais, curva ABC (90 dias), rupturas, validade e itens sem giro",
    },
    "rh": {
        "fonte": "rh",
        "titulo": "Equipe e Ponto (Pseudonimizado)",
        "descricao": "Folha salarial agregada, ponto eletrônico do dia e desempenho por ID anônimo",
    },
    "compras": {
        "fonte": "compras",
        "titulo": "Compras e Reposição",
        "descricao": "Produtos abaixo do estoque mínimo, pedidos de compra e histórico de fornecedores",
    },
    "fornecedores": {
        "fonte": "fornecedores",
        "titulo": "Fornecedores e Prazos",
        "descricao": "Cadastro de fornecedores ativos, prazos médios e títulos em aberto",
    },
    "clientes": {
        "fonte": "clientes",
        "titulo": "Clientes e Crediário (Pseudonimizado)",
        "descricao": "Base ativa, fiado/crediário e maiores compradores por ID anônimo",
    },
    "auditoria": {
        "fonte": "auditoria",
        "titulo": "Auditoria e Prevenção de Perdas",
        "descricao": "Eventos sensíveis recentes (cancelamentos, descontos e ajustes) por ID anônimo",
    },
    "geral": {
        "fonte": "geral",
        "titulo": "Visão Geral da Loja",
        "descricao": "Consolidação de vendas, caixa, estoque e alertas operacionais do estabelecimento",
    },
    "sistema": {
        "fonte": "sistema",
        "titulo": "Manual e Regras do Sistema",
        "descricao": "Guia de operação de telas, cadastro de produtos, regras fiscais e relatórios do MercadinhoSys",
    },
}

SYSTEM_PROMPTS = {
    "financeiro": (
        "Você é o Consultor da Loja especialista em Finanças e Caixa. "
        "Converse com o lojista em português simples, direto e prático. "
        "Destaque em tópicos curtos a receita, as despesas, o resultado do mês e os boletos que exigem atenção imediata."
    ),
    "vendas": (
        "Você é o Consultor da Loja especialista em Vendas e Balcão. "
        "Apresente o faturamento, o ticket médio e os produtos campeões de forma objetiva e proponha 1 ação comercial prática para hoje."
    ),
    "estoque": (
        "Você é o Consultor da Loja especialista em Estoque e Giro. "
        "Aponte com clareza os itens Classe A em ruptura, os alertas de estoque mínimo e o dinheiro parado em mercadoria sem giro."
    ),
    "rh": (
        "Você é o Consultor da Loja especialista em Equipe e Folha. "
        "Resuma o peso da folha sobre o faturamento, horas extras e pontualidade usando apenas os identificadores pseudonimizados (Funcionário #ID)."
    ),
    "compras": (
        "Você é o Consultor da Loja especialista em Compras e Reposição. "
        "Destaque os itens abaixo do mínimo com seu respectivo fornecedor e último custo para facilitar o pedido de reposição."
    ),
    "fornecedores": (
        "Você é o Consultor da Loja especialista em Fornecedores e Prazos. "
        "Analise os volumes comprados, prazos de entrega e boletos em aberto por fornecedor de forma objetiva."
    ),
    "clientes": (
        "Você é o Consultor da Loja especialista em Clientes e Crediário. "
        "Destaque a recorrência dos melhores compradores e os saldos devedores em aberto usando os identificadores pseudonimizados (Cliente #ID)."
    ),
    "auditoria": (
        "Você é o Consultor da Loja especialista em Prevenção de Perdas e Auditoria. "
        "Analise os registros recentes de eventos sensíveis (estornos, cancelamentos, ajustes) de forma direta para o gestor."
    ),
    "geral": (
        "Você é o Consultor da Loja, braço direito do dono do mercadinho. "
        "Apresente os números cruciais de vendas, caixa e estoque sem rodeios e entregue até 3 ações práticas priorizadas pelo impacto no caixa."
    ),
    "sistema": (
        "Você é o Consultor da Loja e Especialista de Suporte Operacional do MercadinhoSys. "
        "Explique passo a passo como usar o sistema, como cadastrar qualquer produto (indicando a Família, Subcategoria e NCM sugeridos na fonte [sistema]), "
        "como emitir relatórios ou resolver dúvidas operacionais sem precisar chamar o suporte externo."
    ),
}

# Cache server-side para /insights (TTL 300s) para que a montagem de InsightCards não queime cota
_INSIGHTS_CACHE_TTL_SEGUNDOS = 300
_INSIGHTS_CACHE: dict[tuple[int, str, bool], tuple[float, dict, int | None]] = {}

_TERMOS_RELATORIO = (
    "relatorio",
    "exportar",
    "emitir relatorio",
    "fechamento",
    "balanco",
    "planilha",
    "pdf",
)


def _normalizar_texto(texto: str) -> str:
    sem_acentos = "".join(
        c for c in unicodedata.normalize("NFD", str(texto or "")) if unicodedata.category(c) != "Mn"
    )
    return sem_acentos.lower()


def _pede_relatorio(mensagem: str) -> bool:
    norm = _normalizar_texto(mensagem)
    return any(t in norm for t in _TERMOS_RELATORIO)


def _montar_relatorio_estruturado(
    estabelecimento_id: int,
    is_manager: bool,
    mensagem: str,
) -> dict | None:
    """Monta um relatório estruturado determinístico (KPIs + tabelas) quando o usuário pede emissão de relatório."""
    if not _pede_relatorio(mensagem):
        return None

    dados_vendas = vendas.montar_contexto(estabelecimento_id, is_manager=is_manager) or {}
    dados_estoque = estoque.montar_contexto(estabelecimento_id, is_manager=is_manager) or {}
    dados_fin = financeiro.montar_contexto(estabelecimento_id, is_manager=True) if is_manager else {}

    resumo_v = dados_vendas.get("resumo_30_dias") or {}
    fat_30d = float(resumo_v.get("faturamento_total") or 0.0)
    cupons_30d = int(resumo_v.get("total_cupons") or 0)
    ticket_30d = float(resumo_v.get("ticket_medio") or 0.0)

    resumo_kpis = [
        {
            "label": "Faturamento (30d)",
            "valor": f"R$ {fat_30d:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."),
            "fonte": "vendas",
        },
        {
            "label": "Cupons Concluídos (30d)",
            "valor": str(cupons_30d),
            "fonte": "vendas",
        },
        {
            "label": "Ticket Médio (30d)",
            "valor": f"R$ {ticket_30d:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."),
            "fonte": "vendas",
        },
    ]

    linhas_resumo = [
        ["Faturamento Bruto (30 dias)", f"R$ {fat_30d:.2f}"],
        ["Total de Vendas / Cupons (30 dias)", str(cupons_30d)],
        ["Ticket Médio (30 dias)", f"R$ {ticket_30d:.2f}"],
    ]

    if is_manager and dados_fin:
        dre = dados_fin.get("dre_30_dias") or {}
        cp = dados_fin.get("contas_pagar") or {}
        cr = dados_fin.get("contas_receber") or {}
        res_op = float(dre.get("resultado_operacional") or 0.0)
        desp_tot = float(dre.get("despesas_totais") or 0.0)
        vencido_pagar = float(cp.get("vencido") or 0.0)
        aberto_receber = float(cr.get("em_aberto") or 0.0)

        resumo_kpis.append({
            "label": "Resultado Operacional (30d)",
            "valor": f"R$ {res_op:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."),
            "fonte": "financeiro",
        })
        linhas_resumo.extend([
            ["Despesas Totais (30 dias)", f"R$ {desp_tot:.2f}"],
            ["Resultado Operacional (30 dias)", f"R$ {res_op:.2f}"],
            ["Contas a Pagar Vencidas", f"R$ {vencido_pagar:.2f}"],
            ["Contas a Receber em Aberto", f"R$ {aberto_receber:.2f}"],
        ])

    tabelas = [
        {
            "titulo": "Indicadores Consolidados (30 dias)",
            "colunas": ["Indicador", "Valor"],
            "linhas": linhas_resumo,
        }
    ]

    top_produtos = dados_vendas.get("top_produtos") or []
    if top_produtos:
        tabelas.append({
            "titulo": "Top Produtos Vendidos (30 dias)",
            "colunas": ["Produto", "Qtd Vendida", "Total Vendido (R$)"],
            "linhas": [
                [
                    str(p.get("produto") or "-"),
                    str(p.get("qtd_vendida") or 0),
                    f"R$ {float(p.get('total_vendido') or 0):.2f}",
                ]
                for p in top_produtos[:10]
            ],
        })

    alertas_min = dados_estoque.get("alertas_estoque_minimo") or []
    if alertas_min:
        tabelas.append({
            "titulo": "Produtos Abaixo do Estoque Mínimo",
            "colunas": ["Produto", "Estoque Atual", "Estoque Mínimo", "Preço Venda (R$)"],
            "linhas": [
                [
                    str(item.get("produto") or "-"),
                    str(item.get("atual") or 0),
                    str(item.get("minimo") or 0),
                    f"R$ {float(item.get('preco_venda') or 0):.2f}",
                ]
                for item in alertas_min[:15]
            ],
        })

    return {
        "titulo": "Relatório Gerencial — Consultor da Loja",
        "gerado_em": iso_utc(datetime.now(timezone.utc)),
        "resumo_kpis": resumo_kpis,
        "tabelas": tabelas,
    }


def limpar_cache_insights() -> None:
    """Limpa o cache server-side de insights (usado em testes e invalidações)."""
    _INSIGHTS_CACHE.clear()


def _obter_insight_cache(estabelecimento_id: int, especialista: str, is_manager: bool) -> dict | None:
    chave = (int(estabelecimento_id), str(especialista), bool(is_manager))
    item = _INSIGHTS_CACHE.get(chave)
    if not item:
        return None
    expira_em, payload, interacao_id = item
    if time.time() >= expira_em:
        _INSIGHTS_CACHE.pop(chave, None)
        return None
    if interacao_id is not None and db.session.get(ConsultorInteracao, interacao_id) is None:
        _INSIGHTS_CACHE.pop(chave, None)
        return None
    copia = dict(payload)
    copia["cached"] = True
    return copia


def _salvar_insight_cache(
    estabelecimento_id: int,
    especialista: str,
    is_manager: bool,
    payload: dict,
    interacao_id: int | None = None,
) -> None:
    chave = (int(estabelecimento_id), str(especialista), bool(is_manager))
    _INSIGHTS_CACHE[chave] = (
        time.time() + _INSIGHTS_CACHE_TTL_SEGUNDOS,
        dict(payload),
        interacao_id,
    )


def _detalhar_fontes(fontes: list[str]) -> list[dict[str, str]]:
    detalhes = []
    for f in fontes:
        info = DESCRICAO_FONTES.get(
            f,
            {
                "fonte": str(f),
                "titulo": f"Dados de {f}",
                "descricao": f"Registros internos do módulo {f} do estabelecimento",
            },
        )
        detalhes.append(dict(info))
    return detalhes


def _ia_ativa_na_loja(estabelecimento_id: int) -> bool:
    """Verifica se o Consultor da Loja (IA) está ativo nas configurações LGPD do estabelecimento."""
    try:
        cfg = (
            db.session.query(Configuracao.ai_consultor_ativo)
            .filter(Configuracao.estabelecimento_id == int(estabelecimento_id))
            .first()
        )
        if cfg is None or cfg[0] is None:
            return True
        return bool(cfg[0])
    except Exception:
        return True


def _pode_consultar(role, especialista):
    if especialista == "sistema":
        return True
    if role in ("admin", "gerente"):
        return True
    if role == "rh":
        return especialista == "rh"
    return (
        role in ("caixa", "estoque", "estoquista", "repositor", "operador", "funcionario", "vendedor")
        and especialista in ("estoque", "vendas")
    )


def _funcionario_id_atual() -> int | None:
    """Extrai o ID real do funcionário autenticado via JWT (com fallback para request.funcionario_id)."""
    try:
        ident = get_jwt_identity()
        if ident is not None:
            return int(ident)
    except (ValueError, TypeError, RuntimeError):
        pass
    val = getattr(request, "funcionario_id", None)
    try:
        return int(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def _tenant_registro(tenant):
    if tenant != "all":
        return tenant
    return db.session.execute(
        db.select(Funcionario.estabelecimento_id).where(Funcionario.id == int(get_jwt_identity()))
    ).scalar_one()


def _recuperar(especialista, tenant, is_manager, pergunta):
    try:
        return recuperar_evidencias(especialista, tenant, is_manager, BUILDERS, pergunta)
    except ValueError:
        return {"fontes": []}


def _chamar_llm(mensagens: list[dict], provider_solicitado: str, max_tokens: int = 1024) -> dict | None:
    """Executa a chamada LLM retornando metadados reais de provedor, tokens e custo.
    Preserva compatibilidade caso um teste faça monkeypatch de `routes.gerar_resposta`.
    """
    if gerar_resposta is not _gerar_resposta_original:
        texto = gerar_resposta(mensagens, provider=provider_solicitado, max_tokens=max_tokens)
        if not texto:
            return None
        return {
            "texto": texto,
            "provider": provider_solicitado,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "custo_estimado_usd": 0.0,
        }
    return gerar_resposta_com_meta(mensagens, provider=provider_solicitado, max_tokens=max_tokens)


@consultor_bp.route("/chat", methods=["POST"], strict_slashes=False)
@funcionario_required
@plan_required("Elite")
def chat_consultor():
    """Recebe mensagem do usuário, injeta contexto determinístico e responde usando LLM."""
    if not llm_disponivel():
        return jsonify({"success": False, "error": "Serviço de IA não configurado."}), 503

    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento inválido."}), 400

    claims = get_jwt()
    registro_est_id = _tenant_registro(estabelecimento_id)

    if not _ia_ativa_na_loja(registro_est_id):
        return (
            jsonify({
                "success": False,
                "error": "Consultor da Loja desativado nas configurações de privacidade (LGPD).",
                "code": "AI_OPTED_OUT",
            }),
            403,
        )

    if not verificar_quota_consultor(registro_est_id):
        return (
            jsonify({
                "success": False,
                "error": "Limite diário de interações no chat excedido. Faça upgrade do seu plano.",
            }),
            429,
        )

    dados = request.get_json() or {}
    especialista = dados.get("especialista", "geral")
    mensagem = dados.get("mensagem")
    provider_solicitado = "deepseek"

    if not isinstance(mensagem, str) or not mensagem.strip() or len(mensagem) > 4000:
        return jsonify({"success": False, "error": "Mensagem é obrigatória."}), 400

    if especialista not in BUILDERS:
        return jsonify({"success": False, "error": "Especialista desconhecido."}), 400

    role = str(claims.get("role", "caixa")).lower()

    if not _pode_consultar(role, especialista):
        return jsonify({"error": "Acesso negado: Perfil não autorizado"}), 403

    is_manager = role in ["admin", "gerente"]

    if not is_manager and especialista != "sistema":
        if especialista in ["geral", "financeiro", "compras"]:
            return (
                jsonify({
                    "success": False,
                    "error": f"Acesso negado. O cargo '{role}' não possui permissão para acessar o painel estratégico '{especialista}'.",
                }),
                403,
            )

        if role == "rh" and especialista != "rh":
            return (
                jsonify({
                    "success": False,
                    "error": "Acesso negado. Seu perfil tem permissão apenas para o painel de RH.",
                }),
                403,
            )

        if role in ["caixa", "estoquista", "repositor", "operador", "funcionario"] and especialista not in [
            "estoque",
            "vendas",
        ]:
            return (
                jsonify({
                    "success": False,
                    "error": "Acesso negado. Seu perfil tem permissão apenas para Estoque ou Vendas.",
                }),
                403,
            )

    start_time = time.time()

    # 1. Obter contexto cacheado (passando is_manager para o cache e builder)
    context_data = _recuperar(especialista, estabelecimento_id, is_manager, mensagem)
    if not context_data["fontes"]:
        return jsonify({"success": False, "error": "Não foi possível recuperar dados confiáveis da loja."}), 503

    # 2. Montar prompt
    sys_prompt = SYSTEM_PROMPTS[especialista]
    mensagens = mensagens_rag(sys_prompt, context_data, mensagem)

    # 3. Chamar LLM com fallback e telemetria real
    eh_relatorio = _pede_relatorio(mensagem)
    meta = _chamar_llm(mensagens, provider_solicitado, max_tokens=1536 if eh_relatorio else 1024)
    duracao_ms = int((time.time() - start_time) * 1000)

    if not meta or not meta.get("texto"):
        return jsonify({"success": False, "error": "Falha ao gerar resposta da IA (provedores indisponíveis)."}), 500

    resposta_texto = meta["texto"]
    provider_efetivo = meta.get("provider") or provider_solicitado
    prompt_tokens = int(meta.get("prompt_tokens") or 0)
    completion_tokens = int(meta.get("completion_tokens") or 0)
    custo_usd = Decimal(str(meta.get("custo_estimado_usd") or 0))

    # 4. Salvar Interação com autor e telemetria reais
    funcionario_id = _funcionario_id_atual()

    interacao = ConsultorInteracao(
        estabelecimento_id=registro_est_id,
        funcionario_id=funcionario_id,
        especialista=especialista,
        pergunta=str(mensagem),
        resposta=resposta_texto,
        provider=provider_efetivo,
        duracao_ms=duracao_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        custo_estimado_usd=custo_usd,
    )
    db.session.add(interacao)
    db.session.commit()

    acoes = sugerir_acoes(
        registro_est_id,
        especialista=especialista,
        is_manager=is_manager,
        pergunta=mensagem,
    )
    lista_fontes = [s["fonte"] for s in context_data["fontes"]]
    relatorio_estruturado = _montar_relatorio_estruturado(
        int(registro_est_id),
        is_manager=is_manager,
        mensagem=mensagem,
    )

    payload_resp = {
        "success": True,
        "resposta": resposta_texto,
        "interacao_id": interacao.id,
        "duracao_ms": duracao_ms,
        "fontes": lista_fontes,
        "fontes_detalhadas": _detalhar_fontes(lista_fontes),
        "provider": provider_efetivo,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "acoes_sugeridas": acoes,
    }
    if relatorio_estruturado is not None:
        payload_resp["relatorio_estruturado"] = relatorio_estruturado

    return jsonify(payload_resp), 200


@consultor_bp.route("/insights", methods=["POST"], strict_slashes=False)
@funcionario_required
@plan_required("Elite")
def gerar_insights():
    """Gera 3 pontos curtos de insight baseados unicamente no contexto atual do especialista."""
    if not llm_disponivel():
        return jsonify({"success": True, "insights": None, "aviso": "IA não configurada"}), 200

    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento inválido."}), 400

    dados = request.get_json() or {}
    especialista = dados.get("especialista", "geral")
    force_refresh = bool(dados.get("force_refresh", False))
    provider_solicitado = "deepseek"

    claims = get_jwt()
    registro_est_id = _tenant_registro(estabelecimento_id)
    role = str(claims.get("role", "caixa")).lower()
    is_manager = role in ["admin", "gerente"]
    if especialista not in BUILDERS:
        return jsonify({"success": False, "error": "Especialista desconhecido."}), 400
    if not _pode_consultar(role, especialista):
        return jsonify({"success": False, "error": "Acesso negado para este especialista."}), 403

    if not _ia_ativa_na_loja(registro_est_id):
        return (
            jsonify({
                "success": True,
                "insights": None,
                "aviso": "Consultor da Loja desativado nas configurações de privacidade (LGPD).",
                "cached": False,
            }),
            200,
        )

    # Cache server-side (TTL 300s): evita que a montagem de InsightCards queime cota ou chame LLM
    if not force_refresh:
        cached_payload = _obter_insight_cache(registro_est_id, especialista, is_manager)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

    if not verificar_quota_insight(registro_est_id):
        ultima = (
            ConsultorInteracao.query.filter_by(
                estabelecimento_id=registro_est_id,
                especialista=f"insight_{especialista}",
            )
            .order_by(ConsultorInteracao.created_at.desc())
            .first()
        )

        if ultima:
            return (
                jsonify({
                    "success": True,
                    "insights": ultima.resposta,
                    "aviso": "Limite diário de atualizações atingido. Mostrando última análise.",
                    "acoes_sugeridas": sugerir_acoes(registro_est_id, especialista=especialista, is_manager=is_manager),
                }),
                200,
            )

        return jsonify({"success": False, "error": "Limite diário de atualizações de insight excedido."}), 429

    start_time = time.time()

    # 1. Obter contexto cacheado
    context_data = _recuperar(especialista, estabelecimento_id, is_manager, "")
    if not context_data["fontes"]:
        return jsonify({"success": True, "insights": None, "aviso": "Dados indisponíveis para análise."}), 200

    # 2. Montar prompt para insight estruturado
    sys_prompt = SYSTEM_PROMPTS[especialista]
    mensagens = mensagens_rag(
        sys_prompt,
        context_data,
        "Gere 3 tópicos curtos: destaque, risco e ação recomendada. Cite as fontes e os períodos. "
        "Se não houver um destaque positivo, diga isso. Não invente números.",
    )

    meta = _chamar_llm(mensagens, provider_solicitado, max_tokens=512)
    duracao_ms = int((time.time() - start_time) * 1000)

    if not meta or not meta.get("texto"):
        return jsonify({"success": True, "insights": None, "aviso": "Falha na resposta do LLM."}), 200

    resposta_texto = meta["texto"]
    provider_efetivo = meta.get("provider") or provider_solicitado
    prompt_tokens = int(meta.get("prompt_tokens") or 0)
    completion_tokens = int(meta.get("completion_tokens") or 0)
    custo_usd = Decimal(str(meta.get("custo_estimado_usd") or 0))

    # Registro de auditoria do insight gerado
    funcionario_id = _funcionario_id_atual()
    interacao = ConsultorInteracao(
        estabelecimento_id=registro_est_id,
        funcionario_id=funcionario_id,
        especialista=f"insight_{especialista}",
        pergunta="Gere os insights agora.",
        resposta=resposta_texto,
        provider=provider_efetivo,
        duracao_ms=duracao_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        custo_estimado_usd=custo_usd,
    )
    db.session.add(interacao)
    db.session.commit()

    lista_fontes = [s["fonte"] for s in context_data["fontes"]]
    payload = {
        "success": True,
        "insights": resposta_texto,
        "duracao_ms": duracao_ms,
        "fontes": lista_fontes,
        "fontes_detalhadas": _detalhar_fontes(lista_fontes),
        "provider": provider_efetivo,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cached": False,
        "acoes_sugeridas": sugerir_acoes(registro_est_id, especialista=especialista, is_manager=is_manager),
    }
    _salvar_insight_cache(registro_est_id, especialista, is_manager, payload, interacao_id=interacao.id)
    return jsonify(payload), 200


@consultor_bp.route("/resumo-diario", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required("Elite")
def resumo_diario_proativo():
    """Resumo diário proativo do Consultor da Loja (cacheado por dia em Brasília)."""
    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento inválido."}), 400

    claims = get_jwt()
    role = str(claims.get("role", "caixa")).lower()
    is_manager = role in ("admin", "gerente", "dono", "proprietario", "master")
    if not is_manager:
        return jsonify({"success": False, "error": "Resumo diário restrito à gerência da loja."}), 403

    registro_est_id = _tenant_registro(estabelecimento_id)
    if not _ia_ativa_na_loja(registro_est_id):
        return (
            jsonify({
                "success": True,
                "resumo": None,
                "aviso": "Consultor da Loja desativado nas configurações de privacidade (LGPD).",
            }),
            200,
        )

    force_refresh = str(request.args.get("force", "")).lower() in ("1", "true", "sim")

    if not force_refresh:
        cached = obter_resumo_diario_cache(registro_est_id)
        if cached:
            retorno = dict(cached)
            retorno["cached"] = True
            retorno["acoes_sugeridas"] = sugerir_acoes(registro_est_id, especialista="geral", is_manager=True)
            return jsonify(retorno), 200

    if not llm_disponivel():
        return (
            jsonify({
                "success": True,
                "resumo": None,
                "aviso": "IA não configurada",
                "acoes_sugeridas": sugerir_acoes(registro_est_id, especialista="geral", is_manager=True),
            }),
            200,
        )

    start_time = time.time()
    context_data = _recuperar("geral", estabelecimento_id, True, "resumo diário vendas financeiro estoque compras")
    if not context_data["fontes"]:
        return jsonify({"success": True, "resumo": None, "aviso": "Dados indisponíveis para o resumo."}), 200

    mensagens = mensagens_rag(
        SYSTEM_PROMPTS["geral"],
        context_data,
        "Comece com 'Bom dia!' e entregue um resumo matinal em até 120 palavras com: "
        "1) pulso das vendas e caixa, 2) principal alerta de boletos ou ruptura de estoque, "
        "3) prioridade prática de hoje para o dono da loja.",
    )
    meta = _chamar_llm(mensagens, "groq", max_tokens=380)
    duracao_ms = int((time.time() - start_time) * 1000)

    if not meta or not meta.get("texto"):
        return jsonify({"success": True, "resumo": None, "aviso": "Falha ao gerar resumo do dia."}), 200

    resposta_texto = meta["texto"]
    provider_efetivo = meta.get("provider") or "groq"
    prompt_tokens = int(meta.get("prompt_tokens") or 0)
    completion_tokens = int(meta.get("completion_tokens") or 0)
    custo_usd = Decimal(str(meta.get("custo_estimado_usd") or 0))

    interacao = ConsultorInteracao(
        estabelecimento_id=registro_est_id,
        funcionario_id=_funcionario_id_atual(),
        especialista="insight_resumo_diario",
        pergunta="Resumo diário proativo",
        resposta=resposta_texto,
        provider=provider_efetivo,
        duracao_ms=duracao_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        custo_estimado_usd=custo_usd,
    )
    db.session.add(interacao)
    db.session.commit()

    fontes = [s["fonte"] for s in context_data["fontes"]]
    acoes = sugerir_acoes(registro_est_id, especialista="geral", is_manager=True)
    payload = {
        "success": True,
        "resumo": resposta_texto,
        "fontes": fontes,
        "fontes_detalhadas": _detalhar_fontes(fontes),
        "provider": provider_efetivo,
        "duracao_ms": duracao_ms,
        "cached": False,
        "acoes_sugeridas": acoes,
    }
    salvar_resumo_diario_cache(registro_est_id, payload)
    return jsonify(payload), 200


@consultor_bp.route("/acoes/executar", methods=["POST"], strict_slashes=False)
@funcionario_required
@plan_required("Elite")
def executar_acao_consultor():
    """Executa uma ação da whitelist após confirmação explícita do gestor."""
    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id or str(estabelecimento_id).lower() == "all":
        return jsonify({"success": False, "error": "Selecione um estabelecimento válido para executar a ação."}), 400

    claims = get_jwt()
    role = str(claims.get("role", "caixa")).lower()
    is_manager = role in ("admin", "gerente", "dono", "proprietario", "master")
    if not is_manager:
        return (
            jsonify({
                "success": False,
                "error": "Apenas gestores podem confirmar e executar ações do Consultor da Loja.",
            }),
            403,
        )

    dados = request.get_json() or {}
    acao = dados.get("acao")
    parametros = dados.get("parametros") or {}

    registro_est_id = _tenant_registro(estabelecimento_id)
    funcionario_id = _funcionario_id_atual()

    resultado, status_code = executar_acao_confirmada(
        estabelecimento_id=int(registro_est_id),
        funcionario_id=funcionario_id,
        acao=acao,
        parametros=parametros,
    )
    return jsonify(resultado), status_code


@consultor_bp.route("/metricas", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required("Elite")
def metricas_consultor():
    """Retorna telemetria de uso, tokens, custo estimado e provedores do Consultor da Loja."""
    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento inválido."}), 400

    claims = get_jwt()
    role = str(claims.get("role", "caixa")).lower()
    is_manager = role in ("admin", "gerente", "dono", "proprietario", "master") or bool(claims.get("is_super_admin"))
    if not is_manager:
        return jsonify({"success": False, "error": "Acesso restrito à gerência."}), 403

    registro_est_id = _tenant_registro(estabelecimento_id)
    hoje_br = hoje_local()
    inicio_hoje_utc = local_date_to_utc_naive(hoje_br)
    inicio_mes_utc = local_date_to_utc_naive(hoje_br.replace(day=1))

    hoje_rows = ConsultorInteracao.query.filter(
        ConsultorInteracao.estabelecimento_id == registro_est_id,
        ConsultorInteracao.created_at >= inicio_hoje_utc,
    ).all()

    chat_hoje = sum(
        1
        for r in hoje_rows
        if not str(r.especialista).startswith("insight_") and not str(r.especialista).startswith("acao_")
    )
    insights_hoje = sum(1 for r in hoje_rows if str(r.especialista).startswith("insight_"))
    acoes_hoje = sum(1 for r in hoje_rows if str(r.especialista).startswith("acao_"))

    mes_rows = ConsultorInteracao.query.filter(
        ConsultorInteracao.estabelecimento_id == registro_est_id,
        ConsultorInteracao.created_at >= inicio_mes_utc,
    ).all()

    prompt_tokens_mes = sum(int(r.prompt_tokens or 0) for r in mes_rows)
    completion_tokens_mes = sum(int(r.completion_tokens or 0) for r in mes_rows)
    custo_mes = sum(Decimal(str(r.custo_estimado_usd or 0)) for r in mes_rows)

    por_provedor: dict[str, int] = {}
    latencias: list[int] = []
    for r in mes_rows:
        prov = str(r.provider or "desconhecido")
        por_provedor[prov] = por_provedor.get(prov, 0) + 1
        if r.duracao_ms is not None and int(r.duracao_ms) > 0:
            latencias.append(int(r.duracao_ms))

    latencia_media_ms = int(round(sum(latencias) / len(latencias))) if latencias else 0

    return (
        jsonify({
            "success": True,
            "interacoes_hoje": {
                "chat": chat_hoje,
                "insights": insights_hoje,
                "acoes": acoes_hoje,
            },
            "tokens_mes": {
                "prompt_tokens": prompt_tokens_mes,
                "completion_tokens": completion_tokens_mes,
                "total_tokens": prompt_tokens_mes + completion_tokens_mes,
            },
            "custo_estimado_mes_usd": float(round(custo_mes, 6)),
            "por_provedor": por_provedor,
            "latencia_media_ms": latencia_media_ms,
        }),
        200,
    )
