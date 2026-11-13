"""Venda por dose: garrafa aberta e razão de ml.

A garrafa (ou barril) continua sendo a unidade de estoque; a dose é um jeito de vendê-la.
- A 1ª dose abre uma garrafa: sai 1 unidade do estoque pelo caminho único (``estoque_service.registrar_saida``:
  FEFO, quarentena, reserva, rastro de lote) e nasce um saldo em ml.
- As doses seguintes consomem o saldo; dose maior que o saldo atravessa para a próxima garrafa.
- Todo ml tem destino no razão ``dose_movimentos``; ``garrafa.saldo_ml == soma(ml)`` (ver ``ledger_confere``).
- A abertura é uma saída SEM ``venda_id`` e marcada ``abertura_dose``: cancelar a venda devolve ml à garrafa,
  nunca uma garrafa inteira ao estoque (a garrafa física continua aberta no balcão).

Nada aqui faz commit e nada aqui vê a loja pelo contexto da requisição: tudo filtra por ``estabelecimento_id``.
O chamador abre a transação e bloqueia o produto (``with_for_update``) antes, como no checkout.
"""
import json
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP

from sqlalchemy import func

from app.models import Produto, db
from app.models_dose import DoseMovimento, GarrafaAberta, ProdutoDose, TIPOS_BAIXA_MANUAL
from app.services import estoque_service
from app.utils.timezone import hoje_local, now_utc

ML = Decimal("0.01")
QB = Decimal("0.000001")
Q4 = Decimal("0.0001")
ZERO = Decimal("0")
MOTIVO_ABERTURA = "Abertura de garrafa (dose)"


class DoseError(ValueError):
    """Erro de regra da venda por dose (vira HTTP 400/409 na rota)."""


class DoseNaoAutorizada(DoseError):
    """Dose com ml livre sem a autorização da loja (cargo ou PIN de gerente): `resposta` já é a resposta HTTP."""

    def __init__(self, resposta):
        corpo = resposta[0].get_json() if isinstance(resposta, tuple) else {}
        super().__init__((corpo or {}).get("error") or "Dose com ml livre exige autorização")
        self.resposta = resposta


class DoseIndisponivelError(DoseError):
    """Não há ml suficiente (garrafa aberta + garrafas fechadas vendáveis)."""

    def __init__(self, produto, solicitado_ml, disponivel_ml):
        self.produto_id = produto.id
        self.solicitado_ml = solicitado_ml
        self.disponivel_ml = disponivel_ml
        super().__init__(
            f"Estoque insuficiente para {produto.nome}: restam {_fmt(disponivel_ml)} ml, "
            f"solicitado {_fmt(solicitado_ml)} ml")


@dataclass
class ResultadoDose:
    """O que a venda de doses consumiu: alimenta o VendaItem (custo, ml, qtd na unidade de estoque)."""
    ml_total: Decimal
    qtd_base: Decimal
    custo_total: Decimal
    custo_por_dose: Decimal
    movimentos: list = field(default_factory=list)       # DoseMovimento tipo 'venda'
    garrafas_abertas: list = field(default_factory=list)  # garrafas abertas por esta venda


def _fmt(valor) -> str:
    return f"{Decimal(str(valor)).normalize():f}"


def _ml(valor, rotulo="Volume") -> Decimal:
    try:
        numero = Decimal(str(valor if valor is not None else "").replace(",", "."))
    except (InvalidOperation, ValueError):
        raise DoseError(f"{rotulo} inválido") from None
    if not numero.is_finite() or numero <= 0 or numero > Decimal("1000000"):
        raise DoseError(f"{rotulo} inválido")
    numero = numero.quantize(ML, rounding=ROUND_HALF_UP)
    if numero <= 0:
        raise DoseError(f"{rotulo} inválido")
    return numero


def _d(valor) -> Decimal:
    return Decimal(str(valor or 0))


def volume_da_garrafa(produto) -> Decimal:
    """ml que cada unidade de estoque rende; sem isso o produto não vende por dose."""
    if not produto.vende_por_dose:
        raise DoseError(f"{produto.nome} não está configurado para venda por dose")
    if not produto.volume_embalagem_ml or _d(produto.volume_embalagem_ml) <= 0:
        raise DoseError(f"Informe o volume da garrafa de {produto.nome} para vender por dose")
    return _d(produto.volume_embalagem_ml).quantize(ML, rounding=ROUND_HALF_UP)


