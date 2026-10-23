"""Ativação de conta e redefinição de senha por link de uso único (e-mail sem senha)."""
from datetime import date, timedelta
from urllib.parse import urlparse, parse_qs

from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Funcionario, TokenSenha, allow_all_tenants, db, utcnow
from app.services import acesso_conta_service, email_service

SENHA_ADMIN_TESTE = "SecurePass123!"


def _super_admin(session):
    estab = Estabelecimento.query.first()
    sa = Funcionario(
        estabelecimento_id=estab.id, nome="Global Admin", username="super_test", email="super@test.com",
        role="admin", is_super_admin=True, cpf="00011122233", data_nascimento=date(1980, 1, 1),
        celular="92900000000", cargo="CTO", data_admissao=date(2024, 1, 1),
    )
    sa.set_password("pass")
    session.add(sa)
    session.commit()
    token = create_access_token(identity=str(sa.id), additional_claims={
        "is_super_admin": True, "estabelecimento_id": sa.estabelecimento_id, "role": "admin", "status": "ativo"})
    return {"Authorization": f"Bearer {token}"}


def _capturar_emails(monkeypatch, enviado=True):
    caixa = []

    def fake(destino, assunto, corpo_html, corpo_texto):
        caixa.append({"to": destino, "assunto": assunto, "html": corpo_html, "texto": corpo_texto})
        return enviado

    monkeypatch.setattr(acesso_conta_service, "enviar_email_transacional", fake)
    return caixa


def _onboarding(client, headers, **extra):
    payload = {
        "nome_fantasia": "Capraro Teste", "razao_social": "Capraro Teste LTDA", "cnpj": "46986429000109",
        "telefone": "11952881844", "email_estabelecimento": "loja@capraro.test", "nome_admin": "Vera Moreti",
        "email_admin": "vera@capraro.test", "cpf_admin": "14825377882", "plano": "trial", "trial_dias": 30,
    }
    payload.update(extra)
    return client.post("/api/saas/onboarding", json=payload, headers=headers)


def _token_do_link(link):
    return parse_qs(urlparse(link).query)["token"][0]


def test_onboarding_sem_senha_envia_link_de_ativacao_sem_senha(client, session, monkeypatch):
    monkeypatch.setenv("APP_URL", "https://app.exemplo.test/")
    caixa = _capturar_emails(monkeypatch)
    r = _onboarding(client, _super_admin(session))
    assert r.status_code == 201, r.get_json()
    ativacao = r.get_json()["data"]["ativacao"]
    assert ativacao["email_enviado"] is True
    assert ativacao["link_ativacao"].startswith("https://app.exemplo.test/definir-senha?token=")
    assert r.get_json()["data"]["acesso"]["url_acesso"] == "https://app.exemplo.test/login"

    assert len(caixa) == 1 and caixa[0]["to"] == "vera@capraro.test"
    assert ativacao["link_ativacao"].replace("&", "&amp;") in caixa[0]["html"]
    assert ativacao["link_ativacao"] in caixa[0]["texto"]
    assert "senha:" not in caixa[0]["texto"].lower()

    token = _token_do_link(ativacao["link_ativacao"])
    with allow_all_tenants():
        registros = TokenSenha.query.all()
    assert len(registros) == 1 and registros[0].finalidade == "ativacao"
    assert registros[0].token_hash != token and token not in registros[0].token_hash


def test_ativar_conta_pelo_link_e_entrar(client, session, monkeypatch):
    _capturar_emails(monkeypatch)
    r = _onboarding(client, _super_admin(session), senha_admin=SENHA_ADMIN_TESTE)
    token = _token_do_link(r.get_json()["data"]["ativacao"]["link_ativacao"])

    info = client.get(f"/api/auth/senha/token/{token}")
    assert info.status_code == 200
    assert info.get_json()["nome"] == "Vera" and info.get_json()["loja"] == "Capraro Teste"
    assert info.get_json()["finalidade"] == "ativacao"

    fraca = client.post("/api/auth/senha/definir", json={"token": token, "nova_senha": "abcdefgh"})
    assert fraca.status_code == 400 and "números" in fraca.get_json()["error"]

    ok = client.post("/api/auth/senha/definir", json={"token": token, "nova_senha": "Capraro2026"})
    assert ok.status_code == 200 and ok.get_json()["username"] == "vera"

    with allow_all_tenants():
        admin = Funcionario.query.filter_by(email="vera@capraro.test").first()
        assert admin.check_password("Capraro2026") and not admin.check_password(SENHA_ADMIN_TESTE)

    # Uso único: o mesmo link não vale mais.
    assert client.get(f"/api/auth/senha/token/{token}").status_code == 400
    assert client.post("/api/auth/senha/definir", json={"token": token, "nova_senha": "Outra2026x"}).status_code == 400

    # O app context dos testes é compartilhado: limpar o tenant do request do super admin.
    from flask import g
    for chave in list(g):
        g.pop(chave, None)
    login = client.post("/api/auth/login", json={"username": "vera", "password": "Capraro2026"})
    assert login.status_code == 200 and login.get_json().get("access_token"), login.get_json()


