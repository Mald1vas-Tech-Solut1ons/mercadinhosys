"""Venda por dose (WP6): métricas do dashboard, perdas no DRE e alertas, tudo de `services/dose_metricas.py`.

Cenário do `test_dose_vendas`: whisky de 1 L (custo R$ 120 = R$ 0,12/ml), dose de 50 ml a R$ 18.
"""
from datetime import timedelta

from app.models import Configuracao
from app.models_dose import GarrafaAberta
from app.services import dose_metricas as dm
from app.services import dose_service as ds
from app.utils.timezone import hoje_local

from test_dose_vendas import D, _item, _pdv, bar  # noqa: F401  (fixture do bar)


def _vender(client, bar, doses=2):
    r = _pdv(client, bar, [_item(bar["whisky"], doses, 18, bar["dose50"])])
    assert r.status_code in (200, 201), r.get_json()


def _periodo():
    hoje = hoje_local()
    return hoje - timedelta(days=1), hoje + timedelta(days=1)


def _metricas(bar):
    ini, fim = _periodo()
    return dm.metricas(bar["estab"].id, ini, fim)


def _aberta(bar):
    return GarrafaAberta.query.filter_by(produto_id=bar["whisky"].id, status="aberta").one()


def test_vendas_de_dose_somam_doses_ml_receita_custo_e_garrafas(client, session, bar):
    _vender(client, bar, 4)
    m = _metricas(bar)
    r = m["resumo"]
    assert r["doses"] == 4 and r["ml"] == 200 and r["receita"] == 72 and r["custo"] == 24
    assert r["margem"] == 48 and r["margem_pct"] == 66.7 and r["garrafas_equivalentes"] == 0.2
    [linha] = m["produtos"]
    assert linha["produto_id"] == bar["whisky"].id and linha["receita_por_garrafa"] == 360.0
    assert linha["preco_garrafa"] == 150.0                      # dose rende mais que a garrafa fechada
    assert m["abertas"]["quantidade"] == 1 and m["abertas"]["saldo_ml"] == 800
    assert m["abertas"]["valor_custo"] == 96.0                  # 800 ml x 0,12


def test_venda_cancelada_nao_entra_nas_metricas(client, session, bar):
    from test_dose_vendas import _cancelar, _venda_id
    r = _pdv(client, bar, [_item(bar["whisky"], 2, 18, bar["dose50"])])
    assert _cancelar(client, bar, _venda_id(r)).status_code == 200
    assert _metricas(bar)["resumo"]["doses"] == 0


def test_perda_vira_custo_em_reais_por_tipo_e_por_funcionario(client, session, bar):
    _vender(client, bar, 2)
    ds.baixar_ml(bar["whisky"], 100, "perda", funcionario_id=bar["admin"].id, motivo="Derramou")
    ds.baixar_ml(bar["whisky"], 50, "cortesia", funcionario_id=bar["admin"].id)
    session.commit()
    m = _metricas(bar)
    por_tipo = {t["tipo"]: t for t in m["perdas"]["por_tipo"]}
    assert por_tipo["perda"]["custo"] == 12.0 and por_tipo["cortesia"]["custo"] == 6.0
    assert m["perdas"]["total"] == 18.0 and m["resumo"]["perdas_custo"] == 18.0
    assert m["resumo"]["margem_liquida"] == round(36 - 12 - 18, 2)
    assert m["por_funcionario"][0]["custo"] == 18.0


def test_ajuste_negativo_conta_como_perda_e_positivo_abate(client, session, bar):
    _vender(client, bar, 2)
    garrafa = _aberta(bar)
    ds.ajustar_saldo(garrafa.id, bar["estab"].id, 880, funcionario_id=bar["admin"].id)      # 900 -> 880: faltam 20 ml
    session.commit()
    assert dm.custo_perdas_total(bar["estab"].id, *_periodo()) == 2.4
    ds.ajustar_saldo(garrafa.id, bar["estab"].id, 890, funcionario_id=bar["admin"].id)      # sobrou 10 ml: abate 1,2
    session.commit()
    assert dm.custo_perdas_total(bar["estab"].id, *_periodo()) == 1.2


def test_rendimento_so_existe_para_garrafa_encerrada_e_o_desvio_aparece(client, session, bar):
    _vender(client, bar, 10)                                    # 500 ml vendidos
    sem = _metricas(bar)
    assert sem["resumo"]["rendimento_pct"] is None
    assert any(a["tipo"] == "sem_garrafa_encerrada" for a in sem["alertas"])
    _, desvio = ds.encerrar_garrafa(_aberta(bar).id, bar["estab"].id, funcionario_id=bar["admin"].id)
    session.commit()
    assert desvio == 500                                        # a garrafa acabou: 500 ml sem venda registrada
    m = _metricas(bar)
    assert m["resumo"]["rendimento_pct"] == 50.0 and m["resumo"]["garrafas_encerradas"] == 1
    [linha] = m["produtos"]
    assert linha["rendimento_pct"] == 50.0 and linha["desvio_ml"] == 500.0
    assert m["perdas"]["por_tipo"][0]["tipo"] == "desvio" and m["perdas"]["total"] == 60.0   # 500 ml x 0,12


