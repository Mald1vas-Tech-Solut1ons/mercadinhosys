"""Análise de vendas por categoria e subcategoria (BI do dashboard).

O sistema tem a taxonomia inteira no cadastro (família → categoria → subcategoria)
e o dashboard não respondia a pergunta óbvia do dono: **o que vende e o que dá
lucro, por seção da loja?**

Este módulo entrega o recorte pronto para a tela:

* receita, quantidade, custo e margem por categoria;
* participação percentual (curva ABC do faturamento);
* comparação com o período anterior de mesmo tamanho (Δ%);
* drill-down: mesma conta por subcategoria dentro de cada categoria.

Tudo em uma consulta agregada sobre `venda_itens` (o ledger), com filtro de venda
finalizada e escopo de tenant. Sem tabela nova, sem cache: o volume de um
mercadinho de bairro não justifica.
"""
from datetime import datetime, timedelta

from sqlalchemy import func

from app import db
from app.models import CategoriaProduto, Produto, Venda, VendaItem


def _janela(dias: int):
    """(inicio, fim, inicio_anterior, fim_anterior) — período atual e o espelho anterior."""
    fim = datetime.now()
    inicio = fim - timedelta(days=dias)
    return inicio, fim, inicio - timedelta(days=dias), inicio


def _rotulo_humano(chave: str) -> str:
    """Transforma slug de taxonomia em texto legível.

    A base grava `bazar.organizacao_armazenamento` e `bazar.mesa.copo`. O rótulo
    bonito ("Bazar e Utilidades Domésticas › Cozinha") vive em `categorias_produto`,
    mas nem sempre está preenchido — e ninguém quer ler slug no painel do dono.
    """
    if not chave:
        return "Sem categoria"
    palavras: list[str] = []
    for parte in str(chave).replace(".", " ").split():
        for pedaco in parte.split("_"):
            if pedaco:
                palavras.append(pedaco[:1].upper() + pedaco[1:])
    return " ".join(palavras) or "Sem categoria"


def _rotulo_subcategoria(chave: str) -> str:
    """A subcategoria é um caminho (bazar.mesa.copo); o que interessa é a folha."""
    if not chave:
        return "Sem subcategoria"
    folha = str(chave).split(".")[-1]
    return _rotulo_humano(folha)


def _agregar(estabelecimento_id: int, inicio: datetime, fim: datetime):
    """Uma linha por (família, categoria, subcategoria) no período."""
    chave_categoria = func.coalesce(
        func.nullif(Produto.categoria_oficial, ""),
        CategoriaProduto.nome,
        "sem_categoria",
    )
    chave_subcategoria = func.coalesce(
        func.nullif(Produto.subcategoria_oficial, ""),
        func.nullif(Produto.subcategoria, ""),
        "sem_subcategoria",
    )
    custo = func.coalesce(VendaItem.custo_unitario, 0) * VendaItem.quantidade

    consulta = (
        db.session.query(
            chave_categoria.label("categoria_key"),
            chave_subcategoria.label("subcategoria_key"),
            CategoriaProduto.nome.label("categoria_nome"),
            func.coalesce(Produto.familia_produto, "Sem família").label("familia"),
            func.coalesce(func.sum(VendaItem.total_item), 0).label("receita"),
            func.coalesce(func.sum(custo), 0).label("custo"),
            func.coalesce(func.sum(VendaItem.quantidade), 0).label("quantidade"),
            func.count(func.distinct(VendaItem.produto_id)).label("produtos"),
        )
        .join(Venda, Venda.id == VendaItem.venda_id)
        .join(Produto, Produto.id == VendaItem.produto_id)
        .outerjoin(CategoriaProduto, CategoriaProduto.id == Produto.categoria_id)
        .filter(
            VendaItem.estabelecimento_id == estabelecimento_id,
            Venda.status == "finalizada",
            Venda.data_venda >= inicio,
            Venda.data_venda <= fim,
        )
        .group_by(
            chave_categoria,
            chave_subcategoria,
            CategoriaProduto.nome,
            func.coalesce(Produto.familia_produto, "Sem família"),
        )
    )
    return consulta.all()


def estoque_por_categoria(estabelecimento_id: int) -> dict:
    """Retrato do estoque por categoria — o BI real de uma loja em implantação.

    Antes da primeira venda relevante, o que o dono tem para decidir é o que está
    na prateleira: quanto está parado, quanto vale a custo e a venda, e onde está
    concentrado o capital. Vem do cadastro (produtos), não do ledger.
    """
    chave_categoria = func.coalesce(
        func.nullif(Produto.categoria_oficial, ""),
        CategoriaProduto.nome,
        "sem_categoria",
    )
    linhas = (
        db.session.query(
            chave_categoria.label("categoria_key"),
            CategoriaProduto.nome.label("categoria_nome"),
            func.coalesce(Produto.familia_produto, "Sem família").label("familia"),
            func.count(Produto.id).label("itens"),
            func.coalesce(func.sum(Produto.quantidade), 0).label("unidades"),
            func.coalesce(func.sum(Produto.quantidade * func.coalesce(Produto.preco_custo, 0)), 0).label("valor_custo"),
            func.coalesce(func.sum(Produto.quantidade * func.coalesce(Produto.preco_venda, 0)), 0).label("valor_venda"),
        )
        .outerjoin(CategoriaProduto, CategoriaProduto.id == Produto.categoria_id)
        .filter(Produto.estabelecimento_id == estabelecimento_id)
        .group_by(
            chave_categoria,
            CategoriaProduto.nome,
            func.coalesce(Produto.familia_produto, "Sem família"),
        )
        .all()
    )

    categorias: dict[str, dict] = {}
    for linha in linhas:
        chave = linha.categoria_key
        rotulo = (linha.categoria_nome or "").strip() or _rotulo_humano(chave)
        bloco = categorias.setdefault(chave, {
            "categoria": rotulo,
            "familia": linha.familia,
            "itens": 0,
            "unidades": 0.0,
            "valor_custo": 0.0,
            "valor_venda": 0.0,
        })
        bloco["itens"] += int(linha.itens or 0)
        bloco["unidades"] += float(linha.unidades or 0)
        bloco["valor_custo"] += float(linha.valor_custo or 0)
        bloco["valor_venda"] += float(linha.valor_venda or 0)

    total_custo = sum(b["valor_custo"] for b in categorias.values())
    ranking = []
    for bloco in categorias.values():
        bloco["unidades"] = round(bloco["unidades"], 3)
        bloco["valor_custo"] = round(bloco["valor_custo"], 2)
        bloco["valor_venda"] = round(bloco["valor_venda"], 2)
        bloco["margem_potencial_pct"] = round(
            ((bloco["valor_venda"] - bloco["valor_custo"]) / bloco["valor_venda"] * 100)
            if bloco["valor_venda"] else 0.0, 1)
        bloco["participacao_custo"] = round(
            (bloco["valor_custo"] / total_custo * 100) if total_custo else 0.0, 1)
        ranking.append(bloco)

    ranking.sort(key=lambda c: c["valor_custo"], reverse=True)

    return {
        "resumo": {
            "categorias": len(ranking),
            "itens": sum(b["itens"] for b in ranking),
            "valor_custo": round(total_custo, 2),
            "valor_venda": round(sum(b["valor_venda"] for b in ranking), 2),
        },
        "categorias": ranking,
    }


