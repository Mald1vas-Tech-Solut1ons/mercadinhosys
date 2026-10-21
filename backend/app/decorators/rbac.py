"""
MercadinhoSys — RBAC: Controle de Acesso Baseado em Papéis
Hierarquia de 6 níveis. Admin (nível 1) cria todos os demais.
"""

from functools import wraps
from flask import jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from app.models import Funcionario

# ---------------------------------------------------------------------------
# Matriz de acesso: recurso → níveis permitidos (1 = Admin, 6 = Entregador)
# Quanto menor o número, maior o privilégio.
# ---------------------------------------------------------------------------
NIVEL_LABELS = {
    1: "Admin",
    2: "Gerente",
    3: "RH",
    4: "Estoque/Caixa",
    5: "Vendedor",
    6: "Entregador",
}

ROLE_TO_NIVEL = {
    "ADMIN":       1, "ADMINISTRADOR": 1, "PROPRIETARIO": 1, "DONO": 1, "MASTER": 1,
    "GERENTE":     2, "SUPERVISOR":    2,
    "RH":          3, "RECURSOS_HUMANOS": 3,
    "CAIXA":       4, "OPERADOR":      4, "ESTOQUE": 4, "ESTOQUISTA": 4,
    "ALMOXARIFE":  4, "ATENDENTE":     4,
    "VENDEDOR":    5, "SFA":           5, "SAF": 5,
    "ENTREGADOR":  6, "MOTOBOY":       6, "MOTORISTA": 6,
    "FUNCIONARIO": 4,  # fallback: trata como estoque/caixa
}

# Mapa: recurso → conjunto de níveis que têm acesso
# Espelha as Regras de Acesso do produto:
#   1 Admin: tudo | 2 Gerente: tudo exceto auditoria e config sensível
#   3 RH: nada de venda/PDV | 4 Estoque/Caixa: PDV, produtos, fornecedores,
#   clientes, logística | 5 Vendedor: SFA, clientes, produtos, logística,
#   fornecedores | 6 Entregador: só logística. Ponto: todos.
RBAC_MATRIX: dict[str, set[int]] = {
    # PDV e vendas
    "pdv":           {1, 2, 4},
    "gestao_caixa":  {1, 2, 4},
    "vendas":        {1, 2},
    "cancelar_venda":{1, 2},
    # Clientes
    "clientes":      {1, 2, 4, 5},
    # Estoque / Produtos
    "estoque":       {1, 2, 4},
    "produtos":      {1, 2, 4, 5},
    "entrada_xml":   {1, 2, 4},
    "lotes":         {1, 2, 4},
    # Compras / Fornecedores
    "fornecedores":  {1, 2, 4, 5},
    "compras":       {1, 2, 4},
    "pedidos_compra":{1, 2, 4},
    # Financeiro
    "despesas":      {1, 2},
    "financeiro":    {1, 2},
    "contas_pagar":  {1, 2},
    "relatorios":    {1, 2},
    # RH e Funcionários — visão COMPLETA (sem filtro por usuário).
    # Os demais níveis acessam RH/ponto só com dados próprios (self-service),
    # o que é tratado dentro das rotas, não por este mapa.
    "funcionarios":  {1, 2, 3},
    "rh":            {1, 2, 3},
    "folha":         {1, 2, 3},
    "beneficios":    {1, 2, 3},
    "ponto":         {1, 2, 3, 4, 5, 6},  # todos registram ponto
    # Delivery / Logística
    "delivery":      {1, 2, 4, 5, 6},
    # SFA
    "sfa":           {1, 2, 5},
    "sfa_gestao":    {1, 2},
    # Dashboard
    "dashboard":     {1, 2, 3},
    # Configurações do sistema
    "configuracoes": {1},
    "fiscal":        {1, 2},
    "auditoria":     {1},
}



class _ErroDaRota(Exception):
    """Exceção levantada pela ROTA (não pela autenticação): deve seguir intacta."""
    def __init__(self, original):
        super().__init__(str(original))
        self.original = original


def _chamar_rota(f, args, kwargs):
    # Os decoradores envolvem a autenticação em try/except genérico; sem esta marca,
    # qualquer erro de negócio/banco da rota virava 500 "Erro de autenticação".
    try:
        return f(*args, **kwargs)
    except Exception as erro:
        raise _ErroDaRota(erro) from erro


def _get_nivel(user: Funcionario) -> int:
    """Retorna o nível numérico do funcionário (1–6)."""
    if getattr(user, "is_super_admin", False):
        return 0  # acesso total
    role = (getattr(user, "role", "") or "FUNCIONARIO").upper()
    return ROLE_TO_NIVEL.get(role, 4)


