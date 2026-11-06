"""Produção própria (loja e fábrica de artigos religiosos): ficha técnica, custo, OP e estoque.

Cenário real do estudo: tacho de 50 kg de parafina rende 190 velas de 7 dias (perda 2%),
1 pavio e 1 copo por vela, 120 min de mão de obra por tacho a R$ 15/h.
"""
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    CategoriaProduto, Estabelecimento, Funcionario, MovimentacaoEstoque, Produto, ProdutoLote,
)
from app.models_producao import OrdemProducao


@pytest.fixture
def fab(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Fábrica Velas")
    session.add(cat)
    session.flush()

    def item(nome, qtd, custo, unidade="UN", venda="0"):
        p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome=nome, unidade_medida=unidade,
                    preco_custo=Decimal(custo), preco_venda=Decimal(venda), quantidade=Decimal(qtd),
                    controlar_validade=False)
        session.add(p)
        return p

    parafina = item("PARAFINA 140/145", "100", "12", "KG")
    pavio = item("PAVIO VELA 7 DIAS", "500", "0.20")
    copo = item("COPO VELA 7 DIAS", "300", "0.90")
    vela = item("VELA 7 DIAS BRANCA 260G", "0", "0", venda="12.90")
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id,
                                                                          "role": "ADMIN"})
    return dict(estab=estab, admin=admin, parafina=parafina, pavio=pavio, copo=copo, vela=vela,
                h={"Authorization": f"Bearer {token}"})


def _ficha(client, fab, **extra):
    corpo = {"produto_id": fab["vela"].id, "rendimento": 190, "minutos_mao_de_obra": 120,
             "custo_hora_mao_de_obra": 15, "custo_indireto_percentual": 10, "markup_percentual": 100,
             "itens": [{"insumo_id": fab["parafina"].id, "quantidade": 50, "perda_percentual": 2},
                       {"insumo_id": fab["pavio"].id, "quantidade": 190},
                       {"insumo_id": fab["copo"].id, "quantidade": 190}]}
    corpo.update(extra)
    return client.post("/api/producao/fichas", headers=fab["h"], json=corpo)


def test_ficha_calcula_custo_padrao_preco_sugerido_e_capacidade(client, session, fab):
    r = _ficha(client, fab)
    assert r.status_code == 201, r.get_data(as_text=True)
    ficha = r.get_json()["ficha"]
    custo = ficha["custo"]
    # material: 51 kg x 12 = 612; pavio 38; copo 171 -> 821. MO: 2 h x 15 = 30. Indireto 10% = 85,10.
    assert custo["material_receita"] == 821.0
    assert custo["mao_de_obra_receita"] == 30.0
    assert custo["indireto_receita"] == 85.1
    assert custo["total_receita"] == 936.1
    assert custo["custo_unitario"] == pytest.approx(4.9268, abs=1e-4)
    assert custo["preco_sugerido"] == pytest.approx(9.85, abs=0.01)
    # Gargalo: 100 kg de parafina dão 2 tachos (51 kg cada) = 372 velas; copo 300 limita a 300.
    assert ficha["capacidade"] == {"unidades": 300, "gargalo_id": fab["copo"].id, "gargalo_nome": "COPO VELA 7 DIAS"}
    session.expire_all()
    assert session.get(Produto, fab["vela"].id).papel_producao == "fabricado"


