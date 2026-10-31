"""Testes das Fases 3 e 4 do Consultor da Loja:
- Paridade numérica entre os Context Builders (Financeiro, Vendas e Estoque)
- Opt-in / Opt-out LGPD (`ai_consultor_ativo`) bloqueando processamento externo quando desligado
- Endpoint de métricas de adoção, tokens, latência e custo (`GET /api/consultor/metricas`)
- Cache server-side de insights (TTL 300s): não queima cota nem chama LLM em montagens repetidas
- Fontes detalhadas ("De onde veio este número") em linguagem de loja.
"""
from datetime import timedelta
from decimal import Decimal
import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    CategoriaProduto,
    Configuracao,
    ConsultorInteracao,
    ContaPagar,
    Despesa,
    Estabelecimento,
    Fornecedor,
    Funcionario,
    Produto,
    Venda,
)
from app.services.consultor.contextos import estoque, financeiro, vendas, limpar_cache
from app.services.consultor.contextos._datas import hoje_local


def _headers(admin, role="ADMIN"):
    token = create_access_token(
        identity=str(admin.id),
        additional_claims={"estabelecimento_id": admin.estabelecimento_id, "role": role},
    )
    return {"Authorization": f"Bearer {token}"}


def test_paridade_numerica_context_builders_financeiro_vendas_e_estoque(session):
    limpar_cache()
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).first()
    hoje = hoje_local()

    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Alimentos")
    forn = Fornecedor(
        estabelecimento_id=estab.id,
        nome_fantasia="Fornecedor Paridade",
        razao_social="Fornecedor Paridade LTDA",
        cnpj="33444555000103",
        telefone="92999992222",
        email="paridade@forn.com",
        cep="69000-000",
        logradouro="Rua 1",
        numero="10",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
    )
    session.add_all([cat, forn])
    session.flush()

    p1 = Produto(
        estabelecimento_id=estab.id,
        categoria_id=cat.id,
        fornecedor_id=forn.id,
        nome="Feijão Carioca 1kg",
        quantidade=Decimal("3.000"),
        quantidade_minima=Decimal("10.000"),
        preco_custo=Decimal("6.0000"),
        preco_venda=Decimal("9.5000"),
        ativo=True,
    )
    session.add(p1)

    v1 = Venda(
        estabelecimento_id=estab.id,
        funcionario_id=admin.id,
        codigo="VND-PAR-001",
        subtotal=Decimal("150.00"),
        total=Decimal("150.00"),
        status="finalizada",
    )
    v2 = Venda(
        estabelecimento_id=estab.id,
        funcionario_id=admin.id,
        codigo="VND-PAR-002",
        subtotal=Decimal("250.00"),
        total=Decimal("250.00"),
        status="finalizada",
    )
    v_canc = Venda(
        estabelecimento_id=estab.id,
        funcionario_id=admin.id,
        codigo="VND-PAR-003",
        subtotal=Decimal("99.00"),
        total=Decimal("99.00"),
        status="cancelada",
    )
    d1 = Despesa(
        estabelecimento_id=estab.id,
        descricao="Energia elétrica",
        categoria="utilidades",
        valor=Decimal("120.00"),
        data_despesa=hoje,
    )
    cp_atrasado = ContaPagar(
        estabelecimento_id=estab.id,
        fornecedor_id=forn.id,
        numero_documento="BOL-001",
        valor_original=Decimal("80.00"),
        valor_atual=Decimal("80.00"),
        data_emissao=hoje - timedelta(days=10),
        data_vencimento=hoje - timedelta(days=1),
        status="aberto",
    )
    session.add_all([v1, v2, v_canc, d1, cp_atrasado])
    session.commit()

    ctx_fin = financeiro.montar_contexto(estab.id, is_manager=True)
    ctx_ven = vendas.montar_contexto(estab.id, is_manager=True)
    ctx_est = estoque.montar_contexto(estab.id, is_manager=True)

    # Paridade exata de faturamento entre Financeiro e Vendas (400.00, ignorando a cancelada)
    assert ctx_fin["receita_mes_atual"] == pytest.approx(400.00)
    assert ctx_ven["mes_atual"]["faturamento"] == pytest.approx(ctx_fin["receita_mes_atual"])
    assert ctx_ven["hoje"]["faturamento"] == pytest.approx(400.00)
    assert ctx_ven["hoje"]["qtd"] == 2
    assert ctx_ven["hoje"]["ticket_medio"] == pytest.approx(200.00)
    assert ctx_ven["vendas_canceladas_mes_atual"]["qtd"] == 1
    assert ctx_ven["vendas_canceladas_mes_atual"]["total"] == pytest.approx(99.00)

    # Boletos atrasados e resultado financeiro coerentes
    assert ctx_fin["total_boletos_atrasados"] == pytest.approx(80.00)
    assert ctx_fin["resultado_mes_atual"] == pytest.approx(
        round(ctx_fin["receita_mes_atual"] - ctx_fin["total_despesas_mes_atual"], 2)
    )

    # Paridade de estoque
    assert ctx_est["produtos_ativos_qtd"] == 1
    assert len(ctx_est["alertas_estoque_minimo"]) == 1
    assert ctx_est["alertas_estoque_minimo"][0]["nome"] == "Feijão Carioca 1kg"


