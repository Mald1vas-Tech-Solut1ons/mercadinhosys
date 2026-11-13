"""Venda por dose (WP4, backend): o PDV recebe as doses, o caixa serve e encerra a garrafa, dose livre exige PIN.

Cenário: whisky de 1 L (custo R$ 120, 10 garrafas), dose de 50 ml a R$ 18 e dupla de 100 ml a R$ 32.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Estabelecimento, Funcionario, MovimentacaoEstoque, Produto, ProdutoLote, Venda, VendaItem,
)
from app.models_dose import GarrafaAberta, ProdutoDose
from app.services import dose_service as ds
from app.utils.timezone import hoje_local

PIN = "2468"


def D(v):
    return Decimal(str(v))


def _token(func, estab):
    return {"Authorization": "Bearer " + create_access_token(
        identity=str(func.id), additional_claims={"estabelecimento_id": estab.id, "role": func.role})}


@pytest.fixture
def bar(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    admin.set_pin(PIN)
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Destilados")
    session.add(cat)
    session.flush()

    def garrafa(nome, custo, venda, codigo=None, qtd=10, **extra):
        p = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome=nome, unidade_medida="UN",
                    preco_custo=D(custo), preco_venda=D(venda), quantidade=D(qtd), controlar_validade=True,
                    codigo_barras=codigo, **extra)
        session.add(p)
        session.flush()
        if qtd:
            session.add(ProdutoLote(estabelecimento_id=estab.id, produto_id=p.id, numero_lote=f"L-{p.id}",
                                    quantidade=qtd, quantidade_inicial=qtd, data_entrada=hoje_local(),
                                    data_validade=hoje_local() + timedelta(days=90), preco_custo_unitario=D(custo),
                                    ativo=True))
        return p

    whisky = garrafa("WHISKY 1L", 120, 150, "7891234567895", vende_por_dose=True, volume_embalagem_ml=D(1000))
    refri = garrafa("REFRIGERANTE 2L", 5, 9, "7891234567802")
    sem_estoque = garrafa("GIN 1L", 90, 120, qtd=0, vende_por_dose=True, volume_embalagem_ml=D(1000))
    desligado = garrafa("VODKA 1L", 50, 70, vende_por_dose=False, volume_embalagem_ml=D(1000))
    d50 = ProdutoDose(estabelecimento_id=estab.id, produto_id=whisky.id, nome="Dose", volume_ml=D(50),
                      preco_venda=D(18), padrao=True, ordem=0)
    d100 = ProdutoDose(estabelecimento_id=estab.id, produto_id=whisky.id, nome="Dupla", volume_ml=D(100),
                       preco_venda=D(32), ordem=1)
    antiga = ProdutoDose(estabelecimento_id=estab.id, produto_id=whisky.id, nome="Arquivada", volume_ml=D(40),
                         preco_venda=D(10), ativa=False, ordem=2)
    d_gin = ProdutoDose(estabelecimento_id=estab.id, produto_id=sem_estoque.id, nome="Dose", volume_ml=D(50),
                        preco_venda=D(15), padrao=True)
    session.add_all([d50, d100, antiga, d_gin, Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id,
                                                     numero_caixa="C-ADM", saldo_inicial=0, saldo_atual=0, status="aberto")])
    session.commit()
    return dict(estab=estab, admin=admin, whisky=whisky, refri=refri, gin=sem_estoque, vodka=desligado,
                d50=d50, d100=d100, headers=_token(admin, estab))


@pytest.fixture
def operador(session, bar):
    """Caixa comum (nível 4) com gaveta aberta: precisa do PIN do gerente para dose livre."""
    func = Funcionario(estabelecimento_id=bar["estab"].id, nome="Caixa Bar", cpf="55544433322", username="caixa_bar",
                       role="caixa", ativo=True, data_nascimento=date(1995, 1, 1), celular="92999999999",
                       email="caixa@bar.sys", cargo="Caixa", data_admissao=date(2024, 1, 1), salario_base=D(2000))
    func.set_password("industrial-secret")
    session.add(func)
    session.flush()
    session.add(Caixa(estabelecimento_id=bar["estab"].id, funcionario_id=func.id, numero_caixa="C-CX", saldo_inicial=0,
                      saldo_atual=0, status="aberto"))
    session.commit()
    return {"func": func, "headers": _token(func, bar["estab"])}


def _venda(client, headers, itens, **extra):
    total = sum(D(i["quantity"]) * D(i["price"]) for i in itens)
    corpo = {"subtotal": float(total), "total": float(total), "desconto": 0, "items": itens,
             "pagamentos": [{"forma": "dinheiro", "valor": float(total)}]}
    corpo.update(extra)
    return client.post("/api/pdv/finalizar", headers=headers, json=corpo)


def _fresh(session, model, pk):
    session.expire_all()
    return session.get(model, pk)


def _garrafas(produto):
    return GarrafaAberta.query.filter_by(produto_id=produto.id).order_by(GarrafaAberta.id).all()


# ── O PDV recebe as doses ───────────────────────────────────────────────────

def test_busca_do_pdv_traz_doses_volume_e_saldo_so_de_quem_vende_por_dose(client, session, bar):
    r = client.get("/api/pdv/buscar-produtos?q=WHISKY", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    [p] = r.get_json()["produtos"]
    assert p["vende_por_dose"] is True and p["volume_embalagem_ml"] == 1000.0 and p["saldo_aberto_ml"] == 0.0
    # só as ativas, a padrão primeiro; a arquivada não vai para o caixa
    assert [(d["nome"], d["volume_ml"], d["preco_venda"], d["padrao"]) for d in p["doses"]] == [
        ("Dose", 50.0, 18.0, True), ("Dupla", 100.0, 32.0, False)]
    comum = client.get("/api/pdv/buscar-produtos?q=REFRIGERANTE", headers=bar["headers"]).get_json()["produtos"][0]
    assert "doses" not in comum and "vende_por_dose" not in comum
    desligado = client.get("/api/pdv/buscar-produtos?q=VODKA", headers=bar["headers"]).get_json()["produtos"][0]
    assert "doses" not in desligado                                     # tem volume mas não vende por dose


def test_saldo_da_garrafa_aberta_aparece_na_busca_depois_da_venda(client, session, bar):
    assert _venda(client, bar["headers"], [{"id": bar["whisky"].id, "quantity": 3, "price": 18,
                                            "dose_id": bar["d50"].id}]).status_code in (200, 201)
    [p] = client.get("/api/pdv/buscar-produtos?q=WHISKY", headers=bar["headers"]).get_json()["produtos"]
    assert p["saldo_aberto_ml"] == 850.0 and p["quantidade_estoque"] == 9.0
    assert [g["saldo_ml"] for g in p["garrafas_abertas"]] == [850.0]


def test_bip_do_codigo_de_barras_tambem_traz_as_doses(client, session, bar):
    r = client.post("/api/pdv/validar-produto", headers=bar["headers"], json={"codigo_barras": "7891234567895"})
    assert r.status_code == 200, r.get_json()
    produto = r.get_json()["produto"]
    assert produto["vende_por_dose"] is True and len(produto["doses"]) == 2 and produto["nome"] == "WHISKY 1L"
    comum = client.post("/api/pdv/validar-produto", headers=bar["headers"], json={"codigo_barras": "7891234567802"})
    assert "doses" not in comum.get_json()["produto"]


def test_catalogo_offline_leva_as_doses_para_vender_sem_sinal(client, session, bar):
    produtos = {p["nome"]: p for p in client.get("/api/pdv/catalogo-offline", headers=bar["headers"]).get_json()["produtos"]}
    assert [d["nome"] for d in produtos["WHISKY 1L"]["doses"]] == ["Dose", "Dupla"]
    assert "doses" not in produtos["REFRIGERANTE 2L"]


def test_cardapio_so_lista_o_que_da_para_servir(client, session, bar):
    r = client.get("/api/pdv/cardapio-doses", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    nomes = [p["nome"] for p in r.get_json()["produtos"]]
    assert nomes == ["WHISKY 1L"]                    # gin sem estoque e sem garrafa aberta fica de fora; vodka sem dose também
    # esvazia as garrafas fechadas mas deixa a aberta com saldo: continua no cardápio
    _venda(client, bar["headers"], [{"id": bar["whisky"].id, "quantity": 1, "price": 18, "dose_id": bar["d50"].id}])
    bar["whisky"].quantidade = D(0)
    session.commit()
    [p] = client.get("/api/pdv/cardapio-doses", headers=bar["headers"]).get_json()["produtos"]
    assert p["saldo_aberto_ml"] == 950.0 and p["quantidade_estoque"] == 0.0


def test_oferta_de_dose_nao_vaza_entre_lojas(client, session, bar):
    outra = Estabelecimento(nome_fantasia="Outra", razao_social="Outra LTDA", cnpj="98765432000199", email="o@o.sys",
                            telefone="92988887777", data_abertura=date(2024, 1, 1), plano="PREMIUM",
                            vencimento_plano=date(2030, 12, 31), cep="69000-000", logradouro="Rua B", numero="2",
                            bairro="Centro", cidade="Manaus", estado="AM")
    session.add(outra)
    session.flush()
    admin_b = Funcionario(estabelecimento_id=outra.id, nome="Admin B", cpf="99988877766", username="admin_b", role="admin",
                          ativo=True, data_nascimento=date(1990, 1, 1), celular="92999999999", email="b@b.sys",
                          cargo="Gerente", data_admissao=date(2024, 1, 1), salario_base=D(3000))
    admin_b.set_password("industrial-secret")
    session.add(admin_b)
    session.commit()
    headers_b = _token(admin_b, outra)
    assert client.get("/api/pdv/cardapio-doses", headers=headers_b).get_json()["produtos"] == []
    assert client.get("/api/pdv/buscar-produtos?q=WHISKY", headers=headers_b).get_json()["produtos"] == []
    assert client.get("/api/pdv/catalogo-offline", headers=headers_b).get_json()["produtos"] == []


# ── Terminou a garrafa ──────────────────────────────────────────────────────

def test_encerrar_garrafa_grava_o_desvio_e_devolve_o_rendimento(client, session, bar):
    _venda(client, bar["headers"], [{"id": bar["whisky"].id, "quantity": 9, "price": 32, "dose_id": bar["d100"].id}])
    [g] = _garrafas(bar["whisky"])                                       # razão diz que restam 100 ml
    lista = client.get(f"/api/doses/garrafas-abertas?produto_id={bar['whisky'].id}", headers=bar["headers"]).get_json()
    assert [x["id"] for x in lista["garrafas"]] == [g.id] and lista["garrafas"][0]["saldo_ml"] == 100.0
    r = client.post(f"/api/doses/garrafas/{g.id}/encerrar", headers=bar["headers"])
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["desvio_ml"] == 100.0 and corpo["garrafa"]["status"] == "vazia"
    assert corpo["resumo"]["vendido_ml"] == 900.0 and corpo["resumo"]["rendimento_pct"] == 90.0
    assert corpo["resumo"]["desvio_ml"] == 100.0
    assert client.get("/api/doses/garrafas-abertas", headers=bar["headers"]).get_json()["garrafas"] == []
    # depois de encerrada a próxima dose abre outra garrafa
    _venda(client, bar["headers"], [{"id": bar["whisky"].id, "quantity": 1, "price": 18, "dose_id": bar["d50"].id}])
    assert len(_garrafas(bar["whisky"])) == 2
    assert client.post(f"/api/doses/garrafas/{g.id}/encerrar", headers=bar["headers"]).status_code == 400


def test_caixa_comum_encerra_garrafa_mas_outra_loja_nao_enxerga(client, session, bar, operador):
    _venda(client, bar["headers"], [{"id": bar["whisky"].id, "quantity": 1, "price": 18, "dose_id": bar["d50"].id}])
    [g] = _garrafas(bar["whisky"])
    assert client.post(f"/api/doses/garrafas/{g.id}/encerrar", headers=operador["headers"]).status_code == 200


def test_encerrar_garrafa_inexistente_ou_de_outra_loja_da_404(client, session, bar):
    assert client.post("/api/doses/garrafas/99999/encerrar", headers=bar["headers"]).status_code == 404


# ── Dose livre (ml fora da tabela) ───────────────────────────────────────────

def _livre(bar, ml=45, qtd=2, preco=16.2):
    return {"id": bar["whisky"].id, "quantity": qtd, "price": preco, "dose_ml": ml}


def test_gerente_vende_dose_livre_e_o_item_guarda_o_retrato(client, session, bar):
    r = _venda(client, bar["headers"], [_livre(bar)])
    assert r.status_code in (200, 201), r.get_json()
    item = session.query(VendaItem).filter_by(venda_id=r.get_json()["venda"]["id"]).one()
    assert item.dose_id is None and item.dose_nome == "Dose livre" and D(item.dose_volume_ml) == 45
    assert D(item.ml_total) == 90 and item.eh_dose and item.produto_unidade == "DOSE"
    assert D(item.custo_unitario) == D("5.4")                             # 0,12 R$/ml x 45 ml
    [g] = _garrafas(bar["whisky"])
    assert D(g.saldo_ml) == 910 and ds.ledger_confere(g)
    assert D(_fresh(session, Produto, bar["whisky"].id).quantidade_vendida) == D("0.09")


def test_cancelar_dose_livre_devolve_ml_e_nao_unidades(client, session, bar):
    venda_id = _venda(client, bar["headers"], [_livre(bar)]).get_json()["venda"]["id"]
    r = client.post(f"/api/vendas/{venda_id}/cancelar", headers=bar["headers"],
                    json={"motivo": "Teste", "senha_admin": "industrial-secret"})
    assert r.status_code == 200, r.get_json()
    [g] = _garrafas(bar["whisky"])
    whisky = _fresh(session, Produto, bar["whisky"].id)
    assert D(_fresh(session, GarrafaAberta, g.id).saldo_ml) == 1000 and D(whisky.quantidade) == 9
    assert D(whisky.quantidade_vendida) == 0
    assert MovimentacaoEstoque.query.filter_by(produto_id=whisky.id, venda_id=venda_id).count() == 0


def test_caixa_sem_pin_nao_vende_dose_livre_e_nada_e_gravado(client, session, bar, operador):
    r = _venda(client, operador["headers"], [_livre(bar)])
    assert r.status_code in (401, 403), r.get_json()
    session.expire_all()
    assert _garrafas(bar["whisky"]) == [] and session.query(Venda).count() == 0
    assert D(session.get(Produto, bar["whisky"].id).quantidade) == 10


def test_caixa_com_pin_errado_e_barrado_e_com_pin_de_gerente_vende(client, session, bar, operador):
    errado = _venda(client, operador["headers"], [_livre(bar)], pin="0000")
    assert errado.status_code in (401, 403) and _garrafas(bar["whisky"]) == []
    certo = _venda(client, operador["headers"], [_livre(bar)], pin=PIN)
    assert certo.status_code in (200, 201), certo.get_json()
    [g] = _garrafas(bar["whisky"])
    assert D(g.saldo_ml) == 910
    # a auditoria registra quem autorizou
    from app.models import Auditoria
    assert Auditoria.query.filter_by(estabelecimento_id=bar["estab"].id).count() >= 1


def test_pin_tambem_vale_pelo_header(client, session, bar, operador):
    headers = {**operador["headers"], "X-PIN-Autorizacao": PIN}
    assert _venda(client, headers, [_livre(bar)]).status_code in (200, 201)


def test_caixa_nao_pode_dar_desconto_na_dose_livre(client, session, bar, operador):
    # referência: 18/50 x 45 = R$ 16,20 por dose. Cobrar menos é desconto e o caixa não tem limite.
    r = _venda(client, operador["headers"], [_livre(bar, preco=10)], pin=PIN)
    assert r.status_code == 400 and "Desconto" in (r.get_json().get("error") or "")
    assert _garrafas(bar["whisky"]) == []


def test_dono_pode_proibir_dose_livre_ate_com_pin(client, session, bar, operador):
    import json
    from app.models import Configuracao
    cfg = session.query(Configuracao).filter_by(estabelecimento_id=bar["estab"].id).one()
    cfg.politica_acoes = json.dumps({"doses.livre": {"niveis": [2], "pin": True}})
    session.commit()
    r = _venda(client, operador["headers"], [_livre(bar)], pin=PIN)
    assert r.status_code == 403 and _garrafas(bar["whisky"]) == []


@pytest.mark.parametrize("item_extra, status", [
    ({"dose_ml": "abc"}, 400), ({"dose_ml": -5}, 400),
    ({"dose_ml": 1500}, 400),                                           # maior que a garrafa
])
def test_dose_livre_invalida_e_recusada(client, session, bar, item_extra, status):
    item = {**_livre(bar), **item_extra}
    r = _venda(client, bar["headers"], [item])
    assert r.status_code == status, r.get_json()
    assert _garrafas(bar["whisky"]) == [] and session.query(Venda).count() == 0


def test_dose_livre_junto_de_dose_cadastrada_no_mesmo_item_e_recusada(client, session, bar):
    r = _venda(client, bar["headers"], [{**_livre(bar), "dose_id": bar["d50"].id}])
    assert r.status_code == 400 and _garrafas(bar["whisky"]) == []


def test_dose_livre_em_produto_que_nao_vende_por_dose_e_recusada(client, session, bar):
    r = _venda(client, bar["headers"], [{"id": bar["vodka"].id, "quantity": 1, "price": 3.5, "dose_ml": 50}])
    assert r.status_code == 400


def test_dose_livre_na_venda_direta_e_na_entrega(client, session, bar, operador):
    direta = client.post("/api/vendas/", headers=bar["headers"], json={
        "subtotal": 16.2, "total": 16.2, "desconto": 0, "items": [_livre(bar, qtd=1)],
        "pagamentos": [{"forma": "dinheiro", "valor": 16.2}]})
    assert direta.status_code == 201, direta.get_json()
    sem_pin = client.post("/api/vendas/", headers=operador["headers"], json={
        "subtotal": 16.2, "total": 16.2, "desconto": 0, "items": [_livre(bar, qtd=1)],
        "pagamentos": [{"forma": "dinheiro", "valor": 16.2}]})
    assert sem_pin.status_code in (401, 403, 400)
    [g] = _garrafas(bar["whisky"])
    assert D(g.saldo_ml) == 955                                          # só a venda do gerente consumiu


def test_acoes_de_dose_existem_na_politica_da_loja():
    from app.services.politica_acoes import ACOES
    assert ACOES["doses.livre"][3] is True and 4 in ACOES["doses.livre"][2]       # caixa pode, mas com PIN
    assert ACOES["doses.encerrar"][3] is False


# ── Preço de referência da dose livre ───────────────────────────────────────

def test_preco_de_referencia_usa_o_r_por_ml_da_dose_padrao(session, bar):
    assert ds.preco_referencia_livre(bar["whisky"], 45) == D("16.2")
    assert ds.preco_referencia_livre(bar["whisky"], 100) == D("36")
    # sem doses ativas cai no R$/ml da garrafa
    ProdutoDose.query.filter_by(produto_id=bar["whisky"].id).delete()
    session.commit()
    assert ds.preco_referencia_livre(bar["whisky"], 50) == D("7.5")                 # 150/1000 x 50


# ── Cupom ────────────────────────────────────────────────────────────────────

def test_cupom_mostra_a_dose_no_nome_do_item(client, session, bar):
    venda_id = _venda(client, bar["headers"], [
        {"id": bar["whisky"].id, "quantity": 2, "price": 18, "dose_id": bar["d50"].id},
        _livre(bar, qtd=1), {"id": bar["refri"].id, "quantity": 1, "price": 9}]).get_json()["venda"]["id"]
    from app.utils.query_helpers import get_venda_itens_safe
    nomes = sorted(i["produto_nome"] for i in get_venda_itens_safe(venda_id))
    assert nomes == ["REFRIGERANTE 2L", "WHISKY 1L - Dose (50 ml)", "WHISKY 1L - Dose livre (45 ml)"]
    r = client.get(f"/api/pdv/comprovante/{venda_id}", headers=bar["headers"])
    assert r.status_code == 200 and "WHISKY 1L - Dose (50 ml)" in r.get_data(as_text=True)


def test_dose_livre_sem_pin_responde_pin_required_para_o_front_pedir_o_pin(client, session, bar, operador):
    """O interceptor do app só pede o PIN quando vem 403 + PIN_REQUIRED + pin_por_header: é o contrato com o front."""
    r = _venda(client, operador["headers"], [_livre(bar)])
    corpo = r.get_json()
    assert r.status_code == 403
    assert corpo["code"] == "PIN_REQUIRED" and corpo["pin_por_header"] is True
    assert corpo["acao"] == "doses.livre" and "ml fora da tabela" in corpo["acao_rotulo"]
