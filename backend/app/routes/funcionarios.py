from datetime import timezone
from flask import Blueprint, request, jsonify, current_app
from app import db
from app.models import Funcionario, Venda, Estabelecimento
from datetime import datetime, date, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import or_, and_, func, case, true
from flask_jwt_extended import get_jwt, jwt_required
from app.decorators.decorator_jwt import funcionario_required
from app.decorators.plan_guards import quota_required, permission_required
from app.decorators.rbac import admin_required as store_admin_required

funcionarios_bp = Blueprint("funcionarios", __name__, url_prefix="/api/funcionarios")

# ==================== SELF-SERVICE: MEU HOLERITE ====================
# Regra de Acesso: TODO funcionário acessa apenas o PRÓPRIO holerite,
# independente do nível de acesso. Não usa @permission_required('funcionarios')
# (que é restrito a Admin/Gerente/RH) — o middleware libera este prefixo
# explicitamente (ver access_control.py: SELF_SERVICE_EXEMPT_PATHS).


def _dependentes(valor) -> int:
    """Número de dependentes para o IRRF: inteiro de 0 a 20."""
    try:
        numero = int(valor or 0)
    except (TypeError, ValueError):
        raise ValueError("Número de dependentes inválido")
    if numero < 0 or numero > 20:
        raise ValueError("Número de dependentes deve ficar entre 0 e 20")
    return numero


@funcionarios_bp.route("/me/holerite", methods=["GET"])
@funcionario_required
def meu_holerite():
    """Dados do PRÓPRIO holerite do mês corrente (ou mes_referencia informado)."""
    try:
        from flask_jwt_extended import get_jwt_identity
        from app.services.rh_calculator_service import calcular_holerite
        funcionario = Funcionario.query.get(int(get_jwt_identity()))
        if not funcionario:
            return jsonify({"success": False, "error": "Funcionário não encontrado"}), 404

        mes_referencia = request.args.get("mes_referencia") or date.today().strftime("%Y-%m")

        # Holerite calculado 100% no BACKEND, lendo a ConfiguracaoFolha
        # (INSS/IRRF progressivos, % hora extra, FGTS, VT). Nada hardcoded.
        holerite = calcular_holerite(funcionario, mes_referencia)
        return jsonify({"success": True, "data": holerite}), 200
    except Exception as e:
        current_app.logger.error(f"Erro em meu_holerite: {e}")
        return jsonify({"success": False, "error": "Falha ao carregar holerite"}), 500


# ==================== CRUD FUNCIONÁRIOS COM FILTROS AVANÇADOS ====================


