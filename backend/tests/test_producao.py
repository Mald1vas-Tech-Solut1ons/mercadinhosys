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
