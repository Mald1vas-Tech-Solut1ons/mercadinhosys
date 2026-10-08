"""Cliente PF/PJ, crédito explicável com bloqueio por atraso, baixa de fiado e importação CSV."""
import io
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (Caixa, CategoriaProduto, Cliente, ContaReceber, Estabelecimento, Funcionario, Produto,
                        ProdutoLote)
from app.services.credito_service import calcular_score, recalcular_credito, titulos_vencidos, validar_sem_atraso

CNPJ_OK = "11222333000181"
CNPJ_RUIM = "11222333000182"
CPF_OK = "52998224725"
CPF_OK_2 = "11144477735"
CPF_RUIM = "52998224724"


@pytest.fixture
def validadores_reais(monkeypatch):
    """O conftest liga FLASK_ENV=simulation, que aceita qualquer documento. Aqui valem os dígitos verificadores."""
    monkeypatch.setenv("FLASK_ENV", "testing")


@pytest.fixture
def loja(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Crédito")
    session.add(cat)
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item", preco_custo=Decimal("40"),
                   preco_venda=Decimal("100"), quantidade=Decimal("50"))
    session.add(prod)
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="CRD", quantidade=50,
                    quantidade_inicial=50, data_entrada=date.today(), data_validade=date.today() + timedelta(days=90),
                    preco_custo_unitario=40, ativo=True),
        Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="CRD", saldo_inicial=0,
              saldo_atual=0, status="aberto"),
    ])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, prod=prod, headers={"Authorization": f"Bearer {token}"})


def _cliente(session, loja, **extra):
    campos = dict(estabelecimento_id=loja["estab"].id, nome="Cliente", cpf=CPF_OK, celular="11999999999",
                  cep="01000000", logradouro="Rua", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                  limite_credito=Decimal("1000"), saldo_devedor=Decimal("0"))
    campos.update(extra)
    cliente = Cliente(**campos)
    session.add(cliente)
    session.commit()
    return cliente


def _titulo(session, loja, cliente, valor, vencimento, status="aberto", recebimento=None, numero=None):
    titulo = ContaReceber(estabelecimento_id=loja["estab"].id, cliente_id=cliente.id,
                          numero_documento=numero or f"T{ContaReceber.query.count() + 1}", valor_original=valor,
                          valor_atual=valor if status == "aberto" else 0,
                          data_emissao=vencimento - timedelta(days=30), data_vencimento=vencimento, status=status,
                          data_recebimento=recebimento)
    session.add(titulo)
    session.commit()
    return titulo


def _pj(**extra):
    corpo = {"tipo_pessoa": "PJ", "cnpj": CNPJ_OK, "razao_social": "Alfa Distribuidora LTDA",
             "nome": "Alfa", "celular": "11988887777", "inscricao_estadual": "123456789",
             "contato_nome": "Maria", "limite_credito": 5000}
    corpo.update(extra)
    return corpo


# ───────────────────────── cadastro PF / PJ ─────────────────────────

def test_cadastro_pj_formata_cnpj_e_nao_exige_cpf(client, session, loja, validadores_reais):
    resposta = client.post("/api/clientes/", headers=loja["headers"], json=_pj())
    assert resposta.status_code == 201, resposta.get_json()
    cliente = resposta.get_json()["cliente"]
    assert cliente["tipo_pessoa"] == "PJ"
    assert cliente["documento"] == "11.222.333/0001-81"
    assert cliente["razao_social"] == "Alfa Distribuidora LTDA"
    assert not cliente.get("cpf")


def test_cadastro_pj_rejeita_cnpj_invalido_duplicado_e_sem_razao_social(client, session, loja, validadores_reais):
    assert client.post("/api/clientes/", headers=loja["headers"], json=_pj()).status_code == 201

    duplicado = client.post("/api/clientes/", headers=loja["headers"], json=_pj(razao_social="Outra"))
    assert duplicado.status_code == 400
    assert any("já cadastrado" in e for e in duplicado.get_json()["errors"])

    invalido = client.post("/api/clientes/", headers=loja["headers"], json=_pj(cnpj=CNPJ_RUIM))
    assert invalido.status_code == 400
    assert "CNPJ inválido" in invalido.get_json()["errors"]

    sem_razao = _pj(cnpj="45723174000110")
    del sem_razao["razao_social"]
    resposta = client.post("/api/clientes/", headers=loja["headers"], json=sem_razao)
    assert resposta.status_code == 400
    assert any("Razao Social" in e for e in resposta.get_json()["errors"])


