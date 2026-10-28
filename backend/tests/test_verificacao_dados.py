"""Verificação noturna: base consistente passa; cada tipo de divergência é apontado."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto, ProdutoLote, Venda, VendaItem
from app.services.verificacao_dados import verificar


@pytest.fixture
def base(session):
    estab = session.query(Estabelecimento).first()
    func = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Verif")
    session.add(cat)
    session.flush()
    p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz 5kg", preco_custo=Decimal("20"),
                preco_venda=Decimal("30"), quantidade=Decimal("8"), quantidade_vendida=Decimal("2"),
                total_vendido=Decimal("60"))
    session.add(p)
    session.flush()
    session.add(ProdutoLote(estabelecimento_id=estab.id, produto_id=p.id, numero_lote="L1", quantidade=8,
                            quantidade_inicial=10, data_entrada=date.today(),
                            data_validade=date.today() + timedelta(days=90), preco_custo_unitario=20, ativo=True))
    v = Venda(estabelecimento_id=estab.id, funcionario_id=func.id, codigo="VER-1", subtotal=Decimal("60"),
              desconto=Decimal("0"), total=Decimal("60"), status="finalizada")
    session.add(v)
    session.flush()
    session.add(VendaItem(estabelecimento_id=estab.id, venda_id=v.id, produto_id=p.id, produto_nome=p.nome,
                          quantidade=Decimal("2"), preco_unitario=Decimal("30"), total_item=Decimal("60")))
    session.commit()
    return dict(estab=estab, produto=p, venda=v)


def _checagens(estab_id):
    return verificar(estab_id)["por_checagem"]


def test_base_consistente_passa(session, base):
    r = verificar(base["estab"].id)
    assert r["falhas"] == []
    assert r["ok"] is True, r["divergencias"]


def test_aponta_cada_divergencia(session, base):
    p, v = base["produto"], base["venda"]
    p.quantidade = Decimal("5")          # lote tem 8: agregado perdeu entrada
    p.total_vendido = Decimal("10")      # itens somam 60
    v.total = Decimal("55")              # subtotal 60 - desconto 0
    session.commit()
    assert _checagens(base["estab"].id) == {"lotes_acima_do_estoque": 1, "vendas_do_produto_total": 1, "venda_total": 1}

    p.quantidade = Decimal("-1")
    p.eh_grade_modelo = True             # modelo ativo e com estoque
    session.commit()
    c = _checagens(base["estab"].id)
    assert c["estoque_negativo"] == 1 and c["modelo_de_grade"] == 1


def test_quantidade_vendida_divergente(session, base):
    base["produto"].quantidade_vendida = Decimal("5")  # itens de venda somam 2
    session.commit()
    assert _checagens(base["estab"].id) == {"vendas_do_produto_qtd": 1}


def test_comando_cli(app, session, base):
    runner = app.test_cli_runner()
    ok = runner.invoke(args=["verificar-dados", "--estab", str(base["estab"].id)])
    assert ok.exit_code == 0, ok.output
    base["venda"].total = Decimal("1")
    session.commit()
    ruim = runner.invoke(args=["verificar-dados", "--estab", str(base["estab"].id)])
    assert ruim.exit_code == 1
    assert "venda_total" in ruim.output