def test_ordem_baixa_insumos_e_entra_vela_com_lote_e_custo_real(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    r = client.post("/api/producao/ordens", headers=fab["h"], json={"ficha_id": ficha_id, "quantidade": 190})
    assert r.status_code == 201, r.get_data(as_text=True)
    op = r.get_json()["ordem"]
    assert op["status"] == "planejada" and op["faltas"] == []
    assert client.post(f"/api/producao/ordens/{op['id']}/iniciar", headers=fab["h"]).status_code == 200

    r = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"], json={
        "quantidade_produzida": 185, "quantidade_refugo": 5, "motivo_refugo": "bolha no envase"})
    assert r.status_code == 200, r.get_data(as_text=True)
    fechada = r.get_json()["ordem"]
    assert fechada["status"] == "encerrada"
    # Refugo não vira estoque; o custo dele recai sobre as 185 boas: 936,10 / 185.
    assert fechada["custo_unitario_real"] == pytest.approx(5.0600, abs=1e-4)

    session.expire_all()
    assert session.get(Produto, fab["parafina"].id).quantidade == Decimal("49")   # 100 - 51
    assert session.get(Produto, fab["pavio"].id).quantidade == Decimal("310")
    assert session.get(Produto, fab["copo"].id).quantidade == Decimal("110")
    vela = session.get(Produto, fab["vela"].id)
    assert vela.quantidade == Decimal("185")
    assert vela.preco_custo == Decimal("5.0600")
    lote = session.get(ProdutoLote, fechada["lote_id"])
    assert lote.numero_lote == fechada["numero"] and lote.quantidade == Decimal("185")
    consumo = session.query(MovimentacaoEstoque).filter_by(produto_id=fab["parafina"].id, tipo="saida").one()
    assert consumo.motivo == f"Consumo {fechada['numero']}" and consumo.venda_id is None
    # Consumo de insumo não conta como venda do insumo.
    assert Decimal(str(session.get(Produto, fab["parafina"].id).quantidade_vendida or 0)) == 0


def test_ordem_sem_insumo_nao_inicia_e_mostra_o_que_falta(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    op = client.post("/api/producao/ordens", headers=fab["h"],
                     json={"ficha_id": ficha_id, "quantidade": 380}).get_json()["ordem"]
    assert {f["insumo_nome"] for f in op["faltas"]} == {"PARAFINA 140/145", "COPO VELA 7 DIAS"}
    r = client.post(f"/api/producao/ordens/{op['id']}/iniciar", headers=fab["h"])
    assert r.status_code == 409
    r = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"],
                    json={"quantidade_produzida": 380})
    assert r.status_code == 409
    session.expire_all()
    # Nada se moveu: tudo ou nada.
    assert session.get(Produto, fab["pavio"].id).quantidade == Decimal("500")
    assert session.get(Produto, fab["vela"].id).quantidade == Decimal("0")
    assert session.get(OrdemProducao, op["id"]).status == "planejada"


def test_refugo_exige_motivo_e_ordem_encerrada_nao_cancela(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    op = client.post("/api/producao/ordens", headers=fab["h"],
                     json={"ficha_id": ficha_id, "quantidade": 190}).get_json()["ordem"]
    r = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"],
                    json={"quantidade_produzida": 180, "quantidade_refugo": 10})
    assert r.status_code == 400 and "motivo" in r.get_json()["error"]
    assert client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"],
                       json={"quantidade_produzida": 190}).status_code == 200
    assert client.post(f"/api/producao/ordens/{op['id']}/cancelar", headers=fab["h"]).status_code == 400


def test_ficha_valida_insumo_repetido_e_o_proprio_produto(client, fab):
    r = _ficha(client, fab, itens=[{"insumo_id": fab["vela"].id, "quantidade": 1}])
    assert r.status_code == 400
    r = _ficha(client, fab, itens=[{"insumo_id": fab["pavio"].id, "quantidade": 1},
                                   {"insumo_id": fab["pavio"].id, "quantidade": 2}])
    assert r.status_code == 400
    assert _ficha(client, fab, rendimento=0).status_code == 400


def test_materia_prima_some_do_pdv(client, session, fab):
    r = client.patch(f"/api/producao/itens/{fab['parafina'].id}/papel", headers=fab["h"],
                     json={"papel": "materia_prima"})
    assert r.status_code == 200
    nomes = [p["nome"] for p in client.get("/api/pdv/catalogo-offline", headers=fab["h"]).get_json().get("produtos", [])]
    assert "PARAFINA 140/145" not in nomes
    assert "COPO VELA 7 DIAS" in nomes


