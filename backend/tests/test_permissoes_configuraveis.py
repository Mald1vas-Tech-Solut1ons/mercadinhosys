"""Permissões configuráveis por ação + PIN com trava + correções da auditoria de 2026-10-28.

Prova: (1) rota paralela de produto não deixa caixa trocar preço nem vendedor excluir;
(2) o admin decide por loja quem faz cada ação e se exige PIN (ex.: caixa cadastra cliente
só com PIN do gerente), com o PIN pedido pelo header e registrado na auditoria; (3) PIN e
login travam após tentativas erradas; (4) cadastro de fornecedor voltou a funcionar;
(5) caixa não altera limite de crédito; (6) fechamento cego; (7) placa de veículo validada.
"""
from datetime import date
from decimal import Decimal

import pytest
from flask import g
from flask_jwt_extended import create_access_token

from app.models import (Auditoria, Caixa, CategoriaProduto, Cliente, Estabelecimento, Fornecedor, Funcionario,
                        Produto)


def _usuario(session, estab, role, nivel, sufixo):
    f = Funcionario(estabelecimento_id=estab.id, nome=f"{role.title()} {sufixo}", cpf=f"9998887{sufixo:0>4}",
                    username=f"{role.lower()}_{sufixo}", role=role, nivel_acesso=nivel, ativo=True,
                    data_nascimento=date(1995, 1, 1), celular="11999999999", email=f"{role.lower()}{sufixo}@t.sys",
                    cargo=role.title(), data_admissao=date(2024, 1, 1), salario_base=Decimal("2000"))
    f.set_password("senha-teste-1")
    session.add(f)
    session.commit()
    return f


def _h(func, pin=None):
    h = {"Authorization": "Bearer " + create_access_token(identity=str(func.id), additional_claims={
        "estabelecimento_id": func.estabelecimento_id, "role": func.role})}
    if pin:
        h["X-PIN-Autorizacao"] = pin
    return h


@pytest.fixture
def loja(session):
    estab = session.query(Estabelecimento).first()
    g.estabelecimento_id = estab.id
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    admin.role = "ADMIN"
    admin.nivel_acesso = 1
    admin.set_pin("4321")
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Perm")
    session.add(cat)
    session.commit()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Arroz", preco_custo=Decimal("2"),
                   preco_venda=Decimal("5"), quantidade=Decimal("10"))
    session.add(prod)
    session.commit()
    return dict(estab=estab, admin=admin, cat=cat, prod=prod,
                caixa=_usuario(session, estab, "CAIXA", 4, "01"),
                vendedor=_usuario(session, estab, "VENDEDOR", 5, "02"))


def _cliente_payload(**extra):
    corpo = {"nome": "Joana", "cpf": "52998224725", "celular": "11988887777", "cep": "07000000",
             "logradouro": "Rua A", "numero": "1", "bairro": "Centro", "cidade": "Guarulhos", "estado": "SP"}
    corpo.update(extra)
    return corpo


# ───────────────────────── rotas paralelas de produto ─────────────────────────

def test_caixa_nao_troca_preco_pela_rota_paralela(client, session, loja):
    from app.services.catalogo_familias import TAXONOMIA

    p = loja["prod"]
    familia = p.familia_produto or "alimento"
    subcategoria = TAXONOMIA[familia][next(iter(TAXONOMIA[familia]))][0]
    r = client.put(f"/api/produtos/estoque/{p.id}", headers=_h(loja["caixa"]),
                   json={"nome": p.nome, "subcategoria": subcategoria, "preco_custo": 2, "preco_venda": 2.10})
    assert r.status_code == 403 and r.get_json()["code"] == "ACAO_NAO_PERMITIDA"
    session.refresh(p)
    assert p.preco_venda == Decimal("5")

    ok = client.put(f"/api/produtos/estoque/{p.id}", headers=_h(loja["admin"]),
                    json={"nome": p.nome, "subcategoria": subcategoria, "preco_custo": 2, "preco_venda": 6})
    assert ok.status_code == 200, ok.get_data(as_text=True)


def test_vendedor_nao_exclui_produto_pela_rota_paralela(client, session, loja):
    p = loja["prod"]
    r = client.delete(f"/api/produtos/estoque/{p.id}", headers=_h(loja["vendedor"]))
    assert r.status_code == 403
    session.refresh(p)
    assert p.ativo is True


