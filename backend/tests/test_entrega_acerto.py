"""Aceites de logística e recebimento: API real, banco isolado, nenhuma cobrança."""
from decimal import Decimal
from datetime import datetime, timedelta
import pytest
from app.models import (Entrega, EntregaItem, Motorista, RastreamentoEntrega, Estabelecimento, Veiculo,
                        Pagamento, Caixa, MovimentacaoCaixa, Funcionario)
from test_erp_integridade_canais import ctx, _entrega, _get


@pytest.fixture
def entrega(client, session, ctx):
    response = _entrega(client, ctx, [{"forma_pagamento": "entrega", "valor": 50}])
    assert response.status_code == 201, response.get_json()
    motorista = Motorista(estabelecimento_id=ctx["estab"].id, nome="Motorista",
                          cpf="52998224725", cnh="12345", telefone="11999999999",
                          celular="11999999999", ativo=True)
    session.add(motorista)
    session.commit()
    return response.get_json()["entrega_id"], motorista.id


def _status(client, ctx, entrega_id, status, **extra):
    return client.put(f"/api/delivery/entregas/{entrega_id}/status", headers=ctx["headers"],
                      json={"status": status, **extra})


def _acerto(client, ctx, entrega_id, pagamentos=None, chave="acerto-teste-0001"):
    return client.post(f"/api/delivery/entregas/{entrega_id}/receber", headers=ctx["headers"],
                       json={"chave_operacao": chave, "pagamentos": pagamentos or [
                           {"forma_pagamento": "dinheiro", "valor": "50.00"}]})


@pytest.mark.parametrize("status", ["inventado", "", None, 123, "entregue"])
def test_status_invalido_ou_pulo_de_etapa_nao_grava(client, session, ctx, entrega, status):
    eid, _ = entrega
    response = _status(client, ctx, eid, status)
    assert response.status_code in (400, 409)
    assert _get(session, Entrega, eid).status == "em_preparo"
    assert session.query(RastreamentoEntrega).filter_by(entrega_id=eid).count() == 1


def test_confirmacao_idempotente_atualiza_itens_uma_vez(client, session, ctx, entrega):
    eid, mid = entrega
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 200
    saida = _get(session, Entrega, eid).data_saida
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 200
    assert _get(session, Entrega, eid).data_saida == saida
    assert _status(client, ctx, eid, "entregue").status_code == 200
    confirmado = _get(session, Entrega, eid).data_entrega
    payload = _get(session, Entrega, eid).to_dict()
    assert datetime.fromisoformat(payload["data_saida"]).tzinfo is not None
    assert datetime.fromisoformat(payload["data_entrega"]).tzinfo is not None
    assert _status(client, ctx, eid, "entregue").status_code == 200
    assert _get(session, Entrega, eid).data_entrega == confirmado
    assert _get(session, Motorista, mid).total_entregas == 1
    item = session.query(EntregaItem).filter_by(entrega_id=eid).one()
    assert item.quantidade_entregue == item.quantidade
    assert item.status == "entregue"
    assert session.query(RastreamentoEntrega).filter_by(entrega_id=eid).count() == 3
    assert _get(session, Entrega, eid).pagamento_status == "pendente"
    assert session.query(Pagamento).one().status == "pendente"


def test_entrega_encerrada_nao_reabre(client, session, ctx, entrega):
    eid, mid = entrega
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 200
    assert _status(client, ctx, eid, "entregue").status_code == 200
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 409


def test_despacho_exige_motorista_ativo(client, session, ctx, entrega):
    eid, mid = entrega
    assert _status(client, ctx, eid, "em_rota").status_code == 400
    _get(session, Motorista, mid).ativo = False
    session.commit()
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 400


def test_cancelamento_logistico_exige_motivo_e_nao_estorna_venda(client, session, ctx, entrega):
    eid, _ = entrega
    assert _status(client, ctx, eid, "cancelada").status_code == 400
    assert _status(client, ctx, eid, "cancelada", observacao="Endereço incorreto").status_code == 200
    registro = _get(session, Entrega, eid)
    assert registro.data_cancelamento and registro.motivo_cancelamento == "Endereço incorreto"
    assert registro.venda.status == "finalizada"
    assert _acerto(client, ctx, eid).status_code == 409


