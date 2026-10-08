"""
Rotas fiscais — MercadinhoSys.

Entrada (compra):
- POST /api/fiscal/entrada/preview     → lê o XML e mostra o que será importado (não grava)
- POST /api/fiscal/entrada/importar    → efetiva a importação (estoque, custo, contas a pagar)
- GET  /api/fiscal/entrada             → lista as notas de entrada já importadas
- GET  /api/fiscal/entrada/<id>/xml    → baixa o XML guardado
"""
from flask import Blueprint, request, jsonify, current_app, Response
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.models import db, NotaFiscalEntrada, DocumentoFiscal, Venda, Estabelecimento
from app.utils.query_helpers import get_authorized_establishment_id
from app.services.fiscal.xml_parser import parse_nfe_xml, XMLNotaError
from app.services.fiscal import entrada_service
from app.services.fiscal import emissao_service
from app.decorators.rbac import resource_required

fiscal_bp = Blueprint("fiscal", __name__)


def _ler_xml_da_request() -> bytes:
    """Aceita XML como arquivo (multipart 'xml'/'file') ou no corpo bruto."""
    if request.files:
        f = request.files.get("xml") or request.files.get("file") or next(iter(request.files.values()), None)
        if f:
            return f.read()
    data = request.get_data() or b""
    if data and b"<" in data[:512]:
        return data
    raise XMLNotaError("Nenhum XML enviado (use multipart 'xml' ou o corpo da requisição).")


@fiscal_bp.route("/entrada/preview", methods=["POST"])
@resource_required('entrada_xml')
def entrada_preview():
    try:
        estab_id = get_authorized_establishment_id()
        if not estab_id or str(estab_id).lower() == 'all':
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400
        xml_bytes = _ler_xml_da_request()
        parsed = parse_nfe_xml(xml_bytes)
        return jsonify({"success": True, "preview": entrada_service.preview(parsed, estab_id)}), 200
    except XMLNotaError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        current_app.logger.error(f"Erro em entrada_preview: {e}")
        return jsonify({"success": False, "error": "Falha ao processar o XML"}), 500


@fiscal_bp.route("/entrada/importar", methods=["POST"])
@resource_required('entrada_xml')
def entrada_importar():
    try:
        estab_id = get_authorized_establishment_id()
        if not estab_id or str(estab_id).lower() == 'all':
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400
        funcionario_id = int(get_jwt_identity())
        xml_bytes = _ler_xml_da_request()
        xml_text = xml_bytes.decode("utf-8", errors="replace")
        parsed = parse_nfe_xml(xml_bytes)
        pedido_id = request.form.get('pedido_id') or request.args.get('pedido_id')
        if pedido_id is not None:
            if not str(pedido_id).isdigit() or int(pedido_id) <= 0:
                raise entrada_service.ImportacaoError('Pedido inválido.')
            pedido_id = int(pedido_id)
        compra_avulsa = (request.form.get('compra_avulsa') or request.args.get('compra_avulsa')) == 'true'
        resultado = entrada_service.importar(parsed, xml_text, estab_id, funcionario_id,
                                            pedido_id=pedido_id, compra_avulsa=compra_avulsa)
        return jsonify({"success": True, "message": "Nota importada com sucesso", "resultado": resultado}), 201
    except (XMLNotaError, entrada_service.ImportacaoError) as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro em entrada_importar: {e}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return jsonify({"success": False, "error": "Falha ao importar a nota"}), 500


