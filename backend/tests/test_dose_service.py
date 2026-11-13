"""Venda por dose (WP1): garrafa aberta e razão de ml.

Cenário: whisky de 1 L (R$ 120 de custo, 5 garrafas em um lote), doses de 50 ml (R$ 18) e 100 ml (R$ 32).
O que se prova aqui é o núcleo: abertura pelo caminho único de estoque, razão de ml que fecha com o saldo,
dose que atravessa garrafas, estorno que devolve ml (nunca garrafa), desvio ao encerrar e isolamento por loja.
"""
import json
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.models import (
    CategoriaProduto, Estabelecimento, Funcionario, MovimentacaoEstoque, Produto, ProdutoLote,
)
from app.models_dose import DoseMovimento, GarrafaAberta, ProdutoDose
from app.services import dose_service as ds
from app.services.estoque_service import EstoqueIndisponivelError
from app.utils.timezone import hoje_local


def D(valor):
    return Decimal(str(valor))


@pytest.fixture
def bar(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Destilados")
    session.add(cat)
    session.flush()

    def garrafa(nome="WHISKY 1L", quantidade="5", custo="120", volume="1000", **extra):
        produto = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome=nome, unidade_medida="UN",
                          preco_custo=D(custo), preco_venda=D("150"), quantidade=D(quantidade),
                          controlar_validade=False, vende_por_dose=True, volume_embalagem_ml=D(volume), **extra)
        session.add(produto)
        session.flush()
        if D(quantidade) > 0:
            session.add(ProdutoLote(
                estabelecimento_id=estab.id, produto_id=produto.id, numero_lote=f"L-{nome}-{produto.id}",
                quantidade=D(quantidade), quantidade_inicial=D(quantidade),
                data_validade=hoje_local() + timedelta(days=365), preco_custo_unitario=D(custo)))
        dose50 = ProdutoDose(estabelecimento_id=estab.id, produto_id=produto.id, nome="Dose",
                             volume_ml=D(50), preco_venda=D("18"), padrao=True)
        dose100 = ProdutoDose(estabelecimento_id=estab.id, produto_id=produto.id, nome="Dupla",
                              volume_ml=D(100), preco_venda=D("32"))
        session.add_all([dose50, dose100])
        session.commit()
        return produto, dose50, dose100

    produto, dose50, dose100 = garrafa()
    return dict(estab=estab, admin=admin, cat=cat, produto=produto, dose50=dose50, dose100=dose100, nova=garrafa)


def _vender(bar, dose, quantidade=1, venda_id=1, **kw):
    r = ds.vender_dose(bar["produto"], dose, quantidade, venda_id=venda_id, funcionario_id=bar["admin"].id, **kw)
    return r


def _garrafas(bar, status=None):
    q = GarrafaAberta.query.filter_by(produto_id=bar["produto"].id)
    if status:
        q = q.filter_by(status=status)
    return q.order_by(GarrafaAberta.id).all()


def test_primeira_dose_abre_garrafa_pelo_caminho_unico_de_estoque(session, bar):
    r = _vender(bar, bar["dose50"])
    session.commit()
    session.refresh(bar["produto"])
    [g] = _garrafas(bar)
    assert D(bar["produto"].quantidade) == D(4)
    assert g.status == "aberta" and D(g.saldo_ml) == D(950) and D(g.volume_inicial_ml) == D(1000)
    assert D(g.custo_garrafa) == D(120)
    assert r.ml_total == D(50) and r.qtd_base == D("0.05")
    assert r.custo_por_dose == D("6.0000")           # 120 / 1000 ml x 50 ml
    assert [m.tipo for m in g.movimentos] == ["abertura", "venda"]
    assert ds.ledger_confere(g)
    # a abertura é uma saída comum de estoque, sem venda, marcada e com o lote de origem no rastro
    mov = MovimentacaoEstoque.query.filter_by(produto_id=bar["produto"].id, tipo="saida").one()
    assert mov.venda_id is None and mov.motivo == ds.MOTIVO_ABERTURA
    rastro = json.loads(mov.observacoes)
    assert rastro["abertura_dose"] is True and rastro["garrafa_aberta_id"] == g.id and rastro["lotes_consumidos"]
    assert g.lote_id == mov.lote_id and g.movimento_abertura_id == mov.id
    lote = ProdutoLote.query.filter_by(produto_id=bar["produto"].id).one()
    assert D(lote.quantidade) == D(4)


