"""BigDataCorp: franquia mensal por serviço, mapeamento da ficha/preço/imagem e gravação no catálogo."""
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
    "CurrentPriceData": {
        "AggregatedPriceData": {"AverageSalePrice": 12.49},
        "PriceDataBySource": [{"SiteSourceName": "PaoDeAcucar", "SalePrice": 12.49}],
    },
    "ImagesData": {"ImagesPerSource": {"PaoDeAcucar": {"ImagesDetailsHistory": {
        "06/16/2024 00:00:00": [{"ImageUrl": "https://img.example/velha.png"}],
        "12/30/2024 00:00:00": [{"ImageUrl": "https://img.example/nova.png"}],
    }}}},
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
    from app.models import ConfigApiExterna
    session.query(ConfigApiExterna).delete(synchronize_session=False)
    session.query(ConsumoApiExterna).delete(synchronize_session=False)
    session.query(CatalogoMestre).filter(CatalogoMestre.ean.like("789000000%")).delete(synchronize_session=False)
    session.commit()


def _fake_post(chamadas):
    def fake(*args, **kwargs):
        chamadas.append(kwargs["json"])
        return _Resp({"Status": {d: [{"Code": 0}] for d in bdc.SERVICOS}, "Result": [RESULTADO_OK]})
    return fake


def test_mapear_monta_nome():
    mapeado = bdc.mapear(RESULTADO_OK)
    assert mapeado["nome"] == "Refrigerante Coca-Cola Cola Original 2 L"
    assert mapeado["marca"] == "Coca-Cola"


def test_mapear_sem_tipo_nem_marca_nao_tem_nome():
    assert bdc.mapear({"ExtraInfoData": {"ExtraInfoPerSource": {}}})["nome"] == ""


def test_mapear_traz_preco_e_imagem_mais_recente():
    mapeado = bdc.mapear(RESULTADO_OK)
    assert mapeado["preco_referencia"] == 12.49
    assert mapeado["imagem_url"] == "https://img.example/nova.png"


def test_reserva_para_no_limite():
    assert bdc.reservar_consulta("extra_info_data") is True
    assert bdc.reservar_consulta("extra_info_data") is True
    assert bdc.reservar_consulta("extra_info_data") is False
    item = next(c for c in bdc.consumo_do_mes() if c["provedor"] == "bigdatacorp:extra_info_data")
    assert item["consultas"] == 2 and item["restantes"] == 0


def test_reserva_por_servico_independente():
    assert bdc.reservar_consulta("extra_info_data") is True
    assert bdc.reservar_consulta("extra_info_data") is True
    assert bdc.reservar_consulta("extra_info_data") is False
    assert bdc.reservar_consulta("images_data") is True


def test_sem_credencial_nao_chama_api(monkeypatch):
    monkeypatch.delenv("API_BIG_DATA_CORP_TOKEN_ID")

    def falhar(*args, **kwargs):
        raise AssertionError("requests.post não deveria ser chamado")

    monkeypatch.setattr(bdc.requests, "post", falhar)
    assert bdc.consultar_ean("7890000000017") == ("nao_configurado", None, [])


def test_sem_cota_em_um_servico_tira_so_ele_da_chamada(session, monkeypatch):
    session.add(ConsumoApiExterna(provedor="bigdatacorp:images_data", mes=hoje_local().strftime("%Y-%m"),
                                  consultas=2, encontrados=0))
    session.commit()
    chamadas = []
    monkeypatch.setattr(bdc.requests, "post", _fake_post(chamadas))
    motivo, _, datasets = bdc.consultar_ean("7890000000017")
    assert motivo == "encontrado"
    assert "images_data" not in datasets
    assert "images_data" not in chamadas[0]["Datasets"]


def test_familia_por_evidencia():
    assert bdc.familia_por_evidencia(None, ["Refrigerante"], ["alimento", "bebida"]) == "bebida"
    assert bdc.familia_por_evidencia("85365090", ["Disjuntor"], ["construcao_eletrica", "eletro"]) == "construcao_eletrica"
    assert bdc.familia_por_evidencia(None, ["Tenis Nike"], ["alimento"]) is None


def test_atributos_candidatos_eletro():
    resultado = {"ExtraInfoData": {"ExtraInfoPerSource": {"LojaA": {"UncategorizedExtraInfo": {
        "VOLTAGEM": "Bivolt", "POTENCIA": "1.200 W", "GARANTIA": "1 ano", "MODELO": "X100"}}}}}
    candidatos = bdc.atributos_candidatos(resultado)
    assert candidatos["potencia_w"] == 1200.0
    assert candidatos["garantia_meses"] == 12.0
    assert candidatos["modelo"] == "X100"
    assert candidatos["voltagem_eletro"] == "Bivolt"