def test_ficha_de_outra_loja_responde_404(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    outra = Estabelecimento(nome_fantasia="Outra Loja", razao_social="Outra Loja LTDA", cnpj="11222333000181",
                            telefone="11999999999", email="outra@example.test", cep="01000000", logradouro="Rua B",
                            numero="2", bairro="Centro", cidade="São Paulo", estado="SP")
    session.add(outra)
    session.flush()
    token = create_access_token(identity=str(fab["admin"].id),
                                additional_claims={"estabelecimento_id": outra.id, "role": "ADMIN"})
    session.commit()
    r = client.get(f"/api/producao/fichas/{ficha_id}", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (403, 404)


def test_cadastro_religioso_nasce_com_departamentos_da_loja():
    from app.routes.onboarding import segmento_e_mix
    segmento, config = segmento_e_mix("religioso")
    assert segmento == "generico" and config["mix_produtos"][0] == "religioso"
    assert segmento_e_mix("roupas") == ("vestuario", {})
    assert segmento_e_mix(None) == ("mercearia", {})


def test_necessidade_de_compra_soma_ordens_abertas_menos_estoque(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    for qtd in (190, 190):  # 2 tachos: 102 kg de parafina, 380 copos
        client.post("/api/producao/ordens", headers=fab["h"], json={"ficha_id": ficha_id, "quantidade": qtd})
    r = client.get("/api/producao/necessidade-insumos", headers=fab["h"])
    assert r.status_code == 200
    por_nome = {i["insumo_nome"]: i for i in r.get_json()["insumos"]}
    assert por_nome["PARAFINA 140/145"]["comprar"] == 2.0      # 102 - 100
    assert por_nome["COPO VELA 7 DIAS"]["comprar"] == 80.0     # 380 - 300
    assert por_nome["PAVIO VELA 7 DIAS"]["comprar"] == 0.0     # 380 <= 500
    assert len(por_nome["COPO VELA 7 DIAS"]["ordens"]) == 2


def test_cadastro_loja_que_vende_de_tudo_soma_os_departamentos():
    from app.routes.onboarding import segmento_e_mix
    segmento, config = segmento_e_mix(["religioso", "motopecas", "autopecas", "outro"])
    mix = config["mix_produtos"]
    assert segmento == "generico"
    for familia in ("religioso", "bazar", "motopecas", "autopecas", "servico", "alimento"):
        assert familia in mix
    assert len(mix) == len(set(mix))
    assert segmento_e_mix(["inexistente"]) == ("mercearia", {})


# ── Produção profissional: unidade, níveis, grade, versões, parcial e estorno ──

def test_receita_em_gramas_converte_para_o_estoque_em_kg(client, session, fab):
    r = _ficha(client, fab, itens=[{"insumo_id": fab["parafina"].id, "quantidade": 270, "unidade": "g"},
                                   {"insumo_id": fab["pavio"].id, "quantidade": 1},
                                   {"insumo_id": fab["copo"].id, "quantidade": 1}], rendimento=1,
               minutos_mao_de_obra=0, custo_indireto_percentual=0)
    assert r.status_code == 201, r.get_data(as_text=True)
    item = next(i for i in r.get_json()["ficha"]["itens"] if i["insumo_id"] == fab["parafina"].id)
    assert item["quantidade"] == 0.27 and item["quantidade_receita"] == 270 and item["unidade_receita"] == "g"
    assert item["unidades"][0] == "kg" and "g" in item["unidades"]
    # 0,27 kg x 12 + 0,20 + 0,90 = 4,34
    assert r.get_json()["ficha"]["custo"]["custo_unitario"] == pytest.approx(4.34, abs=1e-4)
    # Unidade de outra família é recusada (g num insumo em unidade).
    r = client.post("/api/producao/fichas", headers=fab["h"], json={
        "produto_id": fab["copo"].id, "rendimento": 1, "itens": [{"insumo_id": fab["pavio"].id, "quantidade": 3, "unidade": "g"}]})
    assert r.status_code == 400 and "converter" in r.get_json()["error"]


def test_semiacabado_explode_na_necessidade_e_ciclo_e_recusado(client, session, fab):
    estab = fab["estab"]
    base = Produto(estabelecimento_id=estab.id, categoria_id=fab["parafina"].categoria_id, nome="BASE CERA TINGIDA", unidade_medida="KG",
                   preco_custo=Decimal("0"), preco_venda=Decimal("0"), quantidade=Decimal("0"),
                   controlar_validade=False)
    session.add(base)
    session.commit()
    # Base: 10 kg de parafina rendem 10 kg de base.
    r = client.post("/api/producao/fichas", headers=fab["h"], json={
        "produto_id": base.id, "rendimento": 10, "itens": [{"insumo_id": fab["parafina"].id, "quantidade": 10}]})
    assert r.status_code == 201, r.get_data(as_text=True)
    # Vela usa a base (semiacabado) em vez da parafina.
    r = _ficha(client, fab, itens=[{"insumo_id": base.id, "quantidade": 50},
                                   {"insumo_id": fab["copo"].id, "quantidade": 190}])
    assert r.status_code == 201
    ficha_vela = r.get_json()["ficha"]["id"]
    # Ciclo: a base não pode levar a vela.
    r = client.put(f"/api/producao/fichas/{_id_ficha(client, fab, base.id)}", headers=fab["h"], json={
        "rendimento": 10, "itens": [{"insumo_id": fab["vela"].id, "quantidade": 1}]})
    assert r.status_code == 400 and "círculo" in r.get_json()["error"]

    client.post("/api/producao/ordens", headers=fab["h"], json={"ficha_id": ficha_vela, "quantidade": 380})
    por_nome = {i["insumo_nome"]: i for i in client.get("/api/producao/necessidade-insumos",
                                                         headers=fab["h"]).get_json()["insumos"]}
    assert por_nome["BASE CERA TINGIDA"]["acao"] == "produzir"
    assert por_nome["BASE CERA TINGIDA"]["produzir"] == 100.0           # 2 x 50 kg, estoque 0
    assert por_nome["PARAFINA 140/145"]["acao"] == "comprar"
    assert por_nome["PARAFINA 140/145"]["previsto_ordens"] == 100.0     # explodiu da base
    assert por_nome["PARAFINA 140/145"]["comprar"] == 0.0               # tem 100 kg
    assert por_nome["COPO VELA 7 DIAS"]["comprar"] == 80.0


def _id_ficha(client, fab, produto_id):
    return next(f["id"] for f in client.get("/api/producao/fichas", headers=fab["h"]).get_json()["fichas"]
                if f["produto_id"] == produto_id)


def test_ficha_guarda_versoes_e_ordem_grava_a_versao(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    r = client.put(f"/api/producao/fichas/{ficha_id}", headers=fab["h"], json={
        "rendimento": 200, "itens": [{"insumo_id": fab["parafina"].id, "quantidade": 50},
                                     {"insumo_id": fab["copo"].id, "quantidade": 200}]})
    assert r.status_code == 200 and r.get_json()["ficha"]["versao"] == 2
    versoes = client.get(f"/api/producao/fichas/{ficha_id}/versoes", headers=fab["h"]).get_json()["versoes"]
    assert [v["versao"] for v in versoes] == [2, 1]
    assert versoes[1]["rendimento"] == 190 and len(versoes[1]["itens"]) == 3
    op = client.post("/api/producao/ordens", headers=fab["h"], json={"ficha_id": ficha_id, "quantidade": 10}).get_json()
    assert op["ordem"]["ficha_versao"] == 2


def test_copiar_ficha_para_variacoes_da_grade(client, session, fab):
    estab = fab["estab"]
    modelo = Produto(estabelecimento_id=estab.id, categoria_id=fab["parafina"].categoria_id, nome="IMAGEM SÃO JORGE", unidade_medida="UN", eh_grade_modelo=True,
                     preco_custo=Decimal("0"), preco_venda=Decimal("0"), quantidade=Decimal("0"), controlar_validade=False)
    session.add(modelo)
    session.flush()
    tamanhos = []
    for t in ("20CM", "30CM", "40CM"):
        p = Produto(estabelecimento_id=estab.id, categoria_id=modelo.categoria_id, nome=f"IMAGEM SÃO JORGE {t}", unidade_medida="UN",
                    produto_pai_id=modelo.id, preco_custo=Decimal("0"), preco_venda=Decimal("0"),
                    quantidade=Decimal("0"), controlar_validade=False)
        session.add(p)
        tamanhos.append(p)
    session.commit()
    # O modelo da grade não tem ficha: cada variação tem a sua.
    r = client.post("/api/producao/fichas", headers=fab["h"], json={
        "produto_id": modelo.id, "rendimento": 1, "itens": [{"insumo_id": fab["parafina"].id, "quantidade": 1}]})
    assert r.status_code == 400
    r = client.post("/api/producao/fichas", headers=fab["h"], json={
        "produto_id": tamanhos[0].id, "rendimento": 1, "itens": [{"insumo_id": fab["parafina"].id, "quantidade": 500, "unidade": "g"}]})
    ficha_id = r.get_json()["ficha"]["id"]
    irmas = client.get(f"/api/producao/itens?pai={modelo.id}", headers=fab["h"]).get_json()["itens"]
    assert len(irmas) == 3
    r = client.post(f"/api/producao/fichas/{ficha_id}/copiar", headers=fab["h"],
                    json={"produto_ids": [p["id"] for p in irmas]})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert len(r.get_json()["criadas"]) == 2 and r.get_json()["ignoradas"] == []
    copia = r.get_json()["criadas"][0]["itens"][0]
    assert copia["quantidade_receita"] == 500 and copia["unidade_receita"] == "g" and copia["quantidade"] == 0.5


def test_apontamento_parcial_e_final_com_lotes_proprios(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    op = client.post("/api/producao/ordens", headers=fab["h"], json={"ficha_id": ficha_id, "quantidade": 190}).get_json()["ordem"]
    # Primeira fornada: 95 boas (metade) -> consome metade do previsto.
    r = client.post(f"/api/producao/ordens/{op['id']}/apontar", headers=fab["h"], json={"quantidade_produzida": 95})
    assert r.status_code == 200, r.get_data(as_text=True)
    parcial = r.get_json()["ordem"]
    assert parcial["status"] == "em_producao" and parcial["quantidade_produzida"] == 95
    session.expire_all()
    assert session.get(Produto, fab["parafina"].id).quantidade == Decimal("74.5")    # 100 - 25,5
    assert session.get(Produto, fab["vela"].id).quantidade == Decimal("95")
    # Final: o resto do previsto, 90 boas + 5 refugo.
    r = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"], json={
        "quantidade_produzida": 90, "quantidade_refugo": 5, "motivo_refugo": "bolha"})
    assert r.status_code == 200, r.get_data(as_text=True)
    fim = r.get_json()["ordem"]
    assert fim["status"] == "encerrada" and fim["quantidade_produzida"] == 185
    assert [a["sequencia"] for a in fim["apontamentos"]] == [1, 2]
    # Total igual ao fechamento de uma vez: 936,10 / 185.
    assert fim["custo_unitario_real"] == pytest.approx(5.06, abs=1e-3)
    session.expire_all()
    assert session.get(Produto, fab["parafina"].id).quantidade == Decimal("49")
    lotes = session.query(ProdutoLote).filter_by(produto_id=fab["vela"].id).order_by(ProdutoLote.id).all()
    assert [l.numero_lote for l in lotes] == [fim["numero"], f"{fim['numero']}-2"]


def test_estorno_devolve_insumos_e_tira_o_acabado(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    op = client.post("/api/producao/ordens", headers=fab["h"], json={"ficha_id": ficha_id, "quantidade": 190}).get_json()["ordem"]
    assert client.post(f"/api/producao/ordens/{op['id']}/apontar", headers=fab["h"],
                       json={"quantidade_produzida": 95}).status_code == 200
    # Com apontamento, cancelar não vale: tem que estornar.
    assert client.post(f"/api/producao/ordens/{op['id']}/cancelar", headers=fab["h"]).status_code == 400
    assert client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"],
                       json={"quantidade_produzida": 95}).status_code == 200
    session.get(Funcionario, fab["admin"].id).set_pin("4321")
    session.commit()
    r = client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"],
                    json={"pin": "4321", "motivo": "receita errada"})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["ordem"]["status"] == "estornada"
    session.expire_all()
    assert session.get(Produto, fab["parafina"].id).quantidade == Decimal("100")
    assert session.get(Produto, fab["pavio"].id).quantidade == Decimal("500")
    assert session.get(Produto, fab["copo"].id).quantidade == Decimal("300")
    assert session.get(Produto, fab["parafina"].id).preco_custo == Decimal("12")
    vela = session.get(Produto, fab["vela"].id)
    assert vela.quantidade == Decimal("0")
    assert all(l.quantidade == 0 and not l.ativo for l in session.query(ProdutoLote).filter_by(produto_id=vela.id))
    # Estornar de novo não move nada.
    assert client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"],
                       json={"pin": "4321", "motivo": "de novo por engano"}).status_code == 400


def test_estorno_bloqueia_quando_o_acabado_ja_saiu(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    op = client.post("/api/producao/ordens", headers=fab["h"], json={"ficha_id": ficha_id, "quantidade": 190}).get_json()["ordem"]
    fechada = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"],
                          json={"quantidade_produzida": 190}).get_json()["ordem"]
    lote = session.get(ProdutoLote, fechada["lote_id"])
    vela = session.get(Produto, fab["vela"].id)
    lote.quantidade = Decimal("180")   # 10 vendidas
    vela.quantidade = Decimal("180")
    session.get(Funcionario, fab["admin"].id).set_pin("4321")
    session.commit()
    r = client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"],
                    json={"pin": "4321", "motivo": "apontei errado"})
    assert r.status_code == 400 and "já saíram" in r.get_json()["error"]
    session.expire_all()
    assert session.get(Produto, fab["parafina"].id).quantidade == Decimal("49")   # nada voltou
    assert session.get(OrdemProducao, op["id"]).status == "encerrada"