@funcionarios_bp.route("/", methods=["GET"], strict_slashes=False)
@funcionario_required
def listar_funcionarios():
    """Listar funcionários com filtros avançados e paginação
    
    Query parameters:
    - pagina: número da página (padrão: 1)
    - por_pagina: itens por página (padrão: 20, máximo: 100)
    - busca: busca textual em nome, cpf, usuário, email
    - cargo: filtrar por cargo específico
    - nivel_acesso: filtrar por nível de acesso (role)
    - ativos: true/false (padrão: true)
    - data_admissao_inicio: YYYY-MM-DD
    - data_admissao_fim: YYYY-MM-DD
    - salario_min: valor mínimo
    - salario_max: valor máximo
    - ordenar_por: campo para ordenação (nome, cargo, salario, data_admissao, nivel_acesso)
    - ordem: asc/desc (padrão: asc)
    """
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        # SuperAdmin em visão global (header X-Impersonate-Tenant-Id: all) não filtra por estabelecimento
        visao_global = str(estabelecimento_id).lower() == "all"
        estab_cond_func = true() if visao_global else (Funcionario.estabelecimento_id == estabelecimento_id)
        estab_cond_venda = true() if visao_global else (Venda.estabelecimento_id == estabelecimento_id)

        # Parâmetros de paginação
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = request.args.get("por_pagina", 20, type=int)
        por_pagina = min(por_pagina, 100)  # Limite máximo

        # Filtros básicos
        busca = request.args.get("busca", "").strip()
        cargo = request.args.get("cargo")
        nivel_acesso = request.args.get("nivel_acesso")
        ativos_str = request.args.get("ativos", "true").lower()
        apenas_ativos = ativos_str in ["true", "1", "yes"]
        incluir_estatisticas_str = request.args.get("incluir_estatisticas", "true").lower()
        incluir_estatisticas = incluir_estatisticas_str in ["true", "1", "yes"]
        modo_simples = request.args.get("simples", "false").lower() in ["true", "1", "yes"]

        # Filtros avançados
        data_admissao_inicio = request.args.get("data_admissao_inicio")
        data_admissao_fim = request.args.get("data_admissao_fim")
        salario_min = request.args.get("salario_min", type=float)
        salario_max = request.args.get("salario_max", type=float)

        # Ordenação
        ordenar_por = request.args.get("ordenar_por", "nome")
        ordem = request.args.get("ordem", "asc").lower()

        # Construir query filtrando por estabelecimento
        query = Funcionario.query.filter(estab_cond_func)

        # Aplicar filtro de busca textual
        if busca:
            busca_like = f"%{busca}%"
            query = query.filter(
                or_(
                    ilike_unaccent(Funcionario.nome, busca_like),
                    ilike_unaccent(Funcionario.cpf, busca_like),
                    ilike_unaccent(Funcionario.username, busca_like),
                    ilike_unaccent(Funcionario.email, busca_like),
                    ilike_unaccent(Funcionario.telefone, busca_like),
                    ilike_unaccent(Funcionario.cargo, busca_like),
                )
            )

        # Filtro por cargo
        if cargo:
            query = query.filter(Funcionario.cargo == cargo)

        # Filtro por nível de acesso (role)
        if nivel_acesso:
            query = query.filter(Funcionario.role == nivel_acesso)

        # Filtro por status ativo/inativo
        if apenas_ativos:
            query = query.filter(Funcionario.ativo == True)
        elif ativos_str in ["false", "0", "no"]:
            query = query.filter(Funcionario.ativo == False)

        # Filtro por data de admissão
        try:
            if data_admissao_inicio:
                inicio = datetime.strptime(data_admissao_inicio, "%Y-%m-%d").date()
                query = query.filter(Funcionario.data_admissao >= inicio)
            if data_admissao_fim:
                fim = datetime.strptime(data_admissao_fim, "%Y-%m-%d").date()
                query = query.filter(Funcionario.data_admissao <= fim)
        except ValueError:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Formato de data inválido. Use YYYY-MM-DD",
                    }
                ),
                400,
            )

        # Filtro por faixa salarial
        if salario_min is not None:
            query = query.filter(Funcionario.salario_base >= salario_min)
        if salario_max is not None:
            query = query.filter(Funcionario.salario_base <= salario_max)

        # Aplicar ordenação
        campos_ordenacao = {
            "nome": Funcionario.nome,
            "cargo": Funcionario.cargo,
            "salario": Funcionario.salario_base,
            "data_admissao": Funcionario.data_admissao,
            "nivel_acesso": Funcionario.role,
            "created_at": Funcionario.data_cadastro,
        }

        campo_ordenacao = campos_ordenacao.get(ordenar_por, Funcionario.nome)
        if ordem == "desc":
            query = query.order_by(campo_ordenacao.desc())
        else:
            query = query.order_by(campo_ordenacao.asc())

        # Ordenação secundária por ID
        query = query.order_by(Funcionario.id.asc())

        # Aplicar paginação
        pagination = query.paginate(page=pagina, per_page=por_pagina, error_out=False)
        funcionarios = pagination.items

        # Modo simples para combos/dropdowns: evita payload e cálculos pesados
        if modo_simples:
            resultado_simples = [
                {
                    "id": f.id,
                    "nome": f.nome,
                    "cargo": f.cargo,
                    "ativo": f.ativo,
                }
                for f in funcionarios
            ]
            return jsonify(
                {
                    "success": True,
                    "data": resultado_simples,
                    "paginacao": {
                        "pagina_atual": pagination.page,
                        "por_pagina": pagination.per_page,
                        "total_itens": pagination.total,
                        "total_paginas": pagination.pages,
                        "tem_proxima": pagination.has_next,
                        "tem_anterior": pagination.has_prev,
                        "proxima_pagina": pagination.next_num,
                        "pagina_anterior": pagination.prev_num,
                    },
                    "filtros_aplicados": {
                        "busca": busca,
                        "cargo": cargo,
                        "nivel_acesso": nivel_acesso,
                        "ativos": apenas_ativos,
                        "simples": True,
                    },
                }
            )

        # Preparar resposta
        resultado = []
        funcionario_ids = [f.id for f in funcionarios]
        stats_map = {}
        if incluir_estatisticas and funcionario_ids:
            data_30_dias_atras = datetime.now(timezone.utc) - timedelta(days=30)
            stats_rows = (
                db.session.query(
                    Venda.funcionario_id.label("funcionario_id"),
                    func.count(Venda.id).label("total_vendas"),
                    func.sum(
                        case(
                            (Venda.created_at >= data_30_dias_atras, 1),
                            else_=0,
                        )
                    ).label("vendas_30_dias"),
                )
                .filter(
                    estab_cond_venda,
                    Venda.funcionario_id.in_(funcionario_ids),
                )
                .group_by(Venda.funcionario_id)
                .all()
            )
            stats_map = {
                row.funcionario_id: {
                    "total_vendas": int(row.total_vendas or 0),
                    "vendas_30_dias": int(row.vendas_30_dias or 0),
                }
                for row in stats_rows
            }
        for f in funcionarios:
            stats = stats_map.get(
                f.id,
                {
                    "total_vendas": 0,
                    "vendas_30_dias": 0,
                },
            )

            funcionario_dict = {
                "id": f.id,
                "nome": f.nome,
                "cpf": f.cpf,
                "telefone": f.telefone,
                "celular": f.celular,
                "email": f.email,
                "cargo": f.cargo,
                "salario": float(f.salario_base) if f.salario_base else None,
                "numero_dependentes": int(f.numero_dependentes or 0),
                "data_admissao": (
                    f.data_admissao.isoformat() if f.data_admissao else None
                ),
                # "data_demissao": None, # Campo removido do modelo
                "usuario": f.username,
                "nivel_acesso": f.role,
                "ativo": f.ativo,
                "data_demissao": f.data_demissao.isoformat() if f.data_demissao else None,
                "created_at": f.data_cadastro.isoformat() if f.data_cadastro else None,
                # "updated_at": None, # Campo removido do modelo
                "permissoes": f.permissoes
            }
            if incluir_estatisticas:
                funcionario_dict["estatisticas"] = {
                    "total_vendas": stats["total_vendas"],
                    "vendas_30_dias": stats["vendas_30_dias"],
                }
            resultado.append(funcionario_dict)

        # Obter métricas agregadas para dashboard (apenas para o estabelecimento)
        total_funcionarios = pagination.total
        
        # Consultas separadas para totais gerais (ignorando paginação mas mantendo filtro de estabelecimento)
        base_query = Funcionario.query.filter(estab_cond_func)
        total_ativos = base_query.filter_by(ativo=True).count()
        total_inativos = base_query.filter_by(ativo=False).count()

        # Salário médio
        salario_medio = (
            db.session.query(func.avg(Funcionario.salario_base))
            .filter(estab_cond_func, Funcionario.ativo == True)
            .scalar()
            or 0.0
        )

        # Distribuição por cargo
        distribuicao_cargo = (
            db.session.query(
                Funcionario.cargo, func.count(Funcionario.id).label("quantidade")
            )
            .filter(estab_cond_func, Funcionario.ativo == True)
            .group_by(Funcionario.cargo)
            .all()
        )

        # Distribuição por nível de acesso (role)
        distribuicao_nivel = (
            db.session.query(
                Funcionario.role, func.count(Funcionario.id).label("quantidade")
            )
            .filter(estab_cond_func, Funcionario.ativo == True)
            .group_by(Funcionario.role)
            .all()
        )

        # Cargos disponíveis para filtro
        cargos_disponiveis = (
            db.session.query(Funcionario.cargo)
            .filter(estab_cond_func, Funcionario.cargo.isnot(None))
            .distinct()
            .all()
        )

        # Níveis de acesso disponíveis
        niveis_disponiveis = (
            db.session.query(Funcionario.role)
            .filter(estab_cond_func, Funcionario.role.isnot(None))
            .distinct()
            .all()
        )

        return jsonify(
            {
                "success": True,
                "data": resultado,
                "paginacao": {
                    "pagina_atual": pagination.page,
                    "por_pagina": pagination.per_page,
                    "total_itens": pagination.total,
                    "total_paginas": pagination.pages,
                    "tem_proxima": pagination.has_next,
                    "tem_anterior": pagination.has_prev,
                    "proxima_pagina": pagination.next_num,
                    "pagina_anterior": pagination.prev_num,
                },
                "estatisticas": {
                    "total_funcionarios": total_funcionarios,
                    "total_ativos": total_ativos,
                    "total_inativos": total_inativos,
                    "salario_medio": float(salario_medio),
                    "distribuicao_cargo": [
                        {"cargo": cargo, "quantidade": quantidade}
                        for cargo, quantidade in distribuicao_cargo
                    ],
                    "distribuicao_nivel_acesso": [
                        {"nivel": nivel, "quantidade": quantidade}
                        for nivel, quantidade in distribuicao_nivel
                    ],
                },
                "filtros_disponiveis": {
                    "cargos": [c[0] for c in cargos_disponiveis if c[0]],
                    "niveis_acesso": [n[0] for n in niveis_disponiveis if n[0]],
                },
                "filtros_aplicados": {
                    "busca": busca,
                    "cargo": cargo,
                    "nivel_acesso": nivel_acesso,
                    "ativos": apenas_ativos,
                    "data_admissao_inicio": data_admissao_inicio,
                    "data_admissao_fim": data_admissao_fim,
                    "salario_min": salario_min,
                    "salario_max": salario_max,
                    "ordenar_por": ordenar_por,
                    "ordem": ordem,
                },
            }
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao listar funcionários: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Erro ao listar funcionários",
                    "message": str(e),
                }
            ),
            500,
        )


