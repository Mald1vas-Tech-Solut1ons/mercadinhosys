# app/routes/view_schema.py
"""
Endpoints do Motor de Renderização Contextual.

O frontend consome GET /api/view-schema/ e renderiza campos, unidades e KPIs a
partir do schema resolvido (Global → Tenant). Os PUTs gravam o nível Tenant da
cascata: segmento do estabelecimento e overrides de exibição.
"""
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt

from app import db
from app.models import Estabelecimento
from app.services.view_schema_service import (
    FAMILIAS_PRODUTO,
    SEGMENTOS,
    invalidar_cache_view_schema,
    mix_permitido_para_estabelecimento,
    resolver_view_schema,
)
from app.utils.query_helpers import get_authorized_establishment_id

view_schema_bp = Blueprint("view_schema", __name__)

_ROLES_ADMIN = {"admin", "dono"}


def _requer_admin():
    claims = get_jwt()
    role = (claims.get("role") or "").lower()
    if role in _ROLES_ADMIN or claims.get("is_super_admin"):
        return None
    return jsonify({"success": False, "error": "Apenas administradores podem alterar a exibição da loja"}), 403


def _estabelecimento_atual():
    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id or str(estabelecimento_id).lower() == "all":
        return None
    return Estabelecimento.query.get(int(estabelecimento_id))


@view_schema_bp.route("/", methods=["GET"], strict_slashes=False)
@jwt_required()
def obter_view_schema():
    """
    View Schema resolvido para o tenant atual (cascata Global → Tenant).
    Com ?base=1 devolve o nível Global puro do segmento (sem overrides) junto com
    os overrides salvos — é o que a tela de configurações usa para religar campos.
    """
    def _sem_cache(payload, status=200):
        # O schema depende de tenant + família + overrides em tempo real — o
        # navegador nunca pode servir uma resposta antiga do próprio cache HTTP
        # (aconteceu de verdade: trocar de família repetia a mesma URL GET e o
        # Chrome devolvia a resposta anterior sem nem chamar o backend de novo).
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
        return resp, status

    try:
        estabelecimento = _estabelecimento_atual()
        quer_base = request.args.get("base") in ("1", "true")
        familia_produto = request.args.get("familia_produto")
        tipo_item = request.args.get("tipo_item") or "produto"
        if estabelecimento is None:
            # Super admin na visão global: schema por segmento explícito, sem overrides
            schema = resolver_view_schema(
                segmento=request.args.get("segmento"),
                familia_produto=familia_produto,
                tipo_item=tipo_item,
            )
            return _sem_cache({"success": True, "schema": schema})

        if quer_base:
            base = resolver_view_schema(
                segmento=estabelecimento.segmento,
                familia_produto=familia_produto,
                tipo_item=tipo_item,
            )
            overrides = (estabelecimento.configuracoes or {}).get("view_schema") or {}
            overrides = dict(overrides) if isinstance(overrides, dict) else {}
            overrides["mix_produtos"] = (
                (estabelecimento.configuracoes or {}).get("mix_produtos")
                or base.get("mix_permitido")
                or []
            )
            return _sem_cache({"success": True, "schema": base, "overrides": overrides})

        schema = resolver_view_schema(
            estabelecimento,
            familia_produto=familia_produto,
            tipo_item=tipo_item,
        )
        return _sem_cache({"success": True, "schema": schema})
    except Exception as e:
        current_app.logger.error(f"Erro ao resolver view schema: {e}")
        return jsonify({"success": False, "error": "Erro ao resolver o schema de exibição"}), 500


@view_schema_bp.route("/segmentos", methods=["GET"])
@jwt_required()
def listar_segmentos():
    """Catálogo de segmentos disponíveis (para o seletor nas configurações)."""
    segmentos = [
        {"chave": chave, "nome": s["nome"], "descricao": s["descricao"],
         "icone": s["icone"], "flags": s["flags"], "exemplos": s["exemplos"]}
        for chave, s in SEGMENTOS.items()
    ]
    return jsonify({"success": True, "segmentos": segmentos}), 200


