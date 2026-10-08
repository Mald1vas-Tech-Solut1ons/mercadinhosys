"""Migração f7a9c1e3b5d8: expansiva, idempotente e reversível (testada em SQLite com o formato antigo das tabelas)."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

CAMINHO = Path(__file__).resolve().parent.parent / "migrations" / "versions" / "f7a9c1e3b5d8_cliente_pessoa_juridica.py"


@pytest.fixture
def migracao():
    spec = importlib.util.spec_from_file_location("migracao_cliente_pj", CAMINHO)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


@pytest.fixture
def banco_antigo():
    """Tabelas como estavam antes: CPF obrigatório, sem colunas de PJ."""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conexao:
        conexao.execute(sa.text(
            "CREATE TABLE clientes (id INTEGER PRIMARY KEY, estabelecimento_id INTEGER NOT NULL, "
            "nome VARCHAR(150) NOT NULL, cpf VARCHAR(14) NOT NULL, "
            "CONSTRAINT uq_cliente_estab_cpf UNIQUE (estabelecimento_id, cpf))"))
        conexao.execute(sa.text("CREATE TABLE funcionarios (id INTEGER PRIMARY KEY, nome VARCHAR(100))"))
        conexao.execute(sa.text("CREATE TABLE configuracoes (id INTEGER PRIMARY KEY, estabelecimento_id INTEGER)"))
        conexao.execute(sa.text("INSERT INTO clientes (estabelecimento_id, nome, cpf) VALUES (1, 'Maria', '529.982.247-25')"))
        conexao.execute(sa.text("INSERT INTO funcionarios (nome) VALUES ('Joao')"))
    yield engine
    engine.dispose()


def _rodar(engine, funcao):
    with engine.begin() as conexao:
        contexto = MigrationContext.configure(conexao)
        with Operations.context(contexto):
            funcao()


def _colunas(engine, tabela):
    return {c["name"]: c for c in sa.inspect(engine).get_columns(tabela)}


def test_upgrade_adiciona_colunas_preserva_dados_e_libera_cpf_nulo(migracao, banco_antigo):
    _rodar(banco_antigo, migracao.upgrade)
    clientes = _colunas(banco_antigo, "clientes")
    for nova in ("tipo_pessoa", "cnpj", "razao_social", "inscricao_estadual", "contato_nome"):
        assert nova in clientes
    assert clientes["cpf"]["nullable"] is True
    assert "numero_dependentes" in _colunas(banco_antigo, "funcionarios")
    assert "aliquota_impostos_venda" in _colunas(banco_antigo, "configuracoes")

    with banco_antigo.connect() as conexao:
        linha = conexao.execute(sa.text("SELECT cpf, tipo_pessoa FROM clientes")).one()
        assert tuple(linha) == ("529.982.247-25", "PF")  # cliente existente vira PF
        assert conexao.execute(sa.text("SELECT numero_dependentes FROM funcionarios")).scalar() == 0
        # Dois PJ sem CPF convivem; o mesmo CNPJ na mesma loja não.
        conexao.execute(sa.text("INSERT INTO clientes (estabelecimento_id, nome, cpf, cnpj) VALUES (1, 'A', NULL, '11')"))
        conexao.execute(sa.text("INSERT INTO clientes (estabelecimento_id, nome, cpf, cnpj) VALUES (1, 'B', NULL, '22')"))
        with pytest.raises(sa.exc.IntegrityError):
            conexao.execute(sa.text("INSERT INTO clientes (estabelecimento_id, nome, cpf, cnpj) VALUES (1, 'C', NULL, '11')"))


def test_upgrade_duas_vezes_nao_quebra(migracao, banco_antigo):
    _rodar(banco_antigo, migracao.upgrade)
    _rodar(banco_antigo, migracao.upgrade)
    assert "cnpj" in _colunas(banco_antigo, "clientes")


def test_downgrade_volta_ao_formato_antigo_sem_perder_cadastro_pj(migracao, banco_antigo):
    _rodar(banco_antigo, migracao.upgrade)
    with banco_antigo.begin() as conexao:
        conexao.execute(sa.text(
            "INSERT INTO clientes (estabelecimento_id, nome, cpf, cnpj, tipo_pessoa) "
            "VALUES (1, 'Alfa', NULL, '11.222.333/0001-81', 'PJ')"))
    _rodar(banco_antigo, migracao.downgrade)

    clientes = _colunas(banco_antigo, "clientes")
    assert "cnpj" not in clientes and "tipo_pessoa" not in clientes
    assert clientes["cpf"]["nullable"] is False
    assert "numero_dependentes" not in _colunas(banco_antigo, "funcionarios")
    assert "aliquota_impostos_venda" not in _colunas(banco_antigo, "configuracoes")
    with banco_antigo.connect() as conexao:
        documentos = {linha[0] for linha in conexao.execute(sa.text("SELECT cpf FROM clientes"))}
    assert "529.982.247-25" in documentos
    assert "11222333000181" in documentos  # PJ guarda os dígitos do CNPJ no campo único que sobrou


def test_downgrade_depois_upgrade_de_novo(migracao, banco_antigo):
    _rodar(banco_antigo, migracao.upgrade)
    _rodar(banco_antigo, migracao.downgrade)
    _rodar(banco_antigo, migracao.upgrade)
    assert "razao_social" in _colunas(banco_antigo, "clientes")


def test_revisao_encadeia_na_cabeca_atual():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    config = Config()
    config.set_main_option("script_location", str(CAMINHO.parent.parent))
    cabecas = ScriptDirectory.from_config(config).get_heads()
    assert cabecas == ["f7a9c1e3b5d8"], f"mais de uma cabeça de migração: {cabecas}"
