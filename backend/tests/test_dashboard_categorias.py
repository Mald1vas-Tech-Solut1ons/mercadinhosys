"""BI por categoria/subcategoria — receita, margem, participação e curva ABC.

O produto inteiro foi organizado em família → categoria → subcategoria e o painél
não mostrava nada disso: o dono não sabia qual seção paga o aluguel nem qual dá
prejuízo. Este teste prova a conta e o recorte.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto, Venda, VendaItem
from app.services.dashboard_categorias import (
    _rotulo_humano,
    _rotulo_subcategoria,
    analise_por_categoria,
)


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

    cat_bebida = CategoriaProduto(estabelecimento_id=estab.id, nome="Bebidas", codigo="bebidas")
    cat_limpeza = CategoriaProduto(estabelecimento_id=estab.id, nome="Limpeza", codigo="limpeza")
    session.add_all([cat_bebida, cat_limpeza])
    session.flush()

    refrigerante = Produto(
        estabelecimento_id=estab.id, categoria_id=cat_bebida.id, nome="Refrigerante 2L",
        categoria_oficial="Bebidas", subcategoria_oficial="Refrigerantes", familia_produto="Bebidas",
        preco_custo=Decimal("5"), preco_venda=Decimal("10"), quantidade=Decimal("50"),
    )
    cerveja = Produto(
        estabelecimento_id=estab.id, categoria_id=cat_bebida.id, nome="Cerveja Lata",
        categoria_oficial="Bebidas", subcategoria_oficial="Cervejas", familia_produto="Bebidas",
        preco_custo=Decimal("2"), preco_venda=Decimal("4"), quantidade=Decimal("100"),
    )
    detergente = Produto(
        estabelecimento_id=estab.id, categoria_id=cat_limpeza.id, nome="Detergente",
        categoria_oficial="Limpeza", subcategoria_oficial="Lava-louças", familia_produto="Limpeza",
        preco_custo=Decimal("3"), preco_venda=Decimal("6"), quantidade=Decimal("30"),
    )
    session.add_all([refrigerante, cerveja, detergente])
    session.commit()

    return dict(estab=estab, admin=admin,
                produtos=(refrigerante, cerveja, detergente),
                headers={"Authorization": "Bearer " + create_access_token(
                    identity=str(admin.id), additional_claims={
                        "estabelecimento_id": estab.id, "role": admin.role or "admin"})})


def _venda(session, ctx, itens, quando=None):
    """itens: [(produto, quantidade, total)]"""
    venda = Venda(
        estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id,
        codigo=f"T{datetime.now().strftime('%H%M%S%f')[:14]}",
        subtotal=sum(t for _, _, t in itens), total=sum(t for _, _, t in itens),
        valor_recebido=sum(t for _, _, t in itens), troco=Decimal("0"),
        status="finalizada", data_venda=quando or datetime.now(),
    )
    session.add(venda)
    session.flush()
    for produto, qtd, total in itens:
        session.add(VendaItem(
            estabelecimento_id=ctx["estab"].id, venda_id=venda.id, produto_id=produto.id,
            produto_nome=produto.nome, quantidade=Decimal(str(qtd)),
            preco_unitario=Decimal(str(total / qtd)), desconto=Decimal("0"),
            total_item=Decimal(str(total)), custo_unitario=produto.preco_custo,
        ))
    session.commit()
    return venda


def test_receita_e_participacao_por_categoria(session, ctx):
    refrigerante, cerveja, detergente = ctx["produtos"]
    _venda(session, ctx, [(refrigerante, 10, 100), (cerveja, 25, 100)])  # Bebidas 200
    _venda(session, ctx, [(detergente, 10, 60)])                          # Limpeza 60

    dados = analise_por_categoria(ctx["estab"].id, dias=30)
    por_nome = {c["categoria"]: c for c in dados["categorias"]}

    assert dados["resumo"]["receita"] == 260.0
    assert por_nome["Bebidas"]["receita"] == 200.0
    assert por_nome["Bebidas"]["participacao"] == 76.9
    assert por_nome["Limpeza"]["receita"] == 60.0
    assert por_nome["Limpeza"]["participacao"] == 23.1


def test_margem_usa_custo_do_item(session, ctx):
    refrigerante, cerveja, detergente = ctx["produtos"]
    # Bebidas: custo 5*10 + 2*25 = 100 -> margem 100 sobre 200 = 50%
    _venda(session, ctx, [(refrigerante, 10, 100), (cerveja, 25, 100)])

    dados = analise_por_categoria(ctx["estab"].id, dias=30)
    bebidas = next(c for c in dados["categorias"] if c["categoria"] == "Bebidas")

    assert bebidas["margem"] == 100.0
    assert bebidas["margem_pct"] == 50.0


def test_drilldown_por_subcategoria(session, ctx):
    refrigerante, cerveja, detergente = ctx["produtos"]
    _venda(session, ctx, [(refrigerante, 10, 100), (cerveja, 25, 100)])

    dados = analise_por_categoria(ctx["estab"].id, dias=30)
    bebidas = next(c for c in dados["categorias"] if c["categoria"] == "Bebidas")
    subs = {s["subcategoria"]: s["receita"] for s in bebidas["subcategorias"]}

    assert subs == {"Refrigerantes": 100.0, "Cervejas": 100.0}


def test_venda_cancelada_e_de_fora_da_janela_nao_entram(session, ctx):
    refrigerante, _, detergente = ctx["produtos"]
    cancelada = _venda(session, ctx, [(detergente, 10, 60)])
    cancelada.status = "cancelada"
    session.commit()
    _venda(session, ctx, [(refrigerante, 10, 100)],
           quando=datetime.now() - timedelta(days=90))  # fora dos 30 dias

    dados = analise_por_categoria(ctx["estab"].id, dias=30)

    assert dados["resumo"]["receita"] == 0.0
    assert dados["categorias"] == []


def test_variacao_contra_periodo_anterior(session, ctx):
    refrigerante, _, _ = ctx["produtos"]
    _venda(session, ctx, [(refrigerante, 10, 100)],
           quando=datetime.now() - timedelta(days=45))  # período anterior
    _venda(session, ctx, [(refrigerante, 15, 150)])      # período atual

    dados = analise_por_categoria(ctx["estab"].id, dias=30)
    bebidas = next(c for c in dados["categorias"] if c["categoria"] == "Bebidas")

    assert dados["resumo"]["receita_periodo_anterior"] == 100.0
    assert bebidas["variacao_pct"] == 50.0


def test_curva_abc_marca_a_categoria_que_puxa_o_faturamento(session, ctx):
    refrigerante, cerveja, detergente = ctx["produtos"]
    _venda(session, ctx, [(refrigerante, 10, 100), (cerveja, 25, 100)])  # Bebidas 200
    _venda(session, ctx, [(detergente, 5, 30)])                          # Limpeza 30

    dados = analise_por_categoria(ctx["estab"].id, dias=30)

    assert dados["categorias"][0]["categoria"] == "Bebidas"
    assert dados["categorias"][0]["classe_abc"] == "A"


def test_slug_nao_vaza_para_a_tela(session, ctx):
    """A base real grava `bazar.cozinha`; o dono não pode ler slug no painel."""
    assert _rotulo_humano("bazar.cozinha") == "Bazar Cozinha"
    assert _rotulo_humano("bazar.organizacao_armazenamento") == "Bazar Organizacao Armazenamento"
    assert _rotulo_humano("perfumaria_higiene.cabelo") == "Perfumaria Higiene Cabelo"
    assert _rotulo_subcategoria("bazar.mesa.copo") == "Copo"
    assert _rotulo_subcategoria("bazar.cozinha.utensilio_cozinha") == "Utensilio Cozinha"
    assert _rotulo_humano("") == "Sem categoria"


def test_rotulo_do_cadastro_tem_prioridade_sobre_o_slug(session, ctx):
    refrigerante, _, _ = ctx["produtos"]

    dados = analise_por_categoria(ctx["estab"].id, dias=1)  # sem venda ainda
    assert dados["categorias"] == []

    _venda(session, ctx, [(refrigerante, 1, 10)])
    dados = analise_por_categoria(ctx["estab"].id, dias=1)

    # categoria vem do cadastro (Bebidas), não do slug oficial
    assert dados["categorias"][0]["categoria"] == "Bebidas"


def test_estoque_por_categoria_no_mesmo_payload(session, ctx):
    """Loja em implantação: sem venda, o painel ainda precisa mostrar o estoque."""
    refrigerante, cerveja, detergente = ctx["produtos"]
    refrigerante.quantidade = Decimal("10")   # 10 * 5 = 50 a custo
    cerveja.quantidade = Decimal("20")        # 20 * 2 = 40 a custo
    detergente.quantidade = Decimal("5")      # 5 * 3 = 15 a custo
    session.commit()

    dados = analise_por_categoria(ctx["estab"].id, dias=30)
    estoque = dados["estoque"]

    assert dados["categorias"] == []          # nenhuma venda
    assert estoque["resumo"]["valor_custo"] == 105.0
    assert estoque["resumo"]["itens"] == 3
    bebidas = next(c for c in estoque["categorias"] if c["categoria"] == "Bebidas")
    assert bebidas["valor_custo"] == 90.0
    assert bebidas["participacao_custo"] == 85.7
    assert bebidas["margem_potencial_pct"] == 50.0
