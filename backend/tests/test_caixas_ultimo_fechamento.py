"""FASE 1.3 — Endpoint leve GET /caixas/ultimo-fechamento.

Valida:
1. Estabelecimento sem caixa fechado → data None.
2. Estabelecimento com 2 caixas fechados → retorna o saldo_final do mais recente.
3. Caixa aberto não é considerado (só fechados contam).
"""
from datetime import datetime, timedelta

from flask_jwt_extended import create_access_token

from app.models import db, Caixa, Estabelecimento, Funcionario


def _headers(estab_id, func_id):
    token = create_access_token(
        identity=str(func_id),
        additional_claims={"estabelecimento_id": estab_id, "role": "admin"},
    )
    return {"Authorization": f"Bearer {token}"}


def _novo_caixa(session, estab, func, *, status="fechado", saldo_final=None, numero="CX-1", data_fechamento=None):
    caixa = Caixa(
        estabelecimento_id=estab.id,
        funcionario_id=func.id,
        numero_caixa=numero,
        status=status,
        saldo_inicial=100,
        saldo_final=saldo_final,
        data_abertura=datetime.now(),
        data_fechamento=data_fechamento,
    )
    session.add(caixa)
    return caixa


class TestUltimoFechamento:
    def test_sem_caixa_fechado_retorna_none(self, client, session):
        estab = session.query(Estabelecimento).first()
        admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

        r = client.get("/api/caixas/ultimo-fechamento", headers=_headers(estab.id, admin.id))

        assert r.status_code == 200
        assert r.get_json() == {"success": True, "data": None}

    def test_com_um_caixa_fechado_retorna_saldo(self, client, session):
        estab = session.query(Estabelecimento).first()
        admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
        _novo_caixa(session, estab, admin, saldo_final=347.50, data_fechamento=datetime.now())
        session.commit()

        r = client.get("/api/caixas/ultimo-fechamento", headers=_headers(estab.id, admin.id))

        assert r.status_code == 200
        data = r.get_json()["data"]
        assert data["saldo_final"] == 347.50
        assert data["numero_caixa"] == "CX-1"

    def test_com_dois_fechados_retorna_o_mais_recente(self, client, session):
        estab = session.query(Estabelecimento).first()
        admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
        _novo_caixa(session, estab, admin, saldo_final=100.00, numero="CX-1",
                    data_fechamento=datetime.now() - timedelta(days=1))
        _novo_caixa(session, estab, admin, saldo_final=250.75, numero="CX-2",
                    data_fechamento=datetime.now())
        session.commit()

        r = client.get("/api/caixas/ultimo-fechamento", headers=_headers(estab.id, admin.id))

        assert r.status_code == 200
        assert r.get_json()["data"]["saldo_final"] == 250.75

    def test_caixa_aberto_nao_conta(self, client, session):
        estab = session.query(Estabelecimento).first()
        admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
        _novo_caixa(session, estab, admin, status="aberto", saldo_final=None)
        session.commit()

        r = client.get("/api/caixas/ultimo-fechamento", headers=_headers(estab.id, admin.id))

        assert r.status_code == 200
        assert r.get_json() == {"success": True, "data": None}

    def test_fechado_sem_saldo_final_devolve_null(self, client, session):
        estab = session.query(Estabelecimento).first()
        admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
        _novo_caixa(session, estab, admin, saldo_final=None, data_fechamento=datetime.now())
        session.commit()

        r = client.get("/api/caixas/ultimo-fechamento", headers=_headers(estab.id, admin.id))

        assert r.status_code == 200
        assert r.get_json()["data"]["saldo_final"] is None
