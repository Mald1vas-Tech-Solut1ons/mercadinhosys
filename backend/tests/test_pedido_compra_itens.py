"""
Reprodução do bug relatado: pedido de compra criado com item, mas a lista/detalhe
mostram "0 itens" (Total > 0 e 0 itens). Prova o ciclo criar → listar → detalhar.
"""
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import db, Estabelecimento, Funcionario, CategoriaProduto, Produto, Fornecedor


def _headers(estab_id, func_id):
    token = create_access_token(identity=str(func_id), additional_claims={
        "estabelecimento_id": estab_id, "role": "admin",
    })
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    forn = Fornecedor(estabelecimento_id=estab.id, nome_fantasia="LimpaTudo Atacado",
                      razao_social="LimpaTudo LTDA", cnpj="11222333000144",
                      telefone="9233330000", email="forn@limpatudo.com",
                      cep="69000-000", logradouro="Rua X", numero="1",
                      bairro="Centro", cidade="Manaus", estado="AM", pais="Brasil")
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Limpeza")
    session.add_all([forn, cat])
    session.flush()
    prod = Produto(estabelecimento_id=estab.id, categoria_id=cat.id, nome="Água Sanitária 2L",
                   preco_custo=Decimal("4.00"), preco_venda=Decimal("7.00"), quantidade=0)
    session.add(prod)
    session.commit()
    return {"estab": estab, "admin": admin, "forn": forn, "prod": prod}


def test_pedido_persiste_datas_e_horario_de_entrega(client, ctx):
    """Campos profissionais do pedido: data do pedido, previsão e horário de entrega
    informados pelo operador devem ser salvos e retornados."""
    estab, admin, forn, prod = ctx["estab"], ctx["admin"], ctx["forn"], ctx["prod"]
    headers = _headers(estab.id, admin.id)

    r = client.post("/api/pedidos-compra/", json={
        "fornecedor_id": forn.id,
        "data_pedido": "2026-07-01",
        "data_previsao_entrega": "2026-07-05",
        "horario_entrega": "08:00 - 12:00",
        "itens": [{"produto_id": prod.id, "quantidade": 3, "preco_unitario": 4.0, "desconto_percentual": 0}],
    }, headers=headers)
    assert r.status_code == 201, r.get_data(as_text=True)
    pedido_id = r.get_json()["pedido"]["id"]

    det = client.get(f"/api/pedidos-compra/{pedido_id}", headers=headers).get_json()
    p = det.get("pedido", det)
    assert (p.get("data_pedido") or "").startswith("2026-07-01"), p.get("data_pedido")
    assert p.get("data_previsao_entrega") == "2026-07-05", p.get("data_previsao_entrega")
    assert p.get("horario_entrega") == "08:00 - 12:00", p.get("horario_entrega")


