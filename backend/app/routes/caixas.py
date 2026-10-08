from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.decorators.plan_guards import permission_required
from app import db
from app.models import Caixa, MovimentacaoCaixa, Estabelecimento, Funcionario, Auditoria
from app.utils.sale_validation import number

caixas_bp = Blueprint("caixas", __name__)

@caixas_bp.route("/atual", methods=["GET"])
@jwt_required()
@permission_required('gestao_caixa')
def obter_caixa_atual():
    """Retorna o caixa atualmente aberto para o funcionário logado"""
    try:
        user_id = int(get_jwt_identity())
        
        caixa = Caixa.query.filter_by(
            funcionario_id=user_id,
            status="aberto"
        ).order_by(Caixa.data_abertura.desc()).first()

        if not caixa:
            return jsonify({"success": True, "data": None}), 200

        return jsonify({"success": True, "data": caixa.to_dict()}), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao obter caixa atual: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@caixas_bp.route("/abrir", methods=["POST"])
@jwt_required()
@permission_required('gestao_caixa')
def abrir_caixa():
    """Abre um novo caixa para o funcionário logado"""
    try:
        user_id = int(get_jwt_identity())
        data = request.get_json()
        try:
            saldo_inicial = number((data or {}).get('saldo_inicial', 0), 'Saldo inicial')
        except ValueError as error:
            return jsonify({'success': False, 'error': str(error)}), 400
        observacoes = data.get("observacoes", "")

        funcionario = Funcionario.query.get(user_id)
        if not funcionario:
            return jsonify({"success": False, "error": "Funcionário não encontrado"}), 404

        # Verificar se já existe caixa aberto
        caixa_existente = Caixa.query.filter_by(
            funcionario_id=user_id,
            status="aberto"
        ).first()

        if caixa_existente:
            return jsonify({
                "success": False, 
                "error": "Você já possui um caixa em aberto. Feche-o antes de abrir um novo."
            }), 400

        # Gerar número de caixa simples
        numero_caixa = f"CX-{datetime.now().strftime('%Y%m%d%H%M%S')}-{user_id}"

        novo_caixa = Caixa(
            estabelecimento_id=funcionario.estabelecimento_id,
            funcionario_id=user_id,
            numero_caixa=numero_caixa,
            saldo_inicial=saldo_inicial,
            saldo_atual=saldo_inicial,
            status="aberto",
            observacoes=observacoes
        )

        db.session.add(novo_caixa)
        db.session.flush() # Manter na transação sem commitar

        # Registrar a abertura como movimentação inicial
        if saldo_inicial > 0:
            mov = MovimentacaoCaixa(
                caixa_id=novo_caixa.id,
                estabelecimento_id=novo_caixa.estabelecimento_id,
                tipo="abertura",
                valor=saldo_inicial,
                forma_pagamento="DINHEIRO",
                descricao="Saldo Inicial (Abertura de Caixa)",
                observacoes="Lançamento automático de abertura"
            )
            db.session.add(mov)

        Auditoria.registrar(
            estabelecimento_id=novo_caixa.estabelecimento_id,
            tipo_evento="caixa_aberto",
            descricao=f"Caixa {numero_caixa} aberto com saldo inicial R$ {saldo_inicial:.2f}",
            usuario_id=user_id, valor=saldo_inicial,
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Caixa aberto com sucesso",
            "data": novo_caixa.to_dict()
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao abrir caixa: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@caixas_bp.route("/fechar", methods=["POST"])
@jwt_required()
@permission_required('gestao_caixa')
def fechar_caixa():
    """Fecha o caixa atual do funcionário"""
    try:
        user_id = int(get_jwt_identity())
        data = request.get_json()
        # Valor que o operador contou no caixa
        try:
            valor_informado = float(number((data or {}).get('valor_informado', 0), 'Valor contado'))
        except ValueError as error:
            return jsonify({'success': False, 'error': str(error)}), 400
        observacoes_fechamento = data.get("observacoes", "")

        caixa = Caixa.query.filter_by(
            funcionario_id=user_id,
            status="aberto"
        ).order_by(Caixa.data_abertura.desc()).populate_existing().with_for_update().first()

        if not caixa:
            return jsonify({"success": False, "error": "Nenhum caixa aberto encontrado"}), 404

        # ─── Cálculo do Saldo Final (Regra de Negócio Sprint 08) ───────────
        # Fórmula: saldo_inicial + entradas - saídas
        # Entradas = Vendas (todas) + Suprimentos
        # Saídas = Sangrias
        
        movimentacoes = MovimentacaoCaixa.query.filter_by(caixa_id=caixa.id).all()
        from collections import defaultdict
        totais_por_forma = defaultdict(lambda: {"quantidade": 0, "total": 0.0})
        total_sangrias = 0.0
        total_suprimentos = 0.0
        total_vendas = 0.0

        for m in movimentacoes:
            valor_mov = float(m.valor or 0)
            tipo_mov = m.tipo.lower()
            if tipo_mov in ('venda', 'estorno'):
                if tipo_mov == 'estorno':
                    valor_mov = -valor_mov
                forma = str(m.forma_pagamento or "outros").lower()
                totais_por_forma[forma]["quantidade"] += 1 if tipo_mov == 'venda' else -1
                totais_por_forma[forma]["total"] += valor_mov
                total_vendas += valor_mov
            elif tipo_mov == "sangria":
                total_sangrias += valor_mov
            elif tipo_mov == "suprimento":
                total_suprimentos += valor_mov

        # ─── Cálculo Final do Dinheiro (Gaveta Física) ───
        # Apenas as vendas em dinheiro entram no cálculo físico da gaveta
        vendas_dinheiro = totais_por_forma["dinheiro"]["total"]
        entradas_dinheiro = vendas_dinheiro + total_suprimentos
        saidas = total_sangrias
        saldo_calculado = float(caixa.saldo_inicial) + entradas_dinheiro - saidas

        # Diferença entre o informado (físico) e o saldo_calculado da GAVETA (dinheiro real)
        # Importante: A quebra de caixa é baseada no que REALMENTE deveria estar na gaveta (Dinheiro)
        diferenca_gaveta = valor_informado - saldo_calculado

        caixa.status = "fechado"
        caixa.data_fechamento = datetime.now()
        caixa.saldo_final = saldo_calculado # Armazenamos o calculado da gaveta conforme solicitado
        caixa.observacoes = (caixa.observacoes or "") + f"\n[FECHAMENTO] Calculado Gaveta: {saldo_calculado:.2f} | Informado Gaveta: {valor_informado:.2f} | Diferença: {diferenca_gaveta:.2f}"

        # Registrar movimentacao de fechamento
        mov = MovimentacaoCaixa(
            caixa_id=caixa.id,
            estabelecimento_id=caixa.estabelecimento_id,
            tipo="fechamento",
            valor=valor_informado,
            descricao="Fechamento de Caixa (Conferência Física)",
            observacoes=f"Saldo Calculado Total: {saldo_calculado:.2f}"
        )
        db.session.add(mov)

        Auditoria.registrar(
            estabelecimento_id=caixa.estabelecimento_id,
            tipo_evento="caixa_fechado",
            descricao=f"Caixa {caixa.numero_caixa} fechado. Calculado R$ {saldo_calculado:.2f} | Gaveta R$ {valor_informado:.2f} | Diferença R$ {diferenca_gaveta:.2f}",
            usuario_id=user_id, valor=valor_informado,
            detalhes={"saldo_calculado": round(saldo_calculado, 2),
                      "valor_informado": valor_informado,
                      "diferenca": round(diferenca_gaveta, 2)},
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Caixa fechado com sucesso",
            "data": {
                "id": caixa.id,
                "status": caixa.status,
                "saldo_final_calculado": round(saldo_calculado, 2),
                "saldo_final_informado": valor_informado,
                "diferenca_balanço": round(valor_informado - saldo_calculado, 2)
            },
            "resumo_fechamento": {
                "saldo_inicial": float(caixa.saldo_inicial),
                "entradas": round(entradas_dinheiro, 2),
                "saidas": round(saidas, 2),
                "saldo_final": round(saldo_calculado, 2),
                "quebra_gaveta": round(diferenca_gaveta, 2),
                "por_forma_pagamento": dict(totais_por_forma)
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao fechar caixa: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@caixas_bp.route("/movimentacao", methods=["POST"])
@jwt_required()
@permission_required('gestao_caixa')
def registrar_movimentacao():
    """Registra uma Sangria ou Suprimento"""
    try:
        user_id = int(get_jwt_identity())
        data = request.get_json()
        tipo = data.get("tipo") # "sangria" ou "suprimento"
        try:
            valor = float(number(data.get('valor', 0), 'Movimentação', positive=True))
        except ValueError as error:
            return jsonify({'success': False, 'error': str(error)}), 400
        descricao = data.get("descricao", "")
        observacoes = data.get("observacoes", "")
        forma_pagamento = data.get("forma_pagamento", "DINHEIRO")

        if tipo not in ["sangria", "suprimento"]:
            return jsonify({"success": False, "error": "Tipo inválido. Use 'sangria' ou 'suprimento'"}), 400

        if valor <= 0:
            return jsonify({"success": False, "error": "O valor deve ser maior que zero"}), 400

        caixa = Caixa.query.filter_by(
            funcionario_id=user_id,
            status="aberto"
        ).order_by(Caixa.data_abertura.desc()).populate_existing().with_for_update().first()

        if not caixa:
            return jsonify({"success": False, "error": "Nenhum caixa aberto encontrado"}), 404

        # Regra de Acesso: SANGRIA exige o PIN de segurança da loja (conferência
        # do valor exato junto com o caixa). Suprimento não exige.
        if tipo == "sangria":
            from app.routes.configuracao import autorizar_por_pin
            autorizador = autorizar_por_pin(caixa.estabelecimento_id, data.get("pin"))
            if not autorizador:
                return jsonify({
                    "success": False,
                    "error": "Sangria exige o PIN de segurança de um Admin ou Gerente.",
                    "code": "PIN_REQUIRED",
                }), 403
            # Rastreabilidade: registra quem autorizou a sangria
            autoria = f"Sangria autorizada por {autorizador.nome} (PIN)"
            observacoes = f"{observacoes} | {autoria}" if observacoes else autoria

        mov = MovimentacaoCaixa(
            caixa_id=caixa.id,
            estabelecimento_id=caixa.estabelecimento_id,
            tipo=tipo,
            valor=valor, # mantendo positivo na tabela
            forma_pagamento=forma_pagamento,
            descricao=descricao,
            observacoes=observacoes
        )
        
        # Atualizar saldo atual do caixa
        if tipo == "sangria":
            caixa.saldo_atual = float(caixa.saldo_atual) - valor
        else:
            caixa.saldo_atual = float(caixa.saldo_atual) + valor
            
        db.session.add(mov)
        db.session.commit()

        return jsonify({
            "success": True, 
            "message": "Movimentação registrada com sucesso", 
            "data": mov.to_dict(),
            "saldo_atual": float(caixa.saldo_atual)
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao registrar movimentação de caixa: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@caixas_bp.route("/atual/movimentacoes", methods=["GET"])
@jwt_required()
def obter_movimentacoes_caixa_atual():
    """Retorna as movimentações do caixa atualmente aberto para o funcionário logado"""
    try:
        user_id = int(get_jwt_identity())
        
        caixa = Caixa.query.filter_by(
            funcionario_id=user_id,
            status="aberto"
        ).order_by(Caixa.data_abertura.desc()).first()

        if not caixa:
            return jsonify({"success": False, "error": "Nenhum caixa aberto encontrado"}), 404

        movimentacoes = MovimentacaoCaixa.query.filter_by(
            caixa_id=caixa.id
        ).order_by(MovimentacaoCaixa.created_at.desc()).all()

        return jsonify({
            "success": True, 
            "data": [mov.to_dict() for mov in movimentacoes]
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao obter movimentações do caixa: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@caixas_bp.route("/atual/resumo", methods=["GET"])
@jwt_required()
def obter_resumo_caixa_atual():
    """Retorna o resumo financeiro do turno: totais por forma de pagamento, sangrias e suprimentos"""
    try:
        user_id = int(get_jwt_identity())

        caixa = Caixa.query.filter_by(
            funcionario_id=user_id,
            status="aberto"
        ).order_by(Caixa.data_abertura.desc()).first()

        if not caixa:
            return jsonify({"success": False, "error": "Nenhum caixa aberto encontrado"}), 404

        from app.models import MovimentacaoCaixa
        from collections import defaultdict

        # ─── Normalização de formas de pagamento ──────────────────────────────
        NORMALIZE_MAP = {
            "dinheiro": "dinheiro",
            "cartao_credito": "cartao_credito",
            "cartao_debito": "cartao_debito",
            "pix": "pix",
            "fiado": "fiado",
            "outros": "outros",
        }

        def normalizar_forma(forma_raw: str) -> str:
            if not forma_raw: return "outros"
            # Remove acentos, espaços e converte para minúsculo
            key = str(forma_raw).strip().lower()
            key = key.replace("é", "e").replace("ê", "e").replace("ã", "a").replace("á", "a")
            
            if "credito" in key: return "cartao_credito"
            if "debito" in key: return "cartao_debito"
            if "pix" in key: return "pix"
            if "dinheiro" in key: return "dinheiro"
            if "fiado" in key: return "fiado"
            
            return "outros"

        # Buscar todas as movimentações do caixa atual
        movimentacoes = MovimentacaoCaixa.query.filter_by(caixa_id=caixa.id).all()
        
        totais_por_forma = defaultdict(lambda: {"quantidade": 0, "total": 0.0})
        
        # Inicializar formas fixas
        FORMAS_FIXAS = ["dinheiro", "cartao_debito", "cartao_credito", "pix", "fiado"]
        for f in FORMAS_FIXAS: totais_por_forma[f]

        total_sangrias = 0.0
        total_suprimentos = 0.0
        total_vendas = 0.0

        for m in movimentacoes:
            valor = float(m.valor or 0)
            tipo = m.tipo.lower()
            
            if tipo in ('venda', 'estorno'):
                if tipo == 'estorno':
                    valor = -valor
                forma = normalizar_forma(m.forma_pagamento)
                totais_por_forma[forma]["quantidade"] += 1 if tipo == 'venda' else -1
                totais_por_forma[forma]["total"] += valor
                total_vendas += valor
            elif tipo == "sangria":
                total_sangrias += valor
            elif tipo == "suprimento":
                total_suprimentos += valor
            # 'abertura' e 'fechamento' não entram no cálculo de vendas/sangrias/suprimentos fixos

        # Saldo esperado na gaveta (Dinheiro Inicial + Vendas Dinheiro + Suprimentos - Sangrias)
        vendas_dinheiro = totais_por_forma["dinheiro"]["total"]
        saldo_esperado_gaveta = (
            float(caixa.saldo_inicial or 0) 
            + vendas_dinheiro 
            + total_suprimentos 
            - total_sangrias
        )

        return jsonify({
            "success": True,
            "data": {
                "caixa_id": caixa.id,
                "saldo_inicial": float(caixa.saldo_inicial or 0),
                "saldo_atual": float(caixa.saldo_atual or 0),
                "saldo_esperado_gaveta": round(saldo_esperado_gaveta, 2),
                "total_vendas": round(total_vendas, 2),
                "total_sangrias": round(total_sangrias, 2),
                "total_suprimentos": round(total_suprimentos, 2),
                "por_forma_pagamento": dict(totais_por_forma),
                "data_abertura": caixa.data_abertura.isoformat() if caixa.data_abertura else None,
            }
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao obter resumo do caixa: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
