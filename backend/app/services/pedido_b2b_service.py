"""Pedido B2B: reserva de estoque, expedição parcial e cancelamento de saldo.

Fluxo do distribuidor:
  pendente -> (aprovar crédito + reservar) -> aprovado -> expedir (uma ou mais vezes) -> parcial -> faturado
Cada expedição é uma venda de verdade: baixa o estoque pelo FEFO (``estoque_service``), grava o custo
histórico e gera os títulos a receber só do que saiu. O que falta fica em carteira (backorder) até haver
mercadoria; o saldo que não será atendido é cancelado e libera a reserva.

Este módulo nunca faz commit e espera produtos e cliente já bloqueados (``lock_checkout``) e o pedido
bloqueado ``FOR UPDATE``, para reserva, venda de balcão e expedição serem serializados por produto.
"""
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func

from app.models import (ContaReceber, PedidoVendaExpedicao, PedidoVendaExpedicaoItem, Produto, Venda, VendaItem, db)
from app.utils.timezone import to_local
from app.services.estoque_service import (controla_estoque, quantidade_em_quarentena, quantidade_valida,
                                          registrar_saida, reservado_no_produto)

CENT = Decimal('0.01')
ZERO = Decimal('0')
STATUS_ABERTOS = ('aprovado', 'parcial')


class ReservaIndisponivelError(ValueError):
    """Falta estoque livre para reservar tudo que o pedido pede."""

    def __init__(self, faltas):
        self.faltas = faltas
        detalhe = '; '.join(f"{f['produto_nome']}: precisa {f['precisa']}, livre {f['livre']}" for f in faltas)
        super().__init__(f'Estoque livre insuficiente para reservar o pedido ({detalhe})')


def _dec(valor) -> Decimal:
    return Decimal(str(valor if valor is not None else 0))


def _fmt(valor) -> str:
    return f'{_dec(valor).normalize():f}'


def parcelas_condicao(condicao, total, base_dt):
    """Traduz a condição de pagamento em parcelas (valor, vencimento).
    'A Vista' -> 1x hoje; '30 Dias' -> 1x +30d; '30/60' -> 2x; '30/60/90' -> 3x."""
    total = _dec(total)
    base_dt = to_local(base_dt)  # vencimento é data do dia da loja, não do relógio UTC do servidor
    dias = sorted(int(x) for x in re.findall(r'\d+', condicao or '')) or [0]
    n = len(dias)
    base_val = (total / n).quantize(CENT)
    parcelas, acc = [], ZERO
    for i, d in enumerate(dias):
        valor = base_val if i < n - 1 else (total - acc)  # última ajusta centavos
        acc += valor
        parcelas.append((valor, (base_dt + timedelta(days=d)).date()))
    return parcelas


def condicao_a_vista(condicao, total, agora) -> bool:
    return all(venc <= to_local(agora).date() for _, venc in parcelas_condicao(condicao, total, agora))


# ───────────────────────── reserva ─────────────────────────

def estoque_livre(produto) -> Decimal:
    """Saldo que ainda pode ser prometido: físico, menos lote vencido, menos o já reservado."""
    livre = _dec(produto.quantidade) - quantidade_em_quarentena(produto) - reservado_no_produto(produto)
    return max(ZERO, livre)


def reservar(pedido, *, permitir_falta=False):
    """Separa estoque para cada item. Sem ``permitir_falta`` é tudo ou nada.

    Com ``permitir_falta`` reserva o que existe e o resto fica em carteira. Devolve a lista de faltas.
    """
    produtos = {p.id: p for p in Produto.query.filter(
        Produto.estabelecimento_id == pedido.estabelecimento_id,
        Produto.id.in_([i.produto_id for i in pedido.itens])).all()}
    # Mesmo produto em mais de uma linha: o livre diminui à medida que reservamos.
    livre = {}
    plano, faltas = [], []
    for item in pedido.itens:
        precisa = item.saldo - _dec(item.quantidade_reservada)
        if precisa <= 0:
            continue
        produto = produtos[item.produto_id]
        if not controla_estoque(produto):
            plano.append((item, precisa))
            continue
        disponivel = livre.setdefault(produto.id, estoque_livre(produto))
        quantidade = min(precisa, disponivel)
        livre[produto.id] = disponivel - quantidade
        if quantidade > 0:
            plano.append((item, quantidade))
        if quantidade < precisa:
            faltas.append({'item_id': item.id, 'produto_id': produto.id, 'produto_nome': produto.nome,
                           'precisa': _fmt(precisa), 'livre': _fmt(disponivel), 'falta': _fmt(precisa - quantidade)})
    if faltas and not permitir_falta:
        raise ReservaIndisponivelError(faltas)
    for item, quantidade in plano:
        item.quantidade_reservada = _dec(item.quantidade_reservada) + quantidade
    atualizar_status(pedido)
    return faltas


