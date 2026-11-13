"""Venda por dose (WP3): o lojista configura as doses (ml livre, preço livre), os padrões da loja e aplica em lote.

Cenário: whisky de 1 L (custo R$ 120, venda R$ 150). Sem dose fixa no sistema: 30, 50, 51,5 ou 100 ml valem igual.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (
    Caixa, CategoriaProduto, Estabelecimento, Funcionario, Produto, ProdutoLote, Venda, VendaItem,
)
from app.models_dose import ProdutoDose
from app.services import dose_config_service as cfg
from app.utils.timezone import hoje_local


def D(v):
    return Decimal(str(v))


def _produto(session, estab, cat, nome, custo=120, venda=150, quantidade=10, **extra):
    produto = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome=nome, unidade_medida="UN",
                      preco_custo=D(custo), preco_venda=D(venda), quantidade=D(quantidade), controlar_validade=True,
                      **extra)
    session.add(produto)
    session.flush()
    if quantidade:
        session.add(ProdutoLote(estabelecimento_id=estab.id, produto_id=produto.id, numero_lote=f"L-{produto.id}",
                                quantidade=quantidade, quantidade_inicial=quantidade, data_entrada=hoje_local(),
                                data_validade=hoje_local() + timedelta(days=90), preco_custo_unitario=D(custo),
                                ativo=True))
    return produto


@pytest.fixture
def loja(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Destilados")
    session.add(cat)
    session.flush()
    whisky = _produto(session, estab, cat, "WHISKY RED 1L", marca="Marca A", subcategoria_oficial="bebida.whisky")
    gin = _produto(session, estab, cat, "GIN TANQUE 750ML", custo=90, venda=120, marca="Marca A",
                   subcategoria_oficial="bebida.whisky")
    misterio = _produto(session, estab, cat, "LICOR ARTESANAL", custo=40, venda=60, marca="Marca A",
                        subcategoria_oficial="bebida.whisky")
    servico = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Taxa", unidade_medida="SV",
                      preco_custo=D(0), preco_venda=D(5), quantidade=D(0), tipo_item="servico",
                      controlar_estoque=False)
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="C-1", saldo_inicial=0,
                  saldo_atual=0, status="aberto")
    session.add_all([servico, caixa])
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, cat=cat, whisky=whisky, gin=gin, misterio=misterio, servico=servico,
                headers={"Authorization": f"Bearer {token}"})


@pytest.fixture
def outra_loja(session, loja):
    estab = Estabelecimento(nome_fantasia="Outra Loja", razao_social="Outra LTDA", cnpj="98765432000199",
                            email="outra@x.sys", telefone="92988887777", data_abertura=date(2024, 1, 1),
                            plano="PREMIUM", vencimento_plano=date(2030, 12, 31), cep="69000-000",
                            logradouro="Rua B", numero="2", bairro="Centro", cidade="Manaus", estado="AM")
    session.add(estab)
    session.flush()
    admin = Funcionario(estabelecimento_id=estab.id, nome="Admin B", cpf="99988877766", username="admin_b", role="admin",
                        ativo=True, data_nascimento=date(1990, 1, 1), celular="92999999999", email="b@b.sys",
                        cargo="Gerente", data_admissao=date(2024, 1, 1), salario_base=D(3000))
    admin.set_password("industrial-secret")
    session.add(admin)
    session.commit()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, headers={"Authorization": f"Bearer {token}"})


def _get(client, loja, produto):
    return client.get(f"/api/doses/produto/{produto.id}", headers=loja["headers"])


def _put(client, loja, produto, corpo):
    return client.put(f"/api/doses/produto/{produto.id}", headers=loja["headers"], json=corpo)


def _corpo(**extra):
    corpo = {"vende_por_dose": True, "volume_embalagem_ml": 1000,
             "doses": [{"nome": "Dose", "volume_ml": 50, "preco_venda": 18, "padrao": True},
                       {"nome": "Dupla", "volume_ml": 100, "preco_venda": 32}]}
    corpo.update(extra)
    return corpo


# ── Leitura e cálculo ──────────────────────────────────────────────────────

def test_produto_sem_doses_sugere_o_volume_do_nome_e_os_atalhos_da_loja(client, session, loja):
    r = _get(client, loja, loja["whisky"])
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["config"]["vende_por_dose"] is False and corpo["config"]["volume_embalagem_ml"] is None
    assert corpo["config"]["volume_sugerido_ml"] == 1000.0           # "WHISKY RED 1L"
    assert corpo["doses"] == [] and corpo["garrafas_abertas"] == 0
    # a loja ainda não definiu os ml que trabalha: vêm só como sugestão inicial
    assert corpo["loja"]["doses_padrao_definidas"] is False
    assert [d["volume_ml"] for d in corpo["loja"]["doses_padrao"]] == [50, 100]


def test_salvar_grava_doses_e_calcula_custo_margem_e_rendimento(client, session, loja):
    r = _put(client, loja, loja["whisky"], _corpo())
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["config"]["vende_por_dose"] is True and corpo["config"]["volume_embalagem_ml"] == 1000.0
    dose, dupla = corpo["doses"]
    assert dose["padrao"] is True and dupla["padrao"] is False and dose["ordem"] == 0
    assert dose["calc"]["custo_dose"] == 6.0 and dose["calc"]["margem_valor"] == 12.0
    assert dose["calc"]["margem_pct"] == pytest.approx(66.7, abs=0.05)
    assert dose["calc"]["doses_por_garrafa"] == 20.0 and dose["calc"]["receita_garrafa"] == 360.0
    assert dose["calc"]["multiplo_da_garrafa"] == 2.4                # 20 x R$ 18 contra a garrafa de R$ 150
    assert dose["calc"]["abaixo_da_garrafa"] is False
    assert dupla["calc"]["custo_dose"] == 12.0 and dupla["calc"]["doses_por_garrafa"] == 10.0
    session.expire_all()
    produto = session.get(Produto, loja["whisky"].id)
    assert produto.vende_por_dose is True and D(produto.volume_embalagem_ml) == 1000


def test_ml_e_livre_inclusive_com_casas_decimais(client, session, loja):
    r = _put(client, loja, loja["whisky"], _corpo(doses=[
        {"nome": "Dose do bar", "volume_ml": 51.5, "preco_venda": 19.9},
        {"nome": "Meia", "volume_ml": "25,5", "preco_venda": "9,90"},
        {"nome": "Taça", "volume_ml": 150, "preco_venda": 45}]))
    assert r.status_code == 200, r.get_json()
    mls = [d["volume_ml"] for d in r.get_json()["doses"]]
    assert mls == [51.5, 25.5, 150.0]
    assert r.get_json()["doses"][0]["calc"]["custo_dose"] == pytest.approx(6.18)
    assert r.get_json()["doses"][0]["padrao"] is True                # nenhuma marcada: a primeira vira padrão


def test_perda_esperada_encarece_a_dose(client, session, loja):
    r = _put(client, loja, loja["whisky"], _corpo(perda_esperada_pct=10))
    dose = r.get_json()["doses"][0]
    assert dose["calc"]["custo_dose"] == pytest.approx(120 / 900 * 50, abs=1e-4)      # 6,6667
    assert dose["calc"]["doses_vendaveis"] == 18.0 and dose["calc"]["receita_garrafa"] == 324.0
    assert r.get_json()["config"]["perda_efetiva_pct"] == 10.0


def test_perda_da_loja_vale_quando_o_produto_nao_define(client, session, loja):
    assert client.put("/api/doses/config", headers=loja["headers"], json={"perda_esperada_pct": 5}).status_code == 200
    r = _put(client, loja, loja["whisky"], _corpo())
    assert r.get_json()["config"]["perda_efetiva_pct"] == 5.0 and r.get_json()["config"]["perda_esperada_pct"] is None
    assert r.get_json()["doses"][0]["calc"]["custo_dose"] == pytest.approx(120 / 950 * 50, abs=1e-4)


def test_avisos_de_margem_e_de_dose_mais_barata_que_a_garrafa(client, session, loja):
    client.put("/api/doses/config", headers=loja["headers"], json={"margem_alvo_dose_pct": 70})
    r = _put(client, loja, loja["whisky"], _corpo(doses=[
        {"nome": "Dose", "volume_ml": 50, "preco_venda": 18},         # margem 66,7% < meta 70%
        {"nome": "Promo", "volume_ml": 50, "preco_venda": 5}]))       # não cobre o custo e R$/ml abaixo da garrafa
    tipos = {(a["dose"], a["tipo"]) for a in r.get_json()["avisos"]}
    assert ("Dose", "margem_baixa") in tipos
    assert ("Promo", "margem_negativa") in tipos and ("Promo", "abaixo_da_garrafa") in tipos


# ── Validação ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("corpo, trecho", [
    ({"doses": [{"nome": "Gigante", "volume_ml": 1500, "preco_venda": 90}]}, "maior que a garrafa"),
    ({"doses": [{"nome": "Zero", "volume_ml": 0, "preco_venda": 10}]}, "maior que zero"),
    ({"doses": [{"nome": "Grátis", "volume_ml": 50, "preco_venda": 0}]}, "maior que zero"),
    ({"doses": [{"nome": "Letra", "volume_ml": "abc", "preco_venda": 10}]}, "inválido"),
    ({"doses": [{"nome": "Dose", "volume_ml": 50, "preco_venda": 10}, {"nome": "dose", "volume_ml": 60, "preco_venda": 12}]},
     "duas doses"),
    ({"doses": [{"nome": "A", "volume_ml": 50, "preco_venda": 10, "padrao": True},
                {"nome": "B", "volume_ml": 60, "preco_venda": 12, "padrao": True}]}, "só uma dose padrão"),
    ({"doses": []}, "ao menos uma dose"),
    ({"volume_embalagem_ml": None}, "olume da garrafa"),
    ({"volume_embalagem_ml": -5}, "maior que zero"),
    ({"doses": [{"nome": f"D{i}", "volume_ml": 10 + i, "preco_venda": 5} for i in range(13)]}, "No máximo"),
    ({"perda_esperada_pct": 80}, "máximo"),
    ({"validade_aberta_dias": 0}, "mínimo"),
])
def test_validacao_recusa_e_nao_grava_nada(client, session, loja, corpo, trecho):
    r = _put(client, loja, loja["whisky"], _corpo(**corpo))
    assert r.status_code == 400, r.get_json()
    assert trecho in r.get_json()["error"]
    session.expire_all()
    assert ProdutoDose.query.filter_by(produto_id=loja["whisky"].id).count() == 0
    assert session.get(Produto, loja["whisky"].id).vende_por_dose is False


def test_servico_nao_vende_por_dose(client, session, loja):
    r = _put(client, loja, loja["servico"], _corpo())
    assert r.status_code == 400 and "Serviço" in r.get_json()["error"]


def test_desligar_dose_nao_exige_volume_e_mantem_as_doses(client, session, loja):
    assert _put(client, loja, loja["whisky"], _corpo()).status_code == 200
    r = _put(client, loja, loja["whisky"], {"vende_por_dose": False, "volume_embalagem_ml": 1000,
                                            "doses": _get(client, loja, loja["whisky"]).get_json()["doses"]})
    assert r.status_code == 200 and r.get_json()["config"]["vende_por_dose"] is False
    assert len(r.get_json()["doses"]) == 2


# ── Edição preserva histórico ──────────────────────────────────────────────

def test_dose_nunca_vendida_e_apagada_e_a_vendida_e_arquivada(client, session, loja):
    estado = _put(client, loja, loja["whisky"], _corpo()).get_json()
    dose, dupla = estado["doses"]
    # a "Dose" foi vendida: o histórico aponta para ela
    venda = Venda(estabelecimento_id=loja["estab"].id, codigo="V-1", funcionario_id=loja["admin"].id, subtotal=18,
                  desconto=0, total=18, valor_recebido=18, troco=0, status="finalizada")
    session.add(venda)
    session.flush()
    session.add(VendaItem(venda_id=venda.id, estabelecimento_id=loja["estab"].id, produto_id=loja["whisky"].id,
                          produto_nome="WHISKY RED 1L", quantidade=1, preco_unitario=18, total_item=18,
                          dose_id=dose["id"], dose_nome="Dose", dose_volume_ml=50))
    session.commit()
    # o lojista tira as duas doses e cria uma nova também chamada "Dose"
    r = _put(client, loja, loja["whisky"], _corpo(doses=[{"nome": "Dose", "volume_ml": 60, "preco_venda": 20}]))
    assert r.status_code == 200, r.get_json()
    session.expire_all()
    todas = {d.id: d for d in ProdutoDose.query.filter_by(produto_id=loja["whisky"].id).all()}
    assert dupla["id"] not in todas                                       # nunca vendida: apagada
    assert todas[dose["id"]].ativa is False and todas[dose["id"]].padrao is False   # vendida: arquivada
    novas = [d for d in todas.values() if d.ativa]
    assert len(novas) == 1 and novas[0].nome == "Dose" and D(novas[0].volume_ml) == 60 and novas[0].padrao is True
    # a dose arquivada continua legível no histórico e não aparece como ativa no retorno
    assert [x["id"] for x in r.get_json()["doses"] if x["ativa"]] == [novas[0].id]


def test_editar_dose_existente_mantem_o_id(client, session, loja):
    dose, dupla = _put(client, loja, loja["whisky"], _corpo()).get_json()["doses"]
    r = _put(client, loja, loja["whisky"], _corpo(doses=[
        {"id": dose["id"], "nome": "Dose", "volume_ml": 45, "preco_venda": 17, "padrao": True},
        {"id": dupla["id"], "nome": "Dupla", "volume_ml": 90, "preco_venda": 30}]))
    assert [d["id"] for d in r.get_json()["doses"]] == [dose["id"], dupla["id"]]
    assert [d["volume_ml"] for d in r.get_json()["doses"]] == [45.0, 90.0]


def test_dose_de_outro_produto_nao_pode_ser_editada_por_id(client, session, loja):
    dose, _ = _put(client, loja, loja["whisky"], _corpo()).get_json()["doses"]
    r = _put(client, loja, loja["gin"], {"vende_por_dose": True, "volume_embalagem_ml": 750, "doses": [
        {"id": dose["id"], "nome": "Roubada", "volume_ml": 50, "preco_venda": 10}]})
    assert r.status_code == 400 and "não pertence" in r.get_json()["error"]


# ── Isolamento e permissão ─────────────────────────────────────────────────

def test_outra_loja_nao_ve_nem_altera_as_doses(client, session, loja, outra_loja):
    _put(client, loja, loja["whisky"], _corpo())
    assert client.get(f"/api/doses/produto/{loja['whisky'].id}", headers=outra_loja["headers"]).status_code == 404
    assert client.put(f"/api/doses/produto/{loja['whisky'].id}", headers=outra_loja["headers"],
                      json=_corpo()).status_code == 404
    assert len(_get(client, loja, loja["whisky"]).get_json()["doses"]) == 2


def test_rotas_exigem_login(client, session, loja):
    assert client.get(f"/api/doses/produto/{loja['whisky'].id}").status_code in (401, 422)
    assert client.put(f"/api/doses/produto/{loja['whisky'].id}", json=_corpo()).status_code in (401, 422)
    assert client.get("/api/doses/config").status_code in (401, 422)
    assert client.post("/api/doses/aplicar", json={}).status_code in (401, 422)


def test_config_da_loja_e_isolada_por_loja(client, session, loja, outra_loja):
    assert client.put("/api/doses/config", headers=loja["headers"], json={"margem_alvo_dose_pct": 65}).status_code == 200
    # a outra loja não tem Configuracao no fixture: não enxerga a da primeira
    assert client.get("/api/doses/config", headers=outra_loja["headers"]).get_json()["margem_alvo_definida"] is False


# ── Padrões da loja ────────────────────────────────────────────────────────

def test_config_da_loja_guarda_os_ml_que_ela_trabalha(client, session, loja):
    r = client.put("/api/doses/config", headers=loja["headers"], json={
        "doses_padrao": [{"nome": "Shot", "volume_ml": 40}, {"nome": "Dose longa", "volume_ml": 72.5}],
        "margem_alvo_dose_pct": 65, "perda_esperada_pct": 4, "alerta_garrafa_aberta_dias": 15,
        "alerta_rendimento_pct": 92})
    assert r.status_code == 200, r.get_json()
    c = client.get("/api/doses/config", headers=loja["headers"]).get_json()
    assert c["doses_padrao"] == [{"nome": "Shot", "volume_ml": 40.0}, {"nome": "Dose longa", "volume_ml": 72.5}]
    assert c["doses_padrao_definidas"] is True and c["margem_alvo_dose_pct"] == 65.0 and c["margem_alvo_definida"] is True
    assert c["perda_esperada_pct"] == 4.0 and c["alerta_garrafa_aberta_dias"] == 15 and c["alerta_rendimento_pct"] == 92.0


@pytest.mark.parametrize("corpo", [
    {"doses_padrao": []}, {"doses_padrao": [{"nome": "A", "volume_ml": 0}]},
    {"doses_padrao": [{"nome": "A", "volume_ml": 30}, {"nome": "a", "volume_ml": 40}]},
    {"margem_alvo_dose_pct": 100}, {"perda_esperada_pct": 51}, {"alerta_garrafa_aberta_dias": 0},
    {"alerta_rendimento_pct": 120}, {"doses_padrao": "50,100"},
])
def test_config_da_loja_recusa_valor_invalido(client, session, loja, corpo):
    assert client.put("/api/doses/config", headers=loja["headers"], json=corpo).status_code == 400


# ── Aplicar em lote ────────────────────────────────────────────────────────

MODELO = [{"nome": "Dose", "volume_ml": 50, "margem_alvo_pct": 60, "padrao": True},
          {"nome": "Dupla", "volume_ml": 100, "margem_alvo_pct": 60}]


def _aplicar(client, loja, **extra):
    corpo = {"modelo": MODELO, "selecao": {"subcategoria_oficial": "bebida.whisky"}}
    corpo.update(extra)
    return client.post("/api/doses/aplicar", headers=loja["headers"], json=corpo)


def test_aplicar_sem_confirmar_so_pre_visualiza(client, session, loja):
    r = _aplicar(client, loja)
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["dry_run"] is True and corpo["aplicados"] == 2 and corpo["ignorados"] == 1
    por_nome = {l["nome"]: l for l in corpo["linhas"]}
    whisky = por_nome["WHISKY RED 1L"]
    assert whisky["status"] == "aplicar" and whisky["volume_embalagem_ml"] == 1000.0 and whisky["origem_volume"] == "nome"
    # custo 120/1000 x 50 = 6 -> margem 60% sobre a venda = 15,00; dupla: 12 -> 30,00
    assert [d["preco_venda"] for d in whisky["doses"]] == [15.0, 30.0]
    assert por_nome["GIN TANQUE 750ML"]["doses"][0]["preco_venda"] == 15.0     # 90/750 x 50 = 6 -> margem 60% = 15,00
    assert por_nome["LICOR ARTESANAL"]["status"] == "ignorado" and "Volume da garrafa" in por_nome["LICOR ARTESANAL"]["motivo"]
    session.expire_all()
    assert ProdutoDose.query.count() == 0 and session.get(Produto, loja["whisky"].id).vende_por_dose is False


def test_aplicar_confirmado_grava_e_usa_volume_padrao_para_quem_nao_tem(client, session, loja):
    r = _aplicar(client, loja, dry_run=False, volume_padrao_ml=700)
    assert r.status_code == 200, r.get_json()
    corpo = r.get_json()
    assert corpo["dry_run"] is False and corpo["aplicados"] == 3
    licor = next(l for l in corpo["linhas"] if l["nome"] == "LICOR ARTESANAL")
    assert licor["origem_volume"] == "padrao" and licor["volume_embalagem_ml"] == 700.0
    session.expire_all()
    for produto in (loja["whisky"], loja["gin"], loja["misterio"]):
        p = session.get(Produto, produto.id)
        assert p.vende_por_dose is True and ProdutoDose.query.filter_by(produto_id=p.id, ativa=True).count() == 2
    assert D(session.get(Produto, loja["misterio"].id).volume_embalagem_ml) == 700


def test_aplicar_com_preco_fixo_e_por_lista_de_ids(client, session, loja):
    r = _aplicar(client, loja, dry_run=False, selecao={"produto_ids": [loja["whisky"].id]},
                 modelo=[{"nome": "Dose", "volume_ml": 60, "preco_venda": 22}])
    assert r.status_code == 200 and r.get_json()["aplicados"] == 1
    [dose] = ProdutoDose.query.filter_by(produto_id=loja["whisky"].id).all()
    assert D(dose.volume_ml) == 60 and D(dose.preco_venda) == 22
    assert ProdutoDose.query.filter_by(produto_id=loja["gin"].id).count() == 0


def test_aplicar_modo_acrescentar_mantem_as_doses_atuais(client, session, loja):
    _put(client, loja, loja["whisky"], _corpo())
    r = _aplicar(client, loja, dry_run=False, selecao={"produto_ids": [loja["whisky"].id]}, modo="acrescentar",
                 modelo=[{"nome": "Dose", "volume_ml": 60, "preco_venda": 99},          # já existe: não duplica
                         {"nome": "Taça", "volume_ml": 150, "preco_venda": 40}])
    assert r.status_code == 200, r.get_json()
    nomes = {d.nome: d for d in ProdutoDose.query.filter_by(produto_id=loja["whisky"].id, ativa=True).all()}
    assert set(nomes) == {"Dose", "Dupla", "Taça"} and D(nomes["Dose"].volume_ml) == 50    # a atual ficou como estava


def test_aplicar_substituir_troca_as_doses_do_produto(client, session, loja):
    _put(client, loja, loja["whisky"], _corpo())
    r = _aplicar(client, loja, dry_run=False, selecao={"produto_ids": [loja["whisky"].id]},
                 modelo=[{"nome": "Shot", "volume_ml": 40, "preco_venda": 14}])
    assert r.status_code == 200 and r.get_json()["aplicados"] == 1
    ativas = ProdutoDose.query.filter_by(produto_id=loja["whisky"].id, ativa=True).all()
    assert [d.nome for d in ativas] == ["Shot"]


def test_aplicar_pula_a_dose_maior_que_a_garrafa_e_explica(client, session, loja):
    r = _aplicar(client, loja, selecao={"produto_ids": [loja["gin"].id]},
                 modelo=[{"nome": "Dose", "volume_ml": 50, "preco_venda": 15},
                         {"nome": "Magnum", "volume_ml": 900, "preco_venda": 100}])
    [linha] = r.get_json()["linhas"]
    assert [d["nome"] for d in linha["doses"]] == ["Dose"] and "Magnum" in linha["motivo"]


def test_aplicar_valida_selecao_e_modelo(client, session, loja):
    assert _aplicar(client, loja, selecao={}).status_code == 400
    assert _aplicar(client, loja, selecao={"produto_ids": ["x"]}).status_code == 400
    assert _aplicar(client, loja, modelo=[]).status_code == 400
    assert _aplicar(client, loja, modo="apagar").status_code == 400
    assert _aplicar(client, loja, modelo=[{"nome": "Dose", "volume_ml": 50, "margem_alvo_pct": 100}]).status_code == 400


def test_aplicar_nunca_alcanca_produto_de_outra_loja(client, session, loja, outra_loja):
    r = client.post("/api/doses/aplicar", headers=outra_loja["headers"], json={
        "modelo": MODELO, "dry_run": False, "volume_padrao_ml": 1000,
        "selecao": {"produto_ids": [loja["whisky"].id]}})
    assert r.status_code == 200 and r.get_json()["aplicados"] == 0 and r.get_json()["linhas"] == []
    assert ProdutoDose.query.count() == 0


# ── Detecção do volume e sugestão de preço ─────────────────────────────────

@pytest.mark.parametrize("texto, esperado", [
    ("WHISKY RED 1L", 1000), ("Vinho tinto 750ml", 750), ("Vodka 1,75L", 1750), ("Licor 70cl", 700),
    ("Refrigerante 2 Litros", 2000), ("Cachaça 600 ml", 600), ("Whisky 12 anos 1L", 1000),
    ("Cerveja Lata", None), ("Camiseta G", None), ("", None), (None, None),
])
def test_detectar_volume(texto, esperado):
    ml = cfg.detectar_volume_ml(texto)
    assert (float(ml) if ml is not None else None) == (float(esperado) if esperado is not None else None)


@pytest.mark.parametrize("custo_dose, margem, esperado", [
    ("6", 60, "15.00"), ("6.6667", 60, "17.00"), ("6", 50, "12.00"), ("7", 60, "17.50"), ("0.01", 60, "0.50"),
])
def test_sugerir_preco_arredonda_para_cima_ao_proximo_cinquenta_centavos(custo_dose, margem, esperado):
    assert cfg.sugerir_preco(D(custo_dose), margem) == D(esperado)


# ── Ponta a ponta: configurou, vendeu ──────────────────────────────────────

def test_dose_configurada_pela_api_vende_no_pdv(client, session, loja):
    dose, _ = _put(client, loja, loja["whisky"], _corpo()).get_json()["doses"]
    r = client.post("/api/pdv/finalizar", headers=loja["headers"], json={
        "subtotal": 36, "total": 36, "desconto": 0,
        "items": [{"id": loja["whisky"].id, "quantity": 2, "price": 18, "dose_id": dose["id"]}],
        "pagamentos": [{"forma": "dinheiro", "valor": 36}]})
    assert r.status_code in (200, 201), r.get_json()
    item = session.query(VendaItem).filter_by(dose_id=dose["id"]).one()
    assert item.dose_nome == "Dose" and D(item.ml_total) == 100 and D(item.custo_unitario) == 6
    estado = _get(client, loja, loja["whisky"]).get_json()
    assert estado["garrafas_abertas"] == 1


# ── Permissão: caixa lê, mas não configura ─────────────────────────────────

@pytest.fixture
def caixa_token(session, loja):
    caixa = Funcionario(estabelecimento_id=loja["estab"].id, nome="Caixa", cpf="55544433322", username="caixa_x",
                        role="caixa", ativo=True, data_nascimento=date(1995, 1, 1), celular="92999999999",
                        email="caixa@x.sys", cargo="Caixa", data_admissao=date(2024, 1, 1), salario_base=D(2000))
    caixa.set_password("industrial-secret")
    session.add(caixa)
    session.commit()
    token = create_access_token(identity=str(caixa.id), additional_claims={
        "estabelecimento_id": loja["estab"].id, "role": "caixa"})
    return {"Authorization": f"Bearer {token}"}


def test_caixa_le_as_doses_mas_nao_configura(client, session, loja, caixa_token):
    _put(client, loja, loja["whisky"], _corpo())
    assert client.get(f"/api/doses/produto/{loja['whisky'].id}", headers=caixa_token).status_code == 200
    assert client.get("/api/doses/config", headers=caixa_token).status_code == 200
    r = client.put(f"/api/doses/produto/{loja['whisky'].id}", headers=caixa_token, json=_corpo(doses=[
        {"nome": "Dose", "volume_ml": 50, "preco_venda": 1}]))
    assert r.status_code == 403, r.get_json()
    assert client.put("/api/doses/config", headers=caixa_token, json={"margem_alvo_dose_pct": 10}).status_code == 403
    assert client.post("/api/doses/aplicar", headers=caixa_token, json={
        "modelo": MODELO, "dry_run": False, "selecao": {"produto_ids": [loja["gin"].id], "volume_padrao_ml": 750}}
    ).status_code == 403
    session.expire_all()
    assert [d.preco_venda for d in ProdutoDose.query.filter_by(produto_id=loja["whisky"].id).all()] != [D(1)]