def test_plano_gratis_nao_usa_a_api_de_producao(client, session, fab):
    fab["estab"].plano = "Gratuito"
    session.commit()
    r = client.get("/api/producao/fichas", headers=fab["h"])
    assert r.status_code == 403 and r.get_json()["code"] == "PLAN_RESTRICTED"


# ── Exigências de fábrica (auditoria "sou fabricante, o que preciso achar?") ──

def _op(client, fab, ficha_id, qtd=190):
    return client.post("/api/producao/ordens", headers=fab["h"],
                       json={"ficha_id": ficha_id, "quantidade": qtd}).get_json()["ordem"]


def test_ficha_multinivel_recusa_receita_em_circulo(client, session, fab):
    base = Produto(estabelecimento_id=fab["estab"].id, categoria_id=fab["vela"].categoria_id, nome="BASE PERFUMADA", unidade_medida="KG",
                   preco_custo=Decimal("0"), preco_venda=Decimal("0"), quantidade=Decimal("0"))
    session.add(base)
    session.commit()
    r = client.post("/api/producao/fichas", headers=fab["h"], json={
        "produto_id": base.id, "rendimento": 10, "itens": [{"insumo_id": fab["parafina"].id, "quantidade": 10}]})
    assert r.status_code == 201
    ficha_base = r.get_json()["ficha"]["id"]
    # Vela usa a base (semiacabado): ok.
    assert _ficha(client, fab, itens=[{"insumo_id": base.id, "quantidade": 50}]).status_code == 201
    # Base passar a usar vela fecharia o círculo base -> vela -> base.
    r = client.put(f"/api/producao/fichas/{ficha_base}", headers=fab["h"], json={
        "rendimento": 10, "itens": [{"insumo_id": fab["vela"].id, "quantidade": 1}]})
    assert r.status_code == 400 and "círculo" in r.get_json()["error"]


