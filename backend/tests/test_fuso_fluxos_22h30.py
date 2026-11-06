"""Fluxos críticos às 22:30 de Brasília (01:30 UTC do dia seguinte), o horário em que o dia UTC já virou.

Cada teste prova um fluxo que o lojista usa à noite: vender lote que vence hoje, ver boleto que vence
hoje, bater ponto, ver as vendas do dia, fechar o caixa, ver o RFM do cliente no PDV e a rota do dia.
"""
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

import app.utils.timezone as tz
from app.models import (
    Caixa, CategoriaProduto, Cliente, ContaPagar, Estabelecimento, Fornecedor, Funcionario, Produto,
    ProdutoLote, RegistroPonto, Venda,
)

AGORA_UTC = datetime(2026, 11, 6, 1, 30, tzinfo=timezone.utc)  # quinta 05/11/2026 22:30 em Brasília
DIA_LOJA = date(2026, 11, 5)


class _RelogioCongelado(datetime):
    @classmethod
    def now(cls, tz_=None):
        return AGORA_UTC if tz_ is None else AGORA_UTC.astimezone(tz_)


@pytest.fixture
def relogio(monkeypatch):
    monkeypatch.setattr(tz, "datetime", _RelogioCongelado)


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Fuso 22h30")
    forn = Fornecedor(
        estabelecimento_id=estab.id, nome_fantasia="Distribuidora Fuso", razao_social="Distribuidora Fuso LTDA",
        cnpj="11222333000155", telefone="11999999999", email="fuso@example.test", cep="01000000",
        logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP", pais="Brasil",
    )
    session.add_all([cat, forn])
    session.flush()
    token = create_access_token(identity=str(admin.id), additional_claims={
        "estabelecimento_id": estab.id, "role": "admin"})
    return dict(estab=estab, admin=admin, cat=cat, forn=forn, headers={"Authorization": f"Bearer {token}"})


def _venda(session, ctx, criada_utc, codigo, total="10"):
    v = Venda(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id, codigo=codigo,
              subtotal=Decimal(total), total=Decimal(total), status="finalizada",
              created_at=criada_utc, data_venda=criada_utc)
    session.add(v)
    return v


# ── PDV: lote que vence HOJE ainda é vendável às 22:30 ────────────────────────

def test_pdv_vende_lote_que_vence_hoje_as_22h30(client, session, ctx, relogio):
    prod = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["cat"].id, nome="IOGURTE VENCE HOJE",
                   preco_custo=Decimal("1"), preco_venda=Decimal("3"), quantidade=Decimal("5"),
                   controlar_validade=True, data_validade=DIA_LOJA)
    session.add(prod)
    session.flush()
    session.add_all([
        ProdutoLote(estabelecimento_id=ctx["estab"].id, produto_id=prod.id, fornecedor_id=ctx["forn"].id,
                    numero_lote="L-HOJE", quantidade=5, quantidade_inicial=5, data_entrada=DIA_LOJA - timedelta(days=10),
                    data_validade=DIA_LOJA, preco_custo_unitario=1, ativo=True),
        Caixa(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id, numero_caixa="FUSO-PDV",
              saldo_inicial=0, saldo_atual=0, status="aberto"),
    ])
    session.commit()

    r = client.post("/api/pdv/finalizar", headers=ctx["headers"], json={
        "subtotal": 15.0, "total": 15.0, "desconto": 0,
        "items": [{"id": prod.id, "quantidade": 5, "preco_unitario": 3}],
        "pagamentos": [{"forma": "dinheiro", "valor": 15.0}],
    })
    # Com o dia UTC (06/11) o lote estaria em quarentena e o PDV recusaria a venda.
    assert r.status_code == 201, r.get_data(as_text=True)
    session.expire_all()
    assert session.query(ProdutoLote).filter_by(numero_lote="L-HOJE").one().quantidade == 0


# ── Boleto que vence HOJE não é "vencido" às 22:30 ────────────────────────────

def test_boleto_que_vence_hoje_nao_aparece_como_vencido(client, session, ctx, relogio):
    session.add(ContaPagar(
        estabelecimento_id=ctx["estab"].id, fornecedor_id=ctx["forn"].id, numero_documento="BOL-FUSO-HOJE",
        tipo_documento="boleto", valor_original=Decimal("50"), valor_atual=Decimal("50"),
        data_emissao=DIA_LOJA - timedelta(days=30), data_vencimento=DIA_LOJA, status="aberto"))
    session.commit()

    vencidos = client.get("/api/boletos-fornecedores/?apenas_vencidos=true", headers=ctx["headers"])
    assert vencidos.status_code == 200, vencidos.get_data(as_text=True)
    docs = [b.get("numero_documento") for b in vencidos.get_json()["boletos"]]
    assert "BOL-FUSO-HOJE" not in docs

    todos = client.get("/api/boletos-fornecedores/", headers=ctx["headers"]).get_json()
    boleto = next(b for b in todos["boletos"] if b["numero_documento"] == "BOL-FUSO-HOJE")
    assert boleto["dias_vencimento"] == 0
    assert todos["estatisticas"]["vence_hoje"] >= 1

    despesas = client.get("/api/despesas/boletos-a-vencer/?apenas_vencidos=true", headers=ctx["headers"])
    assert despesas.status_code == 200, despesas.get_data(as_text=True)
    assert "BOL-FUSO-HOJE" not in despesas.get_data(as_text=True)


