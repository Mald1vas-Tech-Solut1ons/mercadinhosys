"""Testes TDD para:
1. Destravamento de cadastro de produtos (ex.: 'Projetor' -> família eletronicos, subcategoria projetor, NCM).
2. Endpoint POST /api/produtos/classificar-ia (auto-preenchimento inteligente por nome).
3. Base de conhecimento do sistema ([sistema]) no Consultor da Loja para responder dúvidas operacionais.
4. Ação 'cadastrar_produto' na whitelist do Consultor com confirmação e auditoria.
5. Emissão de relatório estruturado no Consultor (dados tabulares prontos para PDF/Excel/WhatsApp).
"""
from decimal import Decimal
import pytest
from flask_jwt_extended import create_access_token

from app.models import Funcionario, Produto, ConsultorInteracao


def _headers(funcionario: Funcionario, role: str = "ADMIN") -> dict:
    token = create_access_token(
        identity=str(funcionario.id),
        additional_claims={
            "estabelecimento_id": funcionario.estabelecimento_id,
            "role": role,
            "is_super_admin": bool(funcionario.is_super_admin),
        },
    )
    return {"Authorization": f"Bearer {token}"}


def test_taxonomia_resolve_projetor_no_singular_e_no_plural_e_mix_mercearia_inclui_eletronicos():
    from app.services.taxonomia_service import resolver
    from app.services.view_schema_service import MIX_PADRAO_POR_SEGMENTO

    # Loja de mercearia/mercado precisa ter acesso à família 'eletronicos' para cadastrar itens como Projetor/Cabo/Pilha
    assert "eletronicos" in MIX_PADRAO_POR_SEGMENTO["mercearia"]

    # Tanto "Projetores" quanto "Projetor" devem resolver para a subcategoria oficial de Projetores
    res_plural = resolver("eletronicos", "Projetores")
    res_singular = resolver("eletronicos", "Projetor")
    assert res_plural is not None
    assert res_singular is not None
    assert res_plural == res_singular


def test_endpoint_classificar_ia_preenche_familia_subcategoria_e_ncm_para_projetor(client, session):
    admin = session.query(Funcionario).first()
    headers = _headers(admin, "ADMIN")

    resp = client.post(
        "/api/produtos/classificar-ia",
        headers=headers,
        json={"nome": "PROJETOR MULTIMIDIA EPSON BIVOLT"},
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    data = resp.get_json()
    assert data["success"] is True
    sugestao = data["sugestao"]
    assert sugestao["familia_produto"] == "eletronicos"
    assert "projetor" in sugestao["subcategoria"]
    assert sugestao["categoria_oficial"].startswith("eletronicos.")
    assert len(sugestao["ncm"]) == 8
    assert sugestao["cfop_padrao"] in ("5102", "5405")
    assert sugestao["csosn"] in ("102", "500")
    assert sugestao["descricao"]


def test_consultor_conhece_o_sistema_e_sugere_acao_cadastrar_produto(client, session, monkeypatch):
    import app.routes.consultor as routes

    admin = session.query(Funcionario).first()
    headers = _headers(admin, "ADMIN")

    monkeypatch.setattr(routes, "llm_disponivel", lambda: True)
    monkeypatch.setattr(
        routes,
        "gerar_resposta_com_meta",
        lambda msgs, **kw: {
            "texto": (
                "Para cadastrar o **Projetor**, selecione a família **Eletrônicos**, "
                "subcategoria **Projetores** [sistema]. Se preferir, clique no botão abaixo para "
                "confirmar o cadastro direto com os dados padrão!"
            ),
            "provider": "deepseek",
            "prompt_tokens": 250,
            "completion_tokens": 60,
            "custo_estimado_usd": 0.00005,
        },
    )

    resp = client.post(
        "/api/consultor/chat",
        headers=headers,
        json={
            "especialista": "geral",
            "mensagem": "Não consigo cadastrar um Projetor Epson bivolt custo 850 venda 1290 estoque 2, me ajuda?",
        },
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["success"] is True
    assert "sistema" in body["fontes"]

    # Deve sugerir a ação 'cadastrar_produto' já parametrizada para o Projetor!
    acoes = body.get("acoes_sugeridas") or []
    acao_prod = next((a for a in acoes if a["acao"] == "cadastrar_produto"), None)
    assert acao_prod is not None
    assert "PROJETOR" in acao_prod["parametros"]["nome"].upper()
    assert acao_prod["parametros"]["familia_produto"] == "eletronicos"
    assert acao_prod["parametros"]["preco_custo"] == 850.0
    assert acao_prod["parametros"]["preco_venda"] == 1290.0
    assert acao_prod["parametros"]["quantidade"] == 2

    # Ao confirmar a ação, o produto é efetivamente cadastrado no banco com subcategoria oficial e auditado!
    exec_resp = client.post(
        "/api/consultor/acoes/executar",
        headers=headers,
        json={
            "acao": "cadastrar_produto",
            "parametros": acao_prod["parametros"],
        },
    )
    assert exec_resp.status_code in (200, 201), exec_resp.get_data(as_text=True)
    exec_data = exec_resp.get_json()
    assert exec_data["success"] is True
    prod_id = exec_data["entidade"]["id"]

    prod_db = session.get(Produto, prod_id)
    assert prod_db is not None
    assert "PROJETOR" in prod_db.nome.upper()
    assert prod_db.familia_produto == "eletronicos"
    assert prod_db.subcategoria_oficial is not None
    assert float(prod_db.preco_venda) == 1290.0


def test_consultor_emite_relatorio_estruturado_sob_demanda(client, session, monkeypatch):
    import app.routes.consultor as routes

    admin = session.query(Funcionario).first()
    headers = _headers(admin, "ADMIN")

    monkeypatch.setattr(routes, "llm_disponivel", lambda: True)
    monkeypatch.setattr(
        routes,
        "gerar_resposta_com_meta",
        lambda msgs, **kw: {
            "texto": "## Relatório Gerencial da Loja\n- Destaque de vendas e financeiro [vendas] [financeiro].",
            "provider": "deepseek",
            "prompt_tokens": 300,
            "completion_tokens": 120,
            "custo_estimado_usd": 0.00007,
        },
    )

    resp = client.post(
        "/api/consultor/chat",
        headers=headers,
        json={
            "especialista": "geral",
            "mensagem": "Emitir relatório completo de vendas, estoque e financeiro deste mês",
        },
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    data = resp.get_json()
    assert data["success"] is True
    assert "relatorio_estruturado" in data
    rel = data["relatorio_estruturado"]
    assert rel is not None
    assert "titulo" in rel
    assert "gerado_em" in rel
    assert isinstance(rel["resumo_kpis"], list)
    assert isinstance(rel["tabelas"], list)
    assert len(rel["tabelas"]) >= 1
