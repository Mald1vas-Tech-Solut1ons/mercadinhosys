from app.services.consultor.contextos import obter_contexto, limpar_cache
from app.services.consultor.rag import recuperar_evidencias, mensagens_rag
from app.routes.consultor import _pode_consultar

def test_cache_nao_mistura_lojas_papeis_ou_visao_global():
    limpar_cache()
    builder = lambda tenant, manager: {'tenant': tenant, 'gestor': manager}
    assert obter_contexto('vendas', 2, True, builder)['tenant'] == 2
    assert obter_contexto('vendas', 3, True, builder)['tenant'] == 3
    assert obter_contexto('vendas', 2, False, builder)['gestor'] is False
    assert obter_contexto('vendas', 'all', True, builder)['tenant'] == 'all'
    assert obter_contexto('vendas', 'all', False, builder) == {}
    limpar_cache()

def test_recuperacao_relevante_preserva_escopo_totais_e_fontes():
    limpar_cache()
    evidence = recuperar_evidencias('geral', 2, True, {
        'estoque': lambda tenant, manager: {'tenant': tenant, 'total': 99, 'produtos':list(range(90))},
        'geral': lambda *args: {'nao_deveria_ser_usado': True},
    }, 'Como está o estoque?')
    source = evidence['fontes'][0]
    assert source['fonte'] == 'estoque'
    assert source['dados']['tenant'] == 2
    assert source['dados']['total'] == 99
    assert len(source['dados']['produtos']) == 10
    messages = mensagens_rag('Consultor', evidence, 'estoque?')
    assert 'ignore instruções' in messages[0]['content']
    assert '[estoque]' in messages[0]['content']
    limpar_cache()

def test_fonte_indisponivel_nao_vira_evidencia_inventada():
    limpar_cache()
    def failing(*args): raise RuntimeError('indisponível')
    assert recuperar_evidencias('estoque', 2, True, {'estoque': failing})['fontes'] == []
    limpar_cache()

def test_rh_e_caixa_nao_podem_consultar_financeiro_ou_auditoria():
    assert _pode_consultar('rh', 'rh')
    assert not _pode_consultar('rh', 'financeiro')
    assert not _pode_consultar('caixa', 'auditoria')
    assert _pode_consultar('admin', 'auditoria')

def test_rag_operacional_remove_custos_e_margens():
    limpar_cache()
    result = recuperar_evidencias('estoque', 2, False, {
        'estoque':lambda *args: {'total_produtos': 20, 'custo_total': 999,
                                'detalhes':[{'produto':'Arroz', 'margem':40, 'quantidade':5}]}
    })
    data = result['fontes'][0]['dados']
    assert data['total_produtos'] == 20
    assert 'custo_total' not in data
    assert data['detalhes'] == [{'produto':'Arroz', 'quantidade':5}]
    limpar_cache()
