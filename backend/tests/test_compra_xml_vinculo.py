"""NF-e documental vinculada à compra não duplica a entrada física ou a dívida."""
from decimal import Decimal
import io

import pytest

from app.models import ContaPagar, NotaFiscalEntrada, PedidoCompra, Produto, Estabelecimento
from app.services.fiscal import entrada_service
from test_erp_integridade_canais import ctx, _compra, _receber, _get


def _nota(session, ctx, quantidade=10, total=40, chave=None):
    ctx['prod'].codigo_interno = 'XML-ARROZ'
    ctx['prod'].unidade_medida = 'UN'
    session.commit()
    return dict(chave_acesso=chave or '1' * 44, modelo='55', numero='123', serie='1',
                data_emissao='2026-10-08', natureza_operacao='Venda',
                emitente=dict(cnpj=ctx['forn'].cnpj, nome=ctx['forn'].razao_social),
                destinatario=dict(cnpj=ctx['estab'].cnpj), total=Decimal(str(total)), duplicatas=[],
                itens=[dict(codigo='XML-ARROZ', ean=None, descricao='Arroz', ncm=None,
                            unidade='UN', quantidade=Decimal(str(quantidade)),
                            valor_unitario=Decimal('4'), valor_total=Decimal(str(total)))])


def test_xml_de_pedido_recebido_nao_pode_entrar_como_compra_avulsa(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    assert _receber(client, ctx, pedido_id, item_id, quantidade_recebida=10).status_code == 200
    pedido = _get(session, PedidoCompra, pedido_id)
    pedido.numero_nota_fiscal, pedido.serie_nota_fiscal = '123', '1'
    session.commit()
    parsed = _nota(session, ctx)
    with pytest.raises(entrada_service.ImportacaoError, match='pedido'):
        entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id)
    assert _get(session, Produto, ctx['prod'].id).quantidade == Decimal('20')
    assert session.query(ContaPagar).count() == 1


@pytest.mark.parametrize('recebida', [0, 3, 10])
def test_vinculo_preserva_estoque_custo_titulo_e_recebimento(client, session, ctx, recebida):
    pedido_id, item_id = _compra(client, session, ctx)
    if recebida:
        assert _receber(client, ctx, pedido_id, item_id, quantidade_recebida=recebida).status_code == 200
    parsed = _nota(session, ctx)
    produto = _get(session, Produto, ctx['prod'].id)
    custo, qtd = produto.preco_custo, produto.quantidade
    conta = session.query(ContaPagar).one()
    conta.valor_pago, conta.valor_atual, conta.status = Decimal('10'), Decimal('30'), 'parcial'
    session.commit()
    resultado = entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)
    assert resultado['contas_pagar_geradas'] == 0
    assert resultado['estoque_movimentado'] is False
    assert session.query(NotaFiscalEntrada).one().pedido_compra_id == pedido_id
    assert _get(session, Produto, produto.id).quantidade == qtd
    assert _get(session, Produto, produto.id).preco_custo == custo
    assert session.query(ContaPagar).count() == 1
    assert _get(session, ContaPagar, conta.id).valor_pago == Decimal('10')
    assert _get(session, ContaPagar, conta.id).valor_atual == Decimal('30')
    if recebida < 10:
        assert _receber(client, ctx, pedido_id, item_id, quantidade_recebida=10-recebida).status_code == 200
    assert _get(session, Produto, produto.id).quantidade == Decimal('20')
    assert _get(session, PedidoCompra, pedido_id).status == 'recebido'


@pytest.mark.parametrize('campo,valor,mensagem', [
    ('total', Decimal('41'), 'Valor'), ('quantidade', Decimal('9'), 'quantidades'),
    ('unidade', 'CX', 'Unidade'), ('codigo', 'NAO-EXISTE', 'Produto'),
    ('emitente', {'cnpj': '99999999000199'}, 'Fornecedor'),
    ('destinatario', {'cnpj': '99999999000199'}, 'destinatário'),
])
def test_divergencia_recusada_sem_efeito(client, session, ctx, campo, valor, mensagem):
    pedido_id, _ = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    if campo in ('quantidade', 'unidade', 'codigo'):
        parsed['itens'][0][campo] = valor
    else:
        parsed[campo] = valor
    with pytest.raises(entrada_service.ImportacaoError, match=mensagem):
        entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)
    session.rollback()
    assert session.query(NotaFiscalEntrada).count() == 0
    assert _get(session, Produto, ctx['prod'].id).quantidade == Decimal('10')
    assert session.query(ContaPagar).count() == 1


