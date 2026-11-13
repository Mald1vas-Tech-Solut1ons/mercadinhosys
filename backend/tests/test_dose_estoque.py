"""Venda por dose (WP5): perda, cortesia, ajuste por contagem, descarte, razão de ml e garrafa aberta no estoque.

Cenário: whisky de 1 L (custo R$ 120, 10 garrafas), dose de 50 ml e dupla de 100 ml. A 1ª dose abre uma garrafa.
"""
import json
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Configuracao, Estabelecimento, Funcionario, Produto, ProdutoLote,
)
from app.models_dose import DoseMovimento, GarrafaAberta, ProdutoDose
from app.services import dose_service as ds
from app.utils.timezone import hoje_local

PIN = "2468"


def D(v):
    return Decimal(str(v))


def _token(func, estab):
    return {"Authorization": "Bearer " + create_access_token(
        identity=str(func.id), additional_claims={"estabelecimento_id": estab.id, "role": func.role})}


@pytest.fixture
def bar(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    admin.set_pin(PIN)
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Destilados")
    session.add(cat)
    session.flush()
    whisky = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="WHISKY 1L", unidade_medida="UN",
                     preco_custo=D(120), preco_venda=D(150), quantidade=D(10), controlar_validade=True,
                     codigo_barras="7891234567895", vende_por_dose=True, volume_embalagem_ml=D(1000))
    refri = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="REFRI 2L", unidade_medida="UN",
                    preco_custo=D(5), preco_venda=D(9), quantidade=D(10), controlar_validade=True)
    session.add_all([whisky, refri])
    session.flush()
    for p in (whisky, refri):
        session.add(ProdutoLote(estabelecimento_id=estab.id, produto_id=p.id, numero_lote=f"L-{p.id}", quantidade=10,
                                quantidade_inicial=10, data_entrada=hoje_local(),
                                data_validade=hoje_local() + timedelta(days=90), preco_custo_unitario=p.preco_custo,
                                ativo=True))
    d50 = ProdutoDose(estabelecimento_id=estab.id, produto_id=whisky.id, nome="Dose", volume_ml=D(50), preco_venda=D(18),
                      padrao=True)
    d100 = ProdutoDose(estabelecimento_id=estab.id, produto_id=whisky.id, nome="Dupla", volume_ml=D(100),
                       preco_venda=D(32))
    session.add_all([d50, d100, Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="C-ADM",
                                      saldo_inicial=0, saldo_atual=0, status="aberto")])
    session.commit()
    return dict(estab=estab, admin=admin, whisky=whisky, refri=refri, d50=d50, d100=d100, headers=_token(admin, estab))


@pytest.fixture
def operador(session, bar):
    f = Funcionario(estabelecimento_id=bar["estab"].id, nome="Caixa Bar", cpf="55544433322", username="caixa_bar",
                    role="caixa", ativo=True, data_nascimento=date(1995, 1, 1), celular="92999999999",
                    email="caixa@bar.sys", cargo="Caixa", data_admissao=date(2024, 1, 1), salario_base=D(2000))
    f.set_password("industrial-secret")
    session.add(f)
    session.flush()
    session.add(Caixa(estabelecimento_id=bar["estab"].id, funcionario_id=f.id, numero_caixa="C-CX", saldo_inicial=0,
                      saldo_atual=0, status="aberto"))
    session.commit()
    return {"func": f, "headers": _token(f, bar["estab"])}


def _servir(client, bar, quantidade=3, dose="d50", preco=18):
    r = client.post("/api/pdv/finalizar", headers=bar["headers"], json={
        "subtotal": quantidade * preco, "total": quantidade * preco, "desconto": 0,
        "items": [{"id": bar["whisky"].id, "quantity": quantidade, "price": preco, "dose_id": bar[dose].id}],
        "pagamentos": [{"forma": "dinheiro", "valor": quantidade * preco}]})
    assert r.status_code in (200, 201), r.get_json()
    return r.get_json()["venda"]["id"]


def _garrafa(bar):
    return GarrafaAberta.query.filter_by(produto_id=bar["whisky"].id, status="aberta").one()


def _baixa(client, headers, bar, **corpo):
    return client.post(f"/api/doses/produto/{bar['whisky'].id}/baixa", headers=headers, json=corpo)


