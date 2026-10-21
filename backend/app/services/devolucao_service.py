"""Devolução parcial e troca de itens de uma venda, por lote.

Uma devolução nunca reescreve a venda: grava o que voltou (item, lote, quantidade, valor e custo
históricos) e produz os efeitos uma única vez, na mesma transação:

* estoque: ``reintegrar`` devolve ao saldo e ao lote de onde a unidade saiu; ``avaria`` registra a
  entrada física sem torná-la vendável;
* dinheiro (só em ``devolucao``): ``abater_titulo`` reduz os títulos em aberto da venda e o saldo
  devedor do cliente; ``dinheiro`` sai da gaveta do caixa aberto de quem registra (como sangria,
  para o fechamento e o fluxo de caixa enxergarem); ``pix``/``transferencia``/``estorno_cartao``
  ficam registrados sem lançamento bancário (não há conciliação bancária no sistema);
* ``troca``: a mercadoria devolvida volta (reintegrada ou avariada) e sai uma unidade nova do mesmo
  produto pelo FEFO, sem efeito financeiro.

O valor devolvido é o valor líquido do item, com o desconto da venda rateado; a soma das devoluções
nunca passa do total da venda. A venda com devolução não pode mais ser cancelada (o cancelamento
estornaria de novo o que já voltou); o restante deve ser devolvido por aqui.

Este módulo nunca faz commit.
"""
import json
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func

from app.models import (Auditoria, Caixa, Cliente, ContaReceber, DevolucaoVenda, DevolucaoVendaItem, MovimentacaoCaixa,
                        MovimentacaoEstoque, Produto, ProdutoLote, Venda, VendaItem, db)
from app.services.crm_service import Conflito, CrmErro, NaoEncontrado, obter_chamado
from app.services.estoque_service import (controla_estoque, custo_historico, quantidade_valida, registrar_saida,
                                          _lotes_do_rastro)

CENT = Decimal("0.01")
FORMAS = ("abater_titulo", "dinheiro", "pix", "transferencia", "estorno_cartao")
FORMAS_DINHEIRO = ("dinheiro", "pix", "transferencia", "estorno_cartao")


def _centavos(valor):
    return Decimal(str(valor)).quantize(CENT, rounding=ROUND_HALF_UP)


def devolvido_por_item(venda_id):
    linhas = db.session.query(DevolucaoVendaItem.venda_item_id, func.coalesce(func.sum(DevolucaoVendaItem.quantidade), 0)) \
        .join(DevolucaoVenda, DevolucaoVenda.id == DevolucaoVendaItem.devolucao_id) \
        .filter(DevolucaoVenda.venda_id == venda_id).group_by(DevolucaoVendaItem.venda_item_id).all()
    return {item_id: Decimal(str(qtd)) for item_id, qtd in linhas}


def _devolvido_por_lote(venda_id, produto_id):
    linhas = db.session.query(DevolucaoVendaItem.lote_id, func.coalesce(func.sum(DevolucaoVendaItem.quantidade), 0)) \
        .join(DevolucaoVenda, DevolucaoVenda.id == DevolucaoVendaItem.devolucao_id) \
        .filter(DevolucaoVenda.venda_id == venda_id, DevolucaoVendaItem.produto_id == produto_id) \
        .group_by(DevolucaoVendaItem.lote_id).all()
    return {lote_id: Decimal(str(qtd)) for lote_id, qtd in linhas}


def _rastro_de_lotes(venda, produto_id):
    """Lotes consumidos pela venda para o produto, na ordem em que saíram."""
    consumidos = {}
    saidas = MovimentacaoEstoque.query.filter_by(venda_id=venda.id, estabelecimento_id=venda.estabelecimento_id,
                                                 produto_id=produto_id, tipo="saida").order_by(MovimentacaoEstoque.id).all()
    for saida in saidas:
        for lote_id, quantidade in _lotes_do_rastro(saida):
            consumidos[int(lote_id)] = consumidos.get(int(lote_id), Decimal("0")) + Decimal(str(quantidade))
    return consumidos