def test_mesma_chave_e_segunda_nota_do_pedido_recusadas(client, session, ctx):
    pedido_id, _ = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)
    with pytest.raises(entrada_service.ImportacaoError, match='duplicada'):
        entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)
    parsed['chave_acesso'] = '2' * 44
    with pytest.raises(entrada_service.ImportacaoError, match='já possui'):
        entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)
    assert session.query(NotaFiscalEntrada).count() == 1


def test_pedido_de_outra_loja_nao_e_vinculado(client, session, ctx):
    pedido_id, _ = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    # A busca sempre inclui tenant, mesmo quando o ID existe.
    outra = Estabelecimento(nome_fantasia='Outra', razao_social='Outra LTDA', cnpj='99888777000166',
        email='outra@example.test', telefone='11999999999', cep='01000000', logradouro='Rua B',
        numero='2', bairro='Centro', cidade='São Paulo', estado='SP')
    session.add(outra)
    session.flush()
    pedido = session.get(PedidoCompra, pedido_id)
    pedido.estabelecimento_id = outra.id
    session.commit()
    with pytest.raises(entrada_service.ImportacaoError, match='não encontrado'):
        entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)


def test_preview_nao_grava_e_mostra_pedido(client, session, ctx):
    pedido_id, _ = _compra(client, session, ctx)
    result = entrada_service.preview(_nota(session, ctx), ctx['estab'].id)
    assert result['pedidos_fornecedor'][0]['id'] == pedido_id
    assert session.query(NotaFiscalEntrada).count() == 0


def test_api_multipart_vincula_e_rejeita_pedido_invalido(client, session, ctx, monkeypatch):
    pedido_id, _ = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    monkeypatch.setattr('app.routes.fiscal.parse_nfe_xml', lambda raw: parsed)
    bad = client.post('/api/fiscal/entrada/importar', headers=ctx['headers'],
        data={'xml': (io.BytesIO(b'<xml/>'), 'nfe.xml'), 'pedido_id': 'abc'})
    assert bad.status_code == 400
    result = client.post('/api/fiscal/entrada/importar', headers=ctx['headers'],
        data={'xml': (io.BytesIO(b'<xml/>'), 'nfe.xml'), 'pedido_id': str(pedido_id)})
    assert result.status_code == 201, result.get_json()
    assert result.get_json()['resultado']['modo'] == 'vinculada'


def test_vendedor_nao_importa_xml(client, session, ctx):
    ctx['admin'].role = 'VENDEDOR'
    session.commit()
    result = client.post('/api/fiscal/entrada/importar', headers=ctx['headers'], data=b'<xml/>')
    assert result.status_code == 403


def test_recebimento_nao_troca_numero_do_xml(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    entrada_service.importar(_nota(session, ctx), '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)
    result = client.post('/api/pedidos-compra/receber', headers=ctx['headers'],
        json={'pedido_id': pedido_id, 'numero_nota_fiscal': '999', 'itens': [{'item_id': item_id, 'quantidade_recebida': 1}]})
    assert result.status_code == 400
    assert _get(session, Produto, ctx['prod'].id).quantidade == Decimal('10')


def test_avulsa_exige_confirmacao_quando_ha_pedido(client, session, ctx):
    _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    with pytest.raises(entrada_service.ImportacaoError, match='compra avulsa'):
        entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id)
    result = entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, compra_avulsa=True)
    assert result['contas_pagar_geradas'] == 1


def test_xml_avulso_ja_importado_bloqueia_recebimento_da_mesma_nota(client, session, ctx):
    pedido_id, item_id = _compra(client, session, ctx)
    entrada_service.importar(_nota(session, ctx), '<xml/>', ctx['estab'].id, ctx['admin'].id, compra_avulsa=True)
    result = client.post('/api/pedidos-compra/receber', headers=ctx['headers'],
        json={'pedido_id': pedido_id, 'numero_nota_fiscal': '00123', 'serie_nota_fiscal': '01',
              'itens': [{'item_id': item_id, 'quantidade_recebida': 10}]})
    assert result.status_code == 400
    assert 'Reconcilie' in result.get_json()['error']
    assert _get(session, Produto, ctx['prod'].id).quantidade == Decimal('20')


@pytest.mark.parametrize('vinculada', [True, False])
def test_importacao_concorrente_postgres(app, client, session, ctx, monkeypatch, vinculada):
    from app import db
    from concurrent.futures import ThreadPoolExecutor
    if db.engine.dialect.name != 'postgresql':
        pytest.skip('Exige PostgreSQL isolado')
    pedido_id, _ = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    monkeypatch.setattr('app.routes.fiscal.parse_nfe_xml', lambda raw: parsed)
    headers, produto_id = dict(ctx['headers']), ctx['prod'].id
    session.commit()
    def chamar(_):
        with app.test_client() as c:
            fields = {'xml': (io.BytesIO(b'<xml/>'), 'nfe.xml')}
            fields.update({'pedido_id': str(pedido_id)} if vinculada else {'compra_avulsa': 'true'})
            return c.post('/api/fiscal/entrada/importar', headers=headers, data=fields).status_code
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sorted(executor.map(chamar, range(4))) == [201, 400, 400, 400]
    session.expire_all()
    assert session.query(NotaFiscalEntrada).count() == 1
    assert session.query(ContaPagar).count() == (1 if vinculada else 2)
    assert session.get(Produto, produto_id).quantidade == Decimal('10' if vinculada else '20')


