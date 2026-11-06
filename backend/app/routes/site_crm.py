"""Rastreio do site público e CRM de leads do super admin.

Coleta (`/api/site/coletar`, público): o navegador só envia quando o visitante aceitou
cookies de medição (BannerCookies). Nada de nome, telefone ou IP: o visitante é um UUID
do aparelho. Robôs e aparelhos da equipe (`?interno=1`) não contam. Tudo é validado e
cortado aqui: telemetria pública não pode virar porta para lixo no banco.

CRM (`/api/saas/crm/...`, super admin): leads com etapa do funil, histórico, próximo
contato e a jornada do visitante no site antes de virar lead. Os números do resumo são
contados no servidor, por sessão (abrir o WhatsApp duas vezes é uma pessoa, não duas).
"""
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt

from app.decorators.decorator_jwt import super_admin_required
from app.middleware.rate_limit import limiter
from app.models import (
    LEAD_ETAPAS, SITE_EVENTOS, Lead, LeadHistorico, SiteAcesso, SiteEvento, SiteVisitante, db,
)
from app.utils.timezone import iso_utc, hoje_local

site_bp = Blueprint("site", __name__)
crm_bp = Blueprint("crm", __name__)

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
ROBO = re.compile(r"bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|puppeteer|playwright|facebookexternalhit|whatsapp|bingpreview", re.I)
MAX_ACESSOS, MAX_EVENTOS = 30, 60
DURACAO_MAXIMA = 6 * 60 * 60


def _agora():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _texto(valor, limite):
    if valor is None:
        return None
    texto = str(valor).strip()
    return texto[:limite] or None


def _inteiro(valor, minimo, maximo):
    try:
        numero = int(valor)
    except (TypeError, ValueError):
        return None
    return max(minimo, min(maximo, numero))


def _toque(valor):
    """Origem do visitante (utm, referrer, página de entrada): só chaves conhecidas, textos curtos."""
    if not isinstance(valor, dict):
        return None
    chaves = ("utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer", "entrada", "em")
    limpo = {k: _texto(valor.get(k), 200) for k in chaves if valor.get(k)}
    return limpo or None


# ============================================================ coleta pública
@site_bp.route("/coletar", methods=["POST"])
@limiter.limit("60 per minute")
def coletar():
    if ROBO.search(request.headers.get("User-Agent", "")):
        return "", 204
    dados = request.get_json(silent=True) or {}
    visitante_id = str(dados.get("visitante") or "")
    sessao_id = str(dados.get("sessao") or "")
    if not UUID.match(visitante_id) or not UUID.match(sessao_id):
        return jsonify({"success": False, "error": "identificação inválida"}), 400

    agora = _agora()
    visitante = db.session.get(SiteVisitante, visitante_id)
    if visitante is None:
        visitante = SiteVisitante(id=visitante_id, criado_em=agora)
        db.session.add(visitante)
    visitante.visto_em = agora
    visitante.dispositivo = _texto(dados.get("dispositivo"), 20) or visitante.dispositivo
    if isinstance(dados.get("interno"), bool):
        visitante.interno = dados["interno"]
    primeira, ultima = _toque(dados.get("origem_primeira")), _toque(dados.get("origem_ultima"))
    if primeira and not visitante.origem_primeira:
        visitante.origem_primeira = primeira
    if ultima:
        visitante.origem_ultima = ultima

    # Equipe (?interno=1) não entra nos números: só o aparelho fica marcado.
    if not visitante.interno:
        for a in (dados.get("acessos") or [])[:MAX_ACESSOS]:
            rota = _texto(a.get("rota"), 300) if isinstance(a, dict) else None
            if not rota or not rota.startswith("/"):
                continue
            db.session.add(SiteAcesso(
                visitante_id=visitante_id, sessao_id=sessao_id, rota=rota,
                referrer=_texto(a.get("referrer"), 300),
                utm_source=_texto(a.get("utm_source"), 120), utm_medium=_texto(a.get("utm_medium"), 120),
                utm_campaign=_texto(a.get("utm_campaign"), 120),
                dispositivo=visitante.dispositivo,
                duracao_seg=_inteiro(a.get("duracao_seg"), 0, DURACAO_MAXIMA),
                rolagem_pct=_inteiro(a.get("rolagem_pct"), 0, 100),
                criado_em=agora,
            ))
        for e in (dados.get("eventos") or [])[:MAX_EVENTOS]:
            if not isinstance(e, dict) or e.get("evento") not in SITE_EVENTOS:
                continue
            rota = _texto(e.get("rota"), 300)
            if not rota or not rota.startswith("/"):
                continue
            db.session.add(SiteEvento(
                visitante_id=visitante_id, sessao_id=sessao_id, rota=rota,
                evento=e["evento"], rotulo=_texto(e.get("rotulo"), 120), criado_em=agora,
            ))
    db.session.commit()
    return "", 204


