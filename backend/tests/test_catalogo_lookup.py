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


def test_fallback_cosmos_grava_catalogo(client, session, headers, monkeypatch):
    payload = {
        "description": "BISCOITO RECHEADO 140G", "brand": {"name": "Marca X"},
        "ncm": {"code": "19053100"}, "category": {"name": "Biscoitos"},
        "thumbnail": "http://img/x.png", "avg_price": 3.5,
    }
    monkeypatch.setattr(produtos_mod.requests, "get", lambda *a, **k: _FakeResp(200, payload))

    ean = "7891000100103"
    r = client.get(f"/api/produtos/catalogo/lookup/{ean}", headers=headers)
    assert r.status_code == 200
    j = r.get_json()
    assert j["success"] and j["source"] == "cosmos"
    assert j["data"]["nome"] == "BISCOITO RECHEADO 140G"
    # Gravou no catálogo (próxima consulta vem do local)
    salvo = CatalogoMestre.query.filter_by(ean=ean).first()
    assert salvo is not None and salvo.status == "encontrado" and salvo.marca == "Marca X"


def test_quota_cosmos_cai_nas_bases_abertas_e_grava(client, session, headers, monkeypatch):
    """Cosmos sem cota (429) não trava o cadastro: Open Food Facts responde e vira cache local."""
    off = {"status": 1, "product": {"product_name_pt": "Arroz parboilizado", "brands": "Camil, Outra",
                                    "categories": "Cereais, pt:Arroz", "quantity": "1 kg",
                                    "image_front_small_url": "https://img/arroz.jpg"}}

    def _get(url, *a, **k):
        return _FakeResp(429) if "cosmos" in url else _FakeResp(200, off)
    monkeypatch.setattr(produtos_mod.requests, "get", _get)

    r = client.get("/api/produtos/catalogo/lookup/7896006716112", headers=headers)
    assert r.status_code == 200, r.get_json()
    j = r.get_json()
    assert j["success"] and j["source"] == "openfoodfacts"
    assert j["data"]["nome"] == "Arroz parboilizado 1 kg"
    assert j["data"]["marca"] == "Camil" and j["data"]["categoria"] == "Arroz"
    salvo = CatalogoMestre.query.filter_by(ean="7896006716112").first()
    assert salvo.status == "encontrado" and salvo.fonte == "openfoodfacts"


def test_quota_retorna_erro_transparente(client, session, headers, monkeypatch):
    monkeypatch.setattr(produtos_mod.requests, "get", lambda *a, **k: _FakeResp(429))
    r = client.get("/api/produtos/catalogo/lookup/7891000999999", headers=headers)
    assert r.status_code == 429
    assert r.get_json()["code"] == "quota"  # NÃO mascara como "não encontrado"