def test_doses_seguintes_consomem_o_saldo_sem_abrir_outra_garrafa(session, bar):
    _vender(bar, bar["dose50"], 1, venda_id=1)
    _vender(bar, bar["dose100"], 1, venda_id=2)
    _vender(bar, bar["dose50"], 2, venda_id=3)
    session.commit()
    session.refresh(bar["produto"])
    [g] = _garrafas(bar)
    assert D(g.saldo_ml) == D(750) and D(bar["produto"].quantidade) == D(4)
    assert ds.ledger_confere(g)


def test_dose_atravessa_para_a_proxima_garrafa(session, bar):
    _vender(bar, bar["dose100"], 9, venda_id=1)           # 900 ml -> saldo 100
    r = _vender(bar, bar["dose100"], 2, venda_id=2)       # 200 ml: 100 da primeira + 100 da segunda
    session.commit()
    session.refresh(bar["produto"])
    g1, g2 = _garrafas(bar)
    assert g1.status == "vazia" and D(g1.saldo_ml) == D(0) and g1.encerrada_em is not None
    assert g2.status == "aberta" and D(g2.saldo_ml) == D(900)
    assert D(bar["produto"].quantidade) == D(3)
    assert r.qtd_base == D("0.2") and len(r.movimentos) == 2 and r.garrafas_abertas == [g2]
    assert ds.ledger_confere(g1) and ds.ledger_confere(g2)


def test_ml_livre_com_casas_decimais_e_custo_por_dose(session, bar):
    dose = ProdutoDose(estabelecimento_id=bar["estab"].id, produto_id=bar["produto"].id, nome="Dose do bar",
                       volume_ml=D("51.5"), preco_venda=D("20"))
    session.add(dose)
    session.commit()
    r = _vender(bar, dose, 2)
    assert r.ml_total == D("103.00")
    assert r.custo_por_dose == D("6.1800")                # 0,12 R$/ml x 51,5 ml
    assert r.custo_total == D("12.3600")


def test_sem_estoque_recusa_e_nao_deixa_rastro(session, bar):
    produto, dose50, _ = bar["nova"]("VODKA 1L", quantidade="0")
    bar["produto"] = produto
    with pytest.raises(ds.DoseIndisponivelError):
        _vender(bar, dose50)
    assert _garrafas(bar) == []
    assert MovimentacaoEstoque.query.filter_by(produto_id=produto.id).count() == 0
    assert D(produto.quantidade) == D(0)


def test_capacidade_total_e_checada_antes_de_abrir_qualquer_garrafa(session, bar):
    produto, _, dose100 = bar["nova"]("RUM 1L", quantidade="1")
    bar["produto"] = produto
    with pytest.raises(ds.DoseIndisponivelError) as erro:
        _vender(bar, dose100, 11)                          # 1100 ml com 1000 ml no total
    assert erro.value.disponivel_ml == D(1000)
    assert _garrafas(bar) == [] and D(produto.quantidade) == D(1)


def test_venda_sem_estoque_configurada_abre_e_deixa_agregado_negativo(session, bar):
    produto, dose50, _ = bar["nova"]("GIN 1L", quantidade="0")
    bar["produto"] = produto
    _vender(bar, dose50, permitir_sem_estoque=True)
    session.commit()
    session.refresh(produto)
    [g] = _garrafas(bar)
    assert D(g.saldo_ml) == D(950) and D(produto.quantidade) == D(-1)


def test_estorno_devolve_ml_a_garrafa_e_nao_mexe_no_estoque(session, bar):
    _vender(bar, bar["dose50"], 2, venda_id=10)
    session.commit()
    session.refresh(bar["produto"])
    antes = D(bar["produto"].quantidade)
    ds.estornar_doses_venda(10, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="Cancelamento")
    session.commit()
    session.refresh(bar["produto"])
    [g] = _garrafas(bar)
    assert D(g.saldo_ml) == D(1000) and D(bar["produto"].quantidade) == antes   # ml voltam; garrafa não
    assert ds.ledger_confere(g)
    with pytest.raises(ds.DoseError, match="já foram estornadas"):
        ds.estornar_doses_venda(10, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="Cancelamento")


def test_estorno_reabre_garrafa_que_esvaziou(session, bar):
    _vender(bar, bar["dose100"], 10, venda_id=20)         # esvazia a 1ª garrafa
    session.commit()
    [g] = _garrafas(bar)
    assert g.status == "vazia"
    ds.estornar_doses_venda(20, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="Cancelamento")
    session.commit()
    session.refresh(g)
    assert g.status == "aberta" and D(g.saldo_ml) == D(1000) and g.encerrada_em is None
    assert ds.ledger_confere(g)


