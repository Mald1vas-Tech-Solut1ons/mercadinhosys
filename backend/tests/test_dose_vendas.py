"""Venda por dose (WP2): o item com `dose_id` passa pelo checkout dos três canais e pelo cancelamento.

Cenário: whisky de 1 L (custo R$ 120, 10 garrafas em um lote), dose de 50 ml a R$ 18 e dupla de 100 ml a R$ 32.
Prova: PDV, venda direta e entrega baixam ml da garrafa aberta (a 1ª dose abre uma garrafa), o item guarda o retrato
da dose e o custo por dose, o contador de vendidos anda em garrafas equivalentes e o cancelamento devolve ml,
nunca uma garrafa inteira ao estoque.
"""
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from flask import g
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Cliente, Estabelecimento, Funcionario, Produto, ProdutoLote, Venda, VendaItem,
)
from app.models_dose import DoseMovimento, GarrafaAberta, ProdutoDose
from app.services import dose_service as ds
from app.utils.checkout_locking import lock_checkout, validate_pricing
from app.utils.timezone import hoje_local


def D(v):
    return Decimal(str(v))


@pytest.fixture
def bar(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Destilados")
    cliente = Cliente(estabelecimento_id=estab.id, nome="Cliente Bar", cpf="12345678901", celular="11999999999",
                      cep="01000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo",
                      estado="SP", limite_credito=D(1000), saldo_devedor=D(0))
    session.add_all([cat, cliente])
    session.flush()
    whisky = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="WHISKY 1L", unidade_medida="UN",
                     preco_custo=D(120), preco_venda=D(150), quantidade=D(10), controlar_validade=True,
                     vende_por_dose=True, volume_embalagem_ml=D(1000))
    vodka = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="VODKA 1L", unidade_medida="UN",
                    preco_custo=D(50), preco_venda=D(70), quantidade=D(10), controlar_validade=True,
                    vende_por_dose=True, volume_embalagem_ml=D(1000))
    session.add_all([whisky, vodka])
    session.flush()
    for produto in (whisky, vodka):
        session.add(ProdutoLote(estabelecimento_id=estab.id, produto_id=produto.id, numero_lote=f"L-{produto.id}",
                                quantidade=10, quantidade_inicial=10, data_entrada=hoje_local(),
                                data_validade=hoje_local() + timedelta(days=90), preco_custo_unitario=produto.preco_custo,
                                ativo=True))
    dose50 = ProdutoDose(estabelecimento_id=estab.id, produto_id=whisky.id, nome="Dose", volume_ml=D(50),
                         preco_venda=D(18), padrao=True)
    dose100 = ProdutoDose(estabelecimento_id=estab.id, produto_id=whisky.id, nome="Dupla", volume_ml=D(100),
                          preco_venda=D(32))
    dose_vodka = ProdutoDose(estabelecimento_id=estab.id, produto_id=vodka.id, nome="Dose", volume_ml=D(50),
                             preco_venda=D(10))
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="BAR-1",
                  saldo_inicial=0, saldo_atual=0, status="aberto")
    session.add_all([dose50, dose100, dose_vodka, caixa])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, cliente=cliente, whisky=whisky, vodka=vodka, dose50=dose50, dose100=dose100,
                dose_vodka=dose_vodka, caixa=caixa, headers={"Authorization": f"Bearer {token}"})


def _fresh(session, model, pk):
    session.expire_all()
    return session.get(model, pk)


def _carrinho(itens):
    total = sum(D(i["quantity"]) * D(i["price"]) for i in itens)
    return {"subtotal": float(total), "total": float(total), "desconto": 0, "items": itens,
            "pagamentos": [{"forma": "dinheiro", "valor": float(total)}]}


def _item(produto, quantidade, preco, dose=None):
    item = {"id": produto.id, "quantity": quantidade, "price": preco}
    if dose is not None:
        item["dose_id"] = dose.id
    return item


def _pdv(client, bar, itens, **extra):
    corpo = _carrinho(itens)
    corpo.update(extra)
    return client.post("/api/pdv/finalizar", headers=bar["headers"], json=corpo)


def _cancelar(client, bar, venda_id, **extra):
    return client.post(f"/api/vendas/{venda_id}/cancelar", headers=bar["headers"],
                       json={"motivo": "Teste", "senha_admin": "industrial-secret", **extra})


def _venda_id(resposta):
    corpo = resposta.get_json()
    return (corpo.get("venda") or {}).get("id") or corpo.get("venda_id")


def _garrafas(produto):
    return GarrafaAberta.query.filter_by(produto_id=produto.id).order_by(GarrafaAberta.id).all()


