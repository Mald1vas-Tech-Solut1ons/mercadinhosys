from datetime import timezone
# app/clientes.py
# MÓDULO COMPLETO DE CLIENTES - ERP INDUSTRIAL BRASILEIRO
# CRUD completo com todas as operações necessárias para clientes CPF

from flask import Blueprint, request, jsonify, current_app
# from flask_login import login_required, current_user  # Removido - usando JWT
from flask_jwt_extended import get_jwt_identity, get_jwt, jwt_required
from app.utils.query_helpers import ilike_unaccent, documento_contem, get_authorized_establishment_id
from datetime import datetime, timedelta, date
from decimal import Decimal
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
import re
from app.models import db, Cliente, Estabelecimento, Venda, VendaItem, ContaReceber, Funcionario
from app.utils import validar_email, formatar_telefone, calcular_idade
# Validadores com dígito verificador (os de app.utils só conferiam o tamanho).
from app.utils.validators import validar_cpf, validar_cnpj
from app.utils.timezone import hoje_local
from app.utils.ia_copiloto import gerar_texto, ia_disponivel
from app.decorators.decorator_jwt import funcionario_required
from app.decorators.plan_guards import quota_required, permission_required

clientes_bp = Blueprint("clientes", __name__, url_prefix="/api/clientes")

# ============================================
# ESCOPO DO VENDEDOR EXTERNO
# ============================================
# O vendedor enxerga e cadastra clientes da própria carteira (rotas dele). Base inteira,
# exportação, estatísticas, importação, cobrança e edição de crédito ficam com a gerência:
# sem isso o vendedor leva a carteira da empresa (e os saldos) junto quando sai.
PAPEIS_VENDEDOR = ("VENDEDOR", "SFA", "SAF")
ENDPOINTS_VENDEDOR = {
    "clientes.listar_clientes", "clientes.buscar_clientes", "clientes.obter_cliente",
    "clientes.criar_cliente", "clientes.obter_credito_cliente",
}


def _eh_vendedor(claims) -> bool:
    return bool(claims) and not claims.get("is_super_admin") and str(claims.get("role") or "").upper() in PAPEIS_VENDEDOR


@clientes_bp.before_request
def _escopo_do_vendedor():
    from flask import g
    from flask_jwt_extended import verify_jwt_in_request
    from app.models import Rota
    if request.method == "OPTIONS":
        return None
    g.carteira_rotas = None  # nunca herdar o escopo de outra requisição que reaproveite o contexto
    try:
        verify_jwt_in_request(optional=True)
        claims = get_jwt()
    except Exception:
        return None  # sem token válido: o decorator da rota responde 401
    if not _eh_vendedor(claims):
        return None
    if request.endpoint not in ENDPOINTS_VENDEDOR:
        return jsonify({"success": False, "message": "Operação restrita à gerência."}), 403
    estabelecimento_id = claims.get("estabelecimento_id")
    # Consulta explícita: o tenant do request ainda não foi resolvido neste ponto.
    rotas = [r[0] for r in db.session.query(Rota.id).filter(
        Rota.estabelecimento_id == estabelecimento_id, Rota.vendedor_id == int(get_jwt_identity())).all()]
    g.carteira_rotas = rotas
    cliente_id = (request.view_args or {}).get("id")
    if cliente_id is not None and not db.session.query(Cliente.id).filter(
            Cliente.id == cliente_id, Cliente.estabelecimento_id == estabelecimento_id,
            Cliente.rota_id.in_(rotas or [-1])).first():
        return jsonify({"success": False, "message": "Cliente não encontrado"}), 404
    return None


def _restringir_carteira(query):
    """Vendedor só enxerga a própria carteira; os demais perfis passam direto."""
    from flask import g
    rotas = getattr(g, "carteira_rotas", None)
    return query if rotas is None else query.filter(Cliente.rota_id.in_(rotas or [-1]))

# ============================================
# VALIDAÇÕES ESPECÍFICAS DE CLIENTE (CPF)
# ============================================


def validar_dados_cliente(data, cliente_id=None, estabelecimento_id=None, is_update=False):
    """Valida todos os dados do cliente antes de salvar.

    is_update=True faz validação PARCIAL: campos obrigatórios só são exigidos
    quando enviados no payload (não pode mandá-los vazios, mas pode omiti-los).
    Sem isso, editar só o nome quebrava com 'Cpf/Celular obrigatório'.
    """
    erros = []

    # Tipo de pessoa: PF usa CPF; PJ usa CNPJ e razão social.
    atual = Cliente.query.filter_by(id=cliente_id, estabelecimento_id=estabelecimento_id).first() if cliente_id else None
    tipo = str(data.get("tipo_pessoa") or (atual.tipo_pessoa if atual else "PF")).upper()
    if tipo not in ("PF", "PJ"):
        erros.append("Tipo de pessoa deve ser PF ou PJ")
        tipo = "PF"

    # Validação de campos obrigatórios
    obrigatorios = ["celular"] + (["cnpj", "razao_social"] if tipo == "PJ" else ["nome", "cpf"])
    for campo in obrigatorios:
        if is_update:
            if campo in data and not data.get(campo):
                erros.append(f'O campo {campo.replace("_", " ").title()} não pode ficar vazio')
        elif not data.get(campo):
            erros.append(f'O campo {campo.replace("_", " ").title()} é obrigatório')
    if is_update and atual:
        # Trocar PF por PJ (ou o contrário) exige o documento do novo tipo.
        if tipo == "PJ" and not (data.get("cnpj") or atual.cnpj):
            erros.append("O campo Cnpj é obrigatório para pessoa jurídica")
        if tipo == "PF" and not (data.get("cpf") or atual.cpf):
            erros.append("O campo Cpf é obrigatório para pessoa física")

    # Validação de CPF
    if data.get("cpf"):
        cpf = re.sub(r"\D", "", str(data["cpf"]))
        cpf_formatado = formatar_cpf(cpf)
        if len(cpf) != 11:
            erros.append("CPF deve conter 11 dígitos")
        elif not validar_cpf(cpf):
            erros.append("CPF inválido")
        else:
            # Verifica se CPF já existe (exceto para o próprio cliente em atualização)
            cliente_existente = Cliente.query.filter(
                Cliente.estabelecimento_id == estabelecimento_id,
                db.or_(Cliente.cpf == cpf, Cliente.cpf == cpf_formatado),
            ).first()
            if cliente_existente and cliente_existente.id != cliente_id:
                erros.append("CPF já cadastrado para outro cliente")

    # Validação de CNPJ
    if data.get("cnpj"):
        cnpj = re.sub(r"\D", "", str(data["cnpj"]))
        cnpj_formatado = formatar_cnpj(cnpj)
        if len(cnpj) != 14:
            erros.append("CNPJ deve conter 14 dígitos")
        elif not validar_cnpj(cnpj):
            erros.append("CNPJ inválido")
        else:
            cliente_existente = Cliente.query.filter(
                Cliente.estabelecimento_id == estabelecimento_id,
                db.or_(Cliente.cnpj == cnpj, Cliente.cnpj == cnpj_formatado),
            ).first()
            if cliente_existente and cliente_existente.id != cliente_id:
                erros.append("CNPJ já cadastrado para outro cliente")

    if data.get("inscricao_estadual") and len(str(data["inscricao_estadual"]).strip()) > 20:
        erros.append("Inscrição estadual deve ter no máximo 20 caracteres")

    # Validação de email
    if data.get("email") and not validar_email(data["email"]):
        erros.append("Email inválido")

    # Validação de telefone celular
    if data.get("celular"):
        celular = re.sub(r"\D", "", data["celular"])
        if len(celular) not in [11, 13]:  # Aceitar 11 dígitos (BR) ou 13 (+55)
            erros.append("Celular deve conter 11 dígitos (com DDD) ou 13 dígitos (com +55)")

    # Validação de telefone fixo
    if data.get("telefone"):
        telefone = re.sub(r"\D", "", data["telefone"])
        if len(telefone) not in [10, 11]:
            erros.append("Telefone inválido")

    # Validação de data de nascimento
    if tipo == "PF" and data.get("data_nascimento"):
        try:
            data_nasc = datetime.strptime(data["data_nascimento"], "%Y-%m-%d").date()
            if data_nasc > date.today():
                erros.append("Data de nascimento não pode ser futura")
            elif calcular_idade(data_nasc) < 18:
                erros.append("Cliente deve ter pelo menos 18 anos")
        except ValueError:
            erros.append("Formato de data inválido. Use YYYY-MM-DD")

    # Validação de limite de crédito
    if data.get("limite_credito"):
        try:
            limite = Decimal(str(data["limite_credito"]))
            if limite < 0:
                erros.append("Limite de crédito não pode ser negativo")
        except:
            erros.append("Limite de crédito inválido")

    # Endereço é opcional para clientes PF em mercadinhos físicos.
    # Validação de CEP apenas se informado
    if data.get("cep"):
        cep = re.sub(r"\D", "", data["cep"])
        if len(cep) not in [8]:
            erros.append("CEP deve conter 8 dígitos")

    return erros


def formatar_cpf(cpf):
    """Formata CPF para o padrão 000.000.000-00"""
    cpf = re.sub(r"\D", "", cpf)
    if len(cpf) == 11:
        return f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"
    return cpf


def formatar_cnpj(cnpj):
    """Formata CNPJ para o padrão 00.000.000/0000-00"""
    cnpj = re.sub(r"\D", "", str(cnpj or ""))
    if len(cnpj) == 14:
        return f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:]}"
    return cnpj


def calcular_classificacao_cliente(cliente):
    """Calcula classificação do cliente baseado em histórico de compras"""
    total_compras = cliente.total_compras or 0
    valor_total_gasto = float(cliente.valor_total_gasto or 0)

    if valor_total_gasto > 10000:
        return "PREMIUM"
    elif valor_total_gasto > 5000:
        return "A"
    elif valor_total_gasto > 1000:
        return "B"
    elif total_compras > 0:
        return "C"
    else:
        return "NOVO"


def calcular_limite_disponivel(cliente):
    """Calcula limite de crédito disponível"""
    limite = float(cliente.limite_credito or 0)
    saldo_devedor = float(cliente.saldo_devedor or 0)
    return max(0, limite - saldo_devedor)


# ============================================
# ROTAS DE CLIENTES
# ============================================


