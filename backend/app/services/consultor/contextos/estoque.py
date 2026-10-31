from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import func
from app import db
from app.models import Produto, CategoriaProduto
from app.utils.abc_cache import get_classificacoes_abc
from app.utils.timezone import hoje_local, to_local


def montar_contexto(estabelecimento_id: int, is_manager: bool = True) -> dict:
    """Monta o contexto de estoque para o consultor IA."""
    hoje = hoje_local()
    ha_60_dias = hoje - timedelta(days=60)

    contexto = {}

    # 1. Total de Produtos Ativos
    q_ativos = db.session.query(func.count(Produto.id)).filter(Produto.ativo == True)
    if estabelecimento_id != "all":
        q_ativos = q_ativos.filter(Produto.estabelecimento_id == estabelecimento_id)
    contexto["produtos_ativos_qtd"] = q_ativos.scalar() or 0

    # Classificações ABC do cache
    abc_dict = get_classificacoes_abc(estabelecimento_id)

    # 2. Itens com estoque <= mínimo (Top 15 por estoque)
    q_alertas = db.session.query(Produto).filter(
        Produto.ativo == True,
        Produto.quantidade <= Produto.quantidade_minima,
    )
    if estabelecimento_id != "all":
        q_alertas = q_alertas.filter(Produto.estabelecimento_id == estabelecimento_id)

    produtos_alerta = q_alertas.all()
    produtos_alerta.sort(key=lambda p: (abc_dict.get(p.id, "C"), float(p.quantidade or 0)))

    contexto["alertas_estoque_minimo"] = [
        {
            "nome": p.nome,
            "estoque_atual": float(p.quantidade or 0),
            "estoque_minimo": float(p.quantidade_minima or 0),
            "curva_abc": abc_dict.get(p.id, "C"),
        }
        for p in produtos_alerta[:15]
    ]

    # 3. Produtos Classe A sem estoque
    classe_a_ids = [pid for pid, classe in abc_dict.items() if classe == "A"]
    if classe_a_ids:
        q_classe_a_sem_estoque = db.session.query(Produto).filter(
            Produto.id.in_(classe_a_ids),
            Produto.ativo == True,
            Produto.quantidade <= 0,
        )
        contexto["produtos_classe_a_sem_estoque"] = [
            {"nome": p.nome, "estoque_atual": float(p.quantidade or 0)}
            for p in q_classe_a_sem_estoque.all()
        ]
    else:
        contexto["produtos_classe_a_sem_estoque"] = []

    # 4. Produtos Parados (Sem venda há 60 dias) com custo parado
    q_parados = db.session.query(Produto).filter(
        Produto.ativo == True,
        Produto.quantidade > 0,
        (Produto.ultima_venda < ha_60_dias) | (Produto.ultima_venda.is_(None)),
    )
    if estabelecimento_id != "all":
        q_parados = q_parados.filter(Produto.estabelecimento_id == estabelecimento_id)

    produtos_parados = q_parados.all()
    custo_parado_total = 0.0
    parados_detalhe = []

    for p in produtos_parados:
        custo = float(p.preco_custo or 0)
        qtd = float(p.quantidade or 0)
        valor = custo * qtd
        custo_parado_total += valor
        parados_detalhe.append({
            "nome": p.nome,
            "dias_parado": (hoje - to_local(p.ultima_venda).date()).days if p.ultima_venda else ">60",
            "valor_custo_parado": round(valor, 2),
        })

    parados_detalhe.sort(key=lambda x: x["valor_custo_parado"], reverse=True)

    contexto["produtos_parados_qtd"] = len(produtos_parados)
    contexto["custo_total_parado"] = round(custo_parado_total, 2) if is_manager else "Restrito"

    if is_manager:
        contexto["top_10_produtos_parados_custo"] = parados_detalhe[:10]
    else:
        contexto["top_10_produtos_parados_custo"] = [
            {"nome": p["nome"], "dias_parado": p["dias_parado"], "valor_custo_parado": "Restrito"}
            for p in parados_detalhe[:10]
        ]

    # 5. Produtos com margem de lucro baixa (< 30%)
    q_margem_baixa = db.session.query(Produto).filter(
        Produto.ativo == True,
        Produto.margem_lucro < 30.0,
    )
    if estabelecimento_id != "all":
        q_margem_baixa = q_margem_baixa.filter(Produto.estabelecimento_id == estabelecimento_id)

    produtos_margem = q_margem_baixa.all()
    contexto["produtos_margem_baixa_qtd"] = len(produtos_margem)

    if is_manager:
        contexto["detalhes_produtos_margem_baixa"] = [
            {
                "nome": p.nome,
                "margem_lucro_atual": float(p.margem_lucro or 0),
                "preco_custo": float(p.preco_custo or 0),
                "preco_venda": float(p.preco_venda or 0),
            }
            for p in produtos_margem[:50]
        ]
    else:
        contexto["detalhes_produtos_margem_baixa"] = (
            "Acesso Restrito: Apenas gerentes podem visualizar margens de lucro."
        )

    return contexto
