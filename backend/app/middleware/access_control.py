"""
Camada global de controle de acesso por URL (RBAC + Plano).

A maioria das rotas do sistema só exige autenticação (@jwt_required),
sem verificar cargo nem plano. Em vez de decorar centenas de endpoints,
este middleware mapeia o prefixo da URL para um recurso da RBAC_MATRIX
e para as regras do plano, aplicando as Regras de Acesso do produto em
um único lugar:

  1 Admin ......... tudo
  2 Gerente ....... tudo, exceto auditoria e configurações sensíveis
  3 RH ............ sem venda/PDV (pdv, vendas, despesas, logística,
                    sfa, produtos, clientes, auditoria)
  4 Estoque/Caixa . PDV/caixa, produtos, fornecedores, clientes, logística
  5 Vendedor ...... SFA, clientes, produtos, logística, fornecedores
  6 Entregador .... só logística
  Ponto: todos os níveis registram o próprio ponto.

Prefixos NÃO mapeados (ex.: /api/ponto, /api/rh, /api/configuracao)
são intencionais: servem dados self-service a todos os níveis e fazem
a filtragem por usuário dentro da própria rota.
"""
from flask import request, jsonify, current_app, g
from flask_jwt_extended import verify_jwt_in_request, get_jwt

from app.decorators.rbac import RBAC_MATRIX, NIVEL_LABELS, nivel_do_role
from app.decorators.plan_guards import normalize_plan

# (prefixo, recurso) — o mais específico deve vir antes do genérico.
PREFIX_RESOURCE: list[tuple[str, str]] = [
    ("/api/vendas/pdv", "pdv"),          # fluxo de venda do PDV mora no blueprint de vendas
    ("/api/vendas", "vendas"),
    ("/api/pdv", "pdv"),
    ("/api/caixas", "gestao_caixa"),
    ("/api/produtos", "produtos"),
    ("/api/fornecedores", "fornecedores"),
    ("/api/clientes", "clientes"),
    ("/api/despesas", "despesas"),
    ("/api/relatorios", "relatorios"),
    ("/api/funcionarios", "funcionarios"),
    ("/api/fiscal/vendas", "pdv"),       # emissão de NFC-e faz parte da venda no caixa
    ("/api/fiscal", "fiscal"),
    ("/api/auditoria", "auditoria"),
    ("/api/delivery", "delivery"),
    ("/api/logistica", "delivery"),
    ("/api/sfa/admin", "sfa_gestao"),
    ("/api/sfa", "sfa"),
    ("/api/dashboard", "dashboard"),
    ("/api/pedidos-compra", "pedidos_compra"),
    ("/api/boletos-fornecedores", "contas_pagar"),
    ("/api/boletos", "contas_pagar"),
]

# Sub-rotas self-service que vivem sob um prefixo gerencial (ex.: /api/funcionarios
# e /api/dashboard são restritos por nível), mas devolvem/gravam apenas os
# PRÓPRIOS dados do usuário — checadas ANTES de PREFIX_RESOURCE, então todo
# nível chega até a rota (que aplica o filtro "próprio vs. terceiro").
SELF_SERVICE_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/api/funcionarios/me",
    "/api/dashboard/rh/ponto/espelho",
)

# Módulos VEDADOS ao plano Grátis. O plano Grátis fica no mínimo do mínimo:
# visão executiva, PDV/caixa, produtos, fornecedores, clientes e configurações
# essenciais. Gestão analítica, compras e módulos de expansão ficam no Pro.
FREE_PLAN_BLOCKED_PREFIXES: tuple[str, ...] = (
    "/api/vendas",
    "/api/pedidos-compra",
    "/api/fiscal",
    "/api/consultor",
    "/api/sfa",
    "/api/rh",
    "/api/ponto",
    "/api/delivery",
    "/api/relatorios",
    "/api/auditoria",
    "/api/despesas",
    "/api/funcionarios",
)

FREE_PLAN_ALLOWED_EXACT_PATHS: tuple[str, ...] = (
    "/api/vendas/pdv",
)


def _free_plan_blocks_path(path: str) -> bool:
    if any(path == allowed or path.startswith(f"{allowed}/") for allowed in FREE_PLAN_ALLOWED_EXACT_PATHS):
        return False
    return path.startswith(FREE_PLAN_BLOCKED_PREFIXES)


