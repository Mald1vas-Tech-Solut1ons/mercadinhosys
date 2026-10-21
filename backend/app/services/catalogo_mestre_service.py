"""
Alimentação silenciosa do Catálogo Mestre (tabela global `catalogo_mestre`).

Toda vez que um tenant cadastra um produto com EAN (via modal "Novo Produto"
ou importação de XML de NF-e), tenta registrar o item no catálogo global se
ele ainda não existir. Nunca sobrescreve um item já catalogado (a Cosmos ou
outro tenant podem ter dados melhores) e nunca deixa erro vazar pro fluxo do
tenant que originou o cadastro.
"""
import logging

from app.models import db, CatalogoMestre

logger = logging.getLogger(__name__)


def _ean_valido(codigo: str) -> bool:
    if not codigo:
        return False
    codigo = codigo.strip()
    from app.services.codigo_barras_service import eh_codigo_interno
    # Código interno (20-29) só vale na loja que o gerou: nunca entra no catálogo global.
    return codigo.isdigit() and 8 <= len(codigo) <= 14 and not eh_codigo_interno(codigo)


def registrar_produto_se_novo(produto, estabelecimento, via: str) -> None:
    """No-op silencioso em qualquer cenário que não seja 'EAN novo e válido'."""
    try:
        ean = (produto.codigo_barras or "").strip()
        if not _ean_valido(ean):
            return
        existente = CatalogoMestre.query.filter_by(ean=ean).first()
        if existente and existente.status != "nao_encontrado":
            return
        categoria_nome = produto.categoria.nome if produto.categoria else None
        campos = dict(
            nome=produto.nome,
            marca=produto.marca,
            fabricante=produto.fabricante,
            ncm=produto.ncm,
            categoria=categoria_nome,
            unidade=produto.unidade_medida,
            imagem_url=produto.imagem_url,
            fonte="tenant",
            status="encontrado",
            descoberto_por_estabelecimento_id=estabelecimento.id if estabelecimento else None,
            descoberto_via=via,
        )
        if existente:
            # Cache negativo do lookup não impede a loja de ensinar o produto ao catálogo.
            for campo, valor in campos.items():
                setattr(existente, campo, valor)
        else:
            db.session.add(CatalogoMestre(ean=ean, **campos))
    except Exception as e:
        logger.warning(f"Catálogo Mestre: falha ao registrar produto (via={via}): {e}")