def test_estorno_de_venda_que_atravessou_garrafas_devolve_a_cada_uma(session, bar):
    _vender(bar, bar["dose100"], 9, venda_id=30)
    _vender(bar, bar["dose100"], 2, venda_id=31)          # 100 da 1ª + 100 da 2ª
    session.commit()
    ds.estornar_doses_venda(31, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="Cancelamento")
    session.commit()
    g1, g2 = _garrafas(bar)
    assert D(g1.saldo_ml) == D(100) and g1.status == "aberta"
    assert D(g2.saldo_ml) == D(1000)
    assert ds.ledger_confere(g1) and ds.ledger_confere(g2)


def test_estorno_em_garrafa_descartada_nao_faz_o_ml_reaparecer(session, bar):
    _vender(bar, bar["dose50"], 1, venda_id=40)
    session.commit()
    [g] = _garrafas(bar)
    ds.descartar_garrafa(g.id, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="Vencida aberta")
    ds.estornar_doses_venda(40, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="Cancelamento")
    session.commit()
    session.refresh(g)
    assert g.status == "descartada" and D(g.saldo_ml) == D(0) and ds.ledger_confere(g)


def test_estorno_sem_doses_na_venda_nao_faz_nada(session, bar):
    assert ds.estornar_doses_venda(999, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="x") == []


@pytest.mark.parametrize("tipo", ["perda", "cortesia", "degustacao"])
def test_baixa_manual_de_ml_reduz_saldo_e_registra_custo(session, bar, tipo):
    _vender(bar, bar["dose50"])
    movs, custo = ds.baixar_ml(bar["produto"], 100, tipo, funcionario_id=bar["admin"].id, motivo="teste")
    session.commit()
    [g] = _garrafas(bar)
    assert D(g.saldo_ml) == D(850) and custo == D("12.0000")
    assert [m.tipo for m in movs] == [tipo] and ds.ledger_confere(g)


def test_baixa_manual_recusa_tipo_invalido(session, bar):
    with pytest.raises(ds.DoseError):
        ds.baixar_ml(bar["produto"], 10, "venda", funcionario_id=bar["admin"].id)


def test_encerrar_garrafa_registra_o_desvio(session, bar):
    _vender(bar, bar["dose100"], 9)                       # razão diz que restam 100 ml
    session.commit()
    [g] = _garrafas(bar)
    garrafa, desvio = ds.encerrar_garrafa(g.id, bar["estab"].id, funcionario_id=bar["admin"].id)
    session.commit()
    assert desvio == D(100) and garrafa.status == "vazia" and D(garrafa.saldo_ml) == D(0)
    assert [m.tipo for m in garrafa.movimentos][-1] == "desvio" and ds.ledger_confere(garrafa)
    with pytest.raises(ds.DoseError, match="já foi encerrada"):
        ds.encerrar_garrafa(g.id, bar["estab"].id, funcionario_id=bar["admin"].id)


def test_ajuste_por_contagem_grava_a_diferenca(session, bar):
    _vender(bar, bar["dose50"], 4)                        # razão: 800 ml
    session.commit()
    [g] = _garrafas(bar)
    garrafa, diferenca = ds.ajustar_saldo(g.id, bar["estab"].id, "780,5", funcionario_id=bar["admin"].id)
    session.commit()
    assert diferenca == D("-19.50") and D(garrafa.saldo_ml) == D("780.50") and ds.ledger_confere(garrafa)
    with pytest.raises(ds.DoseError):
        ds.ajustar_saldo(g.id, bar["estab"].id, 1500, funcionario_id=bar["admin"].id)   # mais que a garrafa cheia
    garrafa, _ = ds.ajustar_saldo(g.id, bar["estab"].id, 0, funcionario_id=bar["admin"].id)
    assert garrafa.status == "vazia"


def test_garrafa_aberta_vencida_nao_vende_e_a_proxima_abre(session, bar):
    produto, dose50, _ = bar["nova"]("VINHO 750ML", quantidade="3", volume="750", validade_aberta_dias=3)
    bar["produto"] = produto
    _vender(bar, dose50)
    [g] = _garrafas(bar)
    g.validade_aberta = hoje_local() - timedelta(days=1)  # passou da validade depois de aberta
    session.commit()
    assert ds.garrafas_vendaveis(produto) == [] and ds.saldo_aberto_ml(produto) == D(0)
    assert [x.id for x in ds.garrafas_vencidas(bar["estab"].id)] == [g.id]
    _vender(bar, dose50, venda_id=2)
    g1, g2 = _garrafas(bar)
    assert g1.status == "aberta" and D(g1.saldo_ml) == D(700)    # intocada, à espera do descarte
    assert D(g2.saldo_ml) == D(700) and g2.validade_aberta == hoje_local() + timedelta(days=3)


