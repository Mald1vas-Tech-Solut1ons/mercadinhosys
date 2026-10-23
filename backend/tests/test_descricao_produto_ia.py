"""Descrição do produto sugerida pela IA (Groq) a partir do formulário de cadastro."""
from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Funcionario
from app.routes import produtos as rotas_produtos


def _h(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


def test_gera_descricao_com_dados_do_formulario(client, session, monkeypatch):
    headers = _h(session)
    enviado = {}

    def fake_gerar(system_prompt, user_prompt, max_tokens=300):
        enviado["prompt"] = user_prompt
        return '"Pote de vidro para guardar e repor temperos, vendido por unidade."'

    monkeypatch.setattr(rotas_produtos, "ia_disponivel", lambda: True)
    monkeypatch.setattr(rotas_produtos, "gerar_texto", fake_gerar)

    r = client.post("/api/produtos/descricao-ia", headers=headers, json={
        "nome": "Pote Reposição para Temperos", "categoria": "Utilidades",
        "unidade_medida": "un", "descricao_atual": "venda unitária",
    })
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["descricao"] == "Pote de vidro para guardar e repor temperos, vendido por unidade."
    assert "Pote Reposição para Temperos" in enviado["prompt"]
    assert "venda unitária" in enviado["prompt"]


def test_exige_nome_do_produto(client, session, monkeypatch):
    monkeypatch.setattr(rotas_produtos, "ia_disponivel", lambda: True)
    r = client.post("/api/produtos/descricao-ia", headers=_h(session), json={"nome": " "})
    assert r.status_code == 400


def test_sem_chave_groq_responde_503(client, session, monkeypatch):
    monkeypatch.setattr(rotas_produtos, "ia_disponivel", lambda: False)
    r = client.post("/api/produtos/descricao-ia", headers=_h(session), json={"nome": "Arroz"})
    assert r.status_code == 503


def test_falha_da_ia_nao_quebra(client, session, monkeypatch):
    monkeypatch.setattr(rotas_produtos, "ia_disponivel", lambda: True)
    monkeypatch.setattr(rotas_produtos, "gerar_texto", lambda *a, **k: None)
    r = client.post("/api/produtos/descricao-ia", headers=_h(session), json={"nome": "Arroz Tipo 1"})
    assert r.status_code == 502
    assert r.get_json()["success"] is False


def test_exige_login(client):
    r = client.post("/api/produtos/descricao-ia", json={"nome": "Arroz"})
    assert r.status_code in (401, 422)