# ── Perda, cortesia e degustação ────────────────────────────────────────────

def test_perda_sai_da_aberta_e_registra_o_custo_e_o_motivo(client, session, bar):
    _servir(client, bar)                                                   # aberta: 850 ml
    r = _baixa(client, bar["headers"], bar, tipo="perda", ml=120, motivo="Derramou no balcão")
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["ml"] == 120.0 and corpo["custo"] == 14.4                 # 0,12 R$/ml x 120 ml
    assert corpo["estado"]["saldo_aberto_ml"] == 730.0 and corpo["estado"]["garrafas_abertas"] == 1
    g = _garrafa(bar)
    mov = DoseMovimento.query.filter_by(garrafa_id=g.id, tipo="perda").one()
    assert D(mov.ml) == D(-120) and mov.motivo == "Derramou no balcão" and mov.funcionario_id == bar["admin"].id
    assert ds.ledger_confere(g)


def test_perda_exige_dizer_o_que_aconteceu(client, session, bar):
    r = _baixa(client, bar["headers"], bar, tipo="perda", ml=50)
    assert r.status_code == 400 and "o que aconteceu" in r.get_json()["error"]
    assert GarrafaAberta.query.count() == 0                               # nada foi aberto à toa


@pytest.mark.parametrize("tipo", ["cortesia", "degustacao"])
def test_cortesia_e_degustacao_nao_pedem_motivo(client, session, bar, tipo):
    _servir(client, bar, 1)
    r = _baixa(client, bar["headers"], bar, tipo=tipo, ml=30)
    assert r.status_code == 200 and r.get_json()["estado"]["saldo_aberto_ml"] == 920.0
    assert DoseMovimento.query.filter_by(tipo=tipo).count() == 1


def test_baixa_sem_garrafa_aberta_abre_uma(client, session, bar):
    r = _baixa(client, bar["headers"], bar, tipo="cortesia", ml=50)
    assert r.status_code == 200
    assert D(_fresh(session, Produto, bar["whisky"].id).quantidade) == 9
    assert r.get_json()["estado"]["saldo_aberto_ml"] == 950.0


@pytest.mark.parametrize("corpo, status, trecho", [
    ({"tipo": "venda", "ml": 10}, 400, "Tipo de baixa"),
    ({"tipo": "cortesia", "ml": 0}, 400, "inválido"),
    ({"tipo": "cortesia", "ml": "abc"}, 400, "inválido"),
    ({"tipo": "cortesia", "ml": 99999}, 409, "restam"),
])
def test_baixa_invalida_e_recusada_sem_efeitos(client, session, bar, corpo, status, trecho):
    r = _baixa(client, bar["headers"], bar, **corpo)
    assert r.status_code == status, r.get_json()
    assert trecho in r.get_json()["error"]
    assert GarrafaAberta.query.count() == 0 and D(_fresh(session, Produto, bar["whisky"].id).quantidade) == 10


def test_baixa_em_produto_que_nao_vende_por_dose_e_recusada(client, session, bar):
    r = client.post(f"/api/doses/produto/{bar['refri'].id}/baixa", headers=bar["headers"],
                    json={"tipo": "cortesia", "ml": 50})
    assert r.status_code == 400 and "não está configurado" in r.get_json()["error"]


def _fresh(session, model, pk):
    session.expire_all()
    return session.get(model, pk)


# ── Quem pode: caixa só com o PIN de gerente ────────────────────────────────

def test_caixa_sem_pin_nao_registra_cortesia(client, session, bar, operador):
    _servir(client, bar, 1)
    r = _baixa(client, operador["headers"], bar, tipo="cortesia", ml=50)
    corpo = r.get_json()
    assert r.status_code == 403 and corpo["code"] == "PIN_REQUIRED" and corpo["pin_por_header"] is True
    assert corpo["acao"] == "doses.baixa"
    assert D(_garrafa(bar).saldo_ml) == 950                               # nada saiu


