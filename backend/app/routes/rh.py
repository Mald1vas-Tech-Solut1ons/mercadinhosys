from datetime import timezone
# app/routes/rh.py
# Módulo de RH - Justificativas de ponto e Benefícios de funcionários

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import get_jwt, jwt_required
from datetime import datetime, date
from decimal import Decimal
import os
import uuid

from app.models import (
    db,
    Funcionario,
    Beneficio,
    FuncionarioBeneficio,
    JustificativaPonto,
)
from app.decorators.decorator_jwt import funcionario_required, gerente_ou_admin_required
from app.decorators.plan_guards import plan_required
from app.dashboard_cientifico.data_layer import DataLayer

rh_bp = Blueprint("rh", __name__)


def _usuario_atual():
    """Funcionário logado (via JWT)."""
    from flask_jwt_extended import get_jwt_identity
    uid = get_jwt_identity()
    return Funcionario.query.get(int(uid)) if uid else None


def _pode_ver_tudo_rh(funcionario):
    """Regra de Acesso: só Admin (1), Gerente (2) e RH (3) veem dados de RH de
    TODOS os funcionários; os demais níveis só veem os próprios (self-service)."""
    if funcionario is None:
        return False
    from app.decorators.rbac import _get_nivel
    return _get_nivel(funcionario) <= 3


# ============================================
# DASHBOARD RH
# ============================================


