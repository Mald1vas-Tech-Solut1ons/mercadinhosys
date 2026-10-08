"""
Testes Unitários do Módulo de Conformidade LGPD (/api/lgpd/delete)
"""

import pytest
from datetime import date
from flask_jwt_extended import create_access_token
from app import db
from app.models import Estabelecimento, Cliente, Funcionario, Auditoria


@pytest.fixture
def ambiente_lgpd(session):
    """Cria estabelecimento, clientes e funcionários para teste LGPD."""
    estab = Estabelecimento(
        nome_fantasia="Loja LGPD Test",
        razao_social="Loja LGPD LTDA",
        cnpj="11222333000199",
        email="contato@lgpdtest.com",
        telefone="92977777777",
        plano="PRO",
        cep="69000-000",
        logradouro="Rua Teste",
        numero="100",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
        pais="Brasil",
    )
    db.session.add(estab)
    db.session.flush()

    cliente = Cliente(
        estabelecimento_id=estab.id,
        nome="Cliente Sensível Silva",
        cpf="123.456.789-00",
        email="sensivel@gmail.com",
        telefone="92999990000",
        celular="92999990000",
        cep="69000-000",
        logradouro="Rua Sensível",
        numero="10",
        bairro="Centro",
        cidade="Manaus",
        estado="AM",
        pais="Brasil",
    )
    
    func_inativo = Funcionario(
        estabelecimento_id=estab.id,
        nome="Funcionário Demitido",
        cpf="987.654.321-11",
        email="demitido@empresa.com",
        username="ex_func_01",
        senha="hashed_password_123",
        cargo="Operador Ex",
        telefone="92988888888",
        celular="92988888888",
        data_nascimento=date(1990, 1, 1),
        data_admissao=date(2023, 1, 1),
        ativo=False,
    )

    func_admin = Funcionario(
        estabelecimento_id=estab.id,
        nome="Administrador LGPD",
        cpf="111.222.333-44",
        email="admin@empresa.com",
        username="admin_lgpd",
        senha="hashed_password_admin",
        cargo="Administrador",
        role="admin",
        telefone="92988888888",
        celular="92988888888",
        data_nascimento=date(1985, 5, 15),
        data_admissao=date(2020, 1, 1),
        ativo=True,
    )

    db.session.add_all([cliente, func_inativo, func_admin])
    db.session.commit()

    return estab, cliente, func_inativo, func_admin


