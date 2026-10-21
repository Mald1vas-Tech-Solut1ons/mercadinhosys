"""Onda 0 da auditoria de completude (2026-10-21): o que a demo/implantação não pode quebrar.

- cadastro self-service exige senha escolhida (antes a senha gerada nunca chegava ao dono);
- trial em vigor vale como Pro (antes o dashboard da loja nova dava 403);
- Consultor enxerga a venda de hoje (antes `data_venda <= date` zerava hoje/ontem);
- rotas de lotes e de código de barras que o front chama existem.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from flask_jwt_extended import create_access_token

from app.models import (
    db, Estabelecimento, Funcionario, CategoriaProduto, Produto, Caixa, allow_all_tenants,
)


def _headers(estab_id, func_id):
    token = create_access_token(identity=str(func_id), additional_claims={
        "estabelecimento_id": estab_id, "role": "admin", "nome": "Admin",
    })
    return {"Authorization": f"Bearer {token}"}


def _ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    session.add(Caixa(
        estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="PDV-01",
        saldo_inicial=Decimal("100"), saldo_atual=Decimal("100"), status="aberto",
        data_abertura=datetime.now(timezone.utc),
    ))
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Geral")
    session.add(cat)
    session.commit()
    return estab, admin, cat


def _payload_cadastro(**extra):
    base = {
        "nome_fantasia": "Loja Onda Zero", "cnpj": "11222333000181", "telefone_loja": "11999999999",
        "email_loja": "onda0@example.com", "nome_admin": "Dono Onda", "cpf_admin": "52998224725",
        "celular_admin": "11988887777", "email_admin": "onda0@example.com", "username": "dono_onda0",
    }
    base.update(extra)
    return base


# ---------------------------------------------------------------- cadastro
def test_cadastro_sem_senha_e_recusado(client, session):
    r = client.post("/api/onboarding/registrar", json=_payload_cadastro())
    assert r.status_code == 400
    assert "senha" in r.get_json()["error"].lower()
    with allow_all_tenants():
        assert Estabelecimento.query.filter_by(cnpj="11222333000181").first() is None


def test_cadastro_com_senha_permite_login_e_dashboard_em_trial(client, session):
    r = client.post("/api/onboarding/registrar", json=_payload_cadastro(senha="MinhaSenha1"))
    assert r.status_code == 201, r.get_data(as_text=True)

    login = client.post("/api/auth/login", json={"username": "dono_onda0", "senha": "MinhaSenha1"})
    assert login.status_code == 200, login.get_data(as_text=True)
    corpo = login.get_json()
    token = corpo.get("access_token") or corpo["data"].get("access_token")
    assert corpo["data"]["user"]["plano"] == "Pro"  # trial em vigor

    dash = client.get("/api/dashboard/cientifico?days=30", headers={"Authorization": f"Bearer {token}"})
    assert dash.status_code == 200, dash.get_data(as_text=True)


# ------------------------------------------------------------------- plano
def test_trial_em_vigor_vale_como_pro_e_gratuito_continua_bloqueado(client, session):
    estab, admin, _ = _ctx(session)
    h = _headers(estab.id, admin.id)

    estab.plano, estab.plano_status = "trial", "experimental"
    estab.vencimento_plano = date.today() + timedelta(days=10)
    db.session.commit()
    from app import cache
    cache.delete(f"plano:{estab.id}")
    assert client.get("/api/dashboard/cientifico?days=30", headers=h).status_code == 200

    estab.plano, estab.plano_status = "Gratuito", "ativo"
    db.session.commit()
    cache.delete(f"plano:{estab.id}")
    r = client.get("/api/dashboard/cientifico?days=30", headers=h)
    assert r.status_code == 403
    assert r.get_json()["code"] == "PLAN_RESTRICTED"


# ---------------------------------------------------------------- consultor
def test_consultor_ve_a_venda_de_hoje(client, session):
    estab, admin, cat = _ctx(session)
    estab.plano = "Pro"
    p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz 5kg",
                preco_custo=Decimal("20"), preco_venda=Decimal("30"), quantidade=10)
    db.session.add(p)
    db.session.commit()

    r = client.post("/api/pdv/finalizar", headers=_headers(estab.id, admin.id), json={
        "items": [{"id": p.id, "quantity": 2, "price": 30}], "subtotal": 60, "desconto": 0, "total": 60,
        "pagamentos": [{"forma": "dinheiro", "valor": 60}], "valor_recebido": 60, "troco": 0,
    })
    assert r.status_code == 201, r.get_data(as_text=True)

    from app.services.consultor.contextos import vendas, financeiro
    ctx_v = vendas.montar_contexto(estab.id, True)
    assert ctx_v["hoje"]["faturamento"] == 60.0
    assert ctx_v["hoje"]["qtd"] == 1
    assert ctx_v["mes_atual"]["faturamento"] == 60.0
    assert financeiro.montar_contexto(estab.id, True)["receita_mes_atual"] == 60.0


# ------------------------------------------------------------ rotas do front
def test_rotas_de_lotes_e_codigo_de_barras_existem(client, session):
    estab, admin, cat = _ctx(session)
    p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Feijão", codigo_barras="7891000100103",
                preco_custo=Decimal("5"), preco_venda=Decimal("8"), quantidade=3)
    db.session.add(p)
    db.session.commit()
    h = _headers(estab.id, admin.id)

    assert client.get(f"/api/produtos/{p.id}/lotes-disponiveis", headers=h).status_code == 200

    ok = client.get("/api/produtos/barcode/7891000100103", headers=h)
    assert ok.status_code == 200
    assert ok.get_json()["produto"]["id"] == p.id
    assert client.get("/api/produtos/barcode/0000000000000", headers=h).status_code == 404
