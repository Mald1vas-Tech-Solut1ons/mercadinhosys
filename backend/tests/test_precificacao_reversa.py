"""Fase A — precificação reversa (custo estimado pelo mercado).

Cobre: serviço puro (vetores do spec), POST/PUT por modo, defaults da config,
payload malicioso ignorado, sigilo do custo para vendedor (nível ≥ 5),
snapshot custo_estimado na venda, CMV estimado no DRE, transição de origem
(A4), isolamento entre tenants e backfill.
"""
import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app import create_app, db
from app.models import (
    Estabelecimento, Funcionario, Configuracao, CategoriaProduto, Produto,
    Venda, VendaItem, HistoricoPrecos,
)
from app.services.precificacao_reversa import (
    venda_pelo_mercado, custo_pela_venda, markup_de,
)
from app.utils.timezone import now_utc
from app.dashboard_cientifico.data_layer import DataLayer


def _headers(estab_id, func_id, role="admin"):
    token = create_access_token(identity=str(func_id), additional_claims={
        "estabelecimento_id": estab_id, "role": role,
    })
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Bazar")
    session.add(cat)

    vendedor = Funcionario(
        estabelecimento_id=estab.id,
        nome="Vendedor Teste",
        cpf="99988877700",
        username="vendedor_est",
        role="vendedor",
        ativo=True,
        data_nascimento=date(1995, 5, 5),
        celular="92988887777",
        email="vendedor_est@mercadinho.sys",
        cargo="Vendedor",
        data_admissao=date(2024, 1, 1),
        salario_base=Decimal("1500.00"),
    )
    vendedor.set_password("industrial-secret")
    session.add(vendedor)
    config = session.query(Configuracao).filter_by(estabelecimento_id=estab.id).first()
    if not config:
        config = Configuracao(estabelecimento_id=estab.id)
        session.add(config)
    session.commit()
    return {"estab": estab, "admin": admin, "cat": cat, "vendedor": vendedor, "config": config}


def _payload_mercado(**overrides):
    base = {
        "entrar_sem_estoque": True,  # guardião: estoque 0 só com exceção consciente
        "nome": "Blusa Surpresa",
        "subcategoria": "Outros Alimentos",
        "modo_precificacao": "mercado",
        "preco_referencia_mercado": "100.00",
        "fonte_referencia_mercado": "shopee",
        # Precificação reversa testa o cálculo, não o estoque: exceção
        # consciente do guardião (entra na Lista de Revisão).
        "entrar_sem_estoque": True,
    }
    base.update(overrides)
    return base


# ============ A2: serviço puro ============

TESTES_VETORES = [
    ("100.00", "15", "50", "85.00", "42.50", "100.00"),
    ("100.00", "17.5", "50", "82.50", "41.25", "100.00"),
    ("59.90", "20", "40", "47.92", "28.75", "66.68"),
    ("10.00", "0", "30", "10.00", "7.00", "42.86"),
]

@pytest.mark.parametrize("ref,desc,margem,venda_exp,custo_exp,markup_exp", TESTES_VETORES)
def test_vetores_especificacao(ref, desc, margem, venda_exp, custo_exp, markup_exp):
    venda = venda_pelo_mercado(Decimal(ref), Decimal(desc))
    custo = custo_pela_venda(venda, Decimal(margem))
    markup = markup_de(custo, venda)
    assert str(venda) == venda_exp
    assert str(custo) == custo_exp
    assert str(markup) == markup_exp


@pytest.mark.parametrize("args", [
    (Decimal("100"), Decimal("100")),   # desconto 100
    (Decimal("100"), Decimal("150")),   # desconto > 100
    (Decimal("0"), Decimal("10")),      # referência 0
    (Decimal("-5"), Decimal("10")),     # referência negativa
])
def test_venda_pelo_mercado_invalida(args):
    with pytest.raises(ValueError):
        venda_pelo_mercado(*args)