# ───────────────────────── política configurável ─────────────────────────

def test_admin_exige_pin_para_caixa_cadastrar_cliente(client, session, loja):
    admin, caixa = loja["admin"], loja["caixa"]
    r = client.put("/api/configuracao/permissoes", headers=_h(admin),
                   json={"acoes": {"clientes.criar": {"niveis": [2, 4], "pin": True}}})
    assert r.status_code == 200, r.get_data(as_text=True)

    sem_pin = client.post("/api/clientes/", headers=_h(caixa), json=_cliente_payload())
    assert sem_pin.status_code == 403
    corpo = sem_pin.get_json()
    assert corpo["code"] == "PIN_REQUIRED" and corpo["pin_por_header"] is True
    assert corpo["acao_rotulo"] == "Cadastrar cliente"

    com_pin = client.post("/api/clientes/", headers=_h(caixa, pin="4321"), json=_cliente_payload())
    assert com_pin.status_code == 201, com_pin.get_data(as_text=True)
    assert Auditoria.query.filter_by(tipo_evento="autorizacao_pin").count() == 1

    # Admin/gerente não precisam do PIN: eles são a autoridade.
    assert client.post("/api/clientes/", headers=_h(admin),
                       json=_cliente_payload(cpf="11144477735", celular="11977776666")).status_code == 201


def test_admin_tira_acao_do_cargo_e_nao_se_tranca_fora(client, session, loja):
    admin, caixa = loja["admin"], loja["caixa"]
    r = client.put("/api/configuracao/permissoes", headers=_h(admin),
                   json={"acoes": {"clientes.criar": {"niveis": [], "pin": False}}})
    acao = next(a for a in r.get_json()["acoes"] if a["chave"] == "clientes.criar")
    assert acao["niveis"] == [1]  # admin nunca sai
    assert client.post("/api/clientes/", headers=_h(caixa), json=_cliente_payload()).status_code == 403
    assert Auditoria.query.filter_by(tipo_evento="permissoes_alteradas").count() == 1


def test_so_admin_da_loja_altera_permissoes(client, session, loja):
    r = client.put("/api/configuracao/permissoes", headers=_h(loja["caixa"]),
                   json={"acoes": {"produtos.editar": {"niveis": [4], "pin": False}}})
    assert r.status_code == 403
    leitura = client.get("/api/configuracao/permissoes", headers=_h(loja["caixa"]))
    assert leitura.status_code == 200
    assert leitura.get_json()["minhas"]["produtos.editar"] is False


def test_caixa_edita_cliente_mas_nao_o_limite_de_credito(client, session, loja):
    c = Cliente(estabelecimento_id=loja["estab"].id, nome="Joana", cpf="52998224725", celular="11988887777",
                cep="07000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="Guarulhos", estado="SP",
                limite_credito=Decimal("100"))
    session.add(c)
    session.commit()
    caixa = loja["caixa"]
    assert client.put(f"/api/clientes/{c.id}", headers=_h(caixa),
                      json={"nome": "Joana Silva", "limite_credito": 100}).status_code == 200
    r = client.put(f"/api/clientes/{c.id}", headers=_h(caixa), json={"limite_credito": 5000})
    assert r.status_code == 403
    session.refresh(c)
    assert c.limite_credito == Decimal("100")
    assert client.delete(f"/api/clientes/{c.id}", headers=_h(caixa)).status_code == 403


# ───────────────────────── travas de PIN e login ─────────────────────────

def test_pin_trava_apos_tentativas_erradas(client, session, loja):
    caixa = loja["caixa"]
    codigos = [client.post("/api/configuracao/verificar-pin", json={"pin": f"{i:04d}"}, headers=_h(caixa)).status_code
               for i in range(5)]
    assert codigos[:4] == [403] * 4 and codigos[4] == 429
    # Bloqueado: nem o PIN certo passa até o prazo acabar.
    certo = client.post("/api/configuracao/verificar-pin", json={"pin": "4321"}, headers=_h(caixa))
    assert certo.status_code == 429 and certo.get_json()["code"] == "PIN_BLOQUEADO"
    assert Auditoria.query.filter_by(tipo_evento="pin_bloqueado").count() == 1


