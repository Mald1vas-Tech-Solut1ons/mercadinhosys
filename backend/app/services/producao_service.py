"""Regras da produção própria: custo padrão, capacidade e ciclo da ordem de produção.

Estoque só se move pelo caminho único: insumo sai por estoque_service.registrar_saida (FIFO dos
lotes, quarentena de vencido, reservas) e o acabado entra com lote, custo médio ponderado e
movimento, igual ao recebimento de compra. Nada aqui faz commit: a rota decide.
"""
import json
from datetime import timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from app.models import Produto, ProdutoLote, db
from app.models_producao import (
    PAPEIS_PRODUCAO, FichaTecnica, FichaTecnicaItem, OrdemProducao, OrdemProducaoItem,
)
from app.services import estoque_service
from app.utils.timezone import agora_local, hoje_local, now_utc

CENT = Decimal("0.01")
Q4 = Decimal("0.0001")
CEM = Decimal("100")


class ProducaoError(ValueError):
    """Erro de regra da produção (vira HTTP 400/409 na rota)."""

    def __init__(self, mensagem, faltas=None):
        super().__init__(mensagem)
        self.faltas = faltas or []


def _dec(valor, rotulo, minimo=Decimal("0"), permitir_zero=True):
    try:
        numero = Decimal(str(valor if valor not in (None, "") else 0).replace(",", "."))
    except Exception:
        raise ProducaoError(f"{rotulo} inválido") from None
    if not numero.is_finite() or numero < minimo or (not permitir_zero and numero == 0):
        raise ProducaoError(f"{rotulo} inválido")
    return numero


def _produto_da_loja(produto_id, estab_id, rotulo="Produto"):
    produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=estab_id).filter(
        Produto.deleted_at.is_(None)).first()
    if not produto:
        raise ProducaoError(f"{rotulo} não encontrado nesta loja")
    return produto


def definir_papel(produto, papel):
    papel = (papel or "revenda").strip().lower()
    if papel not in PAPEIS_PRODUCAO:
        raise ProducaoError("Papel inválido")
    produto.papel_producao = None if papel == "revenda" else papel


# ── Ficha técnica ─────────────────────────────────────────────────────────

def salvar_ficha(estab_id, dados, ficha=None):
    """Cria ou substitui a ficha (cabeçalho + itens). OPs já criadas guardam a própria cópia."""
    produto = _produto_da_loja(int(dados.get("produto_id") or (ficha.produto_id if ficha else 0)), estab_id)
    if ficha is None:
        if FichaTecnica.query.filter_by(estabelecimento_id=estab_id, produto_id=produto.id).first():
            raise ProducaoError(f"{produto.nome} já tem ficha técnica: edite a existente")
        ficha = FichaTecnica(estabelecimento_id=estab_id, produto_id=produto.id)
        db.session.add(ficha)
    ficha.rendimento = _dec(dados.get("rendimento"), "Rendimento", permitir_zero=False)
    ficha.minutos_mao_de_obra = _dec(dados.get("minutos_mao_de_obra"), "Minutos de mão de obra")
    ficha.custo_hora_mao_de_obra = _dec(dados.get("custo_hora_mao_de_obra"), "Custo/hora")
    ficha.custo_indireto_percentual = _dec(dados.get("custo_indireto_percentual"), "Custo indireto %")
    ficha.markup_percentual = _dec(dados.get("markup_percentual", 100), "Markup %")
    ficha.observacoes = (dados.get("observacoes") or None)
    ficha.ativa = bool(dados.get("ativa", True))

    itens = dados.get("itens") or []
    if not itens:
        raise ProducaoError("A ficha precisa de pelo menos um insumo")
    vistos = set()
    novos = []
    for bruto in itens:
        insumo = _produto_da_loja(int(bruto.get("insumo_id") or 0), estab_id, "Insumo")
        if insumo.id == produto.id:
            raise ProducaoError("O produto não pode ser insumo dele mesmo")
        if insumo.id in vistos:
            raise ProducaoError(f"{insumo.nome} aparece duas vezes na ficha")
        vistos.add(insumo.id)
        perda = _dec(bruto.get("perda_percentual"), f"Perda de {insumo.nome}")
        if perda >= CEM:
            raise ProducaoError(f"Perda de {insumo.nome} precisa ser menor que 100%")
        novos.append(FichaTecnicaItem(insumo_id=insumo.id,
                                      quantidade=_dec(bruto.get("quantidade"), f"Quantidade de {insumo.nome}",
                                                      permitir_zero=False),
                                      perda_percentual=perda))
    ficha.itens = novos
    if not produto.papel_producao or produto.papel_producao == "revenda":
        produto.papel_producao = "fabricado"
    return ficha


