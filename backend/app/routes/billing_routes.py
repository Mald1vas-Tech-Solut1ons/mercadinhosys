import os
from flask import Blueprint, request, jsonify, redirect, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import Estabelecimento, Funcionario, db
from app.decorators.plan_guards import normalize_plan

billing_bp = Blueprint('billing_bp', __name__, url_prefix='/api/billing')

def _get_billing_service():
    from app.services.billing_service import BillingService
    return BillingService()

@billing_bp.route('/checkout', methods=['POST'])
@jwt_required()
def create_checkout():
    """
    Inicia o fluxo de checkout da Efí Bank retornando o Link de Pagamento.
    """
    try:
        user_id = get_jwt_identity()
        user = Funcionario.query.get(user_id)
        if not user:
            return jsonify({"error": "Usuário não encontrado"}), 404

        data = request.get_json() or {}
        plan_name = normalize_plan(data.get('plan_name', 'Pro'))
        
        billing_svc = _get_billing_service()
        checkout_url = billing_svc.create_checkout_session(
            estabelecimento_id=user.estabelecimento_id,
            plan_name=plan_name,
            user_email=user.email
        )
        
        return jsonify({
            "success": True,
            "checkout_url": checkout_url
        }), 200

    except Exception as e:
        current_app.logger.error(f"Erro no /checkout: {str(e)}")
        return jsonify({"error": str(e)}), 500

@billing_bp.route('/public-checkout', methods=['POST'])
def public_checkout():
    """
    Inicia o checkout durante o onboarding, para usuários não logados.
    """
    try:
        data = request.get_json() or {}
        plan_name = data.get('plan_name')
        email = data.get('email')
        
        if not plan_name or not email:
            return jsonify({"error": "Dados incompletos"}), 400

        plan_name = normalize_plan(plan_name)
        if plan_name != 'Pro':
            return jsonify({
                "success": False,
                "error": "O checkout público está disponível apenas para o plano Pro."
            }), 400

        estab = Estabelecimento.query.filter_by(email=email).first()
        if not estab:
            return jsonify({
                "success": False, 
                "error": "Estabelecimento não encontrado. Conclua o cadastro antes de assinar."
            }), 404

        try:
            billing_svc = _get_billing_service()
            checkout_url = billing_svc.create_checkout_session(
                estabelecimento_id=estab.id,
                plan_name=plan_name,
                user_email=email
            )
            return jsonify({
                "success": True,
                "checkout_url": checkout_url
            })
        except Exception as e:
            return jsonify({
                "success": False,
                "error": str(e)
            }), 400

    except Exception as e:
        current_app.logger.error(f"Erro public checkout: {str(e)}")
        return jsonify({"error": str(e)}), 500

@billing_bp.route('/webhook', methods=['POST'])
def webhook():
    """
    Recebe as notificações da Efí Bank sobre alterações de status de cobranças.
    A Efí Bank envia um "notification" que é o token para consultar o status real.
    """
    try:
        data = request.form.to_dict() or request.get_json() or {}
        if not isinstance(data, dict):
            return jsonify({'error': 'Notificação inválida'}), 400
        notification_token = data.get('notification')

        if not isinstance(notification_token, str) or not notification_token.strip() or len(notification_token) > 512:
            return jsonify({"error": "Token de notificação não fornecido"}), 400

        billing_svc = _get_billing_service()
        if not billing_svc.handle_webhook(notification_token):
            return jsonify({'success': False, 'error': 'Notificação não confirmada pelo provedor'}), 502

        return jsonify({"success": True}), 200
    except Exception as e:
        current_app.logger.error(f"Erro no webhook: {str(e)}")
        # Falha temporária precisa permitir retry; jamais confirmar evento perdido.
        return jsonify({'success': False, 'error': 'Falha temporária ao confirmar notificação'}), 503

@billing_bp.route('/portal', methods=['POST'])
@jwt_required()
def customer_portal():
    """
    A Efí não possui um portal de cliente hospedado dinâmico idêntico ao da Stripe.
    Apenas informamos ao front-end que a funcionalidade está migrando ou simulamos cancelamento.
    """
    return jsonify({
        "error": "Portal de assinatura não suportado nativamente. Contate o suporte para cancelar sua assinatura."
    }), 400