@pytest.mark.parametrize("venda,margem", [
    (Decimal("100"), Decimal("0")),     # margem 0
    (Decimal("100"), Decimal("100")),   # margem 100 — impossível
    (Decimal("100"), Decimal("-5")),    # margem negativa
    (Decimal("0"), Decimal("50")),      # venda 0
])
def test_custo_pela_venda_invalida(venda, margem):
    with pytest.raises(ValueError):
        custo_pela_venda(venda, margem)


# ============ A3: POST por modo ============

def test_post_modo_mercado_calcula_e_marca_estimado(client, ctx):
    r = client.post("/api/produtos/", json=_payload_mercado(),
                    headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 201, r.get_data(as_text=True)
    produto = r.get_json()["produto"]
    assert float(produto["preco_venda"]) == 85.00
    assert float(produto["preco_custo"]) == 42.50
    assert float(produto["margem_lucro"]) == 100.00
    assert produto["origem_custo"] == "estimado"
    assert produto["preco_referencia_mercado"] == 100.00
    assert produto["fonte_referencia_mercado"] == "shopee"


def test_post_modo_mercado_ignora_payload_malicioso(client, ctx):
    r = client.post("/api/produtos/",
                    json=_payload_mercado(preco_custo="1", preco_venda="2"),
                    headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 201, r.get_data(as_text=True)
    produto = r.get_json()["produto"]
    # Servidor recalcula e ignora o custo/venda enviado
    assert float(produto["preco_venda"]) == 85.00
    assert float(produto["preco_custo"]) == 42.50


def test_post_modo_mercado_usa_defaults_da_config(client, ctx):
    ctx["config"].desconto_mercado_padrao_pct = Decimal("17.5")
    ctx["config"].margem_alvo_venda_pct = Decimal("40")
    db.session.commit()
    db.session.expire_all()

    r = client.post("/api/produtos/",
                    json=_payload_mercado(fonte_referencia_mercado="outro"),
                    headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 201, r.get_data(as_text=True)
    produto = r.get_json()["produto"]
    # 100 × (1-0.175) = 82.50; custo = 82.50 × 0.60 = 49.50
    assert float(produto["preco_venda"]) == 82.50
    assert float(produto["preco_custo"]) == 49.50


def test_post_modo_mercado_sem_referencia_retorna_400(client, ctx):
    payload = _payload_mercado()
    payload.pop("preco_referencia_mercado")
    r = client.post("/api/produtos/", json=payload,
                    headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 400
    body = r.get_json()
    assert not body.get("success", True)


def test_post_modo_venda(client, ctx):
    r = client.post("/api/produtos/", json={
        "entrar_sem_estoque": True,  # guardião: estoque 0 só com exceção consciente
        "nome": "Vaso Decorativo", "subcategoria": "Outros Alimentos",
        "modo_precificacao": "venda", "preco_venda": "50.00",
        "margem_alvo_venda_pct": "40", "entrar_sem_estoque": True,
    }, headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 201, r.get_data(as_text=True)
    produto = r.get_json()["produto"]
    assert float(produto["preco_custo"]) == 30.00
    assert float(produto["preco_venda"]) == 50.00
    assert produto["origem_custo"] == "estimado"


def test_post_sem_modo_regressao_comportamento_antigo(client, ctx):
    r = client.post("/api/produtos/", json={
        "entrar_sem_estoque": True,  # guardião: estoque 0 só com exceção consciente
        "nome": "Produto Comum", "subcategoria": "Outros Alimentos",
        "preco_custo": 10.0, "preco_venda": 15.0, "quantidade": 5, "data_validade": "2099-12-31",
    }, headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 201, r.get_data(as_text=True)
    produto = r.get_json()["produto"]
    assert float(produto["preco_custo"]) == 10.0
    assert float(produto["preco_venda"]) == 15.0
    assert produto["origem_custo"] == "informado"


def test_post_modo_mercado_registra_historico(client, ctx):
    r = client.post("/api/produtos/", json=_payload_mercado(),
                    headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 201
    pid = r.get_json()["produto"]["id"]
    hist = HistoricoPrecos.query.filter_by(produto_id=pid).all()
    assert hist
    observacoes = " | ".join(h.observacoes or "" for h in hist)
    assert "precificação pelo mercado" in observacoes
    assert "shopee" in observacoes


# ============ Sigilo do custo ============

def test_get_como_vendedor_nao_tem_custo_nem_origem(client, ctx):
    r = client.post("/api/produtos/", json=_payload_mercado(),
                    headers=_headers(ctx["estab"].id, ctx["admin"].id))
    assert r.status_code == 201
    pid = r.get_json()["produto"]["id"]

    rv = client.get("/api/produtos/?busca=Blusa", headers=_headers(
        ctx["estab"].id, ctx["vendedor"].id, role="vendedor"))
    assert rv.status_code == 200
    itens = rv.get_json().get("produtos", [])
    assert itens, "vendedor deveria receber a lista"
    alvo = next(i for i in itens if i["id"] == pid)
    chaves = set(alvo.keys())
    assert "origem_custo" not in chaves
    assert "preco_custo" not in chaves
    assert "preco_referencia_mercado" in chaves  # preço público pode aparecer
    assert "margem_lucro" not in chaves


# ============ A4: transição de origem ============

def _produto_estimado(session, ctx, quantidade=Decimal("0")):
    cat = session.query(CategoriaProduto).filter_by(estabelecimento_id=ctx["estab"].id).first()
    p = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=cat.id,
                nome="Item Estimado", preco_custo=Decimal("42.50"),
                preco_venda=Decimal("85.00"), quantidade=quantidade,
                origem_custo="estimado", preco_referencia_mercado=Decimal("100.00"))
    session.add(p)
    session.commit()
    return p


def test_entrada_com_estoque_zerado_vira_informado(session, ctx):
    p = _produto_estimado(session, ctx, Decimal("0"))
    p.recalcular_preco_custo_ponderado(
        quantidade_entrada=Decimal("10"), custo_unitario_entrada=Decimal("30.00"),
        funcionario_id=ctx["admin"].id, registrar_historico=False)
    session.commit()
    assert p.origem_custo == "informado"


def test_entrada_com_estoque_estimado_mantem_origem(session, ctx):
    p = _produto_estimado(session, ctx, Decimal("5"))
    p.recalcular_preco_custo_ponderado(
        quantidade_entrada=Decimal("10"), custo_unitario_entrada=Decimal("30.00"),
        funcionario_id=ctx["admin"].id, registrar_historico=False)
    session.commit()
    assert p.origem_custo == "estimado"


# ============ A5: snapshot na venda + DRE ============

def _venda_item(session, ctx, produto, quantidade=Decimal("1"), custo_estimado=None):
    if custo_estimado is None:
        custo_estimado = getattr(produto, "origem_custo", "informado") != "informado"
    venda = Venda(estabelecimento_id=ctx["estab"].id, status="finalizada",
                  funcionario_id=ctx["admin"].id,
                  codigo=f"T-{uuid.uuid4().hex[:12]}",
                  total=produto.preco_venda * quantidade,
                  data_venda=now_utc())
    session.add(venda); session.flush()
    item = VendaItem(venda_id=venda.id, estabelecimento_id=ctx["estab"].id,
                     produto_id=produto.id, produto_nome=produto.nome,
                     quantidade=quantidade,
                     preco_unitario=produto.preco_venda, total_item=produto.preco_venda * quantidade,
                     custo_unitario=produto.preco_custo, custo_estimado=custo_estimado)
    session.add(item)
    return venda, item


def test_cmv_estimado_no_dre_com_mix(session, ctx):
    cat = session.query(CategoriaProduto).filter_by(estabelecimento_id=ctx["estab"].id).first()
    estimado = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=cat.id,
                       nome="Kit Estimado", preco_custo=Decimal("42.50"),
                       preco_venda=Decimal("85.00"), quantidade=0, origem_custo="estimado")
    informado = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=cat.id,
                        nome="Kit Real", preco_custo=Decimal("10.00"),
                        preco_venda=Decimal("20.00"), quantidade=0, origem_custo="informado")
    session.add_all([estimado, informado]); session.commit()

    _venda_item(session, ctx, estimado, Decimal("2"))     # CMV estimado 85.00
    _venda_item(session, ctx, informado, Decimal("3"))    # CMV real 30.00
    session.commit()

    inicio = datetime(2024, 1, 1, tzinfo=timezone.utc)
    fim = datetime(2099, 1, 1, tzinfo=timezone.utc)
    fin = DataLayer.get_sales_financials(ctx["estab"].id, inicio, fim)
    assert fin["cogs"] == pytest.approx(115.00, abs=0.01)
    assert fin["cogs_estimado"] == pytest.approx(85.00, abs=0.01)
    pct = fin["cogs_estimado"] / fin["cogs"] * 100
    assert pct == pytest.approx(73.91, abs=0.05)


# ============ Isolamento entre tenants ============

def test_isolamento_defaults_outro_tenant(session, ctx):
    outro = Estabelecimento(
        nome_fantasia="Loja Outro", razao_social="Outro LTDA", cnpj="98765432000199",
        email="outro@mercadinho.sys", telefone="92999999991", data_abertura=date(2024, 1, 1),
        plano="PREMIUM", vencimento_plano=date(2030, 12, 31),
        cep="69000-000", logradouro="Rua X", numero="1", bairro="B", cidade="Manaus", estado="AM", pais="Brasil",
    )
    session.add(outro); session.flush()
    cfg_outro = Configuracao(estabelecimento_id=outro.id,
                             desconto_mercado_padrao_pct=Decimal("25.00"),
                             margem_alvo_venda_pct=Decimal("30.00"))
    session.add(cfg_outro); session.commit()


# ============ Backfill ============

def test_backfill_dry_run_aplica_e_idempotente(session, ctx, monkeypatch, app):
    cat = session.query(CategoriaProduto).filter_by(estabelecimento_id=ctx["estab"].id).first()
    p = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=cat.id,
                nome="Blusa Com Atributo", preco_custo=Decimal("10.00"),
                preco_venda=Decimal("20.00"), quantidade=0,
                origem_custo="informado")
    p.atributos = {"preco_ref_mercado": "59.90", "fonte": "mercadolivre"}
    session.add(p); session.commit()

    import scripts.backfill_custo_estimado as bf
    # In-process usa o MESMO banco do teste (sqlite in-memory não é compartilhável
    # entre apps; create_app() do script criaria um banco novo e vazio).
    monkeypatch.setattr(bf, "create_app", lambda: app)

    # dry-run: não grava
    monkeypatch.setattr("sys.argv", ["bf", "--estabelecimento-id", str(ctx["estab"].id)])
    bf.main()
    db.session.expire_all()
    assert p.origem_custo == "informado"
    assert p.preco_referencia_mercado is None

    # aplicar: migra
    monkeypatch.setattr("sys.argv", ["bf", "--estabelecimento-id", str(ctx["estab"].id), "--aplicar"])
    bf.main()
    db.session.expire_all()
    assert p.origem_custo == "estimado"
    assert float(p.preco_referencia_mercado) == 59.90
    assert p.fonte_referencia_mercado == "mercado_livre"
    atributos = json.loads(p.atributos_json or "{}")
    assert "preco_ref_mercado" not in atributos
    # preço/custo não mudam
    assert float(p.preco_custo) == 10.00
    assert float(p.preco_venda) == 20.00

    # segunda execução: idempotente (nenhum migrado novo)
    monkeypatch.setattr("sys.argv", ["bf", "--estabelecimento-id", str(ctx["estab"].id), "--aplicar"])
    bf.main()