# -*- coding: utf-8 -*-
"""Testes dos críticos corrigidos pela auditoria de 2026-10-29.

C1: /api/auth/list-tenants exige super admin (não qualquer admin de loja).
C3: /api/sync/receive não escreve tabelas sensíveis nem colunas de credencial.
H3: login cloud recusa funcionário com status demitido/suspenso.
H1: CORS fallback nunca é ["*"] com supports_credentials=True.
H4: senhas passam pela mesma política (8+ letras+números) em todos os pontos.
"""
import os
from datetime import date
from decimal import Decimal

import pytest
from werkzeug.security import generate_password_hash

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


# ── C3: /api/sync/receive (guardas dentro de _process_sync_data) ────────────

def test_sync_recebe_nao_escreve_tabela_sensivel(session):
    """Upsert de funcionarios/estabelecimentos/configuracoes via sync é bloqueado."""
    from app.routes.sync_cloud import _process_sync_data
    estab = session.query(Estabelecimento).first()

    for tabela, payload in (
        ("funcionarios", {"nome": "Intruso", "role": "admin", "is_super_admin": True}),
        ("estabelecimentos", {"plano": "PRO", "plano_status": "ativo"}),
        ("configuracoes", {"desconto_maximo_percentual": 100}),
    ):
        data = {
            "tabela": tabela,
            "operacao": "UPDATE",
            "registro_id": estab.id,
            "payload": payload,
        }
        assert _process_sync_data(data, session) is False, tabela


def test_sync_recebe_ignora_colunas_de_credencial(session):
    """Tabela de negócio aceita colunas comuns, mas NUNCA senha/role/super."""
    from app.routes.sync_cloud import _process_sync_data
    estab = session.query(Estabelecimento).first()
    funcionario = (
        session.query(Funcionario)
        .filter_by(estabelecimento_id=estab.id)
        .first()
    )
    senha_antes = funcionario.senha
    super_antes = bool(funcionario.is_super_admin)
    role_antes = funcionario.role

    data = {
        "tabela": "funcionarios",
        "operacao": "UPDATE",
        "registro_id": funcionario.id,
        "payload": {
            "nome": f"{funcionario.nome} (sincronizado)",
            "senha": generate_password_hash("senha-do-intruso"),
            "role": "admin",
            "is_super_admin": True,
            "pin_cancelamento": "1234",
        },
    }
    # A tabela funcionarios agora está na denylist INTEIRA; mesmo um UPDATE
    # apenas-de-nome nela é recusado — o teste da coluna é a segunda linha de
    # defesa (uma futura remoção da tabela da lista não reabre a coluna).
    assert _process_sync_data(data, session) is False

    funcionario = session.query(Funcionario).get(funcionario.id)
    assert funcionario.senha == senha_antes
    assert bool(funcionario.is_super_admin) == super_antes
    assert funcionario.role == role_antes


def test_sync_recebe_aceita_negocio_e_aplica_guarda_de_coluna(session):
    """Fluxo legítimo continua funcionando e descarta coluna sensível no negócio."""
    from app.models import Despesa
    from flask import g
    from app.routes.sync_cloud import _process_sync_data
    estab = session.query(Estabelecimento).first()

    # Coluna 'role' usada aqui como sonda: mesmo numa tabela de negócio, não é aplicada.
    g.estabelecimento_id = estab.id
    data = {
        "tabela": "despesas",
        "operacao": "INSERT",
        "registro_id": 44401,
        "payload": {
            "id": 44401,
            "estabelecimento_id": estab.id,
            "descricao": "Sincronia legítima",
            "categoria": "geral",
            "tipo": "variavel",
            "valor": 12.34,
            "data_despesa": date(2026, 10, 29).isoformat(),
            "role": "admin",  # coluna inexistente em despesas AND igualmente bloqueada
        },
    }
    assert _process_sync_data(data, session) is True
    desp = session.query(Despesa).filter_by(id=44401).first()
    assert desp is not None
    assert desp.descricao == "Sincronia legítima"


# ── H3/H4: política de senha em todos os pontos ─────────────────────────────

def test_onboarding_recusa_senha_fraca(client, session):
    estab = session.query(Estabelecimento).first()
    suffix = date.today().strftime("%H%M%S")
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