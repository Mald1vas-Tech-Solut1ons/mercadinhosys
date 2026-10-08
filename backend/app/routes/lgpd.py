"""
Blueprint de Conformidade LGPD - MercadinhoSys

Permite o exercício dos direitos do titular da conta (Lojista) e conformidade com o Art. 16 da LGPD:
- Endpoint POST /api/lgpd/delete para solicitação de anonimização/exclusão de dados pessoais.
- Preserva a integridade dos registros contábeis e fiscais das vendas conforme exigido por legislação tributária.
"""

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from datetime import datetime, timezone
import logging

from app.models import db, Cliente, Funcionario, Estabelecimento, Auditoria
from app.decorators.decorator_jwt import funcionario_required
from app.utils.query_helpers import get_authorized_establishment_id, get_funcionario_safe

lgpd_bp = Blueprint("lgpd", __name__)
logger = logging.getLogger(__name__)


@lgpd_bp.route("/delete", methods=["POST"])
@funcionario_required
def solicitar_exclusao_lgpd():
    """
    Endpoint de Anonimização e Exclusão de Dados Pessoais (LGPD Art. 16).
    
    Requisitos:
    - Requer autenticação de Administrador do Estabelecimento ou SuperAdmin.
    - Requer confirmação explícita no payload: {"confirmacao": "EXCLUIR_DADOS_LGPD"}
    - Anonimiza dados sensíveis de clientes e funcionários inativos,
      mantendo o histórico financeiro intacto para cumprimento de obrigação legal.
    """
    try:
        current_user_id = get_jwt_identity()
        funcionario = get_funcionario_safe(current_user_id)
        claims = get_jwt()
        
        is_super = bool(claims.get("is_super_admin", False))
        is_admin = bool(funcionario and funcionario.get("role") in ["admin", "ADMIN", "GERENTE"]) or is_super
        
        if not is_admin:
            return jsonify({
                "success": False,
                "error": "Acesso negado",
                "message": "Apenas administradores do estabelecimento podem solicitar anonimização LGPD."
            }), 403

        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id or str(estabelecimento_id).lower() == "all":
            return jsonify({
                "success": False,
                "error": "Estabelecimento inválido",
                "message": "Especifique o ID do estabelecimento para prosseguir com o pedido LGPD."
            }), 400

        data = request.get_json() or {}
        confirmacao = data.get("confirmacao")
        if confirmacao != "EXCLUIR_DADOS_LGPD":
            return jsonify({
                "success": False,
                "error": "Confirmação pendente",
                "message": "Para confirmar a exclusão LGPD, envie o campo 'confirmacao': 'EXCLUIR_DADOS_LGPD'."
            }), 400

        # 1. Anonimizar dados de Clientes
        clientes = Cliente.query.filter_by(estabelecimento_id=estabelecimento_id).all()
        cnt_clientes = 0
        for c in clientes:
            c.nome = f"Cliente Anonimizado LGPD #{c.id}"
            # Documento único por registro: CPF/CNPJ têm restrição de unicidade por loja.
            c.cpf = f"ANON{c.id:010d}"
            c.cnpj = None
            c.razao_social = None
            c.inscricao_estadual = None
            c.contato_nome = None
            c.rg = None
            c.data_nascimento = None
            c.observacoes = None
            c.complemento = None
            c.email = f"anon_cliente_{c.id}@lgpd.local"
            c.telefone = "(00) 00000-0000"
            c.celular = "(00) 00000-0000"
            c.logradouro = "Anonimizado"
            c.numero = "S/N"
            c.bairro = "Anonimizado"
            c.cidade = "Anonimizado"
            c.cep = "00000-000"
            cnt_clientes += 1

        # 2. Anonimizar Funcionários Inativos (exclui o próprio solicitante)
        funcionarios_inativos = Funcionario.query.filter(
            Funcionario.estabelecimento_id == estabelecimento_id,
            Funcionario.id != current_user_id,
            Funcionario.ativo == False
        ).all()
        cnt_func = 0
        for f in funcionarios_inativos:
            f.nome = f"Ex-Funcionário Anonimizado #{f.id}"
            f.cpf = f"ANON{f.id:010d}"
            f.email = f"anon_func_{f.id}@lgpd.local"
            f.telefone = "(00) 00000-0000"
            f.celular = "(00) 00000-0000"
            cnt_func += 1

        # 2.1 Motoristas inativos: CPF, CNH, contatos e documentos digitalizados
        from app.models import Motorista
        motoristas_inativos = Motorista.query.filter(
            Motorista.estabelecimento_id == estabelecimento_id,
            Motorista.ativo == False
        ).all()
        cnt_motoristas = 0
        for m in motoristas_inativos:
            m.nome = f"Ex-Motorista Anonimizado #{m.id}"
            m.cpf = f"ANON{m.id:010d}"
            m.rg = None
            m.cnh = f"ANON{m.id:010d}"
            m.telefone = "(00) 00000-0000"
            m.celular = "(00) 00000-0000"
            m.email = None
            m.foto_url = None
            m.cnh_documento_url = None
            cnt_motoristas += 1

        # 3. Registrar Log de Auditoria LGPD
        auditoria_log = Auditoria(
            estabelecimento_id=estabelecimento_id,
            usuario_id=current_user_id,
            tipo_evento="LGPD_EXCLUSAO_DADOS",
            descricao=f"Solicitação de anonimização/exclusão LGPD executada para o estabelecimento {estabelecimento_id}",
            detalhes_json={
                "modulo": "LGPD",
                "clientes_anonimizados": cnt_clientes,
                "funcionarios_anonimizados": cnt_func,
                "motoristas_anonimizados": cnt_motoristas,
            },
            data_evento=datetime.now(timezone.utc)
        )
        db.session.add(auditoria_log)
        db.session.commit()

        logger.info(f"🛡️ Anonimização LGPD concluída para o estabelecimento {estabelecimento_id} por usuário {current_user_id}")

        return jsonify({
            "success": True,
            "message": "Dados pessoais anonimizados com sucesso em conformidade com a LGPD.",
            "estatisticas": {
                "estabelecimento_id": estabelecimento_id,
                "clientes_anonimizados": cnt_clientes,
                "funcionarios_anonimizados": cnt_func,
                "motoristas_anonimizados": cnt_motoristas,
                "historico_financeiro_preservado": True,
                "executado_em": datetime.now(timezone.utc).isoformat()
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Erro ao processar requisição LGPD delete: {e}")
        return jsonify({
            "success": False,
            "error": "Erro interno",
            "message": "Falha ao executar o procedimento LGPD; nada foi alterado. Tente novamente ou contate o suporte."
        }), 500
