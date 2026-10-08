import pytest
from flask_jwt_extended import create_access_token
from app.models import Funcionario, ConsultorInteracao


@pytest.fixture
def auth_headers(session):
    admin = session.query(Funcionario).first()
    token = create_access_token(identity=str(admin.id), additional_claims={
        'estabelecimento_id': admin.estabelecimento_id, 'role': 'ADMIN'})
    return {'Authorization': f'Bearer {token}'}


def test_chat_consultor_sem_token(client):
    assert client.post('/api/consultor/chat', json={'mensagem': 'Oi'}).status_code == 401


def test_chat_consultor_sucesso(client, session, auth_headers, monkeypatch):
    import app.routes.consultor as routes
    monkeypatch.setattr(routes, 'llm_disponivel', lambda: True)
    monkeypatch.setattr(routes, 'verificar_quota_consultor', lambda tenant: True)
    monkeypatch.setattr(routes, '_recuperar', lambda *args: {'fontes': [{
        'fonte': 'vendas', 'periodo': 'teste', 'dados': {'total': 10}}]})
    monkeypatch.setattr(routes, 'gerar_resposta', lambda *args, **kwargs: 'Resposta mockada')
    response = client.post('/api/consultor/chat', headers=auth_headers,
                           json={'especialista': 'financeiro', 'mensagem': 'Como estão as vendas?'})
    assert response.status_code == 200, response.get_data(as_text=True)
    data = response.get_json()
    assert data['success'] is True
    assert data['resposta'] == 'Resposta mockada'
    assert ConsultorInteracao.query.get(data['interacao_id']) is not None


def test_insights_quota_excedida(client, session, auth_headers, monkeypatch):
    import app.routes.consultor as routes
    monkeypatch.setattr(routes, 'llm_disponivel', lambda: True)
    monkeypatch.setattr(routes, 'verificar_quota_insight', lambda tenant: False)
    response = client.post('/api/consultor/insights', headers=auth_headers,
                           json={'especialista': 'vendas'})
    assert response.status_code == 429, response.get_data(as_text=True)
    assert response.get_json()['success'] is False