def test_ordem_em_producao_segura_o_insumo_dela(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    op1, op2 = _op(client, fab, ficha_id), _op(client, fab, ficha_id)
    assert client.post(f"/api/producao/ordens/{op1['id']}/iniciar", headers=fab["h"]).status_code == 200
    # Sobram 49 kg de parafina e 110 copos livres: a segunda ordem não pode contar com o material da primeira.
    r = client.post(f"/api/producao/ordens/{op2['id']}/iniciar", headers=fab["h"])
    assert r.status_code == 409
    assert {f["insumo_nome"] for f in r.get_json()["faltas"]} == {"PARAFINA 140/145", "COPO VELA 7 DIAS"}
    r = client.post(f"/api/producao/ordens/{op2['id']}/encerrar", headers=fab["h"], json={"quantidade_produzida": 190})
    assert r.status_code == 409
    # Capacidade mostra só o que está livre: 110 copos.
    ficha = client.get(f"/api/producao/fichas/{ficha_id}", headers=fab["h"]).get_json()["ficha"]
    assert ficha["capacidade"]["unidades"] == 110
    # A primeira encerra normalmente.
    assert client.post(f"/api/producao/ordens/{op1['id']}/encerrar", headers=fab["h"],
                       json={"quantidade_produzida": 190}).status_code == 200


def _encerrada(client, fab, **extra):
    ficha_id = _ficha(client, fab, **extra).get_json()["ficha"]["id"]
    op = _op(client, fab, ficha_id)
    r = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"], json={
        "quantidade_produzida": 185, "quantidade_refugo": 5, "motivo_refugo": "bolha no envase"})
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()["ordem"]


