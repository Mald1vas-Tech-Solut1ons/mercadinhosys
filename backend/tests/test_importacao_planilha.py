"""Importação de produtos por planilha (POST /api/produtos/importar, modal "Importar Planilha").

Prova a implantação de uma loja nova em série: o modelo oficial e um mix real de 30 itens
(mercearia com EAN, granel por kg, perfumaria e roupa por tamanho/cor) entram com ';' ou ',',
UTF-8 com ou sem BOM ou CSV do Excel pt-BR (cp1252), preço e estoque com vírgula. Erro numa
linha não desfaz as outras; EAN repetido (na planilha ou na loja) é recusado com o nome do
produto; categoria casa sem maiúscula nem acento; estoque inicial gera movimentação de entrada
e lote só quando há validade; o item importado vende e o sem estoque é recusado.
"""
import csv
import io
import os
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Configuracao, Estabelecimento, Funcionario, MovimentacaoEstoque,
    Produto, ProdutoLote,
)

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CABECALHO = "nome;categoria;preco_custo;preco_venda;codigo_barras;codigo_interno;marca;unidade;estoque;lote;data_validade"


def _ean(base12: str) -> str:
    soma = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(base12))
    return base12 + str((10 - soma % 10) % 10)


def _ilus(n: int) -> str:
    return _ean("789" + str(n).zfill(9))


MIX = [
    ("Leite Condensado Moça 395g", "Mercearia", "5,49", "8,90", "7891000100103", "", "Nestlé", "UN", "24", "", "30/06/2027"),
    ("Arroz Branco Tipo 1 5kg", "Mercearia", "19,90", "27,90", "7896006716112", "", "", "UN", "20", "", "15/03/2027"),
    ("Refrigerante Coca-Cola 2L", "Bebidas", "6,80", "10,99", "7894900011517", "", "Coca-Cola", "UN", "36", "", "10/02/2027"),
    ("Feijão Carioca 1kg", "Mercearia", "6,20", "8,99", _ilus(100000011), "", "", "UN", "30", "", "20/01/2027"),
    ("Açúcar Refinado 1kg", "Mercearia", "3,90", "5,49", _ilus(100000012), "", "", "UN", "40", "", "01/12/2027"),
    ("Café Torrado e Moído 500g", "Mercearia", "14,50", "21,90", _ilus(100000013), "", "", "UN", "18", "", "31/05/2027"),
    ("Óleo de Soja 900ml", "Mercearia", "5,80", "7,99", _ilus(100000014), "", "", "UN", "24", "", "30/09/2027"),
    ("Macarrão Espaguete 500g", "Mercearia", "3,10", "4,79", _ilus(100000015), "", "", "UN", "30", "", "30/04/2027"),
    ("Molho de Tomate 300g", "Mercearia", "1,90", "3,29", _ilus(100000016), "", "", "UN", "36", "", "31/08/2027"),
    ("Água Mineral 500ml", "Bebidas", "0,90", "2,50", _ilus(100000017), "", "", "UN", "48", "", "31/12/2027"),
    ("Pão Francês", "Padaria", "9,00", "16,90", "", "", "", "KG", "8,5", "", ""),
    ("Queijo Mussarela Fatiado", "Frios", "32,00", "49,90", "", "", "", "KG", "4,2", "", ""),
    ("Presunto Cozido Fatiado", "Frios", "24,00", "39,90", "", "", "", "KG", "3", "", ""),
    ("Feijão Carioca a Granel", "Mercearia", "5,50", "8,49", "", "", "", "KG", "25", "", ""),
    ("Banana Prata", "Hortifruti", "3,20", "6,99", "", "", "", "KG", "12", "", ""),
    ("Sabonete em Barra 85g", "Perfumaria", "1,20", "2,49", _ilus(200000021), "", "", "UN", "60", "", "01/01/2029"),
    ("Shampoo Anticaspa 350ml", "Perfumaria", "11,90", "19,90", _ilus(200000022), "", "", "UN", "12", "", "01/06/2028"),
    ("Desodorante Aerosol 150ml", "Perfumaria", "9,50", "16,90", _ilus(200000023), "", "", "UN", "15", "", "01/03/2028"),
    ("Creme Dental 90g", "Perfumaria", "2,80", "4,99", _ilus(200000024), "", "", "UN", "40", "", "01/10/2028"),
    ("Hidratante Corporal 400ml", "Cosméticos", "13,00", "22,90", _ilus(200000025), "", "", "UN", "10", "", "01/08/2028"),
    ("Colônia Feminina 100ml", "Cosméticos", "35,00", "69,90", _ilus(200000026), "", "", "UN", "0", "", ""),
    ("Camiseta Básica Algodão Preta P", "Moda", "18,00", "39,90", "", "", "", "UN", "5", "", ""),
    ("Camiseta Básica Algodão Preta M", "Moda", "18,00", "39,90", "", "", "", "UN", "8", "", ""),
    ("Camiseta Básica Algodão Preta G", "Moda", "18,00", "39,90", "", "", "", "UN", "6", "", ""),
    ("Camiseta Básica Algodão Branca P", "Moda", "18,00", "39,90", "", "", "", "UN", "5", "", ""),
    ("Camiseta Básica Algodão Branca M", "Moda", "18,00", "39,90", "", "", "", "UN", "8", "", ""),
    ("Camiseta Básica Algodão Branca G", "Moda", "18,00", "39,90", "", "", "", "UN", "6", "", ""),
    ("Calça Jeans Masculina Azul 38", "Moda", "55,00", "119,90", "", "", "", "UN", "3", "", ""),
    ("Calça Jeans Masculina Azul 40", "Moda", "55,00", "119,90", "", "", "", "UN", "4", "", ""),
    ("Calça Jeans Masculina Azul 42", "Moda", "55,00", "119,90", "", "", "", "UN", "0", "", ""),
]