@view_schema_bp.route("/segmento", methods=["PUT"])
@jwt_required()
def definir_segmento():
    """Define o segmento do estabelecimento (nível Tenant da cascata)."""
    erro = _requer_admin()
    if erro:
        return erro
    try:
        estabelecimento = _estabelecimento_atual()
        if estabelecimento is None:
            return jsonify({"success": False, "error": "Ação não permitida na visão global (all)."}), 403

        data = request.get_json() or {}
        segmento = (data.get("segmento") or "").lower().strip()
        if segmento not in SEGMENTOS:
            return jsonify({"success": False, "error": f"Segmento inválido: {segmento}"}), 400

        # Trocar de segmento NUNCA tira departamento: a loja fica com o que já vendia + o padrão
        # do segmento novo (antes, ir para "autopeças" deixava só autopeças e serviço).
        mix_vigente = mix_permitido_para_estabelecimento(estabelecimento)
        mix_padrao_novo = mix_permitido_para_estabelecimento(segmento=segmento)
        mix_unido = list(mix_vigente) + [f for f in mix_padrao_novo if f not in mix_vigente]
        estabelecimento.segmento = segmento
        configuracoes = estabelecimento.configuracoes or {}
        if mix_unido != mix_padrao_novo:
            configuracoes["mix_produtos"] = mix_unido
        else:
            configuracoes.pop("mix_produtos", None)
        estabelecimento.configuracoes = configuracoes
        db.session.commit()
        invalidar_cache_view_schema(estabelecimento.id)

        return jsonify({"success": True, "message": "Segmento atualizado",
                        "schema": resolver_view_schema(estabelecimento)}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao definir segmento: {e}")
        return jsonify({"success": False, "error": "Erro ao salvar o segmento"}), 500


@view_schema_bp.route("/overrides", methods=["PUT"])
@jwt_required()
def salvar_overrides():
    """
    Salva os overrides de exibição do tenant (liga/desliga campos e métricas,
    opções customizadas). Persistido em Estabelecimento.configuracoes_json.
    """
    erro = _requer_admin()
    if erro:
        return erro
    try:
        estabelecimento = _estabelecimento_atual()
        if estabelecimento is None:
            return jsonify({"success": False, "error": "Ação não permitida na visão global (all)."}), 403

        data = request.get_json() or {}
        base_padrao = resolver_view_schema(segmento=estabelecimento.segmento)
        mix_padrao = base_padrao.get("mix_permitido") or []
        mix_solicitado = data.get("mix_produtos")
        mix_customizado = None
        if isinstance(mix_solicitado, list):
            mix_customizado = []
            for familia in mix_solicitado:
                chave = str(familia or "").strip().lower()
                if chave in FAMILIAS_PRODUTO and chave not in mix_customizado:
                    mix_customizado.append(chave)

        overrides = {}
        for chave_lista in ("campos_ocultos", "campos_habilitados", "metricas_ocultas",
                            "metricas_habilitadas", "unidades"):
            valor = data.get(chave_lista)
            if isinstance(valor, list):
                overrides[chave_lista] = [str(v)[:50] for v in valor][:100]
        for chave_dict in ("obrigatorios", "opcoes"):
            valor = data.get(chave_dict)
            if isinstance(valor, dict):
                overrides[chave_dict] = valor

        configuracoes = estabelecimento.configuracoes
        configuracoes["view_schema"] = overrides
        if mix_customizado is not None:
            if mix_customizado and mix_customizado != mix_padrao:
                configuracoes["mix_produtos"] = mix_customizado
            else:
                configuracoes.pop("mix_produtos", None)
        estabelecimento.configuracoes = configuracoes
        db.session.commit()
        invalidar_cache_view_schema(estabelecimento.id)

        return jsonify({"success": True, "message": "Exibição atualizada",
                        "schema": resolver_view_schema(estabelecimento)}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao salvar overrides do view schema: {e}")
        return jsonify({"success": False, "error": "Erro ao salvar as preferências de exibição"}), 500
