"""Migrações b8d4f0a2c3e5 e c3e9a5f1b7d2: aditivas, idempotentes e reversíveis (SQLite, tabelas antigas)."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

CAMINHO = (Path(__file__).resolve().parent.parent / "migrations" / "versions"
           / "b8d4f0a2c3e5_producao_unidade_versao_apontamento.py")


@pytest.fixture
def migracao():
    spec = importlib.util.spec_from_file_location("migracao_producao_prof", CAMINHO)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


VALIDADE = CAMINHO.parent / "c3e9a5f1b7d2_producao_validade_e_estorno.py"


@pytest.fixture
def migracao_validade():
    spec = importlib.util.spec_from_file_location("migracao_producao_validade", VALIDADE)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


@pytest.fixture
def banco_antigo():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as c:
        for ddl in (
            "CREATE TABLE estabelecimentos (id INTEGER PRIMARY KEY)",
            "CREATE TABLE funcionarios (id INTEGER PRIMARY KEY)",
            "CREATE TABLE produtos (id INTEGER PRIMARY KEY)",
            "CREATE TABLE produto_lotes (id INTEGER PRIMARY KEY)",
            "CREATE TABLE movimentacoes_estoque (id INTEGER PRIMARY KEY)",
            "CREATE TABLE fichas_tecnicas (id INTEGER PRIMARY KEY, estabelecimento_id INTEGER NOT NULL, "
            "produto_id INTEGER NOT NULL, rendimento NUMERIC(14,3) NOT NULL)",
            "CREATE TABLE ficha_tecnica_itens (id INTEGER PRIMARY KEY, ficha_id INTEGER NOT NULL, "
            "insumo_id INTEGER NOT NULL, quantidade NUMERIC(14,4) NOT NULL)",
            "CREATE TABLE ordens_producao (id INTEGER PRIMARY KEY, estabelecimento_id INTEGER NOT NULL, "
            "numero VARCHAR(30) NOT NULL)",
            "INSERT INTO fichas_tecnicas (estabelecimento_id, produto_id, rendimento) VALUES (1, 1, 190)",
            "INSERT INTO ficha_tecnica_itens (ficha_id, insumo_id, quantidade) VALUES (1, 2, 50)",
        ):
            c.execute(sa.text(ddl))
    yield engine
    engine.dispose()


def _rodar(engine, funcao):
    with engine.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _colunas(engine, tabela):
    return {c["name"] for c in sa.inspect(engine).get_columns(tabela)}


def test_upgrade_cria_e_preserva_fichas_existentes(migracao, banco_antigo):
    _rodar(banco_antigo, migracao.upgrade)
    assert {"versao"} <= _colunas(banco_antigo, "fichas_tecnicas")
    assert {"quantidade_receita", "unidade_receita"} <= _colunas(banco_antigo, "ficha_tecnica_itens")
    assert "ficha_versao" in _colunas(banco_antigo, "ordens_producao")
    tabelas = set(sa.inspect(banco_antigo).get_table_names())
    assert {"ficha_tecnica_versoes", "apontamentos_producao"} <= tabelas
    with banco_antigo.connect() as c:
        assert c.execute(sa.text("SELECT versao, rendimento FROM fichas_tecnicas")).one() == (1, 190)
        assert c.execute(sa.text("SELECT quantidade FROM ficha_tecnica_itens")).scalar() == 50


def test_upgrade_duas_vezes_e_downgrade_e_upgrade(migracao, banco_antigo):
    _rodar(banco_antigo, migracao.upgrade)
    _rodar(banco_antigo, migracao.upgrade)
    _rodar(banco_antigo, migracao.downgrade)
    assert "versao" not in _colunas(banco_antigo, "fichas_tecnicas")
    assert "apontamentos_producao" not in set(sa.inspect(banco_antigo).get_table_names())
    with banco_antigo.connect() as c:
        assert c.execute(sa.text("SELECT COUNT(*) FROM ficha_tecnica_itens")).scalar() == 1
    _rodar(banco_antigo, migracao.upgrade)
    assert "versao" in _colunas(banco_antigo, "fichas_tecnicas")


def test_revisao_e_a_cabeca_unica():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    config = Config()
    config.set_main_option("script_location", str(CAMINHO.parent.parent))
    script = ScriptDirectory.from_config(config)
    # Cabeça única (sem ramo paralelo) e a cadeia da produção continua dentro dela, mesmo com migrations novas por cima.
    [cabeca] = script.get_heads()
    assert "c3e9a5f1b7d2" in {r.revision for r in script.iterate_revisions(cabeca, "base")}
    assert script.get_revision("c3e9a5f1b7d2").down_revision == "b8d4f0a2c3e5"
    assert script.get_revision("b8d4f0a2c3e5").down_revision == "a7c3e9f1b2d4"


def test_validade_e_estorno_encadeia_e_reverte(migracao, migracao_validade, banco_antigo):
    _rodar(banco_antigo, migracao.upgrade)
    _rodar(banco_antigo, migracao_validade.upgrade)
    _rodar(banco_antigo, migracao_validade.upgrade)
    assert "validade_dias" in _colunas(banco_antigo, "fichas_tecnicas")
    assert {"data_estorno", "motivo_estorno", "estornada_por_id"} <= _colunas(banco_antigo, "ordens_producao")
    _rodar(banco_antigo, migracao_validade.downgrade)
    assert "validade_dias" not in _colunas(banco_antigo, "fichas_tecnicas")
    assert "versao" in _colunas(banco_antigo, "fichas_tecnicas")   # a anterior fica intacta
    _rodar(banco_antigo, migracao_validade.upgrade)
    assert "motivo_estorno" in _colunas(banco_antigo, "ordens_producao")
