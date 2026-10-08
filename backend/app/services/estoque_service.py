"""Saída e estorno de estoque com uma única regra para todos os canais de venda.

PDV, venda direta, faturamento SFA e venda com entrega passam por aqui: mesma
disponibilidade (lote vencido fica em quarentena), mesmo consumo FEFO, mesmo
custo histórico e o mesmo rastro de lotes para o estorno. O chamador abre a
transação e bloqueia o produto antes (``lock_checkout``); este módulo nunca
faz commit.
"""
import json
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sqlalchemy import func

from app.models import MovimentacaoEstoque, Produto, ProdutoLote, db

QTD = Decimal('0.001')
CENT = Decimal('0.01')


class EstoqueIndisponivelError(ValueError):
    """Saldo vendável insuficiente; ValueError para as rotas responderem 400."""

    def __init__(self, produto, solicitado, disponivel, quarentena):
        self.produto_id = produto.id
        self.solicitado = solicitado
        self.disponivel = disponivel
        self.quarentena = quarentena
        detalhe = f' ({_qtd(quarentena)} em lote vencido)' if quarentena > 0 else ''
        super().__init__(f'Estoque insuficiente para {produto.nome}: disponível {_qtd(disponivel)}{detalhe}, '
                         f'solicitado {_qtd(solicitado)}')


def _qtd(valor) -> str:
    return f'{Decimal(str(valor)).normalize():f}'


def quantidade_valida(valor, rotulo='Quantidade') -> Decimal:
    """Quantidade positiva e finita na escala das colunas (3 casas)."""
    try:
        quantidade = Decimal(str(valor))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f'{rotulo} inválida') from None
    if not quantidade.is_finite() or quantidade <= 0 or quantidade > Decimal('9999999'):
        raise ValueError(f'{rotulo} inválida')
    quantidade = quantidade.quantize(QTD, rounding=ROUND_HALF_UP)
    if quantidade <= 0:
        raise ValueError(f'{rotulo} inválida')
    return quantidade


def controla_estoque(produto) -> bool:
    # "Taxa de Entrega" antiga nasceu só com tipo="servico" e saldo fictício 9999.
    servico = (produto.tipo_item or 'produto') == 'servico' or (produto.tipo or '').lower() == 'servico'
    return produto.controlar_estoque is not False and not servico


def quantidade_em_quarentena(produto) -> Decimal:
    """Saldo de lotes ativos vencidos: existe fisicamente, mas não pode ser vendido."""
    if produto.controlar_validade is False:
        return Decimal('0')
    total = db.session.query(func.coalesce(func.sum(ProdutoLote.quantidade), 0)).filter(
        ProdutoLote.produto_id == produto.id,
        ProdutoLote.estabelecimento_id == produto.estabelecimento_id,
        ProdutoLote.ativo.is_(True),
        ProdutoLote.quantidade > 0,
        ProdutoLote.data_validade < date.today(),
    ).scalar()
    return Decimal(str(total or 0))


def custo_historico(produto) -> Decimal:
    """Custo médio vigente no instante da saída; fica gravado no item para o CMV."""
    return Decimal(str(produto.preco_custo or 0))


def registrar_saida(produto, quantidade, *, venda_id, funcionario_id, motivo, data=None):
    """Baixa agregado e lotes de uma venda e grava o movimento com o rastro.

    Retorna ``(movimento, custo_unitario)``; serviço não movimenta estoque e
    devolve ``movimento=None``.
    """
    quantidade = quantidade_valida(quantidade)
    custo = custo_historico(produto)
    if not controla_estoque(produto):
        return None, custo
    quarentena = quantidade_em_quarentena(produto)
    disponivel = Decimal(str(produto.quantidade or 0)) - quarentena
    if quantidade > disponivel:
        raise EstoqueIndisponivelError(produto, quantidade, max(disponivel, Decimal('0')), quarentena)
    anterior = Decimal(str(produto.quantidade or 0))
    consumidos = produto.consumir_estoque_fifo(quantidade)
    movimento = MovimentacaoEstoque(
        estabelecimento_id=produto.estabelecimento_id,
        produto_id=produto.id,
        venda_id=venda_id,
        lote_id=consumidos[0]['lote_id'] if len(consumidos) == 1 else None,
        funcionario_id=funcionario_id,
        tipo='saida',
        quantidade=quantidade,
        quantidade_anterior=anterior,
        quantidade_atual=produto.quantidade,
        custo_unitario=custo,
        valor_total=(custo * quantidade).quantize(CENT, rounding=ROUND_HALF_UP),
        motivo=motivo[:100],
        observacoes=json.dumps({'lotes_consumidos': [[c['lote_id'], str(c['quantidade_consumida'])] for c in consumidos]}),
    )
    if data is not None:
        movimento.created_at = data
    db.session.add(movimento)
    return movimento, custo


def _lotes_do_rastro(movimento):
    try:
        return json.loads(movimento.observacoes or '{}').get('lotes_consumidos', [])
    except (ValueError, AttributeError):
        return []  # saídas anteriores ao rastro não sabem quais lotes usaram


def estornar_saidas_venda(venda, *, funcionario_id, motivo, itens_sem_movimento=None):
    """Devolve ao estoque exatamente o que a venda consumiu, uma única vez.

    A fonte é o razão de movimentos: agregado e lotes voltam como saíram, com
    movimento de entrada vinculado. Venda legada sem movimento de saída só é
    reposta quando ``itens_sem_movimento`` informa que houve baixa sem rastro.
    """
    saidas = MovimentacaoEstoque.query.filter_by(
        venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id, tipo='saida').order_by(MovimentacaoEstoque.id).all()
    estornos = MovimentacaoEstoque.query.filter_by(
        venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id, tipo='entrada').count()
    if estornos:
        raise ValueError('Estoque desta venda já foi estornado')
    pendentes = [(m.produto_id, Decimal(str(m.quantidade)), m) for m in saidas]
    if not saidas and itens_sem_movimento:
        pendentes = [(produto_id, Decimal(str(qtd)), None) for produto_id, qtd in itens_sem_movimento]
    criados = []
    for produto_id, quantidade, saida in pendentes:
        produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=venda.estabelecimento_id)\
            .populate_existing().with_for_update().first()
        if not produto:
            continue
        anterior = Decimal(str(produto.quantidade or 0))
        produto.quantidade = anterior + quantidade
        for lote_id, consumida in (_lotes_do_rastro(saida) if saida else []):
            lote = ProdutoLote.query.filter_by(id=lote_id, produto_id=produto.id,
                                               estabelecimento_id=produto.estabelecimento_id).with_for_update().first()
            if lote:
                lote.quantidade = Decimal(str(lote.quantidade or 0)) + Decimal(consumida)
        custo = Decimal(str(saida.custo_unitario)) if saida is not None and saida.custo_unitario is not None else custo_historico(produto)
        movimento = MovimentacaoEstoque(
            estabelecimento_id=produto.estabelecimento_id,
            produto_id=produto.id,
            venda_id=venda.id,
            lote_id=saida.lote_id if saida is not None else None,
            funcionario_id=funcionario_id,
            tipo='entrada',
            quantidade=quantidade,
            quantidade_anterior=anterior,
            quantidade_atual=produto.quantidade,
            custo_unitario=custo,
            valor_total=(custo * quantidade).quantize(CENT, rounding=ROUND_HALF_UP),
            motivo=motivo[:100],
            observacoes=saida.observacoes if saida is not None else json.dumps({'estorno_sem_rastro': True}),
        )
        db.session.add(movimento)
        criados.append(movimento)
    return criados
