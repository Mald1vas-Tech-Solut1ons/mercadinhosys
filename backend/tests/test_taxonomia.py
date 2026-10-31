"""Taxonomia oficial (Família → Categoria → Subcategoria): invariantes do Anexo A.

PLANO_CATEGORIAS_OFICIAIS.md §3.1: TAXONOMIA é a fonte; CATEGORIAS_OFICIAIS (lista plana que o
schema já expõe ao front) é GERADA dela e não pode perder subcategorias que existiam antes.

O snapshot da lista antiga está em tests/data/categorias_oficiais_antes_da_taxonomia.txt, CONGELADO:
provar continuidade lendo `git show HEAD:` daria falso verde no dia seguinte ao commit (o HEAD passa
a conter a versão nova) — o snapshot é a prova histórica.
"""
from pathlib import Path
import re

import pytest

from app.models import Estabelecimento
from app.services.catalogo_familias import (
    CATEGORIAS_OFICIAIS,
    TAXONOMIA,
    chave_categoria,
    chave_subcategoria,
    slug,
)
from app.services.view_schema_service import invalidar_cache_view_schema, resolver_view_schema
from app.services.taxonomia_service import arvore, chave_canonica, outros, resolver

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


@pytest.mark.parametrize("escrita, esperado", [
    ("Cama, Mesa e Banho", "cama_mesa_banho"),
    ("CAMA MESA BANHO", "cama_mesa_banho"),
    ("Cama ,Mesa", "cama_mesa"),
    ("Brinquedos", "brinquedo"),
    ("Brinquedo", "brinquedo"),
    ("Pães e Bolos Industrializados", "pae_bolo_industrializado"),
    ("Caixas d'Água", "caixa_dagua"),
    ("Lava-roupas em Pó", "lava_roupa_em_po"),
])
def test_slug_e_a_chave_canonica_da_regra_4(escrita, esperado):
    assert slug(escrita) == esperado


def test_chaves_da_taxonomia_sao_unicas_e_com_formato_estavel():
    categorias, subcategorias = set(), set()
    for familia, cats in TAXONOMIA.items():
        for categoria, subs in cats.items():
            chave_cat = chave_categoria(familia, categoria)
            assert chave_cat.startswith(f"{familia}.") and len(chave_cat) > len(familia) + 1, chave_cat
            categorias.add(chave_cat)
            for sub in subs:
                chave_sub = chave_subcategoria(familia, categoria, sub)
                assert chave_sub.startswith(chave_cat + "."), chave_sub
                assert re.fullmatch(r"[a-z0-9_.]+", chave_sub), chave_sub
                subcategorias.add(chave_sub)
    assert len(categorias) == sum(len(c) for c in TAXONOMIA.values())
    assert len(subcategorias) == sum(len(s) for c in TAXONOMIA.values() for s in c.values())


def test_chave_de_categoria_e_subcategoria_do_anexo_a():
    assert chave_categoria("bazar", "Cozinha") == "bazar.cozinha"
    assert chave_subcategoria("bazar", "Cozinha", "Panelas") == "bazar.cozinha.panela"
    assert chave_subcategoria("bazar", "Cozinha", "Panelas de Pressão") == "bazar.cozinha.panela_pressao"


def test_schema_do_servico_expoe_as_categorias_oficiais(session):
    """Família do Anexo A também no schema: 'servico' passa a sugerir as subcategorias oficiais."""
    estab = session.query(Estabelecimento).first()
    estab.segmento = "autopecas"
    estab.configuracoes = {"mix_produtos": ["autopecas", "servico"]}
    session.commit()
    invalidar_cache_view_schema()
    try:
        schema = resolver_view_schema(estab, familia_produto="servico", tipo_item="servico")
        assert "Taxas e Entregas" in schema["categorias_sugeridas"]
        assert "Outros Serviços" in schema["categorias_sugeridas"]
    finally:
        estab.configuracoes = {}
        session.commit()
        invalidar_cache_view_schema()


# ---------------------------------------------------------------------------------------------
# §3.2 — taxonomia_service: casamento POR CHAVE CANÔNICA (regra 4), sem distância de letras.
# ---------------------------------------------------------------------------------------------
def test_chave_canonica_ignora_caixa_pontuacao_e_conectivo():
    assert chave_canonica("Cama, Mesa e Banho") == chave_canonica("CAMA MESA BANHO")
    assert chave_canonica("Cama, Mesa e Banho") == "cama mesa banho"
    assert chave_canonica("Cama ,Mesa") == "cama mesa"


def test_chave_canonica_trata_plural_simples_como_singular():
    assert chave_canonica("Brinquedo") == chave_canonica("Brinquedos") == "brinquedo"


def test_resolver_acha_a_subcategoria_pelo_nome():
    assert resolver("bazar", "PANELAS") == ("bazar.cozinha", "bazar.cozinha.panela")


def test_resolver_recusa_texto_inventado():
    # Sem "parecido": texto fora da lista não vira chute.
    assert resolver("bazar", "panela inventada") is None
    assert resolver("bazar", "Panelas Antiaderentes") is None


def test_resolver_nao_aceita_subcategoria_de_outra_familia():
    assert resolver("bazar", "Ração para Cães") is None
    assert resolver("pet", "Ração para Cães") == ("pet.alimentacao", "pet.alimentacao.racao_cae")


def test_outros_devolve_as_chaves_de_outros_da_familia():
    assert outros("pet") == (chave_categoria("pet", "Outros"), chave_subcategoria("pet", "Outros", "Outros Pet"))
    assert outros("pet")[1].endswith(".outro_pet")
    assert all(outros(familia)[1] for familia in TAXONOMIA)


def test_arvore_tem_categoria_e_subcategoria_com_chave_e_nome():
    cozinha = next(c for c in arvore("bazar") if c["nome"] == "Cozinha")
    assert cozinha["chave"] == "bazar.cozinha"
    assert {"chave": "bazar.cozinha.panela", "nome": "Panelas"} in cozinha["subcategorias"]
    assert [c["nome"] for c in arvore("bazar")][-1] == "Outros"