def test_acerto_dinheiro_com_troco_uma_vez(client, session, ctx, entrega):
    eid, _ = entrega
    pagamentos = [{"forma_pagamento": "dinheiro", "valor": "60.00"}]
    response = _acerto(client, ctx, eid, pagamentos)
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["entrega"]["valor_a_receber"] == 0
    assert _acerto(client, ctx, eid, pagamentos).status_code == 200
    assert _get(session, Caixa, ctx["caixa"].id).saldo_atual == Decimal("50")
    venda = _get(session, Entrega, eid).venda
    assert venda.valor_recebido == Decimal("60") and venda.troco == Decimal("10")
    assert venda.status == "finalizada"
    assert session.query(Pagamento).count() == 1
    assert session.query(Pagamento).one().forma_pagamento == "dinheiro"
    assert session.query(MovimentacaoCaixa).filter_by(venda_id=venda.id, tipo="venda").count() == 1
    assert _acerto(client, ctx, eid, pagamentos, chave="outra-operacao-0002").status_code == 409
    assert _acerto(client, ctx, eid).status_code == 409


def test_acerto_misto_fecha_saldo_sem_movimentar_estoque(client, session, ctx, entrega):
    eid, _ = entrega
    assert _acerto(client, ctx, eid, [{"forma_pagamento": "dinheiro", "valor": "20"},
                                   {"forma_pagamento": "pix", "valor": "30"}]).status_code == 200
    assert _get(session, Caixa, ctx["caixa"].id).saldo_atual == Decimal("20")
    assert session.query(Pagamento).count() == 2
    assert _get(session, type(ctx["prod"]), ctx["prod"].id).quantidade == Decimal("5")


@pytest.mark.parametrize("valor", ["NaN", "Infinity", "-1", "0", "49.99", "50.001"])
def test_acerto_invalido_preserva_pagamento_e_caixa(client, session, ctx, entrega, valor):
    eid, _ = entrega
    assert _acerto(client, ctx, eid, [{"forma_pagamento": "dinheiro", "valor": valor}]).status_code == 400
    assert _get(session, Entrega, eid).pagamento_status == "pendente"
    assert session.query(Pagamento).one().forma_pagamento == "entrega"
    assert _get(session, Caixa, ctx["caixa"].id).saldo_atual == 0


def test_acerto_sem_caixa_recusa_dinheiro_mas_aceita_pix(client, session, ctx, entrega):
    eid, _ = entrega
    _get(session, Caixa, ctx["caixa"].id).status = "fechado"
    session.commit()
    assert _acerto(client, ctx, eid).status_code == 403
    assert _acerto(client, ctx, eid, [{"forma_pagamento": "pix", "valor": 50}]).status_code == 200
    assert session.query(MovimentacaoCaixa).count() == 0


def test_acerto_nao_aceita_troco_em_pix_ou_fiado(client, session, ctx, entrega):
    eid, _ = entrega
    for forma, valor in [("pix", 60), ("fiado", 50)]:
        assert _acerto(client, ctx, eid, [{"forma_pagamento": forma, "valor": valor}]).status_code == 400


def test_venda_cancelada_nao_recebe(client, session, ctx, entrega):
    eid, _ = entrega
    registro = _get(session, Entrega, eid)
    registro.venda.status = "cancelada"
    session.commit()
    assert _acerto(client, ctx, eid).status_code == 409
    assert _status(client, ctx, eid, "em_rota", motorista_id=entrega[1]).status_code == 409


def test_vendedor_nao_pode_registrar_recebimento(client, session, ctx, entrega):
    eid, _ = entrega
    _get(session, Funcionario, ctx["admin"].id).role = "vendedor"
    session.commit()
    assert _acerto(client, ctx, eid).status_code == 403


def test_entregador_so_atualiza_propria_entrega(client, session, ctx, entrega):
    eid, mid = entrega
    usuario = _get(session, Funcionario, ctx["admin"].id)
    usuario.role = "entregador"
    session.commit()
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 403
    usuario.cpf = "529.982.247-25"
    session.commit()
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 200
    assert _acerto(client, ctx, eid).status_code == 403


def test_loja_incorreta_nao_encontra_entrega(client, session, ctx, entrega):
    eid, _ = entrega
    registro = _get(session, Entrega, eid)
    outra = Estabelecimento(nome_fantasia="Outra loja", razao_social="Outra LTDA", cnpj="11222333000181",
        email="outra@example.test", telefone="11999999999", cep="01000000", logradouro="Rua B",
        numero="2", bairro="Centro", cidade="São Paulo", estado="SP")
    session.add(outra)
    session.flush()
    registro.estabelecimento_id = outra.id
    session.commit()
    assert _acerto(client, ctx, eid).status_code == 404
    assert _status(client, ctx, eid, "em_rota", motorista_id=entrega[1]).status_code == 404


