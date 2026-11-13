"""Guarda de regressão da venda por dose: quantidade vendida por produto só se soma em `quantidade_base`.

`VendaItem.quantidade` de um item de dose é número de DOSES; giro, cobertura, ABC, ranking e a verificação de
dados precisam de garrafas equivalentes (`quantidade_base`). Uma soma nova de `VendaItem.quantidade` por
produto erraria por um fator de ~20 sem nenhum erro visível. Este teste falha quando uma aparece.

Somas que CONTAM ITENS PASSADOS (dose = item) ficam na lista abaixo, com o motivo. Para somar de um jeito novo,
use `VendaItem.quantidade_base`; só acrescente aqui se a conta realmente for "itens passados".
"""
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
BRUTA = re.compile(r"(?:func|sqlfunc|db\.func)\.sum\(\s*VendaItem\.quantidade\s*\)")
SQL_CRU = re.compile(r"SUM\(\s*vi\.quantidade\s*\)", re.IGNORECASE)

# arquivo (relativo a app/) -> quantas somas brutas são permitidas e por quê
PERMITIDAS = {
    "routes/vendas.py": (2, "total_itens / itens por venda nas estatísticas de vendas: itens passados no caixa"),
    "services/dose_metricas.py": (2, "doses vendidas (quantidade de item de dose = nº de doses), por produto e por hora"),
    "services/comparativo_service.py": (1, "'itens' do resumo do período: itens passados no caixa"),
    "services/rh_calculator_service.py": (1, "'produtos passados' do funcionário: trabalho no caixa, dose é item"),
}


def _ocorrencias():
    achados = {}
    for caminho in sorted(APP.rglob("*.py")):
        texto = caminho.read_text(encoding="utf-8", errors="replace")
        n = len(BRUTA.findall(texto)) + len(SQL_CRU.findall(texto))
        if n:
            achados[caminho.relative_to(APP).as_posix()] = n
    return achados


def test_somas_de_quantidade_vendida_usam_quantidade_base():
    achados = _ocorrencias()
    permitido = {arquivo: n for arquivo, (n, _) in PERMITIDAS.items()}
    inesperados = {a: n for a, n in achados.items() if n != permitido.get(a, 0)}
    faltando = {a: n for a, n in permitido.items() if achados.get(a, 0) != n}
    assert not inesperados and not faltando, (
        "Soma de VendaItem.quantidade fora da lista aprovada. Para unidades de estoque (giro, cobertura, ABC, "
        f"ranking) use VendaItem.quantidade_base. Achados: {inesperados}; esperados e ausentes: {faltando}")


def test_item_de_dose_tem_quantidade_base_no_modelo():
    from app.models import VendaItem
    assert hasattr(VendaItem, "quantidade_base") and hasattr(VendaItem, "qtd_base")