def test_lookup_grava_no_catalogo_e_nao_reconsulta(client, session, loja, monkeypatch):
    chamadas = []
    monkeypatch.setattr(bdc.requests, "post", _fake_post(chamadas))

    r1 = client.get("/api/produtos/catalogo/lookup/7890000000017", headers=loja["headers"])
    assert r1.status_code == 200, r1.get_json()
    dados = r1.get_json()["data"]
    assert r1.get_json()["source"] == "bigdatacorp"
    assert dados["nome"] == "Refrigerante Coca-Cola Cola Original 2 L"
    assert dados["preco_referencia"] == 12.49
    assert "sugestoes" in dados
    assert chamadas[0]["q"] == "ean{7890000000017}"
    assert CatalogoMestre.query.filter_by(ean="7890000000017").first().payload_bigdatacorp

    r2 = client.get("/api/produtos/catalogo/lookup/7890000000017", headers=loja["headers"])
    assert r2.get_json()["source"] == "catalogo"
    assert len(chamadas) == 1
    ficha = next(c for c in bdc.consumo_do_mes() if c["servico"] == "Ficha técnica")
    assert ficha["encontrados"] == 1


def test_sem_cota_nao_chama_bigdatacorp(client, session, loja, monkeypatch):
    for dataset in bdc.SERVICOS:
        session.add(ConsumoApiExterna(provedor=f"bigdatacorp:{dataset}", mes=hoje_local().strftime("%Y-%m"),
                                      consultas=2, encontrados=0))
    session.commit()
    chamadas = []
    monkeypatch.setattr(bdc.requests, "post", _fake_post(chamadas))
    monkeypatch.setattr("app.routes.produtos._buscar_open_facts", lambda *a, **k: (None, True))

    resposta = client.get("/api/produtos/catalogo/lookup/7890000000024", headers=loja["headers"])
    assert resposta.status_code == 404
    assert chamadas == []


# ───────────── painel do super admin: pausa, limite, custo e histórico ─────────────

def test_servico_pausado_nao_reserva(session):
    bdc.configurar_servico("images_data", ativo=False)
    session.commit()
    assert bdc.reservar_consulta("images_data") is False
    assert bdc.reservar_consulta("extra_info_data") is True


def test_limite_do_painel_vence_o_ambiente(session):
    bdc.configurar_servico("extra_info_data", limite_mensal_novo=3)
    session.commit()
    assert bdc.limite_mensal("extra_info_data") == 3
    assert [bdc.reservar_consulta("extra_info_data") for _ in range(4)] == [True, True, True, False]


def test_configuracao_invalida():
    with pytest.raises(ValueError):
        bdc.configurar_servico("xyz")
    with pytest.raises(ValueError):
        bdc.configurar_servico("extra_info_data", limite_mensal_novo=-1)


def test_custo_estimado():
    assert bdc.custo_estimado(500) == 0
    assert bdc.custo_estimado(600) == 6.0


def test_historico_traz_meses(session):
    mes_atual = hoje_local().strftime("%Y-%m")
    session.add_all([
        ConsumoApiExterna(provedor="bigdatacorp:extra_info_data", mes="2026-09", consultas=520, encontrados=400),
        ConsumoApiExterna(provedor="bigdatacorp:extra_info_data", mes=mes_atual, consultas=10, encontrados=5),
    ])
    session.commit()
    h = bdc.historico(6)
    assert h[0]["mes"] == mes_atual
    setembro = next(item for item in h if item["mes"] == "2026-09")
    assert setembro["servicos"]["extra_info_data"]["custo_estimado"] == 1.2


def test_painel_exige_super_admin(client, session, loja):
    loja["admin"].is_super_admin = False
    session.commit()
    assert client.get("/api/super-admin/consumo-apis", headers=loja["headers"]).status_code == 403


def test_liberar_acima_da_franquia_exige_confirmacao(client, session, loja):
    from app.models import ConfigApiExterna
    loja["admin"].is_super_admin = True
    session.commit()
    try:
        url = "/api/super-admin/consumo-apis/extra_info_data"
        r = client.put(url, json={"limite_mensal": 600}, headers=loja["headers"])
        assert r.status_code == 409 and r.get_json()["code"] == "confirmar_cobranca"
        r = client.put(url, json={"limite_mensal": 600, "confirmar_cobranca": True}, headers=loja["headers"])
        assert r.status_code == 200
        assert bdc.limite_mensal("extra_info_data") == 600
        r = client.put(url, json={"ativo": False}, headers=loja["headers"])
        assert r.status_code == 200
        assert bdc.reservar_consulta("extra_info_data") is False
    finally:
        loja["admin"].is_super_admin = False
        session.query(ConfigApiExterna).delete(synchronize_session=False)
        session.commit()


# ───────────── família no catálogo: a loja ensina, a próxima herda ─────────────

def _produto_fake(familia):
    from types import SimpleNamespace
    return SimpleNamespace(codigo_barras="7894900027013", nome="Refrigerante", marca="Marca", fabricante="Fab",
                           ncm="22021000", categoria=SimpleNamespace(nome="Bebida"), unidade_medida="UN",
                           imagem_url="", familia_produto=familia)


