from functools import wraps
from flask import jsonify, current_app
from flask_jwt_extended import get_jwt

PLAN_HIERARCHY = {
    'Gratuito': 1,
    'Pro': 2,
    'Superadmin': 99
}


def normalize_plan(plan_name):
    """Normaliza qualquer alias legado para os dois planos oficiais."""
    s = str(plan_name or 'Gratuito').lower().strip()
    if any(x in s for x in ['pro', 'premium', 'elite', 'advanced', 'enterprise', 'master', 'pago', 'profissional', 'professional']):
        return 'Pro'
    return 'Gratuito'

def plano_efetivo(plano, plano_status=None):
    """Plano que vale para liberar módulos: trial em vigor conta como Pro.

    O trial self-service nasce com plano='trial' e status 'experimental'. Sem esta regra
    ele normalizava para Gratuito e a loja nova via o dashboard e os módulos bloqueados.
    O vencimento é barrado globalmente em app/__init__.py (403 de trial vencido).
    """
    if str(plano or '').lower().strip() == 'trial' and (plano_status or 'experimental') == 'experimental':
        return 'Pro'
    return normalize_plan(plano)


def plan_required(min_plan='Gratuito'):
    """
    Decorator para exigir um plano mínimo para acesso à rota.
    Super Admins sempre têm acesso ignorando o plano.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            from flask_jwt_extended import verify_jwt_in_request
            verify_jwt_in_request()
            claims = get_jwt()
            
            # 1. Super Admin Bypass (Total)
            if claims.get('is_super_admin'):
                current_app.logger.debug(f"SUPER ADMIN BYPASS PLANO ATIVADO PARA: {claims.get('sub')}")
                return f(*args, **kwargs)
            
            # 2. Busca em Tempo Real
            try:
                from app.models import Estabelecimento
                est_id = claims.get('estabelecimento_id')
                if not est_id or est_id == 'all':
                    return f(*args, **kwargs)
                
                est = Estabelecimento.query.get(est_id)
                if not est:
                    return jsonify({"success": False, "error": "Estabelecimento não encontrado"}), 404
                
                current_plan = est.plano or 'Gratuito'
                current_status = est.plano_status or 'ativo'
            except Exception:
                current_plan = claims.get('plano', 'Gratuito')
                current_status = claims.get('plano_status', 'ativo')

            user_plan_norm = plano_efetivo(current_plan, current_status)
            min_plan_norm = normalize_plan(min_plan)
            
            user_level = PLAN_HIERARCHY.get(user_plan_norm, 1)
            required_level = PLAN_HIERARCHY.get(min_plan_norm, 1)
            
            if user_level < required_level:
                return jsonify({
                    "success": False,
                    "error": f"Acesso Negado: O Plano {user_plan_norm} não inclui esta ferramenta. Upgrade para Pro necessário.",
                    "msg": f"Acesso Negado: O Plano {user_plan_norm} nao inclui esta ferramenta. Upgrade para Pro necessario.",
                    "code": "PLAN_RESTRICTED"
                }), 403
            
            if current_status in ['suspenso', 'cancelado']:
                return jsonify({
                    "success": False,
                    "error": "Assinatura inativa. Regularize seu acesso.",
                    "code": "SUBSCRIPTION_INACTIVE"
                }), 403
                
            return f(*args, **kwargs)
        return decorated_function
    return decorator


pro_required = plan_required("Pro")
premium_required = pro_required

def quota_required(model_name):
    """
    Decorator para validar cotas do plano Gratuito antes de salvar.
    Modelos suportados: 'produto', 'cliente', 'fornecedor', 'funcionario'
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            from flask_jwt_extended import verify_jwt_in_request
            verify_jwt_in_request()
            claims = get_jwt()
            
            if claims.get('is_super_admin'):
                return f(*args, **kwargs)

            try:
                from app.models import Estabelecimento, Produto, Cliente, Fornecedor, Funcionario
                est_id = claims.get('estabelecimento_id')
                est = Estabelecimento.query.get(est_id)

                plano = plano_efetivo(getattr(est, 'plano', 'Gratuito'), getattr(est, 'plano_status', None))
                if plano == 'Pro':
                    # Plano Pro tem cotas ilimitadas (exceto funcionários que é 3)
                    if model_name == 'funcionario':
                        count = Funcionario.query.filter_by(estabelecimento_id=est_id, ativo=True).count()
                        if count >= 3:
                            return jsonify({"success": False, "error": "Limite de 3 funcionários atingido no Plano Pro."}), 403
                    return f(*args, **kwargs)

                # Regras Plano Gratuito
                if model_name == 'produto':
                    count = Produto.query.filter_by(estabelecimento_id=est_id).count()
                    if count >= 100:
                        return jsonify({"success": False, "error": "Limite de 100 produtos atingido (Plano Gratuito)."}), 403
                elif model_name == 'cliente':
                    count = Cliente.query.filter_by(estabelecimento_id=est_id).count()
                    if count >= 200:
                        return jsonify({"success": False, "error": "Limite de 200 clientes atingido (Plano Gratuito)."}), 403
                elif model_name == 'fornecedor':
                    count = Fornecedor.query.filter_by(estabelecimento_id=est_id).count()
                    if count >= 50:
                        return jsonify({"success": False, "error": "Limite de 50 fornecedores atingido (Plano Gratuito)."}), 403
                elif model_name == 'funcionario':
                    count = Funcionario.query.filter_by(estabelecimento_id=est_id, ativo=True).count()
                    if count >= 1:
                        return jsonify({"success": False, "error": "Limite de 1 funcionário atingido (Plano Gratuito)."}), 403

            except Exception as e:
                from flask import current_app
                current_app.logger.error(f"Erro ao validar quota: {e}")
                
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def permission_required(resource):
    """
    Decorator para validar permissão de acesso ao recurso.
    Usa a RBAC_MATRIX de rbac.py para verificar o nível do usuário.
    Super Admin e Admin (nível 1) sempre têm acesso.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
            verify_jwt_in_request()
            claims = get_jwt()

            # Super Admin bypass total
            if claims.get('is_super_admin'):
                return f(*args, **kwargs)

            # Admin/Gerente bypass via claims (evita query desnecessária em rotas quentes)
            role = (claims.get('role') or '').upper()
            is_admin_role = role in ['ADMIN', 'ADMINISTRADOR', 'PROPRIETARIO', 'DONO', 'MASTER', 'GERENTE', 'SUPERVISOR']
            if is_admin_role:
                return f(*args, **kwargs)

            # Verificação via RBAC_MATRIX com nível do usuário
            try:
                from app.models import Funcionario
                from app.decorators.rbac import ROLE_TO_NIVEL, RBAC_MATRIX, NIVEL_LABELS
                user_id = get_jwt_identity()
                user = Funcionario.query.get(int(user_id))
                if not user:
                    return jsonify({"success": False, "error": "Usuário não encontrado"}), 401

                nivel = ROLE_TO_NIVEL.get((user.role or 'FUNCIONARIO').upper(), 4)
                allowed = RBAC_MATRIX.get(resource, set())

                if nivel not in allowed and 0 not in allowed:
                    label = NIVEL_LABELS.get(nivel, str(nivel))
                    return jsonify({
                        "success": False,
                        "error": f"Acesso negado. O cargo '{label}' não tem permissão para '{resource}'."
                    }), 403
            except Exception as e:
                from flask import current_app
                current_app.logger.error(f"[permission_required] Erro: {e}")
                return jsonify({"success": False, "error": "Erro de autorização"}), 500

            return f(*args, **kwargs)
        return decorated_function
    return decorator
