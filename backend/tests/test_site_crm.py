"""Rastreio do site público e CRM de leads do super admin."""
import uuid
from datetime import date

from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Funcionario, Lead, LeadHistorico, SiteAcesso, SiteEvento, SiteVisitante, db

UA = {"User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile"}


def _super_admin(session):
    estab = Estabelecimento.query.first()
    sa = Funcionario(
        estabelecimento_id=estab.id, nome="Rafael", username="super_crm", email="super-crm@test.com",
        role="admin", is_super_admin=True, cpf="00011122244", data_nascimento=date(1980, 1, 1),
        celular="11900000000", cargo="CEO", data_admissao=date(2024, 1, 1),
    )
    sa.set_password("pass")
    session.add(sa)
    session.commit()
    token = create_access_token(identity=str(sa.id), additional_claims={
        "is_super_admin": True, "estabelecimento_id": sa.estabelecimento_id, "role": "admin", "status": "ativo", "nome": "Rafael"})
    return {"Authorization": f"Bearer {token}"}


def _lote(visitante, sessao, **extra):
    corpo = {
        "visitante": visitante, "sessao": sessao, "dispositivo": "Mobile",
        "origem_primeira": {"utm_source": "panfleto", "utm_campaign": "porta-a-porta", "entrada": "/"},
        "acessos": [
            {"rota": "/", "utm_source": "panfleto", "utm_campaign": "porta-a-porta", "duracao_seg": 40, "rolagem_pct": 80},
            {"rota": "/sistema-para-tabacaria", "duracao_seg": 95, "rolagem_pct": 100},
        ],
        "eventos": [
            {"rota": "/", "evento": "segmento", "rotulo": "tabacaria"},
            {"rota": "/sistema-para-tabacaria", "evento": "demo_aba", "rotulo": "estoque"},
            {"rota": "/sistema-para-tabacaria", "evento": "whatsapp", "rotulo": "topo"},
            {"rota": "/", "evento": "nao-existe"},
        ],
    }
    corpo.update(extra)
    return corpo


def test_coleta_grava_visitante_acessos_e_eventos(client, session):
    v, s = str(uuid.uuid4()), str(uuid.uuid4())
    r = client.post("/api/site/coletar", json=_lote(v, s), headers=UA)
    assert r.status_code == 204, r.get_data(as_text=True)
    assert db.session.get(SiteVisitante, v).origem_primeira["utm_source"] == "panfleto"
    assert SiteAcesso.query.filter_by(visitante_id=v).count() == 2
    assert SiteEvento.query.filter_by(visitante_id=v).count() == 3  # evento desconhecido é descartado


def test_coleta_recusa_lixo_robo_e_equipe(client, session):
    assert client.post("/api/site/coletar", json={"visitante": "x", "sessao": "y"}, headers=UA).status_code == 400

    v, s = str(uuid.uuid4()), str(uuid.uuid4())
    client.post("/api/site/coletar", json=_lote(v, s), headers={"User-Agent": "Googlebot/2.1"})
    assert db.session.get(SiteVisitante, v) is None

    v2 = str(uuid.uuid4())
    client.post("/api/site/coletar", json=_lote(v2, s, interno=True), headers=UA)
    assert db.session.get(SiteVisitante, v2).interno is True
    assert SiteAcesso.query.filter_by(visitante_id=v2).count() == 0

    v3 = str(uuid.uuid4())
    longa = {"rota": "/" + "a" * 5000, "duracao_seg": 99999999, "rolagem_pct": 900}
    client.post("/api/site/coletar", json=_lote(v3, s, acessos=[longa], eventos=[]), headers=UA)
    acesso = SiteAcesso.query.filter_by(visitante_id=v3).one()
    assert len(acesso.rota) == 300 and acesso.duracao_seg == 21600 and acesso.rolagem_pct == 100


def test_lead_do_site_herda_origem_e_jornada(client, session):
    headers = _super_admin(session)
    v, s = str(uuid.uuid4()), str(uuid.uuid4())
    client.post("/api/site/coletar", json=_lote(v, s), headers=UA)

    r = client.post("/api/saas/leads/registrar", json={
        "nome": "Joana", "email": "joana@tabacaria.test", "whatsapp": "11988887777",
        "visitante_id": v, "segmento": "tabacaria"}, headers=UA)
    assert r.status_code == 201, r.get_data(as_text=True)
    lead = Lead.query.filter_by(email="joana@tabacaria.test").one()
    assert lead.origem_primeira["utm_source"] == "panfleto" and lead.segmento == "tabacaria"

    detalhe = client.get(f"/api/saas/crm/leads/{lead.id}", headers=headers).get_json()
    tipos = [j["tipo"] for j in detalhe["jornada"]]
    assert tipos.count("pagina") == 2 and tipos.count("acao") == 3