def test_caixa_com_pin_de_gerente_registra_e_a_auditoria_guarda(client, session, bar, operador):
    _servir(client, bar, 1)
    headers = {**operador["headers"], "X-PIN-Autorizacao": PIN}
    r = _baixa(client, headers, bar, tipo="cortesia", ml=50)
    assert r.status_code == 200, r.get_json()
    assert D(_garrafa(bar).saldo_ml) == 900
    mov = DoseMovimento.query.filter_by(tipo="cortesia").one()
    assert mov.funcionario_id == operador["func"].id                       # quem serviu fica no razão, não quem deu o PIN


def test_pin_errado_e_barrado(client, session, bar, operador):
    _servir(client, bar, 1)
    r = _baixa(client, {**operador["headers"], "X-PIN-Autorizacao": "0000"}, bar, tipo="cortesia", ml=50)
    assert r.status_code in (401, 403) and D(_garrafa(bar).saldo_ml) == 950


def test_dono_pode_restringir_a_baixa_so_a_gerente(client, session, bar, operador):
    _servir(client, bar, 1)
    cfg = session.query(Configuracao).filter_by(estabelecimento_id=bar["estab"].id).one()
    cfg.politica_acoes = json.dumps({"doses.baixa": {"niveis": [2], "pin": True}})
    session.commit()
    r = _baixa(client, {**operador["headers"], "X-PIN-Autorizacao": PIN}, bar, tipo="cortesia", ml=50)
    assert r.status_code == 403 and "ACAO_NAO_PERMITIDA" == r.get_json().get("code")


# ── Ajuste por contagem da garrafa aberta ───────────────────────────────────

def test_ajuste_grava_a_diferenca_contra_o_razao(client, session, bar):
    _servir(client, bar, 4)                                               # razão: 800 ml
    g = _garrafa(bar)
    r = client.post(f"/api/doses/garrafas/{g.id}/ajuste", headers=bar["headers"],
                    json={"saldo_fisico_ml": "770,5", "motivo": "Contei com a régua"})
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["diferenca_ml"] == -29.5 and corpo["garrafa"]["saldo_ml"] == 770.5
    assert corpo["resumo"]["ajuste_ml"] == -29.5
    assert ds.ledger_confere(_fresh(session, GarrafaAberta, g.id))


def test_ajuste_a_zero_encerra_a_garrafa_e_acima_do_volume_e_recusado(client, session, bar):
    _servir(client, bar, 1)
    g = _garrafa(bar)
    assert client.post(f"/api/doses/garrafas/{g.id}/ajuste", headers=bar["headers"],
                       json={"saldo_fisico_ml": 1500}).status_code == 400
    r = client.post(f"/api/doses/garrafas/{g.id}/ajuste", headers=bar["headers"], json={"saldo_fisico_ml": 0})
    assert r.status_code == 200 and r.get_json()["garrafa"]["status"] == "vazia"
    assert client.post(f"/api/doses/garrafas/{g.id}/ajuste", headers=bar["headers"],
                       json={"saldo_fisico_ml": 100}).status_code == 400   # garrafa já encerrada


def test_caixa_precisa_do_pin_para_ajustar(client, session, bar, operador):
    _servir(client, bar, 1)
    g = _garrafa(bar)
    r = client.post(f"/api/doses/garrafas/{g.id}/ajuste", headers=operador["headers"], json={"saldo_fisico_ml": 500})
    assert r.status_code == 403 and r.get_json()["acao"] == "doses.ajustar"
    r = client.post(f"/api/doses/garrafas/{g.id}/ajuste", headers={**operador["headers"], "X-PIN-Autorizacao": PIN},
                    json={"saldo_fisico_ml": 500})
    assert r.status_code == 200 and D(_fresh(session, GarrafaAberta, g.id).saldo_ml) == 500


# ── Descarte da garrafa aberta ───────────────────────────────────────────────

def test_descartar_vira_perda_registrada_com_custo(client, session, bar):
    _servir(client, bar, 2)                                               # 900 ml
    g = _garrafa(bar)
    r = client.post(f"/api/doses/garrafas/{g.id}/descartar", headers=bar["headers"], json={"motivo": "Vencida depois de aberta"})
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["perdido_ml"] == 900.0 and corpo["custo"] == 108.0       # 900 ml x 0,12
    assert corpo["garrafa"]["status"] == "descartada" and corpo["resumo"]["descarte_ml"] == 900.0
    assert client.post(f"/api/doses/garrafas/{g.id}/descartar", headers=bar["headers"]).status_code == 400
    # a próxima dose abre outra garrafa
    _servir(client, bar, 1)
    assert GarrafaAberta.query.filter_by(produto_id=bar["whisky"].id).count() == 2