@funcionarios_bp.route("/estatisticas", methods=["GET"], strict_slashes=False)
@funcionario_required
def estatisticas_funcionarios():
    """Obtém estatísticas detalhadas de funcionários para dashboard"""
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        # SuperAdmin em visão global (header X-Impersonate-Tenant-Id: all) não filtra por estabelecimento
        visao_global = str(estabelecimento_id).lower() == "all"
        estab_cond_func = true() if visao_global else (Funcionario.estabelecimento_id == estabelecimento_id)

        # Estatísticas gerais
        total_funcionarios = Funcionario.query.filter(estab_cond_func).count()
        total_ativos = Funcionario.query.filter(estab_cond_func, Funcionario.ativo == True).count()
        total_inativos = Funcionario.query.filter(estab_cond_func, Funcionario.ativo == False).count()
        
        # Se não há funcionários, retorna estatísticas vazias
        if total_funcionarios == 0:
            return jsonify({
                "success": True,
                "estatisticas": {
                    "totais": {
                        "total_funcionarios": 0,
                        "total_ativos": 0,
                        "total_inativos": 0,
                        "taxa_atividade": 0
                    },
                    "salarios": {
                        "medio": 0,
                        "maximo": 0,
                        "minimo": 0,
                        "soma_total": 0
                    },
                    "distribuicao_cargo": [],
                    "distribuicao_nivel_acesso": [],
                    "admissoes_demissoes": {"por_mes": []},
                    "tempo_empresa": {"medio_dias": 0, "medio_meses": 0, "medio_anos": 0},
                    "top_vendedores": []
                }
            }), 200

        # Salários
        salario_medio = (
            db.session.query(func.avg(Funcionario.salario_base))
            .filter(estab_cond_func, Funcionario.ativo == True)
            .scalar()
            or 0.0
        )

        salario_maximo = (
            db.session.query(func.max(Funcionario.salario_base))
            .filter(estab_cond_func)
            .scalar()
            or 0.0
        )

        salario_minimo = (
            db.session.query(func.min(Funcionario.salario_base))
            .filter(estab_cond_func, Funcionario.ativo == True)
            .scalar()
            or 0.0
        )

        # Distribuição por cargo
        distribuicao_cargo = (
            db.session.query(
                Funcionario.cargo,
                func.count(Funcionario.id).label("quantidade"),
                func.avg(Funcionario.salario_base).label("salario_medio"),
            )
            .filter(estab_cond_func, Funcionario.ativo == True)
            .group_by(Funcionario.cargo)
            .all()
        )

        # Distribuição por nível de acesso (role)
        distribuicao_nivel = (
            db.session.query(
                Funcionario.role, func.count(Funcionario.id).label("quantidade")
            )
            .filter(estab_cond_func, Funcionario.ativo == True)
            .group_by(Funcionario.role)
            .all()
        )

        # Admissões por mês (últimos 12 meses)
        hoje = date.today()
        admissoes_por_mes = []

        for i in range(12):
            mes_data = hoje.replace(day=1)
            for _ in range(i):
                # Subtrair um mês
                if mes_data.month == 1:
                    mes_data = mes_data.replace(year=mes_data.year - 1, month=12)
                else:
                    mes_data = mes_data.replace(month=mes_data.month - 1)

            mes_fim = mes_data
            # Encontrar último dia do mês
            if mes_fim.month == 12:
                mes_fim = mes_fim.replace(
                    year=mes_fim.year + 1, month=1, day=1
                ) - timedelta(days=1)
            else:
                mes_fim = mes_fim.replace(month=mes_fim.month + 1, day=1) - timedelta(
                    days=1
                )

            total_mes = (
                db.session.query(func.count(Funcionario.id))
                .filter(
                    estab_cond_func,
                    Funcionario.data_admissao >= mes_data,
                    Funcionario.data_admissao <= mes_fim,
                )
                .scalar()
                or 0
            )

            # 🔥 CORREÇÃO: Utilizar data_demissao que existe no modelo e contar
            demissoes_mes = (
                db.session.query(func.count(Funcionario.id))
                .filter(
                    estab_cond_func,
                    Funcionario.data_demissao >= mes_data,
                    Funcionario.data_demissao <= mes_fim,
                )
                .scalar()
                or 0
            )
            
            admissoes_por_mes.append(
                {
                    "mes": mes_data.strftime("%Y-%m"),
                    "mes_nome": mes_data.strftime("%b/%Y"),
                    "admissoes": total_mes,
                    "demissoes": demissoes_mes,
                    "saldo": total_mes - demissoes_mes,
                }
            )

        # Totais anuais
        total_admissoes_ano = sum(item["admissoes"] for item in admissoes_por_mes)
        total_demissoes_ano = sum(item["demissoes"] for item in admissoes_por_mes)

        admissoes_por_mes.reverse()  # Do mais antigo para o mais recente

        # Tempo médio de empresa
        funcionarios_ativos = Funcionario.query.filter(
            estab_cond_func,
            Funcionario.ativo == True,
        ).all()
        
        tempo_total_dias = 0
        for f in funcionarios_ativos:
            if f.data_admissao:
                tempo_empresa = (date.today() - f.data_admissao).days
                tempo_total_dias += tempo_empresa

        tempo_medio_empresa = tempo_total_dias / max(1, total_ativos)

        # Funcionários com mais vendas (top 5)
        funcionarios_top_vendas = (
            db.session.query(
                Funcionario,
                func.count(Venda.id).label("total_vendas"),
                func.sum(Venda.total).label("valor_total_vendas"),
            )
            .join(Venda, Funcionario.id == Venda.funcionario_id)
            .filter(estab_cond_func)
            .group_by(Funcionario.id)
            .order_by(func.count(Venda.id).desc())
            .limit(5)
            .all()
        )

        top_vendedores = []
        for funcionario, total_vendas, valor_total in funcionarios_top_vendas:
            top_vendedores.append(
                {
                    "id": funcionario.id,
                    "nome": funcionario.nome,
                    "cargo": funcionario.cargo,
                    "total_vendas": total_vendas,
                    "valor_total_vendas": float(valor_total) if valor_total else 0.0,
                    "ticket_medio": (
                        float(valor_total) / total_vendas if total_vendas > 0 else 0.0
                    ),
                }
            )

        return (
            jsonify(
                {
                    "success": True,
                    "estatisticas": {
                        "totais": {
                            "total_funcionarios": total_funcionarios,
                            "total_ativos": total_ativos,
                            "total_inativos": total_inativos,
                            "taxa_atividade": (
                                total_ativos / max(1, total_funcionarios)
                            )
                            * 100,
                        },
                        "salarios": {
                            "medio": float(salario_medio),
                            "maximo": float(salario_maximo),
                            "minimo": float(salario_minimo),
                            "soma_total": float(salario_medio * total_ativos),
                        },
                        "distribuicao_cargo": [
                            {
                                "cargo": cargo,
                                "quantidade": quantidade,
                                "percentual": (quantidade / max(1, total_ativos)) * 100,
                                "salario_medio": (
                                    float(salario_medio) if salario_medio else 0.0
                                ),
                            }
                            for cargo, quantidade, salario_medio in distribuicao_cargo
                        ],
                        "distribuicao_nivel_acesso": [
                            {
                                "nivel": nivel,
                                "quantidade": quantidade,
                                "percentual": (quantidade / max(1, total_ativos)) * 100,
                            }
                            for nivel, quantidade in distribuicao_nivel
                        ],
                        "admissoes_demissoes": {
                            "por_mes": admissoes_por_mes,
                            "total_admissoes_ano": total_admissoes_ano,
                            "total_demissoes_ano": total_demissoes_ano,
                        },
                        "tempo_empresa": {
                            "medio_dias": tempo_medio_empresa,
                            "medio_meses": tempo_medio_empresa / 30.44,
                            "medio_anos": tempo_medio_empresa / 365.25,
                        },
                        "top_vendedores": top_vendedores,
                        "indicadores": {
                            "rotatividade": (
                                sum(item["demissoes"] for item in admissoes_por_mes)
                                / max(1, total_ativos)
                            )
                            * 100,
                            "custo_folha_mensal": float(salario_medio * total_ativos),
                            "funcionarios_por_nivel": {
                                item["nivel"]: item["quantidade"]
                                for item in [
                                    {"nivel": nivel, "quantidade": quantidade}
                                    for nivel, quantidade in distribuicao_nivel
                                ]
                            },
                        },
                    },
                }
            ),
            200,
        )

    except Exception as e:
        current_app.logger.error(
            f"Erro ao obter estatísticas de funcionários: {str(e)}"
        )
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Erro ao obter estatísticas",
                    "message": str(e),
                }
            ),
            500,
        )


