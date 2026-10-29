"""Ponto com hora oficial do servidor, marcações em ordem e faltas só de quem controla ponto.

A hora do aparelho não vale como marcação (ponto retroativo fabricava hora extra paga),
sair tarde para o almoço não é atraso e o dono/loja sem ponto não acumulam faltas.
"""
from datetime import date, datetime, time, timedelta

import pytest
from flask_jwt_extended import create_access_token

from app.models import ConfiguracaoHorario, Estabelecimento, Funcionario, RegistroPonto
from app.routes import ponto as ponto_routes


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    caixa = Funcionario(estabelecimento_id=estab.id, nome="Operadora Ponto", cpf="98765432100", username="op_ponto",
                        role="caixa", ativo=True, data_nascimento=date(1995, 1, 1), celular="92988887777",
                        email="op_ponto@mercadinho.sys", cargo="Caixa", data_admissao=date(2024, 1, 1),
                        salario_base=2200)
    caixa.set_password("senha-de-teste")
    session.add_all([caixa, ConfiguracaoHorario(estabelecimento_id=estab.id, exigir_foto=False,
                                                exigir_localizacao=False)])
    session.commit()

    def headers(func):
        token = create_access_token(identity=str(func.id), additional_claims={
            "estabelecimento_id": estab.id, "role": func.role})
        return {"Authorization": f"Bearer {token}"}
    return dict(estab=estab, admin=admin, caixa=caixa, h_admin=headers(admin), h_caixa=headers(caixa))


def _relogio(monkeypatch, quando):
    monkeypatch.setattr(ponto_routes, "_agora_loja", lambda funcionario: quando)


def _bater(client, h, tipo, **extra):
    return client.post("/api/ponto/registrar", headers=h, json={"tipo_registro": tipo, **extra})


def test_hora_do_aparelho_nao_vira_marcacao(client, session, ctx, monkeypatch):
    oficial = datetime(2026, 10, 29, 8, 2)
    _relogio(monkeypatch, oficial)
    r = _bater(client, ctx["h_admin"], "entrada", data_local="2026-10-01", hora_local="06:00")
    assert r.status_code == 201, r.get_json()
    reg = session.query(RegistroPonto).one()
    assert (reg.data, reg.hora.replace(second=0, microsecond=0)) == (oficial.date(), time(8, 2))
    assert "divergia" in reg.observacao


def test_relogio_do_aparelho_dentro_da_tolerancia_nao_anota(client, session, ctx, monkeypatch):
    _relogio(monkeypatch, datetime(2026, 10, 29, 8, 0))
    assert _bater(client, ctx["h_admin"], "entrada", data_local="2026-10-29", hora_local="08:03").status_code == 201
    assert not session.query(RegistroPonto).one().observacao


def test_hora_extra_nao_e_fabricada_pelo_aparelho(client, ctx, monkeypatch):
    _relogio(monkeypatch, datetime(2026, 10, 1, 8, 0))
    _bater(client, ctx["h_admin"], "entrada", data_local="2026-10-01", hora_local="06:00")
    _relogio(monkeypatch, datetime(2026, 10, 1, 16, 0))
    _bater(client, ctx["h_admin"], "saida", data_local="2026-10-01", hora_local="22:00")
    hol = client.get("/api/rh/holerite?mes_referencia=2026-10", headers=ctx["h_admin"]).get_json()["data"]
    assert hol["horas_extras_horas"] == 0


def test_sair_tarde_para_o_almoco_nao_e_atraso(client, session, ctx, monkeypatch):
    for tipo, hora in (("entrada", time(8, 0)), ("saida_almoco", time(12, 40)),
                       ("retorno_almoco", time(13, 40)), ("saida", time(18, 0))):
        _relogio(monkeypatch, datetime.combine(date(2026, 10, 2), hora))
        assert _bater(client, ctx["h_admin"], tipo).status_code == 201
    assert session.query(RegistroPonto).filter_by(tipo_registro="saida_almoco").one().minutos_atraso == 0
    hol = client.get("/api/rh/holerite?mes_referencia=2026-10", headers=ctx["h_admin"]).get_json()["data"]
    assert not [d for d in hol["descontos"] if "Atraso" in d["descricao"]]


def test_almoco_mais_longo_que_o_previsto_ainda_e_atraso(client, session, ctx, monkeypatch):
    # Intervalo previsto 12:00-13:00 (1 h). Saiu 12:40 e voltou 14:00: 20 min além da hora de almoço.
    for tipo, hora in (("entrada", time(8, 0)), ("saida_almoco", time(12, 40)), ("retorno_almoco", time(14, 0))):
        _relogio(monkeypatch, datetime.combine(date(2026, 10, 6), hora))
        assert _bater(client, ctx["h_admin"], tipo).status_code == 201
    assert session.query(RegistroPonto).filter_by(tipo_registro="retorno_almoco").one().minutos_atraso == 20