def test_caixa_precisa_do_pin_para_descartar(client, session, bar, operador):
    _servir(client, bar, 1)
    g = _garrafa(bar)
    r = client.post(f"/api/doses/garrafas/{g.id}/descartar", headers=operador["headers"])
    assert r.status_code == 403 and r.get_json()["acao"] == "doses.descartar"
    assert _fresh(session, GarrafaAberta, g.id).status == "aberta"


# ── Isolamento entre lojas ───────────────────────────────────────────────────

def test_outra_loja_nao_mexe_nem_ve(client, session, bar):
    outra = Estabelecimento(nome_fantasia="Outra", razao_social="Outra LTDA", cnpj="98765432000199", email="o@o.sys",
                            telefone="92988887777", data_abertura=date(2024, 1, 1), plano="PREMIUM",
                            vencimento_plano=date(2030, 12, 31), cep="69000-000", logradouro="Rua B", numero="2",
                            bairro="Centro", cidade="Manaus", estado="AM")
    session.add(outra)
    session.flush()
    admin_b = Funcionario(estabelecimento_id=outra.id, nome="Admin B", cpf="99988877766", username="admin_b", role="admin",
                          ativo=True, data_nascimento=date(1990, 1, 1), celular="92999999999", email="b@b.sys",
                          cargo="Gerente", data_admissao=date(2024, 1, 1), salario_base=D(3000))
    admin_b.set_password("industrial-secret")
    admin_b.set_pin("1357")
    session.add(admin_b)
    session.commit()
    _servir(client, bar, 1)
    g = _garrafa(bar)
    hb = _token(admin_b, outra)
    assert client.get(f"/api/doses/garrafas/{g.id}", headers=hb).status_code == 404
    assert client.post(f"/api/doses/garrafas/{g.id}/ajuste", headers=hb, json={"saldo_fisico_ml": 1}).status_code == 404
    assert client.post(f"/api/doses/garrafas/{g.id}/descartar", headers=hb).status_code == 404
    assert client.post(f"/api/doses/garrafas/{g.id}/encerrar", headers=hb).status_code == 404
    assert client.post(f"/api/doses/produto/{bar['whisky'].id}/baixa", headers=hb,
                       json={"tipo": "cortesia", "ml": 10}).status_code == 404
    assert client.get(f"/api/doses/produto/{bar['whisky'].id}/razao", headers=hb).status_code == 404
    assert client.get("/api/doses/vencidas", headers=hb).get_json()["garrafas"] == []
    assert D(_fresh(session, GarrafaAberta, g.id).saldo_ml) == 950


# ── Razão de ml e detalhe da garrafa ─────────────────────────────────────────

