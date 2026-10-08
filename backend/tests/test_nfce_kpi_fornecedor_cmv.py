"""NFC-e (data e destinatário), KPI do vendedor, nota do fornecedor e CMV com custo histórico."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from flask_jwt_extended import create_access_token

from app.models import (Caixa, CategoriaProduto, Cliente, Estabelecimento, Fornecedor, Funcionario, PedidoCompra,
                        PedidoCompraItem, PedidoVenda, Produto, ProdutoLote, Venda, VendaItem, db)
from app.services import fornecedor_score
from app.services.fiscal import emissao_service
from app.utils.timezone import fuso_da_uf, local_date_to_utc_naive, to_local


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Geral")
    forn = Fornecedor(estabelecimento_id=estab.id, nome_fantasia="Fornecedor Score", razao_social="Fornecedor Score LTDA",
                      cnpj="11222333000144", telefone="11999999999", email="score@example.test", cep="01000000",
                      logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP", pais="Brasil")
    cliente = Cliente(estabelecimento_id=estab.id, nome="Cliente Nota", cpf="52998224725", celular="11999999999",
                      cep="01000000", logradouro="Rua", numero="1", bairro="Centro", cidade="São Paulo", estado="SP",
                      limite_credito=Decimal("1000"), saldo_devedor=Decimal("0"))
    session.add_all([cat, forn, cliente])
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Item", preco_custo=Decimal("40"),
                   preco_venda=Decimal("100"), quantidade=Decimal("100"), ncm="22021000", cfop_padrao="5102",
                   csosn="102")
    session.add(prod)
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=estab.id, produto_id=prod.id, fornecedor_id=forn.id, numero_lote="L1",
                    quantidade=100, quantidade_inicial=100, data_entrada=date.today(),
                    data_validade=date.today() + timedelta(days=90), preco_custo_unitario=40, ativo=True),
        Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="N1", saldo_inicial=0,
              saldo_atual=0, status="aberto"),
    ])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, forn=forn, cliente=cliente, prod=prod,
                headers={"Authorization": f"Bearer {token}"})


def _vender(client, ctx, cliente=None):
    corpo = {"subtotal": 100, "total": 100, "desconto": 0,
             "items": [{"id": ctx["prod"].id, "quantidade": 1, "preco_unitario": 100}],
             "pagamentos": [{"forma": "dinheiro", "valor": 100}]}
    if cliente:
        corpo["cliente_id"] = cliente.id
    resposta = client.post("/api/pdv/finalizar", headers=ctx["headers"], json=corpo)
    assert resposta.status_code == 201, resposta.get_json()
    return Venda.query.order_by(Venda.id.desc()).first()


# ───────────────────────── NFC-e ─────────────────────────

@pytest.mark.parametrize("uf, esperado", [
    ("SP", "2026-10-08T12:00:00-03:00"),
    ("AM", "2026-10-08T11:00:00-04:00"),
    ("MT", "2026-10-08T11:00:00-04:00"),
    ("AC", "2026-10-08T10:00:00-05:00"),
    (None, "2026-10-08T12:00:00-03:00"),
    ("zz", "2026-10-08T12:00:00-03:00"),
])
def test_data_de_emissao_leva_o_fuso_real_do_emitente(uf, esperado):
    venda = SimpleNamespace(data_venda=datetime(2026, 10, 8, 15, 0, 0))  # banco guarda UTC naive
    assert emissao_service._data_emissao(venda, SimpleNamespace(estado=uf)) == esperado


def test_data_de_emissao_aceita_datetime_com_fuso():
    venda = SimpleNamespace(data_venda=datetime(2026, 10, 8, 15, 0, 0, tzinfo=timezone.utc))
    assert emissao_service._data_emissao(venda, SimpleNamespace(estado="AM")).endswith("-04:00")


def test_fuso_da_uf():
    assert fuso_da_uf("am").utcoffset(None) == timedelta(hours=-4)
    assert fuso_da_uf("RJ").utcoffset(None) == timedelta(hours=-3)


def test_payload_sem_cliente_nao_leva_destinatario(client, session, ctx):
    venda = _vender(client, ctx)
    payload = emissao_service._build_payload(venda, ctx["estab"], 1, 1)
    assert not any(k.endswith("_destinatario") for k in payload)
    assert payload["data_emissao"].endswith("-04:00")  # loja de teste fica em Manaus (AM)


def test_payload_identifica_cpf_do_comprador(client, session, ctx):
    venda = _vender(client, ctx, ctx["cliente"])
    payload = emissao_service._build_payload(venda, ctx["estab"], 1, 1)
    assert payload["cpf_destinatario"] == "52998224725"
    assert payload["nome_destinatario"] == "Cliente Nota"
    assert "cnpj_destinatario" not in payload


def test_payload_identifica_cnpj_do_comprador_pj(client, session, ctx):
    pj = Cliente(estabelecimento_id=ctx["estab"].id, nome="Alfa", tipo_pessoa="PJ", cpf=None, cnpj="11.222.333/0001-81",
                 razao_social="Alfa Distribuidora LTDA", celular="11999999999", cep="01000000", logradouro="Rua",
                 numero="1", bairro="Centro", cidade="São Paulo", estado="SP", limite_credito=Decimal("0"),
                 saldo_devedor=Decimal("0"))
    session.add(pj)
    session.commit()
    venda = _vender(client, ctx, pj)
    payload = emissao_service._build_payload(venda, ctx["estab"], 1, 1)
    assert payload["cnpj_destinatario"] == "11222333000181"
    assert payload["nome_destinatario"] == "Alfa Distribuidora LTDA"
    assert "cpf_destinatario" not in payload


def test_payload_ignora_documento_invalido(client, session, ctx, monkeypatch):
    ctx["cliente"].cpf = "52998224724"  # dígito verificador errado
    session.commit()
    venda = _vender(client, ctx, ctx["cliente"])
    monkeypatch.setenv("FLASK_ENV", "testing")  # validadores reais
    payload = emissao_service._build_payload(venda, ctx["estab"], 1, 1)
    assert not any(k.endswith("_destinatario") for k in payload)


# ───────────────────────── KPI do vendedor ─────────────────────────

@pytest.fixture
def vendedor(session, ctx):
    func = Funcionario(estabelecimento_id=ctx["estab"].id, nome="Vendedor KPI", cpf="98765432100",
                       username="vend_kpi", role="VENDEDOR", ativo=True, data_nascimento=date(1990, 1, 1),
                       celular="11999999999", email="kpi@example.test", cargo="Vendedor",
                       data_admissao=date(2024, 1, 1), salario_base=Decimal("1"))
    func.set_password("vendedor-teste")
    session.add(func)
    session.commit()
    token = create_access_token(identity=str(func.id), additional_claims={
        "estabelecimento_id": ctx["estab"].id, "role": "VENDEDOR"})
    return dict(func=func, headers={"Authorization": f"Bearer {token}"})


def _pedido(session, ctx, vendedor, cliente, total, status, emissao, codigo):
    pedido = PedidoVenda(estabelecimento_id=ctx["estab"].id, cliente_id=cliente.id, vendedor_id=vendedor["func"].id,
                         codigo=codigo, status=status, subtotal=total, total=total, data_emissao=emissao)
    session.add(pedido)
    session.commit()
    return pedido


def test_kpi_conta_so_faturado_no_mes_local_e_mostra_pendente_a_parte(client, session, ctx, vendedor):
    outro = Cliente(estabelecimento_id=ctx["estab"].id, nome="Outro", cpf="11144477735", celular="11999999999",
                    cep="01000000", logradouro="Rua", numero="1", bairro="Centro", cidade="São Paulo", estado="SP")
    session.add(outro)
    session.commit()
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    primeiro_dia = to_local(datetime.now(timezone.utc)).date().replace(day=1)
    inicio_mes = local_date_to_utc_naive(primeiro_dia)

    _pedido(session, ctx, vendedor, ctx["cliente"], 100, "faturado", inicio_mes + timedelta(minutes=1), "P1")
    _pedido(session, ctx, vendedor, ctx["cliente"], 1000, "faturado", inicio_mes - timedelta(minutes=1), "P2")  # mês anterior
    _pedido(session, ctx, vendedor, ctx["cliente"], 50, "pendente", agora, "P3")
    _pedido(session, ctx, vendedor, ctx["cliente"], 700, "cancelado", agora, "P4")
    _pedido(session, ctx, vendedor, outro, 200, "faturado", agora, "P5")

    resposta = client.get("/api/sfa/kpi/vendedor", headers=vendedor["headers"])
    assert resposta.status_code == 200, resposta.get_json()
    dados = resposta.get_json()["data"]
    assert dados["realizado"]["faturamento"] == pytest.approx(300.0)
    assert dados["realizado"]["pipeline_pendente"] == pytest.approx(50.0)
    assert dados["carteira"]["positivados"] == 2


def test_kpi_do_vendedor_nao_mistura_pedidos_de_outro_vendedor(client, session, ctx, vendedor):
    admin_pedido = PedidoVenda(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cliente"].id,
                               vendedor_id=ctx["admin"].id, codigo="ADM", status="faturado", subtotal=900, total=900,
                               data_emissao=datetime.now(timezone.utc).replace(tzinfo=None))
    session.add(admin_pedido)
    session.commit()
    dados = client.get("/api/sfa/kpi/vendedor", headers=vendedor["headers"]).get_json()["data"]
    assert dados["realizado"]["faturamento"] == 0


# ───────────────────────── nota do fornecedor ─────────────────────────

def _pedido_compra(status, previsao, recebimento, itens=(), data_pedido=None, **extra):
    return SimpleNamespace(
        status=status, data_pedido=data_pedido or datetime(2026, 9, 1), data_previsao_entrega=previsao,
        data_recebimento=recebimento, subtotal=extra.get("subtotal", 0), desconto=extra.get("desconto", 0),
        total=extra.get("total", 0),
        itens=[SimpleNamespace(quantidade_solicitada=s, quantidade_recebida=r, quantidade_avariada=a,
                               preco_unitario=extra.get("preco", 10), desconto_percentual=extra.get("desc_item", 0))
               for s, r, a in itens])


HOJE = date(2026, 10, 8)


def test_pedido_sem_data_de_recebimento_nao_conta_como_no_prazo():
    pedidos = [_pedido_compra("recebido", date(2026, 9, 10), None, [(10, 10, 0)])]
    avaliacao = fornecedor_score.avaliar_entregas(pedidos, 7, HOJE)
    assert avaliacao["amostra"] == 0 and avaliacao["sem_data_recebimento"] == 1


def test_recebimento_parcial_so_conta_quando_o_prazo_ja_venceu():
    no_prazo = _pedido_compra("parcial", date(2026, 10, 20), date(2026, 10, 1), [(10, 4, 0)])
    vencido = _pedido_compra("parcial", date(2026, 10, 1), date(2026, 9, 28), [(10, 4, 0)])
    avaliacao = fornecedor_score.avaliar_entregas([no_prazo, vencido], 7, HOJE)
    assert avaliacao["amostra"] == 1 and avaliacao["no_prazo"] == 0
    assert avaliacao["atraso_medio_dias"] == 7  # de 01/10 até hoje (08/10)


def test_atraso_medio_considera_so_os_pedidos_atrasados():
    pedidos = [
        _pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 9), [(10, 10, 0)]),
        _pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 10), [(10, 10, 0)]),
        _pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 14), [(10, 10, 0)]),
        _pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 12), [(10, 10, 0)]),
    ]
    avaliacao = fornecedor_score.avaliar_entregas(pedidos, 7, HOJE)
    assert avaliacao["percentual_no_prazo"] == 50.0
    assert avaliacao["atraso_medio_dias"] == 3.0  # (4 + 2) / 2 atrasados, e não 6 / 4


def test_fill_rate_desconta_falta_e_avaria():
    pedidos = [_pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 10), [(100, 90, 10)])]
    avaliacao = fornecedor_score.avaliar_entregas(pedidos, 7, HOJE)
    assert avaliacao["fill_rate"] == pytest.approx(80.0)  # 90 recebidos − 10 avariados
    assert avaliacao["taxa_avaria"] == pytest.approx(10.0)


def test_nota_neutra_e_nao_confiavel_abaixo_da_amostra_minima():
    pedidos = [_pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 10), [(10, 10, 0)]) for _ in range(2)]
    nota = fornecedor_score.calcular_score(fornecedor_score.avaliar_entregas(pedidos, 7, HOJE), 10.0, 60.0, 90000)
    assert nota["score"] == fornecedor_score.SCORE_NEUTRO
    assert nota["confiavel"] is False and nota["classificacao"] is None


def test_nota_pesa_pontualidade_fill_rate_e_condicoes_comerciais():
    otimos = [_pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 9), [(10, 10, 0)]) for _ in range(4)]
    ruins = [_pedido_compra("recebido", date(2026, 9, 10), date(2026, 9, 25), [(10, 5, 1)]) for _ in range(4)]
    bom = fornecedor_score.calcular_score(fornecedor_score.avaliar_entregas(otimos, 7, HOJE), 10.0, 60.0, 90000)
    sem_condicoes = fornecedor_score.calcular_score(fornecedor_score.avaliar_entregas(otimos, 7, HOJE), 0.0, 0.0, 90000)
    mau = fornecedor_score.calcular_score(fornecedor_score.avaliar_entregas(ruins, 7, HOJE), 10.0, 60.0, 90000)
    assert bom["confiavel"] and bom["score"] == 100 and bom["classificacao"] == "PREMIUM"
    assert sem_condicoes["score"] == 80 and sem_condicoes["classificacao"] == "A"
    assert mau["score"] < 50 and mau["classificacao"] == "C"


def test_desconto_medio_ponderado_pelo_valor():
    pedidos = [_pedido_compra("recebido", None, None, [(10, 10, 0)], preco=100, desc_item=10),
               _pedido_compra("recebido", None, None, [(10, 10, 0)], preco=100, desc_item=0)]
    assert fornecedor_score.desconto_medio(pedidos) == pytest.approx(5.0)


def _compra_recebida(client, ctx, em_dia=True):
    criar = client.post("/api/pedidos-compra/", headers=ctx["headers"], json={
        "fornecedor_id": ctx["forn"].id,
        "itens": [{"produto_id": ctx["prod"].id, "quantidade": 10, "preco_unitario": 4}]})
    assert criar.status_code == 201, criar.get_json()
    pedido_id = criar.get_json()["pedido"]["id"]
    item = PedidoCompraItem.query.filter_by(pedido_id=pedido_id).first()
    if not em_dia:
        PedidoCompra.query.filter_by(id=pedido_id).update({"data_previsao_entrega": date.today() - timedelta(days=10)})
        db.session.commit()
    receber = client.post("/api/pedidos-compra/receber", headers=ctx["headers"], json={
        "pedido_id": pedido_id,
        "itens": [{"item_id": item.id, "quantidade_recebida": 10,
                   "data_validade": (date.today() + timedelta(days=60)).isoformat()}]})
    assert receber.status_code == 200, receber.get_json()
    return pedido_id


def test_get_inteligencia_nao_grava_nada_no_fornecedor(client, session, ctx):
    for _ in range(3):
        _compra_recebida(client, ctx)
    forn = db.session.get(Fornecedor, ctx["forn"].id)
    antes = (forn.score_geral, forn.classificacao, forn.total_compras, forn.atraso_medio_dias)
    forn.score_geral, forn.classificacao = 33, "C"  # estado "antigo" gravado
    db.session.commit()

    resposta = client.get(f"/api/fornecedores/{ctx['forn'].id}/inteligencia", headers=ctx["headers"])
    assert resposta.status_code == 200, resposta.get_json()
    corpo = resposta.get_json()["inteligencia"]
    assert corpo["score_confiavel"] is True and corpo["amostra_entregas"] == 3

    db.session.expire_all()
    forn = db.session.get(Fornecedor, ctx["forn"].id)
    assert (forn.score_geral, forn.classificacao) == (33, "C"), "GET não pode alterar o cadastro"
    assert antes is not None


def test_recebimento_atualiza_a_nota_do_fornecedor(client, session, ctx):
    for _ in range(3):
        _compra_recebida(client, ctx)
    db.session.expire_all()
    forn = db.session.get(Fornecedor, ctx["forn"].id)
    assert forn.total_compras == 3
    # Entrega perfeita vale 80; o prazo do boleto gerado no pedido soma um pouco de condição comercial.
    assert 80 <= forn.score_geral < 85
    assert forn.classificacao == "A"
    assert forn.percentual_entregas_no_prazo == 100.0


def test_fornecedor_novo_com_um_pedido_fica_neutro(client, session, ctx):
    _compra_recebida(client, ctx)
    db.session.expire_all()
    forn = db.session.get(Fornecedor, ctx["forn"].id)
    assert forn.score_geral == fornecedor_score.SCORE_NEUTRO


def test_atraso_derruba_a_nota_no_recebimento(client, session, ctx):
    for _ in range(3):
        _compra_recebida(client, ctx, em_dia=False)
    db.session.expire_all()
    forn = db.session.get(Fornecedor, ctx["forn"].id)
    assert forn.score_geral < 50 and forn.classificacao == "C"
    assert forn.percentual_entregas_no_prazo == 0


def test_relatorio_de_fornecedores_conta_recebido_e_nao_inventa_otd(client, session, ctx):
    _compra_recebida(client, ctx)
    resposta = client.get("/api/fornecedores/relatorio/analitico", headers=ctx["headers"])
    assert resposta.status_code == 200, resposta.get_json()
    corpo = resposta.get_json()
    registros = corpo.get("relatorio") or corpo.get("data") or []
    registro = next(r for r in registros if r["fornecedor"]["id"] == ctx["forn"].id)
    assert registro["metricas"]["pedidos_concluidos"] == 1
    assert registro["fornecedor"]["score_confiavel"] is False
    assert registro["metricas"]["taxa_otd"] == 100.0  # 1 entrega avaliada, no prazo


# ───────────────────────── CMV com custo histórico ─────────────────────────

def test_cmv_usa_custo_do_momento_da_venda_e_cai_no_custo_atual_so_para_legado(client, session, ctx):
    from app.utils.metrics_calculator import MetricsCalculator
    venda = _vender(client, ctx)
    item = VendaItem.query.filter_by(venda_id=venda.id).one()
    assert item.custo_unitario == Decimal("40.0000")

    ctx["prod"].preco_custo = Decimal("90")  # custo sobe depois da venda
    db.session.commit()
    inicio = datetime.now(timezone.utc) - timedelta(days=1)
    fim = datetime.now(timezone.utc) + timedelta(days=1)
    assert MetricsCalculator.calculate_cogs(ctx["estab"].id, inicio, fim) == Decimal("40.00")

    item.custo_unitario = None  # item legado, sem custo gravado: usa o custo atual do produto
    db.session.commit()
    assert MetricsCalculator.calculate_cogs(ctx["estab"].id, inicio, fim) == Decimal("90.00")