def test_cadastro_pf_continua_exigindo_cpf_valido(client, session, loja, validadores_reais):
    base = {"nome": "Pessoa Física", "celular": "11977776666"}
    assert client.post("/api/clientes/", headers=loja["headers"], json={**base, "cpf": CPF_RUIM}).status_code == 400
    assert client.post("/api/clientes/", headers=loja["headers"], json=base).status_code == 400
    ok = client.post("/api/clientes/", headers=loja["headers"], json={**base, "cpf": CPF_OK})
    assert ok.status_code == 201
    assert ok.get_json()["cliente"]["documento"] == "529.982.247-25"


def test_dois_clientes_pj_convivem_sem_cpf(client, session, loja, validadores_reais):
    """CPF nulo não pode colidir na unicidade por loja."""
    assert client.post("/api/clientes/", headers=loja["headers"], json=_pj()).status_code == 201
    segundo = client.post("/api/clientes/", headers=loja["headers"],
                          json=_pj(cnpj="45723174000110", razao_social="Beta Atacado LTDA"))
    assert segundo.status_code == 201, segundo.get_json()


def test_busca_encontra_cliente_pj_por_cnpj(client, session, loja, validadores_reais):
    client.post("/api/clientes/", headers=loja["headers"], json=_pj())
    resposta = client.get("/api/clientes/?busca=11222333", headers=loja["headers"])
    assert resposta.status_code == 200
    nomes = [c["razao_social"] for c in resposta.get_json()["clientes"]]
    assert "Alfa Distribuidora LTDA" in nomes


def test_atualizacao_troca_pf_para_pj_exige_cnpj(client, session, loja, validadores_reais):
    cliente = _cliente(session, loja)
    sem = client.put(f"/api/clientes/{cliente.id}", headers=loja["headers"], json={"tipo_pessoa": "PJ"})
    assert sem.status_code == 400
    com = client.put(f"/api/clientes/{cliente.id}", headers=loja["headers"],
                     json={"tipo_pessoa": "PJ", "cnpj": CNPJ_OK, "razao_social": "Gama LTDA"})
    assert com.status_code == 200, com.get_json()
    session.refresh(cliente)
    assert cliente.tipo_pessoa == "PJ" and cliente.cnpj == "11.222.333/0001-81"


# ───────────────────────── crédito: score e bloqueio ─────────────────────────

def test_score_sem_historico_e_neutro_e_nao_vira_bom_pagador(session, loja):
    cliente = _cliente(session, loja)
    resultado = calcular_score(cliente)
    assert resultado["score"] == 500 and resultado["risco"] == "BAIXO"
    assert resultado["bom_pagador"] is False


def test_score_premia_pontualidade_e_explica_componentes(session, loja):
    cliente = _cliente(session, loja)
    hoje = date.today()
    for i in range(3):
        _titulo(session, loja, cliente, 100, hoje - timedelta(days=10 + i), status="pago",
                recebimento=hoje - timedelta(days=12 + i))
    resultado = calcular_score(cliente)
    assert resultado["componentes"]["pontualidade"] == 300
    assert resultado["score"] == 500 + 300 + 15
    assert resultado["bom_pagador"] is True and resultado["risco"] == "BAIXO"


def test_score_cai_com_titulo_vencido_em_aberto(session, loja):
    cliente = _cliente(session, loja)
    _titulo(session, loja, cliente, 200, date.today() - timedelta(days=70))
    resultado = calcular_score(cliente)
    assert resultado["titulos_vencidos_em_aberto"] == 1
    assert resultado["maior_atraso_dias"] == 70
    assert resultado["risco"] == "ALTO"  # atraso > 60 dias
    assert resultado["bom_pagador"] is False
    assert resultado["score"] < 500


def test_tolerancia_de_atraso_antes_de_bloquear(session, loja):
    cliente = _cliente(session, loja)
    _titulo(session, loja, cliente, 100, date.today() - timedelta(days=3))
    validar_sem_atraso(cliente)  # dentro da tolerância de 5 dias
    _titulo(session, loja, cliente, 100, date.today() - timedelta(days=9))
    with pytest.raises(ValueError, match="vencido"):
        validar_sem_atraso(cliente)
    assert len(titulos_vencidos(cliente)) == 1


