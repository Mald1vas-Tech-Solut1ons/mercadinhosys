"""
Testes de ISOLAMENTO MULTI-TENANT.

Objetivo: provar, de forma automatizada, que um tenant (loja) nunca enxerga
dados de outro através da camada ORM (TenantQuery). Estes testes documentam
o comportamento ESPERADO (seguro). Se algum falhar, há um vazamento real.

Estratégia: criar dois estabelecimentos (A e B), cada um com 1 produto, e
verificar que, com o contexto de tenant fixado em A (g.estabelecimento_id = A),
NENHUM método de consulta retorna o produto de B.
"""
import pytest
from datetime import date
from decimal import Decimal
from flask import g

from app import db
from app.models import Estabelecimento, Produto, CategoriaProduto, Funcionario


import random as _random


def _novo_estab(nome):
    cnpj = f"{_random.randint(10**12, 10**13 - 1)}"
    estab = Estabelecimento(
        nome_fantasia=nome,
        razao_social=f"{nome} LTDA",
        cnpj=cnpj,
        email=f"{nome.lower().replace(' ','')}_{cnpj[-4:]}@iso.test",
        telefone="92999999999",
        data_abertura=date(2024, 1, 1),
        plano="PREMIUM",
        cep="69000-000", logradouro="Rua X", numero="1",
        bairro="Centro", cidade="Manaus", estado="AM", pais="Brasil",
    )
    db.session.add(estab)
    db.session.flush()
    return estab


def _novo_produto(estab_id, nome):
    cat = CategoriaProduto(estabelecimento_id=estab_id, nome=f"Cat {nome}")
    db.session.add(cat)
    db.session.flush()
    p = Produto(
        estabelecimento_id=estab_id,
        categoria_id=cat.id,
        nome=nome,
        preco_venda=Decimal("10.00"),
        preco_custo=Decimal("5.00"),
        quantidade=100,
    )
    db.session.add(p)
    db.session.flush()
    return p


@pytest.fixture
def dois_tenants(session):
    """Cria tenant A e B, cada um com 1 produto de nome distinto."""
    a = _novo_estab("Loja A")
    b = _novo_estab("Loja B")
    _novo_produto(a.id, "Produto Exclusivo A")
    _novo_produto(b.id, "Produto Exclusivo B")
    db.session.commit()
    return a, b


def _fixar_tenant(estab_id):
    """Simula o que o before_request faz: fixa o tenant atual em g."""
    g.estabelecimento_id = estab_id


# ---------------------------------------------------------------------------
# BASELINE — o que já funciona hoje
# ---------------------------------------------------------------------------
def test_all_eh_isolado(dois_tenants):
    """.all() JÁ é filtrado por tenant (baseline verde)."""
    a, b = dois_tenants
    _fixar_tenant(a.id)
    nomes = {p.nome for p in Produto.query.all()}
    assert "Produto Exclusivo A" in nomes
    assert "Produto Exclusivo B" not in nomes, "VAZAMENTO: .all() retornou produto de outro tenant"


# ---------------------------------------------------------------------------
# BURACO #1 — cobertura parcial de métodos (.first / .count / iteração)
# ---------------------------------------------------------------------------
def test_first_eh_isolado(dois_tenants):
    """Buscar por nome do produto de B, no contexto de A, deve retornar None."""
    a, b = dois_tenants
    _fixar_tenant(a.id)
    achado = Produto.query.filter_by(nome="Produto Exclusivo B").first()
    assert achado is None, "VAZAMENTO: .first() retornou produto de outro tenant"


def test_count_eh_isolado(dois_tenants):
    a, b = dois_tenants
    _fixar_tenant(a.id)
    assert Produto.query.count() == 1, "VAZAMENTO: .count() contou produtos de outros tenants"


def test_iteracao_eh_isolada(dois_tenants):
    a, b = dois_tenants
    _fixar_tenant(a.id)
    nomes = {p.nome for p in Produto.query}  # iteração direta
    assert "Produto Exclusivo B" not in nomes, "VAZAMENTO: iterar a query retornou outro tenant"