def test_estorno_de_ordem_encerrada_devolve_tudo_com_pin(client, session, fab):
    from app.models import Auditoria
    op = _encerrada(client, fab)
    r = client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"], json={"motivo": "apontei errado"})
    assert r.status_code == 403  # sem PIN
    admin = session.get(Funcionario, fab["admin"].id)
    admin.set_pin("4321")
    session.commit()
    r = client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"], json={"pin": "4321", "motivo": "x"})
    assert r.status_code == 400 and "motivo" in r.get_json()["error"]
    r = client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"],
                    json={"pin": "4321", "motivo": "apontei 185, eram 150"})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["ordem"]["status"] == "estornada"
    session.expire_all()
    assert session.get(Produto, fab["parafina"].id).quantidade == Decimal("100")
    assert session.get(Produto, fab["pavio"].id).quantidade == Decimal("500")
    assert session.get(Produto, fab["copo"].id).quantidade == Decimal("300")
    assert session.get(Produto, fab["parafina"].id).preco_custo == Decimal("12.0000")
    assert session.get(Produto, fab["vela"].id).quantidade == Decimal("0")
    lote = session.get(ProdutoLote, op["lote_id"])
    assert lote.quantidade == 0 and lote.ativo is False
    assert session.query(Auditoria).filter_by(tipo_evento="producao_estorno").count() == 1
    # Não estorna duas vezes.
    r = client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"],
                    json={"pin": "4321", "motivo": "de novo por engano"})
    assert r.status_code == 400


