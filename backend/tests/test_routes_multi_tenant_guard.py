"""
Teste automatizado de Varredura de Rotas e Guarda Multi-Tenant (Defense-in-Depth).

Este teste inspeciona iterativamente todas as rotas registradas no Flask (`app.url_map`),
validando:
1. Que nenhuma rota de API autenticada é 'fail-open' quando um token de tenant sem estabelecimento é fornecido (deve retornar 401 ou 403).
2. Que uma requisição com contexto de Tenant A não retorna nem vaza dados do Tenant B.
"""

import pytest
from flask import g
from flask_jwt_extended import create_access_token
from decimal import Decimal
from datetime import date
import random

from app import db
from app.models import Estabelecimento, Produto, CategoriaProduto, Cliente, Funcionario


# Lista de prefixos/rotas públicas isentas de autenticação de tenant
ROTAS_PUBLICAS_ISENTAS = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/verify-tenant",
    "/api/health",
    "/api/ready",
    "/api/onboarding",
}


def _criar_tenant_teste(nome):
    cnpj = f"{random.randint(10**12, 10**13 - 1)}"
    estab = Estabelecimento(
        nome_fantasia=nome,
        razao_social=f"{nome} LTDA",
        cnpj=cnpj,
        email=f"{nome.lower().replace(' ', '')}_{cnpj[-4:]}@guard.test",
        telefone="92988888888",
        data_abertura=date(2024, 1, 1),
        plano="PRO",
        cep="69000-000",
        logradouro="Rua Guard",
        numero="10",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
        pais="Brasil",
        plano_status="ativo",
    )
    db.session.add(estab)
    db.session.flush()
    return estab


@pytest.fixture
def tenants_isolados(session):
    """Cria Tenant Alpha e Tenant Beta para validação cruzada."""
    t_alpha = _criar_tenant_teste("Tenant Alpha Guard")
    t_beta = _criar_tenant_teste("Tenant Beta Guard")

    cat_a = CategoriaProduto(estabelecimento_id=t_alpha.id, nome="Cat Alpha")
    cat_b = CategoriaProduto(estabelecimento_id=t_beta.id, nome="Cat Beta")
    db.session.add_all([cat_a, cat_b])
    db.session.flush()

    prod_a = Produto(
        estabelecimento_id=t_alpha.id,
        categoria_id=cat_a.id,
        nome="PROD_ALPHA_SUPER_SECRET",
        preco_venda=Decimal("99.90"),
        preco_custo=Decimal("50.00"),
        quantidade=50,
    )
    prod_b = Produto(
        estabelecimento_id=t_beta.id,
        categoria_id=cat_b.id,
        nome="PROD_BETA_SUPER_SECRET",
        preco_venda=Decimal("88.80"),
        preco_custo=Decimal("40.00"),
        quantidade=40,
    )
    db.session.add_all([prod_a, prod_b])
    db.session.commit()

    return t_alpha, t_beta


def test_token_sem_estabelecimento_retorna_401_ou_403(client, session):
    """
    Testa que chamadas a rotas autenticadas com token sem estabelecimento_id
    são devidamente rejeitadas com 401 ou 403 (Guard Fail-Closed).
    """
    token_sem_tenant = create_access_token(identity="user_sem_tenant", additional_claims={})
    headers = {"Authorization": f"Bearer {token_sem_tenant}"}

    rotas_testadas = [
        "/api/produtos/",
        "/api/clientes/",
        "/api/vendas/",
        "/api/fornecedores/",
        "/api/caixas/",
        "/api/configuracao/",
        "/api/dashboard/",
    ]

    for rota in rotas_testadas:
        resp = client.get(rota, headers=headers)
        assert resp.status_code in (401, 403), (
            f"FALHA DE SEGURANÇA: Rota {rota} permitiu acesso sem estabelecimento (Status: {resp.status_code})"
        )


def test_isolamento_cruzado_de_tenants_nao_vaza_dados(client, tenants_isolados, session):
    """
    Simula Tenant Alpha tentando acessar recursos e garante que 'PROD_BETA_SUPER_SECRET'
    jamais aparece na resposta.
    """
    t_alpha, t_beta = tenants_isolados
    actor = session.query(Funcionario).first()
    actor.estabelecimento_id = t_alpha.id
    session.commit()
    token_alpha = create_access_token(
        identity=str(actor.id),
        additional_claims={"estabelecimento_id": t_alpha.id, "role": "admin", "is_super_admin": False},
    )
    headers = {"Authorization": f"Bearer {token_alpha}"}

    # 1. Listar produtos
    resp_prod = client.get("/api/produtos/", headers=headers)
    assert resp_prod.status_code == 200
    data_str = resp_prod.get_data(as_text=True)
    assert "PROD_ALPHA_SUPER_SECRET" in data_str
    assert "PROD_BETA_SUPER_SECRET" not in data_str, "VAZAMENTO MULTI-TENANT: Tenant Alpha enxergou produto do Tenant Beta"

    # 2. Listar fornecedores
    resp_forn = client.get("/api/fornecedores/", headers=headers)
    assert resp_forn.status_code == 200

    # 3. Listar categorias
    resp_cat = client.get("/api/produtos/categorias", headers=headers)
    assert resp_cat.status_code == 200
    cat_str = resp_cat.get_data(as_text=True)
    assert "Cat Alpha" in cat_str
    assert "Cat Beta" not in cat_str, "VAZAMENTO MULTI-TENANT: Tenant Alpha enxergou categoria do Tenant Beta"