def test_pdv_vende_doses_abre_garrafa_e_grava_retrato_e_custo_por_dose(client, session, bar):
    r = _pdv(client, bar, [_item(bar["whisky"], 2, 18, bar["dose50"])])
    assert r.status_code in (200, 201), r.get_json()
    item = session.query(VendaItem).filter_by(venda_id=_venda_id(r)).one()
    assert D(item.quantidade) == 2 and item.produto_unidade == "DOSE"
    assert item.dose_id == bar["dose50"].id and item.dose_nome == "Dose" and D(item.dose_volume_ml) == 50
    assert D(item.ml_total) == 100 and D(item.qtd_base) == D("0.1")
    assert D(item.custo_unitario) == D(6)                         # 120 / 1000 x 50
    assert D(item.total_item) == 36 and D(item.margem_lucro_real) == 24
    assert D(item.quantidade_base) == D("0.1")
    whisky = _fresh(session, Produto, bar["whisky"].id)
    [garrafa] = _garrafas(whisky)
    assert D(whisky.quantidade) == 9 and D(garrafa.saldo_ml) == 900   # abriu 1 garrafa; 100 ml saíram
    assert D(whisky.quantidade_vendida) == D("0.1") and D(whisky.total_vendido) == 36
    assert ds.ledger_confere(garrafa)
    mov = DoseMovimento.query.filter_by(tipo="venda").one()
    assert mov.venda_item_id == item.id and mov.venda_id == item.venda_id


def test_carrinho_misto_garrafa_inteira_mais_dose_do_mesmo_produto(client, session, bar):
    r = _pdv(client, bar, [_item(bar["whisky"], 1, 150), _item(bar["whisky"], 1, 18, bar["dose50"])])
    assert r.status_code in (200, 201), r.get_json()
    whisky = _fresh(session, Produto, bar["whisky"].id)
    assert D(whisky.quantidade) == 8                              # 1 vendida inteira + 1 aberta para a dose
    assert D(whisky.quantidade_vendida) == D("1.05")
    [garrafa] = _garrafas(whisky)
    assert D(garrafa.saldo_ml) == 950


def test_cancelamento_devolve_ml_e_nao_uma_garrafa(client, session, bar):
    venda_id = _venda_id(_pdv(client, bar, [_item(bar["whisky"], 2, 18, bar["dose50"])]))
    r = _cancelar(client, bar, venda_id)
    assert r.status_code == 200, r.get_json()
    whisky = _fresh(session, Produto, bar["whisky"].id)
    [garrafa] = _garrafas(whisky)
    assert D(garrafa.saldo_ml) == 1000 and garrafa.status == "aberta"
    assert D(whisky.quantidade) == 9                              # a garrafa aberta NÃO volta à prateleira
    assert D(whisky.quantidade_vendida) == 0 and D(whisky.total_vendido) == 0
    assert _fresh(session, Venda, venda_id).status == "cancelada"
    assert ds.ledger_confere(garrafa)
    # cancelar de novo é recusado e não mexe em nada
    assert _cancelar(client, bar, venda_id).status_code >= 400
    assert D(_fresh(session, GarrafaAberta, garrafa.id).saldo_ml) == 1000


def test_cancelamento_de_carrinho_misto_devolve_a_garrafa_inteira_e_os_ml(client, session, bar):
    venda_id = _venda_id(_pdv(client, bar, [_item(bar["whisky"], 1, 150), _item(bar["whisky"], 1, 18, bar["dose50"])]))
    assert _cancelar(client, bar, venda_id).status_code == 200
    whisky = _fresh(session, Produto, bar["whisky"].id)
    [garrafa] = _garrafas(whisky)
    assert D(whisky.quantidade) == 9 and D(garrafa.saldo_ml) == 1000   # só a vendida inteira voltou
    assert D(whisky.quantidade_vendida) == 0


def test_cancelamento_com_dose_que_nao_volta_vira_perda_de_ml(client, session, bar):
    venda_id = _venda_id(_pdv(client, bar, [_item(bar["whisky"], 2, 18, bar["dose50"])]))
    r = _cancelar(client, bar, venda_id, itens_perda=[bar["whisky"].id])
    assert r.status_code == 200, r.get_json()
    whisky = _fresh(session, Produto, bar["whisky"].id)
    [garrafa] = _garrafas(whisky)
    assert D(garrafa.saldo_ml) == 900 and D(whisky.quantidade) == 9
    assert [m.tipo for m in garrafa.movimentos] == ["abertura", "venda", "estorno", "perda"]
    assert ds.ledger_confere(garrafa)
    from app.models import MovimentacaoEstoque
    # nenhuma "perda de estoque" em unidades foi inventada a partir da quantidade de doses
    assert MovimentacaoEstoque.query.filter(MovimentacaoEstoque.produto_id == whisky.id,
                                            MovimentacaoEstoque.venda_id == venda_id).count() == 0