def test_recalcular_credito_grava_no_cliente(session, loja):
    cliente = _cliente(session, loja)
    _titulo(session, loja, cliente, 100, date.today() - timedelta(days=20))
    recalcular_credito(cliente)
    assert cliente.risco_inadimplencia in ("MEDIO", "ALTO")
    assert cliente.atraso_medio_dias == pytest.approx(20.0)
    assert cliente.bom_pagador is False


def _venda_fiado(client, loja, cliente, valor=100):
    return client.post("/api/pdv/finalizar", headers=loja["headers"], json={
        "cliente_id": cliente.id, "subtotal": valor, "total": valor, "desconto": 0,
        "items": [{"id": loja["prod"].id, "quantidade": 1, "preco_unitario": valor}],
        "pagamentos": [{"forma": "fiado", "valor": valor}]})


def test_pdv_bloqueia_fiado_de_cliente_em_atraso_mas_aceita_a_vista(client, session, loja):
    cliente = _cliente(session, loja)
    _titulo(session, loja, cliente, 100, date.today() - timedelta(days=15))
    bloqueada = _venda_fiado(client, loja, cliente)
    assert bloqueada.status_code in (400, 409, 422), bloqueada.get_json()
    assert "vencido" in str(bloqueada.get_json()).lower()

    a_vista = client.post("/api/pdv/finalizar", headers=loja["headers"], json={
        "cliente_id": cliente.id, "subtotal": 100, "total": 100, "desconto": 0,
        "items": [{"id": loja["prod"].id, "quantidade": 1, "preco_unitario": 100}],
        "pagamentos": [{"forma": "dinheiro", "valor": 100}]})
    assert a_vista.status_code == 201, a_vista.get_json()


def test_pdv_libera_fiado_de_cliente_em_dia(client, session, loja):
    cliente = _cliente(session, loja)
    resposta = _venda_fiado(client, loja, cliente)
    assert resposta.status_code == 201, resposta.get_json()
    session.refresh(cliente)
    assert cliente.saldo_devedor == Decimal("100.00")


def test_endpoint_de_credito_mostra_bloqueio(client, session, loja):
    cliente = _cliente(session, loja)
    assert client.get(f"/api/clientes/{cliente.id}/credito", headers=loja["headers"]).get_json()["credito"][
        "bloqueado_para_prazo"] is False
    _titulo(session, loja, cliente, 100, date.today() - timedelta(days=30))
    credito = client.get(f"/api/clientes/{cliente.id}/credito", headers=loja["headers"]).get_json()["credito"]
    assert credito["bloqueado_para_prazo"] is True
    assert credito["dias_tolerancia_atraso"] == 5
    assert credito["limite_disponivel"] == pytest.approx(1000.0)


# ───────────────────────── baixa de fiado ─────────────────────────

def _devedor(session, loja, saldo=300):
    cliente = _cliente(session, loja, saldo_devedor=Decimal(saldo))
    _titulo(session, loja, cliente, saldo, date.today() + timedelta(days=10))
    return cliente


@pytest.mark.parametrize("valor", ["abc", float("nan"), float("inf"), -10, 0, None])
def test_pagar_fiado_recusa_valor_invalido_sem_tocar_na_divida(client, session, loja, valor):
    cliente = _devedor(session, loja)
    resposta = client.post(f"/api/clientes/{cliente.id}/pagar_fiado", headers=loja["headers"], json={"valor": valor})
    assert resposta.status_code == 400
    session.refresh(cliente)
    assert cliente.saldo_devedor == Decimal("300.00")
    assert ContaReceber.query.filter_by(cliente_id=cliente.id).one().valor_atual == Decimal("300.00")


