# -*- coding: utf-8 -*-
"""Testes dos críticos corrigidos pela auditoria de 2026-10-29.

C1: /api/auth/list-tenants exige super admin (não qualquer admin de loja).
C3: /api/sync/receive foi removido com a sincronização híbrida (ver test_security_audit.py).
H3: login cloud recusa funcionário com status demitido/suspenso.
H1: CORS fallback nunca é ["*"] com supports_credentials=True.
H4: senhas passam pela mesma política (8+ letras+números) em todos os pontos.
"""
from app.utils.timezone import hoje_local  # dia da LOJA (o app usa o mesmo)
import os
from datetime import date

import pytest

from app import create_app
from app.models import db, Estabelecimento, Funcionario


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    return estab, admin


def _token_for(app, funcionario, **extra_claims):
    from flask_jwt_extended import create_access_token
    with app.test_request_context():
        claims = {"estabelecimento_id": funcionario.estabelecimento_id}
        claims.update(extra_claims)
        return create_access_token(identity=str(funcionario.id), additional_claims=claims)


# ── C1: list-tenants ────────────────────────────────────────────────────────

def test_list_tenants_recusa_admin_de_loja_comum(app, client, ctx):
    """Admin NÃO-super de uma loja cliente não vê a lista de tenants do SaaS."""
    estab, admin = ctx
    # O admin do conftest não é super admin: garante isso explicitamente.
    assert not bool(admin.is_super_admin)
    token = _token_for(app, admin)
    resp = client.get(
        "/api/auth/list-tenants",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.get_json()


# ── H3/H4: política de senha em todos os pontos ─────────────────────────────

def test_onboarding_recusa_senha_fraca(client, session):
    estab = session.query(Estabelecimento).first()
    suffix = hoje_local().strftime("%H%M%S")
    resp = client.post(
        "/api/onboarding/registrar",
        json={
            "nome_fantasia": f"Loja Senha Fraca {suffix}",
            "nome_admin": "Dono Teste",
            "cpf_admin": "52998224725",  # CPF válido de teste público
            "celular_admin": "92999999999",
            "cnpj": "12345678000195",
            "telefone_loja": "92999999999",
            "email_loja": f"loja{suffix}@mercadinho.sys",
            "username": f"donosenha{suffix}",
            "email_admin": f"dono{suffix}@mercadinho.sys",
            "senha": "123456",
        },
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert "8" in (body.get("error") or ""), body


def test_perfil_self_recusa_senha_sem_numero(client, session, ctx):
    _, admin = ctx
    token = _token_for(client.application, admin)
    resp = client.put(
        "/api/auth/profile",
        json={"senha_atual": "industrial-secret", "nova_senha": "somenteletras"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400, resp.get_json()


# ── H1: CORS ────────────────────────────────────────────────────────────────

def test_cors_fallback_nao_e_wildcard(app):
    """Sem CORS_ORIGINS e fora da Vercel, o fallback é localhost explícito (nunca '*')."""
    configured = app.config.get("CORS_ORIGINS") or []
    assert configured, "CORS_ORIGINS deve ter fallback"
    assert "*" not in configured, configured
    assert all(o.startswith("http://localhost") or o.startswith("http://127.0.0.1") for o in configured), configured


def test_cors_resposta_nao_ecoa_origem_externa(app, client):
    """Origem maliciosa NÃO recebe Access-Control-Allow-Origin ecoado."""
    resp = client.options(
        "/api/health",
        headers={
            "Origin": "https://evil-tenant.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    acao = resp.headers.get("Access-Control-Allow-Origin", "")
    assert acao not in ("https://evil-tenant.com", "*"), acao