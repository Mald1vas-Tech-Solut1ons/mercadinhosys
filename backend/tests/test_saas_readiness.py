import pytest
from datetime import date
from app.decorators.plan_guards import plan_required, premium_required
from flask import jsonify

def test_plan_hierarchy_normalization(session):
    # This test checks if normalization works as expected in plan_guards logic
    from app.decorators.plan_guards import normalize_plan
    assert normalize_plan("Premium") == "Pro"
    assert normalize_plan("PRO") == "Pro"
    assert normalize_plan("Profissional") == "Pro"
    assert normalize_plan("Premium Master") == "Pro"
    assert normalize_plan("Gratuito") == "Gratuito"
    assert normalize_plan("Basic") == "Gratuito"


def test_quota_required_respeita_alias_legado_de_plano_pago(client, session):
    from app.models import Estabelecimento, Funcionario, CategoriaProduto, Produto
    from flask_jwt_extended import create_access_token
    from decimal import Decimal

    estab = Estabelecimento.query.first()
    estab.plano = "Profissional"
    estab.plano_status = "ativo"

    admin = Funcionario.query.filter_by(estabelecimento_id=estab.id).first()
    categoria = CategoriaProduto(estabelecimento_id=estab.id, nome="Geral")
    session.add(categoria)
    session.flush()

    for i in range(100):
        session.add(Produto(
            estabelecimento_id=estab.id,
            categoria_id=categoria.id,
            nome=f"Produto Seed {i}",
            preco_custo=Decimal("5.00"),
            preco_venda=Decimal("10.00"),
            quantidade=10,
        ))
    session.commit()

    token = create_access_token(identity=str(admin.id), additional_claims={
        "is_super_admin": False,
        "estabelecimento_id": estab.id,
        "role": "admin",
    })

    response = client.post('/api/produtos/', json={
        "nome": "Produto Liberado Alias Pago",
        "subcategoria": "Outros Alimentos",
        "preco_custo": 4.50,
        "preco_venda": 8.90,
        "quantidade": 100, "data_validade": "2099-12-31",
        "codigo_barras": "7890000000093",
    }, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code in (200, 201), response.get_data(as_text=True)
    data = response.get_json()
    assert data["success"] is True

def test_premium_required_decorator(app, client, session):
    from app.models import Estabelecimento, Funcionario
    from flask_jwt_extended import create_access_token
    
    @premium_required
    def premium_route():
        return jsonify(success=True)

    # 1. Create a "Gratuito" account
    estab_free = Estabelecimento.query.first()
    estab_free.plano = "Gratuito"
    estab_free.plano_status = "ativo"

    # Espelha request autenticado: sem tenant em g o guard fail-closed filtra
    # Funcionario por estabelecimento_id = -1 e o admin some.
    from flask import g, has_request_context
    if has_request_context():
        g.estabelecimento_id = estab_free.id

    admin = Funcionario.query.filter_by(estabelecimento_id=estab_free.id).first()
    token_free = create_access_token(identity=str(admin.id), additional_claims={
        "is_super_admin": False,
        "estabelecimento_id": estab_free.id,
        "role": "admin"
    })
    
    headers_free = {"Authorization": f"Bearer {token_free}"}
    with app.test_request_context('/test-premium', headers=headers_free):
        response = app.make_response(premium_route())
    assert response.status_code == 403
    assert "upgrade" in response.get_json()['msg'].lower()

    # 2. Upgrade to Pro
    estab_free.plano = "Pro"
    import sqlalchemy as sa
    session.commit()
    
    with app.test_request_context('/test-premium', headers=headers_free):
        response = app.make_response(premium_route())
    assert response.status_code == 200
    assert response.get_json()['success'] is True

def test_onboarding_atomic_flow(client, session):
    # Test the /api/saas/onboarding endpoint (transactional)
    payload = {
        "nome_fantasia": "Auto Test Store",
        "razao_social": "Auto Test Store LTDA",
        "cnpj": "12345678901234",
        "telefone": "92988887766",
        "email_estabelecimento": "test@autostore.com",
        "nome_admin": "Admin Test",
        "email_admin": "admin@autostore.com",
        "cpf_admin": "52998224725",  # CPF válido (dígito verificador correto)
        "senha_admin": "SecurePass123!",
        "plano": "trial",
        "trial_dias": 30
    }
    
    # We need a superadmin token to call onboarding
    from app.models import Funcionario
    from flask_jwt_extended import create_access_token
    
    superadmin = Funcionario.query.filter_by(is_super_admin=True).first()
    if not superadmin:
        # Create a temporary one if conftest doesn't provide it
        from app.models import Estabelecimento
        estab = Estabelecimento.query.first()
        superadmin = Funcionario(
            estabelecimento_id=estab.id,
            nome="Global Admin",
            username="super_test",
            email="super@test.com",
            role="admin",
            is_super_admin=True,
            cpf="00011122233",
            data_nascimento=date(1980, 1, 1),
            celular="92900000000",
            cargo="CTO",
            data_admissao=date(2024, 1, 1)
        )
        superadmin.set_password("pass")
        session.add(superadmin)
        session.commit()

    # Token espelhando o login real: super admin sempre carrega estabelecimento_id
    # e status; sem eles o guard multi-tenant (fail-closed) devolve 401.
    token = create_access_token(identity=str(superadmin.id), additional_claims={
        "is_super_admin": True,
        "estabelecimento_id": superadmin.estabelecimento_id,
        "role": "admin",
        "status": "ativo",
    })
    headers = {"Authorization": f"Bearer {token}"}
    
    response = client.post('/api/saas/onboarding', json=payload, headers=headers)
    assert response.status_code == 201
    data = response.get_json()
    assert data['success'] is True
    assert data['data']['estabelecimento']['nome_fantasia'] == "Auto Test Store"
    
    # Verify DB state. Provisionar uma loja e conferir seu admin é uma operação
    # CROSS-TENANT (estamos validando dados de um tenant recém-criado, fora de um
    # request daquele tenant). Explicitamos isso com allow_all_tenants — sem ele,
    # um tenant vazado no g do request anterior filtraria o admin novo e o teste
    # veria None.
    from app.models import Estabelecimento as Est, Funcionario as Fun, allow_all_tenants
    with allow_all_tenants():
        stored_est = Est.query.filter_by(email="test@autostore.com").first()
        assert stored_est is not None
        # Plano default do onboarding agora é TRIAL PRO: 30 dias grátis
        assert stored_est.plano == "trial"
        assert stored_est.plano_status == "experimental"
        assert stored_est.vencimento_plano is not None

        stored_admin = Fun.query.filter_by(email="admin@autostore.com").first()
        assert stored_admin is not None
        assert stored_admin.check_password("SecurePass123!") is True

@pytest.mark.saas
def test_trial_expiration_blocking(app, client, session):
    from app.models import Estabelecimento, Funcionario
    from flask_jwt_extended import create_access_token
    from datetime import date, timedelta

    estab_trial = Estabelecimento.query.first()
    estab_trial.plano = "trial"
    estab_trial.plano_status = "experimental"
    estab_trial.vencimento_plano = date.today() - timedelta(days=1)
    session.commit()
    
    admin = Funcionario.query.filter_by(estabelecimento_id=estab_trial.id).first()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "is_super_admin": False,
        "estabelecimento_id": estab_trial.id,
        "role": "admin"
    })
    
    from app import cache
    cache.delete(f"plano_status:{estab_trial.id}")
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get('/api/produtos/', headers=headers)
    
    assert response.status_code == 403

@pytest.mark.billing
def test_public_checkout_requires_existing_account(client):
    payload = {
        "email": "not_exists@email.com",
        "plan_name": "Pro"
    }
    response = client.post('/api/billing/public-checkout', json=payload)
    assert response.status_code == 404
    data = response.get_json()
    assert data['success'] is False
    assert "conclua o cadastro" in data['error'].lower()