# ---------------------------------------------------------------------------
# BURACO #2 — fail-open: sem contexto de tenant, não pode despejar tudo
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# db.session.query também é coberto (entidade resolvida via column_descriptions)
# ---------------------------------------------------------------------------
def test_session_query_entidade_eh_isolado(dois_tenants):
    from app.models import Produto as P
    a, b = dois_tenants
    _fixar_tenant(a.id)
    nomes = {p.nome for p in db.session.query(P).all()}
    assert "Produto Exclusivo B" not in nomes, "VAZAMENTO: db.session.query(Model) retornou outro tenant"


def test_paginate_eh_isolado_e_nao_quebra(dois_tenants):
    """paginate() deve filtrar por tenant E não quebrar (regressão do filtro
    aplicado após limit/offset)."""
    a, b = dois_tenants
    _fixar_tenant(a.id)
    pag = Produto.query.paginate(page=1, per_page=10, error_out=False)
    nomes = {p.nome for p in pag.items}
    assert "Produto Exclusivo A" in nomes
    assert "Produto Exclusivo B" not in nomes, "VAZAMENTO: paginate retornou produto de outro tenant"
    assert pag.total == 1, f"VAZAMENTO: paginate.total contou {pag.total} (esperado 1)"


def test_session_query_agregado_eh_isolado(dois_tenants):
    from sqlalchemy import func
    from app.models import Produto as P
    a, b = dois_tenants
    _fixar_tenant(a.id)
    total = db.session.query(func.count(P.id)).scalar()
    assert total == 1, f"VAZAMENTO: agregado via db.session.query contou {total} (esperado 1)"