def _dose_valida(produto, dose) -> ProdutoDose:
    if dose is None or dose.produto_id != produto.id or dose.estabelecimento_id != produto.estabelecimento_id:
        raise DoseError("Dose não pertence a este produto")
    if not dose.ativa:
        raise DoseError(f"A dose {dose.nome} está desativada")
    return dose


def _bloquear(produto):
    """Mesma trava do checkout, por segurança quando o chamador não travou: serializa abertura de garrafa."""
    db.session.query(Produto.id).filter(
        Produto.id == produto.id, Produto.estabelecimento_id == produto.estabelecimento_id).with_for_update().first()


def _garrafas_do_produto(produto, status="aberta", travar=True):
    consulta = GarrafaAberta.query.filter_by(
        estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id, status=status
    ).order_by(GarrafaAberta.aberta_em.asc(), GarrafaAberta.id.asc())
    return consulta.with_for_update().all() if travar else consulta.all()


def _usavel(garrafa, hoje) -> bool:
    """Garrafa aberta vencida (validade pós-abertura) não serve mais: fica para o descarte."""
    return garrafa.validade_aberta is None or garrafa.validade_aberta >= hoje


def garrafas_vendaveis(produto, travar=True):
    hoje = hoje_local()
    return [g for g in _garrafas_do_produto(produto, "aberta", travar) if _usavel(g, hoje) and _d(g.saldo_ml) > 0]


def saldo_aberto_ml(produto) -> Decimal:
    """ml disponíveis nas garrafas abertas e dentro da validade."""
    return sum((_d(g.saldo_ml) for g in garrafas_vendaveis(produto, travar=False)), ZERO)


def _registrar(garrafa, tipo, ml, *, funcionario_id, motivo=None, dose_id=None, venda_id=None,
               estorno_de=None, data=None) -> DoseMovimento:
    custo = (abs(_d(ml)) * garrafa.custo_por_ml).quantize(Q4, rounding=ROUND_HALF_UP)
    mov = DoseMovimento(
        estabelecimento_id=garrafa.estabelecimento_id, garrafa_id=garrafa.id, produto_id=garrafa.produto_id,
        tipo=tipo, ml=ml, custo=custo, dose_id=dose_id, venda_id=venda_id,
        estorno_de_id=estorno_de.id if estorno_de is not None else None,
        funcionario_id=funcionario_id, motivo=(motivo or "")[:120] or None)
    if data is not None:
        mov.created_at = data
    db.session.add(mov)
    return mov


def abrir_garrafa(produto, *, funcionario_id, venda_id=None, data=None, permitir_sem_estoque=False) -> GarrafaAberta:
    """Tira 1 unidade do estoque e cria o saldo em ml. Lança os mesmos erros de estoque de uma venda."""
    volume = volume_da_garrafa(produto)
    movimento, custo = estoque_service.registrar_saida(
        produto, 1, venda_id=None, funcionario_id=funcionario_id, motivo=MOTIVO_ABERTURA, data=data,
        permitir_sem_estoque=permitir_sem_estoque)
    if movimento is None:
        raise DoseError(f"{produto.nome} não controla estoque: não dá para abrir garrafa")
    agora = data or now_utc()
    rastro = json.loads(movimento.observacoes or "{}")
    lote_id = movimento.lote_id
    garrafa = GarrafaAberta(
        estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id, lote_id=lote_id,
        venda_origem_id=venda_id, volume_inicial_ml=volume, saldo_ml=volume,
        custo_garrafa=_d(custo).quantize(Q4, rounding=ROUND_HALF_UP), status="aberta", aberta_em=agora,
        aberta_por_id=funcionario_id,
        validade_aberta=(hoje_local() + timedelta(days=int(produto.validade_aberta_dias))
                         if produto.validade_aberta_dias else None))
    db.session.add(garrafa)
    db.session.flush()
    rastro.update({"abertura_dose": True, "garrafa_aberta_id": garrafa.id})
    movimento.observacoes = json.dumps(rastro)
    garrafa.movimento_abertura_id = movimento.id
    _registrar(garrafa, "abertura", volume, funcionario_id=funcionario_id, motivo=MOTIVO_ABERTURA, data=agora)
    return garrafa


def _capacidade_ml(produto, permitir_sem_estoque) -> Decimal:
    """ml que ainda dá para tirar: saldo aberto + garrafas fechadas vendáveis (sem quarentena nem reserva)."""
    aberto = saldo_aberto_ml(produto)
    if permitir_sem_estoque:
        return Decimal("Infinity")
    fechadas = (_d(produto.quantidade) - estoque_service.quantidade_em_quarentena(produto)
                - estoque_service.reservado_no_produto(produto))
    return aberto + max(fechadas, ZERO) * volume_da_garrafa(produto)


