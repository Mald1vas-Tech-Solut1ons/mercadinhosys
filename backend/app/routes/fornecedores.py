from datetime import timezone
# app/fornecedores.py
# MÓDULO COMPLETO DE FORNECEDORES - ERP INDUSTRIAL BRASILEIRO
# CRUD completo com todas as operações necessárias

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import get_jwt, jwt_required
from app.decorators.decorator_jwt import funcionario_required
from app.decorators.plan_guards import quota_required, permission_required
from datetime import datetime
from decimal import Decimal
import re
from werkzeug.exceptions import HTTPException
from app.models import (
    db,
    Fornecedor,
    Estabelecimento,
    PedidoCompra,
    Produto,
    ContaPagar,
)
from app.utils import validar_cnpj, validar_email, formatar_telefone

fornecedores_bp = Blueprint("fornecedores", __name__)


def _supplier_query(estabelecimento_id):
    """Consulta autorizada; a sentinela global nunca vira um parâmetro SQL inteiro."""
    query = Fornecedor.query.filter(Fornecedor.deleted_at.is_(None))
    if str(estabelecimento_id).lower() == "all":
        if not get_jwt().get("is_super_admin"):
            from flask import abort
            abort(403)
        return query
    return query.filter(Fornecedor.estabelecimento_id == estabelecimento_id)

# ============================================
# VALIDAÇÕES ESPECÍFICAS DE FORNECEDOR
# ============================================


def validar_dados_fornecedor(data, fornecedor_id=None, estabelecimento_id=None):
    """Valida todos os dados do fornecedor antes de salvar"""
    erros = []

    # Validação de campos obrigatórios
    campos_obrigatorios = ["nome_fantasia", "razao_social", "cnpj", "telefone", "email"]
    for campo in campos_obrigatorios:
        if not data.get(campo):
            erros.append(f'O campo {campo.replace("_", " ").title()} é obrigatório')

    # Validação de CNPJ
    if data.get("cnpj") and estabelecimento_id:
        cnpj = re.sub(r"\D", "", data["cnpj"])
        if len(cnpj) != 14:
            erros.append("CNPJ deve conter 14 dígitos")
        elif not validar_cnpj(cnpj):
            erros.append("CNPJ inválido")

        # Verifica se CNPJ já existe (exceto para o próprio fornecedor em atualização)
        fornecedor_existente = Fornecedor.query.filter_by(
            cnpj=cnpj, estabelecimento_id=estabelecimento_id
        ).first()

        if fornecedor_existente and fornecedor_existente.id != fornecedor_id:
            erros.append("CNPJ já cadastrado para outro fornecedor")

    # Validação de email
    if data.get("email") and not validar_email(data["email"]):
        erros.append("Email inválido")

    # Validação de telefone
    if data.get("telefone"):
        telefone = re.sub(r"\D", "", data["telefone"])
        if len(telefone) < 10 or len(telefone) > 11:
            erros.append("Telefone inválido")

    # Validação de prazo de entrega
    if data.get("prazo_entrega"):
        try:
            prazo = int(data["prazo_entrega"])
            if prazo < 0 or prazo > 365:
                erros.append("Prazo de entrega deve estar entre 0 e 365 dias")
        except ValueError:
            erros.append("Prazo de entrega deve ser um número inteiro")

    # Validação de endereço
    campos_endereco = ["cep", "logradouro", "numero", "bairro", "cidade", "estado"]
    for campo in campos_endereco:
        if not data.get(campo):
            erros.append(f'O campo {campo.replace("_", " ").title()} é obrigatório')

    # Validação de estado
    if data.get("estado"):
        estados_brasil = [
            "AC",
            "AL",
            "AP",
            "AM",
            "BA",
            "CE",
            "DF",
            "ES",
            "GO",
            "MA",
            "MT",
            "MS",
            "MG",
            "PA",
            "PB",
            "PR",
            "PE",
            "PI",
            "RJ",
            "RN",
            "RS",
            "RO",
            "RR",
            "SC",
            "SP",
            "SE",
            "TO",
        ]
        if data["estado"].upper() not in estados_brasil:
            erros.append("Estado inválido. Use a sigla de 2 letras (ex: SP)")

    return erros


def formatar_cnpj(cnpj):
    """Formata CNPJ para o padrão 00.000.000/0000-00"""
    cnpj = re.sub(r"\D", "", cnpj)
    if len(cnpj) == 14:
        return f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:]}"
    return cnpj


def calcular_classificacao_fornecedor(fornecedor):
    """Calcula classificação do fornecedor baseado em métricas"""
    if fornecedor.total_compras == 0:
        return "NOVO"

    # Baseado em volume de compras e prazo médio
    valor_total = float(fornecedor.valor_total_comprado or 0)
    total_compras = fornecedor.total_compras or 0

    if valor_total > 100000:
        return "PREMIUM"
    elif valor_total > 50000:
        return "A"
    elif valor_total > 10000:
        return "B"
    else:
        return "C"


# ============================================
# ROTAS DE FORNECEDORES
# ============================================