def vincular_visitante(lead, visitante_id):
    """Liga o lead ao aparelho que navegou no site (origem e jornada passam a aparecer no CRM)."""
    if not visitante_id or not UUID.match(str(visitante_id)):
        return
    visitante = db.session.get(SiteVisitante, str(visitante_id))
    lead.visitante_id = str(visitante_id)
    if visitante:
        lead.origem_primeira = lead.origem_primeira or visitante.origem_primeira
        lead.origem_ultima = visitante.origem_ultima or lead.origem_ultima
        db.session.flush()
        visitante.lead_id = lead.id


def registrar_historico(lead_id, tipo, texto, autor=None):
    db.session.add(LeadHistorico(lead_id=lead_id, tipo=tipo, texto=texto[:2000], autor=autor))


# ============================================================ CRM (super admin)
def _autor():
    try:
        claims = get_jwt()
        return claims.get("nome") or claims.get("username") or "super admin"
    except Exception:
        return "super admin"


def _data(valor):
    if not valor:
        return None
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError:
        return None


def _valor(valor):
    if valor in (None, ""):
        return None
    try:
        return Decimal(str(valor).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


CAMPOS_EDITAVEIS = {
    "nome": 150, "email": 100, "whatsapp": 30, "nome_loja": 150, "segmento": 60,
    "cidade": 80, "bairro": 80, "motivo_perda": 200, "observacao": 5000,
}


def _aplicar(lead, dados):
    for campo, limite in CAMPOS_EDITAVEIS.items():
        if campo in dados:
            setattr(lead, campo, _texto(dados.get(campo), limite) or ("" if campo in ("email", "whatsapp") else None))
    if "proximo_contato" in dados:
        lead.proximo_contato = _data(dados.get("proximo_contato"))
    if "valor_mensal" in dados:
        lead.valor_mensal = _valor(dados.get("valor_mensal"))


@crm_bp.route("/leads", methods=["GET"])
@super_admin_required
def listar_leads_crm():
    consulta = Lead.query
    etapa = request.args.get("etapa")
    if etapa in LEAD_ETAPAS:
        consulta = consulta.filter(Lead.etapa == etapa)
    busca = (request.args.get("busca") or "").strip()
    if busca:
        termo = f"%{busca}%"
        consulta = consulta.filter(db.or_(Lead.nome.ilike(termo), Lead.nome_loja.ilike(termo),
                                          Lead.whatsapp.ilike(termo), Lead.email.ilike(termo),
                                          Lead.bairro.ilike(termo), Lead.cidade.ilike(termo)))
    leads = consulta.order_by(Lead.data_cadastro.desc()).limit(1000).all()
    por_etapa = Counter((l.etapa or "novo") for l in Lead.query.with_entities(Lead.etapa).all())
    hoje = hoje_local()
    return jsonify({
        "success": True,
        "etapas": list(LEAD_ETAPAS),
        "por_etapa": {e: por_etapa.get(e, 0) for e in LEAD_ETAPAS},
        "contatos_hoje": sum(1 for l in leads if l.proximo_contato and l.proximo_contato <= hoje and l.etapa not in ("cliente", "perdido")),
        "data": [l.to_dict() for l in leads],
    })


@crm_bp.route("/leads", methods=["POST"])
@super_admin_required
def criar_lead_crm():
    """Lead cadastrado à mão (porta a porta, indicação, telefone)."""
    dados = request.get_json(silent=True) or {}
    if not _texto(dados.get("nome"), 150) and not _texto(dados.get("nome_loja"), 150):
        return jsonify({"success": False, "error": "Informe o nome do contato ou da loja."}), 400
    lead = Lead(nome=_texto(dados.get("nome"), 150) or _texto(dados.get("nome_loja"), 150),
                email="", whatsapp="", origem=_texto(dados.get("origem"), 100) or "porta_a_porta")
    etapa = dados.get("etapa")
    lead.etapa = etapa if etapa in LEAD_ETAPAS else "novo"
    _aplicar(lead, dados)
    db.session.add(lead)
    db.session.flush()
    registrar_historico(lead.id, "sistema", f"Lead cadastrado ({lead.origem}).", _autor())
    db.session.commit()
    return jsonify({"success": True, "data": lead.to_dict()}), 201


@crm_bp.route("/leads/<int:lead_id>", methods=["GET"])
@super_admin_required
def detalhe_lead(lead_id):
    lead = db.session.get(Lead, lead_id)
    if not lead:
        return jsonify({"success": False, "error": "Lead não encontrado"}), 404
    historico = LeadHistorico.query.filter_by(lead_id=lead_id).order_by(LeadHistorico.criado_em.desc()).all()
    jornada = []
    if lead.visitante_id:
        acessos = SiteAcesso.query.filter_by(visitante_id=lead.visitante_id).order_by(SiteAcesso.criado_em).limit(300).all()
        eventos = SiteEvento.query.filter_by(visitante_id=lead.visitante_id).order_by(SiteEvento.criado_em).limit(300).all()
        jornada = sorted(
            [{"tipo": "pagina", "rota": a.rota, "duracao_seg": a.duracao_seg, "rolagem_pct": a.rolagem_pct,
              "origem": a.utm_source or a.referrer, "em": iso_utc(a.criado_em)} for a in acessos]
            + [{"tipo": "acao", "rota": e.rota, "evento": e.evento, "rotulo": e.rotulo, "em": iso_utc(e.criado_em)} for e in eventos],
            key=lambda x: x["em"] or "",
        )
    return jsonify({"success": True, "data": lead.to_dict(),
                    "historico": [h.to_dict() for h in historico], "jornada": jornada})


@crm_bp.route("/leads/<int:lead_id>", methods=["PATCH"])
@super_admin_required
def atualizar_lead(lead_id):
    lead = db.session.get(Lead, lead_id)
    if not lead:
        return jsonify({"success": False, "error": "Lead não encontrado"}), 404
    dados = request.get_json(silent=True) or {}
    autor = _autor()
    etapa = dados.get("etapa")
    if etapa is not None:
        if etapa not in LEAD_ETAPAS:
            return jsonify({"success": False, "error": "Etapa inválida"}), 400
        if etapa != lead.etapa:
            registrar_historico(lead.id, "etapa", f"{lead.etapa or 'novo'} → {etapa}", autor)
            lead.etapa = etapa
    _aplicar(lead, dados)
    db.session.commit()
    return jsonify({"success": True, "data": lead.to_dict()})


@crm_bp.route("/leads/<int:lead_id>/historico", methods=["POST"])
@super_admin_required
def anotar_lead(lead_id):
    lead = db.session.get(Lead, lead_id)
    if not lead:
        return jsonify({"success": False, "error": "Lead não encontrado"}), 404
    dados = request.get_json(silent=True) or {}
    texto = _texto(dados.get("texto"), 2000)
    if not texto:
        return jsonify({"success": False, "error": "Escreva a anotação."}), 400
    tipo = dados.get("tipo") if dados.get("tipo") in ("nota", "contato") else "nota"
    registrar_historico(lead.id, tipo, texto, _autor())
    lead.atualizado_em = _agora()
    db.session.commit()
    return jsonify({"success": True}), 201


def _origem_de(acesso):
    if acesso.utm_source:
        return acesso.utm_source.lower()
    if acesso.referrer:
        host = urlparse(acesso.referrer if "://" in acesso.referrer else f"https://{acesso.referrer}").netloc.lower()
        host = host.removeprefix("www.").removeprefix("m.").removeprefix("l.").removeprefix("lm.")
        if "google." in host:
            return "google"
        if "facebook." in host or "instagram." in host:
            return host.split(".")[0]
        return host or "direto"
    return "direto"


@crm_bp.route("/site/resumo", methods=["GET"])
@super_admin_required
def resumo_site():
    dias = _inteiro(request.args.get("dias", 30), 1, 365) or 30
    inicio = _agora() - timedelta(days=dias)
    internos = {v.id for v in SiteVisitante.query.filter_by(interno=True).with_entities(SiteVisitante.id).all()}
    acessos = [a for a in SiteAcesso.query.filter(SiteAcesso.criado_em >= inicio).limit(200000).all() if a.visitante_id not in internos]
    eventos = [e for e in SiteEvento.query.filter(SiteEvento.criado_em >= inicio).limit(200000).all() if e.visitante_id not in internos]

    sessoes_por_origem = {}
    for a in sorted(acessos, key=lambda x: x.criado_em):
        sessoes_por_origem.setdefault(a.sessao_id, _origem_de(a))  # origem = a da primeira página da sessão

    por_dia = defaultdict(lambda: {"acessos": 0, "visitantes": set()})
    for a in acessos:
        dia = (a.criado_em - timedelta(hours=3)).date().isoformat()  # dia de São Paulo
        por_dia[dia]["acessos"] += 1
        por_dia[dia]["visitantes"].add(a.visitante_id)

    paginas = defaultdict(lambda: {"views": 0, "duracoes": [], "rolagens": []})
    for a in acessos:
        p = paginas[a.rota]
        p["views"] += 1
        if a.duracao_seg:
            p["duracoes"].append(a.duracao_seg)
        if a.rolagem_pct is not None:
            p["rolagens"].append(a.rolagem_pct)

    media = lambda lista: round(sum(lista) / len(lista)) if lista else None  # noqa: E731
    sessoes = {a.sessao_id for a in acessos} | {e.sessao_id for e in eventos}
    sessoes_nicho = {a.sessao_id for a in acessos if a.rota.startswith("/sistema-para")}
    sessoes_demo = {e.sessao_id for e in eventos if e.evento.startswith("demo")}
    sessoes_contato = {e.sessao_id for e in eventos if e.evento in ("whatsapp", "cadastro", "formulario_enviado")}
    leads_periodo = Lead.query.filter(Lead.data_cadastro >= inicio).all()

    return jsonify({
        "success": True,
        "dias": dias,
        "totais": {
            "visitantes": len({a.visitante_id for a in acessos}),
            "sessoes": len(sessoes),
            "paginas_vistas": len(acessos),
            "duracao_media_seg": media([a.duracao_seg for a in acessos if a.duracao_seg]),
            "rolagem_media_pct": media([a.rolagem_pct for a in acessos if a.rolagem_pct is not None]),
            "cliques_whatsapp": sum(1 for e in eventos if e.evento == "whatsapp"),
            "leads": len(leads_periodo),
        },
        "funil": [
            {"etapa": "Visitaram o site", "sessoes": len(sessoes)},
            {"etapa": "Viram um segmento ou região", "sessoes": len(sessoes_nicho)},
            {"etapa": "Mexeram na demonstração", "sessoes": len(sessoes_demo)},
            {"etapa": "Chamaram no WhatsApp ou cadastraram", "sessoes": len(sessoes_contato)},
            {"etapa": "Viraram lead", "sessoes": len(leads_periodo)},
        ],
        "por_dia": [{"dia": d, "acessos": v["acessos"], "visitantes": len(v["visitantes"])} for d, v in sorted(por_dia.items())],
        "origens": [{"origem": o, "sessoes": n} for o, n in Counter(sessoes_por_origem.values()).most_common(10)],
        "campanhas": [{"campanha": c, "acessos": n} for c, n in Counter(a.utm_campaign for a in acessos if a.utm_campaign).most_common(10)],
        "paginas": sorted(
            [{"rota": r, "views": p["views"], "duracao_media_seg": media(p["duracoes"]), "rolagem_media_pct": media(p["rolagens"])}
             for r, p in paginas.items()],
            key=lambda x: -x["views"],
        )[:20],
        "eventos": [{"evento": ev, "total": n} for ev, n in Counter(e.evento for e in eventos).most_common()],
        "segmentos_clicados": [{"segmento": s, "total": n} for s, n in Counter(e.rotulo for e in eventos if e.evento == "segmento" and e.rotulo).most_common(11)],
        "dispositivos": [{"dispositivo": d or "?", "acessos": n} for d, n in Counter(a.dispositivo for a in acessos).most_common()],
        "leads_por_origem": [{"origem": o or "?", "leads": n} for o, n in Counter(l.origem for l in leads_periodo).most_common()],
    })