def test_lgpd_delete_exige_confirmacao(client, ambiente_lgpd):
    estab, cliente, func_inativo, func_admin = ambiente_lgpd
    token = create_access_token(
        identity=str(func_admin.id),
        additional_claims={"estabelecimento_id": estab.id, "role": "admin", "is_super_admin": False},
    )

    # Chamada sem campo confirmacao
    resp = client.post(
        "/api/lgpd/delete",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "confirmacao" in resp.get_json()["message"].lower()


def test_lgpd_delete_anonimiza_com_sucesso(client, ambiente_lgpd):
    estab, cliente, func_inativo, func_admin = ambiente_lgpd
    token = create_access_token(
        identity=str(func_admin.id),
        additional_claims={"estabelecimento_id": estab.id, "role": "admin", "is_super_admin": False},
    )

    resp = client.post(
        "/api/lgpd/delete",
        json={"confirmacao": "EXCLUIR_DADOS_LGPD"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    res_data = resp.get_json()
    assert res_data["success"] is True
    assert res_data["estatisticas"]["clientes_anonimizados"] >= 1

    # Verificar anonimização no banco
    cliente_db = Cliente.query.get(cliente.id)
    assert cliente_db.nome.startswith("Cliente Anonimizado LGPD")
    assert cliente_db.cpf == f"ANON{cliente.id:010d}"
    assert "lgpd.local" in cliente_db.email

    # Verificar registro de auditoria
    log = Auditoria.query.filter_by(estabelecimento_id=estab.id, tipo_evento="LGPD_EXCLUSAO_DADOS").first()
    assert log is not None
    assert "LGPD" in log.tipo_evento


def _token_admin(estab, func_admin):
    return create_access_token(
        identity=str(func_admin.id),
        additional_claims={"estabelecimento_id": estab.id, "role": "admin", "is_super_admin": False},
    )


def _cliente_extra(estab, **campos):
    base = dict(estabelecimento_id=estab.id, celular="92999990001", cep="69000-000", logradouro="Rua", numero="1",
                bairro="Centro", cidade="Manaus", estado="AM", pais="Brasil")
    base.update(campos)
    return Cliente(**base)


def test_lgpd_anonimiza_varios_clientes_sem_colidir_documento(client, ambiente_lgpd):
    """Antes todos viravam '000.000.000-00' e o segundo cliente quebrava a unicidade de CPF por loja."""
    estab, cliente, _, func_admin = ambiente_lgpd
    outros = [_cliente_extra(estab, nome=f"Outro {i}", cpf=f"529.982.247-{i:02d}") for i in range(2)]
    db.session.add_all(outros)
    db.session.commit()

    resp = client.post("/api/lgpd/delete", json={"confirmacao": "EXCLUIR_DADOS_LGPD"},
                       headers={"Authorization": f"Bearer {_token_admin(estab, func_admin)}"})
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["estatisticas"]["clientes_anonimizados"] == 3

    documentos = [c.cpf for c in Cliente.query.filter_by(estabelecimento_id=estab.id).all()]
    assert len(documentos) == len(set(documentos)) == 3
    assert all(d.startswith("ANON") for d in documentos)


def test_lgpd_limpa_dados_de_pessoa_juridica(client, ambiente_lgpd):
    estab, _, _, func_admin = ambiente_lgpd
    pj = _cliente_extra(estab, nome="Distribuidora Alfa", tipo_pessoa="PJ", cpf=None, cnpj="11.222.333/0001-81",
                        razao_social="Alfa Distribuidora LTDA", inscricao_estadual="123456789",
                        contato_nome="Maria Compradora", observacoes="paga em dia")
    db.session.add(pj)
    db.session.commit()

    resp = client.post("/api/lgpd/delete", json={"confirmacao": "EXCLUIR_DADOS_LGPD"},
                       headers={"Authorization": f"Bearer {_token_admin(estab, func_admin)}"})
    assert resp.status_code == 200, resp.get_json()

    pj = db.session.get(Cliente, pj.id)
    assert pj.cnpj is None and pj.razao_social is None and pj.inscricao_estadual is None
    assert pj.contato_nome is None and pj.observacoes is None
    assert pj.nome.startswith("Cliente Anonimizado LGPD")


def test_lgpd_anonimiza_motorista_inativo_e_preserva_o_ativo(client, ambiente_lgpd):
    from app.models import Motorista
    estab, _, _, func_admin = ambiente_lgpd
    base = dict(estabelecimento_id=estab.id, telefone="92999990002", celular="92999990002")
    inativo = Motorista(nome="Zé Ex-Motorista", cpf="111.111.111-11", cnh="12345678900", email="ze@x.com",
                        foto_url="https://x/foto.jpg", cnh_documento_url="https://x/cnh.pdf", ativo=False, **base)
    ativo = Motorista(nome="João Ativo", cpf="222.222.222-22", cnh="99999999999", ativo=True, **base)
    db.session.add_all([inativo, ativo])
    db.session.commit()

    resp = client.post("/api/lgpd/delete", json={"confirmacao": "EXCLUIR_DADOS_LGPD"},
                       headers={"Authorization": f"Bearer {_token_admin(estab, func_admin)}"})
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["estatisticas"]["motoristas_anonimizados"] == 1

    inativo, ativo = db.session.get(Motorista, inativo.id), db.session.get(Motorista, ativo.id)
    assert inativo.nome.startswith("Ex-Motorista Anonimizado")
    assert inativo.cpf == f"ANON{inativo.id:010d}" and inativo.cnh == f"ANON{inativo.id:010d}"
    assert inativo.email is None and inativo.foto_url is None and inativo.cnh_documento_url is None
    assert ativo.nome == "João Ativo" and ativo.cpf == "222.222.222-22"


def test_lgpd_erro_nao_vaza_detalhe_interno(client, ambiente_lgpd, monkeypatch):
    estab, _, _, func_admin = ambiente_lgpd

    def _quebra(*args, **kwargs):
        raise RuntimeError("detalhe interno: senha do banco xyz")

    monkeypatch.setattr(db.session, "commit", _quebra)
    resp = client.post("/api/lgpd/delete", json={"confirmacao": "EXCLUIR_DADOS_LGPD"},
                       headers={"Authorization": f"Bearer {_token_admin(estab, func_admin)}"})
    assert resp.status_code == 500
    assert "xyz" not in resp.get_data(as_text=True)