def _consumo_com_perda(quantidade, perda_percentual):
    return Decimal(str(quantidade)) * (1 + Decimal(str(perda_percentual or 0)) / CEM)


def custo_padrao(ficha):
    """Custo da receita pelo custo médio atual dos insumos, por unidade, e preço sugerido."""
    linhas = []
    material = Decimal("0")
    for item in ficha.itens:
        consumo = _consumo_com_perda(item.quantidade, item.perda_percentual)
        custo_insumo = Decimal(str(item.insumo.preco_custo or 0))
        total = consumo * custo_insumo
        material += total
        linhas.append({
            "insumo_id": item.insumo_id, "insumo_nome": item.insumo.nome,
            "unidade": item.insumo.unidade_medida or "UN",
            "quantidade": float(item.quantidade), "perda_percentual": float(item.perda_percentual or 0),
            "consumo_com_perda": float(consumo.quantize(Q4)), "custo_unitario_insumo": float(custo_insumo),
            "custo_total": float(total.quantize(CENT, rounding=ROUND_HALF_UP)),
        })
    mao_de_obra = Decimal(str(ficha.minutos_mao_de_obra or 0)) / 60 * Decimal(str(ficha.custo_hora_mao_de_obra or 0))
    indireto = (material + mao_de_obra) * Decimal(str(ficha.custo_indireto_percentual or 0)) / CEM
    total_receita = material + mao_de_obra + indireto
    rendimento = Decimal(str(ficha.rendimento))
    unitario = total_receita / rendimento
    preco = unitario * (1 + Decimal(str(ficha.markup_percentual or 0)) / CEM)
    preco_atual = Decimal(str(ficha.produto.preco_venda or 0))
    return {
        "itens": linhas,
        "material_receita": float(material.quantize(CENT, rounding=ROUND_HALF_UP)),
        "mao_de_obra_receita": float(mao_de_obra.quantize(CENT, rounding=ROUND_HALF_UP)),
        "indireto_receita": float(indireto.quantize(CENT, rounding=ROUND_HALF_UP)),
        "total_receita": float(total_receita.quantize(CENT, rounding=ROUND_HALF_UP)),
        "rendimento": float(rendimento),
        "custo_unitario": float(unitario.quantize(Q4, rounding=ROUND_HALF_UP)),
        "preco_sugerido": float(preco.quantize(CENT, rounding=ROUND_HALF_UP)),
        "preco_venda_atual": float(preco_atual),
        "margem_atual_percentual": (float(((preco_atual - unitario) / preco_atual * CEM).quantize(CENT))
                                    if preco_atual > 0 else None),
    }


def _disponivel(insumo):
    """Saldo utilizável do insumo: estoque - vencido em quarentena - reservado."""
    return (Decimal(str(insumo.quantidade or 0)) - estoque_service.quantidade_em_quarentena(insumo)
            - estoque_service.reservado_no_produto(insumo))


def capacidade(ficha):
    """Quantas unidades dá para fazer com o insumo que há, e qual insumo é o gargalo."""
    rendimento = Decimal(str(ficha.rendimento))
    melhor, gargalo = None, None
    for item in ficha.itens:
        por_unidade = _consumo_com_perda(item.quantidade, item.perda_percentual) / rendimento
        if por_unidade <= 0:
            continue
        possivel = (max(_disponivel(item.insumo), Decimal("0")) / por_unidade).to_integral_value(rounding=ROUND_DOWN)
        if melhor is None or possivel < melhor:
            melhor, gargalo = possivel, item.insumo
    return {"unidades": int(melhor or 0), "gargalo_id": gargalo.id if gargalo else None,
            "gargalo_nome": gargalo.nome if gargalo else None}


# ── Ordem de produção ─────────────────────────────────────────────────────

def _proximo_numero(estab_id):
    prefixo = f"OP-{agora_local().strftime('%Y%m%d')}-"
    existentes = OrdemProducao.query.filter(OrdemProducao.estabelecimento_id == estab_id,
                                            OrdemProducao.numero.like(prefixo + "%")).count()
    seq = existentes + 1
    while OrdemProducao.query.filter_by(estabelecimento_id=estab_id, numero=f"{prefixo}{seq:03d}").first():
        seq += 1
    return f"{prefixo}{seq:03d}"