@fornecedores_bp.route("/", methods=["GET"], strict_slashes=False)
@fornecedores_bp.route("", methods=["GET"], strict_slashes=False)
@funcionario_required
def listar_fornecedores():
    """Lista todos os fornecedores com filtros e paginação"""
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400
        
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = request.args.get("por_pagina", 50, type=int)
        ativo = request.args.get("ativo", None, type=str)
        classificacao = request.args.get("classificacao", None, type=str)
        busca = request.args.get("busca", "", type=str).strip()

        # Query base
        query = _supplier_query(estabelecimento_id)

        # Filtros
        if ativo is not None:
            query = query.filter_by(ativo=ativo.lower() == "true")

        if classificacao:
            query = query.filter_by(classificacao=classificacao.upper())

        if busca:
            busca_termo = f"%{busca}%"
            query = query.filter(
                db.or_(
                    ilike_unaccent(Fornecedor.nome_fantasia, busca_termo),
                    ilike_unaccent(Fornecedor.razao_social, busca_termo),
                    ilike_unaccent(Fornecedor.cnpj, busca_termo),
                    ilike_unaccent(Fornecedor.email, busca_termo),
                    ilike_unaccent(Fornecedor.contato_nome, busca_termo),
                )
            )

        # Ordenação
        query = query.order_by(
            Fornecedor.nome_fantasia.asc(), Fornecedor.data_cadastro.desc()
        )

        # Paginação
        paginacao = query.paginate(page=pagina, per_page=por_pagina, error_out=False)

        fornecedores = []
        for fornecedor in paginacao.items:
            fornecedor_dict = fornecedor.to_dict()
            fornecedor_dict["classificacao"] = calcular_classificacao_fornecedor(
                fornecedor
            )
            # Adicionar última compra de forma segura
            try:
                last_order = fornecedor.pedidos_compra.order_by(PedidoCompra.data_pedido.desc()).first()
                fornecedor_dict["ultima_compra"] = last_order.data_pedido.isoformat() if last_order and last_order.data_pedido else None
            except Exception:
                fornecedor_dict["ultima_compra"] = None

            # Contar produtos ativos
            produtos_ativos = Produto.query.filter_by(
                fornecedor_id=fornecedor.id,
                ativo=True,
                estabelecimento_id=fornecedor.estabelecimento_id,
            ).count()
            fornecedor_dict["produtos_ativos"] = produtos_ativos

            fornecedores.append(fornecedor_dict)

        return jsonify(
            {
                "success": True,
                "fornecedores": fornecedores,
                "total": paginacao.total,
                "pagina": pagina,
                "por_pagina": por_pagina,
                "total_paginas": paginacao.pages,
            }
        )

    except Exception:
        current_app.logger.exception("Erro na consulta principal de fornecedores")
        # PostgreSQL exige rollback antes de consultar após falha de SQL.
        db.session.rollback()
        try:
            from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
            estabelecimento_id = get_authorized_establishment_id()
            if not estabelecimento_id:
                return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400
            pagina = max(1, request.args.get("pagina", 1, type=int))
            por_pagina = max(1, min(200, request.args.get("por_pagina", 50, type=int)))
            # Projeção mínima: evita campos opcionais e serialização de relações.
            query = db.session.query(
                Fornecedor.id, Fornecedor.nome_fantasia, Fornecedor.razao_social,
                Fornecedor.cnpj, Fornecedor.telefone, Fornecedor.email,
                Fornecedor.cidade, Fornecedor.estado, Fornecedor.ativo, Fornecedor.classificacao,
            ).filter(Fornecedor.deleted_at.is_(None))
            if str(estabelecimento_id).lower() != "all":
                query = query.filter(Fornecedor.estabelecimento_id == estabelecimento_id)
            ativo = request.args.get("ativo")
            if ativo is not None:
                query = query.filter(Fornecedor.ativo == (ativo.lower() == "true"))
            classificacao = request.args.get("classificacao")
            if classificacao:
                query = query.filter(Fornecedor.classificacao == classificacao.upper())
            busca = request.args.get("busca", "").strip()
            if busca:
                query = query.filter(db.or_(*[
                    ilike_unaccent(column, f"%{busca}%") for column in (
                        Fornecedor.nome_fantasia, Fornecedor.razao_social, Fornecedor.cnpj,
                        Fornecedor.email, Fornecedor.contato_nome,
                    )
                ]))
            total = query.count()
            rows = query.order_by(Fornecedor.nome_fantasia.asc()).limit(por_pagina).offset((pagina - 1) * por_pagina).all()
            fornecedores = [dict(row._mapping, produtos_ativos=None, ultima_compra=None) for row in rows]
            return jsonify({
                "success": True, "fornecedores": fornecedores, "total": total,
                "pagina": pagina, "por_pagina": por_pagina,
                "total_paginas": (total + por_pagina - 1) // por_pagina,
                "degraded": True,
            })
        except Exception:
            db.session.rollback()
            current_app.logger.exception("Fallback fornecedores falhou")
            return jsonify({"success": False, "message": "Erro interno ao listar fornecedores"}), 500