def nivel_do_role(role: str) -> int:
    """Mapeia uma string de role (qualquer casing) para o nível canônico."""
    return ROLE_TO_NIVEL.get((role or "FUNCIONARIO").upper(), 4)


def _check_resource(user: Funcionario, resource: str) -> bool:
    """Retorna True se o usuário tem acesso ao recurso."""
    nivel = _get_nivel(user)
    if nivel == 0:
        return True  # super admin bypass
    allowed = RBAC_MATRIX.get(resource, set())
    return nivel in allowed


# ---------------------------------------------------------------------------
# Decoradores
# ---------------------------------------------------------------------------

def _enforce_impersonation_readonly(user: Funcionario):
    """Bloqueia mutações se o Super Admin estiver espelhando um tenant."""
    if not getattr(user, "is_super_admin", False):
        return None
    
    impersonated_id = request.headers.get("X-Impersonate-Tenant-Id")
    if impersonated_id and str(impersonated_id).lower() != "all":
        if request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            return jsonify({
                "success": False, 
                "error": "Acesso de somente leitura. Como Super Admin espelhando um cliente, você não pode alterar os dados dele."
            }), 403
    return None

def nivel_required(nivel_minimo: int):
    """
    Exige que o usuário tenha nível <= nivel_minimo.
    Uso: @nivel_required(2)  → Admin e Gerente podem acessar.
    """
    def decorator(f):
        @wraps(f)
        @jwt_required()
        def decorated_function(*args, **kwargs):
            try:
                user_id = get_jwt_identity()
                user = Funcionario.query.get(int(user_id))
                if not user:
                    return jsonify({"success": False, "error": "Usuário não encontrado"}), 401

                nivel = _get_nivel(user)
                if nivel != 0 and nivel > nivel_minimo:
                    label_minimo = NIVEL_LABELS.get(nivel_minimo, str(nivel_minimo))
                    return jsonify({
                        "success": False,
                        "error": f"Acesso negado. Necessário nível {nivel_minimo} ({label_minimo}) ou superior."
                    }), 403

                # Trava global de impersonation
                readonly_err = _enforce_impersonation_readonly(user)
                if readonly_err:
                    return readonly_err

                request.current_user = user
                return _chamar_rota(f, args, kwargs)
            except _ErroDaRota as erro_rota:
                raise erro_rota.original
            except Exception as e:
                current_app.logger.error(f"[RBAC] nivel_required error: {e}")
                return jsonify({"success": False, "error": "Erro de autenticação"}), 500
        return decorated_function
    return decorator


def resource_required(resource: str):
    """
    Exige que o usuário tenha permissão para o recurso informado.
    Uso: @resource_required('estoque')
    """
    def decorator(f):
        @wraps(f)
        @jwt_required()
        def decorated_function(*args, **kwargs):
            try:
                user_id = get_jwt_identity()
                user = Funcionario.query.get(int(user_id))
                if not user:
                    return jsonify({"success": False, "error": "Usuário não encontrado"}), 401

                if not _check_resource(user, resource):
                    nivel = _get_nivel(user)
                    label = NIVEL_LABELS.get(nivel, "Desconhecido")
                    return jsonify({
                        "success": False,
                        "error": f"Acesso negado. O cargo '{label}' não tem permissão para '{resource}'."
                    }), 403

                # Trava global de impersonation
                readonly_err = _enforce_impersonation_readonly(user)
                if readonly_err:
                    return readonly_err

                request.current_user = user
                return _chamar_rota(f, args, kwargs)
            except _ErroDaRota as erro_rota:
                raise erro_rota.original
            except Exception as e:
                current_app.logger.error(f"[RBAC] resource_required error: {e}")
                return jsonify({"success": False, "error": "Erro de autenticação"}), 500
        return decorated_function
    return decorator


def admin_required(f):
    """Exige Admin (nível 1) ou Super Admin."""
    return nivel_required(1)(f)


def gerente_required(f):
    """Exige Gerente (nível 2) ou superior."""
    return nivel_required(2)(f)


# ---------------------------------------------------------------------------
# Mantém compatibilidade com decoradores antigos
# ---------------------------------------------------------------------------