def criar_ordem(estab_id, ficha, quantidade, funcionario_id, observacoes=None):
    if not ficha.ativa:
        raise ProducaoError("Ficha técnica inativa")
    quantidade = _dec(quantidade, "Quantidade a produzir", permitir_zero=False)
    rendimento = Decimal(str(ficha.rendimento))
    padrao = custo_padrao(ficha)
    fator = quantidade / rendimento
    op = OrdemProducao(
        estabelecimento_id=estab_id, numero=_proximo_numero(estab_id), ficha_id=ficha.id,
        produto_id=ficha.produto_id, status="planejada", quantidade_planejada=quantidade,
        rendimento_ficha=rendimento,
        minutos_mao_de_obra=(Decimal(str(ficha.minutos_mao_de_obra or 0)) * fator).quantize(CENT),
        custo_hora_mao_de_obra=ficha.custo_hora_mao_de_obra or 0,
        custo_indireto_percentual=ficha.custo_indireto_percentual or 0,
        custo_unitario_padrao=Decimal(str(padrao["custo_unitario"])),
        funcionario_id=funcionario_id, observacoes=observacoes or None,
    )
    op.itens = [OrdemProducaoItem(insumo_id=item.insumo_id,
                                  quantidade_prevista=(_consumo_com_perda(item.quantidade, item.perda_percentual)
                                                       * fator).quantize(Q4, rounding=ROUND_HALF_UP))
                for item in ficha.itens]
    db.session.add(op)
    return op


def faltas_da_ordem(op):
    faltas = []
    for item in op.itens:
        disponivel = _disponivel(item.insumo)
        precisa = Decimal(str(item.quantidade_prevista))
        if disponivel < precisa:
            faltas.append({"insumo_id": item.insumo_id, "insumo_nome": item.insumo.nome,
                           "unidade": item.insumo.unidade_medida or "UN",
                           "precisa": float(precisa), "disponivel": float(max(disponivel, Decimal("0"))),
                           "falta": float((precisa - max(disponivel, Decimal("0"))).quantize(Q4))})
    return faltas


def iniciar_ordem(op):
    if op.status != "planejada":
        raise ProducaoError("Só uma ordem planejada pode ser iniciada")
    faltas = faltas_da_ordem(op)
    if faltas:
        raise ProducaoError("Insumo insuficiente para esta ordem", faltas=faltas)
    op.status = "em_producao"
    op.data_inicio = now_utc()