def test_dose_de_outro_produto_ou_inexistente_e_recusada_sem_efeitos(client, session, bar):
    r = _pdv(client, bar, [_item(bar["whisky"], 1, 10, bar["dose_vodka"])])
    assert r.status_code == 400
    r = _pdv(client, bar, [{"id": bar["whisky"].id, "quantity": 1, "price": 18, "dose_id": 99999}])
    assert r.status_code == 400
    r = _pdv(client, bar, [{"id": bar["whisky"].id, "quantity": 1, "price": 18, "dose_id": "abc"}])
    assert r.status_code == 400
    session.expire_all()
    assert _garrafas(bar["whisky"]) == [] and session.query(Venda).count() == 0
    assert D(_fresh(session, Produto, bar["whisky"].id).quantidade) == 10


def test_sem_estoque_recusa_e_nao_deixa_garrafa_aberta(client, session, bar):
    bar["whisky"].quantidade = D(0)
    for lote in ProdutoLote.query.filter_by(produto_id=bar["whisky"].id).all():
        lote.quantidade = 0
    session.commit()
    r = _pdv(client, bar, [_item(bar["whisky"], 1, 18, bar["dose50"])])
    assert r.status_code == 400
    session.expire_all()
    assert _garrafas(bar["whisky"]) == [] and session.query(Venda).count() == 0


def test_reenvio_offline_com_o_mesmo_uuid_nao_abre_outra_garrafa(client, session, bar):
    uuid = "11111111-2222-3333-4444-555555555555"
    primeira = _pdv(client, bar, [_item(bar["whisky"], 3, 18, bar["dose50"])], offline_uuid=uuid)
    assert primeira.status_code in (200, 201), primeira.get_json()
    segunda = _pdv(client, bar, [_item(bar["whisky"], 3, 18, bar["dose50"])], offline_uuid=uuid)
    assert segunda.status_code == 200 and segunda.get_json().get("idempotente") is True
    [garrafa] = _garrafas(_fresh(session, Produto, bar["whisky"].id))
    assert D(garrafa.saldo_ml) == 850 and D(_fresh(session, Produto, bar["whisky"].id).quantidade) == 9


def test_venda_direta_api_vendas_baixa_ml(client, session, bar):
    r = client.post("/api/vendas/", headers=bar["headers"],
                    json=_carrinho([_item(bar["whisky"], 1, 32, bar["dose100"])]))
    assert r.status_code == 201, r.get_json()
    item = session.query(VendaItem).filter_by(venda_id=r.get_json()["venda"]["id"]).one()
    assert item.dose_nome == "Dupla" and D(item.ml_total) == 100 and D(item.custo_unitario) == D(12)
    [garrafa] = _garrafas(_fresh(session, Produto, bar["whisky"].id))
    assert D(garrafa.saldo_ml) == 900


def test_entrega_baixa_ml_e_cancelamento_devolve(client, session, bar):
    total = 36
    r = client.post("/api/delivery/venda-entrega", headers=bar["headers"], json={
        "cliente_id": bar["cliente"].id, "subtotal": total, "total": total,
        "itens": [{"produto_id": bar["whisky"].id, "quantidade": 2, "preco_unitario": 18, "dose_id": bar["dose50"].id}],
        "pagamentos": [{"forma_pagamento": "dinheiro", "valor": total}]})
    assert r.status_code == 201, r.get_json()
    venda_id = r.get_json()["venda_id"]
    item = session.query(VendaItem).filter_by(venda_id=venda_id).one()
    assert item.dose_id == bar["dose50"].id and D(item.qtd_base) == D("0.1") and D(item.custo_unitario) == D(6)
    whisky = _fresh(session, Produto, bar["whisky"].id)
    assert D(whisky.quantidade_vendida) == D("0.1")
    assert _cancelar(client, bar, venda_id).status_code == 200
    [garrafa] = _garrafas(_fresh(session, Produto, bar["whisky"].id))
    assert D(garrafa.saldo_ml) == 1000 and D(_fresh(session, Produto, bar["whisky"].id).quantidade) == 9


def test_entrega_com_dose_invalida_e_recusada(client, session, bar):
    r = client.post("/api/delivery/venda-entrega", headers=bar["headers"], json={
        "cliente_id": bar["cliente"].id, "subtotal": 10, "total": 10,
        "itens": [{"produto_id": bar["whisky"].id, "quantidade": 1, "preco_unitario": 10, "dose_id": bar["dose_vodka"].id}],
        "pagamentos": [{"forma_pagamento": "dinheiro", "valor": 10}]})
    assert r.status_code == 400
    assert _garrafas(bar["whisky"]) == []