@fiscal_bp.route("/entrada", methods=["GET"])
@resource_required('entrada_xml')
def entrada_listar():
    try:
        estab_id = get_authorized_establishment_id()
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 20, type=int)
        q = NotaFiscalEntrada.query.filter_by(estabelecimento_id=estab_id).order_by(
            NotaFiscalEntrada.data_emissao.desc().nullslast(), NotaFiscalEntrada.id.desc()
        )
        pag = q.paginate(page=page, per_page=per_page, error_out=False)
        return jsonify({
            "success": True,
            "notas": [n.to_dict() for n in pag.items],
            "paginacao": {"pagina": pag.page, "total_paginas": pag.pages, "total": pag.total},
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro em entrada_listar: {e}")
        return jsonify({"success": False, "error": "Falha ao listar notas"}), 500


@fiscal_bp.route("/entrada/<int:nota_id>/xml", methods=["GET"])
@resource_required('entrada_xml')
def entrada_xml(nota_id):
    try:
        estab_id = get_authorized_establishment_id()
        nota = NotaFiscalEntrada.query.filter_by(id=nota_id, estabelecimento_id=estab_id).first()
        if not nota or not nota.xml_content:
            return jsonify({"success": False, "error": "Nota ou XML não encontrado"}), 404
        return Response(
            nota.xml_content, mimetype="application/xml",
            headers={"Content-Disposition": f"attachment; filename=NFe-{nota.chave_acesso}.xml"},
        )
    except Exception as e:
        current_app.logger.error(f"Erro em entrada_xml: {e}")
        return jsonify({"success": False, "error": "Falha ao obter XML"}), 500


# ===================== EMISSÃO (saída) — NFC-e =====================

@fiscal_bp.route("/vendas/<int:venda_id>/nfce", methods=["POST"])
@jwt_required()
def emitir_nfce(venda_id):
    try:
        estab_id = get_authorized_establishment_id()
        funcionario_id = int(get_jwt_identity())
        estab = Estabelecimento.query.get(estab_id)
        venda = Venda.query.filter_by(id=venda_id, estabelecimento_id=estab_id).first()
        if not estab or not venda:
            return jsonify({"success": False, "error": "Venda ou estabelecimento não encontrado"}), 404
        doc = emissao_service.emitir_nfce(venda, estab, funcionario_id)
        http = 201 if doc.status in ("autorizado", "processando") else 422
        return jsonify({
            "success": doc.status in ("autorizado", "processando"),
            "documento": doc.to_dict(),
            "message": "NFC-e autorizada" if doc.status == "autorizado" else (doc.motivo_rejeicao or "Em processamento"),
        }), http
    except emissao_service.EmissaoError as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro em emitir_nfce: {e}")
        import traceback; current_app.logger.error(traceback.format_exc())
        return jsonify({"success": False, "error": "Falha ao emitir NFC-e"}), 500


@fiscal_bp.route("/documentos", methods=["GET"])
@jwt_required()
def listar_documentos():
    try:
        estab_id = get_authorized_establishment_id()
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 20, type=int)
        status = request.args.get("status")
        q = DocumentoFiscal.query.filter_by(estabelecimento_id=estab_id)
        if status:
            q = q.filter(DocumentoFiscal.status == status)
        q = q.order_by(DocumentoFiscal.id.desc())
        pag = q.paginate(page=page, per_page=per_page, error_out=False)
        return jsonify({
            "success": True,
            "documentos": [d.to_dict() for d in pag.items],
            "paginacao": {"pagina": pag.page, "total_paginas": pag.pages, "total": pag.total},
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro em listar_documentos: {e}")
        return jsonify({"success": False, "error": "Falha ao listar documentos"}), 500


@fiscal_bp.route("/documentos/<int:doc_id>/cancelar", methods=["POST"])
@jwt_required()
def cancelar_documento(doc_id):
    try:
        estab_id = get_authorized_establishment_id()
        estab = Estabelecimento.query.get(estab_id)
        doc = DocumentoFiscal.query.filter_by(id=doc_id, estabelecimento_id=estab_id).first()
        if not doc or not estab:
            return jsonify({"success": False, "error": "Documento não encontrado"}), 404
        justificativa = (request.get_json() or {}).get("justificativa", "")
        doc = emissao_service.cancelar_nfce(doc, estab, justificativa)
        ok = doc.status == "cancelado"
        return jsonify({
            "success": ok, "documento": doc.to_dict(),
            "message": "NFC-e cancelada" if ok else (doc.motivo_rejeicao or "Falha ao cancelar"),
        }), (200 if ok else 422)
    except emissao_service.EmissaoError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro em cancelar_documento: {e}")
        return jsonify({"success": False, "error": "Falha ao cancelar documento"}), 500
