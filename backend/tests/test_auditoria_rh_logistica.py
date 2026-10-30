"""Auditoria 29/10 (RH, logística, contas a pagar): defeitos confirmados no código, um teste por correção."""
import io
import os
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (ConfiguracaoLogistica, ContaPagar, Despesa, Estabelecimento, Fornecedor, Funcionario,
                        Rescisao, TurnoEntregador)
from app.utils.timezone import hoje_local


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    estab.plano, estab.plano_status = "Pro", "ativo"
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    session.commit()

    def headers(func):
        token = create_access_token(identity=str(func.id), additional_claims={
            "estabelecimento_id": estab.id, "role": func.role, "plano": "Pro", "plano_status": "ativo"})
        return {"Authorization": f"Bearer {token}"}
    return dict(estab=estab, admin=admin, h=headers(admin))


def test_justificativa_recusa_data_com_caminho_e_nao_grava_arquivo(app, client, ctx):
    pasta = os.path.join(app.config.get("UPLOAD_FOLDER", "uploads"), "justificativas")
    antes = set(os.listdir(pasta)) if os.path.isdir(pasta) else set()
    r = client.post("/api/rh/justificativas", headers=ctx["h"], content_type="multipart/form-data", data={
        "funcionario_id": str(ctx["admin"].id), "tipo": "falta", "data": "../../escapou", "motivo": "teste",
        "documento": (io.BytesIO(b"%PDF-1.4 teste"), "atestado.pdf")})
    assert r.status_code == 400, r.get_json()
    depois = set(os.listdir(pasta)) if os.path.isdir(pasta) else set()
    assert depois == antes  # nada gravado, nem dentro nem fora da pasta


def _rescisao(session, estab, func, dia):
    despesa = Despesa(estabelecimento_id=estab.id, descricao=f"Rescisão Trabalhista - {func.nome}",
                      categoria="Rescisão Trabalhista", valor=Decimal("1500"), data_despesa=dia, data_vencimento=dia)
    session.add(despesa)
    session.flush()
    r = Rescisao(estabelecimento_id=estab.id, funcionario_id=func.id, despesa_id=despesa.id, data_demissao=dia,
                 tipo_rescisao="S_JUSTA", verbas_rescisorias_json={"total_liquido_estimado": 1500},
                 total_proventos=Decimal("1500"), total_descontos=Decimal("0"), total_liquido=Decimal("1500"))
    session.add(r)
    session.commit()
    return r, despesa


def test_listar_rescisoes_nao_apaga_rescisao_nem_despesa_anterior(session, ctx):
    from app.routes.rh import _garantir_despesas_rescisoes_legadas
    func = ctx["admin"]
    r1, d1 = _rescisao(session, ctx["estab"], func, date(2026, 3, 10))  # 1º vínculo, despesa já paga
    r2, d2 = _rescisao(session, ctx["estab"], func, date(2026, 9, 10))  # readmitido e demitido de novo
    ids = (r1.id, d1.id, r2.id, d2.id)
    _garantir_despesas_rescisoes_legadas()  # roda no GET /rh/rescisoes
    session.expire_all()
    assert Rescisao.query.get(ids[0]) is not None and Despesa.query.get(ids[1]) is not None
    assert Rescisao.query.get(ids[2]) is not None and Despesa.query.get(ids[3]) is not None


def test_primeiro_turno_fecha_em_loja_sem_configuracao_de_logistica(client, session, ctx):
    ConfiguracaoLogistica.query.filter_by(estabelecimento_id=ctx["estab"].id).delete()
    session.add(TurnoEntregador(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id,
                                km_inicial=Decimal("100"), status="aberto"))
    session.commit()
    r = client.post("/api/logistica/turno/finalizar", headers=ctx["h"], json={"km_final": 130})
    assert r.status_code == 200, r.get_json()
    config = ConfiguracaoLogistica.query.filter_by(estabelecimento_id=ctx["estab"].id).first()
    assert config is not None and float(config.preco_gasolina) == 6.0


def test_conta_parcial_vencida_aparece_nos_vencidos(client, session, ctx):
    forn = Fornecedor(estabelecimento_id=ctx["estab"].id, nome_fantasia="Forn Parcial", razao_social="Forn Parcial LTDA",
                      cnpj="11222333000181", telefone="11999990000", email="parcial@forn.test", cep="01000000",
                      logradouro="Rua", numero="1", bairro="Centro", cidade="São Paulo", estado="SP")
    session.add(forn)
    session.flush()
    hoje = hoje_local()
    conta = ContaPagar(estabelecimento_id=ctx["estab"].id, fornecedor_id=forn.id,
                       numero_documento="PARCIAL-01", valor_original=Decimal("1000"), valor_pago=Decimal("400"),
                       valor_atual=Decimal("600"), data_emissao=hoje - timedelta(days=40),
                       data_vencimento=hoje - timedelta(days=10), status="parcial")
    session.add(conta)
    session.commit()
    r = client.get("/api/despesas/boletos-status", headers=ctx["h"])
    assert r.status_code == 200, r.get_json()
    vencidos = r.get_json()["vencidos"]
    assert any(b.get("id") == conta.id for b in vencidos["items"]), vencidos
    assert vencidos["total"] >= 600  # o saldo devido (valor_atual), não o valor original