def super_admin_required(f):
    @wraps(f)
    @jwt_required()
    def decorated_function(*args, **kwargs):
        try:
            user_id = get_jwt_identity()
            user = Funcionario.query.get(int(user_id))
            if not user:
                return jsonify({"success": False, "error": "Usuário não encontrado"}), 401
            if not user.is_super_admin:
                return jsonify({"success": False, "error": "Acesso restrito ao Super Admin"}), 403
            from app.utils.auth_utils import normalize_status, is_user_active
            if not is_user_active(normalize_status(getattr(user, "status", "ativo"))):
                return jsonify({"success": False, "error": "Conta suspensa"}), 403
            
            # Trava global de impersonation
            readonly_err = _enforce_impersonation_readonly(user)
            if readonly_err:
                return readonly_err

            request.current_user = user
            request.is_super_admin = True
            return _chamar_rota(f, args, kwargs)
        except _ErroDaRota as erro_rota:
            raise erro_rota.original
        except Exception as e:
            current_app.logger.error(f"[RBAC] super_admin_required error: {e}")
            return jsonify({"success": False, "error": "Erro de autenticação"}), 500
    return decorated_function


def tenant_or_super_admin_required(f):
    @wraps(f)
    @jwt_required()
    def decorated_function(*args, **kwargs):
        try:
            user_id = get_jwt_identity()
            user = Funcionario.query.get(int(user_id))
            if not user:
                return jsonify({"success": False, "error": "Usuário não encontrado"}), 401
            if user.is_super_admin:
                request.current_user = user
                request.is_super_admin = True
                request.tenant_access = "global"
                return _chamar_rota(f, args, kwargs)
            target_id = (kwargs.get("estabelecimento_id")
                         or get_jwt().get("estabelecimento_id")
                         or request.args.get("estabelecimento_id"))
            if target_id:
                try:
                    target_id = int(target_id)
                except (ValueError, TypeError):
                    return jsonify({"success": False, "error": "estabelecimento_id inválido"}), 400
                if user.estabelecimento_id != target_id:
                    return jsonify({"success": False, "error": "Acesso negado a este estabelecimento"}), 403
            from app.utils.auth_utils import normalize_status, is_user_active
            if not is_user_active(normalize_status(getattr(user, "status", "ativo"))):
                return jsonify({"success": False, "error": "Conta suspensa"}), 403
            request.current_user = user
            request.is_super_admin = False
            request.tenant_access = "restricted"
            request.allowed_estabelecimento_id = user.estabelecimento_id
            return _chamar_rota(f, args, kwargs)
        except _ErroDaRota as erro_rota:
            raise erro_rota.original
        except Exception as e:
            current_app.logger.error(f"[RBAC] tenant_or_super_admin_required error: {e}")
            return jsonify({"success": False, "error": "Erro de autenticação"}), 500
    return decorated_function


def role_required(*allowed_roles):
    def decorator(f):
        @wraps(f)
        @jwt_required()
        def decorated_function(*args, **kwargs):
            try:
                user_id = get_jwt_identity()
                user = Funcionario.query.get(int(user_id))
                if not user:
                    return jsonify({"success": False, "error": "Usuário não encontrado"}), 401
                from app.utils.auth_utils import normalize_status, is_user_active
                if not is_user_active(normalize_status(getattr(user, "status", "ativo"))):
                    return jsonify({"success": False, "error": "Conta suspensa"}), 403
                
                # Trava global de impersonation
                readonly_err = _enforce_impersonation_readonly(user)
                if readonly_err:
                    return readonly_err

                if user.is_super_admin:
                    request.current_user = user
                    return _chamar_rota(f, args, kwargs)
                if not user.role or user.role.upper() not in [r.upper() for r in allowed_roles]:
                    return jsonify({
                        "success": False,
                        "error": f"Acesso restrito às roles: {', '.join(allowed_roles)}"
                    }), 403
                request.current_user = user
                return _chamar_rota(f, args, kwargs)
            except _ErroDaRota as erro_rota:
                raise erro_rota.original
            except Exception as e:
                current_app.logger.error(f"[RBAC] role_required error: {e}")
                return jsonify({"success": False, "error": "Erro de autenticação"}), 500
        return decorated_function
    return decorator


def get_current_user_info():
    if hasattr(request, "current_user"):
        u = request.current_user
        return {
            "id": u.id,
            "nome": u.nome,
            "email": u.email,
            "role": u.role,
            "nivel_acesso": _get_nivel(u),
            "nivel_label": NIVEL_LABELS.get(_get_nivel(u), "Desconhecido"),
            "estabelecimento_id": u.estabelecimento_id,
            "is_super_admin": getattr(request, "is_super_admin", False),
        }
    return None


def can_access_estabelecimento(estabelecimento_id: int) -> bool:
    info = get_current_user_info()
    if not info:
        return False
    if info["is_super_admin"]:
        return True
    return info["estabelecimento_id"] == estabelecimento_id