# ── Ponto e turno às 22h caem no dia da loja ──────────────────────────────────

def test_ponto_e_turno_das_22h_ficam_no_dia_da_loja(session, ctx, relogio):
    from app.models import TurnoEntregador
    ponto = RegistroPonto(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id,
                          tipo_registro="saida", hora=time(22, 0))
    turno = TurnoEntregador(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id, km_inicial=0)
    session.add_all([ponto, turno])
    session.commit()
    assert ponto.data == DIA_LOJA
    assert turno.data_turno == DIA_LOJA


# ── Vendas do dia: a virada é meia-noite de Brasília, não 21h ─────────────────

def test_vendas_do_dia_e_relatorio_diario_usam_o_dia_da_loja(client, session, ctx, relogio):
    _venda(session, ctx, datetime(2026, 11, 5, 12, 0), "FUSO-MANHA")      # 09:00 de 05/11 em Brasília
    _venda(session, ctx, datetime(2026, 11, 6, 1, 0), "FUSO-NOITE")       # 22:00 de 05/11 em Brasília
    _venda(session, ctx, datetime(2026, 11, 5, 1, 0), "FUSO-ONTEM")       # 22:00 de 04/11 em Brasília
    session.commit()

    r = client.get("/api/vendas/vendas-do-dia", headers=ctx["headers"])
    assert r.status_code == 200, r.get_data(as_text=True)
    corpo = r.get_data(as_text=True)
    assert "FUSO-MANHA" in corpo and "FUSO-NOITE" in corpo
    assert "FUSO-ONTEM" not in corpo

    rel = client.get("/api/vendas/relatorio-diario", headers=ctx["headers"])
    assert rel.status_code == 200, rel.get_data(as_text=True)
    assert rel.get_json()["resumo"]["quantidade_vendas"] == 2  # manhã e noite de 05/11; a de 04/11 fica fora


# ── Fechamento de caixa: banco grava UTC, número usa a hora de Brasília ───────

def test_fechamento_de_caixa_grava_instante_utc(client, session, ctx, relogio):
    caixa = Caixa(estabelecimento_id=ctx["estab"].id, funcionario_id=ctx["admin"].id, numero_caixa="FUSO-FECHA",
                  saldo_inicial=0, saldo_atual=0, status="aberto")
    session.add(caixa)
    session.commit()
    r = client.post("/api/caixas/fechar", headers=ctx["headers"], json={"valor_informado": 0})
    assert r.status_code == 200, r.get_data(as_text=True)
    session.expire_all()
    fechado = session.get(Caixa, caixa.id)
    assert fechado.status == "fechado"
    assert fechado.data_fechamento == datetime(2026, 11, 6, 1, 30)  # 22:30 de Brasília = 01:30 UTC


# ── RFM do cliente no PDV não quebra com venda gravada sem fuso ───────────────

def test_rfm_do_cliente_no_pdv_responde(client, session, ctx):
    cli = Cliente(estabelecimento_id=ctx["estab"].id, nome="Cliente RFM", cpf="98765432100", celular="11988887777",
                  cep="01000000", logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP")
    session.add(cli)
    session.flush()
    v = _venda(session, ctx, datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=3), "FUSO-RFM")
    v.cliente_id = cli.id
    session.commit()
    r = client.get(f"/api/pdv/cliente/{cli.id}/rfm", headers=ctx["headers"])
    # Antes: TypeError (datetime com fuso − coluna sem fuso) → 500, e no PDV o RFM sumia em silêncio.
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["rfm"]["recency_days"] == 3


# ── SFA: a rota "de hoje" é a do dia da semana da loja ────────────────────────

def test_rota_do_dia_do_vendedor_usa_o_dia_da_semana_da_loja(app, session, ctx, relogio):
    from app.models import Rota
    from app.routes.sfa import _rotas_do_vendedor
    for nome, dia in (("Rota Quinta", 3), ("Rota Sexta", 4)):
        session.add(Rota(estabelecimento_id=ctx["estab"].id, nome=nome, vendedor_id=ctx["admin"].id,
                         dia_semana=dia, ativa=True))
    session.commit()
    rotas = _rotas_do_vendedor(ctx["admin"].id, ctx["estab"].id, somente_hoje=True)
    assert [r["nome"] for r in rotas] == ["Rota Quinta"]  # 22:30 de quinta; em UTC já era sexta


# ── O dia local em SQL também vale no PostgreSQL (produção) ───────────────────

def test_dia_local_em_sql_no_postgres():
    from sqlalchemy import Column, DateTime, MetaData, Table, select
    from sqlalchemy.dialects import postgresql
    from unittest.mock import patch
    import app.utils.query_helpers as qh

    t = Table("t", MetaData(), Column("created_at", DateTime))
    with patch.object(qh, "_get_db") as fake:
        fake.return_value.engine.name = "postgresql"
        expr = qh.get_local_date(t.c.created_at)
    sql = str(select(expr).compile(dialect=postgresql.dialect()))
    assert "date(t.created_at + " in sql