def test_pin_de_gerente_inativo_nao_autoriza(client, session, loja):
    admin = loja["admin"]
    admin.ativo = False
    session.commit()
    r = client.post("/api/configuracao/verificar-pin", json={"pin": "4321"}, headers=_h(loja["caixa"]))
    assert r.status_code == 403


def test_login_trava_apos_senhas_erradas(client, session, loja):
    caixa = loja["caixa"]
    for _ in range(3):  # configuração padrão da loja: 3 tentativas
        r = client.post("/api/auth/login", json={"username": caixa.username, "senha": "errada"})
        assert r.status_code == 401
    bloqueado = client.post("/api/auth/login", json={"username": caixa.username, "senha": "senha-teste-1"})
    assert bloqueado.status_code == 429 and bloqueado.get_json()["code"] == "LOGIN_BLOQUEADO"


# ───────────────────────── fornecedor, caixa e veículo ─────────────────────────

def test_admin_cadastra_edita_e_inativa_fornecedor(client, session, loja):
    h = _h(loja["admin"])
    cadastro = {
        "nome_fantasia": "Atacado Bom", "razao_social": "Atacado Bom LTDA", "cnpj": "11222333000181",
        "telefone": "11988887777", "email": "compras@atacadobom.com.br", "cep": "07000000",
        "logradouro": "Rua B", "numero": "10", "bairro": "Centro", "cidade": "Guarulhos", "estado": "SP"}
    r = client.post("/api/fornecedores/", headers=h, json=cadastro)
    assert r.status_code == 201, r.get_data(as_text=True)
    fid = (r.get_json().get("fornecedor") or r.get_json().get("data"))["id"]
    assert client.put(f"/api/fornecedores/{fid}", headers=h, json={**cadastro, "nome_fantasia": "Atacado Ótimo"}).status_code == 200
    assert client.patch(f"/api/fornecedores/{fid}/status", headers=h, json={"ativo": False}).status_code == 200
    assert Fornecedor.query.get(fid).ativo is False


def test_fechamento_cego_para_o_caixa(client, session, loja):
    for func in (loja["caixa"], loja["admin"]):
        session.add(Caixa(estabelecimento_id=loja["estab"].id, funcionario_id=func.id, numero_caixa=f"C{func.id}",
                          saldo_inicial=Decimal("100"), saldo_atual=Decimal("100"), status="aberto"))
    session.commit()
    cego = client.get("/api/caixas/atual/resumo", headers=_h(loja["caixa"])).get_json()["data"]
    assert cego["fechamento_cego"] is True
    assert "saldo_esperado_gaveta" not in cego and "saldo_atual" not in cego and "total_vendas" not in cego
    assert "saldo_atual" not in client.get("/api/caixas/atual", headers=_h(loja["caixa"])).get_json()["data"]

    gerente = client.get("/api/caixas/atual/resumo", headers=_h(loja["admin"])).get_json()["data"]
    assert gerente["saldo_esperado_gaveta"] == 100

    # O admin pode liberar a visão para o caixa.
    client.put("/api/configuracao/permissoes", headers=_h(loja["admin"]),
               json={"acoes": {"caixa.ver_esperado": {"niveis": [2, 4], "pin": False}}})
    assert "saldo_esperado_gaveta" in client.get("/api/caixas/atual/resumo", headers=_h(loja["caixa"])).get_json()["data"]


def test_veiculo_exige_placa_valida(client, session, loja):
    h = _h(loja["admin"])
    assert client.post("/api/delivery/veiculos", headers=h, json={"placa": ""}).status_code == 400
    assert client.post("/api/delivery/veiculos", headers=h, json={"placa": "abc-1d23"}).status_code == 201
    assert client.post("/api/delivery/veiculos", headers=_h(loja["caixa"]), json={"placa": "XYZ9A88"}).status_code == 403


# ───────────────────────── datas da venda e custo real ─────────────────────────

def _abrir_caixa(session, loja):
    from datetime import datetime, timezone
    session.add(Caixa(estabelecimento_id=loja["estab"].id, funcionario_id=loja["admin"].id, numero_caixa="DT-1",
                      saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                      data_abertura=datetime.now(timezone.utc)))
    session.commit()


def _vender(client, loja, **extra):
    corpo = {"items": [{"id": loja["prod"].id, "quantity": 1, "discount": 0, "price": 5.0}],
             "subtotal": 5.0, "desconto": 0, "total": 5.0, "pagamentos": [{"forma": "pix", "valor": 5.0}]}
    corpo.update(extra)
    return client.post("/api/pdv/finalizar", headers=_h(loja["admin"]), json=corpo)