@funcionarios_bp.route("/relatorio-vendas", methods=["GET"])
@funcionario_required
def relatorio_vendas_funcionarios():
    """Relatório de vendas por funcionário"""
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        # Parâmetros de período
        data_inicio_str = request.args.get("inicio")
        data_fim_str = request.args.get("fim")

        hoje = date.today()
        if not data_inicio_str:
            data_inicio = hoje.replace(day=1)  # Início do mês atual
        else:
            data_inicio = datetime.strptime(data_inicio_str, "%Y-%m-%d").date()

        if not data_fim_str:
            data_fim = hoje  # Hoje
        else:
            data_fim = datetime.strptime(data_fim_str, "%Y-%m-%d").date()

        # Query para vendas no período
        vendas_funcionarios = (
            db.session.query(
                Funcionario.id,
                Funcionario.nome,
                Funcionario.cargo,
                func.count(Venda.id).label("total_vendas"),
                func.sum(Venda.total).label("valor_total_vendas"),
                func.avg(Venda.total).label("ticket_medio"),
            )
            .join(Venda, Funcionario.id == Venda.funcionario_id)
            .filter(
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.created_at >= data_inicio,
                Venda.created_at
                <= data_fim + timedelta(days=1),  # Incluir todo o dia final
            )
            .group_by(Funcionario.id, Funcionario.nome, Funcionario.cargo)
            .order_by(func.sum(Venda.total).desc())
            .all()
        )

        # Estatísticas gerais do período
        total_vendas_periodo = (
            db.session.query(func.count(Venda.id))
            .filter(
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.created_at >= data_inicio,
                Venda.created_at <= data_fim + timedelta(days=1),
            )
            .scalar()
            or 0
        )

        valor_total_periodo = (
            db.session.query(func.sum(Venda.total))
            .filter(
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.created_at >= data_inicio,
                Venda.created_at <= data_fim + timedelta(days=1),
            )
            .scalar()
            or 0.0
        )

        # Preparar resposta
        funcionarios_vendas = []
        for (
            id,
            nome,
            cargo,
            total_vendas,
            valor_total,
            ticket_medio,
        ) in vendas_funcionarios:
            percentual_valor = (
                (float(valor_total or 0) / float(valor_total_periodo)) * 100
                if valor_total_periodo > 0
                else 0
            )
            percentual_qtd = (
                (total_vendas / total_vendas_periodo) * 100
                if total_vendas_periodo > 0
                else 0
            )

            funcionarios_vendas.append(
                {
                    "id": id,
                    "nome": nome,
                    "cargo": cargo,
                    "total_vendas": total_vendas,
                    "valor_total_vendas": float(valor_total or 0),
                    "ticket_medio": float(ticket_medio or 0),
                    "percentual_valor": round(percentual_valor, 2),
                    "percentual_quantidade": round(percentual_qtd, 2),
                }
            )

        return (
            jsonify(
                {
                    "success": True,
                    "periodo": {
                        "inicio": data_inicio.isoformat(),
                        "fim": data_fim.isoformat(),
                        "dias": (data_fim - data_inicio).days + 1,
                    },
                    "estatisticas_gerais": {
                        "total_vendas": total_vendas_periodo,
                        "valor_total": float(valor_total_periodo),
                        "ticket_medio_periodo": (
                            float(valor_total_periodo / total_vendas_periodo)
                            if total_vendas_periodo > 0
                            else 0
                        ),
                        "media_diaria": float(
                            valor_total_periodo
                            / max(1, (data_fim - data_inicio).days + 1)
                        ),
                        "total_funcionarios_vendas": len(funcionarios_vendas),
                    },
                    "funcionarios": funcionarios_vendas,
                }
            ),
            200,
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao gerar relatório de vendas: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Erro ao gerar relatório",
                    "message": str(e),
                }
            ),
            500,
        )