def encerrar_ordem(op, dados, funcionario_id):
    """Baixa os insumos, dá entrada no acabado com lote e custo real. Tudo ou nada (a rota faz commit)."""
    if op.status not in ("planejada", "em_producao"):
        raise ProducaoError("Esta ordem já foi encerrada ou cancelada")
    boa = _dec(dados.get("quantidade_produzida"), "Quantidade produzida (boa)")
    refugo = _dec(dados.get("quantidade_refugo"), "Refugo")
    if boa == 0 and refugo == 0:
        raise ProducaoError("Informe a quantidade produzida ou o refugo")
    if refugo > 0 and not (dados.get("motivo_refugo") or "").strip():
        raise ProducaoError("Informe o motivo do refugo (bolha, rachadura, quebra...)")

    consumo_real = {int(c.get("insumo_id")): c.get("quantidade")
                    for c in (dados.get("consumo") or []) if c.get("insumo_id") is not None}
    motivo = f"Consumo {op.numero}"[:100]
    material = Decimal("0")
    lotes_insumo = []
    for item in op.itens:
        insumo = Produto.query.filter_by(id=item.insumo_id, estabelecimento_id=op.estabelecimento_id) \
            .populate_existing().with_for_update().first()
        quantidade = (_dec(consumo_real[item.insumo_id], f"Consumo de {insumo.nome}")
                      if item.insumo_id in consumo_real else Decimal(str(item.quantidade_prevista)))
        if quantidade == 0:
            item.quantidade_consumida, item.custo_unitario = Decimal("0"), Decimal(str(insumo.preco_custo or 0))
            continue
        try:
            movimento, custo = estoque_service.registrar_saida(
                insumo, quantidade, venda_id=None, funcionario_id=funcionario_id, motivo=motivo)
        except estoque_service.EstoqueIndisponivelError as erro:
            raise ProducaoError(f"Insumo insuficiente: {insumo.nome}",
                                faltas=[{"insumo_id": insumo.id, "insumo_nome": insumo.nome,
                                         "precisa": float(quantidade)}]) from erro
        except estoque_service.ProdutoVencidoError as erro:
            raise ProducaoError(f"{insumo.nome} está vencido: não pode entrar na produção") from erro
        item.quantidade_consumida = quantidade
        item.custo_unitario = custo
        material += custo * quantidade
        if movimento is not None:
            db.session.flush()
            item.movimentacao_id = movimento.id
            lotes_insumo.append({"insumo_id": insumo.id, "rastro": json.loads(movimento.observacoes or "{}")})

    mao_de_obra = Decimal(str(op.minutos_mao_de_obra or 0)) / 60 * Decimal(str(op.custo_hora_mao_de_obra or 0))
    indireto = (material + mao_de_obra) * Decimal(str(op.custo_indireto_percentual or 0)) / CEM
    op.custo_material_real = material.quantize(Q4)
    op.custo_mao_de_obra_real = mao_de_obra.quantize(Q4)
    op.custo_indireto_real = indireto.quantize(Q4)
    op.quantidade_produzida = boa
    op.quantidade_refugo = refugo
    op.motivo_refugo = (dados.get("motivo_refugo") or "").strip()[:200] or None

    if boa > 0:
        # O refugo não vira estoque: o custo dele recai sobre as peças boas (custo real).
        unitario = ((material + mao_de_obra + indireto) / boa).quantize(Q4, rounding=ROUND_HALF_UP)
        op.custo_unitario_real = unitario
        produto = Produto.query.filter_by(id=op.produto_id, estabelecimento_id=op.estabelecimento_id) \
            .populate_existing().with_for_update().first()
        validade = dados.get("data_validade")
        if validade:
            from datetime import datetime
            validade = datetime.strptime(str(validade)[:10], "%Y-%m-%d").date()
        elif produto.controlar_validade:
            raise ProducaoError(f"Informe a validade do lote de {produto.nome}")
        else:
            validade = hoje_local() + timedelta(days=365 * 5)
        numero_lote = op.numero
        if ProdutoLote.query.filter_by(estabelecimento_id=op.estabelecimento_id, numero_lote=numero_lote).first():
            numero_lote = f"{op.numero}-{op.id}"
        lote = ProdutoLote(estabelecimento_id=op.estabelecimento_id, produto_id=produto.id,
                           numero_lote=numero_lote[:50], quantidade=boa, quantidade_inicial=boa,
                           data_fabricacao=hoje_local(), data_validade=validade, data_entrada=hoje_local(),
                           preco_custo_unitario=unitario, ativo=True)
        db.session.add(lote)
        produto.recalcular_preco_custo_ponderado(quantidade_entrada=boa, custo_unitario_entrada=unitario,
                                                 funcionario_id=funcionario_id, motivo=f"Produção {op.numero}")
        db.session.flush()
        movimento = produto.movimentar_estoque(quantidade=boa, tipo="entrada",
                                               motivo=f"Produção {op.numero}"[:100], usuario_id=funcionario_id)
        movimento.lote_id = lote.id
        movimento.custo_unitario = unitario
        movimento.valor_total = (unitario * boa).quantize(CENT, rounding=ROUND_HALF_UP)
        # Rastreabilidade: o lote do acabado aponta para os lotes de insumo consumidos.
        movimento.observacoes = json.dumps({"ordem_producao_id": op.id, "insumos": lotes_insumo})
        db.session.add(movimento)
        db.session.flush()
        op.lote_id = lote.id
    op.status = "encerrada"
    op.data_encerramento = now_utc()
    return op


def cancelar_ordem(op):
    if op.status not in ("planejada", "em_producao"):
        raise ProducaoError("Ordem encerrada não pode ser cancelada: o estoque já foi movimentado "
                            "(corrija por ajuste/descarte de estoque)")
    op.status = "cancelada"


