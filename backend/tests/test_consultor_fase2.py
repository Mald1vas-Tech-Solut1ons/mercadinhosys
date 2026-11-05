"""Testes da Fase 2 do Consultor da Loja:
- Whitelist de ações com confirmação humana (`criar_lembrete` e `gerar_pedido_compra`)
- Bloqueio de ações fora da whitelist, RBAC (apenas gestores) e isolamento Multi-Tenant
- Resumo diário proativo (`GET /api/consultor/resumo-diario`) com cache diário (não queima LLM repetido)
- Inclusão de `acoes_sugeridas` no chat e no resumo diário.
"""
from decimal import Decimal
import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Auditoria,
    CategoriaProduto,
    ConsultorInteracao,
    Estabelecimento,
    Fornecedor,
    Funcionario,
    PedidoCompra,
    Produto,
)


def _headers_para(funcionario, role_override=None):
    role = role_override or funcionario.role or "ADMIN"
    token = create_access_token(
        identity=str(funcionario.id),
        additional_claims={
            "estabelecimento_id": funcionario.estabelecimento_id,
            "role": role,
        },
    )
    return {"Authorization": f"Bearer {token}"}


def test_whitelist_bloqueia_acao_nao_autorizada(client, session):
    admin = session.query(Funcionario).first()
    resp = client.post(
        "/api/consultor/acoes/executar",
        headers=_headers_para(admin, "ADMIN"),
        json={"acao": "apagar_banco", "parametros": {}},
    )
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["success"] is False
    assert "whitelist" in data["error"].lower() or "permitida" in data["error"].lower()


def test_acao_bloqueada_para_perfil_operacional_caixa(client, session):
    admin = session.query(Funcionario).first()
    resp = client.post(
        "/api/consultor/acoes/executar",
        headers=_headers_para(admin, "CAIXA"),
        json={
            "acao": "criar_lembrete",
            "parametros": {"titulo": "Pagar boleto fornecedor", "observacoes": "Vence hoje"},
        },
    )
    assert resp.status_code == 403


