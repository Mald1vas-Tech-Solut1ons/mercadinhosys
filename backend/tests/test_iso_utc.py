"""Data com hora sai da API marcada como UTC; sem a marca o navegador mostra a hora UTC como local
(o feed de Auditoria exibia 21:53 para um login das 18:53 em São Paulo)."""
from datetime import date, datetime, timezone, timedelta

from app.models import Auditoria, Estabelecimento
from app.utils.timezone import iso_utc


def test_iso_utc():
    assert iso_utc(datetime(2026, 10, 28, 21, 53)) == "2026-10-28T21:53:00+00:00"
    assert iso_utc(date(2026, 10, 28)) == "2026-10-28"
    com_fuso = datetime(2026, 10, 28, 18, 53, tzinfo=timezone(timedelta(hours=-3)))
    assert iso_utc(com_fuso) == "2026-10-28T18:53:00-03:00"
    assert iso_utc(None) is None


def test_auditoria_sai_com_fuso(session):
    estab = session.query(Estabelecimento).first()
    a = Auditoria(estabelecimento_id=estab.id, tipo_evento="login", descricao="Login realizado por teste",
                  data_evento=datetime(2026, 10, 28, 21, 53))
    session.add(a)
    session.commit()
    assert a.to_dict()["data_evento"] == "2026-10-28T21:53:00+00:00"


def test_json_da_api_marca_datetime(app):
    with app.test_request_context():
        corpo = app.json.dumps({"quando": datetime(2026, 10, 28, 21, 53), "dia": date(2026, 10, 28)})
    assert '"2026-10-28T21:53:00+00:00"' in corpo and '"2026-10-28"' in corpo
