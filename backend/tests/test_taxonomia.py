"""Taxonomia oficial (Família → Categoria → Subcategoria): invariantes do Anexo A.

PLANO_CATEGORIAS_OFICIAIS.md §3.1: TAXONOMIA é a fonte; CATEGORIAS_OFICIAIS (lista plana que o
schema já expõe ao front) é GERADA dela e não pode perder subcategorias que existiam antes.

O snapshot da lista antiga está em tests/data/categorias_oficiais_antes_da_taxonomia.txt, CONGELADO:
provar continuidade lendo `git show HEAD:` daria falso verde no dia seguinte ao commit (o HEAD passa
a conter a versão nova) — o snapshot é a prova histórica.
"""
from pathlib import Path

from app.services.catalogo_familias import CATEGORIAS_OFICIAIS, TAXONOMIA

_SNAPSHOT = Path(__file__).resolve().parent / "data" / "categorias_oficiais_antes_da_taxonomia.txt"


def _categorias_oficiais_antes_da_mudanca() -> dict[str, list[str]]:
    """CATEGORIAS_OFICIAIS como estava antes da TAXONOMIA, lida do snapshot congelado."""
    antes: dict[str, list[str]] = {}
    for linha in _SNAPSHOT.read_text(encoding="utf-8").splitlines():
        if not linha.strip() or linha.lstrip().startswith("#"):
            continue
        familia, _, subcategorias = linha.partition(":")
        antes[familia.strip()] = [sub.strip() for sub in subcategorias.split("|") if sub.strip()]
    assert antes, f"snapshot vazio: {_SNAPSHOT}"
    return antes


def test_toda_familia_tem_categoria_outros():
    sem = [familia for familia, cats in TAXONOMIA.items() if "Outros" not in cats]
    assert sem == [], f"famílias sem categoria 'Outros': {sem}"
    # Como no Anexo A, "Outros" é a última categoria de cada família.
    fora_do_fim = [familia for familia, cats in TAXONOMIA.items() if list(cats)[-1] != "Outros"]
    assert fora_do_fim == [], f"'Outros' não é a última categoria em: {fora_do_fim}"


def test_nenhuma_subcategoria_repetida_dentro_da_familia():
    violacoes = {}
    for familia, categorias in TAXONOMIA.items():
        vistos = {}
        for categoria, subcategorias in categorias.items():
            for sub in subcategorias:
                vistos.setdefault(sub, []).append(categoria)
        dup = {sub: cats for sub, cats in vistos.items() if len(cats) > 1}
        if dup:
            violacoes[familia] = dup
    assert violacoes == {}, violacoes


def test_nenhuma_subcategoria_em_duas_familias():
    # Regra GS1 GPC (Anexo A): cada subcategoria pertence a UMA família.
    por_subcategoria = {}
    for familia, categorias in TAXONOMIA.items():
        for subcategorias in categorias.values():
            for sub in subcategorias:
                por_subcategoria.setdefault(sub, []).append(familia)
    duplicadas = {sub: familias for sub, familias in por_subcategoria.items() if len(familias) > 1}
    assert duplicadas == {}, duplicadas


def test_subcategorias_de_categorias_oficiais_antes_da_mudanca_continuam_em_taxonomia():
    antes = _categorias_oficiais_antes_da_mudanca()
    faltando = {}
    for familia, subcategorias_antes in antes.items():
        atuais = set(sub for subs in TAXONOMIA.get(familia, {}).values() for sub in subs)
        perdidas = [sub for sub in subcategorias_antes if sub not in atuais]
        if perdidas:
            faltando[familia] = perdidas
    assert faltando == {}, f"subcategorias da lista plana antiga ausentes em TAXONOMIA: {faltando}"
    # Família nova do Anexo A (não existia na lista plana antiga).
    assert "servico" in TAXONOMIA


def test_categorias_oficiais_e_a_lista_plana_de_taxonomia():
    """CATEGORIAS_OFICIAIS é GERADA de TAXONOMIA (§3.1): sem categoria vazia e ordem do Anexo A."""
    vazias = [familia for familia, subs in CATEGORIAS_OFICIAIS.items() if not subs]
    assert vazias == [], vazias
    for familia, categorias in TAXONOMIA.items():
        plana = [sub for subs in categorias.values() for sub in subs]
        assert CATEGORIAS_OFICIAIS[familia] == plana, familia