def _csv(linhas, cabecalho=CABECALHO, delimitador=";") -> str:
    buf = io.StringIO()
    escritor = csv.writer(buf, delimiter=delimitador, lineterminator="\n")
    escritor.writerow(cabecalho.split(";"))
    for linha in linhas:
        escritor.writerow(linha)
    return buf.getvalue()


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="IMP-1",
                  saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                  data_abertura=datetime.now(timezone.utc))
    session.add(caixa)
    config = Configuracao.query.filter_by(estabelecimento_id=estab.id).first()
    config.permitir_venda_sem_estoque = False
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "ADMIN"})
    return dict(estab=estab, admin=admin, headers={"Authorization": f"Bearer {token}"})


def _importar(client, ctx, conteudo, nome="planilha.csv"):
    if isinstance(conteudo, str):
        conteudo = conteudo.encode("utf-8")
    return client.post("/api/produtos/importar", headers=ctx["headers"], content_type="multipart/form-data",
                       data={"arquivo": (io.BytesIO(conteudo), nome)})


def _ok(r, importados, erros=0):
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["total_importados"] == importados, body
    assert body["total_erros"] == erros, body
    return body


def _vender(client, ctx, produto, quantidade):
    preco = float(produto.preco_venda)
    total = round(quantidade * preco, 2)
    return client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "items": [{"id": produto.id, "quantity": quantidade, "discount": 0, "price": preco}],
        "subtotal": total, "desconto": 0, "total": total,
        "pagamentos": [{"forma": "pix", "valor": total}], "cliente_id": None,
    })


# ── Formatos de arquivo ─────────────────────────────────────────────────────

def test_modelo_oficial_importa_todas_as_linhas(client, session, ctx):
    with open(os.path.join(BACKEND, "import_template.csv"), "rb") as f:
        _ok(_importar(client, ctx, f.read(), "import_template.csv"), 5)
    assert Produto.query.filter_by(codigo_barras="7891234567895").first().preco_venda == Decimal("29.90")


@pytest.mark.parametrize("delimitador", [";", ","])
def test_mix_de_30_itens_com_ponto_e_virgula_ou_virgula(client, session, ctx, delimitador):
    body = _ok(_importar(client, ctx, _csv(MIX, delimitador=delimitador)), 30)
    assert body["erros"] == []
    assert Produto.query.count() == 30
    nomes = {c.nome for c in CategoriaProduto.query.all()}
    assert nomes == {"Mercearia", "Bebidas", "Padaria", "Frios", "Hortifruti", "Perfumaria", "Cosméticos", "Moda"}