@fornecedores_bp.route("/<int:id>", methods=["GET"])
@funcionario_required
def obter_fornecedor(id):
    """Obtém detalhes completos de um fornecedor específico"""
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        fornecedor = _supplier_query(estabelecimento_id).filter_by(id=id).first_or_404()
        estabelecimento_id = fornecedor.estabelecimento_id

        # Dados básicos
        dados_fornecedor = fornecedor.to_dict()

        # Estatísticas
        pedidos = PedidoCompra.query.filter_by(
            fornecedor_id=id, estabelecimento_id=estabelecimento_id
        ).all()

        contas_pagar = ContaPagar.query.filter_by(
            fornecedor_id=id,
            estabelecimento_id=estabelecimento_id,
        ).filter(ContaPagar.status.in_(["aberto", "parcial"])).all()

        produtos = Produto.query.filter_by(
            fornecedor_id=id,
            estabelecimento_id=estabelecimento_id,
            ativo=True,
        ).all()

        # Métricas
        total_pedidos = len(pedidos)
        pedidos_pendentes = len([p for p in pedidos if p.status == "pendente"])
        total_contas_abertas = len(contas_pagar)
        valor_total_devido = sum(float(c.valor_atual) for c in contas_pagar)
        total_produtos = len(produtos)

        # Últimos pedidos
        ultimos_pedidos = []
        for pedido in pedidos[:10]:  # Últimos 10 pedidos
            ultimos_pedidos.append(
                {
                    "id": pedido.id,
                    "numero_pedido": pedido.numero_pedido,
                    "data_pedido": (
                        pedido.data_pedido.isoformat() if pedido.data_pedido else None
                    ),
                    "status": pedido.status,
                    "total": float(pedido.total),
                    "quantidade_itens": len(pedido.itens),
                }
            )

        # Produtos do fornecedor
        lista_produtos = []
        for produto in produtos[:20]:  # Primeiros 20 produtos
            lista_produtos.append(
                {
                    "id": produto.id,
                    "nome": produto.nome,
                    "codigo_barras": produto.codigo_barras,
                    "quantidade": produto.quantidade,
                    "preco_custo": float(produto.preco_custo),
                    "preco_venda": float(produto.preco_venda),
                    "ativo": produto.ativo,
                }
            )

        return jsonify(
            {
                "success": True,
                "fornecedor": dados_fornecedor,
                "metricas": {
                    "total_pedidos": total_pedidos,
                    "pedidos_pendentes": pedidos_pendentes,
                    "total_contas_abertas": total_contas_abertas,
                    "valor_total_devido": valor_total_devido,
                    "total_produtos": total_produtos,
                    "classificacao": calcular_classificacao_fornecedor(fornecedor),
                },
                "ultimos_pedidos": ultimos_pedidos,
                "produtos": lista_produtos,
                "endereco_completo": fornecedor.endereco_completo(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        current_app.logger.error(f"Erro ao obter fornecedor {id}: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao obter fornecedor"}),
            500,
        )


@fornecedores_bp.route("/", methods=["POST"], strict_slashes=False)
@jwt_required()
@permission_required('fornecedores')
@quota_required('fornecedor')
def criar_fornecedor():
    """Cria um novo fornecedor"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")
        
        data = request.get_json()

        # Validação dos dados
        erros = validar_dados_fornecedor(data, estabelecimento_id=estabelecimento_id)
        if erros:
            return (
                jsonify(
                    {"success": False, "message": "Erros de validação", "errors": erros}
                ),
                400,
            )

        # Formatar dados
        cnpj_formatado = formatar_cnpj(data["cnpj"])
        telefone_formatado = formatar_telefone(data["telefone"])

        # Criar fornecedor
        fornecedor = Fornecedor(
            estabelecimento_id=estabelecimento_id,
            nome_fantasia=data["nome_fantasia"].strip(),
            razao_social=data["razao_social"].strip(),
            cnpj=cnpj_formatado,
            inscricao_estadual=data.get("inscricao_estadual", "").strip(),
            telefone=telefone_formatado,
            email=data["email"].strip().lower(),
            contato_nome=data.get("contato_nome", "").strip(),
            contato_telefone=formatar_telefone(data.get("contato_telefone", "")),
            prazo_entrega=int(data.get("prazo_entrega", 7)),
            forma_pagamento=data.get("forma_pagamento", "30 DIAS"),
            classificacao=data.get("classificacao", "REGULAR"),
            # Endereço
            cep=data["cep"].strip(),
            logradouro=data["logradouro"].strip(),
            numero=data["numero"].strip(),
            complemento=data.get("complemento", "").strip(),
            bairro=data["bairro"].strip(),
            cidade=data["cidade"].strip(),
            estado=data["estado"].strip().upper(),
            pais=data.get("pais", "Brasil").strip(),
            ativo=data.get("ativo", True),
            total_compras=0,
            valor_total_comprado=0,
        )

        db.session.add(fornecedor)
        db.session.commit()

        # Log de auditoria
        current_app.logger.info(
            f"Fornecedor criado: {fornecedor.id} - {fornecedor.nome_fantasia} por {username}"
        )

        return (
            jsonify(
                {
                    "success": True,
                    "message": "Fornecedor criado com sucesso",
                    "fornecedor": fornecedor.to_dict(),
                }
            ),
            201,
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao criar fornecedor: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao criar fornecedor"}),
            500,
        )


@fornecedores_bp.route("/<int:id>", methods=["PUT"])
@funcionario_required
def atualizar_fornecedor(id):
    """Atualiza um fornecedor existente"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")
        
        fornecedor = Fornecedor.query.filter_by(
            id=id, estabelecimento_id=estabelecimento_id
        ).first_or_404()

        data = request.get_json()

        # Validação dos dados (passando ID para verificação de CNPJ único)
        erros = validar_dados_fornecedor(data, fornecedor.id, estabelecimento_id)
        if erros:
            return (
                jsonify(
                    {"success": False, "message": "Erros de validação", "errors": erros}
                ),
                400,
            )

        # Formatar dados
        if "cnpj" in data:
            fornecedor.cnpj = formatar_cnpj(data["cnpj"])

        if "telefone" in data:
            fornecedor.telefone = formatar_telefone(data["telefone"])

        if "contato_telefone" in data:
            fornecedor.contato_telefone = formatar_telefone(data["contato_telefone"])

        # Atualizar campos básicos
        campos_basicos = [
            "nome_fantasia",
            "razao_social",
            "inscricao_estadual",
            "email",
            "contato_nome",
            "prazo_entrega",
            "forma_pagamento",
            "classificacao",
            "ativo",
        ]

        for campo in campos_basicos:
            if campo in data:
                setattr(fornecedor, campo, data[campo])

        # Atualizar endereço
        campos_endereco = [
            "cep",
            "logradouro",
            "numero",
            "complemento",
            "bairro",
            "cidade",
            "estado",
            "pais",
        ]

        for campo in campos_endereco:
            if campo in data:
                setattr(fornecedor, campo, data[campo])

        fornecedor.data_atualizacao = datetime.now(timezone.utc)

        db.session.commit()

        # Log de auditoria
        current_app.logger.info(
            f"Fornecedor atualizado: {fornecedor.id} por {username}"
        )

        return jsonify(
            {
                "success": True,
                "message": "Fornecedor atualizado com sucesso",
                "fornecedor": fornecedor.to_dict(),
            }
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao atualizar fornecedor {id}: {str(e)}")
        return (
            jsonify(
                {"success": False, "message": "Erro interno ao atualizar fornecedor"}
            ),
            500,
        )


@fornecedores_bp.route("/<int:id>/status", methods=["PATCH"])
@funcionario_required
def atualizar_status_fornecedor(id):
    """Ativa/desativa um fornecedor"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")
        
        fornecedor = Fornecedor.query.filter_by(
            id=id, estabelecimento_id=estabelecimento_id
        ).first_or_404()

        data = request.get_json()
        novo_status = data.get("ativo")

        if novo_status is None:
            return (
                jsonify({"success": False, "message": 'Campo "ativo" é obrigatório'}),
                400,
            )

        # Verificar se há produtos ativos vinculados
        if not novo_status:  # Se estiver desativando
            produtos_ativos = Produto.query.filter_by(
                fornecedor_id=id,
                ativo=True,
                estabelecimento_id=estabelecimento_id,
            ).count()

            if produtos_ativos > 0:
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"Não é possível desativar o fornecedor. Existem {produtos_ativos} produtos ativos vinculados.",
                        }
                    ),
                    400,
                )

        fornecedor.ativo = novo_status
        fornecedor.data_atualizacao = datetime.now(timezone.utc)

        db.session.commit()

        acao = "ativado" if novo_status else "desativado"
        current_app.logger.info(
            f"Fornecedor {acao}: {fornecedor.id} por {username}"
        )

        return jsonify(
            {
                "success": True,
                "message": f"Fornecedor {acao} com sucesso",
                "ativo": fornecedor.ativo,
            }
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"Erro ao atualizar status do fornecedor {id}: {str(e)}"
        )
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Erro interno ao atualizar status do fornecedor",
                }
            ),
            500,
        )


@fornecedores_bp.route("/<int:id>", methods=["DELETE"])
@funcionario_required
def excluir_fornecedor(id):
    """Exclui um fornecedor (apenas se não houver vínculos)"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")
        
        fornecedor = Fornecedor.query.filter_by(
            id=id, estabelecimento_id=estabelecimento_id
        ).first_or_404()

        # Verificar vínculos
        # 1. Produtos vinculados
        produtos_count = Produto.query.filter_by(
            fornecedor_id=id, estabelecimento_id=estabelecimento_id
        ).count()

        # 2. Pedidos de compra
        pedidos_count = PedidoCompra.query.filter_by(
            fornecedor_id=id, estabelecimento_id=estabelecimento_id
        ).count()

        # 3. Contas a pagar
        contas_count = ContaPagar.query.filter_by(
            fornecedor_id=id, estabelecimento_id=estabelecimento_id
        ).count()

        if produtos_count > 0 or pedidos_count > 0 or contas_count > 0:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Não é possível excluir o fornecedor. Existem vínculos ativos.",
                        "vinculos": {
                            "produtos": produtos_count,
                            "pedidos": pedidos_count,
                            "contas": contas_count,
                        },
                    }
                ),
                400,
            )

        # Excluir fornecedor
        db.session.delete(fornecedor)
        db.session.commit()

        current_app.logger.info(
            f"Fornecedor excluído: {id} por {username}"
        )

        return jsonify({"success": True, "message": "Fornecedor excluído com sucesso"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao excluir fornecedor {id}: {str(e)}")
        return (
            jsonify(
                {"success": False, "message": "Erro interno ao excluir fornecedor"}
            ),
            500,
        )


@fornecedores_bp.route("/busca", methods=["GET"])
@funcionario_required
def buscar_fornecedores():
    """Busca rápida de fornecedores para autocomplete"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        termo = request.args.get("q", "", type=str).strip()
        limite = request.args.get("limite", 20, type=int)
        apenas_ativos = request.args.get("ativo", "true", type=str).lower() == "true"

        if not termo or len(termo) < 2:
            return jsonify({"success": True, "fornecedores": []})

        query = _supplier_query(estabelecimento_id)

        if apenas_ativos:
            query = query.filter_by(ativo=True)

        busca_termo = f"%{termo}%"
        fornecedores = (
            query.filter(
                db.or_(
                    ilike_unaccent(Fornecedor.nome_fantasia, busca_termo),
                    ilike_unaccent(Fornecedor.razao_social, busca_termo),
                    ilike_unaccent(Fornecedor.cnpj, busca_termo),
                    ilike_unaccent(Fornecedor.contato_nome, busca_termo),
                )
            )
            .limit(limite)
            .all()
        )

        resultados = []
        for fornecedor in fornecedores:
            resultados.append(
                {
                    "id": fornecedor.id,
                    "nome_fantasia": fornecedor.nome_fantasia,
                    "razao_social": fornecedor.razao_social,
                    "cnpj": fornecedor.cnpj,
                    "telefone": fornecedor.telefone,
                    "email": fornecedor.email,
                    "ativo": fornecedor.ativo,
                    "classificacao": calcular_classificacao_fornecedor(fornecedor),
                }
            )

        return jsonify(
            {"success": True, "fornecedores": resultados, "total": len(resultados)}
        )

    except Exception as e:
        current_app.logger.error(f"Erro na busca de fornecedores: {str(e)}")
        return (
            jsonify(
                {"success": False, "message": "Erro interno na busca de fornecedores"}
            ),
            500,
        )


@fornecedores_bp.route("/estatisticas", methods=["GET"])
@funcionario_required
def estatisticas_fornecedores():
    """Retorna estatísticas gerais sobre fornecedores"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        # Total de fornecedores
        total_fornecedores = _supplier_query(estabelecimento_id).count()

        # Fornecedores ativos
        fornecedores_ativos = _supplier_query(estabelecimento_id).filter_by(ativo=True).count()

        # Fornecedores inativos
        fornecedores_inativos = total_fornecedores - fornecedores_ativos

        # Classificação por tipo
        classificacoes = (
            _supplier_query(estabelecimento_id).with_entities(
                Fornecedor.classificacao, db.func.count(Fornecedor.id).label("total")
            )
            .group_by(Fornecedor.classificacao)
            .all()
        )

        # Fornecedores por estado
        fornecedores_por_estado = (
            _supplier_query(estabelecimento_id).with_entities(
                Fornecedor.estado, db.func.count(Fornecedor.id).label("total")
            )
            .group_by(Fornecedor.estado)
            .all()
        )

        # Top 5 fornecedores por volume de compras
        top_fornecedores = (
            _supplier_query(estabelecimento_id)
            .order_by(Fornecedor.valor_total_comprado.desc())
            .limit(5)
            .all()
        )

        top_fornecedores_list = []
        for f in top_fornecedores:
            top_fornecedores_list.append(
                {
                    "id": f.id,
                    "nome": f.nome_fantasia,
                    "valor_total": float(f.valor_total_comprado or 0),
                    "total_compras": f.total_compras or 0,
                }
            )

        # Últimos fornecedores cadastrados
        ultimos_cadastrados = (
            _supplier_query(estabelecimento_id)
            .order_by(Fornecedor.data_cadastro.desc())
            .limit(5)
            .all()
        )

        ultimos_cadastrados_list = []
        for f in ultimos_cadastrados:
            ultimos_cadastrados_list.append(
                {
                    "id": f.id,
                    "nome": f.nome_fantasia,
                    "data_cadastro": (
                        f.data_cadastro.isoformat() if f.data_cadastro else None
                    ),
                    "classificacao": calcular_classificacao_fornecedor(f),
                }
            )

        return jsonify(
            {
                "success": True,
                "estatisticas": {
                    "total": total_fornecedores,
                    "ativos": fornecedores_ativos,
                    "inativos": fornecedores_inativos,
                    "percentual_ativos": (
                        (fornecedores_ativos / total_fornecedores * 100)
                        if total_fornecedores > 0
                        else 0
                    ),
                    "classificacoes": {c[0]: c[1] for c in classificacoes},
                    "por_estado": {e[0]: e[1] for e in fornecedores_por_estado},
                },
                "top_fornecedores": top_fornecedores_list,
                "ultimos_cadastrados": ultimos_cadastrados_list,
            }
        )

    except Exception as e:
        current_app.logger.error(
            f"Erro ao obter estatísticas de fornecedores: {str(e)}"
        )
        return (
            jsonify(
                {"success": False, "message": "Erro interno ao obter estatísticas"}
            ),
            500,
        )


@fornecedores_bp.route("/<int:id>/pedidos", methods=["GET"])
@funcionario_required
def listar_pedidos_fornecedor(id):
    """Lista todos os pedidos de um fornecedor"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = request.args.get("por_pagina", 20, type=int)
        status = request.args.get("status", None, type=str)

        # Verificar se fornecedor existe
        fornecedor = _supplier_query(estabelecimento_id).filter_by(id=id).first_or_404()
        estabelecimento_id = fornecedor.estabelecimento_id

        # Query de pedidos
        query = PedidoCompra.query.filter_by(
            fornecedor_id=id, estabelecimento_id=estabelecimento_id
        )

        if status:
            query = query.filter_by(status=status)

        from sqlalchemy.orm import selectinload
        query = query.options(selectinload(PedidoCompra.itens), selectinload(PedidoCompra.funcionario))
        query = query.order_by(PedidoCompra.data_pedido.desc())

        # Paginação
        paginacao = query.paginate(page=pagina, per_page=por_pagina, error_out=False)

        pedidos = []
        for pedido in paginacao.items:
            pedidos.append(
                {
                    "id": pedido.id,
                    "numero_pedido": pedido.numero_pedido,
                    "data_pedido": (
                        pedido.data_pedido.isoformat() if pedido.data_pedido else None
                    ),
                    "data_previsao_entrega": (
                        pedido.data_previsao_entrega.isoformat()
                        if pedido.data_previsao_entrega
                        else None
                    ),
                    "status": pedido.status,
                    "total": float(pedido.total),
                    "quantidade_itens": len(pedido.itens),
                    "funcionario": (
                        pedido.funcionario.nome if pedido.funcionario else None
                    ),
                }
            )

        return jsonify(
            {
                "success": True,
                "pedidos": pedidos,
                "fornecedor": fornecedor.nome_fantasia,
                "total": paginacao.total,
                "pagina": pagina,
                "total_paginas": paginacao.pages,
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        current_app.logger.error(f"Erro ao listar pedidos do fornecedor {id}: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao listar pedidos"}),
            500,
        )


@fornecedores_bp.route("/exportar", methods=["GET"])
@funcionario_required
def exportar_fornecedores():
    """Exporta fornecedores em formato CSV ou Excel"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        formato = request.args.get("formato", "csv", type=str).lower()
        apenas_ativos = request.args.get("ativo", "true", type=str).lower() == "true"

        # Buscar fornecedores
        query = _supplier_query(estabelecimento_id)

        if apenas_ativos:
            query = query.filter_by(ativo=True)

        fornecedores = query.order_by(Fornecedor.nome_fantasia.asc()).all()

        if formato == "csv":
            # Gerar CSV
            import csv
            import io

            output = io.StringIO()
            writer = csv.writer(output, delimiter=";")

            # Cabeçalho
            writer.writerow(
                [
                    "ID",
                    "Nome Fantasia",
                    "Razão Social",
                    "CNPJ",
                    "Inscrição Estadual",
                    "Telefone",
                    "Email",
                    "Contato",
                    "Telefone Contato",
                    "Prazo Entrega",
                    "Forma Pagamento",
                    "Classificação",
                    "CEP",
                    "Logradouro",
                    "Número",
                    "Complemento",
                    "Bairro",
                    "Cidade",
                    "Estado",
                    "País",
                    "Ativo",
                    "Total Compras",
                    "Valor Total Comprado",
                    "Data Cadastro",
                ]
            )

            # Dados
            for f in fornecedores:
                writer.writerow(
                    [
                        f.id,
                        f.nome_fantasia or "",
                        f.razao_social or "",
                        f.cnpj or "",
                        f.inscricao_estadual or "",
                        f.telefone or "",
                        f.email or "",
                        f.contato_nome or "",
                        f.contato_telefone or "",
                        f.prazo_entrega or "",
                        f.forma_pagamento or "",
                        f.classificacao or "",
                        f.cep or "",
                        f.logradouro or "",
                        f.numero or "",
                        f.complemento or "",
                        f.bairro or "",
                        f.cidade or "",
                        f.estado or "",
                        f.pais or "",
                        "SIM" if f.ativo else "NÃO",
                        f.total_compras or 0,
                        float(f.valor_total_comprado or 0),
                        (
                            f.data_cadastro.strftime("%d/%m/%Y %H:%M:%S")
                            if f.data_cadastro
                            else ""
                        ),
                    ]
                )

            output.seek(0)
            return (
                output.getvalue(),
                200,
                {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": "attachment; filename=fornecedores.csv",
                },
            )

        elif formato == "excel":
            # Gerar Excel
            import pandas as pd

            dados = []
            for f in fornecedores:
                dados.append(
                    {
                        "ID": f.id,
                        "Nome Fantasia": f.nome_fantasia or "",
                        "Razão Social": f.razao_social or "",
                        "CNPJ": f.cnpj or "",
                        "Inscrição Estadual": f.inscricao_estadual or "",
                        "Telefone": f.telefone or "",
                        "Email": f.email or "",
                        "Contato": f.contato_nome or "",
                        "Telefone Contato": f.contato_telefone or "",
                        "Prazo Entrega": f.prazo_entrega or "",
                        "Forma Pagamento": f.forma_pagamento or "",
                        "Classificação": f.classificacao or "",
                        "CEP": f.cep or "",
                        "Logradouro": f.logradouro or "",
                        "Número": f.numero or "",
                        "Complemento": f.complemento or "",
                        "Bairro": f.bairro or "",
                        "Cidade": f.cidade or "",
                        "Estado": f.estado or "",
                        "País": f.pais or "",
                        "Ativo": "SIM" if f.ativo else "NÃO",
                        "Total Compras": f.total_compras or 0,
                        "Valor Total Comprado": float(f.valor_total_comprado or 0),
                        "Data Cadastro": (
                            f.data_cadastro.strftime("%d/%m/%Y %H:%M:%S")
                            if f.data_cadastro
                            else ""
                        ),
                    }
                )

            df = pd.DataFrame(dados)

            # Salvar em buffer
            from io import BytesIO

            output = BytesIO()
            with pd.ExcelWriter(output, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name="Fornecedores", index=False)

            output.seek(0)
            return (
                output.getvalue(),
                200,
                {
                    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "Content-Disposition": "attachment; filename=fornecedores.xlsx",
                },
            )

        else:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": 'Formato não suportado. Use "csv" ou "excel"',
                    }
                ),
                400,
            )

    except Exception as e:
        current_app.logger.error(f"Erro ao exportar fornecedores: {str(e)}")
        return (
            jsonify(
                {"success": False, "message": "Erro interno ao exportar fornecedores"}
            ),
            500,
        )


