"""
Testes do PIN de segurança (definir no Settings + verificar para gate de
editar/descartar produto). Mesma infra do estorno (Funcionario.pin_cancelamento).
"""
import pytest
from flask_jwt_extended import create_access_token

from app.models import db, Estabelecimento, Funcionario


def _admin(session):
    from flask import g, has_request_context
    estab = session.query(Estabelecimento).first()
    # Espelha um request autenticado: sem tenant em g, o guard multi-tenant
    # (fail-closed) filtra as queries por estabelecimento_id = -1 e o seed some.
    if has_request_context():
        g.estabelecimento_id = estab.id
    func = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    func.nivel_acesso = 1  # admin (em produção já é 1; conftest cria como 3)
    db.session.commit()
    return estab, func


def _token(estab_id, role="admin", nivel=1, uid="1"):
    return {"Authorization": f"Bearer " + create_access_token(
        identity=uid, additional_claims={"estabelecimento_id": estab_id, "role": role, "nivel_acesso": nivel})}


def test_admin_define_pin(client, session):
    estab, func = _admin(session)
    r = client.put("/api/configuracao/pin", json={"pin": "4321"}, headers=_token(estab.id))
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["tem_pin"] is True
    db.session.refresh(func)
    assert func.tem_pin and func.check_pin("4321")


def test_pin_invalido_rejeitado(client, session):
    estab, _ = _admin(session)
    for ruim in ["12", "12ab", "1234567"]:
        r = client.put("/api/configuracao/pin", json={"pin": ruim}, headers=_token(estab.id))
        assert r.status_code == 400, f"PIN {ruim!r} deveria ser rejeitado"


def test_nao_admin_nao_define_pin(client, session):
    estab, _ = _admin(session)
    r = client.put("/api/configuracao/pin", json={"pin": "4321"},
                   headers=_token(estab.id, role="caixa", nivel=3))
    assert r.status_code == 403


def test_verificar_pin(client, session):
    estab, func = _admin(session)
    func.set_pin("4321")
    db.session.commit()

    ok = client.post("/api/configuracao/verificar-pin", json={"pin": "4321"}, headers=_token(estab.id))
    assert ok.status_code == 200 and ok.get_json()["success"] is True

    nao = client.post("/api/configuracao/verificar-pin", json={"pin": "0000"}, headers=_token(estab.id))
    assert nao.status_code == 403


def test_gate_funciona_para_qualquer_operador_com_pin_do_admin(client, session):
    """Um caixa (nível 3) consegue VERIFICAR o PIN do admin — é o gate de autorização."""
    estab, admin = _admin(session)
    admin.set_pin("4321")
    db.session.commit()
    # operador caixa envia o PIN do admin para autorizar a operação
    r = client.post("/api/configuracao/verificar-pin", json={"pin": "4321"},
                    headers=_token(estab.id, role="caixa", nivel=3))
    assert r.status_code == 200 and r.get_json()["success"] is True


def test_dono_de_loja_nova_cadastra_e_usa_o_pin(client, session):
    """Regressão (loja 10, 2026-10-23): o dono criado no cadastro self-service
    nascia com nivel_acesso=4 (default do modelo). O PUT do PIN aceitava pelo
    role ADMIN, mas o verificar-pin só aceita nível ≤ 2 e recusava o próprio PIN."""
    from app.models import allow_all_tenants
    r = client.post("/api/onboarding/registrar", json={
        "nome_fantasia": "Loja PIN", "cnpj": "11222333000181", "telefone_loja": "11999999999",
        "email_loja": "pin@example.com", "nome_admin": "Dono PIN", "cpf_admin": "52998224725",
        "celular_admin": "11988887777", "email_admin": "pin@example.com", "username": "dono_pin",
        "senha": "MinhaSenha1",
    })
    assert r.status_code == 201, r.get_data(as_text=True)
    with allow_all_tenants():
        dono = Funcionario.query.filter_by(username="dono_pin").first()
    assert dono.nivel_acesso == 1

    login = client.post("/api/auth/login", json={"username": "dono_pin", "senha": "MinhaSenha1"}).get_json()
    token = login.get("access_token") or login["data"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.put("/api/configuracao/pin", json={"pin": "1234"}, headers=h).status_code == 200
    ok = client.post("/api/configuracao/verificar-pin", json={"pin": "1234"}, headers=h)
    assert ok.status_code == 200, ok.get_data(as_text=True)


def test_dono_criado_pelo_painel_saas_e_nivel_1(client, session):
    from datetime import date
    from app.models import allow_all_tenants
    estab = session.query(Estabelecimento).first()
    sa = Funcionario(
        estabelecimento_id=estab.id, nome="Global Admin", username="super_pin", email="super@pin.test",
        role="admin", is_super_admin=True, cpf="00011122233", data_nascimento=date(1980, 1, 1),
        celular="92900000000", cargo="CTO", data_admissao=date(2024, 1, 1),
    )
    sa.set_password("pass")
    session.add(sa)
    session.commit()
    h = {"Authorization": "Bearer " + create_access_token(identity=str(sa.id), additional_claims={
        "is_super_admin": True, "estabelecimento_id": estab.id, "role": "admin", "status": "ativo"})}
    r = client.post("/api/saas/onboarding", headers=h, json={
        "nome_fantasia": "Outlet PIN", "razao_social": "Outlet PIN LTDA", "cnpj": "46986429000109",
        "telefone": "11952881844", "email_estabelecimento": "loja@outlet.test", "nome_admin": "Dona Outlet",
        "email_admin": "dona@outlet.test", "cpf_admin": "14825377882", "plano": "trial", "trial_dias": 30,
        "senha_admin": "SecurePass123!",
    })
    assert r.status_code == 201, r.get_data(as_text=True)
    with allow_all_tenants():
        dono = Funcionario.query.filter_by(email="dona@outlet.test").first()
    assert dono.nivel_acesso == 1