# ==================== CORREÇÕES NOS ENDPOINTS EXISTENTES ====================


@funcionarios_bp.route("/<int:id>", methods=["GET"])
@funcionario_required
def detalhes_funcionario(id):
    """Obter detalhes de um funcionário com estatísticas completas"""
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        funcionario = Funcionario.query.filter_by(
            id=id, 
            estabelecimento_id=estabelecimento_id
        ).first()

        if not funcionario:
            return (
                jsonify({"success": False, "error": "Funcionário não encontrado"}),
                404,
            )

        # Estatísticas do funcionário
        total_vendas = Venda.query.filter_by(
            funcionario_id=id,
            estabelecimento_id=estabelecimento_id
        ).count()

        # Vendas dos últimos 30 dias
        data_30_dias_atras = datetime.now(timezone.utc) - timedelta(days=30)
        vendas_30_dias = Venda.query.filter(
            Venda.funcionario_id == id, 
            Venda.estabelecimento_id == estabelecimento_id,
            Venda.created_at >= data_30_dias_atras
        ).count()

        # Valor total de vendas
        valor_total_vendas = (
            db.session.query(func.sum(Venda.total))
            .filter(
                Venda.funcionario_id == id,
                Venda.estabelecimento_id == estabelecimento_id
            )
            .scalar()
            or 0.0
        )

        # Vendas por mês (últimos 6 meses)
        hoje = datetime.now(timezone.utc)
        vendas_por_mes = []

        for i in range(6):
            mes_data = hoje.replace(day=1)
            for _ in range(i):
                if mes_data.month == 1:
                    mes_data = mes_data.replace(year=mes_data.year - 1, month=12)
                else:
                    mes_data = mes_data.replace(month=mes_data.month - 1)

            mes_fim = mes_data
            if mes_fim.month == 12:
                mes_fim = mes_fim.replace(
                    year=mes_fim.year + 1, month=1, day=1
                ) - timedelta(days=1)
            else:
                mes_fim = mes_fim.replace(month=mes_fim.month + 1, day=1) - timedelta(
                    days=1
                )

            vendas_mes = Venda.query.filter(
                Venda.funcionario_id == id,
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.created_at >= mes_data,
                Venda.created_at <= mes_fim,
            ).count()

            valor_mes = (
                db.session.query(func.sum(Venda.total))
                .filter(
                    Venda.funcionario_id == id,
                    Venda.estabelecimento_id == estabelecimento_id,
                    Venda.created_at >= mes_data,
                    Venda.created_at <= mes_fim,
                )
                .scalar()
                or 0.0
            )

            vendas_por_mes.append(
                {
                    "mes": mes_data.strftime("%Y-%m"),
                    "mes_nome": mes_data.strftime("%b/%Y"),
                    "quantidade_vendas": vendas_mes,
                    "valor_total": float(valor_mes),
                }
            )

        vendas_por_mes.reverse()

        funcionario_dict = {
            "id": funcionario.id,
            "nome": funcionario.nome,
            "cpf": funcionario.cpf,
            "rg": funcionario.rg,
            "data_nascimento": (
                funcionario.data_nascimento.isoformat()
                if funcionario.data_nascimento
                else None
            ),
            "telefone": funcionario.telefone,
            "celular": funcionario.celular,
            "email": funcionario.email,
            "endereco": (
                f"{funcionario.logradouro}, {funcionario.numero} - {funcionario.bairro}, {funcionario.cidade}/{funcionario.estado}"
                if hasattr(funcionario, "logradouro") and funcionario.logradouro
                else getattr(funcionario, "endereco", "Endereço não informado")
            ),
            "cargo": funcionario.cargo,
            "salario": float(funcionario.salario_base) if funcionario.salario_base else None,
            "numero_dependentes": int(funcionario.numero_dependentes or 0),
            "data_admissao": (
                funcionario.data_admissao.isoformat()
                if funcionario.data_admissao
                else None
            ),
            # "data_demissao": None, # Campo removido
            "usuario": funcionario.username,
            "nivel_acesso": funcionario.role,
            "ativo": funcionario.ativo,
            "created_at": (
                funcionario.data_cadastro.isoformat() if funcionario.data_cadastro else None
            ),
            "estatisticas": {
                "total_vendas": total_vendas,
                "vendas_30_dias": vendas_30_dias,
                "valor_total_vendas": float(valor_total_vendas),
                "ticket_medio": (
                    float(valor_total_vendas / total_vendas) if total_vendas > 0 else 0
                ),
                "vendas_por_mes": vendas_por_mes,
                "tempo_empresa_dias": (
                    (date.today() - funcionario.data_admissao).days
                    if funcionario.data_admissao
                    else None
                ),
                "tempo_empresa_anos": (
                    ((date.today() - funcionario.data_admissao).days / 365.25)
                    if funcionario.data_admissao
                    else None
                ),
            },
            "permissoes": funcionario.permissoes
        }

        return jsonify({"success": True, "data": funcionario_dict}), 200

    except Exception as e:
        current_app.logger.error(f"Erro ao obter funcionário {id}: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify(
                {"success": False, "error": f"Erro ao obter funcionário: {str(e)}"}
            ),
            500,
        )