def _alocar_lotes(venda, produto_id, quantidade, lote_pedido, alocado_nesta):
    """Divide a quantidade pelos lotes que saíram na venda, respeitando o que já voltou."""
    rastro = _rastro_de_lotes(venda, produto_id)
    if not rastro:
        if lote_pedido:
            raise CrmErro("Esta venda não registrou lote para o produto; devolva sem informar o lote")
        return [(None, quantidade)]
    ja_devolvido = _devolvido_por_lote(venda.id, produto_id)
    livre = {lote: qtd - ja_devolvido.get(lote, Decimal("0")) - alocado_nesta.get((produto_id, lote), Decimal("0"))
             for lote, qtd in rastro.items()}
    if lote_pedido:
        lote_pedido = int(lote_pedido)
        if lote_pedido not in livre:
            raise CrmErro("O lote informado não saiu nesta venda")
        if livre[lote_pedido] < quantidade:
            raise CrmErro(f"Do lote informado restam {livre[lote_pedido].normalize():f} para devolver")
        return [(lote_pedido, quantidade)]
    partes, falta = [], quantidade
    for lote, disponivel in livre.items():
        if falta <= 0:
            break
        if disponivel <= 0:
            continue
        usar = min(disponivel, falta)
        partes.append((lote, usar))
        falta -= usar
    if falta > 0:
        # Venda legada: parte saiu sem rastro de lote.
        partes.append((None, falta))
    return partes


def _valor_rateado(venda, item, quantidade):
    """Valor líquido de ``quantidade`` do item, com o desconto da venda distribuído pelo subtotal."""
    qtd_item = Decimal(str(item.quantidade))
    unitario = Decimal(str(item.total_item or 0)) / qtd_item if qtd_item > 0 else Decimal("0")
    subtotal = Decimal(str(venda.subtotal or 0))
    fator = Decimal(str(venda.total or 0)) / subtotal if subtotal > 0 else Decimal("1")
    return _centavos(unitario * quantidade * fator), unitario * fator


def resumo_devolucoes_venda(venda):
    """O que ainda pode voltar, por item; usado pela tela de devolução."""
    devolvido = devolvido_por_item(venda.id)
    total_devolvido = db.session.query(func.coalesce(func.sum(DevolucaoVenda.valor_total), 0)).filter(
        DevolucaoVenda.venda_id == venda.id, DevolucaoVenda.tipo == "devolucao").scalar()
    em_aberto = db.session.query(func.coalesce(func.sum(ContaReceber.valor_atual), 0)).filter(
        ContaReceber.venda_id == venda.id, ContaReceber.estabelecimento_id == venda.estabelecimento_id,
        ContaReceber.status == "aberto").scalar()
    itens = []
    for item in venda.itens:
        ja = devolvido.get(item.id, Decimal("0"))
        restante = Decimal(str(item.quantidade)) - ja
        valor, unitario = _valor_rateado(venda, item, Decimal("1"))
        lotes = []
        if item.produto_id:
            rastro = _rastro_de_lotes(venda, item.produto_id)
            voltou = _devolvido_por_lote(venda.id, item.produto_id)
            for lote_id, qtd in rastro.items():
                lote = ProdutoLote.query.filter_by(id=lote_id, estabelecimento_id=venda.estabelecimento_id).first()
                lotes.append({"lote_id": lote_id, "numero_lote": lote.numero_lote if lote else None,
                              "data_validade": lote.data_validade.isoformat() if lote and lote.data_validade else None,
                              "saiu": float(qtd), "restante": float(qtd - voltou.get(lote_id, Decimal("0")))})
        itens.append({"venda_item_id": item.id, "produto_id": item.produto_id, "produto_nome": item.produto_nome,
                      "quantidade": float(item.quantidade), "devolvido": float(ja), "restante": float(restante),
                      "valor_unitario_liquido": float(_centavos(unitario)), "lotes": lotes})
    return {"venda_id": venda.id, "codigo": venda.codigo, "status": venda.status, "total": float(venda.total or 0),
            "valor_devolvido": float(total_devolvido or 0), "titulos_em_aberto": float(em_aberto or 0),
            "itens": itens}


def devolucao_dict(d):
    return {"id": d.id, "venda_id": d.venda_id, "chamado_id": d.chamado_id, "tipo": d.tipo, "motivo": d.motivo,
            "destino": d.destino, "forma_reembolso": d.forma_reembolso, "valor_total": float(d.valor_total),
            "custo_total": float(d.custo_total), "custo_reposicao": float(d.custo_reposicao),
            "funcionario_id": d.funcionario_id, "created_at": d.created_at.isoformat() if d.created_at else None,
            "itens": [{"venda_item_id": i.venda_item_id, "produto_id": i.produto_id, "lote_id": i.lote_id,
                       "quantidade": float(i.quantidade), "valor_total": float(i.valor_total),
                       "custo_unitario": float(i.custo_unitario)} for i in d.itens]}


