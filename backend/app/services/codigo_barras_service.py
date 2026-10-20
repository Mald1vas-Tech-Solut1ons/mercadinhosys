"""
Código de barras interno da loja (EAN-13 de circulação restrita GS1).

Produto sem EAN do fabricante (granel, padaria, fracionado, artesanal) recebe
um código ``20`` + sequência de 10 dígitos + dígito verificador. O prefixo 20-29
é reservado pela GS1 para uso interno: nunca colide com produto de mercado
(789/790 no Brasil) e só tem significado dentro da própria loja — por isso não
vai para o Catálogo Mestre global nem é consultado no Cosmos.
"""
from sqlalchemy import func

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


def proximos_codigos_internos(estabelecimento_id: int, quantidade: int = 1) -> list:
    """Próximos códigos livres da loja, em sequência após o maior já usado."""
    maior = db.session.query(func.max(Produto.codigo_barras)).filter(
        Produto.estabelecimento_id == estabelecimento_id,
        Produto.codigo_barras.like(f"{PREFIXO_INTERNO}%"),
        func.length(Produto.codigo_barras) == 13,
    ).scalar()
    seq = int(maior[2:12]) if maior and maior.isdigit() else 0
    codigos = []
    for _ in range(quantidade):
        seq += 1
        base = f"{PREFIXO_INTERNO}{seq:010d}"
        codigos.append(base + digito_ean13(base))
    return codigos