def test_razao_mostra_quem_quando_quanto_e_onde(client, session, bar):
    venda_id = _servir(client, bar, 2)
    _baixa(client, bar["headers"], bar, tipo="perda", ml=40, motivo="Quebrou o copo")
    r = client.get(f"/api/doses/produto/{bar['whisky'].id}/razao", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    tipos = [x["tipo"] for x in corpo["razao"]]
    assert tipos == ["perda", "venda", "abertura"]                          # mais recente primeiro
    perda, venda, abertura = corpo["razao"]
    assert perda["ml"] == -40.0 and perda["motivo"] == "Quebrou o copo" and perda["funcionario"] == bar["admin"].nome
    assert venda["ml"] == -100.0 and venda["dose"] == "Dose" and venda["venda"].startswith("V-")
    assert abertura["ml"] == 1000.0 and abertura["custo"] == 120.0
    assert corpo["resumo"]["saldo_aberto_ml"] == 860.0 and corpo["garrafas_abertas"][0]["saldo_ml"] == 860.0
    assert venda_id


def test_detalhe_da_garrafa_traz_resumo_razao_e_confere(client, session, bar):
    _servir(client, bar, 6)                                               # 300 ml vendidos
    _baixa(client, bar["headers"], bar, tipo="cortesia", ml=50)
    g = _garrafa(bar)
    r = client.get(f"/api/doses/garrafas/{g.id}", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["confere"] is True
    assert corpo["resumo"]["vendido_ml"] == 300.0 and corpo["resumo"]["perda_ml"] == 50.0
    assert corpo["resumo"]["rendimento_pct"] == 30.0 and corpo["garrafa"]["saldo_ml"] == 650.0
    assert len(corpo["razao"]) == 3


# ── Validade depois de aberta ────────────────────────────────────────────────

def test_garrafa_vencida_depois_de_aberta_aparece_e_sai_do_saldo_vendavel(client, session, bar):
    bar["whisky"].validade_aberta_dias = 5
    session.commit()
    _servir(client, bar, 1)
    g = _garrafa(bar)
    g.validade_aberta = hoje_local() - timedelta(days=1)
    session.commit()
    lista = client.get("/api/doses/vencidas", headers=bar["headers"]).get_json()["garrafas"]
    assert [x["id"] for x in lista] == [g.id] and lista[0]["produto"] == "WHISKY 1L"
    resumo = ds.resumo_aberto(bar["estab"].id, [bar["whisky"].id])[bar["whisky"].id]
    assert resumo["saldo_aberto_ml"] == 0.0 and resumo["garrafas_abertas"] == 1 and resumo["garrafas_vencidas"] == 1
    assert client.post(f"/api/doses/garrafas/{g.id}/descartar", headers=bar["headers"],
                       json={"motivo": "Vencida"}).status_code == 200
    assert client.get("/api/doses/vencidas", headers=bar["headers"]).get_json()["garrafas"] == []


# ── Card de estoque: garrafa aberta na lista e no hub do produto ─────────────

def test_lista_de_produtos_traz_a_garrafa_aberta_so_de_quem_vende_por_dose(client, session, bar):
    _servir(client, bar, 3)
    r = client.get("/api/produtos/?por_pagina=50", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    produtos = {p["nome"]: p for p in r.get_json()["produtos"]}
    dose = produtos["WHISKY 1L"]["dose"]
    assert dose["saldo_aberto_ml"] == 850.0 and dose["garrafas_abertas"] == 1 and dose["dose_ml_padrao"] == 50.0
    assert dose["doses_na_aberta"] == 17 and produtos["WHISKY 1L"]["quantidade"] == 9.0
    assert "dose" not in produtos["REFRI 2L"]


def test_resumo_aberto_para_produto_sem_garrafa_aberta(session, bar):
    resumo = ds.resumo_aberto(bar["estab"].id, [bar["whisky"].id, bar["refri"].id])
    assert set(resumo) == {bar["whisky"].id}
    assert resumo[bar["whisky"].id]["saldo_aberto_ml"] == 0.0 and resumo[bar["whisky"].id]["garrafas_abertas"] == 0
    assert ds.resumo_aberto(bar["estab"].id, []) == {}


# ── Contagem cíclica: a aberta aparece para contar em ml ─────────────────────

def test_conferir_a_contagem_mostra_a_garrafa_aberta_do_produto_contado(client, session, bar):
    _servir(client, bar, 2)
    aberta = client.post("/api/contagem", headers=bar["headers"],
                         json={"nome": "Bar", "itens": [bar["whisky"].id, bar["refri"].id]})
    assert aberta.status_code == 201, aberta.get_json()
    cid = aberta.get_json()["contagem"]["id"]
    for _ in range(9):                                                      # 9 fechadas na prateleira
        assert client.post(f"/api/contagem/{cid}/bipar", headers=bar["headers"],
                           json={"codigo_barras": "7891234567895"}).status_code == 200
    r = client.get(f"/api/contagem/{cid}/conferir", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    linha = next(x for x in corpo["ok"] + corpo["divergentes"] if x["nome"] == "WHISKY 1L")
    assert linha["divergencia"] == 0.0                                      # 10 - 1 aberta = 9 fechadas: bate
    assert [g["saldo_ml"] for g in linha["garrafas_abertas"]] == [900.0]
    refri = next(x for x in corpo["ok"] + corpo["divergentes"] if x["nome"] == "REFRI 2L")
    assert "garrafas_abertas" not in refri