def registrar_devolucao(ator, venda_id, dados):
    tipo = dados.get("tipo") or "devolucao"
    if tipo not in ("devolucao", "troca"):
        raise CrmErro("Tipo inválido: devolucao ou troca")
    destino = dados.get("destino") or "reintegrar"
    if destino not in ("reintegrar", "avaria"):
        raise CrmErro("Destino inválido: reintegrar ou avaria")
    forma = "troca" if tipo == "troca" else dados.get("forma_reembolso")
    if tipo == "devolucao" and forma not in FORMAS:
        raise CrmErro("Forma de reembolso inválida")
    motivo = (dados.get("motivo") or "").strip()
    if not motivo or len(motivo) > 255:
        raise CrmErro("Motivo é obrigatório (até 255 caracteres)")
    chave = (dados.get("idempotency_key") or "").strip()[:64] or None
    itens_pedidos = dados.get("itens")
    if not isinstance(itens_pedidos, list) or not itens_pedidos or len(itens_pedidos) > 200:
        raise CrmErro("Informe os itens devolvidos")

    if chave:
        anterior = DevolucaoVenda.query.filter_by(estabelecimento_id=ator.estabelecimento_id, idempotency_key=chave).first()
        if anterior:
            if anterior.venda_id != int(venda_id):
                raise Conflito("Chave de operação já usada em outra venda")
            return anterior, True

    venda = Venda.query.filter_by(id=int(venda_id), estabelecimento_id=ator.estabelecimento_id) \
        .populate_existing().with_for_update().first()
    if not venda:
        raise NaoEncontrado("Venda não encontrada")
    if venda.status != "finalizada":
        raise Conflito(f"Venda {venda.status} não aceita devolução")
    chamado = None
    if dados.get("chamado_id"):
        chamado = obter_chamado(ator, dados["chamado_id"])
        if chamado.cliente_id != venda.cliente_id or (chamado.venda_id and chamado.venda_id != venda.id):
            raise CrmErro("Chamado é de outro cliente ou de outra venda")

    itens_venda = {item.id: item for item in venda.itens}
    produto_ids = sorted({itens_venda[int(p.get("venda_item_id"))].produto_id
                          for p in itens_pedidos if int(p.get("venda_item_id") or 0) in itens_venda})
    # Mesma ordem de locks do checkout e do cancelamento: caixa, cliente e produtos.
    from app.utils.checkout_locking import lock_checkout
    lock_checkout(ator.estabelecimento_id, ator.id, [{"produto_id": pid} for pid in produto_ids] or [{"produto_id": 0}],
                  venda.cliente_id)

    ja_devolvido = devolvido_por_item(venda.id)
    devolucao = DevolucaoVenda(estabelecimento_id=ator.estabelecimento_id, venda_id=venda.id,
                               chamado_id=chamado.id if chamado else None, tipo=tipo, motivo=motivo, destino=destino,
                               forma_reembolso=forma, funcionario_id=ator.id, idempotency_key=chave)
    db.session.add(devolucao)
    db.session.flush()

    valor_total, custo_total, custo_reposicao = Decimal("0"), Decimal("0"), Decimal("0")
    alocado = {}
    nesta_por_item = {}
    for pedido in itens_pedidos:
        item = itens_venda.get(int(pedido.get("venda_item_id") or 0))
        if not item:
            raise CrmErro("Item não pertence a esta venda")
        quantidade = quantidade_valida(pedido.get("quantidade"))
        restante = Decimal(str(item.quantidade)) - ja_devolvido.get(item.id, Decimal("0")) - nesta_por_item.get(item.id, Decimal("0"))
        if quantidade > restante:
            raise CrmErro(f"{item.produto_nome}: restam {restante.normalize():f} para devolver")
        nesta_por_item[item.id] = nesta_por_item.get(item.id, Decimal("0")) + quantidade
        produto = Produto.query.filter_by(id=item.produto_id, estabelecimento_id=ator.estabelecimento_id).first()
        custo = Decimal(str(item.custo_unitario)) if item.custo_unitario is not None else (
            custo_historico(produto) if produto else Decimal("0"))
        valor_item, _ = _valor_rateado(venda, item, quantidade)
        controla = produto is not None and controla_estoque(produto)
        partes = _alocar_lotes(venda, item.produto_id, quantidade, pedido.get("lote_id"), alocado) if controla else [(None, quantidade)]
        for indice, (lote_id, qtd) in enumerate(partes):
            alocado[(item.produto_id, lote_id)] = alocado.get((item.produto_id, lote_id), Decimal("0")) + qtd
            # Ratear o valor entre lotes; o último fecha os centavos.
            valor_parte = valor_item - sum((_centavos(valor_item * q / quantidade) for _, q in partes[:indice]), Decimal("0")) \
                if indice == len(partes) - 1 else _centavos(valor_item * qtd / quantidade)
            db.session.add(DevolucaoVendaItem(
                estabelecimento_id=ator.estabelecimento_id, devolucao_id=devolucao.id, venda_item_id=item.id,
                produto_id=item.produto_id, lote_id=lote_id, quantidade=qtd,
                valor_unitario=_centavos(valor_item / quantidade), valor_total=valor_parte, custo_unitario=custo))
            if controla:
                _entrada_estoque(produto, lote_id, qtd, custo, venda, destino, ator, motivo)
        if tipo == "troca" and controla:
            _, custo_saida = registrar_saida(produto, quantidade, venda_id=None, funcionario_id=ator.id,
                                             motivo=f"Troca da venda #{venda.codigo}")
            custo_reposicao += _centavos(custo_saida * quantidade)
        valor_total += valor_item
        custo_total += _centavos(custo * quantidade)
        if produto and tipo == "devolucao":
            produto.quantidade_vendida = max(Decimal("0"), Decimal(str(produto.quantidade_vendida or 0)) - quantidade)
            produto.total_vendido = max(Decimal("0"), Decimal(str(produto.total_vendido or 0)) - valor_item)

    if tipo == "devolucao":
        valor_total = _limitar_ao_total_da_venda(venda, valor_total, devolucao)
        _reembolsar(ator, venda, devolucao, forma, valor_total)
        if venda.cliente_id:
            cliente = Cliente.query.filter_by(id=venda.cliente_id, estabelecimento_id=ator.estabelecimento_id).first()
            if cliente:
                cliente.valor_total_gasto = max(Decimal("0"), Decimal(str(cliente.valor_total_gasto or 0)) - valor_total)

    devolucao.valor_total = valor_total
    devolucao.custo_total = custo_total
    devolucao.custo_reposicao = custo_reposicao
    Auditoria.registrar(estabelecimento_id=ator.estabelecimento_id, tipo_evento=f"venda_{tipo}",
                        descricao=f"{tipo.capitalize()} na venda {venda.codigo}: {motivo}"[:500], usuario_id=ator.id,
                        valor=float(valor_total), detalhes={"devolucao_id": devolucao.id, "forma": forma, "destino": destino})
    return devolucao, False