def test_executar_acao_criar_lembrete_registra_auditoria_e_interacao(client, session):
    admin = session.query(Funcionario).first()
    resp = client.post(
        "/api/consultor/acoes/executar",
        headers=_headers_para(admin, "ADMIN"),
        json={
            "acao": "criar_lembrete",
            "parametros": {
                "titulo": "Conferir boletos da semana",
                "observacoes": "2 títulos vencem nos próximos 3 dias",
                "valor": 450.0,
            },
        },
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["success"] is True
    assert body["acao"] == "criar_lembrete"

    log = (
        session.query(Auditoria)
        .filter_by(
            estabelecimento_id=admin.estabelecimento_id,
            tipo_evento="lembrete_consultor",
        )
        .first()
    )
    assert log is not None
    assert log.usuario_id == admin.id
    assert "Conferir boletos da semana" in log.descricao

    interacao = (
        session.query(ConsultorInteracao)
        .filter_by(
            estabelecimento_id=admin.estabelecimento_id,
            especialista="acao_criar_lembrete",
        )
        .first()
    )
    assert interacao is not None
    assert interacao.funcionario_id == admin.id


def test_executar_acao_gerar_pedido_compra_cria_rascunho_e_respeita_tenant(client, session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).first()

    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Bebidas")
    forn = Fornecedor(
        estabelecimento_id=estab.id,
        nome_fantasia="Distribuidora Norte",
        razao_social="Distribuidora Norte LTDA",
        cnpj="11222333000181",
        telefone="92999990000",
        email="contato@norte.com",
        cep="69000-000",
        logradouro="Av Brasil",
        numero="100",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
    )
    session.add_all([cat, forn])
    session.flush()

    prod = Produto(
        estabelecimento_id=estab.id,
        categoria_id=cat.id,
        fornecedor_id=forn.id,
        nome="Refrigerante 2L",
        quantidade=Decimal("2.000"),
        quantidade_minima=Decimal("10.000"),
        preco_custo=Decimal("5.5000"),
        preco_venda=Decimal("9.0000"),
        ativo=True,
    )
    session.add(prod)
    session.commit()

    resp = client.post(
        "/api/consultor/acoes/executar",
        headers=_headers_para(admin, "ADMIN"),
        json={
            "acao": "gerar_pedido_compra",
            "parametros": {
                "fornecedor_id": forn.id,
                "itens": [{"produto_id": prod.id, "quantidade": 18}],
            },
        },
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["success"] is True
    assert body["acao"] == "gerar_pedido_compra"
    assert body["pedido_compra_id"] is not None

    pedido = session.get(PedidoCompra, body["pedido_compra_id"])
    assert pedido is not None
    assert pedido.estabelecimento_id == estab.id
    assert pedido.fornecedor_id == forn.id
    assert pedido.funcionario_id == admin.id
    assert pedido.status == "pendente"
    assert float(pedido.total) == pytest.approx(18 * 5.5)
    assert len(pedido.itens) == 1
    assert pedido.itens[0].produto_id == prod.id
    assert float(pedido.itens[0].quantidade_solicitada) == pytest.approx(18.0)


def test_resumo_diario_proativo_cacheia_no_dia_e_traz_acoes_sugeridas(
    client, session, monkeypatch
):
    import app.routes.consultor as routes

    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).first()

    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Grãos")
    forn = Fornecedor(
        estabelecimento_id=estab.id,
        nome_fantasia="Atacado Sul",
        razao_social="Atacado Sul LTDA",
        cnpj="22333444000192",
        telefone="92999991111",
        email="contato@sul.com",
        cep="69000-000",
        logradouro="Av Sul",
        numero="200",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
    )
    session.add_all([cat, forn])
    session.flush()

    prod_ruptura = Produto(
        estabelecimento_id=estab.id,
        categoria_id=cat.id,
        fornecedor_id=forn.id,
        nome="Arroz Tipo 1 5kg",
        quantidade=Decimal("1.000"),
        quantidade_minima=Decimal("12.000"),
        preco_custo=Decimal("18.0000"),
        preco_venda=Decimal("26.0000"),
        ativo=True,
    )
    session.add(prod_ruptura)
    session.commit()

    # O resumo é montado do banco: não pode chamar LLM nenhum.
    def llm_proibido(*args, **kwargs):
        raise AssertionError("resumo diário não deve chamar o LLM")

    monkeypatch.setattr(routes, "gerar_resposta_com_meta", llm_proibido)

    headers = _headers_para(admin, "ADMIN")
    r1 = client.get("/api/consultor/resumo-diario", headers=headers)
    assert r1.status_code == 200, r1.get_data(as_text=True)
    b1 = r1.get_json()
    assert b1["success"] is True
    assert [i["chave"] for i in b1["itens"]] == ["vendas", "estoque", "contas"]
    estoque_txt = next(i["texto"] for i in b1["itens"] if i["chave"] == "estoque")
    # O produto abaixo do mínimo aparece com nome e números: nada de "não há ruptura".
    assert "Arroz Tipo 1 5kg (1 de mín. 12)" in estoque_txt
    assert b1["numeros"]["produtos_abaixo_minimo"] >= 1
    assert any(a["acao"] == "gerar_pedido_compra" for a in b1["acoes_sugeridas"])
    # Nenhum colchete, chave ou tag de fonte vaza para o texto do lojista.
    for item in b1["itens"]:
        assert "[" not in item["texto"] and "{" not in item["texto"]


def test_resumo_diario_sem_vendas_prioriza_registrar_no_pdv(client, session):
    from datetime import datetime, timedelta
    from app.models import Venda
    from app.services.consultor.resumo_diario import montar_resumo_diario

    estab = session.query(Estabelecimento).first()
    session.query(Venda).filter(Venda.estabelecimento_id == estab.id).delete()
    session.commit()

    r = montar_resumo_diario(estab.id)
    assert r["numeros"]["vendas_mes"]["qtd"] == 0
    assert r["prioridade"]["rota"] == "/pdv"
    assert "Nenhuma venda registrada" in r["prioridade"]["texto"]
    assert "sincroniz" not in r["resumo"].lower()


def test_normalizar_insights_aproveita_json_cortado_e_tira_tags():
    from app.services.consultor.insights_parser import normalizar_insights

    cortado = (
        '[{"tipo":"excecao","texto":"Caixa do mês zerado [geral].","acao":{"tipo":"ver_contagem","payload":{}}},'
        '{"tipo":"risco","texto":"15 alertas de estoque [geral]."},'
        '{"tipo":"oportunidade","texto":"Dois produtos têm margem baixa: PARAFUSADEIRA com 25,56% (custo 133,'
    )
    itens = normalizar_insights(cortado)
    assert [i["tipo"] for i in itens] == ["excecao", "risco"]
    assert itens[0]["texto"] == "Caixa do mês zerado."
    assert itens[0]["acao"]["tipo"] == "ver_contagem"

    assert normalizar_insights("```json\n[{\"tipo\":\"risco\",\"texto\":\"ok\"}]\n```") == [{"tipo": "risco", "texto": "ok"}]
    assert normalizar_insights('[{"tipo":"risco","texto":"cort') is None
    assert normalizar_insights("texto solto sem json") is None

    from app.services.consultor.insights_parser import para_exibir

    assert para_exibir("1. Vendas boas [vendas]\n2. Sem riscos") == "1. Vendas boas\n2. Sem riscos"
    assert para_exibir('[{"tipo":"risco","texto":"cort') is None