@funcionarios_bp.route("/niveis", methods=["GET"])
@jwt_required()
def listar_niveis_acesso():
    """Retorna a hierarquia de níveis de acesso disponível no sistema."""
    from app.decorators.rbac import NIVEL_LABELS, RBAC_MATRIX, ROLE_TO_NIVEL

    niveis = [
        {
            "nivel": n,
            "label": label,
            "role": next((r for r, v in ROLE_TO_NIVEL.items() if v == n), ""),
            "recursos": sorted([rec for rec, lvls in RBAC_MATRIX.items() if n in lvls]),
        }
        for n, label in NIVEL_LABELS.items()
    ]
    return jsonify({"success": True, "data": niveis}), 200


@funcionarios_bp.route("/", methods=["POST"], strict_slashes=False)
@store_admin_required
@jwt_required()
@permission_required('funcionarios')
@quota_required('funcionario')
def criar_funcionario():
    """Criar um novo funcionário"""
    try:
        # Obter estabelecimento do token
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "Nenhum dado fornecido"}), 400

        # Validações obrigatórias
        if not data.get("nome"):
            return (
                jsonify(
                    {"success": False, "error": "Nome do funcionário é obrigatório"}
                ),
                400,
            )

        if not data.get("cpf"):
            return (
                jsonify(
                    {"success": False, "error": "CPF do funcionário é obrigatório"}
                ),
                400,
            )

        usuario = data.get("usuario") or data.get("username")
        if not usuario:
            return jsonify({"success": False, "error": "Usuário é obrigatório"}), 400

        if not data.get("senha"):
            return jsonify({"success": False, "error": "Senha é obrigatória"}), 400

        # Verificar CPF único no estabelecimento
        cpf = data.get("cpf")
        existente_cpf = Funcionario.query.filter_by(
            cpf=cpf, 
            estabelecimento_id=estabelecimento_id
        ).first()
        
        if existente_cpf:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "CPF já cadastrado neste estabelecimento",
                        "funcionario_existente": {
                            "id": existente_cpf.id,
                            "nome": existente_cpf.nome,
                        },
                    }
                ),
                409,
            )

        # Verificar usuário único no estabelecimento
        existente_usuario = Funcionario.query.filter_by(
            username=usuario, 
            estabelecimento_id=estabelecimento_id
        ).first()
        
        if existente_usuario:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Usuário já cadastrado neste estabelecimento",
                        "funcionario_existente": {
                            "id": existente_usuario.id,
                            "nome": existente_usuario.nome,
                        },
                    }
                ),
                409,
            )

        # Criar funcionário
        try:
            dependentes = _dependentes(data.get("numero_dependentes"))
        except ValueError as ve:
            return jsonify({"success": False, "error": str(ve)}), 400

        novo_funcionario = Funcionario(
            estabelecimento_id=estabelecimento_id,
            nome=data["nome"],
            cpf=cpf,
            rg=data.get("rg", ""),
            data_nascimento=(
                datetime.strptime(data["data_nascimento"], "%Y-%m-%d").date()
                if data.get("data_nascimento")
                else None
            ),
            telefone=data.get("telefone", ""),
            celular=data.get("celular", ""),
            email=data.get("email", ""),
            # endereco=data.get("endereco", ""), # Mixin usa logradouro, numero, etc.
            # Se o frontend manda "endereco", precisamos adaptar ou assumir que o frontend manda os campos certos
            # O modelo Funcionario herda de EnderecoMixin que tem: cep, logradouro, numero, complemento, bairro, cidade, estado
            # Vou assumir campos vazios por enquanto para evitar erro de integridade se forem not null
            cep=data.get("cep", "00000000"),
            logradouro=data.get("logradouro", "Não informado"),
            numero=data.get("numero", "S/N"),
            bairro=data.get("bairro", "Não informado"),
            complemento=data.get("complemento", ""),
            cidade=data.get("cidade", "Não informado"),
            estado=data.get("estado", "UF"),
            pais=data.get("pais", "Brasil"),
            
            cargo=data.get("cargo", "Atendente"),
            salario_base=float(data.get("salario", 0)),
            numero_dependentes=dependentes,
            data_admissao=(
                datetime.strptime(data["data_admissao"], "%Y-%m-%d").date()
                if data.get("data_admissao")
                else date.today()
            ),
            # data_demissao removido do modelo
            username=usuario,
            role=data.get("role") or data.get("nivel_acesso", "FUNCIONARIO"),
            ativo=data.get("ativo", True),
        )

        # Sincronizar nivel_acesso inteiro com o role
        from app.decorators.rbac import nivel_do_role
        novo_funcionario.nivel_acesso = nivel_do_role(novo_funcionario.role)

        # Definir senha
        novo_funcionario.set_senha(data["senha"])

        # Definir PIN de cancelamento se fornecido (4 a 6 dígitos, armazenado com hash)
        if data.get("pin_cancelamento"):
            try:
                novo_funcionario.set_pin(data["pin_cancelamento"])
            except ValueError as ve:
                return jsonify({"success": False, "error": str(ve)}), 400

        db.session.add(novo_funcionario)
        db.session.commit()

        return (
            jsonify(
                {
                    "success": True,
                    "message": "Funcionário criado com sucesso",
                    "data": {
                        "id": novo_funcionario.id,
                        "nome": novo_funcionario.nome,
                        "usuario": novo_funcionario.username,
                        "cargo": novo_funcionario.cargo,
                    },
                }
            ),
            201,
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao criar funcionário: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify(
                {"success": False, "error": f"Erro ao criar funcionário: {str(e)}"}
            ),
            500,
        )