def test_crm_porta_a_porta_etapas_e_historico(client, session):
    headers = _super_admin(session)
    r = client.post("/api/saas/crm/leads", json={
        "nome": "Seu Zé", "nome_loja": "Moto Peças do Zé", "segmento": "moto-pecas",
        "bairro": "Pimentas", "cidade": "Guarulhos", "whatsapp": "11977776666",
        "proximo_contato": date.today().isoformat()}, headers=headers)
    assert r.status_code == 201, r.get_data(as_text=True)
    lead_id = r.get_json()["data"]["id"]
    assert r.get_json()["data"]["origem"] == "porta_a_porta"

    assert client.patch(f"/api/saas/crm/leads/{lead_id}", json={"etapa": "voando"}, headers=headers).status_code == 400
    r = client.patch(f"/api/saas/crm/leads/{lead_id}", json={"etapa": "demonstracao", "valor_mensal": "99,90"}, headers=headers)
    assert r.status_code == 200 and r.get_json()["data"]["valor_mensal"] == 99.9
    client.post(f"/api/saas/crm/leads/{lead_id}/historico", json={"tipo": "contato", "texto": "Visitei a loja, gostou do caixa."}, headers=headers)

    textos = [h.texto for h in LeadHistorico.query.filter_by(lead_id=lead_id).all()]
    assert "novo → demonstracao" in textos and "Visitei a loja, gostou do caixa." in textos

    lista = client.get("/api/saas/crm/leads?busca=Pimentas", headers=headers).get_json()
    assert [l["id"] for l in lista["data"]] == [lead_id]
    assert lista["por_etapa"]["demonstracao"] == 1 and lista["contatos_hoje"] == 1


def test_resumo_do_site_conta_por_sessao(client, session):
    headers = _super_admin(session)
    v, s = str(uuid.uuid4()), str(uuid.uuid4())
    client.post("/api/site/coletar", json=_lote(v, s), headers=UA)
    client.post("/api/site/coletar", json=_lote(v, s, acessos=[], origem_primeira=None), headers=UA)  # mesma sessão de novo

    r = client.get("/api/saas/crm/site/resumo?dias=7", headers=headers)
    assert r.status_code == 200, r.get_data(as_text=True)
    resumo = r.get_json()
    assert resumo["totais"]["visitantes"] == 1 and resumo["totais"]["sessoes"] == 1
    funil = {f["etapa"]: f["sessoes"] for f in resumo["funil"]}
    assert funil["Mexeram na demonstração"] == 1 and funil["Chamaram no WhatsApp ou cadastraram"] == 1
    assert resumo["origens"][0]["origem"] == "panfleto"


def test_crm_e_so_do_super_admin(client, session):
    estab = Estabelecimento.query.first()
    dono = Funcionario.query.filter_by(estabelecimento_id=estab.id).first()
    token = create_access_token(identity=str(dono.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    r = client.get("/api/saas/crm/leads", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (401, 403)


def test_demo_em_vitrine_gratuita_ve_modulos_do_pro(client, session):
    est = Estabelecimento(
        nome_fantasia="Moto Vitrine", razao_social="Moto Vitrine LTDA", cnpj="77888999000111", telefone="11999999999",
        email="moto@vitrine.test", data_abertura=date(2020, 1, 1), cep="07000-000", logradouro="Rua A", numero="1",
        bairro="Centro", cidade="Guarulhos", estado="SP", plano="Gratuito", plano_status="ativo", ativo=True,
    )
    db.session.add(est)
    db.session.commit()
    dados = client.post("/api/auth/demo", json={"segmento": "moto-pecas"}).get_json()["data"]
    r = client.get("/api/vendas/", headers={"Authorization": f"Bearer {dados['access_token']}"})
    assert r.status_code != 403 or "PLAN_RESTRICTED" not in r.get_data(as_text=True)
