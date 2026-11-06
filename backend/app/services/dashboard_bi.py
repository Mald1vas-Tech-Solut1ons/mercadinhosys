"""BI do Painel do Negócio — uma linha por produto, pronta para cruzar.

O painel configurável (filtros, faixas, matriz giro × margem, árvore Família ›
Categoria › Subcategoria › Produto) precisa do mesmo fato em todas as visões, senão
cada gráfico conta uma história diferente. Este módulo devolve esse fato único:

* uma linha por produto ativo da loja, com cadastro (taxonomia, fornecedor, marca),
  estoque e capital, vendas do período e do período anterior de mesmo tamanho,
  regularidade da venda (XYZ), curva ABC, cobertura, dias sem venda e validade;
* receita por categoria × hora e categoria × dia da semana (hora local da loja);
* pares de produtos que saem na mesma venda (cesta), com suporte e lift.

O volume de uma loja de bairro (centenas a poucos milhares de SKUs) cabe numa
resposta só, e o navegador recorta sem novas idas ao servidor. Todas as consultas
filtram `estabelecimento_id` explicitamente (além do TenantQuery).
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from itertools import combinations

from sqlalchemy import func

from app import db
from app.models import CategoriaProduto, Fornecedor, Produto, Venda, VendaItem
from app.services.dashboard_categorias import _rotulo_humano, _rotulo_subcategoria
from app.utils.query_helpers import get_dow_extract, get_hour_extract, get_local_date
from app.utils.timezone import hoje_local, local_date_to_utc_naive

# Teto de vendas lidas para a cesta: 365 dias de uma loja grande cabem com folga.
LIMITE_VENDAS_CESTA = 20000
# Par só entra na cesta se saiu junto pelo menos este número de vezes.
MIN_OCORRENCIAS_PAR = 2


def _num(valor) -> float:
    try:
        return float(valor or 0)
    except (TypeError, ValueError):
        return 0.0


def resolver_periodo(dias: int | None, de: str | None, ate: str | None) -> tuple[date, date]:
    """Período em DIAS DA LOJA (fuso local). `de`/`ate` = 'AAAA-MM-DD' têm prioridade."""
    if de and ate:
        inicio = date.fromisoformat(de[:10])
        fim = date.fromisoformat(ate[:10])
        if fim < inicio:
            inicio, fim = fim, inicio
        if (fim - inicio).days > 365:
            inicio = fim - timedelta(days=365)
        return inicio, fim
    dias = max(1, min(int(dias or 30), 365))
    fim = hoje_local()
    return fim - timedelta(days=dias - 1), fim


def _limites_utc(inicio: date, fim: date) -> tuple[datetime, datetime]:
    return local_date_to_utc_naive(inicio), local_date_to_utc_naive(fim, fim_do_dia=True)


def _rotulos_taxonomia(familia: str | None, cat_key: str | None, sub_key: str | None,
                       cat_nome_loja: str | None) -> tuple[str, str, str]:
    """(família, categoria, subcategoria) em texto de gente, nunca slug."""
    from app.services.taxonomia_service import _nome_familia, descrever

    try:
        desc = descrever(familia, cat_key, sub_key)
    except Exception:
        desc = {}
    familia_rot = "Sem família"
    if familia:
        try:
            familia_rot = _nome_familia(familia)
        except Exception:
            familia_rot = _rotulo_humano(familia)

    categoria = desc.get("categoria_oficial_nome")
    if not categoria:
        nome_loja = (cat_nome_loja or "").strip()
        # "Bazar › Cozinha" gravado na loja: a família já aparece no nível de cima.
        categoria = nome_loja.split("›")[-1].strip() if nome_loja else _rotulo_humano(cat_key or "")
    subcategoria = desc.get("subcategoria_oficial_nome") or _rotulo_subcategoria(sub_key or "")
    return familia_rot, categoria or "Sem categoria", subcategoria


def _classe_xyz(cv: float | None) -> str | None:
    if cv is None:
        return None
    return "X" if cv < 0.5 else ("Y" if cv < 1.0 else "Z")


def analise_bi(estabelecimento_id: int, dias: int | None = 30,
               de: str | None = None, ate: str | None = None) -> dict:
    inicio, fim = resolver_periodo(dias, de, ate)
    n_dias = (fim - inicio).days + 1
    ant_fim = inicio - timedelta(days=1)
    ant_inicio = ant_fim - timedelta(days=n_dias - 1)
    ini_utc, fim_utc = _limites_utc(inicio, fim)
    ant_ini_utc, ant_fim_utc = _limites_utc(ant_inicio, ant_fim)
    hoje = hoje_local()

    # ------------------------------------------------------------------ cadastro
    cadastro = (
        db.session.query(
            Produto.id, Produto.nome, Produto.codigo_barras, Produto.marca,
            Produto.familia_produto, Produto.categoria_oficial, Produto.subcategoria_oficial,
            Produto.subcategoria, Produto.tipo_item, Produto.controlar_estoque,
            Produto.quantidade, Produto.quantidade_minima, Produto.preco_custo, Produto.preco_venda,
            Produto.origem_custo, Produto.data_validade, Produto.ultima_venda, Produto.created_at,
            CategoriaProduto.nome.label("categoria_nome"),
            Fornecedor.nome_fantasia.label("fornecedor_fantasia"),
            Fornecedor.razao_social.label("fornecedor_razao"),
        )
        .outerjoin(CategoriaProduto, CategoriaProduto.id == Produto.categoria_id)
        .outerjoin(Fornecedor, Fornecedor.id == Produto.fornecedor_id)
        .filter(
            Produto.estabelecimento_id == estabelecimento_id,
            Produto.deleted_at.is_(None),
            Produto.ativo.isnot(False),
            Produto.eh_grade_modelo.isnot(True),
        )
        .all()
    )

    # ------------------------------------------------------------------ vendas
    def _vendas(ini, fim_):
        return {
            linha.produto_id: linha
            for linha in (
                db.session.query(
                    VendaItem.produto_id,
                    func.coalesce(func.sum(VendaItem.total_item), 0).label("receita"),
                    func.coalesce(func.sum(func.coalesce(VendaItem.custo_unitario, 0) * VendaItem.quantidade), 0).label("custo"),
                    func.coalesce(func.sum(VendaItem.quantidade), 0).label("qtd"),
                    func.count(func.distinct(VendaItem.venda_id)).label("vendas"),
                )
                .join(Venda, Venda.id == VendaItem.venda_id)
                .filter(
                    VendaItem.estabelecimento_id == estabelecimento_id,
                    Venda.estabelecimento_id == estabelecimento_id,
                    Venda.status == "finalizada",
                    Venda.data_venda >= ini, Venda.data_venda <= fim_,
                )
                .group_by(VendaItem.produto_id)
                .all()
            )
        }

    atual = _vendas(ini_utc, fim_utc)
    anterior = _vendas(ant_ini_utc, ant_fim_utc)

    # Última venda pelo ledger (o campo denormalizado do produto pode estar defasado).
    ultima_ledger = dict(
        db.session.query(VendaItem.produto_id, func.max(Venda.data_venda))
        .join(Venda, Venda.id == VendaItem.venda_id)
        .filter(VendaItem.estabelecimento_id == estabelecimento_id,
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.status == "finalizada")
        .group_by(VendaItem.produto_id)
        .all()
    )

    # Venda diária por produto → coeficiente de variação (XYZ).
    dia_local = get_local_date(Venda.data_venda)
    diario: dict[int, list[float]] = defaultdict(list)
    for produto_id, _dia, qtd in (
        db.session.query(VendaItem.produto_id, dia_local, func.sum(VendaItem.quantidade))
        .join(Venda, Venda.id == VendaItem.venda_id)
        .filter(VendaItem.estabelecimento_id == estabelecimento_id,
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.status == "finalizada",
                Venda.data_venda >= ini_utc, Venda.data_venda <= fim_utc)
        .group_by(VendaItem.produto_id, dia_local)
        .all()
    ):
        diario[produto_id].append(_num(qtd))

    # ------------------------------------------------------------------ linhas
    produtos: list[dict] = []
    for p in cadastro:
        familia_rot, categoria_rot, sub_rot = _rotulos_taxonomia(
            p.familia_produto, p.categoria_oficial, p.subcategoria_oficial or p.subcategoria, p.categoria_nome)
        cat_key = p.categoria_oficial or (p.categoria_nome or "sem_categoria")
        sub_key = p.subcategoria_oficial or p.subcategoria or "sem_subcategoria"
        servico = (p.tipo_item or "produto") == "servico" or p.controlar_estoque is False

        v = atual.get(p.id)
        va = anterior.get(p.id)
        receita = _num(v.receita) if v else 0.0
        custo = _num(v.custo) if v else 0.0
        qtd = _num(v.qtd) if v else 0.0
        receita_ant = _num(va.receita) if va else 0.0

        estoque = 0.0 if servico else _num(p.quantidade)
        preco_custo = _num(p.preco_custo)
        preco_venda = _num(p.preco_venda)
        capital_custo = max(estoque, 0.0) * preco_custo
        capital_venda = max(estoque, 0.0) * preco_venda

        vmd = qtd / n_dias
        cobertura = (estoque / vmd) if vmd > 0 and not servico else None

        serie = diario.get(p.id, [])
        cv = None
        if qtd > 0:
            valores = serie + [0.0] * max(0, n_dias - len(serie))
            media = sum(valores) / n_dias
            if media > 0:
                var = sum((x - media) ** 2 for x in valores) / n_dias
                cv = math.sqrt(var) / media

        ultima = ultima_ledger.get(p.id) or p.ultima_venda
        dias_sem_venda = None
        if ultima:
            dias_sem_venda = max(0, (datetime.now(timezone.utc).replace(tzinfo=None) - ultima).days)
        validade_dias = (p.data_validade - hoje).days if p.data_validade else None

        produtos.append({
            "id": p.id,
            "nome": p.nome,
            "ean": p.codigo_barras,
            "marca": (p.marca or "").strip() or None,
            "fornecedor": (p.fornecedor_fantasia or p.fornecedor_razao or "").strip() or None,
            "familia_key": p.familia_produto or "sem_familia",
            "familia": familia_rot,
            "categoria_key": cat_key,
            "categoria": categoria_rot,
            "subcategoria_key": sub_key,
            "subcategoria": sub_rot,
            "servico": servico,
            "custo_estimado": (p.origem_custo or "informado") != "informado",
            "estoque": round(estoque, 3),
            "estoque_minimo": round(_num(p.quantidade_minima), 3),
            "preco_custo": round(preco_custo, 4),
            "preco_venda": round(preco_venda, 4),
            "receita": round(receita, 2),
            "custo": round(custo, 2),
            "margem": round(receita - custo, 2),
            "margem_pct": round((receita - custo) / receita * 100, 1) if receita else None,
            "qtd": round(qtd, 3),
            "vendas": int(v.vendas) if v else 0,
            "dias_com_venda": len(serie),
            "receita_anterior": round(receita_ant, 2),
            "variacao_pct": round((receita - receita_ant) / receita_ant * 100, 1) if receita_ant else None,
            "vmd": round(vmd, 4),
            "cobertura_dias": round(cobertura, 1) if cobertura is not None else None,
            "capital_custo": round(capital_custo, 2),
            "capital_venda": round(capital_venda, 2),
            "margem_potencial_pct": round((preco_venda - preco_custo) / preco_venda * 100, 1) if preco_venda else None,
            # GMROI do período: margem gerada ÷ capital a custo hoje na prateleira.
            "gmroi": round((receita - custo) / capital_custo, 2) if capital_custo > 0 else None,
            "dias_sem_venda": dias_sem_venda,
            "nunca_vendeu": ultima is None,
            "validade_dias": validade_dias,
            "cv": round(cv, 2) if cv is not None else None,
            "xyz": _classe_xyz(cv),
            "abc": None,
            "ruptura": (not servico) and estoque <= 0,
            "abaixo_minimo": (not servico) and 0 < estoque <= _num(p.quantidade_minima),
        })

    # Curva ABC por produto: A até 80% do faturamento acumulado, B até 95%, C o resto.
    receita_total = sum(item["receita"] for item in produtos)
    acumulado = 0.0
    for item in sorted((i for i in produtos if i["receita"] > 0), key=lambda i: i["receita"], reverse=True):
        item["abc"] = "A" if acumulado < 80 else ("B" if acumulado < 95 else "C")
        acumulado += item["receita"] / receita_total * 100 if receita_total else 0

    return {
        "periodo": {
            "inicio": inicio.isoformat(), "fim": fim.isoformat(), "dias": n_dias,
            "anterior_inicio": ant_inicio.isoformat(), "anterior_fim": ant_fim.isoformat(),
        },
        "produtos": produtos,
        "temporal": _temporal(estabelecimento_id, ini_utc, fim_utc),
        "cesta": _cesta(estabelecimento_id, ini_utc, fim_utc),
    }


def _temporal(estabelecimento_id: int, ini_utc: datetime, fim_utc: datetime) -> dict:
    """Receita por categoria × hora e × dia da semana (0 = domingo), na hora da loja."""
    chave_cat = func.coalesce(func.nullif(Produto.categoria_oficial, ""), CategoriaProduto.nome, "sem_categoria")
    base = (
        db.session.query()
        .select_from(VendaItem)
        .join(Venda, Venda.id == VendaItem.venda_id)
        .join(Produto, Produto.id == VendaItem.produto_id)
        .outerjoin(CategoriaProduto, CategoriaProduto.id == Produto.categoria_id)
        .filter(VendaItem.estabelecimento_id == estabelecimento_id,
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.status == "finalizada",
                Venda.data_venda >= ini_utc, Venda.data_venda <= fim_utc)
    )
    hora = get_hour_extract(Venda.data_venda)
    dow = get_dow_extract(Venda.data_venda)
    receita = func.coalesce(func.sum(VendaItem.total_item), 0)
    por_hora = base.with_entities(chave_cat, hora, receita).group_by(chave_cat, hora).all()
    por_dia = base.with_entities(chave_cat, dow, receita).group_by(chave_cat, dow).all()
    return {
        "hora": [{"categoria_key": c, "hora": int(h), "receita": round(_num(r), 2)}
                 for c, h, r in por_hora if h is not None],
        "dia_semana": [{"categoria_key": c, "dia": int(d), "receita": round(_num(r), 2)}
                       for c, d, r in por_dia if d is not None],
    }


def _cesta(estabelecimento_id: int, ini_utc: datetime, fim_utc: datetime) -> dict:
    """Pares de produtos que saem na mesma venda: ocorrências, suporte e lift."""
    linhas = (
        db.session.query(VendaItem.venda_id, VendaItem.produto_id)
        .join(Venda, Venda.id == VendaItem.venda_id)
        .filter(VendaItem.estabelecimento_id == estabelecimento_id,
                Venda.estabelecimento_id == estabelecimento_id,
                Venda.status == "finalizada",
                Venda.data_venda >= ini_utc, Venda.data_venda <= fim_utc)
        .order_by(Venda.data_venda.desc())
        .limit(LIMITE_VENDAS_CESTA * 6)
        .all()
    )
    por_venda: dict[int, set[int]] = defaultdict(set)
    for venda_id, produto_id in linhas:
        if produto_id is not None:
            por_venda[venda_id].add(produto_id)
    total = len(por_venda)
    if total == 0:
        return {"vendas": 0, "pares": []}

    freq: Counter = Counter()
    pares: Counter = Counter()
    for itens in por_venda.values():
        freq.update(itens)
        if 1 < len(itens) <= 40:
            pares.update(combinations(sorted(itens), 2))

    resultado = []
    for (a, b), n in pares.most_common(200):
        if n < MIN_OCORRENCIAS_PAR:
            break
        suporte = n / total
        lift = suporte / ((freq[a] / total) * (freq[b] / total))
        resultado.append({
            "a": a, "b": b, "vezes": n,
            "suporte_pct": round(suporte * 100, 2),
            "confianca_pct": round(n / freq[a] * 100, 1),
            "lift": round(lift, 2),
        })
    resultado.sort(key=lambda r: (r["lift"], r["vezes"]), reverse=True)
    return {"vendas": total, "pares": resultado[:60]}