@funcionarios_bp.route("/<int:id>", methods=["PUT"])
@funcionario_required
def atualizar_funcionario(id):
    """Atualizar informações de um funcionário"""
    try:
        # Obter estabelecimento do token
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        funcionario = Funcionario.query.filter_by(
            id=id, 
            estabelecimento_id=estabelecimento_id
        ).first()

        if not funcionario:
            return (
                jsonify({"success": False, "error": "Funcionário não encontrado"}),
                404,
            )

        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "Nenhum dado fornecido"}), 400

        # RH/gerente podem manter cadastro, mas não promover contas nem
        # redefinir senha/PIN do administrador para assumir seu acesso.
        from flask_jwt_extended import get_jwt_identity
        from app.decorators.rbac import _get_nivel
        actor = Funcionario.query.get(int(get_jwt_identity()))
        sensitive = {'role', 'nivel_acesso', 'senha', 'pin_cancelamento', 'username', 'usuario', 'ativo'}
        if not actor or (_get_nivel(actor) not in (0, 1) and (
            sensitive.intersection(data) or _get_nivel(funcionario) < _get_nivel(actor)
        )):
            return jsonify({'success': False, 'error': 'Somente o administrador pode alterar acessos ou contas superiores'}), 403

        # Verificar CPF único (se estiver sendo alterado)
        if "cpf" in data and data["cpf"] != funcionario.cpf:
            existente = Funcionario.query.filter_by(
                cpf=data["cpf"],
                estabelecimento_id=estabelecimento_id
            ).first()
            if existente and existente.id != id:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "CPF já cadastrado em outro funcionário",
                            "funcionario_existente": {
                                "id": existente.id,
                                "nome": existente.nome,
                            },
                        }
                    ),
                    409,
                )

        # Verificar usuário único (se estiver sendo alterado)
        usuario_novo = data.get("usuario") or data.get("username")
        if usuario_novo and usuario_novo != funcionario.username:
            existente = Funcionario.query.filter_by(
                username=usuario_novo,
                estabelecimento_id=estabelecimento_id
            ).first()
            if existente and existente.id != id:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "Usuário já cadastrado em outro funcionário",
                            "funcionario_existente": {
                                "id": existente.id,
                                "nome": existente.nome,
                            },
                        }
                    ),
                    409,
                )

        # Atualizar campos
        # Mapeamento campo_request -> campo_modelo
        campo_map = {
            "nome": "nome",
            "cpf": "cpf",
            "rg": "rg",
            "telefone": "telefone",
            "celular": "celular",
            "email": "email",
            "cargo": "cargo",
            "salario": "salario_base", # Mapeia salario -> salario_base
            "usuario": "username",     # Mapeia usuario -> username
            "username": "username",
            "nivel_acesso": "role",    # Mapeia nivel_acesso -> role
            "role": "role",
            "ativo": "ativo",
            # Campos de endereço mixin
            "cep": "cep",
            "logradouro": "logradouro",
            "numero": "numero",
            "complemento": "complemento",
            "bairro": "bairro",
            "cidade": "cidade",
            "estado": "estado",
            "pais": "pais",
        }

        # Campos de data que precisam de conversão
        campos_data = ["data_nascimento", "data_admissao"]

        for campo_req, valor in data.items():
            if campo_req in campos_data and valor:
                try:
                    data_obj = datetime.strptime(valor, "%Y-%m-%d").date()
                    setattr(funcionario, campo_req, data_obj)
                except ValueError:
                    pass # Ignora formato inválido
            elif campo_req in campo_map:
                campo_model = campo_map[campo_req]
                setattr(funcionario, campo_model, valor)
            
            # Tratamento especial para endereco string única (se vier do frontend antigo)
            if campo_req == "endereco" and isinstance(valor, str) and valor:
                # Tenta colocar no logradouro se não tiver estrutura
                funcionario.logradouro = valor

        if "numero_dependentes" in data:
            try:
                funcionario.numero_dependentes = _dependentes(data["numero_dependentes"])
            except ValueError as ve:
                return jsonify({"success": False, "error": str(ve)}), 400

        # Manter nivel_acesso numérico sincronizado com o role
        if "role" in data or "nivel_acesso" in data:
            from app.decorators.rbac import nivel_do_role
            funcionario.nivel_acesso = nivel_do_role(funcionario.role)

        # Atualizar senha se fornecida
        if "senha" in data and data["senha"]:
            funcionario.set_senha(data["senha"])

        # Atualizar PIN de cancelamento se fornecido (4 a 6 dígitos, armazenado com hash)
        if "pin_cancelamento" in data and data["pin_cancelamento"]:
            try:
                funcionario.set_pin(data["pin_cancelamento"])
            except ValueError as ve:
                return jsonify({"success": False, "error": str(ve)}), 400

        db.session.commit()

        return (
            jsonify(
                {
                    "success": True,
                    "message": "Funcionário atualizado com sucesso",
                    "data": {
                        "id": funcionario.id,
                        "nome": funcionario.nome,
                        "usuario": funcionario.username,
                        "cargo": funcionario.cargo,
                        "ativo": funcionario.ativo,
                    },
                }
            ),
            200,
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao atualizar funcionário {id}: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify(
                {"success": False, "error": f"Erro ao atualizar funcionário: {str(e)}"}
            ),
            500,
        )


