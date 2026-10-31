"""
Dashboard Routes - Blueprint limpo e simples
"""

from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from app.dashboard_cientifico import DashboardOrchestrator
from app.models import Funcionario, RegistroPonto
from app.decorators.decorator_jwt import gerente_ou_admin_required
from app.decorators.plan_guards import plan_required
import logging
from datetime import datetime, timezone
from sqlalchemy import and_
from app.utils.timezone import iso_utc

logger = logging.getLogger(__name__)
dashboard_bp = Blueprint("dashboard", __name__)


def make_dashboard_cache_key():
    """
    Gera chave de cache única por estabelecimento.
    Permite que o cache seja compartilhado entre usuários do mesmo estabelecimento.
    """
    try:
        claims = get_jwt()
        est_id = claims.get("estabelecimento_id")
        return f"dashboard_cientifico_v1:{est_id}"
    except Exception:
        return None  # Não cacheia se falhar ao pegar ID


def get_establishment_id():
    """
    Obtém ID do estabelecimento de forma inteligente:
    - Se for Super-Admin, permite Header 'X-Establishment-ID'.
    - Caso contrário, usa Claims do JWT.
    """
    from app.utils.query_helpers import get_authorized_establishment_id, get_first_estabelecimento_id_safe
    est_id = get_authorized_establishment_id()
    
    if est_id is None:
        raise ValueError("Token ou Contexto inválido: estab_id não encontrado")
        
    if str(est_id).lower() == "all":
        # Se for visão Holding ('all'), retornamos 'all' para que o orquestrador/data_layer agrupe.
        return "all"
        
    return int(est_id) if est_id is not None else None


@dashboard_bp.route("/cientifico", methods=["GET"])
@gerente_ou_admin_required
@plan_required('Pro')
def dashboard_cientifico():
    """
    Endpoint para o Dashboard Científico.
    Suporta filtro por dias OU por datas específicas.
    """
    try:
        logger.info("🔥 Iniciando dashboard_cientifico endpoint")
        
        # 1. Obter contexto seguro (já validado pelo decorator)
        estabelecimento_id = get_establishment_id()
        logger.info(f"✅ Estabelecimento ID: {estabelecimento_id}")
        
        # 🔥 NOVO: Suportar filtro por datas específicas
        start_date_str = request.args.get('start_date', default=None, type=str)
        end_date_str = request.args.get('end_date', default=None, type=str)
        category_ids = request.args.getlist('category_ids', type=int)
        segment = request.args.get('segment', default=None, type=str)
        days = request.args.get('days', default=30, type=int)
        
        start_date_obj = None
        end_date_obj = None
        
        if start_date_str and end_date_str:
            try:
                # Usa imports globais datetime e timezone (linha 12)
                start_date_obj = datetime.fromisoformat(start_date_str)
                if start_date_obj.tzinfo is None:
                    start_date_obj = start_date_obj.replace(tzinfo=timezone.utc)
                
                end_date_obj = datetime.fromisoformat(end_date_str)
                if end_date_obj.tzinfo is None:
                    end_date_obj = end_date_obj.replace(tzinfo=timezone.utc)
                    
                days = (end_date_obj - start_date_obj).days
                if days < 1:
                    days = 1
                logger.info(f"📊 Dashboard com datas específicas (AWARE): {start_date_obj} a {end_date_obj} ({days} dias)")
            except Exception as date_err:
                logger.warning(f"Datas inválidas: {date_err}, usando days={days}")
                start_date_obj = None
                end_date_obj = None
        else:
            logger.info(f"📊 Dashboard solicitado para {days} dias")
        
        if days < 1:
            days = 1
        elif days > 365:
            days = 365

        # 1.5 CACHE — o motor analítico é pesado (~vários segundos). Cacheamos o
        # resultado por loja + período por um TTL curto, então visualizações
        # repetidas (e vários usuários da mesma loja) respondem instantaneamente.
        # Chave inclui o estabelecimento → nunca vaza entre tenants.
        from app import cache
        cache_key = (
            f"dash_cient:v2:{estabelecimento_id}:{days}:"
            f"{start_date_str or ''}:{end_date_str or ''}:"
            f"{','.join(map(str, category_ids)) if category_ids else ''}:"
            f"{segment or ''}"
        )
        try:
            cached_payload = cache.get(cache_key)
        except Exception:
            cached_payload = None
        if cached_payload is not None:
            logger.info("⚡ Dashboard servido do cache (%s)", cache_key)
            return jsonify(cached_payload), 200

        # 2. Inicializar Orquestrador com contexto seguro
        claims = get_jwt()
        is_super_admin = claims.get("is_super_admin", False)
        orchestrator = DashboardOrchestrator(
            establishment_id=estabelecimento_id,
            is_super_admin=is_super_admin
        )
        data = orchestrator.get_scientific_dashboard(
            days=days,
            start_date=start_date_obj,
            end_date=end_date_obj,
            category_ids=category_ids if category_ids else None,
            segment=segment if segment else None
        )

        if not data.get("success", True):
            return jsonify(data), 500

        logger.info(f"✅ Dashboard retornou com sucesso")

        # 4. Resposta Padronizada
        payload = {
            "success": True,
            "metadata": {
                "timestamp": iso_utc(datetime.now(timezone.utc)),
                "version": "2.0",
                "cache_strategy": "smartcache",
                "period_days": days
            },
            "data": data
        }
        # TTL de 120s: dashboard reflete novas vendas em até 2 min (aceitável p/
        # analítico) e absorve picos de acesso sem reprocessar.
        try:
            cache.set(cache_key, payload, timeout=120)
        except Exception as cache_err:
            logger.warning("Falha ao gravar cache do dashboard: %s", cache_err)

        return jsonify(payload), 200
        
    except Exception as e:
        # Log detalhado para debug de infraestrutura
        import traceback
        tb = traceback.format_exc()
        logger.error(f"❌ Erro Crítico Dashboard Científico: {e}")
        logger.error(f"Traceback:\n{tb}")
        
        # Diferenciação básica de erros (poderia ser expandida)
        error_msg = str(e)
        status_code = 500
        
        # Se for erro de conexão ou infra, mantém 500.
        # Se fosse erro de negócio conhecido, poderia ser 400/422.
        
        if "Banco de dados indisponível" in str(e):
            status_code = 503

        return jsonify({
            "success": False,
            "error": "Erro interno ao processar indicadores",
            "details": error_msg if current_app.debug else "Contate o suporte"
        }), status_code