def necessidade_insumos(estab_id):
    """O que comprar para cumprir as ordens abertas (planejadas + em produção).

    Necessidade líquida por insumo = soma do previsto nas OPs abertas - saldo utilizável
    (estoque - vencido - reservado) - o que já está pedido ao fornecedor e não chegou.
    """
    from collections import defaultdict
    from app.models import PedidoCompra, PedidoCompraItem
    abertas = OrdemProducao.query.filter(OrdemProducao.estabelecimento_id == estab_id,
                                         OrdemProducao.status.in_(("planejada", "em_producao"))).all()
    previsto = defaultdict(Decimal)
    ordens_por_insumo = defaultdict(list)
    for op in abertas:
        for item in op.itens:
            previsto[item.insumo_id] += Decimal(str(item.quantidade_prevista))
            ordens_por_insumo[item.insumo_id].append(op.numero)
    if not previsto:
        return []
    a_caminho = defaultdict(Decimal)
    pendentes = db.session.query(PedidoCompraItem).join(PedidoCompra, PedidoCompraItem.pedido_id == PedidoCompra.id).filter(
        PedidoCompra.estabelecimento_id == estab_id,
        PedidoCompra.status.in_(("pendente", "parcial", "aprovado", "enviado")),
        PedidoCompraItem.produto_id.in_(list(previsto))).all()
    for item in pendentes:
        saldo = (Decimal(str(item.quantidade_solicitada or 0)) - Decimal(str(item.quantidade_recebida or 0))
                 - Decimal(str(item.quantidade_faltante or 0)))
        if saldo > 0:
            a_caminho[item.produto_id] += saldo
    linhas = []
    for insumo_id, precisa in previsto.items():
        insumo = Produto.query.filter_by(id=insumo_id, estabelecimento_id=estab_id).first()
        if not insumo:
            continue
        disponivel = max(_disponivel(insumo), Decimal("0"))
        comprar = precisa - disponivel - a_caminho[insumo_id]
        linhas.append({
            "insumo_id": insumo.id, "insumo_nome": insumo.nome, "unidade": insumo.unidade_medida or "UN",
            "previsto_ordens": float(precisa.quantize(Q4)), "disponivel": float(disponivel),
            "a_caminho": float(a_caminho[insumo_id]), "comprar": float(max(comprar, Decimal("0")).quantize(Q4)),
            "custo_estimado": float((max(comprar, Decimal("0")) * Decimal(str(insumo.preco_custo or 0))).quantize(CENT)),
            "ordens": sorted(set(ordens_por_insumo[insumo_id])),
        })
    return sorted(linhas, key=lambda x: (-x["comprar"], x["insumo_nome"]))


# ── Serialização ──────────────────────────────────────────────────────────

def _f(valor):
    return float(valor) if valor is not None else None


def ficha_dict(ficha, com_custo=True):
    dados = {
        "id": ficha.id, "produto_id": ficha.produto_id, "produto_nome": ficha.produto.nome,
        "unidade_produto": ficha.produto.unidade_medida or "UN",
        "rendimento": _f(ficha.rendimento), "minutos_mao_de_obra": _f(ficha.minutos_mao_de_obra),
        "custo_hora_mao_de_obra": _f(ficha.custo_hora_mao_de_obra),
        "custo_indireto_percentual": _f(ficha.custo_indireto_percentual),
        "markup_percentual": _f(ficha.markup_percentual), "observacoes": ficha.observacoes, "ativa": ficha.ativa,
        "itens": [{"insumo_id": i.insumo_id, "insumo_nome": i.insumo.nome,
                   "unidade": i.insumo.unidade_medida or "UN", "quantidade": _f(i.quantidade),
                   "perda_percentual": _f(i.perda_percentual)} for i in ficha.itens],
    }
    if com_custo:
        dados["custo"] = custo_padrao(ficha)
        dados["capacidade"] = capacidade(ficha)
    return dados


def ordem_dict(op):
    from app.utils.timezone import iso_utc
    return {
        "id": op.id, "numero": op.numero, "status": op.status, "ficha_id": op.ficha_id,
        "produto_id": op.produto_id, "produto_nome": op.produto.nome,
        "quantidade_planejada": _f(op.quantidade_planejada), "quantidade_produzida": _f(op.quantidade_produzida),
        "quantidade_refugo": _f(op.quantidade_refugo), "motivo_refugo": op.motivo_refugo,
        "custo_unitario_padrao": _f(op.custo_unitario_padrao), "custo_unitario_real": _f(op.custo_unitario_real),
        "custo_material_real": _f(op.custo_material_real), "custo_mao_de_obra_real": _f(op.custo_mao_de_obra_real),
        "custo_indireto_real": _f(op.custo_indireto_real), "lote_id": op.lote_id,
        "observacoes": op.observacoes, "criada_em": iso_utc(op.created_at),
        "data_inicio": iso_utc(op.data_inicio), "data_encerramento": iso_utc(op.data_encerramento),
        "itens": [{"insumo_id": i.insumo_id, "insumo_nome": i.insumo.nome, "unidade": i.insumo.unidade_medida or "UN",
                   "quantidade_prevista": _f(i.quantidade_prevista), "quantidade_consumida": _f(i.quantidade_consumida),
                   "custo_unitario": _f(i.custo_unitario)} for i in op.itens],
    }
