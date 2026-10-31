"""Famílias Calçados e Suplementos e Nutrição + bloqueio configurável de venda de vencido."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Configuracao, Estabelecimento, Funcionario, Produto, ProdutoLote, db,
)
from app.services.view_schema_service import (
    MIX_PADRAO_POR_SEGMENTO, invalidar_cache_view_schema, resolver_view_schema, sugestao_fiscal_para_familia,
)


def _estab(session, segmento="generico"):
    invalidar_cache_view_schema()
    estab = session.query(Estabelecimento).first()
    estab.segmento = segmento
    estab.configuracoes = {}
    session.commit()
    return estab


# ---------------------------------------------------------------- famílias
def test_familias_novas_no_mix():
    assert {"calcados", "suplementos"} <= set(MIX_PADRAO_POR_SEGMENTO["generico"])
    assert "suplementos" in MIX_PADRAO_POR_SEGMENTO["mercearia"]
    assert "calcados" in MIX_PADRAO_POR_SEGMENTO["vestuario"]


def test_schema_calcados(session):
    estab = _estab(session)
    schema = resolver_view_schema(estab, familia_produto="calcados")
    assert schema["familia_produto"]["nome"] == "Calçados"
    campos = {c["chave"]: c for c in schema["campos"]}
    assert {"numeracao", "tipo_calcado", "material_calcado", "genero", "cores", "modelo"} <= set(campos)
    assert "37" in campos["numeracao"]["opcoes"] and "15" in campos["numeracao"]["opcoes"]
    # Grade de roupa e tecido não fazem sentido para calçado.
    assert not {"tamanhos", "tecido", "controlar_validade"} & set(campos)
    # E os campos de calçado não vazam para roupa.
    roupa = {c["chave"] for c in resolver_view_schema(estab, familia_produto="vestuario")["campos"]}
    assert not {"numeracao", "tipo_calcado"} & roupa


def test_schema_suplementos(session):
    estab = _estab(session)
    schema = resolver_view_schema(estab, familia_produto="suplementos")
    assert schema["familia_produto"]["nome"] == "Suplementos e Vitaminas"
    assert schema["flags"]["usa_validade"] is True and schema["flags"]["usa_lotes"] is True
    campos = {c["chave"] for c in schema["campos"]}
    assert {"forma_apresentacao", "nutriente_principal", "dose_porcao", "doses_por_embalagem",
            "concentracao_dose", "sabor", "alergenicos", "registro_anvisa", "controlar_validade"} <= campos
    assert not {"embalagem", "itens_por_embalagem"} & campos
    alimento = {c["chave"] for c in resolver_view_schema(estab, familia_produto="alimento")["campos"]}
    assert not {"nutriente_principal", "dose_porcao"} & alimento


def test_fiscal_suplemento_nao_herda_cesta_basica():
    sug = sugestao_fiscal_para_familia("suplementos")
    assert sug["icms_aliquota_sugerida"] == 18.0
    assert sug["icms_st_a_confirmar"] is True
    assert "cesta básica" in sug["observacao_fiscal"] and "3004" in sug["observacao_fiscal"]
    assert {e["ncm"] for e in sug["ncm_exemplos"]} == {"21069030", "21061000"}
    assert sugestao_fiscal_para_familia("calcados")["icms_st_a_confirmar"] is True


def test_importacao_infere_familia_pelo_ncm():
    from app.routes.produtos import _imp_resolver_familia
    mix = MIX_PADRAO_POR_SEGMENTO["generico"]
    assert _imp_resolver_familia("", "64039990", mix) == "calcados"
    assert _imp_resolver_familia("", "21069030", mix) == "suplementos"
    assert _imp_resolver_familia("", "21061000", mix) == "suplementos"
    assert _imp_resolver_familia("", "61091000", mix) == "vestuario"
    assert _imp_resolver_familia("Suplementos e Nutrição", "", mix) == "suplementos"
    # Loja de roupa sem a família calçados no mix: calçado continua em vestuário.
    assert _imp_resolver_familia("", "64039990", ["vestuario"]) == "vestuario"


# ------------------------------------------------- bloqueio de vencido no caixa
@pytest.fixture
def caixa_ctx(session):
    estab = _estab(session)
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Vitaminas")
    session.add(cat)
    session.flush()
    cfg = session.query(Configuracao).filter_by(estabelecimento_id=estab.id).first()
    if not cfg:
        cfg = Configuracao(estabelecimento_id=estab.id)
        session.add(cfg)
    session.add(Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="SUP-1",
                      saldo_inicial=0, saldo_atual=0, status="aberto"))
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, cat=cat, cfg=cfg, headers={"Authorization": f"Bearer {token}"})


def _produto(session, ctx, **extra):
    p = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["cat"].id, nome="Ômega 3 120 caps",
                preco_custo=Decimal("30"), preco_venda=Decimal("60"), quantidade=Decimal("5"),
                controlar_validade=True, familia_produto="suplementos", **extra)
    session.add(p)
    session.commit()
    return p


def _vender(client, ctx, produto, qtd=1):
    total = 60 * qtd
    return client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "subtotal": total, "total": total, "desconto": 0,
        "items": [{"id": produto.id, "quantidade": qtd, "preco_unitario": 60}],
        "pagamentos": [{"forma": "dinheiro", "valor": total}],
    })


def _bloquear(session, ctx, valor):
    ctx["cfg"].bloquear_venda_vencido = valor
    session.commit()


def test_produto_sem_lote_vencido_bloqueado_por_padrao(client, session, caixa_ctx):
    p = _produto(session, caixa_ctx, data_validade=date.today() - timedelta(days=2))
    r = _vender(client, caixa_ctx, p)
    assert r.status_code == 400
    assert "vencido" in r.get_json()["error"]


def test_loja_que_desliga_o_bloqueio_vende_vencido(client, session, caixa_ctx):
    _bloquear(session, caixa_ctx, False)
    p = _produto(session, caixa_ctx, data_validade=date.today() - timedelta(days=2))
    assert _vender(client, caixa_ctx, p).status_code == 201


def test_lote_vencido_sai_primeiro_quando_bloqueio_desligado(client, session, caixa_ctx):
    _bloquear(session, caixa_ctx, False)
    p = _produto(session, caixa_ctx)
    vencido = ProdutoLote(estabelecimento_id=caixa_ctx["estab"].id, produto_id=p.id, numero_lote="V",
                          quantidade=2, quantidade_inicial=2, data_entrada=date.today() - timedelta(days=200),
                          data_validade=date.today() - timedelta(days=1), preco_custo_unitario=30, ativo=True)
    bom = ProdutoLote(estabelecimento_id=caixa_ctx["estab"].id, produto_id=p.id, numero_lote="B",
                      quantidade=3, quantidade_inicial=3, data_entrada=date.today(),
                      data_validade=date.today() + timedelta(days=300), preco_custo_unitario=30, ativo=True)
    db.session.add_all([vencido, bom])
    db.session.commit()
    assert _vender(client, caixa_ctx, p, qtd=5).status_code == 201
    session.expire_all()
    assert session.get(ProdutoLote, vencido.id).quantidade == 0
    assert session.get(ProdutoLote, bom.id).quantidade == 0


def test_lote_vencido_segue_em_quarentena_com_bloqueio(client, session, caixa_ctx):
    p = _produto(session, caixa_ctx, data_validade=date.today() - timedelta(days=1))
    db.session.add(ProdutoLote(estabelecimento_id=caixa_ctx["estab"].id, produto_id=p.id, numero_lote="V",
                               quantidade=5, quantidade_inicial=5, data_entrada=date.today() - timedelta(days=200),
                               data_validade=date.today() - timedelta(days=1), preco_custo_unitario=30, ativo=True))
    db.session.commit()
    r = _vender(client, caixa_ctx, p)
    assert r.status_code == 400
    assert "lote vencido" in r.get_json()["error"]


def test_config_expoe_e_salva_o_bloqueio(client, session, caixa_ctx):
    r = client.get("/api/configuracao/", headers=caixa_ctx["headers"])
    assert r.status_code == 200
    assert "bloquear_venda_vencido" in r.get_data(as_text=True)
    r = client.put("/api/configuracao/", headers=caixa_ctx["headers"], json={"bloquear_venda_vencido": False})
    assert r.status_code in (200, 201), r.get_data(as_text=True)
    session.expire_all()
    assert session.get(Configuracao, caixa_ctx["cfg"].id).bloquear_venda_vencido is False
