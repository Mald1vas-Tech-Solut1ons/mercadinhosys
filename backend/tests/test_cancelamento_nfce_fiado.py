# -*- coding: utf-8 -*-
"""Provas dos itens 2/3/4 do PR 47 (cancelamento de venda):

2. Fiado que o cliente já pagou volta em DINHEIRO pela gaveta de quem cancela
   (e o cancelamento recusa sem gaveta aberta / gaveta sem saldo).
3. Pix/cartão com caixa original fechado e sem gaveta aberta: estorno NÃO
   toca gaveta nenhuma (fica no pagamento/auditoria).
4. Venda com NFC-e autorizada: SEFAZ recusou o cancelamento → a venda INTIEIRA
   continua de pé (rollback de estoque/caixa/pagamento/doc); SEFAZ aceitou →
   doc e venda cancelados juntos, na mesma transação.
"""
from datetime import datetime, timezone, date
from decimal import Decimal

import pytest

from app.models import (
    Caixa, CatalogoMestre, CategoriaProduto, Configuracao, ContaReceber, Estabelecimento,
    Funcionario, MovimentacaoCaixa, Produto, DocumentoFiscal, Venda, VendaItem, Cliente,
)
from app.routes.vendas import vendas_bp


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="CancelDemo")
    caixa = Caixa(estabelecimento_id=estab.id, funcionario_id=admin.id, numero_caixa="CANC-1",
                  saldo_inicial=Decimal("100"), saldo_atual=Decimal("100"), status="aberto",
                  data_abertura=datetime.now(timezone.utc))
    session.add_all([cat, caixa])
    session.commit()
    from flask_jwt_extended import create_access_token
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, cat=cat, caixa=caixa,
                headers={"Authorization": f"Bearer {token}"})


def _produto(session, ctx, nome="Item Canx", quantidade=10):
    p = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["cat"].id, nome=nome,
                preco_custo=Decimal("2"), preco_venda=Decimal("5"),
                quantidade=Decimal(str(quantidade)))
    session.add(p)
    session.commit()
    return p


def _vender_pix(client, ctx, produto, valor=Decimal("20"), caixa_id=None):
    """Venda via /vendas/ (o endpoint que aceita caixa_id opcional).
    4 itens × 5.00 = subtotal 20 (o validador recalcula e cobra consistência)."""
    quantidade = 4
    preco = Decimal("5")
    subtotal = (Decimal(quantidade) * preco).quantize(Decimal("0.01"))
    r = client.post("/api/vendas/", headers=ctx["headers"], json={
        "items": [{"id": produto.id, "quantity": quantidade, "discount": 0, "price": float(preco)}],
        "subtotal": float(subtotal),
        "total": float(valor),
        "pagamentos": [{"forma": "pix", "valor": float(valor)}],
        "caixa_id": caixa_id,
    })
    body = r.get_json() or {}
    # Resposta real do endpoint: {"venda": {...}} ou {"venda_id": N}
    if isinstance(body, dict) and "venda" in body:
        vid = body["venda"]["id"]
    elif isinstance(body, dict) and "venda_id" in body:
        vid = body["venda_id"]
    else:
        vid = None
    r._vid = vid
    return r


def _venda(session, cliente, total=Decimal("20"), forma="fiado", venc=None):
    """Venda finalizada fiado (título em aberto) direto no banco."""
    estab_id = cliente.estabelecimento_id
    venda = Venda(
        estabelecimento_id=estab_id, funcionario_id=cliente.id, cliente_id=None,
        codigo=f"CT-{abs(hash((estab_id, total, forma, datetime.now().isoformat()))) % 10**8:08d}",
        subtotal=total, desconto=Decimal("0"), total=total, status="finalizada",
        data_venda=datetime.now(timezone.utc),
    )
    item = VendaItem(venda=venda, produto_id=None, produto_nome="Serv", produto_unidade="UN",
                     quantidade=Decimal("1"), preco_unitario=total, total_item=total)
    session.add_all([venda, item])
    session.flush()
    titulo = ContaReceber(
        estabelecimento_id=estab_id, venda_id=venda.id, cliente_id=None,
        valor_original=total, valor_atual=total, valor_recebido=Decimal("0"),
        status="aberto", data_emissao=date.today(),
        data_vencimento=venc or date.today(),
    )
    session.add(titulo)
    return venda, titulo


