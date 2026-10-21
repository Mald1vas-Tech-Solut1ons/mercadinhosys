"""
Código de barras interno da loja (EAN-13 de circulação restrita GS1).

Produto sem EAN do fabricante (granel, padaria, fracionado, artesanal) recebe
um código ``20`` + sequência de 10 dígitos + dígito verificador. O prefixo 20-29
é reservado pela GS1 para uso interno: nunca colide com produto de mercado
(789/790 no Brasil) e só tem significado dentro da própria loja — por isso não
vai para o Catálogo Mestre global nem é consultado no Cosmos.
"""
from sqlalchemy import func, select

from app.models import db, Produto

PREFIXO_INTERNO = "20"


def digito_ean13(base12: str) -> str:
    soma = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(base12))
    return str((10 - soma % 10) % 10)


def ean13_valido(codigo: str) -> bool:
    codigo = (codigo or "").strip()
    return len(codigo) == 13 and codigo.isdigit() and digito_ean13(codigo[:12]) == codigo[12]


def eh_codigo_interno(codigo: str) -> bool:
    """EAN-13 de circulação restrita (20-29): vale só dentro da loja."""
    codigo = (codigo or "").strip()
    return len(codigo) == 13 and codigo.isdigit() and codigo[0] == "2"


SEQUENCIA_MAXIMA = 10 ** 10 - 1  # 10 dígitos entre o prefixo e o dígito verificador


class SequenciaInternaEsgotada(ValueError):
    pass


def maior_sequencia_interna(estabelecimento_id: int) -> int:
    """Maior sequência numérica entre os códigos ``20`` + 10 dígitos + DV da loja.

    ``MAX(codigo_barras)`` é lexicográfico: um código digitado como ``20ZZZZZZZZZZZ``
    vencia e zerava a sequência (o próximo código já existia). Aqui só contam códigos
    100% numéricos. Inclui produtos excluídos (soft delete), porque a unicidade
    (estabelecimento, codigo_barras) também os inclui — por isso ``select`` puro, que
    não passa pelo filtro de soft delete do TenantQuery.
    """
    linhas = db.session.execute(
        select(Produto.codigo_barras).where(
            Produto.estabelecimento_id == estabelecimento_id,
            Produto.codigo_barras.like(f"{PREFIXO_INTERNO}%"),
            func.length(Produto.codigo_barras) == 13,
        )
    ).scalars()
    return max((int(c[2:12]) for c in linhas if c and c.isdigit()), default=0)


def proximos_codigos_internos(estabelecimento_id: int, quantidade: int = 1, *, pular: int = 0) -> list:
    """Próximos códigos livres da loja, em sequência após o maior já usado.

    ``pular`` avança a sequência (retentativa após colisão com cadastro concorrente).
    """
    seq = maior_sequencia_interna(estabelecimento_id) + pular
    if seq + quantidade > SEQUENCIA_MAXIMA:
        raise SequenciaInternaEsgotada("Sequência de códigos internos esgotada nesta loja")
    codigos = []
    for _ in range(quantidade):
        seq += 1
        base = f"{PREFIXO_INTERNO}{seq:010d}"
        codigos.append(base + digito_ean13(base))
    return codigos