def test_fluxo_real_cadastra_busca_por_agua_e_pedido_sobe_o_item(client, ctx):
    """Fluxo EXATO do usuário: cadastra 'Água Sanitária Supreme', BUSCA por 'agua'
    (sem acento) no endpoint real, pega o id retornado, cria o pedido com esse id
    e confere que o pedido NÃO fica com 0 itens — o produto sobe e aparece."""
    estab, admin, forn = ctx["estab"], ctx["admin"], ctx["forn"]
    headers = _headers(estab.id, admin.id)

    # 1) Cadastra o produto via API (como o usuário fez)
    rc = client.post("/api/produtos/", json={
        "entrar_sem_estoque": True,  # guardião: estoque 0 só com exceção consciente
        "nome": "Água Sanitária Supreme", "subcategoria": "Outros Alimentos",
        "preco_custo": 4.20, "preco_venda": 7.90, "quantidade": 0, "entrar_sem_estoque": True,
        "codigo_barras": "7899999000015",
    }, headers=headers)
    assert rc.status_code in (200, 201), rc.get_data(as_text=True)

    # 2) BUSCA por 'agua' (sem acento) — tem que achar
    rb = client.get("/api/produtos/?busca=agua&por_pagina=20", headers=headers)
    assert rb.status_code == 200, rb.get_data(as_text=True)
    achados = [p for p in rb.get_json().get("produtos", []) if p["nome"] == "ÁGUA SANITÁRIA SUPREME"]
    assert achados, f"busca 'agua' não achou o produto: {[p['nome'] for p in rb.get_json().get('produtos', [])]}"
    produto_id = achados[0]["id"]

    # 3) Cria o pedido com o produto encontrado
    rp = client.post("/api/pedidos-compra/", json={
        "fornecedor_id": forn.id, "condicao_pagamento": "pix",
        "itens": [{"produto_id": produto_id, "quantidade": 12, "preco_unitario": 4.20, "desconto_percentual": 0}],
    }, headers=headers)
    assert rp.status_code == 201, rp.get_data(as_text=True)
    pedido_id = rp.get_json()["pedido"]["id"]

    # 4) O pedido NÃO pode ficar com 0 itens — o produto subiu
    rl = client.get("/api/pedidos-compra/", headers=headers)
    alvo = next(p for p in rl.get_json()["pedidos"] if p["id"] == pedido_id)
    assert alvo["total_itens"] == 1, f"PEDIDO SUBIU 0 ITENS (bug do PC000006). total_itens={alvo['total_itens']}"
    assert alvo["itens"][0]["produto_nome"] == "ÁGUA SANITÁRIA SUPREME"


def test_pedido_com_item_aparece_na_lista_e_detalhe(client, ctx):
    estab, admin, forn, prod = ctx["estab"], ctx["admin"], ctx["forn"], ctx["prod"]
    headers = _headers(estab.id, admin.id)

    # 1) Criar pedido com 1 item (Água Sanitária)
    r = client.post("/api/pedidos-compra/", json={
        "fornecedor_id": forn.id,
        "condicao_pagamento": "pix",
        "itens": [{"produto_id": prod.id, "quantidade": 12, "preco_unitario": 4.00, "desconto_percentual": 0}],
    }, headers=headers)
    assert r.status_code == 201, r.get_data(as_text=True)
    pedido = r.get_json()["pedido"]
    pedido_id = pedido["id"]

    # 2) LISTA deve mostrar o item (total_itens >= 1)
    rl = client.get("/api/pedidos-compra/", headers=headers)
    assert rl.status_code == 200, rl.get_data(as_text=True)
    pedidos = rl.get_json()["pedidos"]
    alvo = next((p for p in pedidos if p["id"] == pedido_id), None)
    assert alvo is not None, "pedido criado não apareceu na lista"
    assert alvo["total_itens"] == 1, f"lista mostrou {alvo['total_itens']} itens (esperado 1)"
    assert len(alvo["itens"]) == 1
    assert alvo["itens"][0]["produto_nome"] == "Água Sanitária 2L"

    # 3) DETALHE deve trazer o item
    rd = client.get(f"/api/pedidos-compra/{pedido_id}", headers=headers)
    assert rd.status_code == 200, rd.get_data(as_text=True)
    det = rd.get_json()
    itens = det.get("itens") or det.get("pedido", {}).get("itens")
    assert itens and len(itens) == 1, f"detalhe sem itens: {det}"
    assert Decimal(str(det.get("total") or det.get("pedido", {}).get("total"))) > 0


def test_busca_de_produtos_para_adicionar_ao_pedido(client, ctx):
    """A busca do modal de pedido (GET /produtos/?busca=) deve achar o produto
    para o operador conseguir adicioná-lo — se isto falha, não dá pra montar pedido."""
    estab, admin, prod = ctx["estab"], ctx["admin"], ctx["prod"]
    headers = _headers(estab.id, admin.id)

    r = client.get("/api/produtos/?busca=Sanit", headers=headers)
    assert r.status_code == 200, r.get_data(as_text=True)
    produtos = r.get_json().get("produtos", [])
    nomes = [p["nome"] for p in produtos]
    assert prod.nome in nomes, f"busca não retornou o produto: {nomes}"