# ───────────────────────── expedição ─────────────────────────

@dataclass
class LinhaExpedicao:
    item: object
    quantidade: Decimal
    total_item: Decimal
    desconto_item: Decimal


@dataclass
class PlanoExpedicao:
    linhas: list = field(default_factory=list)
    subtotal: Decimal = ZERO
    desconto: Decimal = ZERO
    total: Decimal = ZERO
    completa: bool = False


def _expedicoes_validas(pedido):
    return [e for e in pedido.expedicoes if e.cancelada_em is None]


def _faturado_do_item(item, expedicoes):
    return sum((_dec(ei.total_item) for e in expedicoes for ei in e.itens if ei.pedido_item_id == item.id), ZERO)


def planejar_expedicao(pedido, selecao=None) -> PlanoExpedicao:
    """Calcula o que sai, quanto vale e o desconto proporcional; não altera nada.

    ``selecao`` é ``{item_id: quantidade}``; ``None`` expede tudo que está reservado.
    """
    itens = {i.id: i for i in pedido.itens}
    escolhidas = []
    if selecao is None:
        escolhidas = [(i, _dec(i.quantidade_reservada)) for i in pedido.itens if _dec(i.quantidade_reservada) > 0]
    else:
        for item_id, quantidade in selecao.items():
            item = itens.get(int(item_id))
            if item is None:
                raise ValueError('Item não pertence ao pedido')
            quantidade = quantidade_valida(quantidade, 'Quantidade a expedir')
            if quantidade > _dec(item.quantidade_reservada):
                raise ValueError(f'Só {_fmt(item.quantidade_reservada)} reservado de {_fmt(item.quantidade)} do item '
                                 f'{item.produto_id}; reserve antes de expedir mais')
            escolhidas.append((item, quantidade))
    escolhidas = [(i, q) for i, q in escolhidas if q > 0]
    if not escolhidas:
        raise ValueError('Nada reservado para expedir')

    expedicoes = _expedicoes_validas(pedido)
    sem_corte = all(_dec(i.quantidade_cancelada) == 0 for i in pedido.itens)
    fecha_tudo = sem_corte and len(escolhidas) == sum(1 for i in pedido.itens if i.saldo > 0) \
        and all(q == i.saldo for i, q in escolhidas)

    plano = PlanoExpedicao(completa=fecha_tudo)
    for item, quantidade in escolhidas:
        total_item_pedido, desconto_item_pedido = _dec(item.total_item), _dec(item.desconto)
        if quantidade == item.saldo and _dec(item.quantidade_cancelada) == 0:
            valor = total_item_pedido - _faturado_do_item(item, expedicoes)  # última saída fecha os centavos
        else:
            valor = (total_item_pedido * quantidade / _dec(item.quantidade)).quantize(CENT, rounding=ROUND_HALF_UP)
        desconto_item = (desconto_item_pedido * quantidade / _dec(item.quantidade)).quantize(CENT, rounding=ROUND_HALF_UP)
        plano.linhas.append(LinhaExpedicao(item, quantidade, valor, desconto_item))
        plano.subtotal += valor

    desconto_pedido, subtotal_pedido = _dec(pedido.desconto), _dec(pedido.subtotal)
    if fecha_tudo:
        plano.desconto = desconto_pedido - sum((_dec(e.desconto) for e in expedicoes), ZERO)
    elif subtotal_pedido > 0:
        plano.desconto = (desconto_pedido * plano.subtotal / subtotal_pedido).quantize(CENT, rounding=ROUND_HALF_UP)
    plano.desconto = min(max(plano.desconto, ZERO), plano.subtotal)
    plano.total = plano.subtotal - plano.desconto
    return plano