def _entrada_estoque(produto, lote_id, quantidade, custo, venda, destino, ator, motivo):
    anterior = Decimal(str(produto.quantidade or 0))
    reintegra = destino == "reintegrar"
    if reintegra:
        produto.quantidade = anterior + quantidade
        if lote_id:
            lote = ProdutoLote.query.filter_by(id=lote_id, produto_id=produto.id,
                                               estabelecimento_id=produto.estabelecimento_id).with_for_update().first()
            if lote:
                lote.quantidade = Decimal(str(lote.quantidade or 0)) + quantidade
    # Avaria: a unidade voltou fisicamente, mas não é vendável; o movimento registra o fato sem alterar o saldo.
    db.session.add(MovimentacaoEstoque(
        estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id, venda_id=venda.id, lote_id=lote_id,
        funcionario_id=ator.id, tipo="devolucao" if reintegra else "devolucao_avaria", quantidade=quantidade,
        quantidade_anterior=anterior, quantidade_atual=produto.quantidade, custo_unitario=custo,
        valor_total=_centavos(custo * quantidade), motivo=f"Devolução da venda #{venda.codigo}"[:100],
        observacoes=json.dumps({"lote_id": lote_id, "destino": destino, "motivo": motivo[:200]})))


def _limitar_ao_total_da_venda(venda, valor, devolucao):
    anteriores = db.session.query(func.coalesce(func.sum(DevolucaoVenda.valor_total), 0)).filter(
        DevolucaoVenda.venda_id == venda.id, DevolucaoVenda.tipo == "devolucao", DevolucaoVenda.id != devolucao.id).scalar()
    restante = Decimal(str(venda.total or 0)) - Decimal(str(anteriores or 0))
    # A última devolução (tudo voltou) fecha os centavos do rateio do desconto.
    tudo = all(Decimal(str(i.quantidade)) <= devolvido_por_item_incluindo(venda.id, devolucao).get(i.id, Decimal("0"))
               for i in venda.itens)
    if tudo or valor > restante:
        return max(Decimal("0"), restante)
    return valor


