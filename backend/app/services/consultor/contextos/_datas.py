"""Janelas de data do Consultor no fuso da loja.

O banco grava Venda.data_venda e PedidoCompra.data_pedido em UTC naive (DateTime). Comparar essas
colunas com uma `date` (`<= hoje`) cortava o dia à meia-noite: o faturamento de hoje e de ontem
chegava zerado à IA e o mês excluía o dia corrente. Aqui o dia local vira o intervalo UTC certo.
"""
from app.utils.timezone import hoje_local, local_date_to_utc_naive


def ini(dia):
    """Primeiro instante (UTC naive) do dia local."""
    return local_date_to_utc_naive(dia)


def fim(dia):
    """Último instante (UTC naive) do dia local."""
    return local_date_to_utc_naive(dia, fim_do_dia=True)


__all__ = ["hoje_local", "ini", "fim"]