@pytest.fixture
def mix_loja(monkeypatch):
    monkeypatch.setattr("app.services.view_schema_service.mix_permitido_para_estabelecimento",
                        lambda *a, **k: ["alimento", "bebida", "eletro"])

    def _sem_ia(*a, **k):
        raise AssertionError("IA não deveria ser chamada")
    monkeypatch.setattr("app.routes.produtos._familia_por_ia", _sem_ia)


def test_loja_ensina_familia_ao_catalogo(session, loja):
    from types import SimpleNamespace
    from app.services.catalogo_mestre_service import registrar_produto_se_novo
    CatalogoMestre.query.filter_by(ean="7894900027013").delete()
    session.commit()
    registrar_produto_se_novo(_produto_fake("bebida"), SimpleNamespace(id=loja["estab"].id), "modal")
    session.commit()
    assert CatalogoMestre.query.filter_by(ean="7894900027013").first().familia_produto == "bebida"


def test_familia_do_catalogo_nao_e_sobrescrita(session, loja):
    from types import SimpleNamespace
    from app.services.catalogo_mestre_service import registrar_produto_se_novo
    CatalogoMestre.query.filter_by(ean="7894900027013").delete()
    session.add(CatalogoMestre(ean="7894900027013", nome="X", status="encontrado", fonte="tenant", familia_produto="bebida"))
    session.commit()
    estab = SimpleNamespace(id=loja["estab"].id)
    registrar_produto_se_novo(_produto_fake("alimento"), estab, "modal")
    session.commit()
    assert CatalogoMestre.query.filter_by(ean="7894900027013").first().familia_produto == "bebida"
    CatalogoMestre.query.filter_by(ean="7894900027013").first().familia_produto = None
    session.commit()
    registrar_produto_se_novo(_produto_fake("alimento"), estab, "modal")
    session.commit()
    assert CatalogoMestre.query.filter_by(ean="7894900027013").first().familia_produto == "alimento"
    CatalogoMestre.query.filter_by(ean="7894900027013").delete()
    session.commit()


def test_lookup_herda_familia_do_catalogo_sem_ia(client, session, loja, mix_loja):
    session.add(CatalogoMestre(ean="7890000000031", nome="Cabo X", categoria="Cabo", status="encontrado",
                               fonte="tenant", familia_produto="eletro"))
    session.commit()
    r = client.get("/api/produtos/catalogo/lookup/7890000000031", headers=loja["headers"])
    assert r.status_code == 200 and r.get_json()["source"] == "catalogo"
    assert r.get_json()["data"]["sugestoes"]["familia_produto"] == "eletro"


def test_lookup_grava_familia_pelo_ncm(client, session, loja, mix_loja):
    session.add(CatalogoMestre(ean="7890000000048", nome="Suco de Uva 1L", categoria="Suco", ncm="22029900",
                               status="encontrado", fonte="tenant"))
    session.commit()
    r = client.get("/api/produtos/catalogo/lookup/7890000000048", headers=loja["headers"])
    assert r.get_json()["data"]["sugestoes"]["familia_produto"] == "bebida"
    session.expire_all()
    assert CatalogoMestre.query.filter_by(ean="7890000000048").first().familia_produto == "bebida"


def test_importar_do_catalogo_leva_familia_e_nao_inventa_ncm(client, session, loja, mix_loja):
    session.add(CatalogoMestre(ean="7890000000055", nome="Biscoito Y", categoria="Biscoito", status="encontrado",
                               fonte="tenant", familia_produto="alimento", ncm=None))
    session.commit()
    r = client.post("/api/produtos/catalogo/importar", json={"eans": ["7890000000055"]}, headers=loja["headers"])
    assert r.status_code in (200, 201), r.get_json()
    p = Produto.query.filter_by(estabelecimento_id=loja["estab"].id, codigo_barras="7890000000055").first()
    try:
        assert p is not None and p.familia_produto == "alimento"
        assert p.ncm in (None, "")
    finally:
        if p is not None:
            session.delete(p)
            session.commit()


def test_familia_escolhida_pelo_operador_manda(client, session, loja, mix_loja):
    session.add(CatalogoMestre(ean="7890000000062", nome="Copo Termico", categoria="Copo", status="encontrado",
                               fonte="tenant", familia_produto="bebida"))
    session.commit()
    r = client.get("/api/produtos/catalogo/lookup/7890000000062?familia=eletro", headers=loja["headers"])
    assert r.get_json()["data"]["sugestoes"]["familia_produto"] == "eletro"


def test_nome_de_cada_servico_cabe_nas_colunas():
    """O SQLite não aplica tamanho de coluna; em produção (Postgres) o INSERT falhava com 32 > 30."""
    from app.models import ConfigApiExterna
    for dataset in bdc.SERVICOS:
        provedor = bdc._provedor(dataset)
        assert len(provedor) <= ConsumoApiExterna.__table__.c.provedor.type.length, provedor
        assert len(provedor) <= ConfigApiExterna.__table__.c.provedor.type.length, provedor
