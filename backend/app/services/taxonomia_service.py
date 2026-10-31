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

# Limite de `categorias_produto.nome` (String(50) no model, com UNIQUE por loja).
LIMITE_NOME_CATEGORIA = 50

# Nome exibido quando "<Família> › <Categoria>" passa de 50 caracteres (plano §2:
# "use nome curto da família"). Só as famílias cujo maior nome estoura entram aqui.
NOMES_CURTOS_FAMILIA = {
    "alimento": "Mercearia",
    "hortifruti_pesaveis": "Hortifrúti",
    "bazar": "Bazar",
    "eletro": "Eletro",
    "eletronicos": "Eletrônicos",
    "higiene": "Higiene",
    "tintas": "Tintas",
}

_CATEGORIAS_POR_CHAVE: dict[str, tuple[str, str]] = {}
_SUBCATEGORIAS_POR_CHAVE: dict[str, tuple[str, str, str]] = {}
for _familia, _cats in TAXONOMIA.items():
    for _categoria, _subs in _cats.items():
        _CATEGORIAS_POR_CHAVE[chave_categoria(_familia, _categoria)] = (_familia, _categoria)
        for _sub in _subs:
            _SUBCATEGORIAS_POR_CHAVE[chave_subcategoria(_familia, _categoria, _sub)] = (
                _familia, _categoria, _sub)


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


# ---------------------------------------------------------------------------------------------
# §2/§3.2 — espelho em `categorias_produto` e nomes de exibição
# ---------------------------------------------------------------------------------------------
def _nome_familia(familia: str) -> str:
    """Nome de exibição da família ("Bazar"), o mesmo que o schema mostra no formulário."""
    from app.services.view_schema_service import FAMILIAS_PRODUTO  # import tardio: models -> service

    return (FAMILIAS_PRODUTO.get(familia) or {}).get("nome") or familia.replace("_", " ").capitalize()


def nome_categoria_loja(familia: str, categoria: str) -> str:
    """Nome QUALIFICADO gravado em `categorias_produto.nome`: "<Família> › <Categoria>".

    Categoria sozinha repetiria entre famílias ("Cozinha" em Bazar e em Limpeza, "Outros" em todas) e
    bateria no UNIQUE (estabelecimento_id, nome). Se passar de 50 caracteres, usa o nome curto da
    família (plano §2).
    """
    nome = f"{_nome_familia(familia)} › {categoria}"
    if len(nome) > LIMITE_NOME_CATEGORIA:
        curto = NOMES_CURTOS_FAMILIA.get(familia)
        if curto:
            nome = f"{curto} › {categoria}"
    if len(nome) > LIMITE_NOME_CATEGORIA:  # cinto de segurança: nunca estoura a coluna
        nome = nome[:LIMITE_NOME_CATEGORIA].rstrip()
    return nome


def garantir_categoria_loja(estab_id: int, chave_categoria: str):
    """Devolve a CategoriaProduto da loja com `codigo` = chave, criando se não existir.

    Busca SEMPRE por `codigo` (nunca por nome): o nome é só rótulo. Idempotente — duas chamadas
    devolvem a mesma linha. Linha antiga do mesmo código que esteja inativa é reativada (o plano
    proíbe apagar cadastro), e o UNIQUE de nome é respeitado porque o nome vai qualificado.
    """
    from app import db
    from app.models import CategoriaProduto

    chave = (chave_categoria or "").strip()
    familia, _, _resto = chave.partition(".")
    if not familia or chave not in _CATEGORIAS_POR_CHAVE:
        raise ValueError(f"chave de categoria fora da taxonomia: {chave_categoria!r}")
    _, categoria = _CATEGORIAS_POR_CHAVE[chave]
    nome = nome_categoria_loja(familia, categoria)

    def _buscar(com_ativo: bool):
        consulta = db.session.query(CategoriaProduto).filter(
            CategoriaProduto.estabelecimento_id == estab_id,
            CategoriaProduto.codigo == chave,
        )
        if com_ativo:
            consulta = consulta.filter(CategoriaProduto.ativo.is_(True),
                                        CategoriaProduto.deleted_at.is_(None))
        return consulta.order_by(CategoriaProduto.id.asc()).first()

    existente = _buscar(com_ativo=True)
    if existente:
        return existente

    existente = _buscar(com_ativo=False)  # desativada/apagada não vira linha nova
    if existente:
        existente.ativo = True
        existente.deleted_at = None
        db.session.flush()
        return existente

    categoria_loja = CategoriaProduto(estabelecimento_id=estab_id, nome=nome, codigo=chave, ativo=True)
    db.session.add(categoria_loja)
    try:
        db.session.flush()
    except Exception:
        # Corrida/legado: outra linha do mesmo código entrou antes — usa a que existe.
        db.session.rollback()
        existente = _buscar(com_ativo=False)
        if existente is None:
            raise
        return existente
    return categoria_loja


def descrever(familia: str | None, categoria_oficial: str | None,
              subcategoria_oficial: str | None) -> dict:
    """Nomes de exibição das chaves gravadas no produto/item.

    Devolve sempre as três chaves (None quando a chave não está na taxonomia), para o front não
    precisar saber que a classificação é guardada em chave.
    """
    dados: dict[str, str | None] = {"categoria_oficial_nome": None, "subcategoria_oficial_nome": None,
                                    "categoria_oficial_exibicao": None}

    categoria = _CATEGORIAS_POR_CHAVE.get(categoria_oficial or "")
    subcategoria = _SUBCATEGORIAS_POR_CHAVE.get(subcategoria_oficial or "")
    if categoria:
        familia_cat, nome_categoria = categoria
        dados["categoria_oficial_nome"] = nome_categoria
        dados["categoria_oficial_exibicao"] = nome_categoria_loja(familia_cat, nome_categoria)
    if subcategoria:
        _, nome_categoria, nome_subcategoria = subcategoria
        dados["subcategoria_oficial_nome"] = nome_subcategoria
        if dados["categoria_oficial_nome"] is None:
            dados["categoria_oficial_nome"] = nome_categoria
            dados["categoria_oficial_exibicao"] = nome_categoria_loja(subcategoria[0], nome_categoria)
    return dados
