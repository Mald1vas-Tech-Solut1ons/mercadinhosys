"""Testes da Fase 1 do Consultor da Loja:
- Pseudonimização estrita (zero PII de funcionários e clientes enviado ao LLM)
- Correção do contexto de estoque para operadores (is_manager=False com itens parados)
- Telemetria real: funcionario_id do JWT, provider efetivo no fallback, tokens e custo em USD.
"""
import json
from datetime import date, time as dt_time
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Auditoria,
    CategoriaProduto,
    Cliente,
    ConsultorInteracao,
    Estabelecimento,
    Funcionario,
    Produto,
    RegistroPonto,
)
from app.services.consultor.contextos import auditoria, clientes, estoque, rh
from app.services.consultor.contextos._datas import hoje_local
from app.utils import llm_client


def test_pseudonimizacao_rh_nao_vaza_nome_real(session, monkeypatch):
    admin = session.query(Funcionario).first()
    admin.nome = "Maria Funcionaria Secreta"
    ponto = RegistroPonto(
        estabelecimento_id=admin.estabelecimento_id,
        funcionario_id=admin.id,
        data=hoje_local(),
        hora=dt_time(8, 5, 0),
        tipo_registro="entrada",
        minutos_atraso=5,
    )
    session.add(ponto)
    session.commit()

    monkeypatch.setattr(
        rh,
        "calcular_custo_folha_detalhado",
        lambda estab_id, ini, fim: {
            "custo_folha": {"custo_real_total": 3200.0},
            "detalhamento_funcionarios": [
                {
                    "funcionario_id": admin.id,
                    "horas_extras": 120.0,
                    "atrasos_faltas": 15.0,
                    "custo_real": 3200.0,
                }
            ],
        },
    )

    ctx = rh.montar_contexto(admin.estabelecimento_id, is_manager=True)
    serializado = json.dumps(ctx, ensure_ascii=False)

    assert "Maria Funcionaria Secreta" not in serializado
    assert f"Funcionário #{admin.id}" in serializado
    assert ctx["funcionarios_desempenho_mes"][0]["funcionario"] == f"Funcionário #{admin.id}"
    assert "nome" not in ctx["funcionarios_desempenho_mes"][0]
    assert ctx["pontos_batidos_hoje"][0]["funcionario"] == f"Funcionário #{admin.id}"
    assert "nome" not in ctx["pontos_batidos_hoje"][0]


def test_pseudonimizacao_clientes_nao_vaza_nome_real(session):
    estab = session.query(Estabelecimento).first()
    cliente = Cliente(
        estabelecimento_id=estab.id,
        nome="Joao Devedor Secreto",
        celular="92988887777",
        total_compras=5,
        valor_total_gasto=Decimal("850.00"),
        saldo_devedor=Decimal("210.50"),
        ativo=True,
        cep="69000-000",
        logradouro="Rua A",
        numero="10",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
    )
    session.add(cliente)
    session.commit()

    ctx = clientes.montar_contexto(estab.id, is_manager=True)
    serializado = json.dumps(ctx, ensure_ascii=False)

    assert "Joao Devedor Secreto" not in serializado
    assert f"Cliente #{cliente.id}" in serializado
    assert ctx["top_clientes_historico"][0]["cliente"] == f"Cliente #{cliente.id}"
    assert "nome" not in ctx["top_clientes_historico"][0]
    assert ctx["maiores_devedores"][0]["cliente"] == f"Cliente #{cliente.id}"
    assert "nome" not in ctx["maiores_devedores"][0]


def test_pseudonimizacao_auditoria_nao_vaza_nome_real(session):
    admin = session.query(Funcionario).first()
    admin.nome = "Carlos Gerente Secreto"
    log = Auditoria(
        estabelecimento_id=admin.estabelecimento_id,
        usuario_id=admin.id,
        tipo_evento="estorno_venda",
        descricao="Estorno de item no caixa",
    )
    session.add(log)
    session.commit()

    ctx = auditoria.montar_contexto(admin.estabelecimento_id, is_manager=True)
    serializado = json.dumps(ctx, ensure_ascii=False)

    assert "Carlos Gerente Secreto" not in serializado
    assert f"Funcionário #{admin.id}" in serializado
    assert ctx["ultimos_logs"][0]["usuario"] == f"Funcionário #{admin.id}"