# ── Item 3: Pix com caixa fechado e sem gaveta aberta ───────────────────────

def test_pix_caixa_fechado_sem_gaveta_aberta_cancela_sem_tocar_gaveta(client, session, ctx):
    """Venda pix por caixa agora FECHADO: cancelamento fecha a venda e não lança
    estorno em gaveta nenhuma (o fechamento conferido não muda)."""
    produto = _produto(session, ctx)
    r = _vender_pix(client, ctx, produto, caixa_id=ctx["caixa"].id)
    assert r.status_code == 201, r.get_json()
    vid = r.get_json()["venda"]["id"]

    # Fecha o caixa da venda; ninguém mais tem gaveta aberta
    cx = session.get(Caixa, ctx["caixa"].id)
    cx.status = "fechado"
    cx.data_fechamento = datetime.now(timezone.utc)
    session.commit()
    saldo_fechado = Decimal(str(cx.saldo_atual))

    r = client.post(f"/api/vendas/{vid}/cancelar", headers=ctx["headers"],
                    json={"motivo": "Teste item 3", "senha_admin": "industrial-secret"})
    assert r.status_code == 200, r.get_json()
    session.expire_all()
    venda = session.get(Venda, vid)
    assert venda.status == "cancelada"
    # Nenhuma movimentação de estorno foi criada para esta venda
    estornos = MovimentacaoCaixa.query.filter_by(venda_id=vid, tipo="estorno").all()
    assert estornos == []
    # A gaveta fechada não mudou
    assert Decimal(str(session.get(Caixa, cx.id).saldo_atual)) == saldo_fechado


# ── Item 2: fiado pago devolve em dinheiro pela gaveta ──────────────────────

def test_fiado_pago_devolve_dinheiro_na_gaveta(client, session, ctx):
    """Cliente pagou R$ 12 do fiado: o cancelamento devolve os 12 em dinheiro na
    gaveta aberta de quem cancela e cancela o título (saldo_devedor não fica negativo)."""
    cliente = Cliente(estabelecimento_id=ctx["estab"].id, nome="Fiado Pago", cpf="00000000000",
                      celular="92999999999", cep="69000-000", logradouro="Rua A", numero="1",
                      bairro="Centro", cidade="Manaus", estado="AM")
    session.add(cliente)
    session.commit()

    venda = Venda(
        estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id,
        cliente_id=cliente.id,
        codigo=f"FP-{abs(hash(datetime.now().isoformat())) % 10**8:08d}",
        subtotal=Decimal("20"), desconto=Decimal("0"), total=Decimal("20"),
        status="finalizada", data_venda=datetime.now(timezone.utc),
    )
    item = VendaItem(venda=venda, estabelecimento_id=ctx["estab"].id, produto_id=_produto(session, ctx, "Fiado Pago Item").id, produto_nome="Fiado", produto_unidade="UN",
                     quantidade=Decimal("1"), preco_unitario=Decimal("20"), total_item=Decimal("20"))
    titulo = ContaReceber(
        estabelecimento_id=ctx["estab"].id, venda=venda, cliente_id=cliente.id,
        numero_documento=venda.codigo, valor_original=Decimal("20"), valor_atual=Decimal("8"), valor_recebido=Decimal("12"),
        status="aberto", data_emissao=date.today(), data_vencimento=date.today(),
    )
    cliente.saldo_devedor = Decimal("8")
    session.add_all([venda, item, titulo])
    session.commit()
    vid = venda.id
    saldo_antes = Decimal(str(session.get(Caixa, ctx["caixa"].id).saldo_atual))

    r = client.post(f"/api/vendas/{vid}/cancelar", headers=ctx["headers"],
                    json={"motivo": "Devolução integral", "senha_admin": "industrial-secret"})
    assert r.status_code == 200, r.get_json()
    session.expire_all()

    # 1. Título cancelado
    assert session.query(ContaReceber).filter_by(venda_id=vid).first().status == "cancelado"
    # 2. Dinheiro voltou na gaveta como movimento de estorno (12)
    mov = MovimentacaoCaixa.query.filter_by(venda_id=vid, tipo="estorno").first()
    assert mov is not None and Decimal(str(mov.valor)) == Decimal("12")
    assert mov.caixa_id == ctx["caixa"].id
    # 3. Saldo da gaveta caiu 12
    assert Decimal(str(session.get(Caixa, ctx["caixa"].id).saldo_atual)) == saldo_antes - Decimal("12")
    # 4. Venda cancelada
    assert session.get(Venda, vid).status == "cancelada"


