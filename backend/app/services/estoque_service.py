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

from app.models import MovimentacaoEstoque, PedidoVenda, PedidoVendaItem, Produto, ProdutoLote, db

QTD = Decimal('0.001')
CENT = Decimal('0.01')


class EstoqueIndisponivelError(ValueError):
    """Saldo vendável insuficiente; ValueError para as rotas responderem 400."""

    def __init__(self, produto, solicitado, disponivel, quarentena, reservado=Decimal('0')):
        self.produto_id = produto.id
        self.solicitado = solicitado
        self.disponivel = disponivel
        self.quarentena = quarentena
        self.reservado = reservado
        partes = []
        if quarentena > 0:
            partes.append(f'{_qtd(quarentena)} em lote vencido')
        if reservado > 0:
            partes.append(f'{_qtd(reservado)} reservado para pedidos')
        detalhe = f' ({"; ".join(partes)})' if partes else ''
        super().__init__(f'Estoque insuficiente para {produto.nome}: disponível {_qtd(disponivel)}{detalhe}, '
                         f'solicitado {_qtd(solicitado)}')


class ProdutoVencidoError(ValueError):
    """Produto sem lote com data de validade passada e a loja bloqueia venda de vencido."""

    def __init__(self, produto):
        self.produto_id = produto.id
        super().__init__(f'{produto.nome} está vencido (validade {produto.data_validade.strftime("%d/%m/%Y")}). '
                         'A venda de produto vencido está bloqueada nas configurações da loja.')


def _bloqueia_vencido(produto) -> bool:
    from app.utils.query_helpers import bloquear_venda_vencido
    return bloquear_venda_vencido(produto.estabelecimento_id)


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
    """Saldo de lotes ativos vencidos: existe fisicamente, mas não pode ser vendido.

    Loja que desligou "bloquear venda de vencido" não tem quarentena: o vencido sai primeiro (FEFO).
    """
    if produto.controlar_validade is False or not _bloqueia_vencido(produto):
        return Decimal('0')
    total = db.session.query(func.coalesce(func.sum(ProdutoLote.quantidade), 0)).filter(
        ProdutoLote.produto_id == produto.id,
        ProdutoLote.estabelecimento_id == produto.estabelecimento_id,
        ProdutoLote.ativo.is_(True),
        ProdutoLote.quantidade > 0,
        ProdutoLote.data_validade < date.today(),
    ).scalar()
    return Decimal(str(total or 0))


def _vencido_sem_lote(produto) -> bool:
    """Validade só no cadastro (sem lote com saldo) e já passou; com lote, quem decide é a quarentena."""
    if produto.controlar_validade is False or not produto.data_validade or produto.data_validade >= date.today():
        return False
    tem_lote = db.session.query(ProdutoLote.id).filter(
        ProdutoLote.produto_id == produto.id,
        ProdutoLote.estabelecimento_id == produto.estabelecimento_id,
        ProdutoLote.ativo.is_(True),
        ProdutoLote.quantidade > 0,
    ).first()
    return tem_lote is None


def reservado_no_produto(produto, exceto_pedido_id=None) -> Decimal:
    """Quantidade separada para pedidos B2B abertos (aprovado/parcial); não pode ser vendida por outro canal."""
    consulta = db.session.query(func.coalesce(func.sum(PedidoVendaItem.quantidade_reservada), 0)).join(
        PedidoVenda, PedidoVenda.id == PedidoVendaItem.pedido_id).filter(
        PedidoVendaItem.produto_id == produto.id,
        PedidoVendaItem.estabelecimento_id == produto.estabelecimento_id,
        PedidoVenda.status.in_(('aprovado', 'parcial')),
        PedidoVenda.deleted_at.is_(None),
    )
    if exceto_pedido_id is not None:
        consulta = consulta.filter(PedidoVenda.id != exceto_pedido_id)
    return Decimal(str(consulta.scalar() or 0))


def custo_historico(produto) -> Decimal:
    """Custo médio vigente no instante da saída; fica gravado no item para o CMV."""
    return Decimal(str(produto.preco_custo or 0))


def registrar_saida(produto, quantidade, *, venda_id, funcionario_id, motivo, data=None, ignorar_pedido_id=None,
                    permitir_sem_estoque=False):
    """Baixa agregado e lotes de uma venda e grava o movimento com o rastro.

    Retorna ``(movimento, custo_unitario)``; serviço não movimenta estoque e
    devolve ``movimento=None``. O saldo vendável desconta o que está reservado para
    pedidos; a expedição de um pedido passa ``ignorar_pedido_id`` para usar a própria reserva.
    ``permitir_sem_estoque`` (config da loja, só no balcão): vende além do saldo; os lotes
    vendáveis são consumidos até zerar e o agregado fica negativo até a entrada da nota
    (lote vencido nunca sai).
    """
    quantidade = quantidade_valida(quantidade)
    custo = custo_historico(produto)
    if getattr(produto, 'eh_grade_modelo', False):
        raise ValueError(f'{produto.nome} é o modelo da grade: venda o número escolhido.')
    if not controla_estoque(produto):
        return None, custo
    bloqueia = _bloqueia_vencido(produto)
    if bloqueia and _vencido_sem_lote(produto):
        raise ProdutoVencidoError(produto)
    quarentena = quantidade_em_quarentena(produto)
    reservado = reservado_no_produto(produto, exceto_pedido_id=ignorar_pedido_id)
    disponivel = Decimal(str(produto.quantidade or 0)) - quarentena - reservado
    if quantidade > disponivel and not permitir_sem_estoque:
        raise EstoqueIndisponivelError(produto, quantidade, max(disponivel, Decimal('0')), quarentena, reservado)
    anterior = Decimal(str(produto.quantidade or 0))
    # Venda além do saldo: os lotes vendáveis saem até zerar (reserva e quarentena intactas) e o
    # agregado fica NEGATIVO — a mercadoria chegou antes da nota. Com piso em zero, a entrada
    # posterior somava em cima do zero e criava estoque fantasma; o razão também não fechava.
    baixa_lotes = quantidade if quantidade <= disponivel else max(disponivel, Decimal('0'))
    consumidos = produto.consumir_estoque_fifo(baixa_lotes, incluir_vencidos=not bloqueia)
    produto.quantidade = anterior - quantidade
    rastro = {'lotes_consumidos': [[c['lote_id'], str(c['quantidade_consumida'])] for c in consumidos]}
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
        observacoes=json.dumps(rastro),
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


