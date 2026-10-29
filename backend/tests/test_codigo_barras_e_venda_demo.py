"""Cadastro → etiqueta → venda: o fluxo que a demonstração no cliente precisa.

Prova: (1) EAN-13 interno com dígito verificador certo e em sequência por loja;
(2) gerar código só preenche quem não tem, sem tocar outra loja; (3) código
interno não vai ao catálogo global nem ao Cosmos; (4) produto cadastrado com
estoque inicial vende; (5) sem estoque, a venda é recusada com motivo claro, a
menos que a loja permita — e aí o cancelamento não cria estoque fantasma.
"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CatalogoMestre, CategoriaProduto, Configuracao, Estabelecimento, Funcionario, Produto,
)
import app.routes.produtos as produtos_mod
from app.services.codigo_barras_service import digito_ean13, ean13_valido, eh_codigo_interno


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Demo")
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="DEMO-1",
                  saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                  data_abertura=datetime.now(timezone.utc))
    session.add_all([cat, caixa])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, cat=cat, headers={"Authorization": f"Bearer {token}"})


def _produto(session, ctx, nome, quantidade=0, codigo=None, estab_id=None):
    p = Produto(estabelecimento_id=estab_id or ctx["estab"].id, categoria_id=ctx["cat"].id, nome=nome,
                preco_custo=Decimal("2"), preco_venda=Decimal("5"), quantidade=Decimal(str(quantidade)),
                codigo_barras=codigo)
    session.add(p)
    session.commit()
    return p


def _vender(client, ctx, produto, quantidade=1, preco=5.0):
    total = round(quantidade * preco, 2)
    return client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "items": [{"id": produto.id, "quantity": quantidade, "discount": 0, "price": preco}],
        "subtotal": total, "desconto": 0, "total": total,
        "pagamentos": [{"forma": "pix", "valor": total}], "cliente_id": None,
    })


def _permitir_sem_estoque(session, estab_id, valor):
    config = Configuracao.query.filter_by(estabelecimento_id=estab_id).first()
    if not config:
        config = Configuracao(estabelecimento_id=estab_id)
        session.add(config)
    config.permitir_venda_sem_estoque = valor
    session.commit()


# ── Código de barras interno ───────────────────────────────────────────────

def test_digito_verificador_ean13_confere_com_produto_real():
    assert digito_ean13("789100010010") == "3"  # 7891000100103 (Leite Moça)
    assert ean13_valido("7891000100103") and not ean13_valido("7891000100104")
    assert eh_codigo_interno("2000000000015") and not eh_codigo_interno("7891000100103")


def test_proximo_codigo_segue_a_sequencia_da_loja(client, session, ctx):
    r = client.get("/api/produtos/codigo-barras/proximo", headers=ctx["headers"])
    assert r.status_code == 200
    primeiro = r.get_json()["codigo_barras"]
    assert primeiro.startswith("20") and ean13_valido(primeiro)

    _produto(session, ctx, "Pão de queijo", codigo=primeiro)
    segundo = client.get("/api/produtos/codigo-barras/proximo", headers=ctx["headers"]).get_json()["codigo_barras"]
    assert int(segundo[2:12]) == int(primeiro[2:12]) + 1 and ean13_valido(segundo)


def test_gerar_preenche_so_quem_nao_tem_e_ignora_outra_loja(client, session, ctx):
    granel = _produto(session, ctx, "Feijão a granel")
    industrial = _produto(session, ctx, "Leite Moça", codigo="7891000100103")
    outra = Estabelecimento.query.filter(Estabelecimento.id != ctx["estab"].id).first()
    alheio = _produto(session, ctx, "Produto de outra loja", estab_id=outra.id) if outra else None

    ids = [granel.id, industrial.id] + ([alheio.id] if alheio else [])
    r = client.post("/api/produtos/codigo-barras/gerar", headers=ctx["headers"], json={"produto_ids": ids})
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["gerados"] == 1
    assert ean13_valido(body["codigos"][str(granel.id)]) and body["codigos"][str(granel.id)].startswith("20")
    assert body["codigos"][str(industrial.id)] == "7891000100103"
    if alheio:
        assert str(alheio.id) not in body["codigos"]
        session.expire_all()
        assert not session.get(Produto, alheio.id).codigo_barras


def test_codigo_interno_nao_consulta_cosmos_nem_entra_no_catalogo_global(client, session, ctx, monkeypatch):
    monkeypatch.setattr(produtos_mod.requests, "get",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria consultar")))
    r = client.get("/api/produtos/catalogo/lookup/2000000000015", headers=ctx["headers"])
    assert r.status_code == 404 and r.get_json()["code"] == "interno"

    r = client.post("/api/produtos/", headers=ctx["headers"], json={
        "nome": "Bolo caseiro", "categoria": "Demo", "preco_custo": 10, "preco_venda": 25,
        "codigo_barras": "2000000000015", "quantidade": 3})
    assert r.status_code == 201, r.get_json()
    assert CatalogoMestre.query.filter_by(ean="2000000000015").first() is None


# ── Venda do produto recém-cadastrado ──────────────────────────────────────

def test_produto_cadastrado_com_estoque_inicial_vende_e_baixa(client, session, ctx):
    r = client.post("/api/produtos/", headers=ctx["headers"], json={
        "nome": "Sabonete Demo", "categoria": "Demo", "preco_custo": 1.5, "preco_venda": 3.5,
        "quantidade": 12})
    assert r.status_code == 201, r.get_json()
    produto = Produto.query.filter_by(nome="SABONETE DEMO").first()
    r = _vender(client, ctx, produto, quantidade=2, preco=3.5)
    assert r.status_code == 201, r.get_json()
    session.expire_all()
    assert session.get(Produto, produto.id).quantidade == Decimal("10")


def test_sem_estoque_recusa_com_motivo_claro(client, session, ctx):
    _permitir_sem_estoque(session, ctx["estab"].id, False)
    produto = _produto(session, ctx, "Sem saldo")
    r = _vender(client, ctx, produto)
    assert r.status_code == 400
    assert "Estoque insuficiente" in r.get_json()["error"]


def test_loja_que_permite_vende_sem_estoque_e_cancelamento_nao_cria_fantasma(client, session, ctx):
    _permitir_sem_estoque(session, ctx["estab"].id, True)
    produto = _produto(session, ctx, "Cadastrado na hora", quantidade=1)
    r = _vender(client, ctx, produto, quantidade=3)
    assert r.status_code == 201, r.get_json()
    session.expire_all()
    # Saldo negativo: 2 vendidos antes de a nota entrar (com piso 0, a nota criaria estoque fantasma)
    assert session.get(Produto, produto.id).quantidade == Decimal("-2")

    venda_id = r.get_json()["venda"]["id"]
    r = client.post(f"/api/vendas/{venda_id}/cancelar", headers=ctx["headers"],
                    json={"motivo": "Teste", "senha_admin": "industrial-secret"})
    assert r.status_code == 200, r.get_json()
    session.expire_all()
    # Cancelamento devolve os 3 vendidos: volta ao saldo de antes da venda
    assert session.get(Produto, produto.id).quantidade == Decimal("1")



# ── Login atrás do proxy ───────────────────────────────────────────────────

def test_ip_do_cliente_vem_do_proxy_e_nao_do_caddy(app, client):
    """Rate limit e auditoria precisam do IP real; com o IP do Caddy todas as lojas dividiam 5 logins/min."""
    from flask import request, request_started
    vistos = []

    def capturar(sender, **extra):
        vistos.append(request.remote_addr)
    request_started.connect(capturar, app)
    try:
        client.get("/api/health", environ_base={"REMOTE_ADDR": "172.18.0.5"},
                   headers={"X-Forwarded-For": "200.100.50.25"})
    finally:
        request_started.disconnect(capturar, app)
    assert vistos == ["200.100.50.25"]


def test_nota_lancada_depois_da_venda_sem_estoque_nao_cria_fantasma(client, session, ctx):
    _permitir_sem_estoque(session, ctx["estab"].id, True)
    produto = _produto(session, ctx, "Chegou antes da nota", quantidade=0)
    assert _vender(client, ctx, produto, quantidade=5).status_code == 201
    r = client.post(f"/api/produtos/{produto.id}/estoque", headers=ctx["headers"],
                    json={"tipo": "entrada", "quantidade": 12, "motivo": "Entrada NF", "custo_unitario": 1})
    assert r.status_code == 200, r.get_json()
    session.expire_all()
    assert session.get(Produto, produto.id).quantidade == Decimal("7")  # 12 recebidos - 5 já vendidos
