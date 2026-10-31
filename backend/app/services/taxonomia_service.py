"""Taxonomia oficial (Família → Categoria → Subcategoria): resolução por chave canônica.

PLANO_CATEGORIAS_OFICIAIS.md §3.2. A fonte dos dados é `catalogo_familias.TAXONOMIA`.

Regra 4 do plano (§1): escrita diferente resolve sozinha pela CHAVE CANÔNICA — minúsculas, sem
acento, sem pontuação, sem palavras de ligação (e, de, da, do, das, dos, para, com) e plural
simples → singular. "cama e mesa" = "CAMA, MESA" = "Cama Mesa".

**Sem distância de letras**: nada de SemVer/difflib/"parecido". Igual por chave canônica → usa a
oficial; parecido mas diferente → não adivinha (devolve None).

`garantir_categoria_loja` (cria/sincroniza `categorias_produto`) fica para o bloco seguinte do plano.
"""
from app.services.catalogo_familias import TAXONOMIA, chave_categoria, chave_subcategoria, slug


def chave_canonica(texto) -> str:
    """Regra 4: chave canônica separada por espaço ("Cama, Mesa e Banho" -> "cama mesa banho")."""
    return slug(texto).replace("_", " ")


def _categorias(familia: str) -> dict:
    return TAXONOMIA.get(familia) or {}


def arvore(familia: str) -> list[dict]:
    """Árvore da família para o front: [{"chave","nome","subcategorias":[{"chave","nome"}]}]."""
    return [
        {
            "chave": chave_categoria(familia, categoria),
            "nome": categoria,
            "subcategorias": [
                {"chave": chave_subcategoria(familia, categoria, sub), "nome": sub}
                for sub in subcategorias
            ],
        }
        for categoria, subcategorias in _categorias(familia).items()
    ]


def resolver(familia: str, subcategoria: str | None, categoria: str | None = None) -> tuple[str, str] | None:
    """Casamento POR CHAVE CANÔNICA dentro da família.

    Aceita a subcategoria escrita de qualquer jeito ("PANELAS", "panelas"), a chave pronta
    ("bazar.cozinha.panela") ou o par curto ("cozinha.panela"). Devolve
    `(chave_categoria, chave_subcategoria)` ou None quando não há igualdade exata pela chave
    canônica — inclusive subcategoria de outra família. Só categoria sem subcategoria → None.
    """
    if not subcategoria or not str(subcategoria).strip():
        return None

    alvo = chave_canonica(subcategoria)
    if not alvo:
        return None
    alvo_curto = alvo[len(familia) + 1:] if alvo.startswith(f"{chave_canonica(familia)} ") else alvo
    categoria_esperada = chave_canonica(categoria) if categoria else None

    achados: list[tuple[str, str]] = []
    for nome_categoria, subcategorias in _categorias(familia).items():
        if categoria_esperada and chave_canonica(nome_categoria) != categoria_esperada:
            continue
        for sub in subcategorias:
            # Formas aceitas: nome da subcategoria, "categoria.subcategoria" e a chave completa.
            formas = {
                chave_canonica(sub),
                chave_canonica(f"{nome_categoria}.{sub}"),
                chave_canonica(f"{familia}.{nome_categoria}.{sub}"),
            }
            if alvo in formas or alvo_curto in formas:
                achados.append((chave_categoria(familia, nome_categoria),
                                chave_subcategoria(familia, nome_categoria, sub)))

    # Chave canônica ambígua dentro da família: não adivinha.
    if len({chave_sub for _, chave_sub in achados}) != 1:
        return None
    return achados[0]


def outros(familia: str) -> tuple[str, str]:
    """Chaves de "Outros …" da família (categoria "Outros")."""
    categorias = _categorias(familia)
    for nome_categoria, subcategorias in categorias.items():
        if chave_canonica(nome_categoria) == "outro":
            return (chave_categoria(familia, nome_categoria),
                    chave_subcategoria(familia, nome_categoria, subcategorias[0]))
    raise KeyError(f"família sem categoria 'Outros': {familia!r}")