def _baixa_efetiva(movimento, quantidade):
    """Quanto a saída tirou do agregado (venda sem estoque baixa menos do que vendeu)."""
    try:
        valor = json.loads(movimento.observacoes or '{}').get('baixa_efetiva')
    except (ValueError, AttributeError):
        valor = None
    return Decimal(valor) if valor is not None else quantidade


def estornar_saidas_venda(venda, *, funcionario_id, motivo, itens_sem_movimento=None, produtos_perda=None):
    """Devolve ao estoque exatamente o que a venda consumiu, uma única vez.

    A fonte é o razão de movimentos: agregado e lotes voltam como saíram, com
    movimento de entrada vinculado. Venda legada sem movimento de saída só é
    reposta quando ``itens_sem_movimento`` informa que houve baixa sem rastro.

    ``produtos_perda`` sai deste estorno: o cliente devolveu o leite aberto, o
    produto não volta para a prateleira (ver registrar_perda_de_venda).
    """
    perda = {int(p) for p in (produtos_perda or [])}
    saidas = MovimentacaoEstoque.query.filter_by(
        venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id, tipo='saida').order_by(MovimentacaoEstoque.id).all()
    saidas = [m for m in saidas if m.produto_id not in perda]
    estornos = MovimentacaoEstoque.query.filter_by(
        venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id, tipo='entrada').count()
    if estornos:
        raise ValueError('Estoque desta venda já foi estornado')
    pendentes = [(m.produto_id, Decimal(str(m.quantidade)), m) for m in saidas]
    if not saidas and itens_sem_movimento:
        pendentes = [(produto_id, Decimal(str(qtd)), None)
                     for produto_id, qtd in itens_sem_movimento if int(produto_id) not in perda]
    criados = []
    for produto_id, quantidade, saida in pendentes:
        produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=venda.estabelecimento_id)\
            .populate_existing().with_for_update().first()
        if not produto:
            continue
        anterior = Decimal(str(produto.quantidade or 0))
        quantidade = _baixa_efetiva(saida, quantidade) if saida is not None else quantidade
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


def registrar_perda_de_venda(venda, produtos_perda, *, funcionario_id, motivo="Perda em cancelamento de venda"):
    """Cancelamento em que o item NÃO volta para a prateleira.

    O estoque já foi baixado na venda; devolver o item ao estoque faria o
    inventário mentir (o leite aberto volta a ser vendável). Aqui a saída
    original da venda é retitulada como perda: o razão continua fechando com o
    saldo do produto, e o DRE passa a ler aquilo como perda, não como venda.

    Venda antiga sem rastro de saída ganha uma linha de perda explícita
    (quantidade anterior = saldo atual + quantidade), sem tocar no saldo —
    o produto já tinha sido baixado na venda.
    """
    from app.models import MovimentacaoEstoque, Produto

    perda = [int(p) for p in (produtos_perda or [])]
    if not perda:
        return []

    registrados = []
    for produto_id in perda:
        # Quantidade que a venda consumiu deste produto (agregando mais de um item do mesmo produto).
        quantidade = sum(
            (Decimal(str(item.quantidade or 0)) for item in venda.itens if item.produto_id == produto_id),
            Decimal("0"),
        )
        if quantidade <= 0:
            continue

        saidas = [m for m in MovimentacaoEstoque.query.filter_by(
            venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id,
            produto_id=produto_id, tipo='saida').order_by(MovimentacaoEstoque.id).all()
            if not (m.motivo or "").startswith(motivo)]
        if saidas:
            for saida in saidas:
                saida.motivo = motivo[:100]
                saida.observacoes = f"Cancelamento da venda #{venda.codigo}: item não voltou ao estoque"
            registrados.extend(saidas)
            continue

        produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=venda.estabelecimento_id)            .populate_existing().with_for_update().first()
        if not produto:
            continue
        atual = Decimal(str(produto.quantidade or 0))
        movimento = MovimentacaoEstoque(
            estabelecimento_id=venda.estabelecimento_id,
            produto_id=produto_id,
            venda_id=venda.id,
            funcionario_id=funcionario_id,
            tipo='saida',
            quantidade=quantidade,
            quantidade_anterior=atual + quantidade,
            quantidade_atual=atual,
            custo_unitario=custo_historico(produto),
            valor_total=(custo_historico(produto) * quantidade).quantize(CENT, rounding=ROUND_HALF_UP),
            motivo=motivo[:100],
            observacoes=f"Cancelamento da venda #{venda.codigo}: venda sem rastro de saída",
        )
        db.session.add(movimento)
        registrados.append(movimento)

    return registrados