def devolvido_por_item_incluindo(venda_id, devolucao):
    db.session.flush()
    return devolvido_por_item(venda_id)


def _reembolsar(ator, venda, devolucao, forma, valor):
    if valor <= 0:
        return
    abertos = ContaReceber.query.filter(ContaReceber.venda_id == venda.id,
                                        ContaReceber.estabelecimento_id == ator.estabelecimento_id,
                                        ContaReceber.status == "aberto", ContaReceber.valor_atual > 0) \
        .order_by(ContaReceber.data_vencimento.desc(), ContaReceber.id.desc()).populate_existing().with_for_update().all()
    em_aberto = sum((Decimal(str(c.valor_atual)) for c in abertos), Decimal("0"))
    if forma == "abater_titulo":
        if valor > em_aberto:
            raise CrmErro(f"Títulos em aberto da venda somam {_centavos(em_aberto)}; o restante deve ser reembolsado")
        falta = valor
        for conta in abertos:  # abate das últimas parcelas para as primeiras
            if falta <= 0:
                break
            abate = min(Decimal(str(conta.valor_atual)), falta)
            conta.valor_atual = Decimal(str(conta.valor_atual)) - abate
            conta.observacoes = f"{conta.observacoes or ''}\nAbatido {abate} pela devolução #{devolucao.id}".strip()
            if conta.valor_atual <= 0:
                conta.valor_atual = Decimal("0")
                conta.status = "cancelado"
            falta -= abate
        if venda.cliente_id:
            cliente = Cliente.query.filter_by(id=venda.cliente_id, estabelecimento_id=ator.estabelecimento_id).first()
            if cliente:
                cliente.saldo_devedor = max(Decimal("0"), Decimal(str(cliente.saldo_devedor or 0)) - valor)
        return
    # Reembolso em dinheiro só do que o cliente efetivamente pagou.
    anteriores = db.session.query(func.coalesce(func.sum(DevolucaoVenda.valor_total), 0)).filter(
        DevolucaoVenda.venda_id == venda.id, DevolucaoVenda.tipo == "devolucao", DevolucaoVenda.id != devolucao.id).scalar()
    pago = Decimal(str(venda.total or 0)) - Decimal(str(anteriores or 0)) - em_aberto
    if valor > pago:
        raise CrmErro(f"O cliente pagou {_centavos(max(pago, Decimal('0')))} desta venda; abata o restante dos títulos")
    if forma == "dinheiro":
        caixa = Caixa.query.filter_by(estabelecimento_id=ator.estabelecimento_id, funcionario_id=ator.id,
                                      status="aberto").order_by(Caixa.id.desc()).first()
        if not caixa:
            raise CrmErro("Abra o caixa para devolver em dinheiro")
        if Decimal(str(caixa.saldo_atual or 0)) < valor:
            raise CrmErro("Saldo da gaveta insuficiente para o reembolso")
        caixa.saldo_atual = Decimal(str(caixa.saldo_atual or 0)) - valor
        devolucao.caixa_id = caixa.id
        db.session.add(MovimentacaoCaixa(estabelecimento_id=ator.estabelecimento_id, caixa_id=caixa.id, tipo="sangria",
                                         valor=valor, forma_pagamento="dinheiro", venda_id=venda.id,
                                         descricao=f"Devolução #{devolucao.id} da venda {venda.codigo}"[:255]))


def ajustes_dre(estabelecimento_id, inicio_utc, fim_utc):
    """Devoluções do período (competência = data da devolução) para o DRE.

    ``devolucoes``: receita devolvida (só tipo devolucao). ``cmv_estornado``: custo do que voltou
    vendável. ``custo_trocas``: custo das unidades novas que saíram em troca (sem receita).
    """
    base = db.session.query(DevolucaoVenda).filter(DevolucaoVenda.created_at >= inicio_utc,
                                                   DevolucaoVenda.created_at <= fim_utc)
    if str(estabelecimento_id).lower() != "all":
        base = base.filter(DevolucaoVenda.estabelecimento_id == estabelecimento_id)
    devolucoes = cmv_estornado = custo_trocas = Decimal("0")
    for d in base.all():
        if d.tipo == "devolucao":
            devolucoes += Decimal(str(d.valor_total or 0))
        if d.destino == "reintegrar":
            cmv_estornado += Decimal(str(d.custo_total or 0))
        custo_trocas += Decimal(str(d.custo_reposicao or 0))
    return {"devolucoes": float(devolucoes), "cmv_estornado": float(cmv_estornado), "custo_trocas": float(custo_trocas)}
