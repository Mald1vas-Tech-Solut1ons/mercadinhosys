"""BigDataCorp: contador da franquia mensal (500 grátis), nome montado da ficha e gravação no catálogo."""
from datetime import timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.services import bigdatacorp_service as bdc
from app.utils.timezone import hoje_local
from app.models import (Caixa, CatalogoMestre, CategoriaProduto, ConsumoApiExterna, Estabelecimento, Funcionario,
                        Produto, ProdutoLote)

RESULTADO_OK = {
    "PrimaryId": "7890000000017", "IdType": "EAN",
    "ExtraInfoData": {"ExtraInfoPerSource": {
        "LojaA": {"UncategorizedExtraInfo": {"MARCA": "Coca-Cola", "SABOR": "Cola Original",
                                             "NOME PRINCIPAL DO ITEM": "Refrigerante", "CONTEUDO LIQUIDO": "2",
                                             "UNID CONTEUDO LIQUIDO": "L"}},
        "LojaB": {"UncategorizedExtraInfo": {"MARCA": "Coca-Cola", "VOLUME": "2 L"}},
    }},
}


class _Resp:
    def __init__(self, dados):
        self._dados = dados

    def json(self):
        return self._dados


@pytest.fixture
def loja(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="BDC")
    session.add(cat)
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item", preco_custo=Decimal("40"),
                   preco_venda=Decimal("100"), quantidade=Decimal("50"))
    session.add(prod)
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, numero_lote="BDC", quantidade=50,
                    quantidade_inicial=50, data_entrada=hoje_local(), data_validade=hoje_local() + timedelta(days=90),
                    preco_custo_unitario=40, ativo=True),
        Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="BDC", saldo_inicial=0,
              saldo_atual=0, status="aberto"),
    ])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, prod=prod, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture(autouse=True)
def bdc_env(monkeypatch, session):
    monkeypatch.setenv("API_BIG_DATA_CORP", "tok")
    monkeypatch.setenv("API_BIG_DATA_CORP_TOKEN_ID", "id")
    monkeypatch.setenv("BIGDATACORP_LIMITE_MENSAL", "2")
    monkeypatch.delenv("COSMOS_TOKEN", raising=False)  # teste nunca sai para a rede
    session.query(ConsumoApiExterna).delete(synchronize_session=False)
    session.query(CatalogoMestre).filter(CatalogoMestre.ean.like("789000000%")).delete(synchronize_session=False)
    session.commit()


def _fake_post(chamadas):
    def fake(*args, **kwargs):
        chamadas.append(kwargs.get("json"))
        return _Resp({"Status": {"extra_info_data": [{"Code": 0}]}, "Result": [RESULTADO_OK]})
    return fake


def test_mapear_monta_nome():
    mapeado = bdc.mapear(RESULTADO_OK)
    assert mapeado["nome"] == "Refrigerante Coca-Cola Cola Original 2 L"
    assert mapeado["marca"] == "Coca-Cola"


def test_mapear_sem_tipo_nem_marca_nao_tem_nome():
    assert bdc.mapear({"ExtraInfoData": {"ExtraInfoPerSource": {}}})["nome"] == ""


def test_reserva_para_no_limite():
    assert bdc.reservar_consulta() is True
    assert bdc.reservar_consulta() is True
    assert bdc.reservar_consulta() is False
    consumo = bdc.consumo_do_mes()
    assert consumo["consultas"] == 2 and consumo["restantes"] == 0


def test_sem_credencial_nao_chama_api(monkeypatch):
    monkeypatch.delenv("API_BIG_DATA_CORP_TOKEN_ID")

    def falhar(*args, **kwargs):
        raise AssertionError("requests.post não deveria ser chamado")

    monkeypatch.setattr(bdc.requests, "post", falhar)
    assert bdc.consultar_ean("7890000000017") == ("nao_configurado", None)


def test_lookup_grava_no_catalogo_e_nao_reconsulta(client, session, loja, monkeypatch):
    chamadas = []
    monkeypatch.setattr(bdc.requests, "post", _fake_post(chamadas))

    r1 = client.get("/api/produtos/catalogo/lookup/7890000000017", headers=loja["headers"])
    assert r1.status_code == 200, r1.get_json()
    assert r1.get_json()["source"] == "bigdatacorp"
    assert r1.get_json()["data"]["nome"] == "Refrigerante Coca-Cola Cola Original 2 L"
    assert chamadas[0]["q"] == "ean{7890000000017}"
    assert CatalogoMestre.query.filter_by(ean="7890000000017").first().payload_bigdatacorp

    r2 = client.get("/api/produtos/catalogo/lookup/7890000000017", headers=loja["headers"])
    assert r2.get_json()["source"] == "catalogo"
    assert len(chamadas) == 1
    assert bdc.consumo_do_mes()["encontrados"] == 1


def test_sem_cota_nao_chama_bigdatacorp(client, session, loja, monkeypatch):
    session.add(ConsumoApiExterna(provedor="bigdatacorp", mes=hoje_local().strftime("%Y-%m"), consultas=2, encontrados=0))
    session.commit()
    chamadas = []
    monkeypatch.setattr(bdc.requests, "post", _fake_post(chamadas))
    monkeypatch.setattr("app.routes.produtos._buscar_open_facts", lambda *a, **k: (None, True))

    resposta = client.get("/api/produtos/catalogo/lookup/7890000000024", headers=loja["headers"])
    assert resposta.status_code == 404
    assert chamadas == []