def _consumir(produto, ml_total, tipo, *, funcionario_id, dose_id=None, venda_id=None, motivo=None,
              data=None, permitir_sem_estoque=False):
    """Tira `ml_total` das garrafas abertas (a mais antiga primeiro), abrindo outras quando faltar.

    Devolve ``(movimentos, abertas_agora, custo_total, qtd_base)``. Tudo-ou-nada: a checagem de
    capacidade vem antes de qualquer abertura.
    """
    ml_total = _ml(ml_total, "Volume")
    volume_da_garrafa(produto)
    _bloquear(produto)
    capacidade = _capacidade_ml(produto, permitir_sem_estoque)
    if ml_total > capacidade:
        raise DoseIndisponivelError(produto, ml_total, capacidade)

    restante = ml_total
    movimentos, abertas, custo_total, qtd_base = [], [], ZERO, ZERO
    fila = list(garrafas_vendaveis(produto))
    while restante > 0:
        if not fila:
            nova = abrir_garrafa(produto, funcionario_id=funcionario_id, venda_id=venda_id, data=data,
                                 permitir_sem_estoque=permitir_sem_estoque)
            abertas.append(nova)
            fila.append(nova)
        garrafa = fila[0]
        tirar = min(_d(garrafa.saldo_ml), restante)
        mov = _registrar(garrafa, tipo, -tirar, funcionario_id=funcionario_id, motivo=motivo,
                         dose_id=dose_id, venda_id=venda_id, data=data)
        garrafa.saldo_ml = _d(garrafa.saldo_ml) - tirar
        custo_total += _d(mov.custo)
        qtd_base += tirar / _d(garrafa.volume_inicial_ml)
        movimentos.append(mov)
        restante -= tirar
        if _d(garrafa.saldo_ml) <= 0:
            garrafa.status = "vazia"
            garrafa.encerrada_em = data or now_utc()
            garrafa.encerrada_por_id = funcionario_id
            fila.pop(0)
    return movimentos, abertas, custo_total, qtd_base.quantize(QB, rounding=ROUND_HALF_UP)


def vender_dose(produto, dose, quantidade, *, venda_id, funcionario_id, data=None,
                permitir_sem_estoque=False) -> ResultadoDose:
    """Consome `quantidade` doses. O chamador grava o VendaItem com o que voltar aqui."""
    dose = _dose_valida(produto, dose)
    try:
        doses = Decimal(str(quantidade))
    except (InvalidOperation, ValueError):
        raise DoseError("Quantidade de doses inválida") from None
    if not doses.is_finite() or doses <= 0 or doses > Decimal("9999"):
        raise DoseError("Quantidade de doses inválida")
    if _d(dose.volume_ml) > volume_da_garrafa(produto):
        # Garrafa trocada por uma menor depois de configurar, ou ml digitado errado no caixa.
        raise DoseError(f"A dose ({_fmt(dose.volume_ml)} ml) é maior que a garrafa de {produto.nome} "
                        f"({_fmt(volume_da_garrafa(produto))} ml)")
    ml_total = (_d(dose.volume_ml) * doses).quantize(ML, rounding=ROUND_HALF_UP)
    movimentos, abertas, custo_total, qtd_base = _consumir(
        produto, ml_total, "venda", funcionario_id=funcionario_id, dose_id=dose.id, venda_id=venda_id,
        data=data, permitir_sem_estoque=permitir_sem_estoque)
    return ResultadoDose(
        ml_total=ml_total, qtd_base=qtd_base, custo_total=custo_total.quantize(Q4, rounding=ROUND_HALF_UP),
        custo_por_dose=(custo_total / doses).quantize(Q4, rounding=ROUND_HALF_UP),
        movimentos=movimentos, garrafas_abertas=abertas)


@dataclass
class ItemDose:
    """Item de venda por dose já baixado: o que o VendaItem grava a mais e o custo por dose."""
    dose: ProdutoDose
    resultado: ResultadoDose
    custo_unitario: Decimal           # custo de UMA dose (VendaItem.custo_unitario x quantidade = CMV)
    colunas: dict                     # dose_id, dose_nome, dose_volume_ml, ml_total, qtd_base, produto_unidade


