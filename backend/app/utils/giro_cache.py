"""Cache in-process das vendas agregadas por produto (base do giro/VMD/cobertura).

O giro depende de agregar `venda_itens` do período — caro demais para rodar por
produto a cada request de listagem/cards. Aqui o agregado do tenant inteiro roda
no máximo uma vez a cada TTL, e TODOS os consumidores (classificar_giro_produto,
o loop dos cards e o Hub) leem o MESMO resultado — garantindo que card, lista,
modal e Hub nunca divirjam.

Regra de negócio: janela móvel de 90 dias (mesmo padrão da classificação ABC —
`abc_cache.py`), coerente com o varejo alimentar.

Espelha a estrutura de `abc_cache.py`: cache por processo, TTL curto, lock.
"""

import time
import threading
from datetime import datetime, timedelta

from app.utils.timezone import data_local

GIRO_PERIODO_DIAS = 90
_TTL_SEGUNDOS = 600  # 10 min

_lock = threading.Lock()
# {est_id: (monotonic_ts, {produto_id: {qtd, faturamento, primeira_venda, ultima_venda}})}
_cache: dict[int, tuple[float, dict]] = {}


def get_vendas_agregadas(estabelecimento_id) -> dict:
    """Retorna {produto_id: {qtd, faturamento, primeira_venda, ultima_venda}} do
    tenant na janela de 90 dias, cacheado por TTL.

    Produtos sem venda na janela não aparecem no dict — o chamador trata como
    'lento'/'sem giro'.
    """
    try:
        key = int(estabelecimento_id)
    except (TypeError, ValueError):
        # 'all' (super admin) não tem agregado dinâmico por tenant.
        return {}

    now = time.monotonic()
    hit = _cache.get(key)
    if hit and (now - hit[0]) < _TTL_SEGUNDOS:
        return hit[1]

    from app.models import db, Venda, VendaItem, utcnow
    from sqlalchemy import func

    data_inicio = utcnow() - timedelta(days=GIRO_PERIODO_DIAS)
    rows = (
        db.session.query(
            VendaItem.produto_id,
            func.sum(VendaItem.quantidade_base),
            func.sum(VendaItem.total_item),
            func.min(Venda.data_venda),
            func.max(Venda.data_venda),
        )
        .join(Venda, Venda.id == VendaItem.venda_id)
        .filter(
            Venda.estabelecimento_id == key,
            func.lower(func.coalesce(Venda.status, "")) != "cancelada",
            Venda.data_venda >= data_inicio,
        )
        .group_by(VendaItem.produto_id)
        .all()
    )

    agregado = {
        pid: {
            "qtd": float(qtd or 0),
            "faturamento": float(fat or 0),
            "primeira_venda": primeira,
            "ultima_venda": ultima,
        }
        for pid, qtd, fat, primeira, ultima in rows
    }

    with _lock:
        _cache[key] = (now, agregado)
    return agregado


def dias_efetivos(primeira_venda, hoje_date, janela_dias: int = GIRO_PERIODO_DIAS) -> int:
    """Dias em que o produto esteve vendendo dentro da janela (piso 1, teto janela).

    `primeira_venda` é o datetime da 1ª venda na janela; `hoje_date` é um date.
    """
    if not primeira_venda:
        return janela_dias
    # O datetime vem do banco em UTC: o dia que conta é o da loja (mesma base de `hoje_date`).
    ref = data_local(primeira_venda) if isinstance(primeira_venda, datetime) else primeira_venda
    dias = (hoje_date - ref).days
    return max(1, min(int(janela_dias), dias))


def metrica_produto(produto, hoje_date, agregado=None) -> dict:
    """Conveniência: {vmd, cobertura_dias, classe} de um produto, via a fonte única.

    Aceita um `agregado` já carregado (get_vendas_agregadas) para evitar recarga.
    Funciona tanto com o objeto Produto quanto com tuplas leves que exponham
    `id` e `quantidade` (ex.: query.with_entities).
    """
    from app.models import Produto

    if agregado is None:
        agregado = get_vendas_agregadas(getattr(produto, "estabelecimento_id", None))
    dados = agregado.get(getattr(produto, "id", None))
    if not dados:
        return {"vmd": 0.0, "cobertura_dias": None, "classe": "lento"}
    dias = dias_efetivos(dados.get("primeira_venda"), hoje_date)
    return Produto.calcular_giro_metrica(
        getattr(produto, "quantidade", 0), dados.get("qtd", 0), dias
    )


def invalidar(estabelecimento_id=None):
    """Invalida o cache (de um tenant ou todos) — usar após recálculo/seed."""
    with _lock:
        if estabelecimento_id is None:
            _cache.clear()
        else:
            try:
                _cache.pop(int(estabelecimento_id), None)
            except (TypeError, ValueError):
                pass