def test_atraso_antigo_na_saida_para_almoco_nao_e_descontado(client, session, ctx):
    session.add_all([
        RegistroPonto(funcionario_id=ctx["admin"].id, estabelecimento_id=ctx["estab"].id, data=date(2026, 10, 5),
                      hora=time(8, 0), tipo_registro="entrada", minutos_atraso=0),
        RegistroPonto(funcionario_id=ctx["admin"].id, estabelecimento_id=ctx["estab"].id, data=date(2026, 10, 5),
                      hora=time(12, 40), tipo_registro="saida_almoco", minutos_atraso=40)])
    session.commit()
    hol = client.get("/api/rh/holerite?mes_referencia=2026-10", headers=ctx["h_admin"]).get_json()["data"]
    assert hol["atrasos_horas"] == 0


@pytest.mark.parametrize("tipo, esperado", [
    ("saida", "entrada antes da saída"),
    ("saida_almoco", "entrada antes da saída para o almoço"),
    ("retorno_almoco", "saída para o almoço antes do retorno"),
])
def test_marcacao_fora_de_ordem_e_recusada(client, ctx, monkeypatch, tipo, esperado):
    _relogio(monkeypatch, datetime(2026, 10, 3, 9, 0))
    r = _bater(client, ctx["h_admin"], tipo)
    assert r.status_code == 400 and r.get_json()["code"] == "ORDEM_PONTO"
    assert esperado in r.get_json()["message"]


def test_saida_exige_retorno_do_almoco(client, ctx, monkeypatch):
    for tipo in ("entrada", "saida_almoco"):
        _relogio(monkeypatch, datetime(2026, 10, 3, 9, 0))
        _bater(client, ctx["h_admin"], tipo)
    assert _bater(client, ctx["h_admin"], "saida").get_json()["code"] == "ORDEM_PONTO"


def test_turno_que_vira_a_meia_noite_pode_sair(client, ctx, monkeypatch):
    _relogio(monkeypatch, datetime(2026, 10, 3, 22, 0))
    assert _bater(client, ctx["h_admin"], "entrada").status_code == 201
    _relogio(monkeypatch, datetime(2026, 10, 4, 6, 0))
    assert _bater(client, ctx["h_admin"], "saida").status_code == 201


def test_previsao_ignora_dias_antes_da_primeira_venda():
    from app.dashboard_cientifico.models_layer import PracticalModels
    zeros = [{"data": (date(2026, 9, 1) + timedelta(days=d)).isoformat(), "total": 0} for d in range(20)]
    vendas = [{"data": (date(2026, 9, 21) + timedelta(days=d)).isoformat(), "total": 700} for d in range(8)]
    r = PracticalModels.generate_forecast(zeros + vendas, days_ahead=30)
    assert r["observations"] == 8
    assert sum(f["valor_previsto"] for f in r["forecast"]) == pytest.approx(30 * 700)


def _faltas(estab_id):
    from app.dashboard_cientifico.data_layer import DataLayer
    rh = DataLayer.get_rh_metrics(estab_id, 30)
    return {f["nome"]: f["faltas"] for f in rh["faltas_por_funcionario_mes"]}


def test_loja_sem_ponto_nao_tem_falta(session, ctx):
    assert set(_faltas(ctx["estab"].id).values()) == {0}


def test_dono_nunca_tem_falta_e_funcionario_conta_ate_ontem(session, ctx):
    from app.utils.timezone import hoje_local
    hoje = hoje_local()
    ontem = hoje - timedelta(days=1)
    if ontem.month != hoje.month:
        pytest.skip("1º dia do mês: não há dia passado no mês para contar")
    # A loja passou a usar o ponto ontem; a operadora bateu entrada só hoje.
    session.add_all([
        RegistroPonto(funcionario_id=ctx["admin"].id, estabelecimento_id=ctx["estab"].id, data=ontem,
                      hora=time(8, 0), tipo_registro="entrada", minutos_atraso=0),
        RegistroPonto(funcionario_id=ctx["caixa"].id, estabelecimento_id=ctx["estab"].id, data=hoje,
                      hora=time(8, 0), tipo_registro="entrada", minutos_atraso=0)])
    session.commit()
    faltas = _faltas(ctx["estab"].id)
    assert faltas[ctx["admin"].nome] == 0
    assert faltas["Operadora Ponto"] == (0 if ontem.weekday() == 6 else 1)
