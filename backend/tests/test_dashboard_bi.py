"""BI configurável: o fato por produto que alimenta filtros, faixas e correlações.

Prova as contas que o painel mostra (receita, margem, capital, GMROI, cobertura,
ABC, XYZ, Δ% contra o período anterior, cesta) e o Δ% da aba de categorias, que
ficava sempre "sem base anterior" quando o nome exibido diferia da chave.
"""
from datetime import datetime, timedelta
from decimal import Decimal
import uuid

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto, Venda, VendaItem
from app.services.dashboard_bi import analise_bi, resolver_periodo
from app.services.dashboard_categorias import analise_por_categoria


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    sufixo = datetime.now().strftime("%H%M%S%f")
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome=f"Bazar › Cozinha {sufixo}",
                           codigo=f"bazar.cozinha.{sufixo}")
    session.add(cat)
    session.flush()

    def produto(nome, custo, venda, estoque):
        return Produto(
            estabelecimento_id=estab.id, categoria_id=cat.id, nome=f"{nome} {sufixo}",
            categoria_oficial=f"bazar.cozinha.{sufixo}", subcategoria_oficial=f"bazar.cozinha.panela.{sufixo}",
            familia_produto="bazar", preco_custo=Decimal(custo), preco_venda=Decimal(venda),
            quantidade=Decimal(estoque),
        )

    panela = produto("Panela", "50", "100", "10")
    tampa = produto("Tampa", "5", "10", "40")
    parado = produto("Forma Parada", "20", "30", "5")
    session.add_all([panela, tampa, parado])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": admin.role or "admin"})
    yield dict(estab=estab, admin=admin, cat=cat, panela=panela, tampa=tampa, parado=parado,
               headers={"Authorization": f"Bearer {token}"})

    # O banco de teste é da sessão inteira: sem limpar, estas vendas viram a
    # categoria líder dos testes de /categorias que rodam depois.
    session.rollback()
    ids = [panela.id, tampa.id, parado.id]
    vendas = [v for (v,) in session.query(VendaItem.venda_id).filter(VendaItem.produto_id.in_(ids)).distinct()]
    session.query(VendaItem).filter(VendaItem.venda_id.in_(vendas)).delete(synchronize_session=False)
    session.query(Venda).filter(Venda.id.in_(vendas)).delete(synchronize_session=False)
    session.query(Produto).filter(Produto.id.in_(ids)).delete(synchronize_session=False)
    session.query(CategoriaProduto).filter(CategoriaProduto.id == cat.id).delete(synchronize_session=False)
    session.commit()


def _venda(session, ctx, itens, quando):
    total = sum(t for _, _, t in itens)
    venda = Venda(
        estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id,
        codigo=f"BI{uuid.uuid4().hex[:16]}", subtotal=total, total=total,
        valor_recebido=total, troco=Decimal("0"), status="finalizada", data_venda=quando,
    )
    session.add(venda)
    session.flush()
    for produto, qtd, valor in itens:
        session.add(VendaItem(
            estabelecimento_id=ctx["estab"].id, venda_id=venda.id, produto_id=produto.id,
            produto_nome=produto.nome, quantidade=Decimal(str(qtd)),
            preco_unitario=Decimal(str(valor / qtd)), desconto=Decimal("0"),
            total_item=Decimal(str(valor)), custo_unitario=produto.preco_custo,
        ))
    session.commit()


def _linha(dados, produto):
    return next(p for p in dados["produtos"] if p["id"] == produto.id)


def test_fato_por_produto_contas_e_comparacao(session, ctx):
    agora = datetime.utcnow()
    # Período atual (7 dias): panela 2 un R$ 200 + tampa 4 un R$ 40, na mesma venda.
    _venda(session, ctx, [(ctx["panela"], 2, 200), (ctx["tampa"], 4, 40)], agora - timedelta(hours=1))
    # Período anterior: panela R$ 100.
    _venda(session, ctx, [(ctx["panela"], 1, 100)], agora - timedelta(days=10))

    dados = analise_bi(ctx["estab"].id, dias=7)
    panela = _linha(dados, ctx["panela"])

    assert panela["receita"] == 200
    assert panela["custo"] == 100
    assert panela["margem"] == 100
    assert panela["margem_pct"] == 50.0
    assert panela["receita_anterior"] == 100
    assert panela["variacao_pct"] == 100.0
    assert panela["capital_custo"] == 500          # 10 un × R$ 50
    assert panela["capital_venda"] == 1000
    assert panela["gmroi"] == 0.2                  # 100 de margem ÷ 500 de capital
    assert panela["cobertura_dias"] == pytest.approx(10 / (2 / 7), rel=0.01)
    assert panela["familia"] != "bazar"            # rótulo de gente, não slug
    assert panela["dias_sem_venda"] == 0

    parado = _linha(dados, ctx["parado"])
    assert parado["receita"] == 0
    assert parado["nunca_vendeu"] is True
    assert parado["cobertura_dias"] is None
    assert parado["abc"] is None


def test_abc_xyz_e_cesta(session, ctx):
    agora = datetime.utcnow()
    # Tampa sai todo dia (regular → X); panela sai num dia só (irregular → Z).
    for d in range(7):
        _venda(session, ctx, [(ctx["tampa"], 1, 10)], agora - timedelta(days=d, hours=1))
    _venda(session, ctx, [(ctx["panela"], 3, 300), (ctx["parado"], 1, 30)], agora - timedelta(hours=2))
    _venda(session, ctx, [(ctx["panela"], 1, 100), (ctx["parado"], 1, 30)], agora - timedelta(hours=3))

    dados = analise_bi(ctx["estab"].id, dias=7)
    tampa, panela = _linha(dados, ctx["tampa"]), _linha(dados, ctx["panela"])

    assert panela["abc"] == "A"
    assert tampa["xyz"] == "X"
    assert panela["xyz"] == "Z"

    par = next(p for p in dados["cesta"]["pares"]
               if {p["a"], p["b"]} == {ctx["panela"].id, ctx["parado"].id})
    assert par["vezes"] == 2


def test_periodo_por_datas_e_rota(client, session, ctx):
    inicio, fim = resolver_periodo(None, "2026-10-01", "2026-10-31")
    assert (fim - inicio).days == 30

    resposta = client.get("/api/dashboard/bi?de=2026-10-01&ate=2026-10-31", headers=ctx["headers"])
    if resposta.status_code == 403:
        pytest.skip("Loja de teste sem plano Pro")
    assert resposta.status_code == 200, resposta.get_json()
    corpo = resposta.get_json()["data"]
    assert corpo["periodo"]["dias"] == 31
    assert {"produtos", "temporal", "cesta"} <= set(corpo)

    invalida = client.get("/api/dashboard/bi?de=ontem&ate=hoje", headers=ctx["headers"])
    assert invalida.status_code == 400


def test_categorias_variacao_usa_a_chave_e_nao_o_rotulo(session, ctx):
    agora = datetime.now()  # a janela de /categorias usa o relógio do servidor
    _venda(session, ctx, [(ctx["panela"], 1, 200)], agora - timedelta(hours=1))
    _venda(session, ctx, [(ctx["panela"], 1, 100)], agora - timedelta(days=10))

    dados = analise_por_categoria(ctx["estab"].id, 7)
    bloco = next(c for c in dados["categorias"] if c["categoria"] == ctx["cat"].nome)
    assert bloco["variacao_pct"] == 100.0
    assert "_chave" not in bloco