def test_estoque_produtos_parados_nao_quebra_para_operador(session):
    estab = session.query(Estabelecimento).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Mercearia")
    session.add(cat)
    session.flush()

    prod = Produto(
        estabelecimento_id=estab.id,
        categoria_id=cat.id,
        nome="Azeite Importado",
        quantidade=Decimal("6.000"),
        quantidade_minima=Decimal("2.000"),
        preco_custo=Decimal("30.0000"),
        preco_venda=Decimal("45.0000"),
        margem_lucro=Decimal("50.0000"),
        ultima_venda=None,
        ativo=True,
    )
    session.add(prod)
    session.commit()

    ctx = estoque.montar_contexto(estab.id, is_manager=False)
    assert ctx["custo_total_parado"] == "Restrito"
    assert len(ctx["top_10_produtos_parados_custo"]) == 1
    item = ctx["top_10_produtos_parados_custo"][0]
    assert item["nome"] == "Azeite Importado"
    assert item["dias_parado"] == ">60"
    assert item["valor_custo_parado"] == "Restrito"


def test_llm_client_retorna_meta_com_provedor_efetivo_e_tokens(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API", "chave-deepseek")
    monkeypatch.setenv("GROQ_API_KEY", "chave-groq")

    class _Resp:
        def __init__(self, status, content="", prompt_t=0, comp_t=0):
            self.status_code = status
            self._content = content
            self.headers = {}
            self._usage = {"prompt_tokens": prompt_t, "completion_tokens": comp_t}

        def json(self):
            return {"choices": [{"message": {"content": self._content}}], "usage": self._usage}

    def fake_post(url, **kwargs):
        if "deepseek" in url:
            return _Resp(503)
        return _Resp(200, "resposta via groq", prompt_t=250, comp_t=75)

    monkeypatch.setattr(llm_client.requests, "post", fake_post)

    meta = llm_client.gerar_resposta_com_meta(
        [{"role": "user", "content": "Analise a loja"}], provider="deepseek"
    )
    assert meta is not None
    assert meta["texto"] == "resposta via groq"
    assert meta["provider"] == "groq"
    assert meta["prompt_tokens"] == 250
    assert meta["completion_tokens"] == 75
    assert meta["custo_estimado_usd"] > 0


def test_chat_e_insights_gravam_funcionario_id_provedor_efetivo_e_tokens(
    client, session, monkeypatch
):
    import app.routes.consultor as routes

    admin = session.query(Funcionario).first()
    token = create_access_token(
        identity=str(admin.id),
        additional_claims={"estabelecimento_id": admin.estabelecimento_id, "role": "ADMIN"},
    )
    headers = {"Authorization": f"Bearer {token}"}

    monkeypatch.setattr(routes, "llm_disponivel", lambda: True)
    monkeypatch.setattr(routes, "verificar_quota_consultor", lambda tenant: True)
    monkeypatch.setattr(routes, "verificar_quota_insight", lambda tenant: True)
    monkeypatch.setattr(
        routes,
        "_recuperar",
        lambda *args: {"fontes": [{"fonte": "vendas", "dados": {"total": 100}}]},
    )
    monkeypatch.setattr(
        routes,
        "gerar_resposta_com_meta",
        lambda *args, **kwargs: {
            "texto": "Faturamento em alta [vendas].",
            "provider": "groq",
            "prompt_tokens": 310,
            "completion_tokens": 64,
            "custo_estimado_usd": 0.00019,
        },
    )

    resp_chat = client.post(
        "/api/consultor/chat",
        headers=headers,
        json={"especialista": "vendas", "mensagem": "Como foram as vendas?"},
    )
    assert resp_chat.status_code == 200
    body_chat = resp_chat.get_json()
    assert body_chat["provider"] == "groq"

    interacao_chat = session.get(ConsultorInteracao, body_chat["interacao_id"])
    assert interacao_chat is not None
    assert interacao_chat.funcionario_id == admin.id
    assert interacao_chat.provider == "groq"
    assert interacao_chat.prompt_tokens == 310
    assert interacao_chat.completion_tokens == 64
    assert float(interacao_chat.custo_estimado_usd) == pytest.approx(0.00019)

    resp_ins = client.post(
        "/api/consultor/insights",
        headers=headers,
        json={"especialista": "vendas", "force_refresh": True},
    )
    assert resp_ins.status_code == 200
    body_ins = resp_ins.get_json()
    assert body_ins["provider"] == "groq"

    interacao_ins = (
        session.query(ConsultorInteracao)
        .filter_by(especialista="insight_vendas")
        .order_by(ConsultorInteracao.id.desc())
        .first()
    )
    assert interacao_ins is not None
    assert interacao_ins.funcionario_id == admin.id
    assert interacao_ins.provider == "groq"
    assert interacao_ins.prompt_tokens == 310
    assert interacao_ins.completion_tokens == 64