def test_venda_do_pdv_grava_em_utc(client, session, loja):
    from datetime import datetime, timezone
    from app.models import Venda
    _abrir_caixa(session, loja)
    antes = datetime.now(timezone.utc).replace(tzinfo=None)
    assert _vender(client, loja).status_code == 201
    venda = Venda.query.order_by(Venda.id.desc()).first()
    assert abs((venda.data_venda - antes).total_seconds()) < 60  # antes: 4 h atrás (fuso de Manaus)


def test_venda_offline_fica_com_a_hora_em_que_foi_feita(client, session, loja):
    from datetime import datetime, timedelta, timezone
    from app.models import Venda
    _abrir_caixa(session, loja)
    feita = (datetime.now(timezone.utc) - timedelta(hours=5)).replace(microsecond=0)
    r = _vender(client, loja, offline_uuid="a1b2c3d4-0000-4000-8000-000000000001",
                offline_criadoEm=feita.isoformat().replace("+00:00", "Z"))
    assert r.status_code == 201, r.get_data(as_text=True)
    venda = Venda.query.order_by(Venda.id.desc()).first()
    assert venda.data_venda == feita.replace(tzinfo=None)

    # Data absurda (futuro ou muito antiga) não é aceita: vale a hora da sincronização.
    r2 = _vender(client, loja, offline_uuid="a1b2c3d4-0000-4000-8000-000000000002",
                 offline_criadoEm="2020-01-01T10:00:00Z")
    assert r2.status_code == 201
    assert Venda.query.order_by(Venda.id.desc()).first().data_venda.year >= 2026


def test_preco_pela_venda_nao_troca_custo_real(client, session, loja):
    p = loja["prod"]
    p.origem_custo = "informado"
    session.commit()
    r = client.put(f"/api/produtos/{p.id}", headers=_h(loja["admin"]),
                   json={"modo_precificacao": "venda", "preco_venda": 8, "margem_alvo_venda_pct": 50})
    assert r.status_code == 200, r.get_data(as_text=True)
    session.refresh(p)
    assert p.preco_venda == Decimal("8") and p.preco_custo == Decimal("2") and p.origem_custo == "informado"


def test_ponto_fora_do_raio_da_loja_e_recusado(client, session, loja):
    h = _h(loja["admin"])
    r = client.put("/api/ponto/configuracao", headers=h, json={
        "exigir_foto": False, "exigir_localizacao": True, "raio_permitido_metros": 100,
        "latitude_loja": -23.4543, "longitude_loja": -46.5333})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["data"]["latitude_loja"] == -23.4543

    longe = client.post("/api/ponto/registrar", headers=_h(loja["caixa"]), json={
        "tipo_registro": "entrada", "latitude": -23.5505, "longitude": -46.6333})  # centro de SP, ~14 km
    assert longe.status_code == 400 and longe.get_json()["code"] == "FORA_DO_RAIO"

    perto = client.post("/api/ponto/registrar", headers=_h(loja["caixa"]), json={
        "tipo_registro": "entrada", "latitude": -23.4545, "longitude": -46.5334})
    assert perto.status_code in (200, 201), perto.get_data(as_text=True)


def test_sync_download_nao_aceita_usuario_comum(client, session, loja):
    r = client.post("/api/sync-hybrid/download", headers=_h(loja["caixa"]), json={"data": {"funcionarios": [
        {"estabelecimento_id": loja["estab"].id, "nome": "Invasor", "username": "invasor", "role": "ADMIN",
         "is_super_admin": True}]}})
    assert r.status_code in (401, 403)
    assert Funcionario.query.filter_by(username="invasor").count() == 0


def test_token_fiscal_nunca_sai_na_api(client, session, loja):
    loja["estab"].fiscal_token = "segredo-focus"
    loja["estab"].fiscal_csc = "csc-secreto"
    session.commit()
    corpo = client.get("/api/configuracao/estabelecimento", headers=_h(loja["caixa"])).get_data(as_text=True)
    assert "segredo-focus" not in corpo and "csc-secreto" not in corpo
    assert '"fiscal_token_configurado": true' in corpo or '"fiscal_token_configurado":true' in corpo