def dose_do_item(produto, item) -> "ProdutoDose | None":
    """A dose citada no item do carrinho (`dose_id`), da loja do produto; item sem `dose_id` não é de dose."""
    bruto = item.get("dose_id")
    if bruto in (None, "", 0, "0"):
        return None
    try:
        dose_id = int(bruto)
    except (TypeError, ValueError):
        raise DoseError("Dose inválida") from None
    dose = ProdutoDose.query.filter_by(id=dose_id, estabelecimento_id=produto.estabelecimento_id).first()
    return _dose_valida(produto, dose)


def ml_livre_do_item(item):
    """ml digitados no caixa (`dose_ml`), fora da tabela de doses do produto; None quando o item não é de dose livre."""
    bruto = item.get("dose_ml")
    if bruto in (None, "", 0, "0"):
        return None
    return _ml(bruto, "ml da dose")


def _dose_livre(produto, ml):
    """Dose avulsa só para esta venda: não é gravada (o retrato dela vai no item da venda)."""
    return ProdutoDose(estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id,
                       nome="Dose livre", volume_ml=ml, preco_venda=ZERO, ativa=True)


def preco_referencia_livre(produto, ml) -> Decimal:
    """Preço de UMA dose livre de `ml`: R$/ml da dose padrão do produto (ou da garrafa, sem doses) x ml."""
    doses = [d for d in ProdutoDose.query.filter_by(
        estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id, ativa=True)
        .order_by(ProdutoDose.padrao.desc(), ProdutoDose.ordem, ProdutoDose.id).all() if _d(d.volume_ml) > 0]
    if doses:
        por_ml = _d(doses[0].preco_venda) / _d(doses[0].volume_ml)
    else:
        por_ml = _d(produto.preco_venda) / volume_da_garrafa(produto)
    return (por_ml * _d(ml)).quantize(Q4, rounding=ROUND_HALF_UP)


def baixar_item(produto, item, *, venda_id, funcionario_id, data=None, permitir_sem_estoque=False):
    """Ponto único das rotas de venda: item com `dose_id` (ou `dose_ml`, livre) baixa ml; sem nenhum, devolve None.

    Dose livre exige a autorização da loja (política `doses.livre`: PIN de gerente para quem não é gerente).
    """
    dose = dose_do_item(produto, item)
    ml_livre = ml_livre_do_item(item)
    if dose is not None and ml_livre is not None:
        raise DoseError("Item com dose cadastrada e ml livre ao mesmo tempo")
    if dose is None and ml_livre is None:
        return None
    if ml_livre is not None:
        from app.services.politica_acoes import verificar_acao
        recusa = verificar_acao("doses.livre")
        if recusa is not None:
            raise DoseNaoAutorizada(recusa)
        dose = _dose_livre(produto, ml_livre)
    quantidade = item.get("quantity", item.get("quantidade", 1))
    resultado = vender_dose(produto, dose, quantidade, venda_id=venda_id, funcionario_id=funcionario_id,
                            data=data, permitir_sem_estoque=permitir_sem_estoque)
    return ItemDose(
        dose=dose, resultado=resultado, custo_unitario=resultado.custo_por_dose,
        colunas={"dose_id": dose.id, "dose_nome": dose.nome, "dose_volume_ml": dose.volume_ml,
                 "ml_total": resultado.ml_total, "qtd_base": resultado.qtd_base, "produto_unidade": "DOSE"})


def vincular_item(resultado, venda_item):
    """Liga os movimentos da venda ao VendaItem (depois do flush do item) para estorno e auditoria por item."""
    for mov in resultado.movimentos:
        mov.venda_item_id = venda_item.id


