"""CRM comercial: leads, funil, follow-up, consentimento (LGPD), campanhas, comissão e chamados.

Cada regra é provada pela API com os papéis reais: admin, vendedor (só a própria carteira) e caixa.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import (Caixa, CategoriaProduto, Cliente, CrmCampanhaEnvio, CrmComissaoFechamento, CrmConsentimento,
                        CrmOportunidade, Estabelecimento, Funcionario, PedidoVenda, Produto, ProdutoLote, Venda, db)
from app.utils.timezone import hoje_local, local_date_to_utc_naive


def _funcionario(session, estab, nome, role, cpf):
    f = Funcionario(estabelecimento_id=estab.id, nome=nome, cpf=cpf, username=f"{role}_{cpf}", role=role, ativo=True,
                    data_nascimento=date(1990, 1, 1), celular="11999990000", email=f"{cpf}@t.test", cargo=role,
                    data_admissao=date(2024, 1, 1), salario_base=Decimal("2000"))
    f.set_password("x")
    session.add(f)
    session.flush()
    return f


def _cliente(session, estab, nome, cpf, vendedor=None, **extra):
    c = Cliente(estabelecimento_id=estab.id, nome=nome, cpf=cpf, celular=extra.pop("celular", "11988887777"),
                cep="01000000", logradouro="Rua A", numero="1", bairro="Centro", cidade=extra.pop("cidade", "São Paulo"),
                estado="SP", vendedor_id=vendedor.id if vendedor else None, limite_credito=Decimal("10000"), **extra)
    session.add(c)
    session.flush()
    return c


def _headers(f):
    token = create_access_token(identity=str(f.id), additional_claims={"estabelecimento_id": f.estabelecimento_id,
                                                                       "role": f.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    vend_a = _funcionario(session, estab, "Ana Vendas", "vendedor", "10000000001")
    vend_b = _funcionario(session, estab, "Bruno Vendas", "vendedor", "10000000002")
    caixa = _funcionario(session, estab, "Carla Caixa", "caixa", "10000000003")
    cli_a = _cliente(session, estab, "Mercado da Ana", "20000000001", vend_a, email="a@cli.test")
    cli_b = _cliente(session, estab, "Mercado do Bruno", "20000000002", vend_b)
    livre = _cliente(session, estab, "Padaria Sem Vendedor", "20000000003")
    session.commit()
    return dict(estab=estab, admin=admin, vend_a=vend_a, vend_b=vend_b, caixa=caixa, cli_a=cli_a, cli_b=cli_b,
                livre=livre, h_admin=_headers(admin), h_a=_headers(vend_a), h_b=_headers(vend_b), h_caixa=_headers(caixa))


def _ok(resposta, status=(200, 201)):
    assert resposta.status_code in ((status,) if isinstance(status, int) else status), resposta.get_json()
    return resposta.get_json()["data"]


# ───────────────────────── leads ─────────────────────────

def test_lead_do_vendedor_e_dele_e_os_outros_nao_veem(client, ctx):
    lead = _ok(client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "Atacarejo Sol", "telefone": "11911112222"}))
    assert lead["responsavel_id"] == ctx["vend_a"].id and lead["status"] == "novo"

    assert client.patch(f"/api/crm/leads/{lead['id']}", headers=ctx["h_b"], json={"status": "contatado"}).status_code == 404
    assert _ok(client.get("/api/crm/leads", headers=ctx["h_b"])) == []
    assert [l["id"] for l in _ok(client.get("/api/crm/leads", headers=ctx["h_admin"]))] == [lead["id"]]
    # Vendedor não atribui lead a outro; gestor pode.
    assert client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "X", "telefone": "1",
                                                                  "responsavel_id": ctx["vend_b"].id}).status_code == 403
    atribuido = _ok(client.post("/api/crm/leads", headers=ctx["h_admin"],
                                json={"nome": "Y", "email": "y@y.test", "responsavel_id": ctx["vend_b"].id}))
    assert atribuido["responsavel_id"] == ctx["vend_b"].id


def test_lead_exige_contato_e_nao_duplica_documento(client, ctx):
    assert client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "Sem contato"}).status_code == 400
    _ok(client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "A", "telefone": "1", "documento": "11.222.333/0001-81"}))
    repetido = client.post("/api/crm/leads", headers=ctx["h_b"], json={"nome": "B", "telefone": "2", "documento": "11222333000181"})
    assert repetido.status_code == 409
    ja_cliente = client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "C", "telefone": "3", "documento": "20000000001"})
    assert ja_cliente.status_code == 409 and "cliente" in ja_cliente.get_json()["error"]


def test_descarte_exige_motivo_e_caixa_nao_acessa_funil(client, ctx):
    lead = _ok(client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "Z", "telefone": "1"}))
    assert client.patch(f"/api/crm/leads/{lead['id']}", headers=ctx["h_a"], json={"status": "descartado"}).status_code == 400
    ok = _ok(client.patch(f"/api/crm/leads/{lead['id']}", headers=ctx["h_a"],
                          json={"status": "descartado", "motivo_descarte": "Fora da área de entrega"}))
    assert ok["status"] == "descartado"
    assert client.get("/api/crm/leads", headers=ctx["h_caixa"]).status_code == 403
    assert client.get("/api/crm/funil", headers=ctx["h_caixa"]).status_code == 403


def test_conversao_leva_oportunidade_atividade_e_consentimento_para_o_cliente(client, session, ctx):
    lead = _ok(client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "Padaria Nova", "telefone": "11955554444"}))
    op = _ok(client.post("/api/crm/oportunidades", headers=ctx["h_a"],
                         json={"titulo": "Mix de padaria", "lead_id": lead["id"], "valor_estimado": 3000}))
    _ok(client.post("/api/crm/atividades", headers=ctx["h_a"], json={"lead_id": lead["id"], "assunto": "Visitar", "tipo": "visita"}))
    _ok(client.post("/api/crm/consentimentos", headers=ctx["h_a"], json={
        "lead_id": lead["id"], "canal": "whatsapp", "concedido": True, "origem": "formulario", "evidencia": "Form site 09/10"}))

    # Vendedor não converte num cliente da carteira de outro.
    assert client.post(f"/api/crm/leads/{lead['id']}/converter", headers=ctx["h_a"],
                       json={"cliente_id": ctx["cli_b"].id}).status_code == 403
    convertido = _ok(client.post(f"/api/crm/leads/{lead['id']}/converter", headers=ctx["h_a"],
                                 json={"cliente_id": ctx["livre"].id}))
    assert convertido["lead"]["status"] == "convertido"
    session.expire_all()
    assert session.get(Cliente, ctx["livre"].id).vendedor_id == ctx["vend_a"].id  # entra na carteira de quem trouxe
    assert session.get(CrmOportunidade, op["id"]).cliente_id == ctx["livre"].id
    consent = _ok(client.get(f"/api/crm/clientes/{ctx['livre'].id}/consentimentos", headers=ctx["h_a"]))
    assert consent["vigente"][0]["canal"] == "whatsapp" and consent["vigente"][0]["concedido"] is True
    assert consent["historico"][0]["origem"] == "conversao_lead"
    assert client.patch(f"/api/crm/leads/{lead['id']}", headers=ctx["h_a"], json={"nome": "x"}).status_code == 409


# ───────────────────────── oportunidades e funil ─────────────────────────

def test_funil_ponderado_e_escopo_da_carteira(client, ctx):
    assert client.post("/api/crm/oportunidades", headers=ctx["h_a"],
                       json={"titulo": "Fora", "cliente_id": ctx["cli_b"].id}).status_code == 403
    _ok(client.post("/api/crm/oportunidades", headers=ctx["h_a"],
                    json={"titulo": "Bebidas", "cliente_id": ctx["cli_a"].id, "valor_estimado": 1000, "etapa": "proposta"}))
    _ok(client.post("/api/crm/oportunidades", headers=ctx["h_a"],
                    json={"titulo": "Limpeza", "cliente_id": ctx["cli_a"].id, "valor_estimado": 400, "probabilidade": 90,
                          "etapa": "negociacao"}))
    _ok(client.post("/api/crm/oportunidades", headers=ctx["h_b"],
                    json={"titulo": "Do Bruno", "cliente_id": ctx["cli_b"].id, "valor_estimado": 10000}))

    meu = _ok(client.get("/api/crm/funil", headers=ctx["h_a"]))["pipeline"]
    assert meu["valor_total"] == 1400 and meu["valor_ponderado"] == 860  # 1000×50% + 400×90%
    loja = _ok(client.get("/api/crm/funil", headers=ctx["h_admin"]))["pipeline"]
    assert loja["valor_total"] == 11400 and loja["quantidade"] == 3


def test_ganho_liga_pedido_do_cliente_e_perda_exige_motivo(client, session, ctx):
    op = _ok(client.post("/api/crm/oportunidades", headers=ctx["h_a"],
                         json={"titulo": "Contrato", "cliente_id": ctx["cli_a"].id, "valor_estimado": 500}))
    pedido_outro = PedidoVenda(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cli_b"].id, vendedor_id=ctx["vend_b"].id,
                               codigo="PV-X", status="pendente", subtotal=900, total=900)
    pedido = PedidoVenda(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cli_a"].id, vendedor_id=ctx["vend_a"].id,
                         codigo="PV-A", status="faturado", subtotal=720, total=720)
    session.add_all([pedido_outro, pedido])
    session.commit()
    url = f"/api/crm/oportunidades/{op['id']}"
    assert client.patch(url, headers=ctx["h_a"], json={"etapa": "ganha", "pedido_venda_id": pedido_outro.id}).status_code == 400
    ganha = _ok(client.patch(url, headers=ctx["h_a"], json={"etapa": "ganha", "pedido_venda_id": pedido.id}))
    assert ganha["valor_ganho"] == 720 and ganha["probabilidade"] == 100 and ganha["fechada_em"]
    # Encerrada: vendedor não reabre; gestor reabre.
    assert client.patch(url, headers=ctx["h_a"], json={"etapa": "proposta"}).status_code == 403
    _ok(client.patch(url, headers=ctx["h_admin"], json={"etapa": "proposta"}))
    assert client.patch(url, headers=ctx["h_a"], json={"etapa": "perdida"}).status_code == 400
    perdida = _ok(client.patch(url, headers=ctx["h_a"], json={"etapa": "perdida", "motivo_perda": "Preço", "concorrente": "Atacadão"}))
    assert perdida["valor_ganho"] is None and perdida["pedido_venda_id"] is None
    periodo = _ok(client.get("/api/crm/funil", headers=ctx["h_a"]))["periodo"]
    assert periodo["perdidas"] == 1 and periodo["motivos_perda"][0]["motivo"] == "Preço"


def test_oportunidade_de_lead_nao_e_ganha_antes_da_conversao(client, ctx):
    lead = _ok(client.post("/api/crm/leads", headers=ctx["h_a"], json={"nome": "L", "telefone": "1"}))
    op = _ok(client.post("/api/crm/oportunidades", headers=ctx["h_a"], json={"titulo": "T", "lead_id": lead["id"]}))
    assert client.patch(f"/api/crm/oportunidades/{op['id']}", headers=ctx["h_a"], json={"etapa": "ganha"}).status_code == 400


# ───────────────────────── atividades ─────────────────────────

def test_follow_up_atrasado_hoje_e_proxima_atividade(client, ctx):
    ontem = (hoje_local() - timedelta(days=1)).isoformat()
    atrasada = _ok(client.post("/api/crm/atividades", headers=ctx["h_a"], json={
        "cliente_id": ctx["cli_a"].id, "tipo": "ligacao", "assunto": "Cobrar retorno", "vencimento": ontem}))
    assert atrasada["atrasada"] is True
    _ok(client.post("/api/crm/atividades", headers=ctx["h_a"], json={
        "cliente_id": ctx["cli_a"].id, "assunto": "Visita hoje", "vencimento": hoje_local().isoformat()}))
    resumo = client.get("/api/crm/atividades?situacao=abertas", headers=ctx["h_a"]).get_json()["resumo"]
    assert resumo == {"abertas": 2, "atrasadas": 1, "hoje": 1}

    assert client.post(f"/api/crm/atividades/{atrasada['id']}/concluir", headers=ctx["h_b"],
                       json={"resultado": "x"}).status_code == 404
    feito = _ok(client.post(f"/api/crm/atividades/{atrasada['id']}/concluir", headers=ctx["h_a"], json={
        "resultado": "Pediu proposta", "proxima": {"tipo": "email", "assunto": "Enviar proposta",
                                                   "vencimento": (hoje_local() + timedelta(days=2)).isoformat()}}))
    assert feito["atividade"]["concluida_em"] and feito["proxima"]["cliente_id"] == ctx["cli_a"].id
    assert client.post(f"/api/crm/atividades/{atrasada['id']}/concluir", headers=ctx["h_a"],
                       json={"resultado": "de novo"}).status_code == 409
    assert client.post("/api/crm/atividades", headers=ctx["h_a"], json={"assunto": "sem vínculo"}).status_code == 400


# ───────────────────────── consentimento e campanhas ─────────────────────────

def _consentir(client, headers, cliente, concedido=True, canal="whatsapp"):
    return client.post("/api/crm/consentimentos", headers=headers, json={
        "cliente_id": cliente.id, "canal": canal, "concedido": concedido, "origem": "formulario", "evidencia": "ficha"})


def test_consentimento_e_historico_e_vale_o_ultimo(client, ctx):
    sem_evidencia = client.post("/api/crm/consentimentos", headers=ctx["h_caixa"], json={
        "cliente_id": ctx["cli_a"].id, "canal": "whatsapp", "concedido": True, "origem": "verbal"})
    assert sem_evidencia.status_code == 400
    _ok(_consentir(client, ctx["h_caixa"], ctx["cli_a"]))
    _ok(_consentir(client, ctx["h_caixa"], ctx["cli_a"], concedido=False))
    estado = _ok(client.get(f"/api/crm/clientes/{ctx['cli_a'].id}/consentimentos", headers=ctx["h_admin"]))
    assert estado["vigente"] == [{"canal": "whatsapp", "finalidade": "marketing", "concedido": False,
                                  "desde": estado["vigente"][0]["desde"]}]
    assert len(estado["historico"]) == 2
    # Vendedor só registra para a própria carteira.
    assert _consentir(client, ctx["h_a"], ctx["cli_b"]).status_code == 403


def test_campanha_so_alcanca_quem_consentiu_e_respeita_revogacao(client, session, ctx):
    _ok(_consentir(client, ctx["h_admin"], ctx["cli_a"]))
    _ok(_consentir(client, ctx["h_admin"], ctx["cli_b"]))
    sem_celular = _cliente(session, ctx["estab"], "Sem Celular", "20000000009", celular="123")
    session.commit()
    _ok(_consentir(client, ctx["h_admin"], sem_celular))

    assert client.post("/api/crm/campanhas", headers=ctx["h_a"], json={"nome": "x", "mensagem": "y"}).status_code == 403
    previa = _ok(client.post("/api/crm/campanhas/previa", headers=ctx["h_admin"], json={"canal": "whatsapp", "filtros": {}}))
    assert previa["publico_filtrado"] == 4 and previa["aptos"] == 2 and previa["sem_destino"] == 1
    assert previa["sem_consentimento"] == 1

    campanha = _ok(client.post("/api/crm/campanhas", headers=ctx["h_admin"], json={
        "nome": "Volta às compras", "canal": "whatsapp", "mensagem": "Olá {nome}, temos oferta!", "janela_conversao_dias": 7}))
    iniciada = _ok(client.post(f"/api/crm/campanhas/{campanha['id']}/iniciar", headers=ctx["h_admin"], json={}))
    assert iniciada["publico"] == 2 and iniciada["status"] == "ativa"
    assert client.patch(f"/api/crm/campanhas/{campanha['id']}", headers=ctx["h_admin"], json={"nome": "z"}).status_code == 409

    detalhe = _ok(client.get(f"/api/crm/campanhas/{campanha['id']}", headers=ctx["h_admin"]))
    envio_a = next(e for e in detalhe["envios"] if e["cliente_id"] == ctx["cli_a"].id)
    envio_b = next(e for e in detalhe["envios"] if e["cliente_id"] == ctx["cli_b"].id)
    assert envio_a["link"].startswith("https://wa.me/5511988887777?text=Ol%C3%A1%20Mercado")

    # Cliente B revoga depois de o público congelar: o envio é bloqueado e fica registrado.
    _ok(_consentir(client, ctx["h_admin"], ctx["cli_b"], concedido=False))
    bloqueado = client.post(f"/api/crm/campanhas/{campanha['id']}/envios/{envio_b['id']}", headers=ctx["h_admin"],
                            json={"status": "enviado"})
    assert bloqueado.status_code == 409
    session.expire_all()
    assert session.get(CrmCampanhaEnvio, envio_b["id"]).status == "falhou"

    _ok(client.post(f"/api/crm/campanhas/{campanha['id']}/envios/{envio_a['id']}", headers=ctx["h_admin"],
                    json={"status": "enviado"}))
    # Venda antes do envio não conta; depois do envio, dentro da janela, conta.
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    session.add_all([
        Venda(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cli_a"].id, funcionario_id=ctx["admin"].id,
              codigo="ANTES", subtotal=99, total=99, status="finalizada", data_venda=agora - timedelta(days=1)),
        Venda(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cli_a"].id, funcionario_id=ctx["admin"].id,
              codigo="DEPOIS", subtotal=250, total=250, status="finalizada", data_venda=agora + timedelta(minutes=5)),
    ])
    session.commit()
    resultado = _ok(client.get(f"/api/crm/campanhas/{campanha['id']}", headers=ctx["h_admin"]))["resultado"]
    assert resultado["enviados"] == 1 and resultado["convertidos"] == 1 and resultado["receita_atribuida"] == 250

    _ok(client.post(f"/api/crm/campanhas/{campanha['id']}/envios/{envio_a['id']}", headers=ctx["h_admin"],
                    json={"status": "descadastrado"}))
    estado = _ok(client.get(f"/api/crm/clientes/{ctx['cli_a'].id}/consentimentos", headers=ctx["h_admin"]))
    assert estado["vigente"][0]["concedido"] is False and estado["historico"][0]["origem"] == "campanha"


def test_filtro_de_campanha_por_inatividade_e_inadimplencia(client, session, ctx):
    from app.models import ContaReceber
    for c in (ctx["cli_a"], ctx["cli_b"], ctx["livre"]):
        _ok(_consentir(client, ctx["h_admin"], c))
    session.get(Cliente, ctx["cli_a"].id).ultima_compra = datetime.utcnow() - timedelta(days=90)
    session.get(Cliente, ctx["cli_b"].id).ultima_compra = datetime.utcnow() - timedelta(days=2)
    session.add(ContaReceber(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["livre"].id, numero_documento="T1",
                             valor_original=50, valor_atual=50, data_emissao=hoje_local() - timedelta(days=40),
                             data_vencimento=hoje_local() - timedelta(days=10), status="aberto"))
    session.commit()
    previa = _ok(client.post("/api/crm/campanhas/previa", headers=ctx["h_admin"], json={
        "canal": "whatsapp", "filtros": {"sem_compra_dias": 30, "excluir_inadimplentes": True}}))
    assert [a["cliente_id"] for a in previa["amostra"]] == [ctx["cli_a"].id]
    assert client.post("/api/crm/campanhas/previa", headers=ctx["h_admin"],
                       json={"filtros": {"hackear": 1}}).status_code == 400


# ───────────────────────── comissão ─────────────────────────

def _venda(session, ctx, codigo, total, quando, funcionario=None, status="finalizada", cancelada_em=None):
    v = Venda(estabelecimento_id=ctx["estab"].id, cliente_id=ctx["cli_a"].id,
              funcionario_id=(funcionario or ctx["vend_a"]).id, codigo=codigo, subtotal=total, total=total,
              status=status, data_venda=quando, data_cancelamento=cancelada_em)
    session.add(v)
    session.flush()
    return v


def test_comissao_por_fato_no_mes_e_competencia_fechada_imutavel(client, session, ctx):
    hoje = hoje_local()
    inicio_mes = hoje.replace(day=1)
    mes_passado = (inicio_mes - timedelta(days=1)).replace(day=10)
    competencia_passada = mes_passado.strftime("%Y-%m")
    quando = local_date_to_utc_naive(mes_passado) + timedelta(hours=15)
    _venda(session, ctx, "V1", 1000, quando)
    v2 = _venda(session, ctx, "V2", 500, quando)
    _venda(session, ctx, "BALCAO-CAIXA", 300, quando, funcionario=ctx["caixa"])
    session.commit()

    sem_regra = _ok(client.get(f"/api/crm/comissoes/extrato?competencia={competencia_passada}", headers=ctx["h_a"]))
    assert sem_regra["valor_comissao"] == 0 and sem_regra["aviso"]
    assert client.put("/api/crm/comissoes/regras", headers=ctx["h_a"], json={"percentual": 5}).status_code == 403
    _ok(client.put("/api/crm/comissoes/regras", headers=ctx["h_admin"], json={"percentual": 5}))  # padrão de vendedores

    extrato = _ok(client.get(f"/api/crm/comissoes/extrato?competencia={competencia_passada}", headers=ctx["h_a"]))
    assert extrato["base_liquida"] == 1500 and extrato["valor_comissao"] == 75 and extrato["origem_percentual"] == "padrao"
    caixa = _ok(client.get(f"/api/crm/comissoes/extrato?competencia={competencia_passada}&vendedor_id={ctx['caixa'].id}",
                           headers=ctx["h_admin"]))
    assert caixa["percentual"] is None  # regra padrão vale só para vendedores
    assert client.get(f"/api/crm/comissoes/extrato?competencia={competencia_passada}&vendedor_id={ctx['vend_b'].id}",
                      headers=ctx["h_a"]).status_code == 403

    _ok(client.post("/api/crm/comissoes/fechar", headers=ctx["h_admin"],
                    json={"vendedor_id": ctx["vend_a"].id, "competencia": competencia_passada}), 201)
    assert client.post("/api/crm/comissoes/fechar", headers=ctx["h_admin"],
                       json={"vendedor_id": ctx["vend_a"].id, "competencia": competencia_passada}).status_code == 409
    assert client.post("/api/crm/comissoes/fechar", headers=ctx["h_admin"],
                       json={"vendedor_id": ctx["vend_a"].id, "competencia": hoje.strftime("%Y-%m")}).status_code == 400

    # Cancelar hoje uma venda do mês passado desconta neste mês; o mês fechado não muda.
    v2 = session.get(Venda, v2.id)
    v2.status, v2.data_cancelamento = "cancelada", datetime.now(timezone.utc).replace(tzinfo=None)
    session.commit()
    fechado = _ok(client.get(f"/api/crm/comissoes/extrato?competencia={competencia_passada}", headers=ctx["h_a"]))
    assert fechado["fechada"] is True and fechado["valor_comissao"] == 75
    atual = _ok(client.get(f"/api/crm/comissoes/extrato?competencia={hoje.strftime('%Y-%m')}", headers=ctx["h_a"]))
    assert atual["base_cancelamentos"] == -500 and atual["valor_comissao"] == -25
    assert CrmComissaoFechamento.query.count() == 1


def test_comissao_da_expedicao_e_do_vendedor_do_pedido(client, session, ctx):
    cat = CategoriaProduto(estabelecimento_id=ctx["estab"].id, nome="Geral")
    session.add(cat)
    session.flush()
    prod = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=cat.id, nome="Óleo", preco_custo=Decimal("5"),
                   preco_venda=Decimal("10"), quantidade=Decimal("50"))
    session.add(prod)
    session.flush()
    session.add_all([ProdutoLote(estabelecimento_id=ctx["estab"].id, produto_id=prod.id, numero_lote="L1", quantidade=50,
                                 quantidade_inicial=50, data_entrada=hoje_local(),
                                 data_validade=hoje_local() + timedelta(days=200), preco_custo_unitario=5, ativo=True),
                     Caixa(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id, numero_caixa="C1",
                           saldo_inicial=0, saldo_atual=0, status="aberto")])
    session.commit()
    pedido = client.post("/api/sfa/sync-pedidos", headers=ctx["h_a"], json={"pedidos": [{
        "cliente_id": ctx["cli_a"].id, "subtotal": 200, "total": 200, "desconto": 0, "condicao_pagamento": "30 Dias",
        "itens": [{"produto_id": prod.id, "quantidade": 20, "preco_unitario": 10, "total_item": 200}]}]})
    assert pedido.status_code == 200, pedido.get_json()
    pid = PedidoVenda.query.order_by(PedidoVenda.id.desc()).first().id
    assert client.post(f"/api/sfa/pedidos/{pid}/aprovar", headers=ctx["h_admin"], json={}).status_code == 200
    _ok(client.put("/api/crm/comissoes/regras", headers=ctx["h_admin"], json={"percentual": 3, "vendedor_id": ctx["vend_a"].id}))
    _ok(client.put("/api/crm/comissoes/regras", headers=ctx["h_admin"], json={"percentual": 3, "vendedor_id": ctx["admin"].id}))
    # Quem aprovou e faturou foi o admin; a comissão é de quem tirou o pedido.
    extrato = _ok(client.get("/api/crm/comissoes/extrato", headers=ctx["h_a"]))
    assert extrato["base_vendas"] == 200 and extrato["valor_comissao"] == 6
    do_admin = _ok(client.get(f"/api/crm/comissoes/extrato?vendedor_id={ctx['admin'].id}", headers=ctx["h_admin"]))
    assert do_admin["base_vendas"] == 0
    resumo = _ok(client.get("/api/crm/comissoes/resumo", headers=ctx["h_admin"]))
    assert {l["vendedor_id"]: l["valor_comissao"] for l in resumo}[ctx["vend_a"].id] == 6


# ───────────────────────── chamados ─────────────────────────

def test_chamado_sla_transicoes_e_carteira(client, ctx):
    assert client.post("/api/crm/chamados", headers=ctx["h_a"],
                       json={"cliente_id": ctx["cli_b"].id, "assunto": "x"}).status_code == 403
    chamado = _ok(client.post("/api/crm/chamados", headers=ctx["h_a"], json={
        "cliente_id": ctx["cli_a"].id, "tipo": "avaria", "prioridade": "alta", "assunto": "Caixa amassada"}))
    assert chamado["numero"].startswith("CH-") and chamado["status"] == "aberto"
    criado = datetime.fromisoformat(chamado["created_at"])
    assert datetime.fromisoformat(chamado["sla_vencimento"]) - criado == timedelta(hours=24)

    balcao = _ok(client.post("/api/crm/chamados", headers=ctx["h_caixa"], json={
        "cliente_id": ctx["cli_b"].id, "assunto": "Dúvida", "tipo": "duvida", "prioridade": "baixa"}))
    assert [c["id"] for c in _ok(client.get("/api/crm/chamados", headers=ctx["h_a"]))] == [chamado["id"]]
    assert {c["id"] for c in _ok(client.get("/api/crm/chamados", headers=ctx["h_admin"]))} == {chamado["id"], balcao["id"]}
    assert client.patch(f"/api/crm/chamados/{balcao['id']}", headers=ctx["h_a"], json={"status": "em_atendimento"}).status_code == 404

    url = f"/api/crm/chamados/{chamado['id']}"
    assert client.patch(url, headers=ctx["h_a"], json={"status": "fechado"}).status_code == 409
    assert client.patch(url, headers=ctx["h_a"], json={"status": "resolvido"}).status_code == 400
    _ok(client.post("/api/crm/atividades", headers=ctx["h_a"], json={"chamado_id": chamado["id"], "assunto": "Liguei"}))
    resolvido = _ok(client.patch(url, headers=ctx["h_a"], json={"status": "resolvido", "resolucao": "Trocado na próxima entrega"}))
    assert resolvido["primeira_resposta_em"] and resolvido["resolvido_em"] and resolvido["sla_estourado"] is False
    _ok(client.patch(url, headers=ctx["h_a"], json={"status": "fechado"}))
    assert client.patch(url, headers=ctx["h_a"], json={"status": "em_atendimento"}).status_code == 409
    painel = _ok(client.get("/api/crm/chamados/painel", headers=ctx["h_admin"]))
    assert painel["resolvidos_periodo"] == 1 and painel["sla_cumprido_percentual"] == 100.0 and painel["abertos"] == 1


# ───────────────────────── isolamento entre lojas ─────────────────────────

def test_outra_loja_nao_ve_nem_altera_o_crm(client, session, ctx):
    lead = _ok(client.post("/api/crm/leads", headers=ctx["h_admin"], json={"nome": "Segredo", "telefone": "1"}))
    outra = Estabelecimento(nome_fantasia="Outra", razao_social="Outra LTDA", cnpj="99888777000166", email="o@o.test",
                            telefone="1", data_abertura=date(2024, 1, 1), cep="1", logradouro="r", numero="1",
                            bairro="b", cidade="c", estado="SP")
    session.add(outra)
    session.flush()
    admin_outra = _funcionario(session, outra, "Admin Outra", "admin", "30000000001")
    session.commit()
    h = _headers(admin_outra)
    assert _ok(client.get("/api/crm/leads", headers=h)) == []
    assert client.patch(f"/api/crm/leads/{lead['id']}", headers=h, json={"nome": "roubado"}).status_code == 404
    assert client.get(f"/api/crm/clientes/{ctx['cli_a'].id}/resumo", headers=h).status_code == 404
    assert client.post("/api/crm/chamados", headers=h, json={"cliente_id": ctx["cli_a"].id, "assunto": "x"}).status_code == 404