def test_estorno_recusado_quando_o_lote_ja_vendeu(client, session, fab):
    from app.services import estoque_service
    op = _encerrada(client, fab)
    vela = session.get(Produto, fab["vela"].id)
    estoque_service.registrar_saida(vela, 3, venda_id=None, funcionario_id=fab["admin"].id, motivo="Venda balcão")
    admin = session.get(Funcionario, fab["admin"].id)
    admin.set_pin("4321")
    session.commit()
    r = client.post(f"/api/producao/ordens/{op['id']}/estornar", headers=fab["h"],
                    json={"pin": "4321", "motivo": "apontei errado"})
    assert r.status_code == 400 and "já saíram" in r.get_json()["error"]
    session.expire_all()
    assert session.get(Produto, fab["parafina"].id).quantidade == Decimal("49")  # nada voltou


def test_validade_do_lote_vem_do_prazo_da_ficha(client, session, fab):
    from datetime import timedelta
    from app.utils.timezone import hoje_local
    vela = session.get(Produto, fab["vela"].id)
    vela.controlar_validade = True
    session.commit()
    ficha_id = _ficha(client, fab, validade_dias=180).get_json()["ficha"]["id"]
    op = _op(client, fab, ficha_id)
    r = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"],
                    json={"quantidade_produzida": 10, "data_validade": "2020-01-01"})
    assert r.status_code == 400 and "anterior a hoje" in r.get_json()["error"]
    r = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"], json={"quantidade_produzida": 190})
    assert r.status_code == 200
    fechada = r.get_json()["ordem"]
    assert fechada["lote_validade"] == (hoje_local() + timedelta(days=180)).isoformat()
    assert fechada["lote_numero"] == fechada["numero"]
    assert fechada["variacao_custo_percentual"] == 0.0


