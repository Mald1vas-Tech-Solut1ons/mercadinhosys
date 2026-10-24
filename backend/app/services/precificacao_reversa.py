"""Precificação reversa: venda vem do mercado, custo é estimado a partir da venda.

Serviço puro (sem acesso a banco, 100% Decimal). Regra de ouro: o custo estimado
nunca se passa por custo real — todo número que dependa dele é marcado como
estimado no produto, na venda e no DRE.

Arredondamento: o preço de venda é quantizado antes do custo; o custo é
calculado SOBRE a venda já arredondada (o custo usa 4 casas, escala da coluna).
"""
from decimal import Decimal, ROUND_HALF_UP

CENTAVO = Decimal("0.01")
_CENTAVO_PCT = Decimal("0.01")  # escala de 2 casas para percentuais (pct)


def _quantizar_valor(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def _quantizar_pct(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def _as_decimal(valor, nome_campo: str) -> Decimal:
    if isinstance(valor, Decimal):
        return valor
    try:
        return Decimal(str(valor))
    except Exception:
        raise ValueError(f"{nome_campo} inválido: {valor!r}")


def venda_pelo_mercado(preco_referencia: Decimal, desconto_pct: Decimal) -> Decimal:
    """venda = referência × (1 − desconto/100), quantizada em centavos."""
    preco_referencia = _as_decimal(preco_referencia, "Preço de referência")
    desconto_pct = _as_decimal(desconto_pct, "Desconto")
    if not preco_referencia.is_finite() or preco_referencia <= 0:
        raise ValueError("Preço de referência deve ser maior que zero")
    if not desconto_pct.is_finite() or not (Decimal("0") <= desconto_pct < 100):
        raise ValueError("Desconto deve estar entre 0% e menos de 100%")
    return _quantizar_valor(preco_referencia * (Decimal("1") - desconto_pct / Decimal("100")))


def custo_pela_venda(preco_venda: Decimal, margem_alvo_venda_pct: Decimal) -> Decimal:
    """custo = venda × (1 − margem_sobre_venda/100), arredondado em centavos.

    O custo é calculado sobre a venda JÁ arredondada e sai com 2 casas
    (centavos) — escala que a coluna de 4 casas armazena sem perder nada.
    """
    preco_venda = _as_decimal(preco_venda, "Preço de venda")
    margem_alvo_venda_pct = _as_decimal(margem_alvo_venda_pct, "Margem sobre a venda")
    if not preco_venda.is_finite() or preco_venda <= 0:
        raise ValueError("Preço de venda deve ser maior que zero")
    if not margem_alvo_venda_pct.is_finite() or not (Decimal("0") < margem_alvo_venda_pct < 100):
        raise ValueError(
            "Margem sobre a venda deve estar entre 0% e 100% (exclusive). "
            "Margem de 100% sobre a venda é impossível: não sobraria custo."
        )
    return _quantizar_valor(preco_venda * (Decimal("1") - margem_alvo_venda_pct / Decimal("100")))


def markup_de(preco_custo: Decimal, preco_venda: Decimal) -> Decimal:
    """(venda − custo) / custo × 100 — preenche Produto.margem_lucro (markup)."""
    preco_custo = _as_decimal(preco_custo, "Preço de custo")
    preco_venda = _as_decimal(preco_venda, "Preço de venda")
    if not preco_custo.is_finite() or preco_custo <= 0:
        raise ValueError("Preço de custo deve ser maior que zero para calcular o markup")
    if not preco_venda.is_finite() or preco_venda <= 0:
        raise ValueError("Preço de venda deve ser maior que zero")
    return ((preco_venda - preco_custo) / preco_custo * Decimal("100")).quantize(
        _CENTAVO_PCT, rounding=ROUND_HALF_UP
    )