# ---------------------------------------------------------------------------
# Guard de auth (before_request): fail-closed em token de tenant sem estab
# ---------------------------------------------------------------------------
def test_before_request_fail_closed_sem_estabelecimento(client, session):
    """
    Token autenticado de tenant (não super-admin) SEM estabelecimento_id deve
    receber 403 antes de qualquer query — em vez de vazar dados de todos.
    O before_request roda antes dos decorators da view, então o 403 é do guard.
    """
    from flask_jwt_extended import create_access_token
    token = create_access_token(identity="1", additional_claims={})  # sem estabelecimento_id, sem is_super
    resp = client.get("/api/produtos/", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, (
        f"FAIL-OPEN: token de tenant sem estabelecimento retornou {resp.status_code} (esperado 403)"
    )


def test_before_request_permite_token_valido(client, session):
    """Token de tenant COM estabelecimento_id não deve ser bloqueado pelo guard (não-403)."""
    from flask_jwt_extended import create_access_token
    from app.models import Estabelecimento
    estab = session.query(Estabelecimento).first()
    token = create_access_token(identity="1", additional_claims={"estabelecimento_id": estab.id})
    resp = client.get("/api/produtos/", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code != 403, "Token válido foi bloqueado indevidamente pelo guard de tenant"


# ---------------------------------------------------------------------------
# REGRESSÃO — vazamento na rota /configuracao/estabelecimentos
# Antes do fix: admin de QUALQUER loja listava TODAS as lojas (nome/CNPJ/
# faturamento) de todos os tenants. Depois: admin de loja vê só a própria;
# super admin (nível SaaS) continua vendo todas.
# ---------------------------------------------------------------------------
def test_listar_estabelecimentos_admin_loja_ve_so_a_propria(client, dois_tenants, session):
    from flask_jwt_extended import create_access_token
    a, b = dois_tenants
    user = session.query(Funcionario).first()
    user.estabelecimento_id = a.id
    session.commit()
    token = create_access_token(
        identity="1",
        additional_claims={"estabelecimento_id": a.id, "role": "admin", "is_super_admin": False},
    )
    resp = client.get("/api/configuracao/estabelecimentos",
                      headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    ids = {e["id"] for e in resp.get_json()["estabelecimentos"]}
    assert ids == {a.id}, (
        f"VAZAMENTO: admin da loja {a.id} enxergou estabelecimentos {ids} "
        f"(deveria ver apenas o próprio)"
    )


def test_listar_estabelecimentos_super_admin_ve_todas(client, dois_tenants, session):
    from flask_jwt_extended import create_access_token
    a, b = dois_tenants
    user = session.query(Funcionario).first()
    user.is_super_admin = True
    session.commit()
    token = create_access_token(
        identity="1",
        additional_claims={"role": "admin", "is_super_admin": True},
    )
    resp = client.get("/api/configuracao/estabelecimentos",
                      headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    ids = {e["id"] for e in resp.get_json()["estabelecimentos"]}
    assert {a.id, b.id}.issubset(ids), (
        f"Super admin deveria ver todas as lojas; viu {ids}"
    )


# ---------------------------------------------------------------------------
# MODO ESPELHO do super admin (impersonation): ao escolher uma loja, TODA query
# reflete aquela loja; em visão global ('all') vê tudo; e escrita é bloqueada.
# ---------------------------------------------------------------------------
def test_super_admin_impersonando_espelha_a_loja(dois_tenants):
    """Super admin com g.estabelecimento_id concreto vê SÓ aquela loja (espelho)."""
    a, b = dois_tenants
    g.is_super_admin = True
    g.estabelecimento_id = a.id
    try:
        nomes = {p.nome for p in Produto.query.all()}
        assert "Produto Exclusivo A" in nomes
        assert "Produto Exclusivo B" not in nomes, "ESPELHO FALHOU: super admin viu loja não selecionada"
    finally:
        g.is_super_admin = False


def test_super_admin_global_ve_todas(dois_tenants):
    """Super admin em 'all' (visão global) continua vendo todas as lojas."""
    a, b = dois_tenants
    g.is_super_admin = True
    g.estabelecimento_id = "all"
    try:
        nomes = {p.nome for p in Produto.query.all()}
        assert {"Produto Exclusivo A", "Produto Exclusivo B"}.issubset(nomes)
    finally:
        g.is_super_admin = False


def test_super_admin_espelho_e_somente_leitura(client, session):
    """Impersonando uma loja, escrita no app do tenant é bloqueada (403)."""
    from flask_jwt_extended import create_access_token
    from app.models import Estabelecimento
    estab = session.query(Estabelecimento).first()
    token = create_access_token(identity="1", additional_claims={"is_super_admin": True})
    resp = client.post(
        "/api/produtos/",
        json={"nome": "Tentativa"},
        headers={"Authorization": f"Bearer {token}", "X-Impersonate-Tenant-Id": str(estab.id)},
    )
    assert resp.status_code == 403, (
        f"Modo espelho deveria bloquear escrita (403), retornou {resp.status_code}"
    )


def test_super_admin_espelho_permite_leitura(client, session):
    """Impersonando uma loja, leitura (GET) é permitida (não-403)."""
    from flask_jwt_extended import create_access_token
    from app.models import Estabelecimento
    estab = session.query(Estabelecimento).first()
    from app.models import Funcionario
    admin = session.query(Funcionario).first()
    admin.is_super_admin = True
    session.commit()
    token = create_access_token(identity="1", additional_claims={"is_super_admin": True})
    resp = client.get(
        "/api/produtos/",
        headers={"Authorization": f"Bearer {token}", "X-Impersonate-Tenant-Id": str(estab.id)},
    )
    assert resp.status_code != 403, "Leitura no modo espelho não deveria ser bloqueada"


def test_sem_contexto_nao_vaza_tudo(app, dois_tenants):
    """
    A fronteira de segurança é o REQUEST HTTP: se, DENTRO de um request
    autenticado (não público), o tenant não foi resolvido (ex.: bug/bypass do
    before_request), a query NÃO pode retornar dados de todos os tenants — deve
    falhar fechada (_tenant_atual retorna -1).
    """
    a, b = dois_tenants
    # Simula um request de API autenticado, mas SEM g.estabelecimento_id resolvido.
    with app.test_request_context("/api/produtos/"):
        if hasattr(g, "estabelecimento_id"):
            delattr(g, "estabelecimento_id")
        resultado = Produto.query.all()
        assert len(resultado) == 0, (
            "FAIL-OPEN: request sem tenant resolvido retornou "
            f"{len(resultado)} produtos de todos os tenants"
        )


def test_fora_de_request_nao_filtra_por_padrao(app, dois_tenants):
    """
    FORA de request (CLI/jobs/seeders), cross-tenant é legítimo: por padrão não
    filtra. E allow_all_tenants() torna esse acesso explícito/auditável.
    """
    from app.models import allow_all_tenants
    a, b = dois_tenants
    # Sem request context e sem tenant → acesso global (comportamento de plataforma).
    assert len(Produto.query.all()) >= 2
    with allow_all_tenants():
        assert len(Produto.query.all()) >= 2
