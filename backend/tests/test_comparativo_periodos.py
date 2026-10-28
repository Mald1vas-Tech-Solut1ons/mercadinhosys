"""Comparação de períodos: a ponte fecha exata e os produtos que mudaram aparecem certo."""
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Estabelecimento, Funcionario, Produto, Venda, VendaItem
from app.services.comparativo_service import comparar, periodos
from app.utils.timezone import hoje_local


def _venda(session, estab, func, dia, itens, codigo, status="finalizada"):
    # 15h UTC = meio-dia em São Paulo: cai no mesmo dia local.
    quando = datetime.combine(dia, datetime.min.time()).replace(hour=15)
    total = sum(Decimal(str(v)) for _, v in itens)
    v = Venda(estabelecimento_id=estab.id, funcionario_id=func.id, codigo=codigo, subtotal=total,
              desconto=Decimal("0"), total=total, status=status, data_venda=quando)
    session.add(v)
    session.flush()
    for p, valor in itens:
        session.add(VendaItem(estabelecimento_id=estab.id, venda_id=v.id, produto_id=p.id, produto_nome=p.nome,
                              quantidade=Decimal("1"), preco_unitario=Decimal(str(valor)), total_item=Decimal(str(valor))))


@pytest.fixture
def base(session):
    estab = session.query(Estabelecimento).first()
    func = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Comp")
    session.add(cat)
    session.flush()
    arroz = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz", preco_custo=1, preco_venda=10, quantidade=50)
    leite = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Leite", preco_custo=1, preco_venda=5, quantidade=0)
    cafe = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Café", preco_custo=1, preco_venda=20, quantidade=9)
    session.add_all([arroz, leite, cafe])
    session.flush()
    hoje = hoje_local()
    # anterior (8 a 14 dias atrás): 2 vendas, R$ 40  -> ticket 20
    _venda(session, estab, func, hoje - timedelta(days=10), [(arroz, 10), (leite, 10)], "A1")
    _venda(session, estab, func, hoje - timedelta(days=9), [(arroz, 20)], "A2")
    # atual (últimos 7 dias): 3 vendas, R$ 90 -> ticket 30; leite sumiu (sem estoque), café entrou
    _venda(session, estab, func, hoje - timedelta(days=2), [(arroz, 30)], "B1")
    _venda(session, estab, func, hoje - timedelta(days=1), [(cafe, 20), (arroz, 10)], "B2")
    _venda(session, estab, func, hoje, [(cafe, 30)], "B3")
    _venda(session, estab, func, hoje, [(cafe, 999)], "B4", status="cancelada")  # não conta
    session.commit()
    token = create_access_token(identity=str(func.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, headers={"Authorization": f"Bearer {token}"})


def test_periodos_tem_mesma_duracao():
    (i1, f1), (i0, f0) = periodos(7)
    assert (f1 - i1).days == 6 and (f0 - i0).days == 6 and (i1 - f0).days == 1


def test_ponte_fecha_exata(session, base):
    r = comparar(base["estab"].id, dias=7)
    assert (r["anterior"]["vendas"], r["anterior"]["faturamento"], r["anterior"]["ticket"]) == (2, 40.0, 20.0)
    assert (r["atual"]["vendas"], r["atual"]["faturamento"], r["atual"]["ticket"]) == (3, 90.0, 30.0)
    p = r["ponte"]
    assert p["efeito_quantidade"] == 20.0      # +1 venda x ticket anterior 20
    assert p["efeito_ticket"] == 30.0          # +10 de ticket x 3 vendas
    assert round(p["anterior"] + p["efeito_quantidade"] + p["efeito_ticket"], 2) == p["atual"]
    assert r["variacao"]["faturamento_pct"] == 125.0


def test_produtos_que_mudaram_e_ruptura(session, base):
    r = comparar(base["estab"].id, dias=7)["produtos"]
    assert [g["nome"] for g in r["ganhos"]] == ["Café", "Arroz"]
    assert [p["nome"] for p in r["perdas"]] == ["Leite"]
    assert [x["nome"] for x in r["ruptura"]] == ["Leite"]   # vendia, zerou estoque, parou de vender
    assert r["ruptura_valor_anterior"] == 10.0


def test_rota(client, base):
    r = client.get("/api/dashboard/comparativo?days=7", headers=base["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["ponte"]["atual"] == 90.0
    hoje = hoje_local()
    r = client.get(f"/api/dashboard/comparativo?start_date={hoje}&end_date={hoje - timedelta(days=3)}", headers=base["headers"])
    assert r.status_code == 400
