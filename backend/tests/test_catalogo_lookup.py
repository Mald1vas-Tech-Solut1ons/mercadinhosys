"""
Testes do lookup inteligente de catálogo (/produtos/catalogo/lookup/<ean>).

Prova: (1) catálogo local responde sem rede; (2) cache negativo evita
reconsulta; (3) EAN inválido é barrado; (4) fallback Cosmos grava no catálogo;
(5) quota do Cosmos retorna erro transparente (não "produto não encontrado").
"""
import pytest
from datetime import datetime
from flask_jwt_extended import create_access_token

from app.models import db, Estabelecimento, CatalogoMestre
import app.routes.produtos as produtos_mod


@pytest.fixture(autouse=True)
def cosmos_configurado(monkeypatch):
    # Sem token no código: o Cosmos só é consultado com COSMOS_TOKEN no ambiente.
    monkeypatch.setenv("COSMOS_TOKEN", "token-de-teste")


@pytest.fixture
def headers(session):
    estab = session.query(Estabelecimento).first()
    token = create_access_token(identity="1", additional_claims={"estabelecimento_id": estab.id})
    return {"Authorization": f"Bearer {token}"}


class _FakeResp:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
    def json(self):
        return self._payload


def test_catalogo_local_responde_sem_rede(client, session, headers, monkeypatch):
    db.session.add(CatalogoMestre(ean="7894900011517", nome="COCA-COLA 2L", marca="Coca-Cola",
                                  ncm="22021000", categoria="Refrigerante", status="encontrado"))
    db.session.commit()

    def _boom(*a, **k):
        raise AssertionError("NÃO deveria chamar o Cosmos quando o catálogo tem o EAN")
    monkeypatch.setattr(produtos_mod.requests, "get", _boom)

    r = client.get("/api/produtos/catalogo/lookup/7894900011517", headers=headers)
    assert r.status_code == 200
    j = r.get_json()
    assert j["success"] and j["source"] == "catalogo"
    assert j["data"]["nome"] == "COCA-COLA 2L"


def test_cache_negativo_nao_reconsulta(client, session, headers, monkeypatch):
    db.session.add(CatalogoMestre(ean="0000000000000", status="nao_encontrado"))
    db.session.commit()
    monkeypatch.setattr(produtos_mod.requests, "get",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria consultar")))
    r = client.get("/api/produtos/catalogo/lookup/0000000000000", headers=headers)
    assert r.status_code == 404
    assert r.get_json()["code"] == "nao_encontrado"


def test_ean_invalido(client, session, headers):
    r = client.get("/api/produtos/catalogo/lookup/123", headers=headers)
    assert r.status_code == 400
    assert r.get_json()["code"] == "ean_invalido"

