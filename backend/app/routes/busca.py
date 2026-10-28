"""Busca global (Ctrl+K)."""
from flask import Blueprint, current_app, jsonify, request

from app.decorators.decorator_jwt import funcionario_required
from app.services.busca_service import buscar
from app.utils.query_helpers import get_authorized_establishment_id

busca_bp = Blueprint("busca", __name__)


@busca_bp.route("", methods=["GET"], strict_slashes=False)
@busca_bp.route("/", methods=["GET"], strict_slashes=False)
@funcionario_required
def busca_global():
    estab_id = get_authorized_establishment_id()
    if str(estab_id).lower() == "all":
        return jsonify({"success": False, "error": "Escolha uma loja para buscar."}), 400
    q = request.args.get("q", "")[:120]
    limite = max(1, min(request.args.get("limite", 6, type=int), 20))
    try:
        return jsonify({"success": True, **buscar(estab_id, q, limite)})
    except Exception as erro:
        current_app.logger.error(f"Erro na busca global: {erro}")
        return jsonify({"success": False, "error": "Erro na busca"}), 500