def analise_por_categoria(estabelecimento_id: int, dias: int = 30) -> dict:
    """Payload do painel de categorias: totais, ranking, curva ABC e drill-down."""
    inicio, fim, inicio_ant, fim_ant = _janela(dias)

    atual = _agregar(estabelecimento_id, inicio, fim)
    anterior = _agregar(estabelecimento_id, inicio_ant, fim_ant)

    # Receita do período anterior por categoria, para o Δ%.
    receita_antes: dict[str, float] = {}
    for linha in anterior:
        receita_antes[linha.categoria_key] = receita_antes.get(linha.categoria_key, 0.0) + float(linha.receita or 0)

    receita_total = sum(float(l.receita or 0) for l in atual)
    categorias: dict[str, dict] = {}

    for linha in atual:
        receita = float(linha.receita or 0)
        custo = float(linha.custo or 0)
        # Agrupa pela chave estável (slug), mas mostra o rótulo do cadastro quando existe.
        chave = linha.categoria_key
        rotulo = (linha.categoria_nome or "").strip() or _rotulo_humano(chave)
        bloco = categorias.setdefault(chave, {
            "categoria": rotulo,
            "familia": linha.familia,
            "receita": 0.0,
            "custo": 0.0,
            "margem": 0.0,
            "margem_pct": 0.0,
            "quantidade": 0.0,
            "produtos": 0,
            "participacao": 0.0,
            "variacao_pct": None,
            "subcategorias": [],
        })
        bloco["receita"] += receita
        bloco["custo"] += custo
        bloco["quantidade"] += float(linha.quantidade or 0)
        bloco["produtos"] = max(bloco["produtos"], int(linha.produtos or 0))
        bloco["subcategorias"].append({
            "subcategoria": _rotulo_subcategoria(linha.subcategoria_key),
            "receita": round(receita, 2),
            "quantidade": round(float(linha.quantidade or 0), 3),
            "margem": round(receita - custo, 2),
            "margem_pct": round(((receita - custo) / receita * 100) if receita else 0.0, 1),
        })

    for bloco in categorias.values():
        antes = receita_antes.get(bloco["categoria"])
        bloco["margem"] = round(bloco["receita"] - bloco["custo"], 2)
        bloco["margem_pct"] = round((bloco["margem"] / bloco["receita"] * 100) if bloco["receita"] else 0.0, 1)
        bloco["participacao"] = round((bloco["receita"] / receita_total * 100) if receita_total else 0.0, 1)
        bloco["receita"] = round(bloco["receita"], 2)
        bloco["custo"] = round(bloco["custo"], 2)
        bloco["quantidade"] = round(bloco["quantidade"], 3)
        bloco["variacao_pct"] = (
            round((bloco["receita"] - antes) / antes * 100, 1) if antes else None
        )
        bloco["subcategorias"].sort(key=lambda s: s["receita"], reverse=True)

    ranking = sorted(categorias.values(), key=lambda c: c["receita"], reverse=True)

    # Curva ABC: A = o que acumula até 80% do faturamento, B até 95%, C o resto.
    # A classe é decidida pelo acumulado ANTES do item: quem cruza a linha dos 80% ainda é A.
    acumulado = 0.0
    for bloco in ranking:
        bloco["classe_abc"] = "A" if acumulado < 80 else ("B" if acumulado < 95 else "C")
        acumulado += bloco["participacao"]

    margem_total = sum(b["margem"] for b in ranking)
    receita_anterior = sum(receita_antes.values())

    return {
        "periodo": {"dias": dias, "inicio": inicio.isoformat(), "fim": fim.isoformat()},
        "resumo": {
            "receita": round(receita_total, 2),
            "margem": round(margem_total, 2),
            "margem_pct": round((margem_total / receita_total * 100) if receita_total else 0.0, 1),
            "categorias": len(ranking),
            "receita_periodo_anterior": round(receita_anterior, 2),
            "variacao_pct": (
                round((receita_total - receita_anterior) / receita_anterior * 100, 1)
                if receita_anterior else None
            ),
        },
        "categorias": ranking,
        "estoque": estoque_por_categoria(estabelecimento_id),
    }