def test_pagar_fiado_parcial_depois_total_quita_titulo_e_recalcula_credito(client, session, loja):
    cliente = _devedor(session, loja)
    parcial = client.post(f"/api/clientes/{cliente.id}/pagar_fiado", headers=loja["headers"], json={"valor": 100.5})
    assert parcial.status_code == 200, parcial.get_json()
    assert parcial.get_json()["saldo_devedor_atual"] == pytest.approx(199.5)

    excesso = client.post(f"/api/clientes/{cliente.id}/pagar_fiado", headers=loja["headers"], json={"valor": 500})
    assert excesso.status_code == 400

    final = client.post(f"/api/clientes/{cliente.id}/pagar_fiado", headers=loja["headers"], json={"valor": 199.5})
    assert final.status_code == 200
    session.expire_all()
    titulo = ContaReceber.query.filter_by(cliente_id=cliente.id).one()
    assert titulo.status == "pago" and titulo.valor_atual == 0
    assert Cliente.query.get(cliente.id).saldo_devedor == 0
    assert final.get_json()["score_credito"] == Cliente.query.get(cliente.id).score_credito


def test_pagar_fiado_distribui_fifo_entre_titulos(client, session, loja):
    cliente = _cliente(session, loja, saldo_devedor=Decimal("300"))
    antigo = _titulo(session, loja, cliente, 100, date.today() + timedelta(days=5), numero="A")
    antigo.data_emissao = date.today() - timedelta(days=40)
    recente = _titulo(session, loja, cliente, 200, date.today() + timedelta(days=20), numero="B")
    session.commit()
    resposta = client.post(f"/api/clientes/{cliente.id}/pagar_fiado", headers=loja["headers"], json={"valor": 150})
    assert resposta.status_code == 200, resposta.get_json()
    session.expire_all()
    assert ContaReceber.query.get(antigo.id).status == "pago"
    assert ContaReceber.query.get(recente.id).valor_atual == Decimal("150.00")


# ───────────────────────── importação CSV ─────────────────────────

def _importar(client, loja, texto, nome="clientes.csv"):
    return client.post("/api/clientes/importar", headers=loja["headers"],
                       data={"arquivo": (io.BytesIO(texto.encode("utf-8")), nome)}, content_type="multipart/form-data")


CABECALHO = "nome;cpf;cnpj;razao_social;celular;limite_credito;saldo_devedor;vencimento_saldo;cep;cidade;estado\n"


def test_importacao_mistura_pf_pj_saldo_inicial_e_isola_linhas_ruins(client, session, loja, validadores_reais):
    csv = CABECALHO + (
        f"Maria Souza;{CPF_OK};;;11999990001;R$ 1.500,00;1.234,56;15/12/2030;01000-000;São Paulo;sp\n"
        f"Alfa;;{CNPJ_OK};Alfa Distribuidora LTDA;1133334444;10000;0;;;;\n"
        f"CPF Ruim;{CPF_RUIM};;;11999990002;0;0;;;;\n"
        f"Repetida;{CPF_OK};;;11999990003;0;0;;;;\n"
        f"Sem Celular;{CPF_OK_2};;;;0;0;;;;\n"
        f"Limite Negativo;{CPF_OK_2};;;11999990004;-5;0;;;;\n"
    )
    resposta = _importar(client, loja, csv)
    corpo = resposta.get_json()
    assert resposta.status_code == 200, corpo
    assert corpo["total_importados"] == 2 and corpo["total_erros"] == 4

    maria = Cliente.query.filter_by(cpf="529.982.247-25").one()
    assert maria.tipo_pessoa == "PF" and maria.limite_credito == Decimal("1500.00")
    assert maria.saldo_devedor == Decimal("1234.56") and maria.estado == "SP"
    titulo = ContaReceber.query.filter_by(cliente_id=maria.id).one()
    assert titulo.tipo_documento == "saldo_inicial" and titulo.valor_atual == Decimal("1234.56")
    assert titulo.data_vencimento == date(2030, 12, 15)

    alfa = Cliente.query.filter_by(cnpj="11.222.333/0001-81").one()
    assert alfa.tipo_pessoa == "PJ" and alfa.razao_social == "Alfa Distribuidora LTDA" and alfa.cpf is None
    assert ContaReceber.query.filter_by(cliente_id=alfa.id).count() == 0


def test_importacao_reimportada_nao_duplica_cliente(client, session, loja, validadores_reais):
    csv = CABECALHO + f"Maria Souza;{CPF_OK};;;11999990001;100;0;;;;\n"
    assert _importar(client, loja, csv).get_json()["total_importados"] == 1
    segunda = _importar(client, loja, csv)
    assert segunda.status_code == 422
    assert segunda.get_json()["total_importados"] == 0
    assert Cliente.query.filter_by(estabelecimento_id=loja["estab"].id).count() == 1