def estornar_doses_venda(venda_id, estabelecimento_id, *, funcionario_id, motivo, data=None, produtos_perda=None):
    """Cancelamento de venda: devolve os ml à garrafa de origem, uma única vez por movimento.

    Garrafa vazia reabre; garrafa já descartada recebe o ml de volta e descarta de novo (o ml não
    reaparece no balcão, o custo dele fica no descarte). Não mexe no estoque em unidades.
    ``produtos_perda``: a dose já foi servida e não volta (cliente devolveu o copo): o ml é estornado e
    baixado como perda no mesmo ato, e o custo dele fica registrado como perda.
    Retorna a lista de movimentos de estorno; sem doses na venda, lista vazia.
    """
    perda = {int(p) for p in (produtos_perda or [])}
    vendas = DoseMovimento.query.filter_by(
        estabelecimento_id=estabelecimento_id, venda_id=venda_id, tipo="venda").order_by(DoseMovimento.id).all()
    if not vendas:
        return []
    ja = {m.estorno_de_id for m in DoseMovimento.query.filter_by(
        estabelecimento_id=estabelecimento_id, venda_id=venda_id, tipo="estorno").all()}
    pendentes = [m for m in vendas if m.id not in ja]
    if not pendentes:
        raise DoseError("As doses desta venda já foram estornadas")
    criados = []
    for original in pendentes:
        garrafa = GarrafaAberta.query.filter_by(
            id=original.garrafa_id, estabelecimento_id=estabelecimento_id).with_for_update().first()
        if garrafa is None:
            continue
        ml = abs(_d(original.ml))
        criados.append(_registrar(garrafa, "estorno", ml, funcionario_id=funcionario_id, motivo=motivo,
                                  dose_id=original.dose_id, venda_id=venda_id, estorno_de=original, data=data))
        garrafa.saldo_ml = _d(garrafa.saldo_ml) + ml
        if garrafa.status == "descartada":
            criados.append(_registrar(garrafa, "descarte", -ml, funcionario_id=funcionario_id,
                                      motivo="Estorno em garrafa já descartada", data=data))
            garrafa.saldo_ml = _d(garrafa.saldo_ml) - ml
        elif original.produto_id in perda:
            criados.append(_registrar(garrafa, "perda", -ml, funcionario_id=funcionario_id,
                                      motivo="Cancelamento: dose não voltou ao balcão", data=data))
            garrafa.saldo_ml = _d(garrafa.saldo_ml) - ml
        elif garrafa.status == "vazia":
            garrafa.status = "aberta"
            garrafa.encerrada_em = None
            garrafa.encerrada_por_id = None
    return criados


def baixar_ml(produto, ml, tipo, *, funcionario_id, motivo=None, data=None):
    """Saída manual de ml: perda/derramamento, cortesia ou degustação."""
    if tipo not in TIPOS_BAIXA_MANUAL:
        raise DoseError("Tipo de baixa inválido")
    movimentos, _, custo, _ = _consumir(
        produto, ml, tipo, funcionario_id=funcionario_id, motivo=motivo, data=data)
    return movimentos, custo.quantize(Q4, rounding=ROUND_HALF_UP)


def _garrafa_da_loja(garrafa_id, estabelecimento_id) -> GarrafaAberta:
    garrafa = GarrafaAberta.query.filter_by(id=garrafa_id, estabelecimento_id=estabelecimento_id) \
        .with_for_update().first()
    if garrafa is None:
        raise DoseError("Garrafa não encontrada nesta loja")
    return garrafa


def encerrar_garrafa(garrafa_id, estabelecimento_id, *, funcionario_id, data=None):
    """'Terminou a garrafa': o ml que o razão ainda mostrava vira desvio (saiu da garrafa sem venda registrada).

    É assim que o sistema enxerga dose generosa ou venda fora do PDV: o razão fecha por construção e só
    o fim real da garrafa mostra o que faltou. Devolve ``(garrafa, desvio_ml)``.
    """
    garrafa = _garrafa_da_loja(garrafa_id, estabelecimento_id)
    if garrafa.status != "aberta":
        raise DoseError("A garrafa já foi encerrada")
    desvio = _d(garrafa.saldo_ml)
    if desvio > 0:
        _registrar(garrafa, "desvio", -desvio, funcionario_id=funcionario_id,
                   motivo="Garrafa terminou antes do previsto", data=data)
        garrafa.saldo_ml = ZERO
    garrafa.status = "vazia"
    garrafa.encerrada_em = data or now_utc()
    garrafa.encerrada_por_id = funcionario_id
    return garrafa, desvio


def ajustar_saldo(garrafa_id, estabelecimento_id, saldo_fisico_ml, *, funcionario_id, motivo=None, data=None):
    """Contagem física da garrafa aberta: grava a diferença como ajuste. Devolve ``(garrafa, diferenca_ml)``."""
    garrafa = _garrafa_da_loja(garrafa_id, estabelecimento_id)
    if garrafa.status != "aberta":
        raise DoseError("Só garrafa aberta pode ser ajustada")
    try:
        fisico = Decimal(str(saldo_fisico_ml).replace(",", "."))
    except (InvalidOperation, ValueError):
        raise DoseError("Saldo informado inválido") from None
    if not fisico.is_finite() or fisico < 0 or fisico > _d(garrafa.volume_inicial_ml):
        raise DoseError("Saldo informado inválido")
    fisico = fisico.quantize(ML, rounding=ROUND_HALF_UP)
    diferenca = fisico - _d(garrafa.saldo_ml)
    if diferenca != 0:
        _registrar(garrafa, "ajuste", diferenca, funcionario_id=funcionario_id,
                   motivo=motivo or "Contagem da garrafa aberta", data=data)
        garrafa.saldo_ml = fisico
    if fisico == 0:
        garrafa.status = "vazia"
        garrafa.encerrada_em = data or now_utc()
        garrafa.encerrada_por_id = funcionario_id
    return garrafa, diferenca


