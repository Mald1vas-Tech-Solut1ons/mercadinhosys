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