# ── Disciplina de preço: o preço de referência do item de dose é o da dose ────────────

def _operador_sem_desconto():
    return SimpleNamespace(is_super_admin=False, role="caixa", permissoes_json="{}")


def test_preco_da_dose_e_a_referencia_do_limite_de_desconto(session, bar):
    caixa = _operador_sem_desconto()
    ok = [_item(bar["whisky"], 2, 18, bar["dose50"])]
    lock_checkout(bar["estab"].id, bar["admin"].id, ok)
    validate_pricing(caixa, ok, 0, bar["estab"].id)                # preço da dose: sem desconto, passa
    com_desconto = [_item(bar["whisky"], 2, 9, bar["dose50"])]     # metade do preço da dose = 50% de desconto
    lock_checkout(bar["estab"].id, bar["admin"].id, com_desconto)
    with pytest.raises(ValueError, match="Desconto excede"):
        validate_pricing(caixa, com_desconto, 0, bar["estab"].id)


def test_dose_de_outro_produto_nao_passa_na_conferencia_de_preco(session, bar):
    itens = [_item(bar["whisky"], 1, 10, bar["dose_vodka"])]
    lock_checkout(bar["estab"].id, bar["admin"].id, itens)
    with pytest.raises(ValueError, match="Dose não encontrada"):
        validate_pricing(_operador_sem_desconto(), itens, 0, bar["estab"].id)


def test_dose_id_invalido_no_item_e_barrado_na_normalizacao(session, bar):
    for ruim in ("abc", -3, "-1"):
        itens = [{"id": bar["whisky"].id, "quantity": 1, "price": 18, "dose_id": ruim}]
        with pytest.raises(ValueError, match="dose inválida"):
            lock_checkout(bar["estab"].id, bar["admin"].id, itens)
    # sem dose_id (ou vazio/0) o item é uma venda comum e segue intacto
    for neutro in (None, "", 0):
        itens = [{"id": bar["whisky"].id, "quantity": 1, "price": 150, "dose_id": neutro}]
        lock_checkout(bar["estab"].id, bar["admin"].id, itens)


# ── Quem consome a quantidade vendida lê garrafas, não doses ───────────────────────────

def test_contador_de_vendidos_nao_acumula_erro_com_dose_de_garrafa_de_750ml(client, session, bar):
    """50 ml de 750 ml = 0,066667 garrafa: com 3 casas a verificação de dados acusaria divergência falsa."""
    bar["whisky"].volume_embalagem_ml = D(750)
    session.commit()
    for _ in range(7):
        assert _pdv(client, bar, [_item(bar["whisky"], 1, 18, bar["dose50"])]).status_code in (200, 201)
    from app.services import verificacao_dados
    assert verificacao_dados.vendas_do_produto(bar["estab"].id) == []
    whisky = _fresh(session, Produto, bar["whisky"].id)
    # o contador soma o mesmo valor (6 casas) que o razão guarda em cada item: 7 x 0,066667
    assert D(whisky.quantidade_vendida) == D("0.066667") * 7


def test_demanda_media_e_giro_somam_garrafas_equivalentes(client, session, bar):
    assert _pdv(client, bar, [_item(bar["whisky"], 3, 18, bar["dose50"])]).status_code in (200, 201)   # 150 ml
    whisky = _fresh(session, Produto, bar["whisky"].id)
    assert whisky.demanda_media_diaria(30) == pytest.approx(0.15 / 30)
    from app.services.dashboard_bi import analise_bi
    linhas = [p for p in analise_bi(bar["estab"].id, 30)["produtos"] if p["id"] == whisky.id]
    assert linhas and linhas[0]["qtd"] == pytest.approx(0.15)          # garrafas equivalentes, não 3 doses
    assert linhas[0]["vmd"] == pytest.approx(0.15 / 30, abs=1e-4)


def test_rastreio_de_lote_inclui_vendas_por_dose_e_some_com_o_cancelamento(client, session, bar):
    lote = ProdutoLote.query.filter_by(produto_id=bar["whisky"].id).one()
    from app.services.producao_service import rastreio_lote
    venda_id = _venda_id(_pdv(client, bar, [_item(bar["whisky"], 2, 18, bar["dose50"])]))
    [linha] = [v for v in rastreio_lote(bar["estab"].id, lote.id)["vendas"] if v.get("por_dose")]
    assert linha["venda_id"] == venda_id and linha["ml"] == 100.0 and linha["quantidade"] == pytest.approx(0.1)
    assert _cancelar(client, bar, venda_id).status_code == 200
    assert [v for v in rastreio_lote(bar["estab"].id, lote.id)["vendas"] if v.get("por_dose")] == []