@clientes_bp.route("/", methods=["GET"], strict_slashes=False)
@funcionario_required
def listar_clientes():
    """Lista todos os clientes com filtros e paginação"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        if estabelecimento_id is None:
            return jsonify({"success": False, "message": "Estabelecimento não identificado"}), 400
        
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = request.args.get("por_pagina", 50, type=int)
        ativo = request.args.get("ativo", None, type=str)
        classificacao = request.args.get("classificacao", None, type=str)
        busca = request.args.get("busca", "", type=str).strip()
        ordenar_por = request.args.get("ordenar_por", "id")
        direcao = request.args.get("direcao", "desc")

        # Query base
        query = _restringir_carteira(Cliente.query)
        if estabelecimento_id != 'all':
            query = query.filter_by(estabelecimento_id=estabelecimento_id)

        # Filtros
        if ativo is not None:
            query = query.filter_by(ativo=ativo.lower() == "true")

        if classificacao:
            # Classificação baseada em valor total gasto
            if classificacao == "PREMIUM":
                query = query.filter(Cliente.valor_total_gasto > 10000)
            elif classificacao == "A":
                query = query.filter(Cliente.valor_total_gasto.between(5000, 10000))
            elif classificacao == "B":
                query = query.filter(Cliente.valor_total_gasto.between(1000, 5000))
            elif classificacao == "C":
                query = query.filter(Cliente.valor_total_gasto > 0)
            elif classificacao == "NOVO":
                query = query.filter(Cliente.total_compras == 0)

        if busca:
            busca_termo = f"%{busca}%"
            query = query.filter(
                db.or_(
                    ilike_unaccent(Cliente.nome, busca_termo),
                    documento_contem(Cliente.cpf, busca),
                    documento_contem(Cliente.cnpj, busca),
                    ilike_unaccent(Cliente.razao_social, busca_termo),
                    ilike_unaccent(Cliente.email, busca_termo),
                    ilike_unaccent(Cliente.celular, busca_termo),
                    ilike_unaccent(Cliente.telefone, busca_termo),
                )
            )

        # Ordenação
        campos_ordenacao = {
            "id": Cliente.id,
            "nome": Cliente.nome,
            "cpf": Cliente.cpf,
            "cnpj": Cliente.cnpj,
            "valor_total_gasto": Cliente.valor_total_gasto,
            "total_compras": Cliente.total_compras,
            "data_cadastro": Cliente.data_cadastro,
            "ultima_compra": Cliente.ultima_compra,
        }

        campo_ordenacao = campos_ordenacao.get(ordenar_por, Cliente.nome)
        if direcao == "desc":
            query = query.order_by(campo_ordenacao.desc())
        else:
            query = query.order_by(campo_ordenacao.asc())

        # Paginação
        paginacao = query.paginate(page=pagina, per_page=por_pagina, error_out=False)

        clientes = []
        for cliente in paginacao.items:
            cliente_dict = cliente.to_dict()
            cliente_dict["classificacao"] = calcular_classificacao_cliente(cliente)
            cliente_dict["limite_disponivel"] = calcular_limite_disponivel(cliente)
            cliente_dict["idade"] = (
                calcular_idade(cliente.data_nascimento)
                if cliente.data_nascimento
                else None
            )

            # Dias desde última compra
            if cliente.ultima_compra:
                dias_desde_ultima_compra = (
                    datetime.utcnow() - cliente.ultima_compra
                ).days
                cliente_dict["dias_sem_comprar"] = dias_desde_ultima_compra
            else:
                cliente_dict["dias_sem_comprar"] = None

            clientes.append(cliente_dict)

        # Estatísticas
        total_clientes = paginacao.total
        # Contagem de ativos: usa nova query para não acumular filtros da query paginada
        query_ativos = Cliente.query
        if estabelecimento_id != 'all':
            query_ativos = query_ativos.filter_by(estabelecimento_id=estabelecimento_id)
        clientes_ativos = (
            query_ativos.filter_by(ativo=True).count() if ativo is None else paginacao.total
        )
        clientes_inativos = total_clientes - clientes_ativos
        
        # Calcular Dashboard do Cliente Global (apenas para o estabelecimento atual)
        query_gasto = db.session.query(db.func.sum(Cliente.valor_total_gasto))
        query_devido = db.session.query(db.func.sum(Cliente.saldo_devedor))
        if estabelecimento_id is not None and estabelecimento_id != 'all':
             query_gasto = query_gasto.filter_by(estabelecimento_id=estabelecimento_id)
             query_devido = query_devido.filter_by(estabelecimento_id=estabelecimento_id)
        total_gasto_geral = query_gasto.scalar() or 0
        total_devido_geral = query_devido.scalar() or 0
        
        # Janela ROLANTE de 30 dias (não "mês calendário desde o dia 1") para
        # Clientes Cadastrados. Com o mês calendário, o card sempre parecia
        # "quebrado" nos primeiros dias do mês (ex.: dia 3 só soma 3 dias de
        # vendas) — enganoso para o lojista, que lia como "receita mensal
        # típica". 30 dias corridos dá uma leitura sempre justa.
        from datetime import date
        hoje = date.today()
        trinta_dias_atras = hoje - timedelta(days=30)

        query_gasto_mes = db.session.query(db.func.sum(Venda.total)).filter(
            Venda.status == 'finalizada',
            Venda.cliente_id.isnot(None),
            Venda.data_venda >= trinta_dias_atras
        )
        if estabelecimento_id is not None and estabelecimento_id != 'all':
             query_gasto_mes = query_gasto_mes.filter(Venda.estabelecimento_id == estabelecimento_id)
        
        total_gasto_mes = query_gasto_mes.scalar() or 0
        
        query_melhor = Cliente.query
        query_maior = Cliente.query
        if estabelecimento_id is not None and estabelecimento_id != 'all':
            query_melhor = query_melhor.filter_by(estabelecimento_id=estabelecimento_id)
            query_maior = query_maior.filter_by(estabelecimento_id=estabelecimento_id)
        
        melhor_cliente = query_melhor.order_by(Cliente.valor_total_gasto.desc()).first()
        maior_devedor = query_maior.order_by(Cliente.saldo_devedor.desc()).first()

        return jsonify(
            {
                "success": True,
                "clientes": clientes,
                "total": total_clientes,
                "pagina": pagina,
                "por_pagina": por_pagina,
                "total_paginas": paginacao.pages,
                "estatisticas": {
                    "total": total_clientes,
                    "ativos": clientes_ativos,
                    "inativos": clientes_inativos,
                    "percentual_ativos": (
                        (clientes_ativos / total_clientes * 100)
                        if total_clientes > 0
                        else 0
                    ),
                    "total_gasto": float(total_gasto_geral or 0),
                    "total_gasto_mes": float(total_gasto_mes or 0),
                    "total_devido": float(total_devido_geral or 0),
                    "melhor_cliente_nome": melhor_cliente.nome if melhor_cliente and float(melhor_cliente.valor_total_gasto or 0) > 0 else "Nenhum",
                    "melhor_cliente_valor": float(melhor_cliente.valor_total_gasto if melhor_cliente and melhor_cliente.valor_total_gasto else 0),
                    "maior_devedor_nome": maior_devedor.nome if maior_devedor and float(maior_devedor.saldo_devedor or 0) > 0 else "Nenhum",
                    "maior_devedor_valor": float(maior_devedor.saldo_devedor if maior_devedor and maior_devedor.saldo_devedor else 0),
                },
            }
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao listar clientes: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao listar clientes"}),
            500,
        )


@clientes_bp.route("/<int:id>", methods=["GET"])
@funcionario_required
def obter_cliente(id):
    """Obtém detalhes completos de um cliente específico"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        if estabelecimento_id is None:
            return jsonify({"success": False, "message": "Estabelecimento não identificado"}), 400

        # SuperAdmin pode buscar qualquer cliente; outros usuários são filtrados pelo estabelecimento
        if estabelecimento_id == 'all':
            cliente = Cliente.query.filter_by(id=id).first_or_404()
        else:
            cliente = Cliente.query.filter_by(
                id=id, estabelecimento_id=estabelecimento_id
            ).first_or_404()

        # Dados básicos
        dados_cliente = cliente.to_dict()

        # Estatísticas detalhadas
        vendas = Venda.query.filter_by(
            cliente_id=id, estabelecimento_id=estabelecimento_id
        ).all()

        contas_receber = ContaReceber.query.filter_by(
            cliente_id=id,
            estabelecimento_id=estabelecimento_id,
            status="aberto",
        ).all()

        # Últimas vendas
        ultimas_vendas = (
            Venda.query.filter_by(
                cliente_id=id, estabelecimento_id=estabelecimento_id
            )
            .order_by(Venda.data_venda.desc())
            .limit(10)
            .all()
        )

        # Produtos preferidos
        produtos_preferidos = (
            db.session.query(
                VendaItem.produto_nome,
                VendaItem.produto_codigo,
                db.func.sum(VendaItem.quantidade).label("quantidade_total"),
                db.func.sum(VendaItem.total_item).label("valor_total"),
            )
            .join(Venda, Venda.id == VendaItem.venda_id)
            .filter(
                Venda.cliente_id == id,
                Venda.estabelecimento_id == estabelecimento_id,
            )
            .group_by(VendaItem.produto_nome, VendaItem.produto_codigo)
            .order_by(db.func.sum(VendaItem.quantidade).desc())
            .limit(5)
            .all()
        )

        # Métricas
        total_vendas = len(vendas)
        vendas_ultimo_mes = len(
            [
                v
                for v in vendas
                if v.data_venda and (datetime.utcnow() - v.data_venda).days <= 30
            ]
        )
        valor_medio_compra = (
            float(cliente.valor_total_gasto / cliente.total_compras)
            if cliente.total_compras > 0
            else 0
        )
        total_contas_abertas = len(contas_receber)
        valor_total_devendo = sum(float(c.valor_atual) for c in contas_receber)

        # Última compra
        ultima_compra = (
            Venda.query.filter_by(
                cliente_id=id, estabelecimento_id=estabelecimento_id
            )
            .order_by(Venda.data_venda.desc())
            .first()
        )

        # Ticket médio por período
        hoje = datetime.utcnow()
        periodos = {
            "ultimo_mes": (hoje - timedelta(days=30), hoje),
            "ultimos_3_meses": (hoje - timedelta(days=90), hoje),
            "ultimo_ano": (hoje - timedelta(days=365), hoje),
        }

        ticket_medio_periodo = {}
        for periodo, (inicio, fim) in periodos.items():
            vendas_periodo = [v for v in vendas if inicio <= v.data_venda <= fim]
            if vendas_periodo:
                ticket_medio_periodo[periodo] = sum(
                    float(v.total) for v in vendas_periodo
                ) / len(vendas_periodo)
            else:
                ticket_medio_periodo[periodo] = 0

        # Lista de vendas formatada
        vendas_lista = []
        for venda in ultimas_vendas:
            vendas_lista.append(
                {
                    "id": venda.id,
                    "codigo": venda.codigo,
                    "data_venda": (
                        venda.data_venda.isoformat() if venda.data_venda else None
                    ),
                    "total": float(venda.total),
                    "forma_pagamento": (venda.pagamentos[0].forma_pagamento if venda.pagamentos else "N/A"),
                    "status": venda.status,
                    "quantidade_itens": venda.quantidade_itens,
                }
            )

        # Lista de produtos preferidos
        produtos_preferidos_lista = []
        for produto_nome, produto_codigo, quantidade, valor in produtos_preferidos:
            produtos_preferidos_lista.append(
                {
                    "nome": produto_nome,
                    "codigo": produto_codigo,
                    "quantidade_total": int(quantidade),
                    "valor_total": float(valor),
                }
            )

        return jsonify(
            {
                "success": True,
                "cliente": dados_cliente,
                "metricas": {
                    "total_compras": total_vendas,
                    "vendas_ultimo_mes": vendas_ultimo_mes,
                    "valor_total_gasto": float(cliente.valor_total_gasto or 0),
                    "valor_medio_compra": valor_medio_compra,
                    "ticket_medio_periodo": ticket_medio_periodo,
                    "total_contas_abertas": total_contas_abertas,
                    "valor_total_devendo": valor_total_devendo,
                    "classificacao": calcular_classificacao_cliente(cliente),
                    "limite_disponivel": calcular_limite_disponivel(cliente),
                    "limite_utilizado_percent": (
                        (
                            float(cliente.saldo_devedor or 0)
                            / float(cliente.limite_credito or 1)
                            * 100
                        )
                        if cliente.limite_credito > 0
                        else 0
                    ),
                    "idade": (
                        calcular_idade(cliente.data_nascimento)
                        if cliente.data_nascimento
                        else None
                    ),
                },
                "ultimas_compras": vendas_lista,
                "produtos_preferidos": produtos_preferidos_lista,
                "endereco_completo": (
                    cliente.endereco_completo()
                    if hasattr(cliente, "endereco_completo")
                    else None
                ),
            }
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao obter cliente {id}: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao obter cliente"}),
            500,
        )