def test_migracao_preserva_nota_legada_e_protege_vinculo(app, client, session, ctx):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from app import db
    path = Path(__file__).resolve().parents[1] / 'migrations/versions/f9b2c4d6e8a0_nfe_vinculo_pedido.py'
    spec = importlib.util.spec_from_file_location('compra_xml_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    pedido_id, _ = _compra(client, session, ctx)
    note = NotaFiscalEntrada(estabelecimento_id=ctx['estab'].id, chave_acesso='9' * 44,
                            valor_total=Decimal('40'), numero='LEGADO')
    session.add(note)
    session.commit()
    note_id = note.id
    session.remove()
    with db.engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
            migration.upgrade()
            migration.upgrade()
    restored = session.get(NotaFiscalEntrada, note_id)
    assert restored.numero == 'LEGADO'
    assert restored.valor_total == Decimal('40')
    assert restored.pedido_compra_id is None
    restored.pedido_compra_id = pedido_id
    session.commit()
    with db.engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            with pytest.raises(RuntimeError, match='reconcilie'):
                migration.downgrade()


def test_xml_real_vinculado_na_api(client, session, ctx):
    pedido_id, _ = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    xml = f'''<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe{parsed['chave_acesso']}">
    <ide><mod>55</mod><nNF>123</nNF><serie>1</serie><dhEmi>2026-10-08T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>{ctx['forn'].cnpj}</CNPJ><xNome>Distribuidora</xNome></emit>
    <dest><CNPJ>{ctx['estab'].cnpj}</CNPJ></dest>
    <det nItem="1"><prod><cProd>XML-ARROZ</cProd><cEAN>SEM GTIN</cEAN><xProd>Arroz</xProd>
    <uCom>UN</uCom><qCom>10</qCom><vUnCom>4</vUnCom><vProd>40</vProd></prod></det>
    <total><ICMSTot><vNF>40</vNF></ICMSTot></total></infNFe></NFe>'''
    result = client.post('/api/fiscal/entrada/importar', headers=ctx['headers'],
        data={'xml': (io.BytesIO(xml.encode()), 'nfe.xml'), 'pedido_id': str(pedido_id)})
    assert result.status_code == 201, result.get_json()
    assert result.get_json()['resultado']['estoque_movimentado'] is False
    assert session.query(NotaFiscalEntrada).one().xml_content == xml


def test_precos_por_produto_conferidos_mesmo_com_total_igual(client, session, ctx):
    pedido_id, _ = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    parsed['itens'][0]['valor_total'] = Decimal('39')
    with pytest.raises(entrada_service.ImportacaoError, match='Valor líquido'):
        entrada_service.importar(parsed, '<xml/>', ctx['estab'].id, ctx['admin'].id, pedido_id=pedido_id)


def test_xml_e_recebimento_concorrentes_postgres(app, client, session, ctx, monkeypatch):
    from app import db
    from concurrent.futures import ThreadPoolExecutor
    from datetime import date, timedelta
    if db.engine.dialect.name != 'postgresql':
        pytest.skip('Exige PostgreSQL isolado')
    pedido_id, item_id = _compra(client, session, ctx)
    parsed = _nota(session, ctx)
    monkeypatch.setattr('app.routes.fiscal.parse_nfe_xml', lambda raw: parsed)
    headers, produto_id = dict(ctx['headers']), ctx['prod'].id
    session.commit()
    def chamar(acao):
        with app.test_client() as c:
            if acao == 'xml':
                return c.post('/api/fiscal/entrada/importar', headers=headers,
                    data={'xml': (io.BytesIO(b'<xml/>'), 'nfe.xml'), 'pedido_id': str(pedido_id)}).status_code
            return c.post('/api/pedidos-compra/receber', headers=headers, json={'pedido_id': pedido_id,
                'numero_nota_fiscal': '123', 'serie_nota_fiscal': '1', 'itens': [{'item_id': item_id,
                'quantidade_recebida': 10, 'data_validade': (date.today() + timedelta(days=90)).isoformat()}]}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(chamar, ['xml', 'receber'])) == [201, 200]
    session.expire_all()
    assert session.query(NotaFiscalEntrada).count() == 1
    assert session.query(ContaPagar).count() == 1
    assert session.get(Produto, produto_id).quantidade == Decimal('20')
