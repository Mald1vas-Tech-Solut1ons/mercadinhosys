"""FASE 1.9 — a auditoria sempre sabe QUEM fez.

Dois defeitos fechados aqui:
1. ``Auditoria.registrar_direto`` engolia a exceção com ``except: pass`` — evento
   perdido sem uma linha de log.
2. A exclusão de cliente derivava o autor de ``int(username)``; com login por
   e-mail o "sub" não é numérico, então o rastro do responsável virava NULL.

Este teste faz a exclusão com um token cujo "sub" é um e-mail (identidade
numérica separada, como o login por e-mail emite) e exige usuario_id preenchido.
"""
from datetime import date
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import Auditoria, Cliente, Estabelecimento, Funcionario


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()

    cliente = Cliente(estabelecimento_id=estab.id, nome="Cliente Fantasma 1.9",
                      cpf="98765432100", email="fantasma19@exemplo.com",
                      celular="92999990000",
                      cep="69000000", logradouro="Rua Teste", numero="10",
                      bairro="Centro", cidade="Manaus", estado="AM")
    session.add(cliente)
    session.commit()

    token = create_access_token(
        identity=str(admin.id),
        additional_claims={"estabelecimento_id": estab.id, "role": admin.role or "admin",
                           "email": "dono@loja.com.br"},
    )
    return dict(estab=estab, admin=admin, cliente=cliente,
                headers={"Authorization": f"Bearer {token}"})


def test_exclusao_de_cliente_com_login_por_email_grava_usuario_id(client, ctx, session):
    r = client.delete(f"/api/clientes/{ctx['cliente'].id}", headers=ctx["headers"])
    assert r.status_code in (200, 204), r.get_json()

    session.expire_all()
    linha = Auditoria.query.filter_by(
        estabelecimento_id=ctx["estab"].id, tipo_evento="cliente_excluido").order_by(Auditoria.id.desc()).first()

    assert linha is not None, "a exclusão precisa deixar rastro na auditoria"
    assert linha.usuario_id == ctx["admin"].id, "usuario_id não pode ser NULL com login por e-mail"


def test_registrar_direto_com_erro_nao_estoura_e_loga(session, monkeypatch):
    """Falha de auditoria não pode derrubar a venda — mas também não pode ser silenciosa."""
    class ConexaoQuebrada:
        def execute(self, *a, **k):
            raise RuntimeError("boom")

    registros = []

    class LoggerFalso:
        def error(self, msg, **kwargs):
            registros.append((msg, kwargs))

    class AppFalsa:
        logger = LoggerFalso()

    import app.models as models
    monkeypatch.setattr(models, "current_app", AppFalsa())

    models.Auditoria.registrar_direto(
        connection=ConexaoQuebrada(),
        estabelecimento_id=1,
        tipo_evento="teste",
        descricao="evento que falha",
    )

    assert registros, "a falha tem que aparecer no log"
    assert "auditoria" in registros[0][0].lower()
    assert registros[0][1].get("exc_info") is True