@clientes_bp.route("/", methods=["POST"], strict_slashes=False)
@jwt_required()
@permission_required('clientes')
@quota_required('cliente')
def criar_cliente():
    """Cria um novo cliente"""
    try:
        # Get establishment context (supports Super-Admin impersonation)
        jwt_data = get_jwt()
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")

        if estabelecimento_id is None:
            return jsonify({"success": False, "message": "Estabelecimento não identificado"}), 400
        
        data = request.get_json()

        # Validação dos dados
        erros = validar_dados_cliente(data, estabelecimento_id=estabelecimento_id)
        if erros:
            return (
                jsonify(
                    {"success": False, "message": "Erros de validação", "errors": erros}
                ),
                400,
            )

        # Formatar dados
        tipo = str(data.get("tipo_pessoa") or "PF").upper()
        cpf_formatado = formatar_cpf(data["cpf"]) if data.get("cpf") else None
        cnpj_formatado = formatar_cnpj(data["cnpj"]) if tipo == "PJ" and data.get("cnpj") else None
        celular_formatado = formatar_telefone(data["celular"])

        # Cliente cadastrado pelo vendedor entra na carteira dele; sem rota ele nunca aparece no app.
        rota_id = None
        if str(jwt_data.get("role") or "").upper() in ("VENDEDOR", "SFA", "SAF"):
            from app.models import Rota
            rota = Rota.query.filter_by(estabelecimento_id=estabelecimento_id, vendedor_id=int(get_jwt_identity()),
                                        ativa=True).order_by(Rota.id).first()
            rota_id = rota.id if rota else None

        # Criar cliente
        cliente = Cliente(
            estabelecimento_id=estabelecimento_id,
            rota_id=rota_id,
            tipo_pessoa=tipo,
            nome=(data.get("nome") or data.get("razao_social") or "").strip(),
            cpf=cpf_formatado,
            cnpj=cnpj_formatado,
            razao_social=(data.get("razao_social") or "").strip() or None,
            inscricao_estadual=(data.get("inscricao_estadual") or "").strip() or None,
            contato_nome=(data.get("contato_nome") or "").strip() or None,
            rg=data.get("rg", "").strip(),
            data_nascimento=(
                datetime.strptime(data["data_nascimento"], "%Y-%m-%d").date()
                if data.get("data_nascimento")
                else None
            ),
            telefone=formatar_telefone(data.get("telefone", "")),
            celular=celular_formatado,
            email=data.get("email", "").strip().lower(),
            # Crédito é decisão da gerência: cliente cadastrado pelo vendedor nasce sem limite.
            limite_credito=Decimal("0") if _eh_vendedor(jwt_data) else Decimal(str(data.get("limite_credito", 0))),
            saldo_devedor=Decimal("0"),
            # Endereço
            cep=data.get("cep", "").strip(),
            logradouro=data.get("logradouro", "").strip(),
            numero=data.get("numero", "").strip(),
            complemento=data.get("complemento", "").strip(),
            bairro=data.get("bairro", "").strip(),
            cidade=data.get("cidade", "").strip(),
            estado=(
                data.get("estado", "").strip().upper() if data.get("estado") else ""
            ),
            pais=data.get("pais", "Brasil").strip(),
            ativo=data.get("ativo", True),
            observacoes=data.get("observacoes", "").strip(),
            total_compras=0,
            valor_total_gasto=Decimal("0"),
            ultima_compra=None,
        )

        db.session.add(cliente)
        db.session.commit()
        
        # Recarregar do banco para garantir persistência real
        db.session.refresh(cliente)

        # Log de auditoria
        current_app.logger.info(
            f"Cliente criado: {cliente.id} - {cliente.nome} por {jwt_data.get('sub')}"
        )

        return (
            jsonify(
                {
                    "success": True,
                    "message": "Cliente criado com sucesso",
                    "cliente": cliente.to_dict(),
                }
            ),
            201,
        )

    except IntegrityError as e:
        db.session.rollback()
        error_msg = str(e.orig) if hasattr(e, 'orig') else str(e)
        current_app.logger.error(f"IntegrityError ao criar cliente: {error_msg}")
        
        # Identifica pelo nome da restrição (o texto do INSERT cita as duas colunas)
        baixo = error_msg.lower()
        if "uq_cliente_estab_cnpj" in baixo or "clientes.cnpj" in baixo:
            return (
                jsonify({"success": False, "message": "Este CNPJ já está cadastrado para outro cliente deste estabelecimento."}),
                400,
            )
        if "uq_cliente_estab_cpf" in baixo or "clientes.cpf" in baixo:
            return (
                jsonify({"success": False, "message": "Este CPF já está cadastrado para outro cliente deste estabelecimento."}),
                400,
            )
        
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Erro de integridade nos dados. Verifique se todos os campos obrigatórios foram preenchidos corretamente.",
                    "details": error_msg if current_app.debug else None
                }
            ),
            400,
        )
    except Exception as e:
        db.session.rollback()
        import traceback
        current_app.logger.error(f"Erro ao criar cliente: {str(e)}")
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify({"success": False, "message": "Erro interno ao criar cliente"}),
            500,
        )


@clientes_bp.route("/<int:id>", methods=["PUT"])
@funcionario_required
def atualizar_cliente(id):
    """Atualiza um cliente existente"""
    try:
        # Get establishment context (supports Super-Admin impersonation)
        jwt_data = get_jwt()
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")

        if estabelecimento_id is None:
            return jsonify({"success": False, "message": "Estabelecimento não identificado"}), 400

        if estabelecimento_id == 'all':
            cliente = Cliente.query.filter_by(id=id).first_or_404()
        else:
            cliente = Cliente.query.filter_by(
                id=id, estabelecimento_id=estabelecimento_id
            ).first_or_404()

        data = request.get_json()

        # Validação PARCIAL (update): só exige campos enviados
        erros = validar_dados_cliente(data, cliente.id, estabelecimento_id, is_update=True)
        if erros:
            return (
                jsonify(
                    {"success": False, "message": "Erros de validação", "errors": erros}
                ),
                400,
            )

        # Formatar dados
        if data.get("tipo_pessoa"):
            cliente.tipo_pessoa = str(data["tipo_pessoa"]).upper()
        if "cpf" in data:
            cliente.cpf = formatar_cpf(data["cpf"]) if data["cpf"] else None
        if "cnpj" in data:
            cliente.cnpj = formatar_cnpj(data["cnpj"]) if data["cnpj"] else None

        if "celular" in data:
            cliente.celular = formatar_telefone(data["celular"])

        if "telefone" in data:
            cliente.telefone = formatar_telefone(data["telefone"])

        # Atualizar campos básicos
        campos_basicos = [
            "nome",
            "rg",
            "email",
            "limite_credito",
            "observacoes",
            "ativo",
            "razao_social",
            "inscricao_estadual",
            "contato_nome",
        ]

        for campo in campos_basicos:
            if campo in data:
                if campo == "limite_credito":
                    try:
                        valor_limite = data[campo]
                        if valor_limite is None or valor_limite == "":
                            cliente.limite_credito = Decimal("0")
                        else:
                            cliente.limite_credito = Decimal(str(valor_limite))
                    except (ValueError, TypeError):
                        cliente.limite_credito = Decimal("0")
                elif campo == "data_nascimento" and data[campo]:
                    cliente.data_nascimento = datetime.strptime(
                        data[campo], "%Y-%m-%d"
                    ).date()
                else:
                    setattr(cliente, campo, data[campo])

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
                setattr(cliente, campo, data[campo])

        cliente.data_atualizacao = datetime.utcnow()

        db.session.commit()

        # Log de auditoria
        current_app.logger.info(
            f"Cliente atualizado: {cliente.id} por {jwt_data.get('sub')}"
        )

        return jsonify(
            {
                "success": True,
                "message": "Cliente atualizado com sucesso",
                "cliente": cliente.to_dict(),
            }
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao atualizar cliente {id}: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao atualizar cliente"}),
            500,
        )


@clientes_bp.route("/<int:id>/status", methods=["PATCH"])
@funcionario_required
def atualizar_status_cliente(id):
    """Ativa/desativa um cliente"""
    try:
        # Get establishment context (supports Super-Admin impersonation)
        jwt_data = get_jwt()
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")

        if estabelecimento_id is None:
            return jsonify({"success": False, "message": "Estabelecimento não identificado"}), 400

        if estabelecimento_id == 'all':
            cliente = Cliente.query.filter_by(id=id).first_or_404()
        else:
            cliente = Cliente.query.filter_by(
                id=id, estabelecimento_id=estabelecimento_id
            ).first_or_404()

        data = request.get_json()
        novo_status = data.get("ativo")

        if novo_status is None:
            return (
                jsonify({"success": False, "message": 'Campo "ativo" é obrigatório'}),
                400,
            )

        # Verificar se há contas em aberto (apenas informativo)
        if not novo_status:  # Se estiver desativando
            contas_abertas = ContaReceber.query.filter_by(
                cliente_id=id,
                status="aberto",
                estabelecimento_id=estabelecimento_id,
            ).count()

            if contas_abertas > 0:
                current_app.logger.warning(
                    f"Desativando cliente {id} com {contas_abertas} contas em aberto."
                )

        cliente.ativo = novo_status
        cliente.data_atualizacao = datetime.utcnow()

        db.session.commit()

        acao = "ativado" if novo_status else "desativado"
        current_app.logger.info(
            f"Cliente {acao}: {cliente.id} por {jwt_data.get('sub')}"
        )

        return jsonify(
            {
                "success": True,
                "message": f"Cliente {acao} com sucesso",
                "ativo": cliente.ativo,
            }
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao atualizar status do cliente {id}: {str(e)}")
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Erro interno ao atualizar status do cliente",
                }
            ),
            500,
        )