def executar_expedicao(pedido, plano, cliente, *, agora=None):
    """Cria a venda da saída, baixa o estoque, grava a expedição e gera os títulos do que saiu."""
    from app.services.venda_service import VendaService
    agora = agora or datetime.utcnow()
    sequencia = (db.session.query(func.coalesce(func.max(PedidoVendaExpedicao.sequencia), 0))
                 .filter(PedidoVendaExpedicao.pedido_id == pedido.id).scalar() or 0) + 1
    codigo_venda = f'VD-SFA-{pedido.id}-{sequencia}-{int(agora.timestamp())}'
    venda = Venda(
        estabelecimento_id=pedido.estabelecimento_id, cliente_id=pedido.cliente_id, funcionario_id=pedido.vendedor_id,
        codigo=codigo_venda, subtotal=plano.subtotal, desconto=plano.desconto, total=plano.total,
        status='finalizada', tipo_venda='sfa', quantidade_itens=len(plano.linhas),
        observacoes=f'Expedição {sequencia} do pedido SFA {pedido.codigo}', data_venda=agora)
    db.session.add(venda)
    db.session.flush()

    expedicao = PedidoVendaExpedicao(
        estabelecimento_id=pedido.estabelecimento_id, pedido_id=pedido.id, venda_id=venda.id, sequencia=sequencia,
        subtotal=plano.subtotal, desconto=plano.desconto, total=plano.total, funcionario_id=pedido.vendedor_id)
    db.session.add(expedicao)
    db.session.flush()

    for linha in plano.linhas:
        item = linha.item
        produto = Produto.query.filter_by(id=item.produto_id, estabelecimento_id=pedido.estabelecimento_id).first()
        if not produto:
            raise ValueError(f'Produto {item.produto_id} não encontrado')
        _, custo = registrar_saida(
            produto, linha.quantidade, venda_id=venda.id, funcionario_id=pedido.vendedor_id,
            motivo=f'Venda SFA {codigo_venda}', data=agora, ignorar_pedido_id=pedido.id)
        db.session.add(VendaItem(
            estabelecimento_id=pedido.estabelecimento_id, venda_id=venda.id, produto_id=produto.id,
            produto_nome=produto.nome, produto_codigo=produto.codigo_interno, produto_unidade=produto.unidade_medida,
            quantidade=linha.quantidade, preco_unitario=item.preco_unitario, desconto=linha.desconto_item,
            total_item=linha.total_item, custo_unitario=custo,
            margem_lucro_real=(linha.total_item - custo * linha.quantidade).quantize(CENT)))
        produto.quantidade_vendida = _dec(produto.quantidade_vendida) + linha.quantidade
        produto.total_vendido = _dec(produto.total_vendido) + linha.total_item
        produto.ultima_venda = agora
        item.quantidade_reservada = _dec(item.quantidade_reservada) - linha.quantidade
        item.quantidade_atendida = _dec(item.quantidade_atendida) + linha.quantidade
        db.session.add(PedidoVendaExpedicaoItem(
            estabelecimento_id=pedido.estabelecimento_id, expedicao_id=expedicao.id, pedido_item_id=item.id,
            quantidade=linha.quantidade, total_item=linha.total_item))

    parcelas = parcelas_condicao(pedido.condicao_pagamento, plano.total, agora)
    for i, (valor, vencimento) in enumerate(parcelas, start=1):
        db.session.add(ContaReceber(
            estabelecimento_id=pedido.estabelecimento_id, cliente_id=pedido.cliente_id, venda_id=venda.id,
            numero_documento=f'DUP-{codigo_venda}-{i}/{len(parcelas)}', valor_original=valor, valor_atual=valor,
            data_emissao=to_local(agora).date(), data_vencimento=vencimento, status='aberto',
            observacoes=f"Pedido SFA {pedido.codigo} - expedição {sequencia} - parcela {i}/{len(parcelas)} "
                        f"({pedido.condicao_pagamento or 'à vista'})"))
    if cliente:
        cliente.saldo_devedor = _dec(cliente.saldo_devedor) + plano.total
        VendaService.atualizar_metricas_cliente(cliente.id, plano.total, agora)

    db.session.flush()
    db.session.refresh(pedido)
    atualizar_status(pedido)
    return venda, expedicao, len(parcelas)


# ───────────────────────── saldo, status e reabertura ─────────────────────────

