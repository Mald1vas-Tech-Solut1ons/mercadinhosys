import os
import hashlib
from sqlalchemy import text
from flask import current_app
from app.models import Estabelecimento, EfiWebhookEvent, db
from datetime import datetime, timedelta, timezone
from efipay import EfiPay
from app.decorators.plan_guards import normalize_plan

class BillingService:
    def __init__(self):
        is_sandbox = os.getenv('EFI_ENV', 'sandbox') == 'sandbox'
        
        client_id = os.getenv('EFI_CLIENT_ID_HOMOL') if is_sandbox else os.getenv('EFI_CLIENT_ID_PROD')
        client_secret = os.getenv('EFI_CLIENT_SECRET_HOMOL') if is_sandbox else os.getenv('EFI_CLIENT_SECRET_PROD')
        cert_path = os.getenv('EFI_CERT_HOMOL') if is_sandbox else os.getenv('EFI_CERT_PROD')
        
        if not client_id or not client_secret:
            raise RuntimeError("As chaves da Efí (EFI_CLIENT_ID / EFI_CLIENT_SECRET) não estão configuradas no .env para este ambiente.")

        self.options = {
            'client_id': client_id,
            'client_secret': client_secret,
            'sandbox': is_sandbox,
            # 'certificate': os.path.abspath(cert_path) if cert_path and os.path.exists(cert_path) else None
        }

        self.efi = EfiPay(self.options)
        
        self.PLAN_PRICES = {
            'Pro': 9990,
            'Gratuito': 0,
        }

    def _get_price_amount(self, plan_name):
        return self.PLAN_PRICES.get(normalize_plan(plan_name), 9990)

    def _normalize_checkout_plan(self, plan_name):
        normalized = normalize_plan(plan_name)
        return 'Pro' if normalized == 'Pro' else 'Gratuito'

    def create_checkout_session(self, estabelecimento_id, plan_name, user_email):
        try:
            estab = Estabelecimento.query.get(estabelecimento_id)
            if not estab:
                raise Exception("Estabelecimento não encontrado")

            normalized_plan = self._normalize_checkout_plan(plan_name)
            if normalized_plan != 'Pro':
                raise ValueError("Checkout disponível apenas para o plano Pro.")

            price = self._get_price_amount(normalized_plan)
            
            # Tentar criar um Plano de Assinatura Recorrente (Efí Assinaturas)
            try:
                plan_body = {
                    "name": f"Assinatura {normalized_plan} - MercadinhoSys",
                    "repeats": 0, # 0 = indefinido (cobrança recorrente mensal)
                    "interval": 1
                }
                plan_response = self.efi.create_plan(body=plan_body)
                if plan_response.get('code') != 200:
                    raise Exception("Falha ao criar plano")
                
                plan_id = plan_response['data']['plan_id']
                
                link_body = {
                    "items": [
                        {
                            "name": f"Mensalidade - {normalized_plan}",
                            "value": price,
                            "amount": 1
                        }
                    ],
                    "settings": {
                        "payment_method": "all",
                        "expire_at": (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d"),
                        "request_delivery_address": False
                    },
                    "metadata": {
                        "custom_id": str(estabelecimento_id),
                        "plan_name": normalized_plan,
                        "notification_url": os.getenv('BACKEND_URL', 'https://mercadinhosys.herokuapp.com') + '/api/billing/webhook'
                    }
                }
                charge = self.efi.create_one_step_subscription_link(params={"id": plan_id}, body=link_body)
                
            except Exception as plan_err:
                current_app.logger.warning(f"Fallback para cobrança avulsa (Efí): {plan_err}")
                # Fallback para one-step link avulso
                body = {
                    "items": [
                        {
                            "name": f"Assinatura Plano {normalized_plan} - 1 Mês",
                            "value": price,
                            "amount": 1
                        }
                    ],
                    "settings": {
                        "message": f"Assinatura MercadinhoSys - {normalized_plan}",
                        "expire_at": (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d"),
                        "request_delivery_address": False,
                        "payment_method": "pix,credit_card"
                    },
                    "metadata": {
                        "custom_id": str(estabelecimento_id),
                        "plan_name": normalized_plan,
                        "notification_url": os.getenv('BACKEND_URL', 'https://mercadinhosys.herokuapp.com') + '/api/billing/webhook'
                    }
                }
                charge = self.efi.create_one_step_link(body=body)

            if isinstance(charge, str) or charge.get('code') != 200:
                raise Exception(f"Erro ao gerar link de pagamento Efí (Verifique suas Credenciais): {charge}")

            charge_id = charge['data']['charge_id']
            
            # Update gateway info on estab
            estab.gateway_subscription_id = str(charge_id)
            estab.plano = normalized_plan
            db.session.commit()

            return charge['data']['payment_url']

        except Exception as e:
            current_app.logger.error(f"Erro no BillingService: {str(e)}")
            raise e

    def handle_webhook(self, notification_token):
        """
        Consulta os detalhes da notificação na Efí e processa o pagamento
        """
        try:
            params = { "token": notification_token }
            notification = self.efi.get_notification(params=params)

            if notification.get('code') != 200:
                return False

            changed_establishments = set()
            for event in notification.get('data', []):
                if event.get('type') == 'charge':
                    status = event.get('status', {}).get('current')
                    charge_id = event.get('identifiers', {}).get('charge_id')
                    if not charge_id or status not in ('paid', 'settled', 'canceled', 'unpaid'):
                        continue
                    normalized = 'paid' if status in ('paid', 'settled') else 'canceled'
                    event_key = hashlib.sha256(f'efi:{charge_id}:{normalized}'.encode()).hexdigest()
                    if db.engine.dialect.name == 'postgresql':
                        lock_key = int.from_bytes(hashlib.sha256(f'efi:{charge_id}'.encode()).digest()[:8], 'big', signed=True)
                        db.session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': lock_key})
                    if db.session.get(EfiWebhookEvent, event_key):
                        continue
                    if status == 'paid' or status == 'settled':
                        establishment_id = self._handle_charge_paid(charge_id)
                    elif status == 'canceled' or status == 'unpaid':
                        establishment_id = self._handle_charge_canceled(charge_id)
                    if establishment_id:
                        db.session.add(EfiWebhookEvent(event_key=event_key, charge_id=str(charge_id), status=normalized))
                        db.session.flush()
                        changed_establishments.add(establishment_id)
            db.session.commit()
            from app import cache
            for establishment_id in changed_establishments:
                cache.delete(f'plano_status:{establishment_id}')
            return True
        except Exception as e:
            db.session.rollback()
            current_app.logger.error('Falha no webhook Efí: %s', type(e).__name__)
            raise e

    def _handle_charge_paid(self, charge_id):
        estab = Estabelecimento.query.filter_by(gateway_subscription_id=str(charge_id)).populate_existing().with_for_update().first()
        if estab:
            # Assinatura mensal, renova por 30 dias a partir de hoje
            estab.vencimento_assinatura = datetime.now(timezone.utc) + timedelta(days=30)
            estab.plano_status = 'ativo'
            current_app.logger.info(f"Estabelecimento {estab.id} ativado via webhook Efí.")
            return estab.id

    def _handle_charge_canceled(self, charge_id):
        estab = Estabelecimento.query.filter_by(gateway_subscription_id=str(charge_id)).populate_existing().with_for_update().first()
        if estab:
            estab.plano_status = 'cancelado'
            current_app.logger.info(f"Estabelecimento {estab.id} cancelado via webhook Efí.")
            return estab.id