@pytest.mark.parametrize("codificacao", ["utf-8-sig", "cp1252"])
def test_utf8_com_bom_e_csv_do_excel_cp1252(client, session, ctx, codificacao):
    _ok(_importar(client, ctx, _csv(MIX).encode(codificacao)), 30)
    assert Produto.query.filter_by(nome="Pão Francês").first() is not None
    assert Produto.query.filter_by(nome="Colônia Feminina 100ml").first() is not None


def test_extensao_maiuscula_aceita_e_xlsx_recusado_com_orientacao(client, session, ctx):
    _ok(_importar(client, ctx, _csv(MIX[:2]), "PLANILHA.CSV"), 2)
    r = _importar(client, ctx, b"PK\x03\x04", "planilha.xlsx")
    assert r.status_code == 400 and "CSV UTF-8" in r.get_json()["message"]


def test_cabecalho_errado_explica_a_primeira_linha_esperada(client, session, ctx):
    r = _importar(client, ctx, "produto_nome;valor\nArroz;10\n")
    assert r.status_code == 400
    msg = r.get_json()["message"]
    assert "categoria" in msg and "nome;categoria;preco_custo;preco_venda" in msg


# ── Conteúdo ────────────────────────────────────────────────────────────────

def test_preco_e_estoque_com_virgula(client, session, ctx):
    linhas = [
        ("Pão Francês", "Padaria", "9,00", "16,90", "", "", "", "kg", "8,5", "", ""),
        ("Queijo", "Frios", "R$ 32,00", "1.049,90", "", "", "", "KG", "4,250", "", ""),
    ]
    _ok(_importar(client, ctx, _csv(linhas)), 2)
    pao = Produto.query.filter_by(nome="Pão Francês").first()
    assert pao.quantidade == Decimal("8.5") and pao.preco_venda == Decimal("16.90") and pao.unidade_medida == "KG"
    queijo = Produto.query.filter_by(nome="Queijo").first()
    assert queijo.preco_custo == Decimal("32.00") and queijo.preco_venda == Decimal("1049.90")
    assert queijo.quantidade == Decimal("4.25")


def test_ean_repetido_na_planilha_e_na_loja_recusa_so_a_linha(client, session, ctx):
    cat = CategoriaProduto(estabelecimento_id=ctx["estab"].id, nome="Mercearia")
    session.add(cat)
    session.flush()
    session.add(Produto(estabelecimento_id=ctx["estab"].id, categoria_id=cat.id, nome="Leite Moça antigo",
                        codigo_barras="7891000100103", preco_custo=Decimal("5"), preco_venda=Decimal("9")))
    session.commit()

    linhas = [
        ("Leite Condensado Moça 395g", "Mercearia", "5,49", "8,90", "7891000100103", "", "", "UN", "24", "", ""),
        ("Coca-Cola 2L", "Bebidas", "6,80", "10,99", "7894900011517", "", "", "UN", "36", "", ""),
        ("Coca-Cola 2L de novo", "Bebidas", "6,80", "10,99", "7894900011517", "", "", "UN", "36", "", ""),
        ("Arroz 5kg", "Mercearia", "19,90", "27,90", "7896006716112", "", "", "UN", "20", "", ""),
    ]
    body = _ok(_importar(client, ctx, _csv(linhas)), 2, 2)
    assert body["erros"][0].startswith("Linha 2 (Leite Condensado Moça 395g):")
    assert "já está cadastrado no produto 'Leite Moça antigo'" in body["erros"][0]
    assert body["erros"][1].startswith("Linha 4 (Coca-Cola 2L de novo):")
    assert "já aparece na linha 3" in body["erros"][1]
    # As linhas boas, antes e depois da repetida, ficaram gravadas (sem rollback em cascata)
    assert {p.nome for p in Produto.query.all()} == {"Leite Moça antigo", "Coca-Cola 2L", "Arroz 5kg"}


