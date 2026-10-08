from unittest.mock import MagicMock, patch
import pytest
from app.utils.llm_client import gerar_resposta, llm_disponivel

def test_chaves_antigas_nao_ativam_outros_provedores(monkeypatch):
    monkeypatch.delenv('DEEPSEEK_API', raising=False)
    monkeypatch.setenv('GROQ_API_KEY', 'chave-antiga')
    monkeypatch.setenv('GEMINI_API_KEY', 'chave-antiga')
    with patch('app.utils.llm_client.requests.post') as post:
        assert not llm_disponivel()
        assert gerar_resposta([{'role':'user', 'content':'oi'}]) is None
        post.assert_not_called()

def test_cliente_legado_usa_somente_deepseek_com_limite(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API', 'chave-ficticia')
    monkeypatch.setenv('DEEPSEEK_MAX_TOKENS', '512')
    response = MagicMock(status_code=200)
    response.json.return_value = {'choices':[{'message':{'content':' Resposta '}}]}
    with patch('app.utils.llm_client.requests.post', return_value=response) as post:
        assert gerar_resposta([{'role':'user','content':'oi'}], provider='gemini') == 'Resposta'
        assert post.call_count == 1
        args = post.call_args
        assert args.args[0] == 'https://api.deepseek.com/chat/completions'
        assert args.kwargs['json']['max_tokens'] == 512
        assert args.kwargs['json']['thinking'] == {'type':'disabled'}

@pytest.mark.parametrize('status', [401, 402, 429, 500])
def test_falha_nao_encaminha_para_outra_api_ou_repete_custo(monkeypatch, status):
    monkeypatch.setenv('DEEPSEEK_API', 'chave-ficticia')
    with patch('app.utils.llm_client.requests.post', return_value=MagicMock(status_code=status)) as post:
        assert gerar_resposta([{'role':'user','content':'oi'}]) is None
        assert post.call_count == 1

def test_tarefa_curta_e_enviada_somente_a_groq(monkeypatch):
    monkeypatch.setenv('GROQ_API_KEY', 'chave-groq-ficticia')
    monkeypatch.setenv('GROQ_MODEL', 'openai/gpt-oss-20b')
    response = MagicMock(status_code=200)
    response.json.return_value = {'choices':[{'message':{'content':'Texto curto'}}]}
    with patch('app.utils.llm_client.requests.post', return_value=response) as post:
        assert gerar_resposta([{'role':'user','content':'oi'}], provider='groq') == 'Texto curto'
        assert post.call_count == 1
        assert post.call_args.args[0].startswith('https://api.groq.com/')
        assert 'thinking' not in post.call_args.kwargs['json']