def test_caixa_reconhece_acerto_na_data_do_recebimento(client, session, ctx, entrega):
    eid, _ = entrega
    ontem = datetime.utcnow() - timedelta(days=1)
    registro = _get(session, Entrega, eid)
    registro.venda.data_venda = ontem
    session.query(Pagamento).one().data_pagamento = ontem
    session.commit()
    assert _acerto(client, ctx, eid, [{"forma_pagamento": "dinheiro", "valor": "60"}]).status_code == 200
    def resumo(dia):
        d = dia.date().isoformat()
        response = client.get(f"/api/despesas/resumo-financeiro/?data_inicio={d}&data_fim={d}", headers=ctx["headers"])
        assert response.status_code == 200, response.get_json()
        return response.get_json()
    assert resumo(datetime.utcnow())["fluxo_caixa_real"]["entradas"] == pytest.approx(50)
    assert resumo(ontem)["fluxo_caixa_real"]["entradas"] == pytest.approx(0)


def test_identidade_motorista_usa_cpf_e_nao_nome(client, session, ctx, entrega):
    _, mid = entrega
    usuario = _get(session, Funcionario, ctx["admin"].id)
    usuario.nome = "Motorista"
    session.commit()
    assert client.get("/api/delivery/motoristas/me", headers=ctx["headers"]).get_json()["motorista_id"] is None
    usuario.cpf = "529.982.247-25"
    usuario.nome = "Nome diferente"
    session.commit()
    assert client.get("/api/delivery/motoristas/me", headers=ctx["headers"]).get_json()["motorista_id"] == mid


def test_fila_de_acertos_inclui_entregue_e_remove_apos_receber(client, session, ctx, entrega):
    eid, mid = entrega
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 200
    assert _status(client, ctx, eid, "entregue").status_code == 200
    response = client.get("/api/delivery/entregas?pagamento_status=pendente", headers=ctx["headers"])
    assert response.status_code == 200, response.get_json()
    assert [e["id"] for e in response.get_json()["entregas"]] == [eid]
    assert _acerto(client, ctx, eid).status_code == 200
    assert client.get("/api/delivery/entregas?pagamento_status=pendente", headers=ctx["headers"]).get_json()["entregas"] == []


def test_veiculo_conta_entrega_uma_vez(client, session, ctx, entrega):
    eid, mid = entrega
    veiculo = Veiculo(estabelecimento_id=ctx["estab"].id, tipo="MOTO", placa="ABC1D23", ativo=True)
    session.add(veiculo)
    session.commit()
    vid = veiculo.id
    assert _status(client, ctx, eid, "em_rota", motorista_id=mid, veiculo_id=vid).status_code == 200
    for _ in range(2):
        assert _status(client, ctx, eid, "entregue").status_code == 200
    assert _get(session, Veiculo, vid).total_entregas == 1


def test_cancelar_venda_apos_acerto_estorna_caixa(client, session, ctx, entrega):
    eid, _ = entrega
    assert _acerto(client, ctx, eid).status_code == 200
    registro = _get(session, Entrega, eid)
    response = client.post(f"/api/vendas/{registro.venda_id}/cancelar", headers=ctx["headers"],
                          json={"motivo": "Cancelamento aprovado", "senha_admin": "industrial-secret"})
    assert response.status_code == 200, response.get_json()
    assert _get(session, Caixa, ctx["caixa"].id).saldo_atual == 0
    assert _acerto(client, ctx, eid).status_code == 409


@pytest.mark.parametrize("acao", ["receber", "status"])
def test_confirmacao_concorrente_postgres(app, client, session, ctx, entrega, acao):
    from app import db
    from concurrent.futures import ThreadPoolExecutor
    if db.engine.dialect.name != "postgresql":
        pytest.skip("Exige PostgreSQL isolado")
    eid, mid = entrega
    if acao == "status":
        assert _status(client, ctx, eid, "em_rota", motorista_id=mid).status_code == 200
    # Fechar a transação de leitura antes de iniciar as sessões concorrentes.
    headers = dict(ctx["headers"])
    caixa_id = ctx["caixa"].id
    session.commit()
    def chamar(_):
        with app.test_client() as c:
            if acao == "receber":
                return c.post(f"/api/delivery/entregas/{eid}/receber", headers=headers, json={
                    "chave_operacao": "acerto-concorrente-0001", "pagamentos": [{"forma_pagamento": "dinheiro", "valor": 50}]}).status_code
            return c.put(f"/api/delivery/entregas/{eid}/status", headers=headers, json={"status": "entregue"}).status_code
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert list(executor.map(chamar, range(4))) == [200] * 4
    session.expire_all()
    if acao == "receber":
        assert session.get(Caixa, caixa_id).saldo_atual == Decimal("50")
        assert session.query(Pagamento).count() == 1
        assert session.query(MovimentacaoCaixa).filter_by(tipo="venda").count() == 1
    else:
        assert session.get(Motorista, mid).total_entregas == 1