@rh_bp.route("/dashboard", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def rh_dashboard():
    """
    Retorna métricas específicas para o Dashboard de RH.
    Acesso completo: Admin, Gerente e RH (demais níveis não veem o dashboard).
    """
    try:
        if not _pode_ver_tudo_rh(_usuario_atual()):
            return jsonify({
                "success": False,
                "message": "Apenas Admin, Gerente ou RH acessam o dashboard de RH",
            }), 403
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        days = request.args.get("days", default=30, type=int)

        # Validar days
        if days < 1: days = 1
        if days > 365: days = 365

        # Obter métricas usando a camada de dados existente
        metrics = DataLayer.get_rh_metrics(estabelecimento_id, days)

        return jsonify({
            "success": True,
            "data": metrics,
            "period_days": days
        })

    except Exception as e:
        current_app.logger.error(f"Erro no dashboard de RH: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


# ============================================
# JUSTIFICATIVAS DE PONTO
# ============================================


@rh_bp.route("/justificativas", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def listar_justificativas():
    """Lista justificativas de ponto com filtros e paginação."""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        # Paginação
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = min(request.args.get("por_pagina", 50, type=int), 200)

        query = JustificativaPonto.query.filter_by(
            estabelecimento_id=estabelecimento_id
        )

        # Filtros opcionais
        funcionario_id = request.args.get("funcionario_id")

        # Self-service: quem não é Admin/Gerente/RH só vê as próprias justificativas
        usuario = _usuario_atual()
        if not _pode_ver_tudo_rh(usuario):
            funcionario_id = usuario.id if usuario else -1
        tipo = request.args.get("tipo")
        status = request.args.get("status")
        data_inicio = request.args.get("data_inicio")
        data_fim = request.args.get("data_fim")

        if funcionario_id:
            query = query.filter(JustificativaPonto.funcionario_id == funcionario_id)
        if tipo:
            query = query.filter(JustificativaPonto.tipo == tipo)
        if status:
            query = query.filter(JustificativaPonto.status == status)
        if data_inicio:
            query = query.filter(
                JustificativaPonto.data >= datetime.strptime(data_inicio, "%Y-%m-%d").date()
            )
        if data_fim:
            query = query.filter(
                JustificativaPonto.data <= datetime.strptime(data_fim, "%Y-%m-%d").date()
            )

        # Resumo agregado ANTES da paginação (sem carregar todos os objetos)
        total = query.count()
        from sqlalchemy import func as sqlfunc
        resumo_query = db.session.query(
            JustificativaPonto.status,
            sqlfunc.count(JustificativaPonto.id)
        ).filter(
            JustificativaPonto.estabelecimento_id == estabelecimento_id
        )
        if funcionario_id:
            resumo_query = resumo_query.filter(JustificativaPonto.funcionario_id == funcionario_id)
        resumo_raw = resumo_query.group_by(JustificativaPonto.status).all()
        resumo = {r[0]: r[1] for r in resumo_raw}

        paginacao = query.order_by(JustificativaPonto.created_at.desc()).paginate(
            page=pagina, per_page=por_pagina, error_out=False
        )

        return jsonify({
            "success": True,
            "data": [j.to_dict() for j in paginacao.items],
            "total": total,
            "pagina": pagina,
            "por_pagina": por_pagina,
            "total_paginas": paginacao.pages,
            "resumo": {
                "pendentes": resumo.get("pendente", 0),
                "aprovados": resumo.get("aprovado", 0),
                "rejeitados": resumo.get("rejeitado", 0),
            },
        })

    except Exception as e:
        current_app.logger.error(f"Erro ao listar justificativas: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/justificativas", methods=["POST"])
@funcionario_required
@plan_required('Pro')
def criar_justificativa():
    """Cria uma nova justificativa de ponto."""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        # Suporta tanto JSON quanto multipart/form-data
        if request.content_type and "multipart/form-data" in request.content_type:
            funcionario_id = request.form.get("funcionario_id")
            tipo = request.form.get("tipo")
            data_str = request.form.get("data")
            motivo = request.form.get("motivo")
            documento = request.files.get("documento")
        else:
            data = request.get_json()
            funcionario_id = data.get("funcionario_id")
            tipo = data.get("tipo")
            data_str = data.get("data")
            motivo = data.get("motivo")
            documento = None

        if not all([funcionario_id, tipo, data_str, motivo]):
            return jsonify({
                "success": False,
                "message": "Campos obrigatórios: funcionario_id, tipo, data, motivo",
            }), 400

        # Self-service: quem não é Admin/Gerente/RH só justifica o PRÓPRIO ponto
        usuario = _usuario_atual()
        if not _pode_ver_tudo_rh(usuario) and int(funcionario_id) != (usuario.id if usuario else -1):
            return jsonify({
                "success": False,
                "message": "Você só pode enviar justificativas do seu próprio ponto",
            }), 403

        # Salvar documento se enviado (atestado, foto de pneu furado, etc.)
        documento_url = None
        if documento:
            from werkzeug.utils import secure_filename

            EXTENSOES_PERMITIDAS = {"pdf", "jpg", "jpeg", "png"}
            TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024  # 5MB

            extensao = (documento.filename or "").rsplit(".", 1)[-1].lower() if "." in (documento.filename or "") else ""
            if extensao not in EXTENSOES_PERMITIDAS:
                return jsonify({
                    "success": False,
                    "message": "Formato de documento inválido. Envie PDF, JPG ou PNG.",
                }), 400

            documento.stream.seek(0, os.SEEK_END)
            tamanho = documento.stream.tell()
            documento.stream.seek(0)
            if tamanho > TAMANHO_MAXIMO_BYTES:
                return jsonify({
                    "success": False,
                    "message": "Documento muito grande. Tamanho máximo: 5MB.",
                }), 400

            nome_seguro = secure_filename(documento.filename) or f"documento.{extensao}"
            filename = f"just_{funcionario_id}_{data_str}_{uuid.uuid4().hex[:8]}_{nome_seguro}"

            # Atestados permanecem no volume privado, servidos com autorização.
            if not documento_url:
                # Fallback local
                documento.seek(0)
                upload_dir = os.path.join(current_app.config.get("UPLOAD_FOLDER", "uploads"), "justificativas")
                os.makedirs(upload_dir, exist_ok=True)
                filepath = os.path.join(upload_dir, filename)
                documento.save(filepath)
                documento_url = f"/uploads/justificativas/{filename}"

        justificativa = JustificativaPonto(
            estabelecimento_id=estabelecimento_id,
            funcionario_id=int(funcionario_id),
            tipo=tipo,
            data=datetime.strptime(data_str, "%Y-%m-%d").date(),
            motivo=motivo,
            documento_url=documento_url,
            status="pendente",
        )

        db.session.add(justificativa)
        db.session.commit()

        return jsonify({
            "success": True,
            "data": justificativa.to_dict(),
            "message": "Justificativa criada com sucesso",
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao criar justificativa: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/justificativas/<int:justificativa_id>/responder", methods=["PUT"])
@funcionario_required
@plan_required('Pro')
def responder_justificativa(justificativa_id):
    """Aprova ou rejeita uma justificativa (apenas gerente/admin)."""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        usuario = _usuario_atual()
        if not _pode_ver_tudo_rh(usuario):
            return jsonify({
                "success": False,
                "message": "Apenas Admin, Gerente ou RH podem responder justificativas",
            }), 403
        user_id = usuario.id if usuario else None

        justificativa = JustificativaPonto.query.filter_by(
            id=justificativa_id,
            estabelecimento_id=estabelecimento_id,
        ).first()

        if not justificativa:
            return jsonify({"success": False, "message": "Justificativa não encontrada"}), 404

        data = request.get_json()
        acao = data.get("acao")  # 'aprovar' ou 'rejeitar'

        if acao == "aprovar":
            justificativa.status = "aprovado"
        elif acao == "rejeitar":
            justificativa.status = "rejeitado"
            justificativa.motivo_rejeicao = data.get("motivo_rejeicao", "")
        else:
            return jsonify({"success": False, "message": "Ação deve ser 'aprovar' ou 'rejeitar'"}), 400

        justificativa.aprovador_id = user_id
        justificativa.data_resposta = datetime.now(timezone.utc)

        db.session.commit()

        return jsonify({
            "success": True,
            "data": justificativa.to_dict(),
            "message": f"Justificativa {justificativa.status} com sucesso",
        })

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao responder justificativa: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


# ============================================
# BENEFÍCIOS
# ============================================


@rh_bp.route("/beneficios", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def listar_beneficios():
    """Lista benefícios atribuídos a funcionários."""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        funcionario_id = request.args.get("funcionario_id")
        ativo = request.args.get("ativo")

        # Self-service: quem não é Admin/Gerente/RH só vê os próprios benefícios
        usuario = _usuario_atual()
        if not _pode_ver_tudo_rh(usuario):
            funcionario_id = usuario.id if usuario else -1

        query = db.session.query(FuncionarioBeneficio).join(
            Beneficio, FuncionarioBeneficio.beneficio_id == Beneficio.id
        ).join(
            Funcionario, FuncionarioBeneficio.funcionario_id == Funcionario.id
        ).filter(
            Beneficio.estabelecimento_id == estabelecimento_id
        )

        if funcionario_id:
            query = query.filter(FuncionarioBeneficio.funcionario_id == funcionario_id)
        if ativo is not None:
            query = query.filter(FuncionarioBeneficio.ativo == (ativo in ("true", "True", "1")))

        registros = query.all()

        result = []
        for fb in registros:
            result.append({
                "id": fb.id,
                "funcionario_id": fb.funcionario_id,
                "funcionario_nome": fb.funcionario.nome if fb.funcionario else None,
                "funcionario_cargo": fb.funcionario.cargo if fb.funcionario else None,
                "beneficio_id": fb.beneficio_id,
                "nome_beneficio": fb.beneficio.nome if fb.beneficio else None,
                "descricao": fb.beneficio.descricao if fb.beneficio else None,
                "tipo": fb.beneficio.nome.lower().replace(" ", "_") if fb.beneficio else None,
                "valor_mensal": float(fb.valor) if fb.valor else 0.0,
                "data_inicio": fb.data_inicio.isoformat() if fb.data_inicio else None,
                "ativo": fb.ativo,
            })

        return jsonify({
            "success": True,
            "data": result,
            "total": len(result),
        })

    except Exception as e:
        current_app.logger.error(f"Erro ao listar benefícios: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/beneficios", methods=["POST"])
@funcionario_required
@plan_required('Pro')
def criar_beneficio_funcionario():
    """Atribui um benefício a um funcionário."""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        # Atribuir benefício é gestão de RH — não é self-service
        usuario = _usuario_atual()
        if not _pode_ver_tudo_rh(usuario):
            return jsonify({
                "success": False,
                "message": "Apenas Admin, Gerente ou RH podem atribuir benefícios",
            }), 403

        data = request.get_json()
        funcionario_id = data.get("funcionario_id")
        nome_beneficio = data.get("nome_beneficio")
        valor_mensal = data.get("valor_mensal", 0)
        data_inicio = data.get("data_inicio")

        beneficio_id = data.get("beneficio_id")

        if not funcionario_id or (not nome_beneficio and not beneficio_id):
            return jsonify({
                "success": False,
                "message": "Campos obrigatórios: funcionario_id, beneficio_id (ou nome_beneficio)",
            }), 400

        beneficio = None
        if beneficio_id:
            beneficio = Beneficio.query.filter_by(
                id=beneficio_id,
                estabelecimento_id=estabelecimento_id
            ).first()
        
        # Fallback para o antigo (por nome_beneficio) se não tiver beneficio_id
        if not beneficio and nome_beneficio:
            beneficio = Beneficio.query.filter_by(
                estabelecimento_id=estabelecimento_id,
                nome=nome_beneficio,
            ).first()

            if not beneficio:
                beneficio = Beneficio(
                    estabelecimento_id=estabelecimento_id,
                    nome=nome_beneficio,
                    descricao=data.get("observacao", ""),
                    valor_padrao=Decimal(str(valor_mensal)) if valor_mensal else Decimal("0"),
                    ativo=True,
                )
                db.session.add(beneficio)
                db.session.flush()
                
        if not beneficio:
            return jsonify({
                "success": False,
                "message": "Benefício não encontrado no catálogo",
            }), 404

        fb = FuncionarioBeneficio(
            funcionario_id=int(funcionario_id),
            beneficio_id=beneficio.id,
            valor=Decimal(str(valor_mensal)) if valor_mensal else Decimal("0"),
            data_inicio=datetime.strptime(data_inicio, "%Y-%m-%d").date() if data_inicio else date.today(),
            ativo=True,
        )
        db.session.add(fb)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Benefício atribuído com sucesso",
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao criar benefício: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/banco-horas", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def listar_banco_horas():
    """Lista banco de horas dos funcionários com paginação."""
    try:
        from app.models import BancoHoras
        from app.utils.query_helpers import get_authorized_establishment_id
        from sqlalchemy.orm import joinedload

        estabelecimento_id = get_authorized_establishment_id()
        funcionario_id = request.args.get("funcionario_id")
        mes_referencia = request.args.get("mes_referencia")

        # Self-service: quem não é Admin/Gerente/RH só vê o próprio banco de horas
        usuario = _usuario_atual()
        if not _pode_ver_tudo_rh(usuario):
            funcionario_id = usuario.id if usuario else -1

        # Paginação
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = min(request.args.get("por_pagina", 50, type=int), 200)

        # Usar joinedload para evitar N+1 query no bh.funcionario
        query = db.session.query(BancoHoras).join(
            Funcionario, BancoHoras.funcionario_id == Funcionario.id
        ).filter(
            Funcionario.estabelecimento_id == estabelecimento_id
        ).options(joinedload(BancoHoras.funcionario))

        if funcionario_id:
            query = query.filter(BancoHoras.funcionario_id == funcionario_id)
        if mes_referencia:
            query = query.filter(BancoHoras.mes_referencia == mes_referencia)

        total = query.count()
        registros = query.order_by(BancoHoras.mes_referencia.desc()).limit(por_pagina).offset((pagina - 1) * por_pagina).all()

        import math
        total_paginas = math.ceil(total / por_pagina) if total > 0 else 1

        result = []
        for bh in registros:
            saldo_horas = bh.saldo_minutos / 60.0
            result.append({
                "id": bh.id,
                "funcionario_id": bh.funcionario_id,
                "funcionario_nome": bh.funcionario.nome if bh.funcionario else None,
                "funcionario_cargo": bh.funcionario.cargo if bh.funcionario else None,
                "mes_referencia": bh.mes_referencia,
                "saldo_minutos": bh.saldo_minutos,
                "saldo_horas": round(saldo_horas, 1),
                "saldo_formatado": f"{'+' if saldo_horas >= 0 else ''}{saldo_horas:.1f}h",
                "valor_hora_extra": float(bh.valor_hora_extra) if bh.valor_hora_extra else 0,
                "horas_trabalhadas": round(bh.horas_trabalhadas_minutos / 60.0, 1) if bh.horas_trabalhadas_minutos else 0,
                "horas_esperadas": round(bh.horas_esperadas_minutos / 60.0, 1) if bh.horas_esperadas_minutos else 0,
                "status": "positivo" if bh.saldo_minutos > 0 else "negativo" if bh.saldo_minutos < 0 else "zerado",
            })

        return jsonify({
            "success": True,
            "data": result,
            "total": total,
            "pagina": pagina,
            "por_pagina": por_pagina,
            "total_paginas": total_paginas,
        })

    except Exception as e:
        current_app.logger.error(f"Erro ao listar banco de horas: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


# ============================================
# FOLHA — RESCISÃO E PROVISÕES (Admin/Gerente/RH)
# ============================================

def _carregar_funcionario_do_tenant(funcionario_id):
    """Funcionário pertencente ao tenant do usuário logado (ou None)."""
    from app.utils.query_helpers import get_authorized_establishment_id
    estab_id = get_authorized_establishment_id()
    q = Funcionario.query.filter_by(id=funcionario_id)
    if estab_id and str(estab_id).lower() != "all":
        q = q.filter_by(estabelecimento_id=estab_id)
    return q.first()


def _calcular_rescisao_do_payload():
    """Valida o payload e devolve (funcionario, resultado) do cálculo de rescisão."""
    from app.services.rh_calculator_service import calcular_rescisao

    data = request.get_json() or {}
    funcionario_id = data.get("funcionario_id")
    data_demissao = data.get("data_demissao")
    tipo_rescisao = data.get("tipo_rescisao")
    forma_pagamento = data.get("forma_pagamento") or "PIX"
    if not all([funcionario_id, data_demissao, tipo_rescisao]):
        return None, None, ("Campos obrigatórios: funcionario_id, data_demissao, tipo_rescisao", 400)

    funcionario = _carregar_funcionario_do_tenant(funcionario_id)
    if not funcionario:
        return None, None, ("Funcionário não encontrado", 404)

    try:
        data_demissao_obj = datetime.strptime(data_demissao, "%Y-%m-%d").date()
        resultado = calcular_rescisao(
            funcionario, data_demissao_obj, tipo_rescisao,
            saldo_fgts=data.get("saldo_fgts"),
            ferias_vencidas_dias=int(data.get("ferias_vencidas_dias") or 0),
            aviso_cumprido=bool(data.get("aviso_cumprido", False)),
            descontos_adicionais=float(data.get("descontos_adicionais") or 0),
        )
        resultado["forma_pagamento"] = forma_pagamento
    except ValueError as ve:
        return None, None, (str(ve), 400)
    return funcionario, resultado, None


@rh_bp.route("/rescisao/simular", methods=["POST"])
@funcionario_required
@plan_required('Pro')
def simular_rescisao():
    """Calcula as verbas rescisórias SEM gravar (preview para o lojista)."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Apenas Admin, Gerente ou RH podem calcular rescisões"}), 403
    _, resultado, erro = _calcular_rescisao_do_payload()
    if erro:
        return jsonify({"success": False, "message": erro[0]}), erro[1]
    return jsonify({"success": True, "data": resultado}), 200


@rh_bp.route("/rescisao", methods=["POST"])
@funcionario_required
@plan_required('Pro')
def registrar_rescisao():
    """Calcula, GRAVA a rescisão e lança a DESPESA financeira correspondente no módulo de Despesas."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Apenas Admin, Gerente ou RH podem registrar rescisões"}), 403
    funcionario, resultado, erro = _calcular_rescisao_do_payload()
    if erro:
        return jsonify({"success": False, "message": erro[0]}), erro[1]

    try:
        from app.models import Rescisao, FuncionarioBeneficio, Despesa
        data_dem_obj = datetime.strptime(resultado["data_demissao"], "%Y-%m-%d").date()
        forma_pag = resultado.get("forma_pagamento", "PIX")

        # 0. Limpeza prévia: se o colaborador já tinha rescisões anteriores no banco (testes anteriores), remover para manter apenas a última ativa
        rescisoes_antigas = Rescisao.query.filter_by(funcionario_id=funcionario.id).all()
        for ant in rescisoes_antigas:
            if getattr(ant, "despesa_id", None):
                desp_ant = Despesa.query.get(ant.despesa_id)
                if desp_ant:
                    db.session.delete(desp_ant)
            db.session.delete(ant)
        db.session.flush()

        # 1. Lançamento financeiro automático na tabela de Despesas Operacionais com a forma de pagamento selecionada
        valor_despesa = Decimal(str(resultado.get("total_liquido_estimado") or resultado.get("total_proventos") or 0))
        despesa_rescisao = Despesa(
            estabelecimento_id=funcionario.estabelecimento_id,
            descricao=f"Rescisão Trabalhista - {funcionario.nome} ({resultado['tipo_rescisao']})",
            categoria="Rescisão Trabalhista",
            tipo="variavel",
            valor=valor_despesa,
            data_despesa=data_dem_obj,
            data_emissao=data_dem_obj,
            data_vencimento=data_dem_obj,
            forma_pagamento=forma_pag,
            recorrente=False,
            observacoes=f"Lançamento automático de verbas rescisórias da demissão de {funcionario.nome}. Motivo: {resultado['tipo_rescisao']}. Forma de Pagamento: {forma_pag}.",
        )
        db.session.add(despesa_rescisao)
        db.session.flush()

        # 2. Gravação do registro de rescisão no RH vinculado à despesa
        rescisao = Rescisao(
            estabelecimento_id=funcionario.estabelecimento_id,
            funcionario_id=funcionario.id,
            despesa_id=despesa_rescisao.id,
            data_demissao=data_dem_obj,
            tipo_rescisao=resultado["tipo_rescisao"],
            verbas_rescisorias_json=resultado,
            total_proventos=Decimal(str(resultado["total_proventos"])),
            total_descontos=Decimal(str(resultado["total_descontos"])),
            total_liquido=Decimal(str(resultado["total_liquido_estimado"])),
        )
        db.session.add(rescisao)

        # 3. Atualiza cadastro do funcionário para refletir o desligamento de fato
        funcionario.data_demissao = data_dem_obj
        funcionario.ativo = False
        funcionario.status = "demitido"

        # 4. Inativa os benefícios ativos do colaborador
        FuncionarioBeneficio.query.filter_by(
            funcionario_id=funcionario.id,
            ativo=True
        ).update({"ativo": False})

        db.session.commit()
        return jsonify({
            "success": True,
            "data": resultado,
            "rescisao_id": rescisao.id,
            "despesa_id": despesa_rescisao.id,
            "valor_despesa": float(valor_despesa),
            "message": "Rescisão registrada, funcionário desligado e despesa financeira lançada com sucesso"
        }), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao registrar rescisão: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/rescisao/<int:rescisao_id>/cancelar", methods=["POST"])
@funcionario_required
@plan_required('Pro')
def cancelar_rescisao(rescisao_id):
    """Reverte/Cancela uma rescisão registrada, estorna a despesa financeira e reativa o funcionário (Admin/Gerente/RH)."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Apenas Admin, Gerente ou RH podem cancelar rescisões"}), 403

    try:
        from app.models import Rescisao, Funcionario, Despesa
        from app.utils.query_helpers import get_authorized_establishment_id

        estab_id = get_authorized_establishment_id()
        q = Rescisao.query.filter_by(id=rescisao_id)
        if estab_id and str(estab_id).lower() != "all":
            q = q.filter_by(estabelecimento_id=estab_id)
        rescisao = q.first()

        if not rescisao:
            return jsonify({"success": False, "message": "Rescisão não encontrada"}), 404

        funcionario = Funcionario.query.get(rescisao.funcionario_id)
        if funcionario:
            funcionario.data_demissao = None
            funcionario.ativo = True
            funcionario.status = "ativo"

        # Estorno financeiro: exclui a despesa associada de Rescisão Trabalhista
        if getattr(rescisao, "despesa_id", None):
            desp = Despesa.query.get(rescisao.despesa_id)
            if desp:
                db.session.delete(desp)
        elif funcionario:
            # Fallback de limpeza para dados legados por busca de descrição
            desp_legada = Despesa.query.filter(
                Despesa.estabelecimento_id == rescisao.estabelecimento_id,
                Despesa.categoria == "Rescisão Trabalhista",
                Despesa.descricao.like(f"%Rescisão Trabalhista - {funcionario.nome}%")
            ).first()
            if desp_legada:
                db.session.delete(desp_legada)

        db.session.delete(rescisao)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Rescisão e despesa financeira canceladas, e funcionário reativado com sucesso"
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao cancelar rescisão: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


def _garantir_despesas_rescisoes_legadas():
    """Garante retroativamente que todas as rescisões no banco tenham seu lançamento em Despesas com o valor exato, eliminando duplicatas de testes antigos."""
    try:
        from app.models import Rescisao, Despesa
        from collections import defaultdict
        
        todas_rescisoes = Rescisao.query.order_by(Rescisao.id.asc()).all()
        if not todas_rescisoes:
            return
        
        alterou = False

        # 1. Deduplicação por funcionário: se o funcionário possui mais de uma rescisão gravada por testes anteriores,
        # manter apenas a mais recente (ID mais alto) e expurgar as rescisões/despesas obsoletas.
        por_func = defaultdict(list)
        for r in todas_rescisoes:
            por_func[r.funcionario_id].append(r)

        rescisoes_ativas = []
        for fid, lista in por_func.items():
            if len(lista) > 1:
                ultima = lista[-1]
                obsoletas = lista[:-1]
                for obs in obsoletas:
                    if getattr(obs, "despesa_id", None):
                        d_obs = Despesa.query.get(obs.despesa_id)
                        if d_obs:
                            db.session.delete(d_obs)
                    db.session.delete(obs)
                alterou = True
                rescisoes_ativas.append(ultima)
            else:
                rescisoes_ativas.append(lista[0])

        if alterou:
            db.session.flush()

        # 2. Processar a rescisão mais recente de cada colaborador
        for r in rescisoes_ativas:
            nome_func = r.funcionario.nome if r.funcionario else f"Funcionário #{r.funcionario_id}"
            json_data = r.verbas_rescisorias_json or {}
            
            val_liq = json_data.get("total_liquido_estimado") or json_data.get("total_proventos") or r.total_liquido or r.total_proventos or 0
            valor_despesa = Decimal(str(val_liq))
            if valor_despesa <= Decimal("0.00"):
                continue

            desp = None
            if getattr(r, "despesa_id", None):
                desp = Despesa.query.get(r.despesa_id)
            if not desp:
                desp = Despesa.query.filter(
                    Despesa.estabelecimento_id == r.estabelecimento_id,
                    Despesa.categoria == "Rescisão Trabalhista",
                    Despesa.descricao.like(f"%Rescisão Trabalhista - {nome_func}%")
                ).first()

            desc_esperada = f"Rescisão Trabalhista - {nome_func} ({r.tipo_rescisao})"

            if desp:
                # Sincronizar o valor, descrição (modalidade) e o vínculo caso estivessem divergentes
                if (r.despesa_id != desp.id or Decimal(str(desp.valor)) != valor_despesa or desp.descricao != desc_esperada):
                    r.despesa_id = desp.id
                    desp.descricao = desc_esperada
                    desp.valor = valor_despesa
                    desp.data_despesa = r.data_demissao
                    desp.data_vencimento = r.data_demissao
                    alterou = True
            else:
                despesa_rescisao = Despesa(
                    estabelecimento_id=r.estabelecimento_id,
                    descricao=desc_esperada,
                    categoria="Rescisão Trabalhista",
                    tipo="variavel",
                    valor=valor_despesa,
                    data_despesa=r.data_demissao,
                    data_emissao=r.data_demissao,
                    data_vencimento=r.data_demissao,
                    forma_pagamento="PIX",
                    recorrente=False,
                    observacoes=f"Lançamento automático de verbas rescisórias da demissão de {nome_func}. Motivo: {r.tipo_rescisao}.",
                )
                db.session.add(despesa_rescisao)
                db.session.flush()
                r.despesa_id = despesa_rescisao.id
                alterou = True

            if Decimal(str(r.total_liquido or 0)) != valor_despesa:
                r.total_liquido = valor_despesa
                alterou = True

        if alterou:
            db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro no retro-sync de despesas de rescisão: {e}")


@rh_bp.route("/rescisoes", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def listar_rescisoes():
    """Histórico de rescisões registradas, com filtros (Admin/Gerente/RH)."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Sem permissão"}), 403
    try:
        from app.models import Rescisao
        from app.utils.query_helpers import get_authorized_establishment_id

        _garantir_despesas_rescisoes_legadas()
        estab_id = get_authorized_establishment_id()
        q = Rescisao.query
        if estab_id and str(estab_id).lower() != "all":
            q = q.filter(Rescisao.estabelecimento_id == estab_id)

        if request.args.get("funcionario_id"):
            q = q.filter(Rescisao.funcionario_id == request.args.get("funcionario_id", type=int))
        if request.args.get("tipo_rescisao"):
            q = q.filter(Rescisao.tipo_rescisao == request.args.get("tipo_rescisao").upper())
        if request.args.get("data_inicio"):
            q = q.filter(Rescisao.data_demissao >= datetime.strptime(request.args["data_inicio"], "%Y-%m-%d").date())
        if request.args.get("data_fim"):
            q = q.filter(Rescisao.data_demissao <= datetime.strptime(request.args["data_fim"], "%Y-%m-%d").date())

        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = min(request.args.get("por_pagina", 50, type=int), 200)
        pag = q.order_by(Rescisao.data_demissao.desc(), Rescisao.id.desc()).paginate(
            page=pagina, per_page=por_pagina, error_out=False)

        itens = []
        for r in pag.items:
            itens.append({
                "id": r.id,
                "funcionario_id": r.funcionario_id,
                "funcionario_nome": r.funcionario.nome if r.funcionario else None,
                "cargo": r.funcionario.cargo if r.funcionario else None,
                "data_demissao": r.data_demissao.isoformat() if r.data_demissao else None,
                "tipo_rescisao": r.tipo_rescisao,
                "total_liquido": float(r.total_liquido or 0),
                "registrada_em": r.created_at.isoformat() if r.created_at else None,
                "detalhe": r.verbas_rescisorias_json,
            })
        return jsonify({
            "success": True, "data": itens,
            "total": pag.total, "pagina": pagina, "total_paginas": pag.pages,
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao listar rescisões: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/configuracao-folha", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def obter_configuracao_folha():
    """Parâmetros de folha da loja (Admin/Gerente/RH). Cria defaults se faltar."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Sem permissão"}), 403
    from app.services.rh_calculator_service import obter_config_folha
    from app.utils.query_helpers import get_authorized_establishment_id
    estab_id = get_authorized_establishment_id()
    cfg = obter_config_folha(estab_id)
    return jsonify({"success": True, "data": cfg.to_dict()}), 200


@rh_bp.route("/configuracao-folha", methods=["PUT"])
@funcionario_required
@plan_required('Pro')
def atualizar_configuracao_folha():
    """Atualiza os parâmetros de folha (apenas Admin/Gerente)."""
    from app.decorators.rbac import _get_nivel
    usuario = _usuario_atual()
    if not usuario or _get_nivel(usuario) > 2:
        return jsonify({"success": False, "message": "Apenas Admin ou Gerente alteram a folha"}), 403
    from app.services.rh_calculator_service import obter_config_folha
    from app.utils.query_helpers import get_authorized_establishment_id

    estab_id = get_authorized_establishment_id()
    cfg = obter_config_folha(estab_id)
    data = request.get_json() or {}

    numericos = ["divisor_horas_mensais", "percentual_hora_extra", "percentual_adicional_noturno",
                 "fgts_percentual", "multa_fgts_dispensa", "multa_fgts_acordo",
                 "desconto_vt_percentual", "deducao_por_dependente"]
    for campo in numericos:
        if campo in data and data[campo] is not None:
            try:
                setattr(cfg, campo, Decimal(str(data[campo])) if campo != "divisor_horas_mensais" else int(data[campo]))
            except (ValueError, TypeError):
                return jsonify({"success": False, "message": f"Valor inválido para {campo}"}), 400
    for tabela in ("inss_faixas", "irrf_faixas"):
        if tabela in data and isinstance(data[tabela], list):
            setattr(cfg, tabela, data[tabela])

    try:
        db.session.commit()
        return jsonify({"success": True, "data": cfg.to_dict(), "message": "Parâmetros de folha atualizados"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao salvar config folha: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/holerite", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def holerite_funcionario():
    """Holerite de um funcionário (gestão). Self só o próprio; ver de outro
    exige Admin/Gerente/RH."""
    from app.decorators.rbac import _get_nivel
    from app.services.rh_calculator_service import calcular_holerite

    usuario = _usuario_atual()
    if not usuario:
        return jsonify({"success": False, "message": "Funcionário não encontrado"}), 404
    alvo_id = request.args.get("funcionario_id", type=int) or usuario.id
    if alvo_id != usuario.id and _get_nivel(usuario) > 3:
        return jsonify({"success": False, "message": "Você só pode ver o próprio holerite"}), 403
    alvo = _carregar_funcionario_do_tenant(alvo_id)
    if not alvo:
        return jsonify({"success": False, "message": "Funcionário não encontrado"}), 404

    mes_referencia = request.args.get("mes_referencia") or date.today().strftime("%Y-%m")
    try:
        return jsonify({"success": True, "data": calcular_holerite(alvo, mes_referencia)}), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao calcular holerite: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/retrospectiva", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def retrospectiva():
    """Retrospectiva (Wrapped) do funcionário. Self-service: por padrão a
    PRÓPRIA; ver a de outro exige Admin/Gerente/RH."""
    from app.decorators.rbac import _get_nivel
    from app.services.rh_calculator_service import calcular_retrospectiva, limites_do_mes

    usuario = _usuario_atual()
    if not usuario:
        return jsonify({"success": False, "message": "Funcionário não encontrado"}), 404

    alvo_id = request.args.get("funcionario_id", type=int) or usuario.id
    if alvo_id != usuario.id and _get_nivel(usuario) > 3:
        return jsonify({"success": False, "message": "Você só pode ver a própria retrospectiva"}), 403

    alvo = _carregar_funcionario_do_tenant(alvo_id)
    if not alvo:
        return jsonify({"success": False, "message": "Funcionário não encontrado"}), 404

    di = request.args.get("data_inicio")
    df = request.args.get("data_fim")
    if di and df:
        data_inicio = datetime.strptime(di, "%Y-%m-%d").date()
        data_fim = datetime.strptime(df, "%Y-%m-%d").date()
    else:
        ano_mes = request.args.get("ano_mes") or date.today().strftime("%Y-%m")
        data_inicio, data_fim = limites_do_mes(ano_mes)

    try:
        dados = calcular_retrospectiva(alvo, data_inicio, data_fim)
        return jsonify({"success": True, "data": dados}), 200
    except Exception as e:
        current_app.logger.error(f"Erro na retrospectiva: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@rh_bp.route("/provisoes", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def listar_provisoes():
    """Custo real (provisões 1/12 avos) da equipe ativa no mês informado."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Apenas Admin, Gerente ou RH acessam as provisões"}), 403
    try:
        import calendar
        from app.services.rh_calculator_service import calcular_provisoes, calcular_custo_folha_detalhado
        from app.utils.query_helpers import get_authorized_establishment_id

        estab_id = get_authorized_establishment_id()
        ano_mes = request.args.get("ano_mes") or date.today().strftime("%Y-%m")
        regime = None
        try:
            from app.models import Estabelecimento
            est = Estabelecimento.query.get(estab_id) if estab_id and str(estab_id).lower() != "all" else None
            regime = getattr(est, "regime_tributario", None) if est else None
        except Exception:
            regime = None

        q = Funcionario.query.filter_by(ativo=True)
        if estab_id and str(estab_id).lower() != "all":
            q = q.filter_by(estabelecimento_id=estab_id)
        funcionarios = q.all()

        from sqlalchemy import func
        from app.models import FuncionarioBeneficio
        
        query_ben = db.session.query(
            FuncionarioBeneficio.funcionario_id,
            func.sum(FuncionarioBeneficio.valor)
        ).filter(FuncionarioBeneficio.ativo == True).group_by(FuncionarioBeneficio.funcionario_id)
        beneficios_map = dict(query_ben.all())

        itens = []
        for f in funcionarios:
            prov = calcular_provisoes(f, ano_mes, regime)
            ben = float(beneficios_map.get(f.id, 0.0))
            prov["beneficios"] = round(ben, 2)
            prov["custo_real"] = round(prov["custo_real"] + ben, 2)
            itens.append(prov)

        folha_nominal = round(sum(i["salario_base"] for i in itens), 2)

        # Resumo (cards do topo): usa a MESMA fonte única de Despesas/DRE
        # (calcular_custo_folha_periodos) — inclui horas extras e descontos
        # de atraso reais, que calcular_provisoes (usada só no detalhe por
        # funcionário abaixo, para a planilha do contador) não tinha. Antes
        # o card "Custo Real Total" desta página e o "Folha de Pagamento" de
        # Despesas usavam fórmulas diferentes e nunca batiam.
        ano_num, mes_num = (int(p) for p in ano_mes.split("-"))
        dt_inicio_mes = date(ano_num, mes_num, 1)
        dt_fim_mes = date(ano_num, mes_num, calendar.monthrange(ano_num, mes_num)[1])
        folha_real = calcular_custo_folha_detalhado(estab_id, dt_inicio_mes, dt_fim_mes)["custo_folha"]

        total_beneficios = round(folha_real.get("total_beneficios", 0.0), 2)
        custo_total = round(folha_real.get("custo_real_total", 0.0), 2)

        return jsonify({
            "success": True,
            "data": itens,
            "resumo": {
                "ano_mes": ano_mes,
                "funcionarios": len(itens),
                "folha_nominal": folha_nominal,
                "total_beneficios": total_beneficios,
                "custo_real_total": custo_total,
                "provisionamento_total": round(custo_total - folha_nominal - total_beneficios, 2),
            },
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao listar provisões: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


# ============================================
# CATÁLOGO DE BENEFÍCIOS (CRUD)
# ============================================

@rh_bp.route("/catalogo-beneficios", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def listar_catalogo_beneficios():
    """Lista todos os benefícios disponíveis para o estabelecimento."""
    from app.utils.query_helpers import get_authorized_establishment_id
    estab_id = get_authorized_establishment_id()
    
    query = Beneficio.query.filter_by(ativo=True)
    if estab_id and str(estab_id).lower() != "all":
        query = query.filter_by(estabelecimento_id=estab_id)
        
    beneficios = query.all()
    return jsonify({"success": True, "data": [b.to_dict() for b in beneficios]}), 200

@rh_bp.route("/catalogo-beneficios", methods=["POST"])
@funcionario_required
@plan_required('Pro')
def criar_beneficio_catalogo():
    """Cria um novo benefício no catálogo."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Apenas Gestores/RH podem criar benefícios"}), 403
    
    from app.utils.query_helpers import get_authorized_establishment_id
    estab_id = get_authorized_establishment_id()
    data = request.get_json() or {}
    nome = data.get("nome")
    if not nome:
        return jsonify({"success": False, "message": "Nome do benefício é obrigatório"}), 400
        
    beneficio = Beneficio(
        estabelecimento_id=estab_id if str(estab_id).lower() != "all" else None,
        nome=nome,
        descricao=data.get("descricao", ""),
        valor_padrao=Decimal(str(data.get("valor_padrao", 0)))
    )
    db.session.add(beneficio)
    db.session.commit()
    
    return jsonify({"success": True, "data": beneficio.to_dict()}), 201

@rh_bp.route("/catalogo-beneficios/<int:id>", methods=["PUT"])
@funcionario_required
@plan_required('Pro')
def editar_beneficio_catalogo(id):
    """Edita um benefício existente."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Acesso negado"}), 403
        
    from app.utils.query_helpers import get_authorized_establishment_id
    estab_id = get_authorized_establishment_id()
    
    query = Beneficio.query.filter_by(id=id)
    if estab_id and str(estab_id).lower() != "all":
        query = query.filter_by(estabelecimento_id=estab_id)
        
    beneficio = query.first()
    if not beneficio:
        return jsonify({"success": False, "message": "Benefício não encontrado"}), 404
        
    data = request.get_json() or {}
    if "nome" in data:
        beneficio.nome = data["nome"]
    if "descricao" in data:
        beneficio.descricao = data["descricao"]
    if "valor_padrao" in data:
        beneficio.valor_padrao = Decimal(str(data["valor_padrao"]))
        
    db.session.commit()
    return jsonify({"success": True, "data": beneficio.to_dict()}), 200

@rh_bp.route("/catalogo-beneficios/<int:id>", methods=["DELETE"])
@funcionario_required
@plan_required('Pro')
def excluir_beneficio_catalogo(id):
    """Exclui (inativa) um benefício."""
    if not _pode_ver_tudo_rh(_usuario_atual()):
        return jsonify({"success": False, "message": "Acesso negado"}), 403
        
    from app.utils.query_helpers import get_authorized_establishment_id
    estab_id = get_authorized_establishment_id()
    
    query = Beneficio.query.filter_by(id=id)
    if estab_id and str(estab_id).lower() != "all":
        query = query.filter_by(estabelecimento_id=estab_id)
        
    beneficio = query.first()
    if not beneficio:
        return jsonify({"success": False, "message": "Benefício não encontrado"}), 404
        
    beneficio.ativo = False
    db.session.commit()
    return jsonify({"success": True, "message": "Benefício inativado com sucesso"}), 200