@funcionarios_bp.route("/<int:id>", methods=["DELETE"])
@store_admin_required
@funcionario_required
def excluir_funcionario(id):
    """Excluir (desativar) um funcionário"""
    try:
        # Obter estabelecimento do token
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        funcionario = Funcionario.query.filter_by(
            id=id, 
            estabelecimento_id=estabelecimento_id
        ).first()

        if not funcionario:
            return (
                jsonify({"success": False, "error": "Funcionário não encontrado"}),
                404,
            )

        # Verificar se é o único admin
        if funcionario.role == "admin":
            admins_ativos = Funcionario.query.filter_by(
                role="admin", 
                ativo=True,
                estabelecimento_id=estabelecimento_id
            ).count()
            if admins_ativos <= 1:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "Não é possível desativar o único administrador do sistema",
                        }
                    ),
                    400,
                )

        # Verificar se funcionário tem vendas
        total_vendas = Venda.query.filter_by(
            funcionario_id=id,
            estabelecimento_id=estabelecimento_id
        ).count()
        if total_vendas > 0:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Não é possível excluir o funcionário pois existem vendas vinculadas a ele",
                        "quantidade_vendas": total_vendas,
                    }
                ),
                400,
            )

        # Exclusão lógica
        funcionario.ativo = False
        funcionario.data_demissao = date.today()
        funcionario.status = "inativo"

        db.session.commit()

        return (
            jsonify(
                {
                    "success": True,
                    "message": "Funcionário desativado com sucesso",
                    "data": {
                        "id": funcionario.id,
                        "nome": funcionario.nome,
                        "ativo": False,
                    },
                }
            ),
            200,
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao excluir funcionário {id}: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify(
                {"success": False, "error": f"Erro ao excluir funcionário: {str(e)}"}
            ),
            500,
        )


@funcionarios_bp.route("/login", methods=["POST"])
def login_funcionario():
    """Login de funcionário"""
    try:
        data = request.get_json()

        if not data or not data.get("usuario") or not data.get("senha"):
            return (
                jsonify(
                    {"success": False, "error": "Usuário e senha são obrigatórios"}
                ),
                400,
            )

        usuario = data["usuario"]
        senha = data["senha"]

        funcionario = Funcionario.query.filter_by(username=usuario, ativo=True).first()

        if not funcionario:
            return (
                jsonify(
                    {"success": False, "error": "Usuário não encontrado ou inativo"}
                ),
                401,
            )

        if not funcionario.check_senha(senha):
            return jsonify({"success": False, "error": "Senha incorreta"}), 401

        # Retornar dados do funcionário (sem senha)
        return (
            jsonify(
                {
                    "success": True,
                    "message": "Login realizado com sucesso",
                    "data": {
                        "id": funcionario.id,
                        "nome": funcionario.nome,
                        "usuario": funcionario.username,
                        "nivel_acesso": funcionario.role,
                        "cargo": funcionario.cargo,
                    },
                }
            ),
            200,
        )

    except Exception as e:
        current_app.logger.error(f"Erro no login: {str(e)}")
        return jsonify({"success": False, "error": f"Erro no login: {str(e)}"}), 500


@funcionarios_bp.route("/verificar-pin", methods=["POST"])
def verificar_pin():
    """Verificar PIN para PDV - DESABILITADO (modelo não suporta PIN)"""
    return jsonify({
        "success": False, 
        "error": "Funcionalidade de PIN não implementada no modelo atual"
    }), 501