def descartar_garrafa(garrafa_id, estabelecimento_id, *, funcionario_id, motivo=None, data=None):
    """Descarta a garrafa aberta (vencida depois de aberta, contaminada): o saldo vira perda registrada."""
    garrafa = _garrafa_da_loja(garrafa_id, estabelecimento_id)
    if garrafa.status != "aberta":
        raise DoseError("Só garrafa aberta pode ser descartada")
    saldo = _d(garrafa.saldo_ml)
    if saldo > 0:
        _registrar(garrafa, "descarte", -saldo, funcionario_id=funcionario_id,
                   motivo=motivo or "Descarte de garrafa aberta", data=data)
        garrafa.saldo_ml = ZERO
    garrafa.status = "descartada"
    garrafa.encerrada_em = data or now_utc()
    garrafa.encerrada_por_id = funcionario_id
    return garrafa, saldo


def ledger_confere(garrafa) -> bool:
    """Invariante: o saldo da garrafa é a soma do razão de ml."""
    total = db.session.query(func.coalesce(func.sum(DoseMovimento.ml), 0)).filter(
        DoseMovimento.garrafa_id == garrafa.id,
        DoseMovimento.estabelecimento_id == garrafa.estabelecimento_id).scalar()
    return _d(total) == _d(garrafa.saldo_ml)


def vendas_do_lote(estabelecimento_id, lote_id):
    """Recall: vendas que levaram doses de garrafas abertas deste lote (ml líquidos, já descontado o estorno).

    Devolve ``[{venda_id, ml, quantidade}]`` com `quantidade` em garrafas equivalentes. Venda totalmente
    estornada (ml líquido zero) não aparece.
    """
    linhas = db.session.query(DoseMovimento.venda_id, GarrafaAberta.volume_inicial_ml,
                              func.coalesce(func.sum(DoseMovimento.ml), 0)).join(
        GarrafaAberta, GarrafaAberta.id == DoseMovimento.garrafa_id).filter(
        DoseMovimento.estabelecimento_id == estabelecimento_id, GarrafaAberta.lote_id == lote_id,
        DoseMovimento.venda_id.isnot(None), DoseMovimento.tipo.in_(("venda", "estorno"))
    ).group_by(DoseMovimento.venda_id, GarrafaAberta.id, GarrafaAberta.volume_inicial_ml).all()
    por_venda = {}
    for venda_id, volume, soma in linhas:
        ml = -_d(soma)                    # venda é negativa, estorno positivo: o que ficou vendido
        if ml <= 0:
            continue
        atual = por_venda.setdefault(venda_id, {"venda_id": venda_id, "ml": ZERO, "quantidade": ZERO})
        atual["ml"] += ml
        atual["quantidade"] += ml / _d(volume)
    return [{"venda_id": v["venda_id"], "ml": float(v["ml"]),
             "quantidade": float(v["quantidade"].quantize(QB, rounding=ROUND_HALF_UP))}
            for v in sorted(por_venda.values(), key=lambda x: x["venda_id"], reverse=True)]