def test_fiado_pago_sem_gaveta_aberta_recusa_cancelamento(client, session, ctx):
    """Sem gaveta aberta e com fiado parcialmente pago: recusa ANTES de alterar
    qualquer coisa (a venda continua finalizada)."""
    cliente = Cliente(estabelecimento_id=ctx["estab"].id, nome="Fiado Sem Gaveta",
                      cpf="00000000001", celular="92999999999", cep="69000-000",
                      logradouro="Rua B", numero="2", bairro="Centro", cidade="Manaus",
                      estado="AM")
    session.add(cliente)
    venda = Venda(
        estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id,
        cliente_id=cliente.id,
        codigo=f"FS-{abs(hash(datetime.now().isoformat())) % 10**8:08d}",
        subtotal=Decimal("50"), desconto=Decimal("0"), total=Decimal("50"),
        status="finalizada", data_venda=datetime.now(timezone.utc),
    )
    item = VendaItem(venda=venda, estabelecimento_id=ctx["estab"].id, produto_id=_produto(session, ctx, "Fiado2 Item").id, produto_nome="Fiado2", produto_unidade="UN",
                     quantidade=Decimal("1"), preco_unitario=Decimal("50"), total_item=Decimal("50"))
    titulo = ContaReceber(
        estabelecimento_id=ctx["estab"].id, venda=venda, cliente_id=cliente.id,
        numero_documento=venda.codigo, valor_original=Decimal("50"), valor_atual=Decimal("0"), valor_recebido=Decimal("50"),
        status="aberto", data_emissao=date.today(), data_vencimento=date.today(),
    )
    session.add_all([venda, item, titulo])
    # Fecha a única gaveta
    session.get(Caixa, ctx["caixa"].id).status = "fechado"
    session.commit()
    vid = venda.id

    r = client.post(f"/api/vendas/{vid}/cancelar", headers=ctx["headers"],
                    json={"motivo": "Sem gaveta", "senha_admin": "industrial-secret"})
    assert r.status_code == 400, r.get_json()
    assert "caixa" in r.get_json()["error"].lower()
    session.expire_all()
    assert session.get(Venda, vid).status == "finalizada"


# ── Item 4: NFC-e acompanha o cancelamento, na mesma transação ──────────────

def _emitir_nfce_autorizada(session, ctx, venda):
    doc = DocumentoFiscal(
        estabelecimento_id=ctx["estab"].id, venda_id=venda.id,
        referencia=f"REF-{venda.codigo}", tipo="nfce", status="autorizado",
        numero=123, serie=1,
    )
    session.add(doc)
    session.commit()
    return doc