def test_ean_de_produto_excluido_tambem_e_recusado_com_mensagem(client, session, ctx):
    cat = CategoriaProduto(estabelecimento_id=ctx["estab"].id, nome="Mercearia")
    session.add(cat)
    session.flush()
    excluido = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=cat.id, nome="Excluído",
                       codigo_barras="7891000100103", preco_custo=Decimal("5"), preco_venda=Decimal("9"))
    excluido.soft_delete()
    session.add(excluido)
    session.commit()
    body = _ok(_importar(client, ctx, _csv(MIX[:1])), 0, 1)
    assert "já está cadastrado no produto 'Excluído'" in body["erros"][0]


def test_categoria_casa_sem_maiuscula_nem_acento(client, session, ctx):
    session.add(CategoriaProduto(estabelecimento_id=ctx["estab"].id, nome="Cosméticos"))
    session.commit()
    linhas = [
        ("Hidratante", "cosmeticos", "1", "2", "", "", "", "UN", "1", "", ""),
        ("Perfume", "COSMÉTICOS", "1", "2", "", "", "", "UN", "1", "", ""),
        ("Banana", "hortifrúti", "1", "2", "", "", "", "KG", "1", "", ""),
        ("Maçã", "Hortifruti ", "1", "2", "", "", "", "KG", "1", "", ""),
    ]
    _ok(_importar(client, ctx, _csv(linhas)), 4)
    categorias = CategoriaProduto.query.filter_by(estabelecimento_id=ctx["estab"].id).all()
    assert sorted(c.nome for c in categorias) == ["Cosméticos", "Hortifrúti"]
    cosmeticos = next(c for c in categorias if c.nome == "Cosméticos")
    assert Produto.query.filter_by(categoria_id=cosmeticos.id).count() == 2


def test_estoque_inicial_gera_movimentacao_e_lote_so_com_validade(client, session, ctx):
    linhas = [
        ("Leite Moça", "Mercearia", "5,49", "8,90", "7891000100103", "", "", "UN", "24", "", "30/06/2027"),
        ("Arroz", "Mercearia", "19,90", "27,90", "7896006716112", "", "", "UN", "20", "L-77", "15/03/2027"),
        ("Camiseta Preta M", "Moda", "18,00", "39,90", "", "", "", "UN", "8", "", ""),
        ("Calça 42", "Moda", "55,00", "119,90", "", "", "", "UN", "0", "", ""),
    ]
    _ok(_importar(client, ctx, _csv(linhas)), 4)
    leite = Produto.query.filter_by(nome="Leite Moça").first()
    arroz = Produto.query.filter_by(nome="Arroz").first()
    camiseta = Produto.query.filter_by(nome="Camiseta Preta M").first()
    calca = Produto.query.filter_by(nome="Calça 42").first()

    lote_leite = ProdutoLote.query.filter_by(produto_id=leite.id).one()
    assert lote_leite.quantidade == Decimal("24") and lote_leite.data_validade == date(2027, 6, 30)
    assert ProdutoLote.query.filter_by(produto_id=arroz.id).one().numero_lote == "L-77"
    mov = MovimentacaoEstoque.query.filter_by(produto_id=leite.id).one()
    assert mov.tipo == "entrada" and mov.quantidade == Decimal("24") and mov.lote_id == lote_leite.id
    assert mov.funcionario_id == ctx["admin"].id and mov.quantidade_anterior == 0

    # Sem validade: estoque e movimentação, mas nenhum lote nem validade inventada
    assert camiseta.quantidade == Decimal("8") and camiseta.data_validade is None
    assert not camiseta.controlar_validade
    assert ProdutoLote.query.filter_by(produto_id=camiseta.id).count() == 0
    assert MovimentacaoEstoque.query.filter_by(produto_id=camiseta.id).one().quantidade == Decimal("8")
    # Estoque zero: nada a movimentar
    assert MovimentacaoEstoque.query.filter_by(produto_id=calca.id).count() == 0


def test_dois_produtos_com_validade_e_sem_numero_de_lote_nao_colidem(client, session, ctx):
    _ok(_importar(client, ctx, _csv(MIX[:10])), 10)
    numeros = [l.numero_lote for l in ProdutoLote.query.all()]
    assert len(numeros) == 10 and len(set(numeros)) == 10