def oferta_pdv(estabelecimento_id, produto_ids=None) -> dict:
    """O que o PDV precisa para vender por dose: doses ativas, volume da garrafa e o saldo da(s) aberta(s).

    `{produto_id: {vende_por_dose, volume_embalagem_ml, doses, saldo_aberto_ml, garrafas_abertas}}` só para
    produtos que vendem por dose e têm ao menos uma dose ativa. `produto_ids=None` = todos da loja.
    """
    consulta = Produto.query.filter(Produto.vende_por_dose.is_(True), Produto.deleted_at.is_(None),
                                    Produto.ativo.isnot(False))
    if estabelecimento_id is not None:
        consulta = consulta.filter(Produto.estabelecimento_id == estabelecimento_id)
    if produto_ids is not None:
        ids = [int(i) for i in produto_ids]
        if not ids:
            return {}
        consulta = consulta.filter(Produto.id.in_(ids))
    produtos = {p.id: p for p in consulta.all() if p.volume_embalagem_ml}
    if not produtos:
        return {}
    ids = list(produtos)
    doses = {}
    for d in ProdutoDose.query.filter(ProdutoDose.produto_id.in_(ids), ProdutoDose.ativa.is_(True)) \
            .order_by(ProdutoDose.padrao.desc(), ProdutoDose.ordem, ProdutoDose.id).all():
        doses.setdefault(d.produto_id, []).append({
            "id": d.id, "nome": d.nome, "volume_ml": float(d.volume_ml), "preco_venda": float(d.preco_venda),
            "padrao": bool(d.padrao)})
    hoje = hoje_local()
    abertas = {}
    for g in GarrafaAberta.query.filter(GarrafaAberta.produto_id.in_(ids), GarrafaAberta.status == "aberta") \
            .order_by(GarrafaAberta.aberta_em, GarrafaAberta.id).all():
        if _usavel(g, hoje) and _d(g.saldo_ml) > 0:
            abertas.setdefault(g.produto_id, []).append({
                "id": g.id, "saldo_ml": float(g.saldo_ml), "volume_inicial_ml": float(g.volume_inicial_ml),
                "aberta_em": g.aberta_em.isoformat() if g.aberta_em else None})
    saida = {}
    for pid, produto in produtos.items():
        if not doses.get(pid):
            continue
        garrafas = abertas.get(pid, [])
        saida[pid] = {
            "vende_por_dose": True, "volume_embalagem_ml": float(produto.volume_embalagem_ml), "doses": doses[pid],
            "saldo_aberto_ml": round(sum(g["saldo_ml"] for g in garrafas), 2), "garrafas_abertas": garrafas}
    return saida


