"""Hora e dia das vendas são os da loja (São Paulo, UTC-3), não os do banco (UTC)."""
from datetime import date, datetime, timedelta
from decimal import Decimal

from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Funcionario, Venda


def _venda(session, estab, func, utc_naive, codigo):
    v = Venda(estabelecimento_id=estab.id, funcionario_id=func.id, codigo=codigo, subtotal=Decimal("10"),
              desconto=Decimal("0"), total=Decimal("10"), status="finalizada", data_venda=utc_naive)
    session.add(v)
    return v


def test_vendas_por_hora_e_por_dia_no_fuso_da_loja(client, session):
    estab = session.query(Estabelecimento).first()
    func = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    ontem = date.today() - timedelta(days=1)
    # 20:25 UTC = 17:25 em São Paulo; 01:30 UTC de hoje = 22:30 de ontem em São Paulo.
    _venda(session, estab, func, datetime.combine(ontem, datetime.min.time()).replace(hour=20, minute=25), "FUSO-1")
    _venda(session, estab, func, datetime.combine(date.today(), datetime.min.time()).replace(hour=1, minute=30), "FUSO-2")
    session.commit()
    token = create_access_token(identity=str(func.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    r = client.get(f"/api/vendas/estatisticas?data_inicio={ontem - timedelta(days=1)}&data_fim={date.today()}",
                   headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.get_data(as_text=True)
    corpo = r.get_json()
    horas = {h["hora"] for h in corpo["vendas_por_hora"]}
    assert horas == {17, 22}
    # As duas vendas são de ontem no horário da loja (a das 22:30 não pula para hoje).
    dias = corpo["vendas_por_dia"]
    assert len(dias) == 1, dias
    texto = str(dias[0])
    assert ontem.isoformat() in texto or ontem.strftime("%d/%m") in texto, dias
