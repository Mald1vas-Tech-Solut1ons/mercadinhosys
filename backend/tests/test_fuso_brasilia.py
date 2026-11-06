"""O dia do sistema é o dia da LOJA (Brasília, UTC-3), não o dia UTC do servidor.

Antes de 06/11/2026, ~130 pontos usavam date.today()/datetime.now() do servidor (UTC): às 21h de
Brasília o "hoje" já era amanhã. Estes testes congelam o relógio em 22:30 de Brasília (01:30 UTC
do dia seguinte), o horário em que o erro aparecia.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

import app.utils.timezone as tz
from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto

AGORA_UTC = datetime(2026, 11, 6, 1, 30, tzinfo=timezone.utc)  # 05/11/2026 22:30 em Brasília
DIA_LOJA = date(2026, 11, 5)


class _RelogioCongelado(datetime):
    @classmethod
    def now(cls, tz_=None):
        return AGORA_UTC if tz_ is None else AGORA_UTC.astimezone(tz_)


@pytest.fixture
def relogio_22h30(monkeypatch):
    monkeypatch.setattr(tz, "datetime", _RelogioCongelado)


def _headers(funcionario):
    token = create_access_token(identity=str(funcionario.id), additional_claims={
        "estabelecimento_id": funcionario.estabelecimento_id, "role": "ADMIN",
        "is_super_admin": bool(funcionario.is_super_admin)})
    return {"Authorization": f"Bearer {token}"}


def test_hoje_e_agora_sao_os_de_brasilia(relogio_22h30):
    assert tz.hoje_local() == DIA_LOJA
    assert tz.agora_local().strftime("%d/%m/%Y %H:%M") == "05/11/2026 22:30"
    assert tz.now_utc() == datetime(2026, 11, 6, 1, 30)  # banco continua UTC


def test_produto_que_vence_hoje_nao_e_vencido_as_22h30(session, relogio_22h30):
    from app.services import estoque_service
    estab = session.query(Estabelecimento).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Fuso Validade")
    session.add(cat)
    session.flush()
    produto = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="IOGURTE FUSO", preco_custo=Decimal("1"),
                      preco_venda=Decimal("2"), quantidade=Decimal("5"), controlar_validade=True,
                      data_validade=DIA_LOJA)
    session.add(produto)
    session.commit()
    # Vence HOJE (05/11 em Brasília): ainda pode ser vendido às 22:30. Com o dia UTC (06/11) era vencido.
    assert estoque_service._vencido_sem_lote(produto) is False
    produto.data_validade = date(2026, 11, 4)
    assert estoque_service._vencido_sem_lote(produto) is True


def test_excluir_loja_por_botao_e_recusado_e_nada_e_apagado(client, session):
    admin = session.query(Funcionario).first()
    admin.is_super_admin = True
    session.commit()
    estab_id = admin.estabelecimento_id
    r = client.delete(f"/api/saas/monitor/establishments/{estab_id}", headers=_headers(admin))
    assert r.status_code == 409, r.get_data(as_text=True)
    assert r.get_json()["code"] == "EXCLUSAO_FISICA_BLOQUEADA"
    assert session.get(Estabelecimento, estab_id) is not None


def test_logs_do_monitor_com_loja_invalida_nao_quebram(client, session):
    admin = session.query(Funcionario).first()
    admin.is_super_admin = True
    session.commit()
    r = client.get("/api/saas/monitor/logs?estabelecimento_id=abc", headers=_headers(admin))
    assert r.status_code != 500, r.get_data(as_text=True)