def atualizar_status(pedido):
    """Deriva o status do pedido a partir dos itens. Pedido encerrado não segura reserva."""
    saldo = sum((i.saldo for i in pedido.itens), ZERO)
    atendido = sum((_dec(i.quantidade_atendida) for i in pedido.itens), ZERO)
    if saldo == 0:
        pedido.status = 'faturado' if atendido > 0 else 'cancelado'
        for item in pedido.itens:
            item.quantidade_reservada = ZERO
    elif atendido > 0:
        pedido.status = 'parcial'
    else:
        pedido.status = 'aprovado'
    return pedido.status


def cancelar_saldo(pedido, motivo='Saldo cancelado'):
    """Corta o que ainda não saiu e libera a reserva. Sem nada expedido, o pedido todo é cancelado."""
    cortado = ZERO
    for item in pedido.itens:
        saldo = item.saldo
        if saldo > 0:
            item.quantidade_cancelada = _dec(item.quantidade_cancelada) + saldo
            item.quantidade_reservada = ZERO
            cortado += saldo
    if cortado == 0:
        raise ValueError('O pedido não tem saldo a cancelar')
    pedido.observacoes = f'{pedido.observacoes or ""} | {motivo}'.strip(' |')
    return atualizar_status(pedido)


def travar_pedido_da_venda(venda):
    """Bloqueia o pedido de origem da venda antes dos produtos, na mesma ordem da expedição (pedido primeiro),
    para cancelamento e expedição simultâneos não travarem um ao outro."""
    from app.models import PedidoVenda
    expedicao = PedidoVendaExpedicao.query.filter_by(
        venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id).first()
    if not expedicao:
        return None
    return PedidoVenda.query.filter_by(id=expedicao.pedido_id, estabelecimento_id=venda.estabelecimento_id)         .populate_existing().with_for_update().first()


def reabrir_expedicao(venda):
    """Venda cancelada: a mercadoria voltou ao estoque e o item volta a ser saldo do pedido (sem reserva)."""
    expedicao = PedidoVendaExpedicao.query.filter_by(
        venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id).first()
    if not expedicao or expedicao.cancelada_em is not None:
        return None
    from app.models import PedidoVenda, PedidoVendaItem
    pedido = PedidoVenda.query.filter_by(id=expedicao.pedido_id, estabelecimento_id=venda.estabelecimento_id) \
        .populate_existing().with_for_update().first()
    for ei in expedicao.itens:
        item = PedidoVendaItem.query.filter_by(id=ei.pedido_item_id, estabelecimento_id=venda.estabelecimento_id).first()
        if item:
            item.quantidade_atendida = max(ZERO, _dec(item.quantidade_atendida) - _dec(ei.quantidade))
    expedicao.cancelada_em = datetime.utcnow()
    db.session.flush()
    db.session.refresh(pedido)
    atualizar_status(pedido)
    return pedido


# ───────────────────────── separação ─────────────────────────

def lista_separacao(pedido):
    """Roteiro do estoquista: o que separar de cada item, já pelos lotes de validade mais curta."""
    linhas = []
    for item in pedido.itens:
        produto = Produto.query.filter_by(id=item.produto_id, estabelecimento_id=pedido.estabelecimento_id).first()
        a_separar = _dec(item.quantidade_reservada)
        lotes = []
        if produto and a_separar > 0 and controla_estoque(produto):
            restante = a_separar
            for lote in produto.get_lotes_disponiveis():
                if restante <= 0:
                    break
                usar = min(restante, _dec(lote.quantidade))
                lotes.append({'lote': lote.numero_lote, 'validade': lote.data_validade.isoformat() if lote.data_validade else None,
                              'quantidade': float(usar)})
                restante -= usar
        linhas.append({
            'item_id': item.id, 'produto_id': item.produto_id, 'produto_nome': produto.nome if produto else None,
            'codigo_barras': getattr(produto, 'codigo_barras', None), 'unidade': getattr(produto, 'unidade_medida', None),
            'pedido': float(item.quantidade), 'atendido': float(item.quantidade_atendida or 0),
            'cancelado': float(item.quantidade_cancelada or 0), 'saldo': float(item.saldo),
            'reservado': float(a_separar), 'em_falta': float(max(ZERO, item.saldo - a_separar)), 'lotes': lotes})
    return linhas