def test_rastreio_do_lote_para_tras_e_para_frente(client, session, fab):
    from datetime import date
    lote_parafina = ProdutoLote(estabelecimento_id=fab["estab"].id, produto_id=fab["parafina"].id,
                                numero_lote="PAR-2026-11", quantidade=Decimal("100"), quantidade_inicial=Decimal("100"),
                                data_validade=date(2030, 1, 1), preco_custo_unitario=Decimal("12"), ativo=True)
    session.add(lote_parafina)
    session.commit()
    op = _encerrada(client, fab)
    r = client.get(f"/api/producao/rastreio/lote/{op['lote_id']}", headers=fab["h"])
    assert r.status_code == 200
    corpo = r.get_json()
    assert corpo["produzido_por"]["numero"] == op["numero"]
    parafina = next(i for i in corpo["produzido_por"]["insumos"] if i["insumo_nome"] == "PARAFINA 140/145")
    assert parafina["lotes"][0]["numero_lote"] == "PAR-2026-11" and parafina["lotes"][0]["quantidade_usada"] == 51.0
    # Recall do insumo: o lote de parafina foi parar na ordem e no lote de vela.
    r = client.get(f"/api/producao/rastreio/lote/{lote_parafina.id}", headers=fab["h"])
    usado = r.get_json()["usado_em"]
    assert usado[0]["numero"] == op["numero"] and usado[0]["lote_produzido"]["lote_id"] == op["lote_id"]
    lotes = client.get("/api/producao/lotes?busca=PAR-2026", headers=fab["h"]).get_json()["lotes"]
    assert lotes[0]["numero_lote"] == "PAR-2026-11"


def test_nfce_de_produto_fabricado_sai_com_cfop_5101(session, fab):
    from app.services.fiscal.emissao_service import _tributacao_item
    estab = fab["estab"]
    vela = session.get(Produto, fab["vela"].id)
    pavio = session.get(Produto, fab["pavio"].id)
    vela.papel_producao = "fabricado"
    assert _tributacao_item(vela, estab)["cfop"] == "5101"
    assert _tributacao_item(pavio, estab)["cfop"] == "5102"   # revenda continua 5102
    vela.cfop_padrao = "5103"
    assert _tributacao_item(vela, estab)["cfop"] == "5103"    # escolha manual respeitada


def test_rastreio_de_cada_entrega_parcial(client, session, fab):
    ficha_id = _ficha(client, fab).get_json()["ficha"]["id"]
    op = _op(client, fab, ficha_id)
    client.post(f"/api/producao/ordens/{op['id']}/apontar", headers=fab["h"], json={"quantidade_produzida": 95})
    fim = client.post(f"/api/producao/ordens/{op['id']}/encerrar", headers=fab["h"],
                      json={"quantidade_produzida": 95}).get_json()["ordem"]
    segundo = next(l for l in session.query(ProdutoLote).filter_by(produto_id=fab["vela"].id)
                   if l.numero_lote.endswith("-2"))
    corpo = client.get(f"/api/producao/rastreio/lote/{segundo.id}", headers=fab["h"]).get_json()
    assert corpo["produzido_por"]["numero"] == fim["numero"] and corpo["produzido_por"]["entrega"] == 2
    parafina = next(i for i in corpo["produzido_por"]["insumos"] if i["insumo_nome"] == "PARAFINA 140/145")
    assert parafina["quantidade_consumida"] == 25.5   # a segunda metade do tacho