@fornecedores_bp.route("/importar", methods=["POST"])
@funcionario_required
def importar_fornecedores():
    """Importa fornecedores a partir de arquivo CSV"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        if "file" not in request.files:
            return jsonify({"success": False, "message": "Nenhum arquivo enviado"}), 400

        arquivo = request.files["file"]

        if arquivo.filename == "":
            return (
                jsonify({"success": False, "message": "Nenhum arquivo selecionado"}),
                400,
            )

        if not arquivo.filename.endswith(".csv"):
            return (
                jsonify(
                    {"success": False, "message": "Apenas arquivos CSV são suportados"}
                ),
                400,
            )

        import csv
        import io

        # Ler arquivo CSV
        stream = io.StringIO(arquivo.read().decode("utf-8-sig"))
        leitor = csv.DictReader(stream, delimiter=";")

        # Verificar cabeçalho mínimo
        cabecalhos_necessarios = [
            "nome_fantasia",
            "razao_social",
            "cnpj",
            "email",
            "telefone",
        ]
        cabecalhos_arquivo = leitor.fieldnames or []

        for cabecalho in cabecalhos_necessarios:
            if cabecalho not in cabecalhos_arquivo:
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"Cabeçalho obrigatório não encontrado: {cabecalho}",
                        }
                    ),
                    400,
                )

        # Processar linhas
        fornecedores_criados = 0
        fornecedores_atualizados = 0
        erros = []

        for linha_num, linha in enumerate(
            leitor, start=2
        ):  # start=2 para incluir cabeçalho
            try:
                # Verificar se fornecedor já existe pelo CNPJ
                cnpj_formatado = formatar_cnpj(linha["cnpj"])
                fornecedor_existente = Fornecedor.query.filter_by(
                    cnpj=cnpj_formatado,
                    estabelecimento_id=estabelecimento_id,
                ).first()

                if fornecedor_existente:
                    # Atualizar fornecedor existente
                    fornecedor_existente.nome_fantasia = linha["nome_fantasia"].strip()
                    fornecedor_existente.razao_social = linha["razao_social"].strip()
                    fornecedor_existente.email = linha["email"].strip().lower()
                    fornecedor_existente.telefone = formatar_telefone(linha["telefone"])
                    fornecedor_existente.data_atualizacao = datetime.now(timezone.utc)
                    fornecedores_atualizados += 1
                else:
                    # Criar novo fornecedor
                    fornecedor = Fornecedor(
                        estabelecimento_id=estabelecimento_id,
                        nome_fantasia=linha["nome_fantasia"].strip(),
                        razao_social=linha["razao_social"].strip(),
                        cnpj=cnpj_formatado,
                        email=linha["email"].strip().lower(),
                        telefone=formatar_telefone(linha["telefone"]),
                        # Campos opcionais
                        inscricao_estadual=linha.get("inscricao_estadual", "").strip(),
                        contato_nome=linha.get("contato_nome", "").strip(),
                        contato_telefone=formatar_telefone(
                            linha.get("contato_telefone", "")
                        ),
                        prazo_entrega=int(linha.get("prazo_entrega", 7)),
                        forma_pagamento=linha.get("forma_pagamento", "30 DIAS"),
                        classificacao=linha.get("classificacao", "REGULAR"),
                        # Endereço
                        cep=linha.get("cep", "").strip(),
                        logradouro=linha.get("logradouro", "").strip(),
                        numero=linha.get("numero", "").strip(),
                        complemento=linha.get("complemento", "").strip(),
                        bairro=linha.get("bairro", "").strip(),
                        cidade=linha.get("cidade", "").strip(),
                        estado=linha.get("estado", "").strip().upper(),
                        pais=linha.get("pais", "Brasil").strip(),
                        ativo=linha.get("ativo", "true").lower() == "true",
                        total_compras=0,
                        valor_total_comprado=0,
                    )
                    db.session.add(fornecedor)
                    fornecedores_criados += 1

            except Exception as e:
                erros.append(f"Linha {linha_num}: {str(e)}")

        db.session.commit()

        return jsonify(
            {
                "success": True,
                "message": "Importação concluída",
                "resultado": {
                    "criados": fornecedores_criados,
                    "atualizados": fornecedores_atualizados,
                    "erros": erros,
                },
            }
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao importar fornecedores: {str(e)}")
        return (
            jsonify(
                {"success": False, "message": "Erro interno ao importar fornecedores"}
            ),
            500,
        )


@fornecedores_bp.route("/relatorio/analitico", methods=["GET"])
@funcionario_required
def relatorio_analitico_fornecedores():
    """Gera relatório analítico detalhado dos fornecedores"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        # Parâmetros de filtro
        data_inicio = request.args.get("data_inicio", None)
        data_fim = request.args.get("data_fim", None)
        classificacao = request.args.get("classificacao", None, type=str)

        # Query base de fornecedores
        query = _supplier_query(estabelecimento_id).filter_by(ativo=True)

        if classificacao:
            query = query.filter_by(classificacao=classificacao.upper())

        fornecedores = query.all()

        relatorio = []
        for fornecedor in fornecedores:
            # Pedidos do fornecedor no período
            pedidos_query = PedidoCompra.query.filter_by(
                fornecedor_id=fornecedor.id,
                estabelecimento_id=fornecedor.estabelecimento_id,
            )

            if data_inicio:
                try:
                    data_inicio_dt = datetime.fromisoformat(data_inicio.replace('Z', '+00:00'))
                    pedidos_query = pedidos_query.filter(PedidoCompra.data_pedido >= data_inicio_dt)
                except ValueError:
                    # Fallback para parsing simples
                    data_inicio_dt = datetime.strptime(data_inicio.split('T')[0], "%Y-%m-%d")
                    pedidos_query = pedidos_query.filter(PedidoCompra.data_pedido >= data_inicio_dt)

            if data_fim:
                try:
                    data_fim_dt = datetime.fromisoformat(data_fim.replace('Z', '+00:00'))
                    # Se for apenas data (00:00:00), ajustar para 23:59:59
                    if data_fim_dt.hour == 0 and data_fim_dt.minute == 0:
                        data_fim_dt = data_fim_dt.replace(hour=23, minute=59, second=59, microsecond=999999)
                    pedidos_query = pedidos_query.filter(PedidoCompra.data_pedido <= data_fim_dt)
                except ValueError:
                    # Fallback para parsing simples
                    data_fim_dt = datetime.strptime(data_fim.split('T')[0], "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999)
                    pedidos_query = pedidos_query.filter(PedidoCompra.data_pedido <= data_fim_dt)

            pedidos = pedidos_query.all()

            # Cálculos
            total_pedidos = len(pedidos)
            valor_total = sum(float(p.total) for p in pedidos)
            pedidos_pendentes = len([p for p in pedidos if p.status == "pendente"])
            pedidos_concluidos = len([p for p in pedidos if p.status in ("concluido", "recebido")])

            # Pontualidade e atraso pelo mesmo critério da nota (services/fornecedor_score):
            # só entra pedido com recebimento registrado, sem data inventada.
            from app.services.fornecedor_score import avaliar_entregas, STATUS_ENCERRADOS
            entregas = avaliar_entregas(pedidos, fornecedor.prazo_entrega)
            tempos_entrega = [
                ((p.data_recebimento.date() if isinstance(p.data_recebimento, datetime) else p.data_recebimento)
                 - (p.data_pedido.date() if isinstance(p.data_pedido, datetime) else p.data_pedido)).days
                for p in pedidos
                if p.status in STATUS_ENCERRADOS and p.data_recebimento and p.data_pedido
            ]
            media_entrega = (sum(tempos_entrega) / len(tempos_entrega)) if tempos_entrega else None
            taxa_otd = entregas["percentual_no_prazo"]  # None quando não há entrega avaliada
            media_atraso = entregas["atraso_medio_dias"]

            # Produtos fornecidos e Variação de Preço (Simplificada)
            produtos = Produto.query.filter_by(
                fornecedor_id=fornecedor.id,
                estabelecimento_id=fornecedor.estabelecimento_id,
                ativo=True,
            ).all()

            total_produtos = len(produtos)
            
            # Mesma nota do cadastro (services/fornecedor_score): uma fórmula só.
            from app.services.fornecedor_score import calcular_metricas
            metricas_score = calcular_metricas(fornecedor)
            score = metricas_score["score"]

            # Adicionar ao relatório
            relatorio.append(
                {
                    "fornecedor": {
                        "id": fornecedor.id,
                        "nome": fornecedor.nome_fantasia,
                        "cnpj": fornecedor.cnpj,
                        "classificacao": fornecedor.classificacao,
                        "prazo_entrega_padrao": fornecedor.prazo_entrega,
                        "score": round(score, 1),
                        "score_confiavel": metricas_score["confiavel"],
                        "amostra_entregas": metricas_score["entregas"]["amostra"],
                    },
                    "metricas": {
                        "total_pedidos": total_pedidos,
                        "valor_total_comprado": valor_total,
                        "pedidos_pendentes": pedidos_pendentes,
                        "pedidos_concluidos": pedidos_concluidos,
                        "taxa_conclusao": (
                            (pedidos_concluidos / total_pedidos * 100)
                            if total_pedidos > 0
                            else 0
                        ),
                        "media_tempo_entrega": media_entrega,
                        "taxa_otd": taxa_otd,
                        "media_atraso": media_atraso,
                        "total_produtos": total_produtos,
                    },
                    "produtos": [
                        {
                            "id": p.id,
                            "nome": p.nome,
                            "preco_custo": float(p.preco_custo),
                            "preco_venda": float(p.preco_venda),
                            "margem": float(p.margem_lucro) if p.margem_lucro else 0,
                            "quantidade_estoque": p.quantidade,
                        }
                        for p in produtos[:10]
                    ],  # Limitar a 10 produtos
                }
            )

        return jsonify(
            {
                "success": True,
                "relatorio": relatorio,
                "total_fornecedores": len(relatorio),
                "filtros": {
                    "data_inicio": data_inicio,
                    "data_fim": data_fim,
                    "classificacao": classificacao,
                },
            }
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao gerar relatório analítico: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao gerar relatório"}),
            500,
        )


# ============================================
# UTILITÁRIOS DE FORNECEDOR
# ============================================


def sincronizar_metricas_fornecedor(fornecedor_id):
    """Recalcula e grava as métricas do fornecedor. Chamar após receber/devolver pedido de compra;
    nunca de dentro de um GET (leitura não pode gravar)."""
    from app.services.fornecedor_score import aplicar_metricas, calcular_metricas
    try:
        fornecedor = Fornecedor.query.get(fornecedor_id)
        if not fornecedor:
            return
        aplicar_metricas(fornecedor, calcular_metricas(fornecedor))
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao sincronizar métricas do fornecedor {fornecedor_id}: {str(e)}")


@fornecedores_bp.route("/<int:id>/inteligencia", methods=["GET"])
@funcionario_required
def get_inteligencia(id):
    """Retorna o dossiê avançado de inteligência do fornecedor"""
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        fornecedor = _supplier_query(estabelecimento_id).filter_by(id=id).first_or_404()
        estabelecimento_id = fornecedor.estabelecimento_id
        
        # Cálculo em tempo real, sem gravar: GET não altera cadastro.
        from app.services.fornecedor_score import calcular_metricas
        metricas = calcular_metricas(fornecedor)
        entregas = metricas["entregas"]
        
        # Busca últimos pedidos recebidos para a timeline
        pedidos = PedidoCompra.query.filter(
            PedidoCompra.fornecedor_id == id,
            PedidoCompra.estabelecimento_id == estabelecimento_id,
            PedidoCompra.status.in_(["concluido", "recebido", "parcial"])
        ).order_by(PedidoCompra.data_recebimento.desc()).limit(10).all()
        
        timeline = []
        from datetime import timedelta
        
        if pedidos:
            for p in pedidos:
                data_receb = p.data_recebimento
                if not data_receb and p.status in ['concluido', 'recebido', 'parcial']:
                    data_receb = p.data_pedido.date() if p.data_pedido else None
                    
                data_prev = p.data_previsao_entrega
                if not data_prev and p.data_pedido:
                    prazo = fornecedor.prazo_entrega or 7
                    data_prev = p.data_pedido.date() + timedelta(days=prazo)

                if data_receb and data_prev:
                    diff = (data_receb - data_prev).days
                    timeline.append({
                        "id": p.id,
                        "numero": p.numero_pedido,
                        "data": data_receb.isoformat(),
                        "total": float(p.total),
                        "atraso_dias": diff,
                        "no_prazo": diff <= 0
                    })
        else:
            # Se não há pedidos de compra, preencher a timeline com movimentações de estoque manuais!
            from app.models import MovimentacaoEstoque, Produto
            movs = MovimentacaoEstoque.query.join(Produto).filter(
                MovimentacaoEstoque.tipo == 'entrada',
                Produto.fornecedor_id == id,
                MovimentacaoEstoque.estabelecimento_id == estabelecimento_id
            ).order_by(MovimentacaoEstoque.created_at.desc()).limit(10).all()
            
            for m in movs:
                timeline.append({
                    "id": m.id,
                    "numero": f"MOV-{m.id}",
                    "data": m.created_at.date().isoformat() if m.created_at else None,
                    "total": float(m.valor_total or 0),
                    "atraso_dias": 0,
                    "no_prazo": True
                })
        
        return jsonify({
            "success": True,
            "inteligencia": {
                "score_geral": metricas["score"],
                "score_confiavel": metricas["confiavel"],
                "amostra_entregas": entregas["amostra"],
                "componentes_score": metricas["componentes"],
                "atraso_medio_dias": round(entregas["atraso_medio_dias"], 1),
                "percentual_entregas_no_prazo": round(entregas["percentual_no_prazo"] if entregas["amostra"] else 100.0, 1),
                "fill_rate": None if entregas["fill_rate"] is None else round(entregas["fill_rate"], 1),
                "taxa_avaria": None if entregas["taxa_avaria"] is None else round(entregas["taxa_avaria"], 1),
                "desconto_medio_percentual": round(metricas["desconto_medio_percentual"], 1),
                "prazo_pagamento_medio_dias": round(metricas["prazo_pagamento_medio_dias"], 1),
                "classificacao": metricas["classificacao"] or fornecedor.classificacao
            },
            "timeline": timeline
        }), 200
    except HTTPException:
        raise
    except Exception as e:
        current_app.logger.error(f"Erro inteligência: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500