def resumo_aberto(estabelecimento_id, produto_ids) -> dict:
    """Garrafa aberta de cada produto que vende por dose (card de estoque: "7 fechadas + 1 aberta de 650 ml").

    `{produto_id: {vende_por_dose, volume_embalagem_ml, saldo_aberto_ml, garrafas_abertas, garrafas_vencidas,
    dose_ml_padrao, doses_na_aberta}}`. Produto que não vende por dose fica de fora. `saldo_aberto_ml` conta só o
    que ainda vende (dentro da validade); a garrafa vencida vai em `garrafas_vencidas`, à espera do descarte.
    """
    ids = [int(i) for i in produto_ids]
    if not ids:
        return {}
    produtos = {p.id: p for p in Produto.query.filter(
        Produto.estabelecimento_id == estabelecimento_id, Produto.id.in_(ids), Produto.vende_por_dose.is_(True)).all()}
    if not produtos:
        return {}
    padrao = {}
    for d in ProdutoDose.query.filter(ProdutoDose.produto_id.in_(list(produtos)), ProdutoDose.ativa.is_(True)) \
            .order_by(ProdutoDose.padrao.desc(), ProdutoDose.ordem, ProdutoDose.id).all():
        padrao.setdefault(d.produto_id, d)
    hoje = hoje_local()
    saldo, abertas, vencidas = {}, {}, {}
    for g in GarrafaAberta.query.filter(
            GarrafaAberta.estabelecimento_id == estabelecimento_id, GarrafaAberta.produto_id.in_(list(produtos)),
            GarrafaAberta.status == "aberta").all():
        abertas[g.produto_id] = abertas.get(g.produto_id, 0) + 1
        if _usavel(g, hoje):
            saldo[g.produto_id] = saldo.get(g.produto_id, ZERO) + _d(g.saldo_ml)
        else:
            vencidas[g.produto_id] = vencidas.get(g.produto_id, 0) + 1
    saida = {}
    for pid, produto in produtos.items():
        dose = padrao.get(pid)
        ml = saldo.get(pid, ZERO)
        saida[pid] = {
            "vende_por_dose": True,
            "volume_embalagem_ml": float(produto.volume_embalagem_ml) if produto.volume_embalagem_ml else None,
            "saldo_aberto_ml": float(ml), "garrafas_abertas": abertas.get(pid, 0),
            "garrafas_vencidas": vencidas.get(pid, 0),
            "dose_ml_padrao": float(dose.volume_ml) if dose else None,
            "doses_na_aberta": int(ml // _d(dose.volume_ml)) if dose and _d(dose.volume_ml) > 0 else None,
        }
    return saida


def razao_de_ml(estabelecimento_id, produto_id=None, garrafa_id=None, limite=100) -> list:
    """Razão de ml (mais recente primeiro): quem mexeu, quando, quanto, em qual dose/venda e o custo."""
    from app.models import Funcionario, Venda
    consulta = db.session.query(DoseMovimento, Funcionario.nome, Venda.codigo).outerjoin(
        Funcionario, Funcionario.id == DoseMovimento.funcionario_id).outerjoin(
        Venda, Venda.id == DoseMovimento.venda_id).filter(DoseMovimento.estabelecimento_id == estabelecimento_id)
    if produto_id is not None:
        consulta = consulta.filter(DoseMovimento.produto_id == produto_id)
    if garrafa_id is not None:
        consulta = consulta.filter(DoseMovimento.garrafa_id == garrafa_id)
    linhas = consulta.order_by(DoseMovimento.id.desc()).limit(max(1, min(int(limite), 500))).all()
    nomes_dose = {}
    ids_dose = {m.dose_id for m, _, _ in linhas if m.dose_id}
    if ids_dose:
        nomes_dose = {d.id: d.nome for d in ProdutoDose.query.filter(ProdutoDose.id.in_(ids_dose)).all()}
    return [{
        "id": m.id, "garrafa_id": m.garrafa_id, "tipo": m.tipo, "ml": float(m.ml),
        "custo": float(m.custo) if m.custo is not None else None, "dose": nomes_dose.get(m.dose_id),
        "venda": codigo, "funcionario": nome, "motivo": m.motivo,
        "em": m.created_at.isoformat() if m.created_at else None,
    } for m, nome, codigo in linhas]


def resumo_garrafa(garrafa) -> dict:
    """Para onde foram os ml de uma garrafa (fim de garrafa/relatórios): vendido líquido, perdas, desvio, rendimento."""
    linhas = db.session.query(DoseMovimento.tipo, func.coalesce(func.sum(DoseMovimento.ml), 0)).filter(
        DoseMovimento.garrafa_id == garrafa.id, DoseMovimento.estabelecimento_id == garrafa.estabelecimento_id
    ).group_by(DoseMovimento.tipo).all()
    por_tipo = {tipo: _d(soma) for tipo, soma in linhas}

    def saiu(*tipos):
        return -sum((por_tipo.get(t, ZERO) for t in tipos), ZERO)

    vendido = saiu("venda", "estorno")
    volume = _d(garrafa.volume_inicial_ml)
    return {
        "garrafa_id": garrafa.id, "volume_inicial_ml": float(volume), "saldo_ml": float(garrafa.saldo_ml),
        "vendido_ml": float(vendido), "perda_ml": float(saiu("perda", "cortesia", "degustacao")),
        "desvio_ml": float(saiu("desvio")), "ajuste_ml": float(por_tipo.get("ajuste", ZERO)),
        "descarte_ml": float(saiu("descarte")),
        "rendimento_pct": float((vendido / volume * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
        if volume > 0 else None,
    }


def garrafas_abertas_da_loja(estabelecimento_id, produto_id=None):
    consulta = GarrafaAberta.query.filter_by(estabelecimento_id=estabelecimento_id, status="aberta")
    if produto_id is not None:
        consulta = consulta.filter_by(produto_id=produto_id)
    return consulta.order_by(GarrafaAberta.aberta_em, GarrafaAberta.id).all()


def garrafas_vencidas(estabelecimento_id):
    """Garrafas abertas cuja validade pós-abertura passou: candidatas ao descarte."""
    return GarrafaAberta.query.filter(
        GarrafaAberta.estabelecimento_id == estabelecimento_id, GarrafaAberta.status == "aberta",
        GarrafaAberta.validade_aberta.isnot(None), GarrafaAberta.validade_aberta < hoje_local()).all()


def doses_restantes(garrafa_ou_ml, dose_ml) -> int:
    """Quantas doses inteiras ainda cabem (para o 'aberta: 650 ml ≈ 13 doses' da tela)."""
    ml = _d(garrafa_ou_ml.saldo_ml if hasattr(garrafa_ou_ml, "saldo_ml") else garrafa_ou_ml)
    dose = _d(dose_ml)
    return int((ml / dose).to_integral_value(rounding="ROUND_FLOOR")) if dose > 0 else 0


def garrafas_necessarias(ml, volume) -> int:
    return int((_d(ml) / _d(volume)).to_integral_value(rounding=ROUND_CEILING))