@dashboard_bp.route("/rh/ponto/historico", methods=["GET"])
@gerente_ou_admin_required
@plan_required('Pro')
def rh_ponto_historico():
    try:
        estabelecimento_id = get_establishment_id()

        data_inicio = request.args.get("data_inicio")
        data_fim = request.args.get("data_fim")
        funcionario_id = request.args.get("funcionario_id", type=int)
        page = request.args.get("page", default=1, type=int)
        per_page = request.args.get("per_page", default=25, type=int)

        query = RegistroPonto.query.join(Funcionario)
        if str(estabelecimento_id).lower() != 'all':
            query = query.filter(RegistroPonto.estabelecimento_id == estabelecimento_id)

        if data_inicio:
            data_inicio_obj = datetime.strptime(data_inicio, "%Y-%m-%d").date()
            query = query.filter(RegistroPonto.data >= data_inicio_obj)
        if data_fim:
            data_fim_obj = datetime.strptime(data_fim, "%Y-%m-%d").date()
            query = query.filter(RegistroPonto.data <= data_fim_obj)
        if funcionario_id:
            query = query.filter(RegistroPonto.funcionario_id == funcionario_id)

        query = query.order_by(RegistroPonto.data.desc(), RegistroPonto.hora.desc())

        paginated = query.paginate(page=page, per_page=min(max(per_page, 1), 200), error_out=False)
        items = [r.to_dict() for r in paginated.items]

        return jsonify({
            "success": True,
            "data": {
                "items": items,
                "page": paginated.page,
                "per_page": paginated.per_page,
                "total": paginated.total,
                "pages": paginated.pages
            }
        }), 200

    except Exception as e:
        logger.error(f"Erro rh_ponto_historico: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500


@dashboard_bp.route("/rh/ponto/espelho", methods=["GET"])
@jwt_required()
@plan_required('Pro')
def rh_ponto_espelho():
    """
    Endpoint para gerar espelho de ponto de um funcionário específico.
    Retorna registros diários agrupados com resumo do período.

    Regra de Acesso: todo funcionário pode ver o PRÓPRIO espelho
    (funcionario_id omitido = self). Ver o espelho de OUTRO funcionário
    exige Admin, Gerente ou RH (nível <= 3).
    """
    try:
        from app.decorators.rbac import _get_nivel

        estabelecimento_id = get_establishment_id()
        usuario_logado = Funcionario.query.get(int(get_jwt_identity()))
        if not usuario_logado:
            return jsonify({"success": False, "message": "Funcionário não encontrado"}), 404

        funcionario_id = request.args.get("funcionario_id", type=int) or usuario_logado.id
        data_inicio = request.args.get("data_inicio")
        data_fim = request.args.get("data_fim")

        if funcionario_id != usuario_logado.id and _get_nivel(usuario_logado) > 3:
            return jsonify({
                "success": False,
                "message": "Você só pode ver o próprio espelho de ponto",
            }), 403

        if not data_inicio or not data_fim:
            return jsonify({
                "success": False,
                "message": "Parâmetros obrigatórios: data_inicio, data_fim"
            }), 400

        # Buscar funcionário
        funcionario = Funcionario.query.filter_by(
            id=funcionario_id,
            estabelecimento_id=estabelecimento_id
        ).first()

        if not funcionario:
            return jsonify({
                "success": False,
                "message": "Funcionário não encontrado"
            }), 404
        
        # Converter datas
        data_inicio_obj = datetime.strptime(data_inicio, "%Y-%m-%d").date()
        data_fim_obj = datetime.strptime(data_fim, "%Y-%m-%d").date()

        # Fonte única de verdade: mesma engine de ponto do holerite
        from app.services.rh_calculator_service import calcular_espelho_ponto
        from app.models import EspelhoAssinatura

        espelho = calcular_espelho_ponto(funcionario, data_inicio_obj, data_fim_obj)

        assinatura = EspelhoAssinatura.query.filter_by(
            funcionario_id=funcionario.id,
            data_inicio=data_inicio_obj,
            data_fim=data_fim_obj,
        ).first()

        espelho["assinatura"] = {
            "assinado": assinatura is not None,
            "assinado_em": iso_utc(assinatura.assinado_em) if assinatura and assinatura.assinado_em else None,
        }

        return jsonify({"success": True, "data": espelho}), 200

    except Exception as e:
        logger.error(f"Erro rh_ponto_espelho: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500


@dashboard_bp.route("/rh/ponto/espelho/assinar", methods=["POST"])
@jwt_required()
@plan_required('Pro')
def assinar_espelho_ponto():
    """Funcionário confirma que conferiu o PRÓPRIO espelho de ponto do período."""
    try:
        from app.models import EspelhoAssinatura

        usuario_logado = Funcionario.query.get(int(get_jwt_identity()))
        if not usuario_logado:
            return jsonify({"success": False, "message": "Funcionário não encontrado"}), 404

        data = request.get_json() or {}
        data_inicio = data.get("data_inicio")
        data_fim = data.get("data_fim")
        if not data_inicio or not data_fim:
            return jsonify({"success": False, "message": "Parâmetros obrigatórios: data_inicio, data_fim"}), 400

        data_inicio_obj = datetime.strptime(data_inicio, "%Y-%m-%d").date()
        data_fim_obj = datetime.strptime(data_fim, "%Y-%m-%d").date()

        assinatura = EspelhoAssinatura.query.filter_by(
            funcionario_id=usuario_logado.id,
            data_inicio=data_inicio_obj,
            data_fim=data_fim_obj,
        ).first()
        if not assinatura:
            from app import db
            assinatura = EspelhoAssinatura(
                estabelecimento_id=usuario_logado.estabelecimento_id,
                funcionario_id=usuario_logado.id,
                data_inicio=data_inicio_obj,
                data_fim=data_fim_obj,
            )
            db.session.add(assinatura)
            db.session.commit()

        return jsonify({
            "success": True,
            "message": "Espelho de ponto assinado com sucesso",
            "data": {"assinado": True, "assinado_em": iso_utc(assinatura.assinado_em) if assinatura.assinado_em else None},
        }), 200
    except Exception as e:
        logger.error(f"Erro assinar_espelho_ponto: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500






@dashboard_bp.route("/categorias", methods=["GET"])
@gerente_ou_admin_required
@plan_required('Pro')
def dashboard_categorias():
    """Vendas por categoria e subcategoria — o recorte que o dono usa para decidir compra."""
    try:
        from app.services.dashboard_categorias import analise_por_categoria
        estabelecimento_id = get_establishment_id()
        dias = request.args.get("days", default=30, type=int)
        dias = max(1, min(dias, 365))
        return jsonify({"success": True, "data": analise_por_categoria(estabelecimento_id, dias)})
    except Exception as e:
        logger.error(f"Erro na analise por categoria: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@dashboard_bp.route("/executivo", methods=["GET"])
@gerente_ou_admin_required
@plan_required('Pro')
def dashboard_executivo():
    try:
        estabelecimento_id = get_establishment_id()
        days = request.args.get("days", default=30, type=int)
        orchestrator = DashboardOrchestrator(estabelecimento_id)
        dashboard_data = orchestrator.get_executive_dashboard(days)
        return jsonify(dashboard_data)
    except Exception as e:
        logger.error(f"Erro no dashboard executivo: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@dashboard_bp.route("/analise/<tipo>", methods=["GET"])
@gerente_ou_admin_required
@plan_required('Pro')
def analise_detalhada(tipo: str):
    try:
        estabelecimento_id = get_establishment_id()
        days = request.args.get("days", default=90, type=int)
        orchestrator = DashboardOrchestrator(estabelecimento_id)
        analysis_data = orchestrator.get_detailed_analysis(tipo, days)
        return jsonify({"success": True, "analysis_type": tipo, "data": analysis_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@dashboard_bp.route("/status", methods=["GET"])
@jwt_required()
def dashboard_status():
    return jsonify({"status": "operational"})

@dashboard_bp.route("/comparativo", methods=["GET"])
@gerente_ou_admin_required
def dashboard_comparativo():
    """Período atual x anterior de mesma duração e a ponte do faturamento.

    ?days=30 ou ?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD (dias da loja).
    """
    from datetime import date
    from app.services.comparativo_service import comparar
    try:
        estabelecimento_id = get_establishment_id()
        if estabelecimento_id == "all":
            return jsonify({"success": False, "error": "Escolha uma loja para comparar períodos."}), 400
        ini, fim = request.args.get("start_date"), request.args.get("end_date")
        if ini and fim:
            inicio, final = date.fromisoformat(ini[:10]), date.fromisoformat(fim[:10])
            if final < inicio:
                return jsonify({"success": False, "error": "Data final antes da inicial."}), 400
            resultado = comparar(estabelecimento_id, inicio=inicio, fim=final)
        else:
            resultado = comparar(estabelecimento_id, dias=request.args.get("days", default=30, type=int))
        return jsonify({"success": True, **resultado})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.error(f"Erro no comparativo de períodos: {e}")
        return jsonify({"success": False, "error": "Erro ao comparar períodos"}), 500


# FASE 3.3: cobertura abaixo disso vira alerta (produto acaba em menos de 5 dias).
COBERTURA_ALERTA_DIAS = 5.0

# Bebida no fim de semana e panetone em dezembro saem mais rápido que a média do
# próprio produto — o alerta tem que subir antes, não depois. Regra local, sem API.
_BEBIDAS_FIM_DE_SEMANA = ("cerveja", "refrigerante", "refrigerantes", "refri")
_SAZONAIS_FESTA = ("panetone", "champanhe", "champanha")


def _fator_contexto(produto, hoje) -> float:
    nome = str(getattr(produto, "nome", "") or "").lower()
    fator = 1.0
    if hoje.weekday() >= 4 and any(termo in nome for termo in _BEBIDAS_FIM_DE_SEMANA):
        fator = 0.7
    if hoje.month in (12, 1) and any(termo in nome for termo in _SAZONAIS_FESTA):
        fator = 0.5
    return fator


def _deve_alertar_por_cobertura(metrica, produto, hoje):
    """(alertar, cobertura_ajustada). Sem giro, sem alerta — item novo não é 'lento'."""
    cobertura = metrica.get("cobertura_dias") if isinstance(metrica, dict) else None
    if cobertura is None:
        return False, 0.0
    if float(metrica.get("vmd") or 0) <= 0:
        return False, 0.0
    ajustada = float(cobertura) * _fator_contexto(produto, hoje)
    if ajustada <= 0:
        return False, 0.0
    return ajustada < COBERTURA_ALERTA_DIAS, ajustada


@dashboard_bp.route("/alertas", methods=["GET"])
@jwt_required()
def dashboard_alertas():
    try:
        from datetime import date, timedelta
        from sqlalchemy import or_, and_
        from app.models import Produto
        from app.utils.query_helpers import get_configuracao_safe
        from app.utils import giro_cache

        estabelecimento_id = get_establishment_id()
        hoje = date.today()

        # Respeita Configurações > Estoque da loja: alerta de estoque mínimo e
        # controle de validade desligados = nenhum alerta daquele tipo.
        config = get_configuracao_safe(estabelecimento_id) or {}
        alertar_ruptura = bool(config.get("alerta_estoque_minimo", True))
        alertar_validade = bool(config.get("controlar_validade", True))
        dias_validade = int(config.get("dias_alerta_validade") or 30)
        limite_validade = hoje + timedelta(days=dias_validade)

        if not alertar_ruptura and not alertar_validade:
            return jsonify({"success": True, "alertas": [], "total": 0})

        query = Produto.query.filter_by(ativo=True)
        if str(estabelecimento_id).lower() != 'all':
            query = query.filter_by(estabelecimento_id=estabelecimento_id)

        condicoes = []
        if alertar_ruptura:
            condicoes.append(Produto.quantidade <= Produto.quantidade_minima)
        if alertar_validade:
            condicoes.append(and_(Produto.controlar_validade == True, Produto.data_validade.isnot(None), Produto.data_validade <= limite_validade))

        produtos = query.filter(or_(*condicoes)).all()

        alertas = []
        for p in produtos:
            # Garante valores padrão em caso nulo
            qtd = p.quantidade if p.quantidade is not None else 0
            qtd_min = p.quantidade_minima if p.quantidade_minima is not None else 0

            if alertar_ruptura and qtd <= qtd_min:
                alertas.append({
                    "id": f"r_{p.id}",
                    "tipo": "ruptura",
                    "produto_id": p.id,
                    "produto_nome": p.nome,
                    "quantidade": float(qtd),
                    "estoque_minimo": float(qtd_min)
                })
            
            if alertar_validade and p.controlar_validade and p.data_validade:
                if p.data_validade < hoje:
                    alertas.append({
                        "id": f"v_{p.id}",
                        "tipo": "vencido",
                        "produto_nome": p.nome,
                        "data_validade": iso_utc(p.data_validade)
                    })
                elif p.data_validade <= limite_validade:
                    alertas.append({
                        "id": f"vp_{p.id}",
                        "tipo": "vencimento",
                        "produto_nome": p.nome,
                        "data_validade": iso_utc(p.data_validade)
                    })
                    
        # FASE 3.3 — alerta por GIRO, não só por mínimo estático.
        # O mínimo (default 10) é igual para todo mundo; quem vende 30 cervejas no
        # fim de semana chega em 8 unidades na sexta e o sistema fica quieto. Aqui a
        # cobertura (dias até acabar) entra no MESMO painel de alertas.
        # Usa a agregação já cacheada por tenant (giro_cache) — nenhuma query nova de vendas.
        # Só roda com os alertas de estoque LIGADOS: loja que desligou alerta de
        # estoque não quer receber "acaba em 3 dias" pela porta dos fundos.
        if alertar_ruptura:
            try:
                agregado = giro_cache.get_vendas_agregadas(estabelecimento_id)
                ja_alertados = {a["produto_id"] for a in alertas if "produto_id" in a}
                ativos = [p for p in query.all() if p.id not in ja_alertados]
                for p in ativos:
                    metrica = giro_cache.metrica_produto(p, hoje, agregado)
                    alertar, cobertura = _deve_alertar_por_cobertura(metrica, p, hoje)
                    if not alertar:
                        continue
                    alertas.append({
                        "id": f"c_{p.id}",
                        "tipo": "cobertura",
                        "produto_id": p.id,
                        "produto_nome": p.nome,
                        "quantidade": float(p.quantidade or 0),
                        "cobertura_dias": round(cobertura, 1),
                        "vmd": round(float(metrica.get("vmd") or 0), 2),
                        "mensagem": f"Acaba em {round(cobertura, 1)} dia(s) no ritmo atual",
                    })
            except Exception as erro_giro:
                # Alerta de giro não pode derrubar o painel inteiro.
                logger.warning(f"Alerta por giro indisponível: {erro_giro}")

        def get_priority(a):
            if a["tipo"] == "vencido": return 0
            if a["tipo"] == "ruptura": return 1
            if a["tipo"] == "cobertura": return 2
            return 3

        alertas.sort(key=lambda x: get_priority(x))
        
        return jsonify({"success": True, "alertas": alertas[:50], "total": len(alertas)})
    except Exception as e:
        logger.error(f"Erro ao buscar alertas operacionais: {e}")
        return jsonify({"success": False, "alertas": []}), 500