def test_erros_humanos_com_linha_do_excel_e_todos_devolvidos(client, session, ctx):
    ruins = [("Item %d" % i, "Mercearia", "1", "abc", "", "", "", "UN", "1", "", "") for i in range(12)]
    linhas = [
        ("", "Mercearia", "1", "2", "", "", "", "UN", "1", "", ""),
        ("Leite", "Mercearia", "1", "2", "7,89E+12", "", "", "UN", "1", "", ""),
        ("Arroz", "Mercearia", "1", "2", "", "", "", "UN", "1", "", "31/02/2027"),
        ("Bom", "Mercearia", "1", "2", "", "", "", "UN", "1", "", ""),
    ] + ruins
    body = _ok(_importar(client, ctx, _csv(linhas)), 1, 15)
    assert len(body["erros"]) == 15
    assert body["erros"][0] == "Linha 2: o nome do produto é obrigatório"
    assert body["erros"][1].startswith("Linha 3 (Leite):") and "notação científica" in body["erros"][1]
    assert body["erros"][2].startswith("Linha 4 (Arroz):") and "data de validade" in body["erros"][2]
    assert body["erros"][3] == "Linha 6 (Item 0): preço de venda 'abc' não é um número válido"
    assert all("Erro inesperado" not in e and "SQL" not in e for e in body["erros"])


def test_ncm_opcional_e_gravado_com_zero_a_esquerda(client, session, ctx):
    linhas = [("Leite Moça", "Mercearia", "5,49", "8,90", "7891000100103", "", "", "UN", "24", "", "", "4029900"),
              ("Coca 2L", "Bebidas", "6,80", "10,99", "7894900011517", "", "", "UN", "36", "", "", "2202.10.00")]
    _ok(_importar(client, ctx, _csv(linhas, cabecalho=CABECALHO + ";ncm")), 2)
    assert Produto.query.filter_by(nome="Leite Moça").first().ncm == "04029900"
    assert Produto.query.filter_by(nome="Coca 2L").first().ncm == "22021000"


# ── Da planilha ao caixa ────────────────────────────────────────────────────

def test_item_importado_vende_e_baixa_estoque_e_sem_estoque_e_recusado(client, session, ctx):
    _ok(_importar(client, ctx, _csv(MIX)), 30)

    leite = Produto.query.filter_by(codigo_barras="7891000100103").first()
    r = _vender(client, ctx, leite, 2)
    assert r.status_code == 201, r.get_json()
    session.expire_all()
    assert session.get(Produto, leite.id).quantidade == Decimal("22")
    assert ProdutoLote.query.filter_by(produto_id=leite.id).one().quantidade == Decimal("22")

    pao = Produto.query.filter_by(nome="Pão Francês").first()
    r = _vender(client, ctx, pao, 0.35)
    assert r.status_code == 201, r.get_json()
    session.expire_all()
    assert session.get(Produto, pao.id).quantidade == Decimal("8.15")

    colonia = Produto.query.filter_by(nome="Colônia Feminina 100ml").first()
    r = _vender(client, ctx, colonia, 1)
    assert r.status_code == 400
    assert "Estoque insuficiente" in r.get_json()["error"]


def test_ncm_de_perfumaria_importado_sai_como_pis_cofins_monofasico(client, session, ctx):
    linhas = [("Shampoo Anticaspa 350ml", "Perfumaria", "11,90", "19,90", "", "", "", "UN", "12", "", "", "3305.10.00"),
              ("Leite Moça", "Mercearia", "5,49", "8,90", "", "", "", "UN", "24", "", "", "04029900"),
              ("Camiseta Preta M", "Moda", "18,00", "39,90", "", "", "", "UN", "8", "", "", "")]
    _ok(_importar(client, ctx, _csv(linhas, cabecalho=CABECALHO + ";ncm")), 3)
    shampoo = Produto.query.filter_by(nome="Shampoo Anticaspa 350ml").first()
    assert shampoo.ncm == "33051000" and shampoo.to_dict()["pis_cofins_monofasico"] is True
    assert Produto.query.filter_by(nome="Leite Moça").first().to_dict()["pis_cofins_monofasico"] is False
    assert Produto.query.filter_by(nome="Camiseta Preta M").first().to_dict()["pis_cofins_monofasico"] is False