def test_opt_out_lgpd_bloqueia_consultor_quando_desativado(client, session, monkeypatch):
    import app.routes.consultor as routes

    monkeypatch.setattr(routes, "llm_disponivel", lambda: True)
    admin = session.query(Funcionario).first()
    headers = _headers(admin, "ADMIN")

    # Desativa via endpoint de configuração
    resp_cfg = client.put(
        "/api/configuracao/",
        headers=headers,
        json={"ai_consultor_ativo": False},
    )
    assert resp_cfg.status_code == 200, resp_cfg.get_data(as_text=True)

    cfg_db = session.query(Configuracao).filter_by(estabelecimento_id=admin.estabelecimento_id).first()
    session.refresh(cfg_db)
    assert cfg_db.ai_consultor_ativo is False

    # Chat deve bloquear com 403 e código AI_OPTED_OUT
    r_chat = client.post(
        "/api/consultor/chat",
        headers=headers,
        json={"especialista": "geral", "mensagem": "Oi"},
    )
    assert r_chat.status_code == 403
    assert r_chat.get_json().get("code") == "AI_OPTED_OUT"

    # Insights deve retornar 200 silencioso (sem quebrar cards do painel)
    r_ins = client.post(
        "/api/consultor/insights",
        headers=headers,
        json={"especialista": "geral"},
    )
    assert r_ins.status_code == 200
    assert r_ins.get_json()["insights"] is None
    assert "desativado" in r_ins.get_json()["aviso"].lower()


def test_insights_cache_server_side_nao_queima_cota_nem_chama_llm_repetido(
    client, session, monkeypatch
):
    import app.routes.consultor as routes

    routes.limpar_cache_insights()
    admin = session.query(Funcionario).first()
    headers = _headers(admin, "ADMIN")

    chamadas = []
    monkeypatch.setattr(routes, "llm_disponivel", lambda: True)
    monkeypatch.setattr(routes, "verificar_quota_insight", lambda tenant: True)
    monkeypatch.setattr(
        routes,
        "_recuperar",
        lambda *args: {"fontes": [{"fonte": "vendas", "dados": {"total": 500}}]},
    )

    def fake_meta(*args, **kwargs):
        chamadas.append(1)
        return {
            "texto": f"1. Vendas boas ({len(chamadas)})\n2. Sem riscos\n3. Manter ritmo",
            "provider": "deepseek",
            "prompt_tokens": 100,
            "completion_tokens": 30,
            "custo_estimado_usd": 0.00002,
        }

    monkeypatch.setattr(routes, "gerar_resposta_com_meta", fake_meta)

    r1 = client.post("/api/consultor/insights", headers=headers, json={"especialista": "vendas"})
    assert r1.status_code == 200
    b1 = r1.get_json()
    assert b1["cached"] is False
    assert len(b1["fontes_detalhadas"]) == 1
    assert len(chamadas) == 1

    # 2ª chamada sem force_refresh: vem do cache server-side, sem chamar LLM nem gravar nova interação
    r2 = client.post("/api/consultor/insights", headers=headers, json={"especialista": "vendas"})
    assert r2.status_code == 200
    b2 = r2.get_json()
    assert b2["cached"] is True
    assert b2["insights"] == b1["insights"]
    assert len(chamadas) == 1

    # 3ª chamada com force_refresh=True: ignora cache e chama o LLM
    r3 = client.post(
        "/api/consultor/insights",
        headers=headers,
        json={"especialista": "vendas", "force_refresh": True},
    )
    assert r3.status_code == 200
    b3 = r3.get_json()
    assert b3["cached"] is False
    assert len(chamadas) == 2


def test_metricas_consultor_retorna_tokens_custo_e_provedores(client, session):
    admin = session.query(Funcionario).first()
    session.add_all([
        ConsultorInteracao(
            estabelecimento_id=admin.estabelecimento_id,
            funcionario_id=admin.id,
            especialista="financeiro",
            pergunta="Como está o caixa?",
            resposta="Caixa positivo.",
            provider="deepseek",
            duracao_ms=800,
            prompt_tokens=400,
            completion_tokens=100,
            custo_estimado_usd=Decimal("0.000084"),
        ),
        ConsultorInteracao(
            estabelecimento_id=admin.estabelecimento_id,
            funcionario_id=admin.id,
            especialista="insight_vendas",
            pergunta="Gere os insights agora.",
            resposta="1. Bom\n2. Alerta\n3. Ação",
            provider="groq",
            duracao_ms=400,
            prompt_tokens=200,
            completion_tokens=50,
            custo_estimado_usd=Decimal("0.000035"),
        ),
    ])
    session.commit()

    resp = client.get("/api/consultor/metricas", headers=_headers(admin, "ADMIN"))
    assert resp.status_code == 200, resp.get_data(as_text=True)
    data = resp.get_json()
    assert data["success"] is True
    assert data["interacoes_hoje"]["chat"] == 1
    assert data["interacoes_hoje"]["insights"] == 1
    assert data["tokens_mes"]["prompt_tokens"] == 600
    assert data["tokens_mes"]["completion_tokens"] == 150
    assert data["custo_estimado_mes_usd"] == pytest.approx(0.000119)
    assert data["por_provedor"]["deepseek"] == 1
    assert data["por_provedor"]["groq"] == 1
    assert data["latencia_media_ms"] == 600