@clientes_bp.route("/<int:id>", methods=["DELETE"])
@funcionario_required
def excluir_cliente(id):
    """Exclui um cliente (apenas se não houver vínculos)"""
    try:
        # Get establishment context (supports Super-Admin impersonation)
        jwt_data = get_jwt()
        estabelecimento_id = get_authorized_establishment_id()
        username = jwt_data.get("sub")

        if estabelecimento_id is None:
            return jsonify({"success": False, "message": "Estabelecimento não identificado"}), 400

        if estabelecimento_id == 'all':
            cliente = Cliente.query.filter_by(id=id).first_or_404()
        else:
            cliente = Cliente.query.filter_by(
                id=id, estabelecimento_id=estabelecimento_id
            ).first_or_404()

        # Verificar vínculos
        # 1. Vendas vinculadas
        vendas_count = Venda.query.filter_by(
            cliente_id=id, estabelecimento_id=estabelecimento_id
        ).count()

        # 2. Contas a receber
        contas_count = ContaReceber.query.filter_by(
            cliente_id=id, estabelecimento_id=estabelecimento_id
        ).count()

        if vendas_count > 0 or contas_count > 0:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Não é possível excluir o cliente. Existem vínculos ativos.",
                        "vinculos": {
                            "vendas": vendas_count,
                            "contas_a_receber": contas_count,
                        },
                    }
                ),
                400,
            )

        # Excluir cliente
        db.session.delete(cliente)
        db.session.commit()

        current_app.logger.info(f"Cliente excluído: {id} por {jwt_data.get('sub')}")

        return jsonify({"success": True, "message": "Cliente excluído com sucesso"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao excluir cliente {id}: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao excluir cliente"}),
            500,
        )


@clientes_bp.route("/buscar", methods=["GET"])
@funcionario_required
def buscar_clientes():
    """Busca rápida de clientes para autocomplete"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        termo = request.args.get("q", "", type=str).strip()
        limite = request.args.get("limite", 20, type=int)
        apenas_ativos = request.args.get("ativo", "true", type=str).lower() == "true"
        com_compras = request.args.get("com_compras", None, type=str)

        if not termo or len(termo) < 2:
            return jsonify({"success": True, "clientes": []})

        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        query = _restringir_carteira(Cliente.query).filter_by(
            estabelecimento_id=estabelecimento_id
        )

        if apenas_ativos:
            query = query.filter_by(ativo=True)

        if com_compras == "true":
            query = query.filter(Cliente.total_compras > 0)
        elif com_compras == "false":
            query = query.filter(Cliente.total_compras == 0)

        busca_termo = f"%{termo}%"
        clientes = (
            query.filter(
                db.or_(
                    ilike_unaccent(Cliente.nome, busca_termo),
                    documento_contem(Cliente.cpf, termo),
                    documento_contem(Cliente.cnpj, termo),
                    ilike_unaccent(Cliente.razao_social, busca_termo),
                    ilike_unaccent(Cliente.email, busca_termo),
                    ilike_unaccent(Cliente.celular, busca_termo),
                )
            )
            .limit(limite)
            .all()
        )

        resultados = []
        for cliente in clientes:
            resultados.append(
                {
                    "id": cliente.id,
                    "nome": cliente.nome,
                    "cpf_cnpj": cliente.documento,  # Alias para compatibilidade frontend
                    "documento": cliente.documento,
                    "tipo_pessoa": cliente.tipo_pessoa,
                    "razao_social": cliente.razao_social or "",
                    "cpf": cliente.cpf or "",
                    "cnpj": cliente.cnpj or "",
                    "telefone": cliente.celular or "",  # Alias para compatibilidade frontend
                    "celular": cliente.celular or "",
                    "email": cliente.email or "",
                    "ativo": cliente.ativo,
                    "total_compras": cliente.total_compras or 0,  # Quantidade de compras
                    "valor_total_gasto": float(cliente.valor_total_gasto or 0), # Dinheiro gasto
                    "frequencia_compras": cliente.total_compras or 0,
                    "saldo_devedor": float(cliente.saldo_devedor or 0), # Fiado
                    "classificacao": calcular_classificacao_cliente(cliente),
                    "limite_disponivel": calcular_limite_disponivel(cliente),
                    "cep": cliente.cep or "",
                    "logradouro": cliente.logradouro or "",
                    "numero": cliente.numero or "",
                    "bairro": cliente.bairro or "",
                    "cidade": cliente.cidade or "",
                    "estado": cliente.estado or "",
                }
            )

        return jsonify(
            {"success": True, "clientes": resultados, "total": len(resultados)}
        )

    except Exception as e:
        current_app.logger.error(f"Erro na busca de clientes: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno na busca de clientes"}),
            500,
        )


@clientes_bp.route("/recalcular-metricas", methods=["POST"])
@funcionario_required
def recalcular_metricas_clientes():
    """
    Recalcula total_compras, valor_total_gasto, ultima_compra e saldo_devedor
    de todos os clientes a partir das vendas e contas reais no banco.
    Útil para sincronizar dados após seeds ou migrações.
    """
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        if str(estabelecimento_id).lower() == 'all':
            clientes_lista = Cliente.query.all()
        else:
            clientes_lista = Cliente.query.filter_by(estabelecimento_id=estabelecimento_id).all()
            
        atualizados = 0

        for cliente in clientes_lista:
            # Vendas do cliente
            q_vendas = Venda.query.filter_by(cliente_id=cliente.id, status="finalizada")
            if str(estabelecimento_id).lower() != 'all':
                q_vendas = q_vendas.filter_by(estabelecimento_id=estabelecimento_id)
            vendas_cliente = q_vendas.all()

            total_compras = len(vendas_cliente)
            valor_total_gasto = sum(float(v.total or 0) for v in vendas_cliente)
            ultima_compra = max((v.data_venda for v in vendas_cliente if v.data_venda), default=None)

            # Contas a receber em aberto (fiado)
            q_contas = ContaReceber.query.filter_by(cliente_id=cliente.id, status="aberto")
            if str(estabelecimento_id).lower() != 'all':
                q_contas = q_contas.filter_by(estabelecimento_id=estabelecimento_id)
            contas_abertas = q_contas.all()
            saldo_devedor = sum(float(c.valor_atual or 0) for c in contas_abertas)

            cliente.total_compras = total_compras
            cliente.valor_total_gasto = valor_total_gasto
            cliente.ultima_compra = ultima_compra
            cliente.saldo_devedor = saldo_devedor
            from app.services.credito_service import recalcular_credito
            recalcular_credito(cliente)
            atualizados += 1

        db.session.commit()
        current_app.logger.info(
            f"Recálculo de métricas concluído: {atualizados} clientes atualizados (estab={estabelecimento_id})"
        )

        return jsonify({
            "success": True,
            "message": f"{atualizados} clientes tiveram suas métricas recalculadas com sucesso.",
            "clientes_atualizados": atualizados
        })

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao recalcular métricas: {str(e)}")
        return jsonify({"success": False, "message": "Erro ao recalcular métricas"}), 500




@clientes_bp.route("/<int:id>/contas_fiado", methods=["GET"])
@funcionario_required
def listar_contas_fiado(id):
    """Lista as vendas fiado EM ABERTO do cliente, para o funcionário conseguir
    justificar o saldo devedor ("essas 3 compras somam R$100") em vez de mostrar
    só um número solto sem explicação — o que gera questionamento do cliente."""
    try:
        estabelecimento_id = get_authorized_establishment_id()
        cliente = Cliente.query.filter_by(
            id=id, estabelecimento_id=estabelecimento_id
        ).first_or_404()

        hoje = date.today()
        contas = (
            ContaReceber.query.filter_by(
                cliente_id=id, estabelecimento_id=estabelecimento_id, status="aberto"
            )
            .order_by(ContaReceber.data_emissao.asc())  # mais antiga primeiro (FIFO)
            .all()
        )

        itens = []
        for c in contas:
            venda = c.venda
            itens.append({
                "conta_receber_id": c.id,
                "numero_documento": c.numero_documento,
                "venda_id": c.venda_id,
                "venda_codigo": venda.codigo if venda else None,
                "data_emissao": c.data_emissao.isoformat() if c.data_emissao else None,
                "data_vencimento": c.data_vencimento.isoformat() if c.data_vencimento else None,
                "valor_original": float(c.valor_original or 0),
                "valor_atual": float(c.valor_atual or 0),
                "dias_em_aberto": (hoje - c.data_emissao).days if c.data_emissao else None,
                "vencida": bool(c.data_vencimento and c.data_vencimento < hoje),
                "itens_venda": [
                    {"produto_nome": vi.produto_nome, "quantidade": float(vi.quantidade or 0), "total_item": float(vi.total_item or 0)}
                    for vi in (venda.itens if venda else [])
                ],
            })

        total_contas = round(sum(i["valor_atual"] for i in itens), 2)
        saldo_cliente = round(float(cliente.saldo_devedor or 0), 2)

        return jsonify({
            "success": True,
            "cliente_id": id,
            "cliente_nome": cliente.nome,
            "saldo_devedor": saldo_cliente,
            "total_contas_abertas": total_contas,
            # Se divergir, é sinal de dado legado a reconciliar — melhor expor
            # do que esconder (mesma lição do bug de cancelamento de venda).
            "consistente": abs(total_contas - saldo_cliente) < 0.01,
            "contas": itens,
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao listar contas fiado do cliente {id}: {str(e)}")
        return jsonify({"success": False, "message": "Erro ao listar contas de fiado"}), 500


_CAMPANHA_OBJETIVO = {
    "reactivation": "trazer o cliente de volta depois de um tempo sem comprar (reativação)",
    "vip": "fidelizar e valorizar um cliente que já gasta muito na loja (VIP)",
    "debt": "cobrar de forma educada e profissional um saldo em aberto (fiado)",
    "promotion": "divulgar uma promoção ou oferta para gerar uma nova compra",
}


@clientes_bp.route("/<int:id>/mensagem_ia", methods=["POST"])
@funcionario_required
def gerar_mensagem_ia(id):
    """Gera uma mensagem de WhatsApp personalizada via IA (Groq), usando
    contexto REAL do cliente: histórico de compras, saldo devedor, produtos
    que ele já comprou, produtos com desconto disponível (vencendo/parados)
    e o desconto máximo que a loja permite (nunca inventa um valor maior).

    Sem GROQ_API_KEY configurada, retorna 503 com aviso claro — o frontend
    mantém a mensagem por template como estava antes."""
    if not ia_disponivel():
        return jsonify({
            "success": False,
            "message": "IA do CRM não configurada. Peça ao administrador para configurar GROQ_API_KEY no servidor.",
        }), 503

    try:
        estabelecimento_id = get_authorized_establishment_id()
        cliente = Cliente.query.filter_by(id=id, estabelecimento_id=estabelecimento_id).first_or_404()

        data = request.get_json() or {}
        campaign = data.get("campaign", "promotion")
        instrucao_extra = (data.get("instrucao_extra") or "").strip()

        # ── Contexto: produtos que o cliente mais comprou ──
        from app.models import Produto, Configuracao
        top_produtos = (
            db.session.query(VendaItem.produto_nome, func.sum(VendaItem.quantidade).label("qtd"))
            .join(Venda, Venda.id == VendaItem.venda_id)
            .filter(Venda.cliente_id == id, Venda.status == "finalizada")
            .group_by(VendaItem.produto_nome)
            .order_by(func.sum(VendaItem.quantidade).desc())
            .limit(5)
            .all()
        )
        produtos_favoritos = [p[0] for p in top_produtos] or ["ainda sem histórico de compras"]

        # ── Contexto: produtos com desconto real disponível (parados/vencendo) ──
        produtos_promo = (
            Produto.query.filter_by(estabelecimento_id=estabelecimento_id, ativo=True)
            .filter(Produto.quantidade > 0)
            .order_by(Produto.data_validade.asc().nullslast())
            .limit(5)
            .all()
        )
        produtos_disponiveis = [f"{p.nome} (R$ {float(p.preco_venda or 0):.2f})" for p in produtos_promo]

        # ── Contexto: limite de desconto que a loja PERMITE (a IA não pode inventar mais que isso) ──
        config = Configuracao.query.filter_by(estabelecimento_id=estabelecimento_id).first()
        desconto_max = float(config.desconto_maximo_percentual) if config and config.desconto_maximo_percentual else 10.0

        dias_sem_comprar = None
        if cliente.ultima_compra:
            dias_sem_comprar = (datetime.utcnow() - cliente.ultima_compra).days

        objetivo = _CAMPANHA_OBJETIVO.get(campaign, _CAMPANHA_OBJETIVO["promotion"])

        contexto = f"""Dados REAIS do cliente (use apenas o que está aqui, não invente valores):
- Nome: {cliente.nome}
- Já gastou no total: R$ {float(cliente.valor_total_gasto or 0):.2f}
- Saldo devedor (fiado) atual: R$ {float(cliente.saldo_devedor or 0):.2f}
- Dias desde a última compra: {dias_sem_comprar if dias_sem_comprar is not None else "sem registro"}
- Produtos que ele mais compra: {", ".join(produtos_favoritos)}
- Produtos disponíveis na loja hoje para sugerir: {", ".join(produtos_disponiveis) or "catálogo geral"}
- Desconto MÁXIMO que a loja autoriza dar: {desconto_max:.0f}% (NUNCA ofereça mais que isso)
"""
        if instrucao_extra:
            contexto += f"\nInstrução adicional do lojista: {instrucao_extra}\n"

        system_prompt = (
            "Você é um assistente de um mercadinho de bairro brasileiro, escrevendo mensagens de "
            "WhatsApp curtas, calorosas e informais (não corporativas) para os clientes, em nome do "
            "dono da loja. Use os dados reais fornecidos — nunca invente valores de desconto acima do "
            "máximo informado, nem produtos que não estejam na lista. Máximo 3-4 frases. Sem emojis em "
            "excesso (no máximo 1-2). Retorne APENAS o texto da mensagem, sem aspas, sem explicações."
        )
        user_prompt = f"Objetivo desta mensagem: {objetivo}.\n\n{contexto}\nEscreva a mensagem agora."

        mensagem = gerar_texto(system_prompt, user_prompt)
        if not mensagem:
            return jsonify({
                "success": False,
                "message": "Não foi possível gerar a mensagem agora (serviço de IA indisponível). Tente novamente em instantes.",
            }), 502

        return jsonify({"success": True, "mensagem": mensagem}), 200

    except Exception as e:
        current_app.logger.error(f"Erro ao gerar mensagem IA para cliente {id}: {str(e)}")
        return jsonify({"success": False, "message": "Erro ao gerar mensagem com IA"}), 500


@clientes_bp.route("/<int:id>/credito", methods=["GET"])
@funcionario_required
def obter_credito_cliente(id):
    """Score de crédito explicável: componentes, atrasos e títulos vencidos."""
    from app.services.credito_service import DIAS_TOLERANCIA_ATRASO, calcular_score, titulos_vencidos
    estabelecimento_id = get_authorized_establishment_id()
    cliente = Cliente.query.filter_by(id=id, estabelecimento_id=estabelecimento_id).first_or_404()
    resultado = calcular_score(cliente)
    resultado["limite_credito"] = float(cliente.limite_credito or 0)
    resultado["saldo_devedor"] = float(cliente.saldo_devedor or 0)
    resultado["limite_disponivel"] = calcular_limite_disponivel(cliente)
    resultado["dias_tolerancia_atraso"] = DIAS_TOLERANCIA_ATRASO
    resultado["bloqueado_para_prazo"] = bool(titulos_vencidos(cliente))
    return jsonify({"success": True, "credito": resultado}), 200


@clientes_bp.route("/<int:id>/pagar_fiado", methods=["POST"])
@funcionario_required
def pagar_fiado(id):
    """Registra pagamento (parcial ou total) de dívida de fiado do cliente.
    Gera automaticamente um Suprimento no caixa aberto.

    Dois modos:
    - conta_receber_id informado: quita ESSA venda específica.
    - sem conta_receber_id: abatimento livre, distribuído nas contas em aberto
      por ordem FIFO (mais antiga primeiro).

    Valores em Decimal, finitos e positivos; cliente e títulos ficam travados
    durante a baixa (duas baixas simultâneas não abatem o mesmo título duas
    vezes). Ao final o saldo do cliente é reconciliado com a soma real dos
    títulos abertos e o score de crédito é recalculado."""
    from decimal import ROUND_HALF_UP
    from app.utils.sale_validation import number
    centavo = Decimal("0.01")
    try:
        jwt_data = get_jwt()
        funcionario_id = int(get_jwt_identity())
        estabelecimento_id = jwt_data.get("estabelecimento_id")
        if not estabelecimento_id:
            return jsonify({"success": False, "message": "Estabelecimento não identificado"}), 400

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"success": False, "message": "Dados não fornecidos"}), 400
        try:
            valor_pago = number(data.get("valor", 0), "Valor", positive=True).quantize(centavo, rounding=ROUND_HALF_UP)
        except ValueError:
            return jsonify({"success": False, "message": "Informe um valor numérico maior que zero"}), 400
        if valor_pago <= 0:
            return jsonify({"success": False, "message": "O valor deve ser maior que zero"}), 400

        cliente = Cliente.query.filter_by(id=id, estabelecimento_id=estabelecimento_id) \
            .populate_existing().with_for_update().first_or_404()
        forma_pagamento = str(data.get("forma_pagamento", "Dinheiro"))[:30]
        conta_receber_id = data.get("conta_receber_id")
        observacoes = data.get("observacoes", f"Pagamento de fiado - Cliente {cliente.nome}")

        saldo_atual = Decimal(str(cliente.saldo_devedor or 0))
        if valor_pago > saldo_atual + centavo:
            return jsonify({
                "success": False,
                "message": f"Valor informado (R$ {valor_pago:.2f}) é maior que o saldo devedor (R$ {saldo_atual:.2f})"
            }), 400

        abertas = ContaReceber.query.filter_by(cliente_id=id, estabelecimento_id=estabelecimento_id, status="aberto") \
            .populate_existing().with_for_update().order_by(ContaReceber.data_emissao.asc(), ContaReceber.id.asc()).all()
        total_aberto_antes = sum((Decimal(str(c.valor_atual or 0)) for c in abertas), Decimal("0"))

        # O abatimento livre só pode quitar o que existe de fato em títulos: um
        # saldo desatualizado (dado legado) não pode "engolir" o pagamento.
        if not conta_receber_id and valor_pago > total_aberto_antes + centavo:
            return jsonify({
                "success": False,
                "message": (
                    f"O saldo devedor (R$ {saldo_atual:.2f}) não corresponde a nenhuma venda "
                    f"em aberto encontrada (R$ {total_aberto_antes:.2f}). Contate o suporte para "
                    f"reconciliar o cadastro deste cliente antes de registrar o recebimento."
                ),
            }), 409

        from app.models import Caixa, MovimentacaoCaixa, Auditoria
        caixa_aberto = Caixa.query.filter_by(funcionario_id=funcionario_id, estabelecimento_id=estabelecimento_id,
                                             status="aberto").order_by(Caixa.data_abertura.desc()) \
            .populate_existing().with_for_update().first()
        if not caixa_aberto:
            return jsonify({
                "success": False,
                "message": "É necessário ter um caixa aberto para registrar o recebimento de fiado."
            }), 403

        def baixar(conta, valor):
            conta.valor_recebido = Decimal(str(conta.valor_recebido or 0)) + valor
            conta.valor_atual = max(Decimal("0"), Decimal(str(conta.valor_atual or 0)) - valor).quantize(centavo)
            conta.forma_recebimento = forma_pagamento
            if conta.valor_atual <= centavo:
                conta.valor_atual = Decimal("0")
                conta.status = "pago"
                conta.data_recebimento = date.today()

        if conta_receber_id:
            conta = next((c for c in abertas if str(c.id) == str(conta_receber_id)), None)
            if not conta:
                return jsonify({"success": False, "message": "Conta de fiado não encontrada ou já quitada"}), 404
            if valor_pago > Decimal(str(conta.valor_atual or 0)) + centavo:
                return jsonify({
                    "success": False,
                    "message": f"Valor informado (R$ {valor_pago:.2f}) é maior que o valor desta venda (R$ {Decimal(str(conta.valor_atual)):.2f})",
                }), 400
            baixar(conta, valor_pago)
            descricao_auditoria = f"Quitação da venda {conta.venda.codigo if conta.venda else conta.numero_documento}"
        else:
            restante = valor_pago
            for conta in abertas:
                if restante <= 0:
                    break
                abatimento = min(restante, Decimal(str(conta.valor_atual or 0)))
                baixar(conta, abatimento)
                restante -= abatimento
            descricao_auditoria = "Abatimento geral do saldo em aberto"

        # Reconcilia o saldo com a soma REAL dos títulos ainda abertos.
        total_aberto_real = sum((Decimal(str(c.valor_atual or 0)) for c in abertas if c.status == "aberto"), Decimal("0"))
        cliente.saldo_devedor = total_aberto_real.quantize(centavo)

        db.session.add(MovimentacaoCaixa(
            caixa_id=caixa_aberto.id,
            estabelecimento_id=estabelecimento_id,
            tipo="suprimento",
            valor=valor_pago,
            forma_pagamento=forma_pagamento,
            descricao=f"Receb. Fiado - {cliente.nome}",
            observacoes=observacoes
        ))
        if forma_pagamento.lower() == "dinheiro":
            caixa_aberto.saldo_atual = Decimal(str(caixa_aberto.saldo_atual or 0)) + valor_pago

        from app.services.credito_service import recalcular_credito
        recalcular_credito(cliente)

        Auditoria.registrar(
            estabelecimento_id=estabelecimento_id,
            tipo_evento="recebimento_fiado",
            descricao=f"{descricao_auditoria} — {cliente.nome} pagou R$ {valor_pago:.2f} via {forma_pagamento}",
            usuario_id=funcionario_id,
            valor=valor_pago,
        )

        db.session.commit()

        current_app.logger.info(
            f"Fiado pago: Cliente {id} pagou R$ {valor_pago:.2f} via {forma_pagamento}. "
            f"Saldo restante: R$ {Decimal(str(cliente.saldo_devedor)):.2f}"
        )

        return jsonify({
            "success": True,
            "message": f"Pagamento de R$ {valor_pago:.2f} registrado com sucesso!",
            "saldo_devedor_anterior": float(saldo_atual),
            "saldo_devedor_atual": float(cliente.saldo_devedor),
            "valor_pago": float(valor_pago),
            "score_credito": cliente.score_credito,
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao registrar pagamento de fiado: {str(e)}")
        return jsonify({"success": False, "message": "Erro interno ao registrar pagamento"}), 500


@clientes_bp.route("/estatisticas", methods=["GET"])
@funcionario_required
def estatisticas_clientes():
    """Retorna estatísticas gerais sobre clientes"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        # Total de clientes

        # Total de clientes
        total_clientes = Cliente.query.filter_by(
            estabelecimento_id=estabelecimento_id
        ).count()

        # Clientes ativos
        clientes_ativos = Cliente.query.filter_by(
            estabelecimento_id=estabelecimento_id, ativo=True
        ).count()

        # Clientes inativos
        clientes_inativos = total_clientes - clientes_ativos

        # Clientes por classificação
        classificacoes = {
            "PREMIUM": Cliente.query.filter(
                Cliente.estabelecimento_id == estabelecimento_id,
                Cliente.valor_total_gasto > 10000,
            ).count(),
            "A": Cliente.query.filter(
                Cliente.estabelecimento_id == estabelecimento_id,
                Cliente.valor_total_gasto.between(5000, 10000),
            ).count(),
            "B": Cliente.query.filter(
                Cliente.estabelecimento_id == estabelecimento_id,
                Cliente.valor_total_gasto.between(1000, 5000),
            ).count(),
            "C": Cliente.query.filter(
                Cliente.estabelecimento_id == estabelecimento_id,
                Cliente.valor_total_gasto > 0,
                Cliente.valor_total_gasto < 1000,
            ).count(),
            "NOVO": Cliente.query.filter(
                Cliente.estabelecimento_id == estabelecimento_id,
                Cliente.total_compras == 0,
            ).count(),
        }

        # Clientes por estado
        clientes_por_estado = (
            db.session.query(Cliente.estado, db.func.count(Cliente.id).label("total"))
            .filter_by(estabelecimento_id=estabelecimento_id)
            .group_by(Cliente.estado)
            .all()
        )

        # Top 5 clientes por valor gasto
        top_clientes = (
            Cliente.query.filter_by(estabelecimento_id=estabelecimento_id, ativo=True)
            .order_by(Cliente.valor_total_gasto.desc())
            .limit(5)
            .all()
        )

        top_clientes_list = []
        for c in top_clientes:
            top_clientes_list.append(
                {
                    "id": c.id,
                    "nome": c.nome,
                    "valor_total_gasto": float(c.valor_total_gasto or 0),
                    "total_compras": c.total_compras or 0,
                    "classificacao": calcular_classificacao_cliente(c),
                }
            )

        # Últimos clientes cadastrados
        ultimos_cadastrados = (
            Cliente.query.filter_by(estabelecimento_id=estabelecimento_id)
            .order_by(Cliente.data_cadastro.desc())
            .limit(5)
            .all()
        )

        ultimos_cadastrados_list = []
        for c in ultimos_cadastrados:
            ultimos_cadastrados_list.append(
                {
                    "id": c.id,
                    "nome": c.nome,
                    "data_cadastro": (
                        c.data_cadastro.isoformat() if c.data_cadastro else None
                    ),
                    "total_compras": c.total_compras or 0,
                    "classificacao": calcular_classificacao_cliente(c),
                }
            )

        # Estatísticas de limite de crédito
        total_limite_credito = (
            db.session.query(db.func.sum(Cliente.limite_credito))
            .filter_by(estabelecimento_id=estabelecimento_id, ativo=True)
            .scalar()
            or 0
        )

        total_saldo_devedor = (
            db.session.query(db.func.sum(Cliente.saldo_devedor))
            .filter_by(estabelecimento_id=estabelecimento_id, ativo=True)
            .scalar()
            or 0
        )

        limite_disponivel_total = float(total_limite_credito) - float(
            total_saldo_devedor
        )

        return jsonify(
            {
                "success": True,
                "estatisticas": {
                    "total": total_clientes,
                    "ativos": clientes_ativos,
                    "inativos": clientes_inativos,
                    "percentual_ativos": (
                        (clientes_ativos / total_clientes * 100)
                        if total_clientes > 0
                        else 0
                    ),
                    "classificacoes": classificacoes,
                    "por_estado": {e[0]: e[1] for e in clientes_por_estado},
                    "limite_credito": {
                        "total_limite": float(total_limite_credito),
                        "total_saldo_devedor": float(total_saldo_devedor),
                        "limite_disponivel": limite_disponivel_total,
                        "percentual_utilizado": (
                            (
                                float(total_saldo_devedor)
                                / float(total_limite_credito)
                                * 100
                            )
                            if float(total_limite_credito) > 0
                            else 0
                        ),
                    },
                },
                "top_clientes": top_clientes_list,
                "ultimos_cadastrados": ultimos_cadastrados_list,
            }
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao obter estatísticas de clientes: {str(e)}")
        return (
            jsonify(
                {"success": False, "message": "Erro interno ao obter estatísticas"}
            ),
            500,
        )


@clientes_bp.route("/<int:id>/compras", methods=["GET"])
@funcionario_required
def listar_compras_cliente(id):
    """Lista todas as compras de um cliente"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        pagina = request.args.get("pagina", 1, type=int)
        por_pagina = request.args.get("por_pagina", 20, type=int)
        status = request.args.get("status", None, type=str)
        data_inicio = request.args.get("data_inicio", None, type=str)
        data_fim = request.args.get("data_fim", None, type=str)

        # Verificar se cliente existe
        cliente = Cliente.query.filter_by(
            id=id, estabelecimento_id=estabelecimento_id
        ).first_or_404()

        # Query de vendas
        query = Venda.query.filter_by(
            cliente_id=id, estabelecimento_id=estabelecimento_id
        )

        if status:
            query = query.filter_by(status=status)

        if data_inicio:
            data_inicio_dt = datetime.strptime(data_inicio, "%Y-%m-%d")
            query = query.filter(Venda.data_venda >= data_inicio_dt)

        if data_fim:
            data_fim_dt = datetime.strptime(data_fim, "%Y-%m-%d")
            query = query.filter(Venda.data_venda <= data_fim_dt)

        query = query.order_by(Venda.data_venda.desc())

        # Paginação
        paginacao = query.paginate(page=pagina, per_page=por_pagina, error_out=False)

        compras = []
        for venda in paginacao.items:
            compras.append(
                {
                    "id": venda.id,
                    "codigo": venda.codigo,
                    "data_venda": (
                        venda.data_venda.isoformat() if venda.data_venda else None
                    ),
                    "status": venda.status,
                    "subtotal": float(venda.subtotal),
                    "desconto": float(venda.desconto),
                    "total": float(venda.total),
                    "forma_pagamento": (venda.pagamentos[0].forma_pagamento if venda.pagamentos else "N/A"),
                    "quantidade_itens": venda.quantidade_itens,
                    "funcionario": (
                        venda.funcionario.nome if venda.funcionario else None
                    ),
                }
            )

        # Estatísticas do período
        total_compras = paginacao.total
        total_gasto = (
            db.session.query(db.func.sum(Venda.total))
            .filter(
                Venda.cliente_id == id,
                Venda.estabelecimento_id == estabelecimento_id,
            )
            .scalar()
            or 0
        )

        return jsonify(
            {
                "success": True,
                "compras": compras,
                "cliente": cliente.nome,
                "total": total_compras,
                "pagina": pagina,
                "total_paginas": paginacao.pages,
                "estatisticas": {
                    "total_gasto_periodo": float(total_gasto),
                    "media_compra": (
                        float(total_gasto / total_compras) if total_compras > 0 else 0
                    ),
                },
            }
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao listar compras do cliente {id}: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao listar compras"}),
            500,
        )


@clientes_bp.route("/<int:id>/produtos", methods=["GET"])
@funcionario_required
def listar_produtos_cliente(id):
    """Lista os produtos comprados por um cliente (histórico de consumo agregado)"""
    try:
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        # Verificar se cliente existe
        cliente = Cliente.query.filter_by(
            id=id, estabelecimento_id=estabelecimento_id
        ).first_or_404()

        # Agrupar VendaItem por produto para este cliente em vendas finalizadas
        # Pegamos produto_id, produto_nome, sum(quantidade), sum(total_item), max(data_venda)
        resultados = (
            db.session.query(
                VendaItem.produto_id,
                VendaItem.produto_nome,
                func.sum(VendaItem.quantidade).label('total_quantidade'),
                func.sum(VendaItem.total_item).label('total_gasto'),
                func.max(Venda.data_venda).label('ultima_compra')
            )
            .join(Venda, Venda.id == VendaItem.venda_id)
            .filter(
                Venda.cliente_id == id,
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.status == "finalizada"
            )
            .group_by(VendaItem.produto_id, VendaItem.produto_nome)
            .order_by(func.sum(VendaItem.quantidade).desc())
            .limit(100)
            .all()
        )

        produtos = []
        for r in resultados:
            produtos.append({
                "produto_id": r.produto_id,
                "nome": r.produto_nome,
                "quantidade_total": float(r.total_quantidade or 0),
                "valor_total": float(r.total_gasto or 0),
                "ultima_compra": r.ultima_compra.isoformat() if r.ultima_compra else None
            })

        return jsonify({
            "success": True,
            "cliente": cliente.nome,
            "produtos": produtos,
            "total_produtos_diferentes": len(produtos)
        })

    except Exception as e:
        current_app.logger.error(f"Erro ao listar produtos do cliente {id}: {str(e)}")
        return jsonify({"success": False, "message": "Erro interno ao listar produtos"}), 500


@clientes_bp.route("/exportar", methods=["GET"])
@funcionario_required
def exportar_clientes():
    """Exporta clientes em formato CSV ou Excel"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        formato = request.args.get("formato", "csv", type=str).lower()
        apenas_ativos = request.args.get("ativo", "true", type=str).lower() == "true"

        # Buscar clientes
        query = Cliente.query.filter_by(
            estabelecimento_id=estabelecimento_id
        )

        if apenas_ativos:
            query = query.filter_by(ativo=True)

        clientes = query.order_by(Cliente.nome.asc()).all()

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
                    "Nome",
                    "CPF",
                    "RG",
                    "Data Nascimento",
                    "Idade",
                    "Telefone",
                    "Celular",
                    "Email",
                    "CEP",
                    "Logradouro",
                    "Número",
                    "Complemento",
                    "Bairro",
                    "Cidade",
                    "Estado",
                    "País",
                    "Limite Crédito",
                    "Saldo Devedor",
                    "Limite Disponível",
                    "Total Compras",
                    "Valor Total Gasto",
                    "Ticket Médio",
                    "Última Compra",
                    "Classificação",
                    "Ativo",
                    "Observações",
                    "Data Cadastro",
                    "Data Atualização",
                ]
            )

            # Dados
            for c in clientes:
                idade = calcular_idade(c.data_nascimento) if c.data_nascimento else ""
                classificacao = calcular_classificacao_cliente(c)
                limite_disponivel = calcular_limite_disponivel(c)
                ticket_medio = (
                    float(c.valor_total_gasto / c.total_compras)
                    if c.total_compras > 0
                    else 0
                )

                writer.writerow(
                    [
                        c.id,
                        c.nome or "",
                        c.documento,
                        c.rg or "",
                        (
                            c.data_nascimento.strftime("%d/%m/%Y")
                            if c.data_nascimento
                            else ""
                        ),
                        idade,
                        c.telefone or "",
                        c.celular or "",
                        c.email or "",
                        c.cep or "",
                        c.logradouro or "",
                        c.numero or "",
                        c.complemento or "",
                        c.bairro or "",
                        c.cidade or "",
                        c.estado or "",
                        c.pais or "",
                        float(c.limite_credito or 0),
                        float(c.saldo_devedor or 0),
                        limite_disponivel,
                        c.total_compras or 0,
                        float(c.valor_total_gasto or 0),
                        ticket_medio,
                        (
                            c.ultima_compra.strftime("%d/%m/%Y %H:%M")
                            if c.ultima_compra
                            else ""
                        ),
                        classificacao,
                        "SIM" if c.ativo else "NÃO",
                        c.observacoes or "",
                        (
                            c.data_cadastro.strftime("%d/%m/%Y %H:%M:%S")
                            if c.data_cadastro
                            else ""
                        ),
                        (
                            c.data_atualizacao.strftime("%d/%m/%Y %H:%M:%S")
                            if c.data_atualizacao
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
                    "Content-Disposition": "attachment; filename=clientes.csv",
                },
            )

        elif formato == "excel":
            # Gerar Excel
            import pandas as pd

            dados = []
            for c in clientes:
                idade = calcular_idade(c.data_nascimento) if c.data_nascimento else ""
                classificacao = calcular_classificacao_cliente(c)
                limite_disponivel = calcular_limite_disponivel(c)
                ticket_medio = (
                    float(c.valor_total_gasto / c.total_compras)
                    if c.total_compras > 0
                    else 0
                )

                dados.append(
                    {
                        "ID": c.id,
                        "Nome": c.nome or "",
                        "CPF/CNPJ": c.documento,
                        "RG": c.rg or "",
                        "Data Nascimento": (
                            c.data_nascimento.strftime("%d/%m/%Y")
                            if c.data_nascimento
                            else ""
                        ),
                        "Idade": idade,
                        "Telefone": c.telefone or "",
                        "Celular": c.celular or "",
                        "Email": c.email or "",
                        "CEP": c.cep or "",
                        "Logradouro": c.logradouro or "",
                        "Número": c.numero or "",
                        "Complemento": c.complemento or "",
                        "Bairro": c.bairro or "",
                        "Cidade": c.cidade or "",
                        "Estado": c.estado or "",
                        "País": c.pais or "",
                        "Limite Crédito": float(c.limite_credito or 0),
                        "Saldo Devedor": float(c.saldo_devedor or 0),
                        "Limite Disponível": limite_disponivel,
                        "Total Compras": c.total_compras or 0,
                        "Valor Total Gasto": float(c.valor_total_gasto or 0),
                        "Ticket Médio": ticket_medio,
                        "Última Compra": (
                            c.ultima_compra.strftime("%d/%m/%Y %H:%M")
                            if c.ultima_compra
                            else ""
                        ),
                        "Classificação": classificacao,
                        "Ativo": "SIM" if c.ativo else "NÃO",
                        "Observações": c.observacoes or "",
                        "Data Cadastro": (
                            c.data_cadastro.strftime("%d/%m/%Y %H:%M:%S")
                            if c.data_cadastro
                            else ""
                        ),
                        "Data Atualização": (
                            c.data_atualizacao.strftime("%d/%m/%Y %H:%M:%S")
                            if c.data_atualizacao
                            else ""
                        ),
                    }
                )

            df = pd.DataFrame(dados)

            # Salvar em buffer
            from io import BytesIO

            output = BytesIO()
            with pd.ExcelWriter(output, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name="Clientes", index=False)

            output.seek(0)
            return (
                output.getvalue(),
                200,
                {
                    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "Content-Disposition": "attachment; filename=clientes.xlsx",
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
        current_app.logger.error(f"Erro ao exportar clientes: {str(e)}")
        return (
            jsonify({"success": False, "message": "Erro interno ao exportar clientes"}),
            500,
        )


@clientes_bp.route("/curva_compras", methods=["GET"])
@funcionario_required
def curva_compras():
    """Retorna a curva de compras agregada por mês (últimos 12 meses)"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        hoje = datetime.utcnow()
        meses = []

        # Gerar lista dos últimos 12 meses
        for i in range(11, -1, -1):
            mes = (hoje.replace(day=1) - timedelta(days=30 * i)).replace(day=1)
            meses.append(mes)

        # Buscar vendas agrupadas por ano/mês
        from app.utils.query_helpers import ilike_unaccent, get_year_extract, get_month_extract
        year_extract = get_year_extract(Venda.data_venda)
        month_extract = get_month_extract(Venda.data_venda)

        results = (
            db.session.query(
                year_extract.label("ano"),
                month_extract.label("mes"),
                db.func.count(Venda.id).label("quantidade"),
                db.func.sum(Venda.total).label("total"),
            )
            .filter(
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.data_venda >= meses[-1],
                Venda.status == "finalizada",
            )
            .group_by(year_extract, month_extract)
            .order_by(year_extract, month_extract)
            .all()
        )

        # Montar lista de pontos
        curva = []
        for r in results:
            curva.append(
                {
                    "periodo": f"{int(r.ano):04d}-{int(r.mes):02d}",
                    "quantidade": int(r.quantidade or 0),
                    "total": float(r.total or 0),
                    "ticket_medio": (
                        float(r.total / r.quantidade) if r.quantidade > 0 else 0
                    ),
                }
            )

        # Preencher meses sem vendas
        meses_formatados = [m.strftime("%Y-%m") for m in meses]
        for mes in meses_formatados:
            if not any(p["periodo"] == mes for p in curva):
                curva.append(
                    {"periodo": mes, "quantidade": 0, "total": 0, "ticket_medio": 0}
                )

        # Ordenar por período
        curva.sort(key=lambda x: x["periodo"])

        return jsonify(
            {
                "success": True,
                "curva_compras": curva,
                "periodo_inicio": meses[0].strftime("%Y-%m-%d"),
                "periodo_fim": hoje.strftime("%Y-%m-%d"),
                "total_periodo": sum(p["quantidade"] for p in curva),
                "valor_total_periodo": sum(p["total"] for p in curva),
            }
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao gerar curva de compras: {str(e)}")
        return (
            jsonify(
                {"success": False, "message": "Erro interno ao gerar curva de compras"}
            ),
            500,
        )


@clientes_bp.route("/relatorio/analitico", methods=["GET"])
@funcionario_required
def relatorio_analitico_clientes():
    """Gera relatório analítico detalhado dos clientes"""
    try:
        # Get estabelecimento_id from JWT
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        
        # Parâmetros de filtro
        data_inicio = request.args.get("data_inicio", None)
        data_fim = request.args.get("data_fim", None)
        classificacao = request.args.get("classificacao", None, type=str)

        # Query base de clientes
        query = Cliente.query.filter_by(
            estabelecimento_id=estabelecimento_id, ativo=True
        )

        if classificacao:
            if classificacao == "PREMIUM":
                query = query.filter(Cliente.valor_total_gasto > 10000)
            elif classificacao == "A":
                query = query.filter(Cliente.valor_total_gasto.between(5000, 10000))
            elif classificacao == "B":
                query = query.filter(Cliente.valor_total_gasto.between(1000, 5000))
            elif classificacao == "C":
                query = query.filter(Cliente.valor_total_gasto > 0)
            elif classificacao == "NOVO":
                query = query.filter(Cliente.total_compras == 0)

        clientes = query.all()

        relatorio = []
        for cliente in clientes:
            # Vendas do cliente no período
            vendas_query = Venda.query.filter_by(
                cliente_id=cliente.id,
                estabelecimento_id=estabelecimento_id,
                status="finalizada",
            )

            if data_inicio:
                vendas_query = vendas_query.filter(
                    Venda.data_venda >= datetime.strptime(data_inicio, "%Y-%m-%d")
                )

            if data_fim:
                # Ajustar para o final do dia para incluir todas as vendas do dia
                try:
                    data_fim_dt = datetime.strptime(data_fim, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999)
                    vendas_query = vendas_query.filter(
                        Venda.data_venda <= data_fim_dt
                    )
                except ValueError:
                    # Se vier em formato ISO ou outro, tentar parsing flexível
                    try:
                        data_fim_dt = datetime.fromisoformat(data_fim.replace('Z', '+00:00'))
                        if data_fim_dt.hour == 0 and data_fim_dt.minute == 0:
                            data_fim_dt = data_fim_dt.replace(hour=23, minute=59, second=59, microsecond=999999)
                        vendas_query = vendas_query.filter(Venda.data_venda <= data_fim_dt)
                    except:
                        pass

            vendas = vendas_query.all()

            # Cálculos
            total_vendas = len(vendas)
            valor_total = sum(float(v.total) for v in vendas)

            # Frequência de compras (dias entre compras)
            frequencias = []
            datas_vendas = sorted([v.data_venda for v in vendas])
            for i in range(1, len(datas_vendas)):
                dias = (datas_vendas[i] - datas_vendas[i - 1]).days
                frequencias.append(dias)

            frequencia_media = sum(frequencias) / len(frequencias) if frequencias else 0

            # Ticket médio
            ticket_medio = valor_total / total_vendas if total_vendas > 0 else 0

            # Valor do cliente (Customer Lifetime Value - CLV)
            # CLV = valor médio da compra × frequência de compras × tempo de vida do cliente
            tempo_vida_meses = 0
            if cliente.data_cadastro:
                tempo_vida_dias = (datetime.utcnow() - cliente.data_cadastro).days
                tempo_vida_meses = tempo_vida_dias / 30.44  # Média de dias por mês

            clv = (
                ticket_medio * (30 / max(frequencia_media, 1)) * tempo_vida_meses
                if total_vendas > 0
                else 0
            )

            # Adicionar ao relatório
            relatorio.append(
                {
                    "cliente": {
                        "id": cliente.id,
                        "nome": cliente.nome,
                        "cpf": cliente.cpf,
                        "documento": cliente.documento,
                        "classificacao": calcular_classificacao_cliente(cliente),
                        "data_cadastro": (
                            cliente.data_cadastro.isoformat()
                            if cliente.data_cadastro
                            else None
                        ),
                    },
                    "metricas": {
                        "total_vendas": total_vendas,
                        "valor_total_gasto": valor_total,
                        "ticket_medio": ticket_medio,
                        "frequencia_media_dias": frequencia_media,
                        "customer_lifetime_value": clv,
                        "limite_credito": float(cliente.limite_credito or 0),
                        "saldo_devedor": float(cliente.saldo_devedor or 0),
                        "limite_disponivel": calcular_limite_disponivel(cliente),
                        "idade": (
                            calcular_idade(cliente.data_nascimento)
                            if cliente.data_nascimento
                            else None
                        ),
                    },
                    "comportamento": {
                        "ultima_compra": (
                            cliente.ultima_compra.isoformat()
                            if cliente.ultima_compra
                            else None
                        ),
                        "dias_sem_comprar": (
                            (datetime.utcnow() - cliente.ultima_compra).days
                            if cliente.ultima_compra
                            else None
                        ),
                        "ticket_medio_crescimento": 0,  # Pode ser calculado comparando períodos
                        "frequencia_crescimento": 0,  # Pode ser calculado comparando períodos
                    },
                }
            )

        return jsonify(
            {
                "success": True,
                "relatorio": relatorio,
                "total_clientes": len(relatorio),
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
# UTILITÁRIOS DE CLIENTE
# ============================================


def sincronizar_metricas_cliente(cliente_id, valor_venda):
    """Sincroniza métricas de um cliente após uma venda"""
    try:
        cliente = Cliente.query.get(cliente_id)
        if not cliente:
            return

        # Atualizar total de compras
        cliente.total_compras = (cliente.total_compras or 0) + 1

        # Atualizar valor total gasto
        cliente.valor_total_gasto = (cliente.valor_total_gasto or 0) + Decimal(
            str(valor_venda)
        )

        # Atualizar data da última compra
        cliente.ultima_compra = datetime.utcnow()

        # Atualizar saldo devedor se a venda foi a crédito
        # Esta lógica deve ser implementada com base na forma de pagamento da venda

        cliente.data_atualizacao = datetime.utcnow()

        db.session.commit()

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"Erro ao sincronizar métricas do cliente {cliente_id}: {str(e)}"
        )


def atualizar_saldo_devedor(cliente_id, valor, tipo="adicionar"):
    """Atualiza saldo devedor do cliente"""
    try:
        cliente = Cliente.query.get(cliente_id)
        if not cliente:
            return

        if tipo == "adicionar":
            cliente.saldo_devedor = (cliente.saldo_devedor or 0) + Decimal(str(valor))
        elif tipo == "subtrair":
            cliente.saldo_devedor = max(
                0, (cliente.saldo_devedor or 0) - Decimal(str(valor))
            )
        elif tipo == "definir":
            cliente.saldo_devedor = Decimal(str(valor))

        cliente.data_atualizacao = datetime.utcnow()
        db.session.commit()

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"Erro ao atualizar saldo devedor do cliente {cliente_id}: {str(e)}"
        )

@clientes_bp.route("/rfm", methods=["GET"])
@funcionario_required
def obter_rfm():
    try:
        estabelecimento_id = get_authorized_establishment_id()
        dias = request.args.get("dias", 180, type=int)
        
        rfm_data = Cliente.calcular_rfm(estabelecimento_id, days=dias)
        return jsonify({"success": True, "rfm": rfm_data})
    except Exception as e:
        current_app.logger.error(f"Erro ao calcular RFM: {str(e)}")
        return jsonify({"success": False, "message": "Erro ao calcular RFM"}), 500

_IMPORT_MAX_LINHAS = 10000


def _decimal_br(valor, campo):
    """Aceita 1234.56, 1.234,56 e R$ 1.234,56; recusa vazio inválido, negativo e não finito."""
    texto = str(valor or "").replace("R$", "").strip().replace(" ", "")
    if not texto:
        return Decimal("0")
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        numero = Decimal(texto)
    except Exception:
        raise ValueError(f"{campo} inválido: {valor}") from None
    if not numero.is_finite() or numero < 0:
        raise ValueError(f"{campo} inválido: {valor}")
    return numero.quantize(Decimal("0.01"))


def _data_import(valor, campo):
    texto = str(valor or "").strip()
    if not texto:
        return None
    for formato in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    raise ValueError(f"{campo} inválida: {valor} (use AAAA-MM-DD ou DD/MM/AAAA)")


@clientes_bp.route("/importar", methods=["POST"])
@funcionario_required
@permission_required('clientes')
def importar_clientes_csv():
    """Importa clientes (PF e PJ) em massa via CSV, com saldo inicial por título.

    Colunas: nome, cpf ou cnpj, celular, limite_credito, saldo_devedor,
    vencimento_saldo, documento_saldo, razao_social, inscricao_estadual,
    contato_nome, email, cep, logradouro, numero, complemento, bairro, cidade,
    estado. O tipo (PF/PJ) sai do documento: 11 dígitos CPF, 14 CNPJ.

    Cada linha é gravada isoladamente: erro em uma linha não derruba as demais,
    e só conta como importada a que foi gravada de fato.
    """
    import csv
    import io
    from app.models import Auditoria
    from app.services.credito_service import recalcular_credito

    try:
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id or str(estabelecimento_id).lower() == "all":
            return jsonify({"success": False, "message": "Selecione a loja que receberá os clientes"}), 400
        if 'arquivo' not in request.files:
            return jsonify({"success": False, "message": "Nenhum arquivo enviado"}), 400
        arquivo = request.files['arquivo']
        if arquivo.filename == '' or not arquivo.filename.lower().endswith('.csv'):
            return jsonify({"success": False, "message": "O arquivo deve ser um CSV"}), 400

        bruto = arquivo.stream.read()
        try:
            texto = bruto.decode("utf-8-sig")
        except UnicodeDecodeError:
            texto = bruto.decode("latin-1")  # planilhas exportadas pelo Excel antigo
        delimitador = ";" if texto.splitlines() and texto.splitlines()[0].count(";") >= texto.splitlines()[0].count(",") else ","
        leitor = csv.DictReader(io.StringIO(texto, newline=None), delimiter=delimitador)
        if not leitor.fieldnames or len(leitor.fieldnames) < 2:
            return jsonify({"success": False, "message": "CSV sem cabeçalho válido (nome;cpf;celular;...)"}), 400
        leitor.fieldnames = [str(c or "").strip().lower().replace(" ", "_") for c in leitor.fieldnames]

        importados, erros, vistos = 0, [], set()
        for numero, linha in enumerate(leitor, start=2):  # linha 1 é o cabeçalho
            if numero - 1 > _IMPORT_MAX_LINHAS:
                erros.append(f"Limite de {_IMPORT_MAX_LINHAS} linhas por arquivo; divida a planilha")
                break

            def campo(*nomes):
                for nome in nomes:
                    valor = linha.get(nome)
                    if valor is not None and str(valor).strip():
                        return str(valor).strip()
                return ""

            try:
                with db.session.begin_nested():
                    nome = campo("nome", "nome_fantasia")
                    razao = campo("razao_social")
                    documento = re.sub(r"\D", "", campo("cnpj", "cpf", "documento", "cpf_cnpj"))
                    if len(documento) == 14:
                        tipo, cnpj, cpf = "PJ", formatar_cnpj(documento), None
                        if not validar_cnpj(documento):
                            raise ValueError("CNPJ inválido")
                        if not (razao or nome):
                            raise ValueError("Informe a razão social ou o nome do cliente PJ")
                    elif len(documento) == 11:
                        tipo, cnpj, cpf = "PF", None, formatar_cpf(documento)
                        if not validar_cpf(documento):
                            raise ValueError("CPF inválido")
                        if not nome:
                            raise ValueError("Nome é obrigatório")
                    else:
                        raise ValueError("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)")
                    if documento in vistos:
                        raise ValueError("Documento repetido no próprio arquivo")
                    vistos.add(documento)
                    celular = campo("celular", "telefone")
                    if not celular:
                        raise ValueError("Celular ou telefone é obrigatório")

                    if Cliente.query.filter(
                        Cliente.estabelecimento_id == estabelecimento_id,
                        (Cliente.cnpj == cnpj) if tipo == "PJ" else (Cliente.cpf == cpf),
                    ).first():
                        raise ValueError(f"{'CNPJ' if tipo == 'PJ' else 'CPF'} {cnpj or cpf} já cadastrado")

                    limite = _decimal_br(campo("limite_credito"), "Limite de crédito")
                    saldo = _decimal_br(campo("saldo_devedor"), "Saldo devedor")
                    vencimento = _data_import(campo("vencimento_saldo", "vencimento"), "Data de vencimento")

                    cliente = Cliente(
                        estabelecimento_id=estabelecimento_id,
                        tipo_pessoa=tipo,
                        nome=(nome or razao)[:150],
                        cpf=cpf,
                        cnpj=cnpj,
                        razao_social=razao[:150] or None,
                        inscricao_estadual=campo("inscricao_estadual", "ie")[:20] or None,
                        contato_nome=campo("contato_nome", "contato")[:100] or None,
                        celular=formatar_telefone(celular),
                        telefone=formatar_telefone(campo("telefone")) if campo("telefone") else None,
                        email=campo("email").lower() or None,
                        limite_credito=limite,
                        saldo_devedor=saldo,
                        # O banco exige endereço; ausente na planilha, fica vazio para completar depois.
                        cep=campo("cep"), logradouro=campo("logradouro"), numero=campo("numero"),
                        complemento=campo("complemento"), bairro=campo("bairro"), cidade=campo("cidade"),
                        estado=campo("estado", "uf").upper()[:2],
                        total_compras=0, valor_total_gasto=Decimal("0"), ativo=True,
                    )
                    db.session.add(cliente)
                    db.session.flush()
                    if saldo > 0:
                        hoje = hoje_local()
                        db.session.add(ContaReceber(
                            estabelecimento_id=estabelecimento_id, cliente_id=cliente.id,
                            numero_documento=(campo("documento_saldo") or f"SALDO-INICIAL-{cliente.id}")[:50],
                            tipo_documento="saldo_inicial",
                            valor_original=saldo, valor_atual=saldo, valor_recebido=Decimal("0"),
                            data_emissao=hoje, data_vencimento=vencimento or hoje + timedelta(days=30),
                            status="aberto",
                            observacoes=f"Saldo inicial importado - {cliente.nome}",
                        ))
                        db.session.flush()
                        recalcular_credito(cliente)
                importados += 1
            except Exception as erro_linha:
                detalhe = str(erro_linha.orig) if hasattr(erro_linha, "orig") else str(erro_linha)
                erros.append(f"Linha {numero}: {detalhe[:200]}")

        db.session.commit()
        Auditoria.registrar(
            estabelecimento_id=estabelecimento_id,
            tipo_evento="cliente_importado",
            descricao=f"Importação de {importados} clientes via CSV ({len(erros)} linhas com erro)",
            valor=Decimal('0'),
            detalhes={"sucesso": importados, "erros": len(erros), "metodo": "import_bulk"}
        )
        db.session.commit()
        sucesso = importados > 0 or not erros
        return jsonify({
            "success": sucesso,
            "message": f"Importação concluída: {importados} importados, {len(erros)} com erro.",
            "total_importados": importados,
            "total_erros": len(erros),
            "erros": erros[:50],
        }), (200 if sucesso else 422)

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro na importação de clientes: {str(e)}")
        return jsonify({"success": False, "message": "Erro interno na importação"}), 500