def test_nfce_cancelada_junto_com_a_venda_quando_sefaz_aceita(client, session, ctx, monkeypatch):
    from app.services.fiscal import gateways as gw
    produto = _produto(session, ctx)
    r = _vender_pix(client, ctx, produto, caixa_id=ctx["caixa"].id)
    assert r.status_code == 201, r.get_json()
    vid = r.get_json()["venda"]["id"]
    venda = session.get(Venda, vid)
    doc = _emitir_nfce_autorizada(session, ctx, venda)

    # Gateway simulado aceita tudo; garantimos que foi chamado
    chamadas = []
    class FakeGW:
        def cancelar(self, referencia, justificativa):
            chamadas.append((referencia, justificativa))
            return {"status": "cancelado", "mensagem": "ok"}
    monkeypatch.setattr(gw, "get_gateway", lambda estab: FakeGW())

    r = client.post(f"/api/vendas/{vid}/cancelar", headers=ctx["headers"],
                    json={"motivo": "Cliente desistiu da compra integralmente hoje mesmo",
                          "senha_admin": "industrial-secret"})
    assert r.status_code == 200, r.get_json()
    session.expire_all()
    assert len(chamadas) == 1 and chamadas[0][0] == doc.referencia
    assert session.query(DocumentoFiscal).filter_by(venda_id=vid).first().status == "cancelado"
    assert session.get(Venda, vid).status == "cancelada"


def test_sefaz_recusa_cancelamento_venda_inteira_fica_de_pe(client, session, ctx, monkeypatch):
    """SEFAZ recusou: venda permanece finalizada, estoque/caixa/pagamento/doc intactos."""
    produto = _produto(session, ctx, "NFC-e Refusada", quantidade=10)
    saldo_estoque_antes = Decimal("10")
    r = _vender_pix(client, ctx, produto, caixa_id=ctx["caixa"].id)
    assert r.status_code == 201, r.get_json()
    vid = r.get_json()["venda"]["id"]
    _emitir_nfce_autorizada(session, ctx, session.get(Venda, vid))

    from app.services.fiscal import gateways as gw
    class FakeGW:
        def cancelar(self, referencia, justificativa):
            return {"status": "erro", "mensagem": "Prazo de cancelamento expirado"}
    monkeypatch.setattr(gw, "get_gateway", lambda estab: FakeGW())

    saldo_gaveta_antes = Decimal(str(session.get(Caixa, ctx["caixa"].id).saldo_atual))
    qtd_antes = session.get(Produto, produto.id).quantidade

    r = client.post(f"/api/vendas/{vid}/cancelar", headers=ctx["headers"],
                    json={"motivo": "Tentativa que a SEFAZ recusou",
                          "senha_admin": "industrial-secret"})
    assert r.status_code == 500, r.get_json()
    assert "SEFAZ" in r.get_json()["error"]

    session.expire_all()
    # venda de pé
    assert session.get(Venda, vid).status == "finalizada"
    # doc continua autorizado
    doc = session.query(DocumentoFiscal).filter_by(venda_id=vid).first()
    assert doc.status == "autorizado"
    # estoque e gaveta intactos
    assert session.get(Produto, produto.id).quantidade == qtd_antes
    assert Decimal(str(session.get(Caixa, ctx["caixa"].id).saldo_atual)) == saldo_gaveta_antes
    # sem movimentos de estorno
    assert MovimentacaoCaixa.query.filter_by(venda_id=vid, tipo="estorno").all() == []


def test_nfce_sem_doc_ou_nao_autorizada_cancela_normal(client, session, ctx, monkeypatch):
    """Venda sem doc fiscal (ou doc em estado processando) cancela sem tocar o gateway."""
    from app.services.fiscal import gateways as gw
    chamadas = []
    class FakeGW:
        def cancelar(self, referencia, justificativa):
            chamadas.append((referencia, justificativa))
            return {"status": "cancelado"}
    monkeypatch.setattr(gw, "get_gateway", lambda estab: FakeGW())

    produto = _produto(session, ctx, "Sem Doc Fiscal")
    r = _vender_pix(client, ctx, produto, caixa_id=ctx["caixa"].id)
    vid = r.get_json()["venda"]["id"]
    r = client.post(f"/api/vendas/{vid}/cancelar", headers=ctx["headers"],
                    json={"motivo": "Sem documento fiscal", "senha_admin": "industrial-secret"})
    assert r.status_code == 200, r.get_json()
    assert chamadas == []  # nunca tocou o gateway
    assert session.get(Venda, vid).status == "cancelada"