def test_dose_de_outro_produto_ou_inativa_e_recusada(session, bar):
    outro, dose_outro, _ = bar["nova"]("VODKA 1L")
    with pytest.raises(ds.DoseError, match="não pertence"):
        ds.vender_dose(bar["produto"], dose_outro, 1, venda_id=1, funcionario_id=bar["admin"].id)
    bar["dose50"].ativa = False
    session.commit()
    with pytest.raises(ds.DoseError, match="desativada"):
        _vender(bar, bar["dose50"])


def test_produto_sem_volume_ou_sem_dose_ligada_nao_vende_por_dose(session, bar):
    bar["produto"].volume_embalagem_ml = None
    session.commit()
    with pytest.raises(ds.DoseError, match="volume da garrafa"):
        _vender(bar, bar["dose50"])
    bar["produto"].volume_embalagem_ml = D(1000)
    bar["produto"].vende_por_dose = False
    session.commit()
    with pytest.raises(ds.DoseError, match="não está configurado"):
        _vender(bar, bar["dose50"])


@pytest.mark.parametrize("qtd", [0, -1, "abc", "NaN", 10000])
def test_quantidade_de_doses_invalida(session, bar, qtd):
    with pytest.raises(ds.DoseError):
        _vender(bar, bar["dose50"], qtd)


def test_isolamento_entre_lojas(session, bar):
    """Garrafa e razão de uma loja não aparecem nem se mexem a partir de outra."""
    outra = Estabelecimento(nome_fantasia="Outra Loja", razao_social="Outra LTDA", cnpj="98765432000199",
                            email="outra@x.sys", telefone="92988887777", data_abertura=date(2024, 1, 1),
                            plano="PREMIUM", vencimento_plano=date(2030, 12, 31), cep="69000-000",
                            logradouro="Rua B", numero="2", bairro="Centro", cidade="Manaus", estado="AM")
    session.add(outra)
    session.commit()
    _vender(bar, bar["dose50"], venda_id=50)
    session.commit()
    [g] = _garrafas(bar)
    with pytest.raises(ds.DoseError, match="não encontrada"):
        ds.encerrar_garrafa(g.id, outra.id, funcionario_id=bar["admin"].id)
    with pytest.raises(ds.DoseError, match="não encontrada"):
        ds.descartar_garrafa(g.id, outra.id, funcionario_id=bar["admin"].id)
    assert ds.estornar_doses_venda(50, outra.id, funcionario_id=bar["admin"].id, motivo="x") == []
    session.refresh(g)
    assert D(g.saldo_ml) == D(950) and g.status == "aberta"


def test_razao_fecha_apos_sequencia_mista(session, bar):
    """Venda, estorno, perda, cortesia, ajuste e encerramento: o saldo sempre é a soma do razão."""
    _vender(bar, bar["dose100"], 3, venda_id=60)
    _vender(bar, bar["dose50"], 5, venda_id=61)
    ds.baixar_ml(bar["produto"], 25, "perda", funcionario_id=bar["admin"].id)
    ds.estornar_doses_venda(60, bar["estab"].id, funcionario_id=bar["admin"].id, motivo="Cancelamento")
    ds.baixar_ml(bar["produto"], 120, "cortesia", funcionario_id=bar["admin"].id)
    [g] = _garrafas(bar)
    ds.ajustar_saldo(g.id, bar["estab"].id, 400, funcionario_id=bar["admin"].id)
    ds.encerrar_garrafa(g.id, bar["estab"].id, funcionario_id=bar["admin"].id)
    session.commit()
    for garrafa in _garrafas(bar):
        assert ds.ledger_confere(garrafa)
    assert DoseMovimento.query.filter_by(tipo="abertura").count() == len(_garrafas(bar))


def test_helpers_de_tela(session, bar):
    assert ds.doses_restantes(650, 50) == 13 and ds.doses_restantes(D("49.99"), 50) == 0
    assert ds.garrafas_necessarias(1100, 1000) == 2 and ds.garrafas_necessarias(1000, 1000) == 1
    _vender(bar, bar["dose50"])
    [g] = _garrafas(bar)
    assert ds.doses_restantes(g, 50) == 19


def test_dose_maior_que_a_garrafa_e_recusada_na_venda(session, bar):
    """Garrafa trocada por uma menor depois de configurar a dose: a venda não abre garrafa nenhuma."""
    bar["produto"].volume_embalagem_ml = D(40)
    session.commit()
    with pytest.raises(ds.DoseError, match="maior que a garrafa"):
        _vender(bar, bar["dose50"])
    assert _garrafas(bar) == [] and D(bar["produto"].quantidade) == D(5)