def _plano_do_estabelecimento(tid):
    """Plano atual do tenant, com cache de 60s (mesmo padrão do plano_status)."""
    from app import cache
    key = f"plano:{tid}"
    plano = cache.get(key)
    if plano is None:
        from app.models import Estabelecimento
        est = Estabelecimento.query.get(tid)
        plano = (est.plano if est else "Gratuito") or "Gratuito"
        cache.set(key, plano, timeout=60)
    return plano


def init_access_control(app):
    @app.before_request
    def enforce_access_rules():
        if request.method == "OPTIONS":
            return None
        path = request.path
        if not path.startswith("/api/"):
            return None

        # Claims já validadas (ou não) — mesmo tratamento do load_tenant_context:
        # sem token, deixa a própria rota devolver 401.
        try:
            verify_jwt_in_request(optional=True)
            claims = get_jwt()
        except Exception:
            claims = None
        if not claims:
            return None
        resource = next((r for p, r in PREFIX_RESOURCE if path == p or path.startswith(p + '/')), None)
        if path.startswith(SELF_SERVICE_EXEMPT_PREFIXES):
            resource = None
        if claims:
            # Tokens assinados continuam válidos após demissão/rebaixamento.
            # Consultar o cadastro atual antes de autorizar módulos de negócio.
            from flask_jwt_extended import get_jwt_identity
            from app.models import Funcionario
            from app import db
            from app.utils.auth_utils import is_user_active
            try:
                user = db.session.get(Funcionario, int(get_jwt_identity()))
            except (ValueError, TypeError):
                return jsonify({'success': False, 'error': 'Identidade inválida'}), 401
            if not user or user.deleted_at is not None or not user.ativo or not is_user_active(user.status):
                return jsonify({'success': False, 'error': 'Conta inativa ou inexistente'}), 401
            if not user.is_super_admin and str(user.estabelecimento_id) != str(claims.get('estabelecimento_id')):
                return jsonify({'success': False, 'error': 'Contexto de loja inválido'}), 403
            if resource and not user.is_super_admin and nivel_do_role(user.role) not in RBAC_MATRIX.get(resource, set()):
                return jsonify({'success': False, 'error': 'Permissão revogada', 'code': 'RBAC_RESTRICTED'}), 403
            if claims.get('is_super_admin') and not user.is_super_admin:
                return jsonify({'success': False, 'error': 'Privilégio revogado'}), 403
            # Rotas self-service e decoradores que consultam claims recebem
            # o papel atual, não privilégios congelados no token antigo.
            claims['role'] = user.role
            claims['is_super_admin'] = bool(user.is_super_admin)
            request.current_user = user
        if claims.get("is_super_admin"):
            return None  # bypass total (modo espelho já é tratado no tenant context)

        # ---- Gate de PLANO (Grátis x Premium) ----
        tid = getattr(g, "estabelecimento_id", None) or claims.get("estabelecimento_id")
        if tid and str(tid).lower() != "all":
            try:
                plano = _plano_do_estabelecimento(tid)
            except Exception:
                plano = claims.get("plano", "Gratuito")
            if normalize_plan(plano) == "Gratuito" and _free_plan_blocks_path(path):
                return jsonify({
                    "success": False,
                    "error": "Este módulo não está incluído no Plano Grátis. Faça upgrade para desbloquear.",
                    "code": "PLAN_RESTRICTED",
                }), 403

        # ---- Gate de NÍVEL (RBAC por módulo) ----
        if path.startswith(SELF_SERVICE_EXEMPT_PREFIXES):
            return None
        resource = next((r for p, r in PREFIX_RESOURCE if path == p or path.startswith(p + '/')), None)
        if not resource:
            return None  # prefixo self-service ou não mapeado: a rota decide

        role = claims.get("role")
        if not role:
            # Token antigo sem claim de role: buscar no banco em vez de
            # rebaixar um admin para o nível de fallback.
            try:
                from flask_jwt_extended import get_jwt_identity
                from app.models import Funcionario
                user = Funcionario.query.get(int(get_jwt_identity()))
                role = user.role if user else None
            except Exception:
                role = None
        nivel = nivel_do_role(role)
        allowed = RBAC_MATRIX.get(resource, set())
        if nivel not in allowed:
            label = NIVEL_LABELS.get(nivel, str(nivel))
            current_app.logger.info(
                "🔐 RBAC negou %s %s para nível %s (%s)", request.method, path, nivel, label
            )
            return jsonify({
                "success": False,
                "error": f"Acesso negado. O cargo '{label}' não tem permissão para este módulo.",
                "code": "RBAC_RESTRICTED",
            }), 403

        return None
