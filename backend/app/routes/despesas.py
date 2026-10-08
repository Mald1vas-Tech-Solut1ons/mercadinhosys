from datetime import datetime
from sqlalchemy import or_, and_
from decimal import Decimal, ROUND_HALF_UP

from flask import Blueprint, jsonify, request, current_app

from app import db
from app.decorators.decorator_jwt import funcionario_required
from app.decorators.plan_guards import plan_required
from app.models import Despesa, Funcionario
from app.dashboard_cientifico.data_layer import DataLayer
from sqlalchemy import func, or_
from app.services.rh_calculator_service import calcular_provisoes
from app.services.rh_calculator_service import (
    calcular_custo_folha_detalhado,
    calcular_custo_folha_periodos,
)
from app.utils.financeiro_constants import sem_categorias_integradas

despesas_bp = Blueprint("despesas", __name__)


def _sem_categorias_integradas(query):
    """Aplica o filtro de exclusão das categorias espelhadas (ver
    app.utils.financeiro_constants) num query de Despesa."""
    return sem_categorias_integradas(query, Despesa.categoria)


@despesas_bp.route("/", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def listar_despesas():
    """Lista despesas do estabelecimento do usuário logado com filtros avançados e paginação.

    Query params opcionais:

    **Filtros básicos:**
    - inicio: YYYY-MM-DD (data início)
    - fim: YYYY-MM-DD (data fim)
    - categoria: string
    - tipo: string (fixa/variavel)
    - forma_pagamento: string

    **Filtros avançados:**
    - valor_min: float (valor mínimo)
    - valor_max: float (valor máximo)
    - recorrente: boolean (true/false)
    - descricao: string (busca parcial na descrição)
    - observacoes: string (busca parcial nas observações)

    **Paginação:**
    - pagina: int (padrão: 1)
    - por_pagina: int (padrão: 20, máximo: 100)

    **Ordenação:**
    - ordenar_por: string (data_despesa, valor, categoria, descricao)
    - ordem: string (asc ou desc, padrão: desc)
    """
    from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

    try:
        from app.routes.rh import _garantir_despesas_rescisoes_legadas
        _garantir_despesas_rescisoes_legadas()
    except Exception:
        pass

    # Query base
    query = Despesa.query
    if estabelecimento_id != 'all':
        query = query.filter(Despesa.estabelecimento_id == estabelecimento_id)

    # ========== FILTRAGEM ==========

    # Filtro por período
    inicio_str = request.args.get("inicio")
    fim_str = request.args.get("fim")

    try:
        if inicio_str:
            inicio = datetime.strptime(inicio_str, "%Y-%m-%d").date()
            query = query.filter(Despesa.data_despesa >= inicio)
        if fim_str:
            fim = datetime.strptime(fim_str, "%Y-%m-%d").date()
            query = query.filter(Despesa.data_despesa <= fim)
    except ValueError:
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Parâmetros de data inválidos",
                    "message": "Use o formato YYYY-MM-DD em inicio/fim",
                }
            ),
            400,
        )

    # Filtro por categoria (Case-insensitive)
    categoria = request.args.get("categoria")
    if categoria:
        query = query.filter(ilike_unaccent(Despesa.categoria, categoria))

    # Filtro por tipo
    tipo = request.args.get("tipo")
    if tipo:
        query = query.filter(Despesa.tipo == tipo)

    # Filtro por forma de pagamento
    forma_pagamento = request.args.get("forma_pagamento")
    if forma_pagamento:
        query = query.filter(Despesa.forma_pagamento == forma_pagamento)

    # Filtro por recorrência
    recorrente = request.args.get("recorrente")
    if recorrente is not None:
        if recorrente.lower() in ["true", "1", "yes"]:
            query = query.filter(Despesa.recorrente == True)
        elif recorrente.lower() in ["false", "0", "no"]:
            query = query.filter(Despesa.recorrente == False)

    # Filtro por valor mínimo e máximo
    valor_min = request.args.get("valor_min")
    valor_max = request.args.get("valor_max")

    if valor_min:
        try:
            valor_min_float = float(valor_min)
            query = query.filter(Despesa.valor >= valor_min_float)
        except ValueError:
            return (
                jsonify({"success": False, "error": "valor_min deve ser um número"}),
                400,
            )

    if valor_max:
        try:
            valor_max_float = float(valor_max)
            query = query.filter(Despesa.valor <= valor_max_float)
        except ValueError:
            return (
                jsonify({"success": False, "error": "valor_max deve ser um número"}),
                400,
            )

    # Busca textual (descrição e observações)
    busca = request.args.get("busca")
    if busca:
        busca_like = f"%{busca}%"
        query = query.filter(
            or_(
                ilike_unaccent(Despesa.descricao, busca_like),
                ilike_unaccent(Despesa.observacoes, busca_like),
                ilike_unaccent(Despesa.categoria, busca_like),
            )
        )

    # Busca específica por descrição
    descricao = request.args.get("descricao")
    if descricao:
        query = query.filter(ilike_unaccent(Despesa.descricao, f"%{descricao}%"))

    # Filtro por fornecedor
    fornecedor_id = request.args.get("fornecedor_id")
    if fornecedor_id:
        try:
            fornecedor_id_int = int(fornecedor_id)
            query = query.filter(Despesa.fornecedor_id == fornecedor_id_int)
        except ValueError:
            return jsonify({"success": False, "error": "fornecedor_id deve ser um número inteiro"}), 400

    # ========== ORDENAÇÃO ==========

    # Parâmetros de ordenação
    ordenar_por = request.args.get("ordenar_por", "data_despesa")
    ordem = request.args.get("ordem", "desc").lower()

    # Mapeamento de campos permitidos para ordenação
    campos_ordenacao = {
        "data_despesa": Despesa.data_despesa,
        "valor": Despesa.valor,
        "categoria": Despesa.categoria,
        "descricao": Despesa.descricao,
        "tipo": Despesa.tipo,
        "created_at": Despesa.created_at,
        "updated_at": Despesa.updated_at,
    }

    # Verificar se o campo de ordenação é válido
    campo_ordenacao = campos_ordenacao.get(ordenar_por)
    if not campo_ordenacao:
        campo_ordenacao = Despesa.data_despesa  # Valor padrão

    # Aplicar ordenação
    if ordem == "asc":
        query = query.order_by(campo_ordenacao.asc())
    else:  # desc é o padrão
        query = query.order_by(campo_ordenacao.desc())

    # Ordenação secundária por ID para consistência
    query = query.order_by(Despesa.id.desc())

    # ========== PAGINAÇÃO ==========

    # Obter parâmetros de paginação
    try:
        pagina = int(request.args.get("pagina", 1))
        por_pagina = int(request.args.get("por_pagina", 20))
    except ValueError:
        return (
            jsonify({"success": False, "error": "Parâmetros de paginação inválidos"}),
            400,
        )

    # Limitar número máximo de itens por página
    por_pagina = min(por_pagina, 100)

    # Aplicar paginação
    try:
        paginacao = query.paginate(page=pagina, per_page=por_pagina, error_out=False)

        # Estatísticas da LISTA: soma e média respeitando os MESMOS filtros
        # aplicados acima. Antes a soma era do estabelecimento inteiro
        # (ignorava período/categoria/busca) e a média dividia essa soma cheia
        # pela contagem filtrada — número sem significado no dashboard.
        total_despesas = paginacao.total
        soma_despesas = (
            query.order_by(None).with_entities(func.sum(Despesa.valor)).scalar() or 0.0
        )
        media_despesas = (float(soma_despesas) / total_despesas) if total_despesas > 0 else 0.0

        # Preparar resposta
        resposta = {
            "success": True,
            "data": [d.to_dict() for d in paginacao.items],
            "paginacao": {
                "pagina_atual": paginacao.page,
                "por_pagina": paginacao.per_page,
                "total_itens": paginacao.total,
                "total_paginas": paginacao.pages,
                "tem_proxima": paginacao.has_next,
                "tem_anterior": paginacao.has_prev,
                "proxima_pagina": paginacao.next_num,
                "pagina_anterior": paginacao.prev_num,
            },
            "estatisticas": {
                "total_despesas": total_despesas,
                "soma_total": float(soma_despesas),
                "media_valor": float(media_despesas),
                "pagina_atual_inicio": (pagina - 1) * por_pagina + 1,
                "pagina_atual_fim": min(pagina * por_pagina, paginacao.total),
            },
            "filtros_aplicados": {
                "inicio": inicio_str,
                "fim": fim_str,
                "categoria": categoria,
                "tipo": tipo,
                "forma_pagamento": forma_pagamento,
                "recorrente": recorrente,
                "valor_min": valor_min,
                "valor_max": valor_max,
                "busca": busca,
                "ordenar_por": ordenar_por,
                "ordem": ordem,
            },
        }

        # Adicionar categorias disponíveis para filtro
        q_categorias = db.session.query(Despesa.categoria)
        if estabelecimento_id != 'all':
            q_categorias = q_categorias.filter(Despesa.estabelecimento_id == estabelecimento_id)
        categorias = q_categorias.distinct().all()

        resposta["filtros_disponiveis"] = {
            "categorias": [c[0] for c in categorias if c[0]],
            "tipos": ["fixa", "variavel"],
            "formas_pagamento": [
                fp[0] for fp in (
                    db.session.query(Despesa.forma_pagamento)
                    .filter(Despesa.forma_pagamento.isnot(None))
                    .filter(Despesa.estabelecimento_id == estabelecimento_id if estabelecimento_id != 'all' else True)
                    .distinct()
                    .all()
                )
                if fp[0]
            ],
        }

        return jsonify(resposta), 200

    except Exception as e:
        current_app.logger.error(f"Erro ao listar despesas: {str(e)}")
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Erro ao processar a requisição",
                    "message": str(e),
                }
            ),
            500,
        )