def test_importacao_todas_linhas_ruins_devolve_422(client, session, loja, validadores_reais):
    resposta = _importar(client, loja, CABECALHO + f"CPF Ruim;{CPF_RUIM};;;11999990002;0;0;;;;\n")
    assert resposta.status_code == 422 and resposta.get_json()["success"] is False


def test_importacao_aceita_virgula_e_latin1_e_recusa_arquivo_nao_csv(client, session, loja, validadores_reais):
    texto = f"nome,cpf,celular\nJosé Açaí,{CPF_OK},11999990001\n".encode("latin-1")
    resposta = client.post("/api/clientes/importar", headers=loja["headers"],
                           data={"arquivo": (io.BytesIO(texto), "x.csv")}, content_type="multipart/form-data")
    assert resposta.status_code == 200, resposta.get_json()
    assert Cliente.query.filter_by(cpf="529.982.247-25").one().nome == "José Açaí"
    assert _importar(client, loja, "a;b\n", nome="x.txt").status_code == 400


def test_busca_de_vendas_por_documento_do_cliente_so_com_digitos(client, session, loja):
    pf = _cliente(session, loja, cpf="529.982.247-25")
    pj = _cliente(session, loja, nome="Alfa", tipo_pessoa="PJ", cpf=None, cnpj="11.222.333/0001-81",
                  razao_social="Alfa Distribuidora LTDA")
    for cliente in (pf, pj):
        resposta = client.post("/api/pdv/finalizar", headers=loja["headers"], json={
            "cliente_id": cliente.id, "subtotal": 100, "total": 100, "desconto": 0,
            "items": [{"id": loja["prod"].id, "quantidade": 1, "preco_unitario": 100}],
            "pagamentos": [{"forma": "dinheiro", "valor": 100}]})
        assert resposta.status_code == 201, resposta.get_json()

    por_cpf = client.get("/api/vendas/?search=52998224725", headers=loja["headers"]).get_json()["vendas"]
    por_cnpj = client.get("/api/vendas/?cliente_cpf=11222333000181", headers=loja["headers"]).get_json()["vendas"]
    assert [v["cliente"]["nome"] for v in por_cpf] == ["Cliente"]
    assert [v["cliente"]["nome"] for v in por_cnpj] == ["Alfa"]


def test_busca_de_vendas_nao_cruza_clientes_de_outra_loja(client, session, loja):
    """Sem JOIN explícito a venda passava se QUALQUER cliente do banco batesse com o termo."""
    outra = Estabelecimento(nome_fantasia="Outra Loja", razao_social="Outra LTDA", cnpj="99888777000166",
                            email="outra@x.com", telefone="92988887777", data_abertura=date(2024, 1, 1),
                            plano="PREMIUM", vencimento_plano=date(2030, 12, 31), cep="69000-000", logradouro="Rua",
                            numero="9", bairro="Centro", cidade="Manaus", estado="AM", pais="Brasil")
    session.add(outra)
    session.flush()
    session.add(Cliente(estabelecimento_id=outra.id, nome="Zulu Exclusivo", cpf="39053344705", celular="92999990009",
                        cep="69000-000", logradouro="Rua", numero="1", bairro="Centro", cidade="Manaus", estado="AM"))
    cliente = _cliente(session, loja, nome="Maria da Loja")
    session.commit()
    assert client.post("/api/pdv/finalizar", headers=loja["headers"], json={
        "cliente_id": cliente.id, "subtotal": 100, "total": 100, "desconto": 0,
        "items": [{"id": loja["prod"].id, "quantidade": 1, "preco_unitario": 100}],
        "pagamentos": [{"forma": "dinheiro", "valor": 100}]}).status_code == 201

    assert client.get("/api/vendas/?search=Zulu", headers=loja["headers"]).get_json()["vendas"] == []
    assert client.get("/api/vendas/?cliente_nome=Zulu", headers=loja["headers"]).get_json()["vendas"] == []
    achou = client.get("/api/vendas/?search=Maria", headers=loja["headers"]).get_json()["vendas"]
    assert [v["cliente"]["nome"] for v in achou] == ["Maria da Loja"]