def test_link_expirado_e_token_inexistente_sao_recusados(client, session, monkeypatch):
    _capturar_emails(monkeypatch)
    r = _onboarding(client, _super_admin(session))
    token = _token_do_link(r.get_json()["data"]["ativacao"]["link_ativacao"])
    with allow_all_tenants():
        registro = TokenSenha.query.first()
        registro.expira_em = utcnow() - timedelta(minutes=1)
        db.session.commit()
    assert client.get(f"/api/auth/senha/token/{token}").status_code == 400
    assert client.get("/api/auth/senha/token/nao-existe").status_code == 400


def test_reenviar_acesso_invalida_link_anterior(client, session, monkeypatch):
    caixa = _capturar_emails(monkeypatch, enviado=False)
    headers = _super_admin(session)
    r = _onboarding(client, headers)
    primeiro = _token_do_link(r.get_json()["data"]["ativacao"]["link_ativacao"])
    estab_id = r.get_json()["data"]["estabelecimento"]["id"]

    novo = client.post(f"/api/saas/tenants/{estab_id}/enviar-acesso", headers=headers)
    assert novo.status_code == 200, novo.get_json()
    corpo = novo.get_json()
    assert corpo["email_enviado"] is False and "copie o link" in corpo["message"]
    segundo = _token_do_link(corpo["link_ativacao"])

    assert len(caixa) == 2
    assert client.get(f"/api/auth/senha/token/{primeiro}").status_code == 400
    assert client.get(f"/api/auth/senha/token/{segundo}").status_code == 200


def test_enviar_acesso_exige_super_admin(client, session):
    estab = Estabelecimento.query.first()
    admin = Funcionario.query.filter_by(estabelecimento_id=estab.id).first()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    r = client.post(f"/api/saas/tenants/{estab.id}/enviar-acesso", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_esqueci_senha_nao_revela_email_e_envia_link(client, session, monkeypatch):
    caixa = _capturar_emails(monkeypatch)
    desconhecido = client.post("/api/auth/password/reset-request", json={"email": "ninguem@exemplo.test"})
    admin = Funcionario.query.first()
    conhecido = client.post("/api/auth/password/reset-request", json={"email": admin.email.upper()})

    assert desconhecido.status_code == conhecido.status_code == 200
    assert desconhecido.get_json()["message"] == conhecido.get_json()["message"]
    assert len(caixa) == 1 and caixa[0]["to"] == admin.email
    assert "60 minutos" in caixa[0]["texto"]
    with allow_all_tenants():
        assert TokenSenha.query.filter_by(funcionario_id=admin.id, finalidade="redefinicao").count() == 1


def test_envio_transacional_via_resend(app, monkeypatch):
    chamadas = []

    class Resposta:
        status_code = 200

    def fake_post(url, headers, json, timeout):
        chamadas.append({"url": url, "headers": headers, "json": json})
        return Resposta()

    import requests
    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setenv("RESEND_API_KEY", "re_teste")
    monkeypatch.setenv("EMAIL_FROM", "MercadinhoSys <acesso@exemplo.test>")
    with app.app_context():
        assert email_service.enviar_email_transacional("a@b.test", "Assunto", "<p>x</p>", "x") is True
    assert chamadas[0]["url"] == "https://api.resend.com/emails"
    assert chamadas[0]["headers"]["Authorization"] == "Bearer re_teste"
    assert chamadas[0]["json"]["to"] == ["a@b.test"] and chamadas[0]["json"]["text"] == "x"

    monkeypatch.delenv("EMAIL_FROM")
    monkeypatch.setattr(email_service, "_resolve_mail_setting", lambda key, default=None: default)
    with app.app_context():
        assert email_service.enviar_email_transacional("a@b.test", "Assunto", "<p>x</p>", "x") is False
        monkeypatch.delenv("RESEND_API_KEY")
        assert email_service.enviar_email_transacional("a@b.test", "Assunto", "<p>x</p>", "x") is False
    assert len(chamadas) == 1


def test_templates_escapam_html_e_nao_tem_senha():
    from app.services.email_templates import email_ativacao_conta, email_redefinir_senha
    assunto, corpo, texto = email_ativacao_conta("<b>Vera</b> Moreti", "Loja <script>", "https://x.test/definir-senha?token=a&b", 72)
    assert "<script>" not in corpo and "&lt;script&gt;" in corpo
    assert "token=a&amp;b" in corpo and "72 horas" in texto
    _, corpo2, texto2 = email_redefinir_senha("Vera", "https://x.test/definir-senha?token=z", 60)
    assert "Criar nova senha" in corpo2 and "60 minutos" in texto2