@despesas_bp.route("/custo-folha", methods=["GET"], strict_slashes=False)
@despesas_bp.route("/custo-folha/", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def obter_custo_folha():
    """
    Retorna o custo total da folha (salários + provisões + encargos + rescisões) para o DRE.
    Pode filtrar por data (inicio e fim).
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        from datetime import date, datetime
        
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

        hoje = date.today()
        inicio_str = request.args.get("inicio")
        fim_str = request.args.get("fim")

        if inicio_str and fim_str:
            dt_inicio = datetime.strptime(inicio_str, "%Y-%m-%d").date()
            dt_fim = datetime.strptime(fim_str, "%Y-%m-%d").date()
        else:
            dt_inicio = hoje.replace(day=1)
            dt_fim = hoje

        dados = calcular_custo_folha_detalhado(estabelecimento_id, dt_inicio, dt_fim)
        return jsonify(dados), 200

    except Exception as e:
        current_app.logger.error(f"Erro ao calcular custo folha: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500


@despesas_bp.route("/estatisticas", methods=["GET"], strict_slashes=False)
@despesas_bp.route("/estatisticas/", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def obter_estatisticas_despesas():
    """Obtém estatísticas de despesas para o dashboard, com suporte a filtros de data."""
    from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
    from app.services.rh_calculator_service import calcular_custo_folha_detalhado
    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

    try:
        from sqlalchemy import func
        from datetime import datetime, timedelta
        from decimal import Decimal, ROUND_HALF_UP

        from sqlalchemy import case
        from app.models import ContaPagar

        hoje = datetime.now().date()
        mes_atual_inicio = hoje.replace(day=1)
        mes_anterior_inicio = (mes_atual_inicio - timedelta(days=1)).replace(day=1)
        mes_anterior_fim = mes_atual_inicio - timedelta(days=1)
        ontem = hoje - timedelta(days=1)
        semana_inicio = hoje - timedelta(days=6)

        # ── Período customizado via query params ─────────────────────────────
        inicio_str = request.args.get("inicio")
        fim_str = request.args.get("fim")
        try:
            filtro_inicio = datetime.strptime(inicio_str, "%Y-%m-%d").date() if inicio_str else None
            filtro_fim = datetime.strptime(fim_str, "%Y-%m-%d").date() if fim_str else None
        except ValueError:
            filtro_inicio = None
            filtro_fim = None

        cat_inicio = filtro_inicio if filtro_inicio else (hoje - timedelta(days=30))
        cat_fim = filtro_fim if filtro_fim else hoje

        # ── Janelas de evolução (últimos 6 meses, mais antigo primeiro) ──────
        meses_evolucao = []
        for i in range(5, -1, -1):
            mes_data = mes_atual_inicio
            for _ in range(i):
                mes_data = (mes_data - timedelta(days=1)).replace(day=1)
            if mes_data.month == 12:
                mes_fim = mes_data.replace(year=mes_data.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                mes_fim = mes_data.replace(month=mes_data.month + 1, day=1) - timedelta(days=1)
            meses_evolucao.append((mes_data, mes_fim))

        # ── FOLHA EM LOTE: uma chamada para TODAS as janelas ──────────────────
        # Antes: 11 chamadas de calcular_custo_folha_detalhado por request, cada
        # uma com 1 query de configuração POR funcionário — a causa nº 1 da
        # lentidão desta página.
        janelas = [
            (mes_atual_inicio, hoje),            # 0
            (mes_anterior_inicio, mes_anterior_fim),  # 1
            (hoje, hoje),                        # 2
            (ontem, ontem),                      # 3
            (semana_inicio, hoje),               # 4
            (cat_inicio, cat_fim),               # 5
        ] + meses_evolucao                       # 6..11
        try:
            folhas = calcular_custo_folha_periodos(estabelecimento_id, janelas)
        except Exception as e_folha:
            current_app.logger.error(f"Erro no cálculo batched de folha: {e_folha}")
            folhas = [{"custo_folha": {"custo_real_total": 0.0}} for _ in janelas]

        def _folha(idx):
            return Decimal(str(folhas[idx]["custo_folha"].get("custo_real_total", 0.0)))

        folha_detalhe_periodo = folhas[5]["custo_folha"]

        # ── DESPESAS: uma única query com buckets por janela ──────────────────
        # Agregados excluem as categorias integradas (ver CATEGORIAS_INTEGRADAS)
        # para o mesmo dinheiro não contar duas vezes com folha/boletos.
        def _bucket(cond):
            return func.coalesce(func.sum(case((cond, Despesa.valor), else_=0)), 0)

        q_desp = db.session.query(
            _bucket(Despesa.data_despesa == hoje).label("hoje"),
            _bucket(Despesa.data_despesa == ontem).label("ontem"),
            _bucket(and_(Despesa.data_despesa >= semana_inicio, Despesa.data_despesa <= hoje)).label("semana"),
            _bucket(and_(Despesa.data_despesa >= mes_atual_inicio, Despesa.data_despesa <= hoje)).label("mes_atual"),
            _bucket(and_(Despesa.data_despesa >= mes_anterior_inicio, Despesa.data_despesa <= mes_anterior_fim)).label("mes_anterior"),
            _bucket(and_(Despesa.data_despesa >= cat_inicio, Despesa.data_despesa <= cat_fim)).label("periodo"),
            func.coalesce(func.sum(Despesa.valor), 0).label("total_geral"),
            func.count(Despesa.id).label("qtd_geral"),
            func.coalesce(func.sum(case((Despesa.recorrente == True, Despesa.valor), else_=0)), 0).label("recorrentes"),
        )
        if estabelecimento_id != 'all':
            q_desp = q_desp.filter(Despesa.estabelecimento_id == estabelecimento_id)
        q_desp = _sem_categorias_integradas(q_desp)
        d = q_desp.first()

        # ── CONTAS A PAGAR pagas: uma query com os mesmos buckets ─────────────
        def _cp_bucket(inicio, fim):
            return func.coalesce(func.sum(case(
                (and_(ContaPagar.data_pagamento >= inicio, ContaPagar.data_pagamento <= fim),
                 ContaPagar.valor_pago), else_=0)), 0)

        q_cp = db.session.query(
            _cp_bucket(hoje, hoje).label("hoje"),
            _cp_bucket(ontem, ontem).label("ontem"),
            _cp_bucket(semana_inicio, hoje).label("semana"),
            _cp_bucket(mes_atual_inicio, hoje).label("mes_atual"),
            _cp_bucket(mes_anterior_inicio, mes_anterior_fim).label("mes_anterior"),
            _cp_bucket(cat_inicio, cat_fim).label("periodo"),
            func.coalesce(func.sum(case(
                (and_(ContaPagar.data_pagamento >= cat_inicio, ContaPagar.data_pagamento <= cat_fim), 1),
                else_=0)), 0).label("periodo_qtd"),
            func.coalesce(func.sum(ContaPagar.valor_pago), 0).label("total_geral"),
        ).filter(ContaPagar.status.in_(['pago', 'parcial']))
        if estabelecimento_id != 'all':
            q_cp = q_cp.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
        cp = q_cp.first()

        _D = lambda v: Decimal(str(v or 0))

        # Pressão de Caixa Imediata: Boletos Vencidos
        q_vencidas = db.session.query(func.sum(func.coalesce(ContaPagar.valor_atual, ContaPagar.valor_original))).filter(
            ContaPagar.status == 'aberto',
            ContaPagar.data_vencimento < hoje
        )
        if estabelecimento_id != 'all':
            q_vencidas = q_vencidas.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
        boletos_vencidos = _D(q_vencidas.scalar() or 0)

        despesas_hoje = _D(d.hoje) + _folha(2) + _D(cp.hoje) + boletos_vencidos
        despesas_ontem = _D(d.ontem) + _folha(3) + _D(cp.ontem) + boletos_vencidos
        despesas_semana = _D(d.semana) + _folha(4) + _D(cp.semana) + boletos_vencidos
        despesas_mes_atual = _D(d.mes_atual) + _folha(0) + _D(cp.mes_atual) + boletos_vencidos
        despesas_mes_anterior = _D(d.mes_anterior) + _folha(1) + _D(cp.mes_anterior)

        folha_periodo = _folha(5)
        contas_periodo_valor = _D(cp.periodo)
        contas_periodo_qtd = int(cp.periodo_qtd or 0)
        soma_periodo = _D(d.periodo) + folha_periodo + contas_periodo_valor
        
        # Adiciona a pressão dos boletos vencidos no total do período se o período englobar o dia de hoje
        if cat_inicio <= hoje <= cat_fim:
            soma_periodo += boletos_vencidos

        total_despesas = int(d.qtd_geral or 0)
        soma_total = _D(d.total_geral) + _D(cp.total_geral)
        despesas_recorrentes = _D(d.recorrentes)

        # ── Variação ──────────────────────────────────────────────────────────
        if despesas_mes_anterior > 0:
            variacao_percentual = (
                (despesas_mes_atual - despesas_mes_anterior) / despesas_mes_anterior
            ) * Decimal('100')
        else:
            variacao_percentual = Decimal('100') if despesas_mes_atual > 0 else Decimal('0')

        # ── Categorias do período (já sem as integradas, via SQL) ─────────────
        query_cats = db.session.query(
                Despesa.categoria,
                func.sum(Despesa.valor).label("total"),
                func.count(Despesa.id).label("quantidade"),
            ).filter(
                Despesa.data_despesa >= cat_inicio,
                Despesa.data_despesa <= cat_fim,
            )
        if estabelecimento_id != 'all':
            query_cats = query_cats.filter(Despesa.estabelecimento_id == estabelecimento_id)
        query_cats = _sem_categorias_integradas(query_cats)
        despesas_por_categoria_raw = query_cats.group_by(Despesa.categoria).order_by(func.sum(Despesa.valor).desc()).all()

        # ── Evolução mensal: 2 group-bys (despesas e contas) + folha batched ──
        from sqlalchemy import extract
        evo_inicio, evo_fim = meses_evolucao[0][0], meses_evolucao[-1][1]

        q_evo_desp = db.session.query(
            extract('year', Despesa.data_despesa).label('ano'),
            extract('month', Despesa.data_despesa).label('mes'),
            func.sum(Despesa.valor).label('total'),
        ).filter(Despesa.data_despesa >= evo_inicio, Despesa.data_despesa <= evo_fim)
        if estabelecimento_id != 'all':
            q_evo_desp = q_evo_desp.filter(Despesa.estabelecimento_id == estabelecimento_id)
        q_evo_desp = _sem_categorias_integradas(q_evo_desp)
        evo_desp = {(int(a), int(m)): _D(t) for a, m, t in q_evo_desp.group_by('ano', 'mes').all()}

        q_evo_cp = db.session.query(
            extract('year', ContaPagar.data_pagamento).label('ano'),
            extract('month', ContaPagar.data_pagamento).label('mes'),
            func.sum(ContaPagar.valor_pago).label('total'),
        ).filter(ContaPagar.status.in_(['pago', 'parcial']),
                 ContaPagar.data_pagamento >= evo_inicio, ContaPagar.data_pagamento <= evo_fim)
        if estabelecimento_id != 'all':
            q_evo_cp = q_evo_cp.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
        evo_cp = {(int(a), int(m)): _D(t) for a, m, t in q_evo_cp.group_by('ano', 'mes').all()}

        evolucao_mensal = []
        for idx, (mes_data, _mes_fim) in enumerate(meses_evolucao):
            chave = (mes_data.year, mes_data.month)
            total_mes = evo_desp.get(chave, Decimal('0')) + evo_cp.get(chave, Decimal('0')) + _folha(6 + idx)
            evolucao_mensal.append({
                "mes": mes_data.strftime("%Y-%m"),
                "total": float(total_mes),
                "mes_nome": mes_data.strftime("%b/%Y"),
            })

        # ── Médias (sobre as despesas agregáveis, não misturando boletos) ─────
        media_valor = (_D(d.total_geral) / Decimal(str(total_despesas))) if total_despesas > 0 else Decimal('0')

        # ── Montar lista de categorias com percentual ─────────────────────────
        despesas_por_categoria_list = []
        
        if folha_periodo > 0:
            percentual_folha = (
                (folha_periodo / soma_periodo * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                if soma_periodo > 0 else Decimal('0')
            )
            despesas_por_categoria_list.append({
                "categoria": "Folha de Pagamento",
                "total": float(folha_periodo),
                "quantidade": folha_detalhe_periodo.get("total_funcionarios_ativos", 0)
                              + folha_detalhe_periodo.get("total_funcionarios_demitidos_periodo", 0),
                "percentual": float(percentual_folha),
                # Abre a caixa-preta do custo de RH para o lojista: salários,
                # provisões (férias+13º), encargos, benefícios, extras, atrasos
                # e rescisões — respondendo "o que compõe esse número?".
                "detalhe": folha_detalhe_periodo,
            })
            
        if contas_periodo_valor > 0:
            percentual_contas = (
                (contas_periodo_valor / soma_periodo * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                if soma_periodo > 0 else Decimal('0')
            )
            despesas_por_categoria_list.append({
                "categoria": "Boleto de Mercadoria",
                "total": float(contas_periodo_valor),
                "quantidade": contas_periodo_qtd,
                "percentual": float(percentual_contas),
            })
            
        if cat_inicio <= hoje <= cat_fim and boletos_vencidos > 0:
            percentual_venc = (
                (boletos_vencidos / soma_periodo * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                if soma_periodo > 0 else Decimal('0')
            )
            despesas_por_categoria_list.append({
                "categoria": "Boletos Vencidos (Atraso)",
                "total": float(boletos_vencidos),
                "quantidade": 1,
                "percentual": float(percentual_venc),
            })
            
        # As categorias integradas já foram excluídas no SQL (_sem_categorias_integradas)
        for categoria, total, quantidade in despesas_por_categoria_raw:
            total_d = Decimal(str(total)) if total else Decimal('0')
            percentual = (
                (total_d / soma_periodo * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                if soma_periodo > 0 else Decimal('0')
            )
            despesas_por_categoria_list.append({
                "categoria": categoria or "Sem categoria",
                "total": float(total_d),
                "quantidade": quantidade or 0,
                "percentual": float(percentual),
            })
            
        # Ordena a lista pelas maiores despesas para o gráfico ficar coerente
        despesas_por_categoria_list.sort(key=lambda x: x["total"], reverse=True)

        return (
            jsonify({
                "success": True,
                "periodo": {
                    "inicio": cat_inicio.isoformat(),
                    "fim": cat_fim.isoformat(),
                },
                "estatisticas": {
                    "total_despesas": total_despesas,
                    "soma_total": float(soma_total),
                    "soma_periodo": float(soma_periodo),
                    "media_valor": float(media_valor),
                    "despesas_hoje": float(despesas_hoje),
                    "despesas_ontem": float(despesas_ontem),
                    "despesas_semana": float(despesas_semana),
                    "despesas_mes_atual": float(despesas_mes_atual),
                    "despesas_mes_anterior": float(despesas_mes_anterior),
                    "variacao_percentual": float(
                        variacao_percentual.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                    ),
                    "despesas_recorrentes": float(despesas_recorrentes),
                    # Não-recorrentes sobre a MESMA base das recorrentes
                    # (lançamentos de Despesa) — antes subtraía de um total que
                    # incluía boletos pagos e o número não fechava com a soma.
                    "despesas_nao_recorrentes": float(_D(d.total_geral) - despesas_recorrentes),
                    "folha_detalhe": folha_detalhe_periodo,
                    "despesas_por_categoria": despesas_por_categoria_list,
                    "evolucao_mensal": evolucao_mensal,
                },
            }),
            200,
        )

    except Exception as e:
        current_app.logger.error(f"Erro ao obter estatísticas: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return (
            jsonify({
                "success": False,
                "error": "Erro ao obter estatísticas",
                "message": str(e),
            }),
            500,
        )

@despesas_bp.route("/detalhamento-unificado", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def detalhamento_unificado():
    from app.utils.query_helpers import get_authorized_establishment_id
    from app.models import Despesa, ContaPagar
    from app.services.rh_calculator_service import calcular_custo_folha_detalhado
    from datetime import datetime

    estabelecimento_id = get_authorized_establishment_id()
    if not estabelecimento_id:
        return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400

    inicio_str = request.args.get("inicio")
    fim_str = request.args.get("fim")
    recorrente = request.args.get("recorrente")

    try:
        inicio = datetime.strptime(inicio_str, "%Y-%m-%d").date() if inicio_str else datetime.now().date()
        fim = datetime.strptime(fim_str, "%Y-%m-%d").date() if fim_str else datetime.now().date()
    except ValueError:
        return jsonify({"success": False, "error": "Datas inválidas"}), 400

    resultados = []

    # 1. Despesas normais (sem as integradas)
    q_desp = db.session.query(Despesa).filter(
        Despesa.data_despesa >= inicio,
        Despesa.data_despesa <= fim
    )
    if estabelecimento_id != 'all':
        q_desp = q_desp.filter(Despesa.estabelecimento_id == estabelecimento_id)
    
    if recorrente is not None:
        is_rec = str(recorrente).lower() in ["true", "1", "yes"]
        q_desp = q_desp.filter(Despesa.recorrente == is_rec)
        
    q_desp = _sem_categorias_integradas(q_desp)
    
    for d in q_desp.all():
        resultados.append({
            "id": f"d_{d.id}",
            "descricao": d.descricao,
            "valor": float(d.valor),
            "data_despesa": d.data_despesa.isoformat() if d.data_despesa else None,
            "categoria": d.categoria,
            "forma_pagamento": d.forma_pagamento,
            "tipo": d.tipo,
            "recorrente": d.recorrente,
            "origem": "despesa"
        })

    # 2. Contas a Pagar (Boletos de Mercadoria) - Não possuem flag "recorrente"
    if recorrente is None or str(recorrente).lower() in ["false", "0", "no"]:
        q_cp = db.session.query(ContaPagar).filter(
            ContaPagar.status.in_(['pago', 'parcial']),
            ContaPagar.data_pagamento >= inicio,
            ContaPagar.data_pagamento <= fim
        )
        if estabelecimento_id != 'all':
            q_cp = q_cp.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
            
        for cp in q_cp.all():
            descricao = f"Boleto NF {cp.nota_fiscal_id}" if getattr(cp, 'nota_fiscal_id', None) else f"Boleto {cp.id}"
            if cp.fornecedor:
                descricao = f"Boleto {cp.fornecedor.nome_fantasia or cp.fornecedor.razao_social}"
            
            resultados.append({
                "id": f"cp_{cp.id}",
                "descricao": descricao,
                "valor": float(cp.valor_pago or 0),
                "data_despesa": cp.data_pagamento.isoformat() if cp.data_pagamento else None,
                "categoria": "Boleto de Mercadoria",
                "forma_pagamento": "Boleto",
                "tipo": "variavel",
                "recorrente": False,
                "origem": "conta_pagar"
            })
            
        # 2.1 Boletos Vencidos (Pressão de Caixa)
        hoje_local = datetime.now().date()
        if inicio <= hoje_local <= fim:
            q_vencidos = db.session.query(ContaPagar).filter(
                ContaPagar.status == 'aberto',
                ContaPagar.data_vencimento < hoje_local
            )
            if estabelecimento_id != 'all':
                q_vencidos = q_vencidos.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
                
            for cp in q_vencidos.all():
                descricao = f"Boleto Vencido NF {cp.nota_fiscal_id}" if getattr(cp, 'nota_fiscal_id', None) else f"Boleto Vencido {cp.id}"
                if cp.fornecedor:
                    descricao = f"Boleto Vencido - {cp.fornecedor.nome_fantasia or cp.fornecedor.razao_social}"
                
                valor_devido = float(cp.valor_atual if cp.valor_atual else (cp.valor_original or 0))
                
                resultados.append({
                    "id": f"cp_venc_{cp.id}",
                    "descricao": descricao,
                    "valor": valor_devido,
                    "data_despesa": cp.data_vencimento.isoformat() if cp.data_vencimento else hoje_local.isoformat(),
                    "categoria": "Boletos Vencidos (Atraso)",
                    "forma_pagamento": "Pressão de Caixa",
                    "tipo": "variavel",
                    "recorrente": False,
                    "origem": "conta_pagar"
                })

    # 3. Folha de Pagamento
    if recorrente is None:
        try:
            folha = calcular_custo_folha_detalhado(estabelecimento_id, inicio, fim)
            custo_folha = float(folha.get("custo_folha", {}).get("custo_real_total", 0.0))
            if custo_folha > 0:
                resultados.append({
                    "id": f"f_{inicio.strftime('%Y%m%d')}",
                    "descricao": "Custo Rateado (Pressão Diária da Folha)",
                    "valor": custo_folha,
                    "data_despesa": fim.isoformat(),
                    "categoria": "Folha de Pagamento",
                    "forma_pagamento": "Pressão de Caixa",
                    "tipo": "fixa",
                    "recorrente": True,
                    "origem": "folha"
                })
        except Exception as e:
            current_app.logger.error(f"Erro ao calcular folha para detalhamento: {e}")

    # Ordenar por data decrescente
    resultados.sort(key=lambda x: x["data_despesa"] or "", reverse=True)

    return jsonify({"success": True, "data": resultados})


# Os endpoints POST, PUT e DELETE permanecem os mesmos
@despesas_bp.route("/", methods=["POST"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def criar_despesa():
    """Cria uma despesa para o estabelecimento do usuário logado."""
    current_user_id = get_jwt_identity()
    funcionario = Funcionario.query.get(current_user_id)

    if not funcionario:
        return jsonify({"success": False, "error": "Usuário não encontrado"}), 404

    data = request.get_json() or {}

    descricao = (data.get("descricao") or "").strip()
    valor = data.get("valor")

    if not descricao:
        return jsonify({"success": False, "error": "Descrição é obrigatória"}), 400

    try:
        valor = float(valor)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Valor inválido"}), 400

    if valor < 0:
        return jsonify({"success": False, "error": "Valor não pode ser negativo"}), 400

    def _parse_date_field(raw):
        """Parse YYYY-MM-DD string to date, or return None."""
        if not raw:
            return None
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            return None

    data_despesa_date = _parse_date_field(data.get("data_despesa")) or datetime.now().date()
    data_emissao_date = _parse_date_field(data.get("data_emissao"))
    data_vencimento_date = _parse_date_field(data.get("data_vencimento"))

    despesa = Despesa(
        estabelecimento_id=funcionario.estabelecimento_id,
        descricao=descricao,
        categoria=(data.get("categoria") or "geral").strip() or "geral",
        tipo=(data.get("tipo") or "variavel").strip() or "variavel",
        valor=valor,
        data_despesa=data_despesa_date,
        data_emissao=data_emissao_date,
        data_vencimento=data_vencimento_date,
        forma_pagamento=(data.get("forma_pagamento") or "").strip() or None,
        recorrente=bool(data.get("recorrente", False)),
        observacoes=(data.get("observacoes") or "").strip() or None,
    )

    db.session.add(despesa)
    db.session.commit()

    return jsonify({"success": True, "data": despesa.to_dict()}), 201


@despesas_bp.route("/<int:despesa_id>", methods=["PUT"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def atualizar_despesa(despesa_id: int):
    """Atualiza uma despesa (somente do próprio estabelecimento)."""
    current_user_id = get_jwt_identity()
    funcionario = Funcionario.query.get(current_user_id)

    if not funcionario:
        return jsonify({"success": False, "error": "Usuário não encontrado"}), 404

    despesa = Despesa.query.get(despesa_id)
    if not despesa or despesa.estabelecimento_id != funcionario.estabelecimento_id:
        return jsonify({"success": False, "error": "Despesa não encontrada"}), 404

    data = request.get_json() or {}

    if "descricao" in data:
        descricao = (data.get("descricao") or "").strip()
        if not descricao:
            return jsonify({"success": False, "error": "Descrição é obrigatória"}), 400
        despesa.descricao = descricao

    if "categoria" in data:
        despesa.categoria = (data.get("categoria") or "geral").strip() or "geral"

    if "tipo" in data:
        despesa.tipo = (data.get("tipo") or "variavel").strip() or "variavel"

    if "valor" in data:
        try:
            valor = float(data.get("valor"))
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "Valor inválido"}), 400
        if valor < 0:
            return (
                jsonify({"success": False, "error": "Valor não pode ser negativo"}),
                400,
            )
        despesa.valor = valor

    def _parse_date(raw):
        if not raw:
            return None
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            return None

    if "data_despesa" in data:
        despesa.data_despesa = _parse_date(data["data_despesa"]) or despesa.data_despesa
    if "data_emissao" in data:
        despesa.data_emissao = _parse_date(data["data_emissao"])
    if "data_vencimento" in data:
        despesa.data_vencimento = _parse_date(data["data_vencimento"])



    if "forma_pagamento" in data:
        fp = (data.get("forma_pagamento") or "").strip()
        despesa.forma_pagamento = fp or None

    if "recorrente" in data:
        despesa.recorrente = bool(data.get("recorrente"))

    if "observacoes" in data:
        obs = (data.get("observacoes") or "").strip()
        despesa.observacoes = obs or None

    db.session.commit()

    return jsonify({"success": True, "data": despesa.to_dict()}), 200


@despesas_bp.route("/<int:despesa_id>", methods=["DELETE"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def deletar_despesa(despesa_id: int):
    """Remove uma despesa (somente do próprio estabelecimento)."""
    current_user_id = get_jwt_identity()
    funcionario = Funcionario.query.get(current_user_id)

    if not funcionario:
        return jsonify({"success": False, "error": "Usuário não encontrado"}), 404

    despesa = Despesa.query.get(despesa_id)
    if not despesa or despesa.estabelecimento_id != funcionario.estabelecimento_id:
        return jsonify({"success": False, "error": "Despesa não encontrada"}), 404

    db.session.delete(despesa)
    db.session.commit()

    return jsonify({"success": True}), 200
@despesas_bp.route("/boletos-a-vencer/", methods=["GET"])
@funcionario_required
@plan_required('Pro')
def boletos_a_vencer():
    """Lista boletos de fornecedores que estão próximos ao vencimento"""
    try:
        from app.models import ContaPagar, Fornecedor
        from datetime import date, timedelta
        
        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400
        
        # Parâmetros
        dias_antecedencia = int(request.args.get('dias', 30))  # Próximos 30 dias por padrão
        apenas_vencidos = request.args.get('apenas_vencidos') == 'true'
        
        # Query base
        from sqlalchemy.orm import joinedload
        query = db.session.query(ContaPagar).options(
            joinedload(ContaPagar.fornecedor),
            joinedload(ContaPagar.pedido_compra)
        ).filter(ContaPagar.status == 'aberto')
        if estabelecimento_id != 'all':
             query = query.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
        
        if apenas_vencidos:
            # Apenas boletos já vencidos
            query = query.filter(ContaPagar.data_vencimento < date.today())
        else:
            # Boletos que vencem nos próximos X dias
            data_limite = date.today() + timedelta(days=dias_antecedencia)
            query = query.filter(ContaPagar.data_vencimento <= data_limite)
        
        boletos = query.order_by(ContaPagar.data_vencimento.asc()).all()
        
        # Processar resultados
        boletos_data = []
        total_valor = Decimal('0')
        
        for boleto in boletos:
            dias_vencimento = (boleto.data_vencimento - date.today()).days

            # Determinar origem: mercadoria (pedido de compra) ou despesa fixa
            tem_pedido = boleto.pedido_compra_id is not None and getattr(boleto, 'pedido_compra', None) is not None
            if tem_pedido:
                origem = "mercadoria"
                descricao = f"Pedido {boleto.pedido_compra.numero_pedido}"
            else:
                origem = "despesa"
                descricao = boleto.observacoes or "Despesa" # tipo_documento was removed from ContaPagar

            status_vencimento = 'normal'
            if dias_vencimento < 0:
                 status_vencimento = 'vencido'
            elif dias_vencimento == 0:
                 status_vencimento = 'vence_hoje'
            elif dias_vencimento <= 7:
                 status_vencimento = 'vence_em_breve'

            boleto_info = {
                'id': boleto.id,
                'numero_documento': boleto.numero_documento,
                'tipo_documento': 'boleto', # fallback since tipo_documento doesn't exist
                'origem': origem,
                'descricao': descricao,
                'fornecedor_nome': boleto.fornecedor.nome_fantasia if boleto.fornecedor else 'N/A',
                'fornecedor_id': boleto.fornecedor_id,
                'valor_original': float(boleto.valor_original),
                'valor_atual': float(boleto.valor_atual),
                'data_emissao': boleto.data_emissao.isoformat() if boleto.data_emissao else None,
                'data_vencimento': boleto.data_vencimento.isoformat() if boleto.data_vencimento else None,
                'dias_vencimento': dias_vencimento,
                'status_vencimento': status_vencimento,
                'pedido_numero': boleto.pedido_compra.numero_pedido if tem_pedido else None,
                'pedido_id': boleto.pedido_compra_id if tem_pedido else None,
                'data_pedido': boleto.pedido_compra.data_pedido.isoformat() if tem_pedido and boleto.pedido_compra.data_pedido else None,
                'itens': [item.to_dict() for item in boleto.pedido_compra.itens] if tem_pedido and hasattr(boleto.pedido_compra, 'itens') else [],
                'observacoes': boleto.observacoes
            }
            
            boletos_data.append(boleto_info)
            total_valor += boleto.valor_atual
        
        # Estatísticas
        vencidos = [b for b in boletos_data if b['dias_vencimento'] < 0]
        vence_hoje = [b for b in boletos_data if b['dias_vencimento'] == 0]
        vence_7_dias = [b for b in boletos_data if 0 < b['dias_vencimento'] <= 7]
        
        return jsonify({
            'boletos': boletos_data,
            'resumo': {
                'total_boletos': len(boletos_data),
                'total_valor': float(total_valor),
                'vencidos': len(vencidos),
                'vence_hoje': len(vence_hoje),
                'vence_7_dias': len(vence_7_dias),
                'valor_vencidos': float(sum(Decimal(str(b['valor_atual'])) for b in vencidos)),
                'valor_vence_hoje': float(sum(Decimal(str(b['valor_atual'])) for b in vence_hoje)),
                'valor_vence_7_dias': float(sum(Decimal(str(b['valor_atual'])) for b in vence_7_dias))
            }
        })
        
    except Exception as e:
        current_app.logger.error(f"Erro ao buscar boletos a vencer: {str(e)}")
        return jsonify({"error": "Erro interno do servidor"}), 500


@despesas_bp.route("/resumo-financeiro/", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def resumo_financeiro():
    """
    Resumo financeiro consolidado otimizado para Vercel.
    Retorna visão de DRE e Fluxo de Caixa Real.
    """
    try:
        from app.dashboard_cientifico.data_layer import DataLayer
        from datetime import date, timedelta, datetime

        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400

        hoje = date.today()
        data_inicio_str = request.args.get('data_inicio')
        data_fim_str = request.args.get('data_fim')

        if data_inicio_str and data_fim_str:
            try:
                dt_inicio = datetime.strptime(data_inicio_str, '%Y-%m-%d').date()
                dt_fim = datetime.strptime(data_fim_str, '%Y-%m-%d').date()
            except ValueError:
                dt_inicio = hoje.replace(day=1)
                dt_fim = hoje
        else:
            dt_inicio = hoje.replace(day=1)
            dt_fim = hoje

        # 🚀 CONSOLIDAÇÃO PROFISSIONAL: Reduz de 12 para 3 queries principais
        financial_data = DataLayer.get_consolidated_financial_summary(estabelecimento_id, dt_inicio, dt_fim)
        
        if not financial_data:
             return jsonify({"error": "Falha ao consolidar dados financeiros"}), 500

        cp = financial_data['contas_pagar']
        vendas = financial_data['vendas']
        desp = financial_data['despesas']
        caixa_pdv = financial_data.get('caixa_pdv', {'sangrias': 0.0, 'suprimentos': 0.0})
        
        # --- Lógica Exata para Mercadinho ---
        receita_bruta = vendas.get("revenue", 0.0)
        total_pagar_aberto = cp['total_aberto']
        dav = financial_data.get('despesas_a_vencer', {"vence_hoje": 0.0, "vence_7d": 0.0, "vence_30d": 0.0, "vencidas": 0.0})

        dias_periodo = (dt_fim - dt_inicio).days + 1
        venda_media_diaria = receita_bruta / dias_periodo if dias_periodo > 0 else 0

        # Obrigações de curtíssimo/curto prazo = Contas a Pagar (boletos) + Despesas com vencimento
        obrigacoes_hoje = cp['vence_hoje_valor'] + dav['vence_hoje']
        obrigacoes_7d = cp['vence_7d'] + dav['vence_7d']
        obrigacoes_30d = cp['vence_30d'] + dav['vence_30d']

        # 1. Índice de Comprometimento: dívida em aberto + obrigações a vencer (30d) vs faturamento do período.
        # Adiciona também a provisão da folha de pagamento do período como uma obrigação real.
        folha_detalhada = calcular_custo_folha_detalhado(estabelecimento_id, dt_inicio, dt_fim)
        custo_folha_total = folha_detalhada.get("custo_folha", {}).get("custo_real_total", 0.0)
        
        total_obrigacoes = total_pagar_aberto + dav['vence_30d'] + dav['vencidas'] + custo_folha_total
        if receita_bruta > 0:
            indice_comprometimento = total_obrigacoes / receita_bruta * 100
        else:
            indice_comprometimento = 100.0 if total_obrigacoes > 0 else 0.0

        # Contas a receber: o que a empresa tem para entrar (prazo de 30/60 dias não é caixa de hoje).
        from sqlalchemy import and_, case as sa_case, func as sa_func
        from app.models import ContaReceber, Configuracao
        _ate_7d, _ate_30d = hoje + timedelta(days=7), hoje + timedelta(days=30)
        _valor = ContaReceber.valor_atual
        _receber = db.session.query(
            sa_func.coalesce(sa_func.sum(_valor), 0),
            sa_func.coalesce(sa_func.sum(sa_case((ContaReceber.data_vencimento < hoje, _valor), else_=0)), 0),
            sa_func.coalesce(sa_func.sum(sa_case((and_(ContaReceber.data_vencimento >= hoje, ContaReceber.data_vencimento <= _ate_7d), _valor), else_=0)), 0),
            sa_func.coalesce(sa_func.sum(sa_case((and_(ContaReceber.data_vencimento >= hoje, ContaReceber.data_vencimento <= _ate_30d), _valor), else_=0)), 0),
        ).filter(ContaReceber.status == 'aberto', ContaReceber.valor_atual > 0)
        if str(estabelecimento_id).lower() != 'all':
            _receber = _receber.filter(ContaReceber.estabelecimento_id == estabelecimento_id)
        receber_total, receber_vencido, receber_7d, receber_30d = (float(v or 0) for v in _receber.one())

        # 2. Pressão de Caixa (7 dias): obrigações dos próximos 7 dias vs entrada esperada no mesmo horizonte.
        # Entrada esperada = vendas recebidas no ato (média diária) + títulos a receber que vencem na semana.
        venda_a_vista_diaria = vendas.get("total_recebido", 0.0) / dias_periodo if dias_periodo > 0 else 0
        entrada_esperada_7d = venda_a_vista_diaria * 7 + receber_7d
        if entrada_esperada_7d > 0:
            pressao_caixa = obrigacoes_7d / entrada_esperada_7d * 100
        else:
            pressao_caixa = 100.0 if obrigacoes_7d > 0 else 0.0

        # Alertas simplificados e precisos (Foco em Saídas)
        alertas = []
        if cp['qtd_vencidos'] > 0:
            alertas.append({
                "tipo": "boleto_vencido",
                "severidade": "critica",
                "titulo": f"{cp['qtd_vencidos']} boleto(s) vencido(s)",
                "descricao": f"Total de R$ {cp['total_vencido']:,.2f} vencidos. Regularize para evitar juros.",
                "acao": "Regularizar pagamento imediatamente",
            })
            
        if indice_comprometimento > 80:
            alertas.append({
                "tipo": "comprometimento_alto",
                "severidade": "alta",
                "titulo": "Comprometimento Crítico",
                "descricao": f"Seus boletos em aberto representam {indice_comprometimento:.1f}% do faturamento deste período.",
                "acao": "Reduzir compras ou renegociar prazos com fornecedores",
            })

        # Fluxo de Caixa REAL (regime de caixa): entradas = o que de fato foi
        # recebido nas vendas + suprimentos (inclui recebimento de fiado, que
        # entra como suprimento na data do pagamento); saídas = boletos pagos
        # no período + despesas desembolsadas + sangrias.
        # `despesas_caixa` exclui os espelhos de boleto (senão o mesmo boleto
        # contava aqui E em pago_periodo) e NÃO inclui a folha provisionada
        # (provisão não é dinheiro que saiu do caixa; os pagamentos manuais de
        # salário lançados como Despesa continuam contando).
        despesas_operacionais = desp.get('despesas_operacionais', desp.get('total', 0.0))
        despesas_caixa = desp.get('despesas_caixa', despesas_operacionais)

        entradas_reais = vendas.get("total_recebido", 0.0) + caixa_pdv['suprimentos']
        saidas_reais = cp['pago_periodo'] + despesas_caixa + caixa_pdv['sangrias']

        # DRE: receita bruta − impostos sobre vendas = receita líquida; − CMV = lucro bruto.
        _config = (Configuracao.query.filter_by(estabelecimento_id=estabelecimento_id).first()
                   if str(estabelecimento_id).lower() != 'all' else None)
        aliquota_impostos = float(_config.aliquota_impostos_venda) if _config and _config.aliquota_impostos_venda is not None else None
        impostos_venda = receita_bruta * (aliquota_impostos or 0.0) / 100.0
        receita_liquida = receita_bruta - impostos_venda
        lucro_bruto = receita_liquida - vendas.get("cogs", 0.0)

        return jsonify({
            "success": True,
            "periodo": {
                "inicio": dt_inicio.isoformat(),
                "fim": dt_fim.isoformat()
            },
            # DRE por competência. Antes `desp['total']` (que JÁ incluía a
            # folha calculada pelo DataLayer) era somado de novo com
            # custo_folha_total — a folha aparecia DUAS vezes no total e no
            # lucro líquido. Agora: operacionais (sem espelhos) + pessoal, uma vez.
            "dre_consolidado": {
                "receita_bruta": receita_bruta,
                "impostos_sobre_vendas": impostos_venda,
                "receita_liquida": receita_liquida,
                "custo_mercadoria": vendas.get("cogs", 0.0),
                "lucro_bruto": lucro_bruto,
                "despesas_pessoal": custo_folha_total,
                "despesas_operacionais": despesas_operacionais,
                "total_despesas": despesas_operacionais + custo_folha_total,
                "lucro_liquido": lucro_bruto - despesas_operacionais - custo_folha_total,
                "impostos_configurados": aliquota_impostos is not None,
                "aliquota_impostos_venda": aliquota_impostos,
                "aviso": None if aliquota_impostos is not None else
                         "Alíquota de impostos sobre vendas não configurada: o lucro está antes dos impostos.",
            },
            "contas_receber": {
                "total_aberto": receber_total,
                "vencido": receber_vencido,
                "vence_7_dias": receber_7d,
                "vence_30_dias": receber_30d,
            },
            "indicadores_gestao": {
                "indice_comprometimento": indice_comprometimento,
                "pressao_caixa_diaria": pressao_caixa,  # compat: agora horizonte de 7 dias
                "pressao_caixa_7d": pressao_caixa,
                "venda_media_diaria": venda_media_diaria,
                "entrada_esperada_7d": entrada_esperada_7d,
                "venda_a_vista_media_diaria": venda_a_vista_diaria,
                "vence_hoje_valor": cp['vence_hoje_valor'],
                "obrigacoes_hoje": obrigacoes_hoje,
                "obrigacoes_7d": obrigacoes_7d,
                "obrigacoes_30d": obrigacoes_30d,
                "despesas_a_vencer": dav
            },
            "contas_pagar": {
                "total_aberto": cp['total_aberto'],
                "total_vencido": cp['total_vencido'],
                "vence_hoje": cp['vence_hoje_valor'],
                "vence_7_dias": cp['vence_7d'],
                "vence_30_dias": cp['vence_30d'],
                "pago_no_mes": cp['pago_periodo'],
                "qtd_vencidos": cp['qtd_vencidos'],
                "qtd_vence_hoje": cp['qtd_vence_hoje'],
                "qtd_vence_7d": cp['qtd_vence_7d']
            },
            "despesas_mes": {
                "total": despesas_operacionais + custo_folha_total,
                "recorrentes": desp['recorrentes'],
                # Variáveis sobre a mesma base das recorrentes (lançamentos
                # operacionais) — antes subtraía de um total que incluía folha.
                "variaveis": max(0.0, despesas_operacionais - desp['recorrentes'])
            },
            "caixa_pdv": {
                "sangrias": caixa_pdv['sangrias'],
                "suprimentos": caixa_pdv['suprimentos'],
            },
            "fluxo_caixa_real": {
                "entradas": entradas_reais,
                "saidas": saidas_reais,
                "saldo": entradas_reais - saidas_reais,
                "interpretacao": "Positivo" if (entradas_reais - saidas_reais) >= 0 else "Negativo"
            },
            "alertas": alertas,
            "total_alertas": len(alertas),
        })
    except Exception as e:
        current_app.logger.error(f"Erro ao gerar resumo financeiro: {str(e)}")
        return jsonify({"error": "Erro interno do servidor", "message": str(e)}), 500


@despesas_bp.route("/historico-comparativo", methods=["GET"], strict_slashes=False)
@despesas_bp.route("/historico-comparativo/", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def historico_comparativo():
    """
    Retorna histórico comparativo de despesas dos últimos 12 meses,
    agrupado por mês × categoria, com variação percentual mês a mês,
    identificação de categorias com maior crescimento e insights inteligentes.
    """
    try:
        from sqlalchemy import func, extract
        from datetime import date, timedelta
        from collections import defaultdict

        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400

        hoje = date.today()
        # Calcula os últimos 12 meses
        meses = []
        for i in range(11, -1, -1):
            m = hoje.replace(day=1)
            # Retrocede i meses
            for _ in range(i):
                if m.month == 1:
                    m = m.replace(year=m.year - 1, month=12)
                else:
                    m = m.replace(month=m.month - 1)
            if m.month == 12:
                fim_m = m.replace(year=m.year + 1, month=1, day=1)
            else:
                fim_m = m.replace(month=m.month + 1, day=1)
            fim_m = fim_m - timedelta(days=1)
            if fim_m > hoje:
                fim_m = hoje
            meses.append((m, fim_m))

        # Query: soma por mês e categoria
        inicio_periodo = meses[0][0]

        query = db.session.query(
            Despesa.categoria,
            extract('year', Despesa.data_despesa).label('ano'),
            extract('month', Despesa.data_despesa).label('mes_num'),
            func.sum(Despesa.valor).label('total'),
            func.count(Despesa.id).label('qtd'),
        ).filter(
            Despesa.data_despesa >= inicio_periodo,
            Despesa.data_despesa <= hoje,
        )
        if estabelecimento_id != 'all':
            query = query.filter(Despesa.estabelecimento_id == estabelecimento_id)

        rows = query.group_by(Despesa.categoria, extract('year', Despesa.data_despesa), extract('month', Despesa.data_despesa)).all()

        # Indexa os dados: {mes: {categoria: {total, qtd}}}
        dados_mes_cat = defaultdict(lambda: defaultdict(lambda: {"total": 0.0, "qtd": 0}))
        todas_categorias = set()
        for cat, ano, mes_num, total, qtd in rows:
            categoria = cat or "outros"
            mes_str = f"{int(ano):04d}-{int(mes_num):02d}"
            dados_mes_cat[mes_str][categoria]["total"] += float(total or 0)
            dados_mes_cat[mes_str][categoria]["qtd"] += int(qtd or 0)
            todas_categorias.add(categoria)

        # Totais por mês
        totais_mes = {}
        for m_inicio, m_fim in meses:
            chave = m_inicio.strftime('%Y-%m')
            totais_mes[chave] = sum(
                v["total"] for v in dados_mes_cat.get(chave, {}).values()
            )

        # Calcula variação mês a mês por categoria
        evolucao_por_categoria = {}
        for cat in sorted(todas_categorias):
            serie = []
            for m_inicio, _ in meses:
                chave = m_inicio.strftime('%Y-%m')
                total_cat = dados_mes_cat.get(chave, {}).get(cat, {}).get("total", 0.0)
                serie.append({
                    "mes": chave,
                    "mes_nome": m_inicio.strftime("%b/%Y"),
                    "total": round(total_cat, 2),
                })
            evolucao_por_categoria[cat] = serie

        # Variação categoria: mês atual vs anterior
        mes_atual_chave = hoje.replace(day=1).strftime('%Y-%m')
        mes_ant = hoje.replace(day=1)
        if mes_ant.month == 1:
            mes_ant = mes_ant.replace(year=mes_ant.year - 1, month=12)
        else:
            mes_ant = mes_ant.replace(month=mes_ant.month - 1)
        mes_anterior_chave = mes_ant.strftime('%Y-%m')

        variacoes = []
        for cat in sorted(todas_categorias):
            atual = dados_mes_cat.get(mes_atual_chave, {}).get(cat, {}).get("total", 0.0)
            anterior = dados_mes_cat.get(mes_anterior_chave, {}).get(cat, {}).get("total", 0.0)
            if anterior > 0:
                delta = ((atual - anterior) / anterior) * 100
            elif atual > 0:
                delta = 100.0
            else:
                delta = 0.0
            variacoes.append({
                "categoria": cat,
                "atual": round(atual, 2),
                "anterior": round(anterior, 2),
                "delta_percentual": round(delta, 1),
                "cresceu": delta > 0,
            })
        # Ordena pelo maior impacto absoluto
        variacoes.sort(key=lambda x: abs(x["delta_percentual"]), reverse=True)

        # Insights inteligentes automáticos
        insights = []

        # Insight 1: Categoria com maior crescimento
        cat_cresce = [v for v in variacoes if v["cresceu"] and v["anterior"] > 0]
        if cat_cresce:
            top = cat_cresce[0]
            insights.append({
                "tipo": "crescimento",
                "severidade": "alta" if top["delta_percentual"] > 30 else "media",
                "titulo": f"'{top['categoria'].title()}' subiu {top['delta_percentual']:.0f}%",
                "descricao": f"Em {mes_atual_chave}, a categoria '{top['categoria']}' custou R$\u00a0{top['atual']:,.2f} vs R$\u00a0{top['anterior']:,.2f} no mês anterior.",
                "acao": "Analise se houve compra pontual ou aumento estrutural de custos.",
            })

        # Insight 2: Total atual vs anterior
        total_atual = totais_mes.get(mes_atual_chave, 0.0)
        total_anterior = totais_mes.get(mes_anterior_chave, 0.0)
        if total_anterior > 0:
            delta_total = ((total_atual - total_anterior) / total_anterior) * 100
            if abs(delta_total) > 5:
                insights.append({
                    "tipo": "total_mes",
                    "severidade": "alta" if delta_total > 20 else "baixa",
                    "titulo": f"Despesas {'subiram' if delta_total > 0 else 'caíram'} {abs(delta_total):.0f}% este mês",
                    "descricao": f"Total deste mês: R$\u00a0{total_atual:,.2f} vs R$\u00a0{total_anterior:,.2f} no mês anterior.",
                    "acao": "Revise os lançamentos do período para identificar gastos não recorrentes.",
                })

        # Insight 3: Categoria que domina as despesas
        cat_atual = sorted(
            [(cat, dados_mes_cat.get(mes_atual_chave, {}).get(cat, {}).get("total", 0.0))
             for cat in todas_categorias],
            key=lambda x: x[1], reverse=True
        )
        if cat_atual and total_atual > 0:
            top_cat, top_val = cat_atual[0]
            pct = (top_val / total_atual) * 100
            if pct > 30:
                insights.append({
                    "tipo": "concentracao",
                    "severidade": "media",
                    "titulo": f"'{top_cat.title()}' representa {pct:.0f}% das despesas",
                    "descricao": f"Categoria '{top_cat}' é responsável por R$\u00a0{top_val:,.2f} do total de R$\u00a0{total_atual:,.2f} este mês.",
                    "acao": "Diversifique ou renegocie para reduzir concentração em uma categoria.",
                })

        # Projeção dos próximos 3 meses com base na média dos últimos 3
        ultimos_3 = [totais_mes.get(meses[-1-i][0].strftime('%Y-%m'), 0.0) for i in range(3)]
        media_3m = sum(ultimos_3) / 3 if any(ultimos_3) else 0.0

        # Meses para os dados do gráfico de barras empilhadas
        meses_labels = [m[0].strftime('%Y-%m') for m in meses]
        meses_nomes = [m[0].strftime('%b/%Y') for m in meses]

        return jsonify({
            "success": True,
            "periodo": {
                "inicio": meses[0][0].isoformat(),
                "fim": hoje.isoformat(),
                "meses": [
                    {"chave": m[0].strftime('%Y-%m'), "nome": m[0].strftime('%b/%Y'), "total": round(totais_mes.get(m[0].strftime('%Y-%m'), 0.0), 2)}
                    for m in meses
                ]
            },
            "categorias": sorted(list(todas_categorias)),
            "evolucao_por_categoria": evolucao_por_categoria,
            "variacoes_mes_atual": variacoes,
            "totais_por_mes": {chave: round(v, 2) for chave, v in totais_mes.items()},
            "meses_labels": meses_labels,
            "meses_nomes": meses_nomes,
            "projecao_proximos_meses": round(media_3m, 2),
            "insights": insights,
            "resumo_periodo": {
                "total_geral": round(sum(totais_mes.values()), 2),
                "media_mensal": round(sum(totais_mes.values()) / len(meses) if meses else 0, 2),
                "mes_mais_caro": max(totais_mes.items(), key=lambda x: x[1])[0] if totais_mes and sum(totais_mes.values()) > 0 else None,
                "mes_mais_barato": min([(k, v) for k, v in totais_mes.items() if v > 0], key=lambda x: x[1])[0] if any(v > 0 for v in totais_mes.values()) else None,
            }
        })

    except Exception as e:
        current_app.logger.error(f"Erro ao gerar histórico comparativo: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return jsonify({"error": "Erro interno do servidor", "message": str(e)}), 500


@despesas_bp.route("/boletos-status", methods=["GET"], strict_slashes=False)
@despesas_bp.route("/boletos-status/", methods=["GET"], strict_slashes=False)
@funcionario_required
@plan_required('Pro')
def boletos_por_status():
    """
    Retorna boletos (ContaPagar) separados por status:
    - vencidos: status=aberto e data_vencimento < hoje
    - a_vencer: status=aberto e data_vencimento >= hoje e <= hoje+30d
    - pagos: status=pago, filtro por período
    """
    try:
        from app.models import ContaPagar, Fornecedor
        from datetime import date, timedelta

        from app.utils.query_helpers import ilike_unaccent, get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"error": "Estabelecimento não identificado"}), 400

        hoje = date.today()
        dias = int(request.args.get('dias', 30))
        limite_vencer = hoje + timedelta(days=dias)

        # Query base
        def base_query():
            from sqlalchemy.orm import joinedload
            q = db.session.query(ContaPagar).options(
                joinedload(ContaPagar.fornecedor),
                joinedload(ContaPagar.pedido_compra)
            )
            if estabelecimento_id != 'all':
                q = q.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
            return q

        def serialize_boleto(b):
            tem_pedido = b.pedido_compra_id is not None
            descricao = b.observacoes or "Despesa"
            if tem_pedido and b.pedido_compra:
                descricao = f"Pedido {b.pedido_compra.numero_pedido}"
            dias_venc = (b.data_vencimento - hoje).days if b.data_vencimento else None
            return {
                "id": b.id,
                "numero_documento": b.numero_documento,
                "descricao": descricao,
                "fornecedor_nome": b.fornecedor.nome_fantasia if b.fornecedor else "—",
                "fornecedor_id": b.fornecedor_id,
                "valor_original": float(b.valor_original),
                "valor_atual": float(b.valor_atual),
                "data_emissao": b.data_emissao.isoformat() if b.data_emissao else None,
                "data_vencimento": b.data_vencimento.isoformat() if b.data_vencimento else None,
                "data_pagamento": b.data_pagamento.isoformat() if hasattr(b, 'data_pagamento') and b.data_pagamento else None,
                "dias_vencimento": dias_venc,
                "status": b.status,
                "observacoes": b.observacoes,
            }

        # Vencidos
        vencidos_q = base_query().filter(
            ContaPagar.status == 'aberto',
            ContaPagar.data_vencimento < hoje,
        ).order_by(ContaPagar.data_vencimento.asc())
        vencidos = [serialize_boleto(b) for b in vencidos_q.all()]

        # A vencer
        a_vencer_q = base_query().filter(
            ContaPagar.status == 'aberto',
            ContaPagar.data_vencimento >= hoje,
            ContaPagar.data_vencimento <= limite_vencer,
        ).order_by(ContaPagar.data_vencimento.asc())
        a_vencer = [serialize_boleto(b) for b in a_vencer_q.all()]

        # Pagos no período (últimos 30 dias por padrão)
        inicio_pagos_str = request.args.get('inicio_pagos')
        if inicio_pagos_str:
            try:
                inicio_pagos = datetime.strptime(inicio_pagos_str, '%Y-%m-%d').date()
            except ValueError:
                inicio_pagos = hoje - timedelta(days=30)
        else:
            inicio_pagos = hoje - timedelta(days=30)

        pagos_q = base_query().filter(
            ContaPagar.status == 'pago',
        )
        # Filtra por data de pagamento se disponível, senão por vencimento
        try:
            pagos_q = pagos_q.filter(ContaPagar.data_pagamento >= inicio_pagos)
        except Exception:
            pagos_q = pagos_q.filter(ContaPagar.data_vencimento >= inicio_pagos)

        pagos_q = pagos_q.order_by(ContaPagar.data_vencimento.desc())
        pagos = [serialize_boleto(b) for b in pagos_q.all()]

        def total(lst):
            return round(sum(b['valor_atual'] for b in lst), 2)

        return jsonify({
            "success": True,
            "vencidos": {
                "items": vencidos,
                "quantidade": len(vencidos),
                "total": total(vencidos),
            },
            "a_vencer": {
                "items": a_vencer,
                "quantidade": len(a_vencer),
                "total": total(a_vencer),
                "dias_antecedencia": dias,
            },
            "pagos": {
                "items": pagos,
                "quantidade": len(pagos),
                "total": total(pagos),
                "inicio_periodo": inicio_pagos.isoformat(),
            },
            "resumo": {
                "total_vencidos": total(vencidos),
                "total_a_vencer": total(a_vencer),
                "total_pago_periodo": total(pagos),
                "qtd_vencidos": len(vencidos),
                "qtd_a_vencer": len(a_vencer),
                "qtd_pagos": len(pagos),
            }
        })

    except Exception as e:
        current_app.logger.error(f"Erro ao buscar boletos por status: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return jsonify({"error": "Erro interno do servidor", "message": str(e)}), 500