def test_alerta_de_rendimento_baixo_so_com_limite_definido(client, session, bar):
    _vender(client, bar, 10)
    ds.encerrar_garrafa(_aberta(bar).id, bar["estab"].id, funcionario_id=bar["admin"].id)
    session.commit()
    assert not any(a["tipo"] == "rendimento_baixo" for a in _metricas(bar)["alertas"])
    cfg = Configuracao.query.filter_by(estabelecimento_id=bar["estab"].id).first()
    cfg.alerta_rendimento_pct = D(90)
    session.commit()
    alerta = [a for a in _metricas(bar)["alertas"] if a["tipo"] == "rendimento_baixo"]
    assert alerta and "50" in alerta[0]["titulo"] and "90" in alerta[0]["descricao"]


def test_alerta_de_garrafa_aberta_velha_e_vencida(client, session, bar):
    _vender(client, bar, 2)
    garrafa = _aberta(bar)
    garrafa.aberta_em = garrafa.aberta_em - timedelta(days=9)
    cfg = Configuracao.query.filter_by(estabelecimento_id=bar["estab"].id).first()
    cfg.alerta_garrafa_aberta_dias = 5
    session.commit()
    [velha] = [a for a in _metricas(bar)["alertas"] if a["tipo"] == "garrafa_aberta_velha"]
    assert "9 dias" in velha["titulo"] and velha["produto_id"] == bar["whisky"].id
    garrafa.validade_aberta = hoje_local() - timedelta(days=1)
    session.commit()
    tipos = [a["tipo"] for a in _metricas(bar)["alertas"]]
    assert "garrafa_vencida" in tipos and "garrafa_aberta_velha" not in tipos


def test_alerta_de_margem_abaixo_da_meta(client, session, bar):
    cfg = Configuracao.query.filter_by(estabelecimento_id=bar["estab"].id).first()
    cfg.margem_alvo_dose_pct = D(70)                            # whisky: 18 vs custo 6 = 66,7% < 70%
    session.commit()
    alertas = dm.alertas_da_loja(bar["estab"].id)
    assert any(a["tipo"] == "margem_dose_baixa" and a["produto_id"] == bar["whisky"].id for a in alertas)
    assert not any(a.get("produto_id") == bar["vodka"].id for a in alertas if a["tipo"] == "margem_dose_baixa")


def test_cobertura_em_doses_e_dias(client, session, bar):
    _vender(client, bar, 4)                                     # 200 ml em 3 dias (ontem a amanhã) = 66,67 ml/dia
    [linha] = _metricas(bar)["produtos"]
    # 9 garrafas fechadas (9000 ml) + 800 ml abertos = 9800 ml; 9800 / 66,67 = 147 dias; 9800 / 50 = 196 doses
    assert linha["cobertura_dias"] == 147.0 and linha["cobertura_doses"] == 196


def test_rota_do_dashboard_responde_para_gerente_e_exporta_csv(client, session, bar):
    _vender(client, bar, 2)
    r = client.get("/api/dashboard/doses?days=7", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    dados = r.get_json()["data"]
    assert dados["resumo"]["doses"] == 2 and dados["produtos"][0]["produto"] == "WHISKY 1L"
    csv = client.get("/api/dashboard/doses?days=7&formato=csv", headers=bar["headers"])
    assert csv.status_code == 200 and csv.mimetype == "text/csv"
    texto = csv.get_data(as_text=True)
    assert texto.startswith("﻿Produto;Doses") and "WHISKY 1L" in texto
    assert client.get("/api/dashboard/doses?de=ontem&ate=hoje", headers=bar["headers"]).status_code == 400


def test_alertas_do_painel_incluem_doses_no_formato_do_alertspanel(client, session, bar):
    _vender(client, bar, 2)
    _aberta(bar).validade_aberta = hoje_local() - timedelta(days=1)
    session.commit()
    r = client.get("/api/dashboard/alertas", headers=bar["headers"])
    assert r.status_code == 200
    doses = [a for a in r.get_json()["alertas"] if a["tipo"] == "dose"]
    assert doses and doses[0]["produto_id"] == bar["whisky"].id and doses[0]["subtipo"] == "garrafa_vencida"
    assert "vencida" in doses[0]["produto_nome"]


def test_dre_desconta_a_perda_de_dose_do_lucro_liquido(client, session, bar):
    _vender(client, bar, 2)
    ini, fim = _periodo()
    url = f"/api/despesas/resumo-financeiro/?data_inicio={ini.isoformat()}&data_fim={fim.isoformat()}"
    antes = client.get(url, headers=bar["headers"])
    assert antes.status_code == 200, antes.get_json()
    dre0 = antes.get_json()["dre_consolidado"]
    assert dre0["perdas_estoque_dose"] == 0
    ds.baixar_ml(bar["whisky"], 100, "perda", funcionario_id=bar["admin"].id, motivo="Derramou")
    session.commit()
    dre1 = client.get(url, headers=bar["headers"]).get_json()["dre_consolidado"]
    assert dre1["perdas_estoque_dose"] == 12.0
    assert round(dre0["lucro_liquido"] - dre1["lucro_liquido"], 2) == 12.0
    assert dre1["lucro_bruto"] == dre0["lucro_bruto"]            # o CMV não muda: perda é linha própria
