"""Regras da produção própria: custo padrão, capacidade e ciclo da ordem de produção.

Estoque só se move pelo caminho único: insumo sai por estoque_service.registrar_saida (FIFO dos
lotes, quarentena de vencido, reservas) e o acabado entra com lote, custo médio ponderado e
movimento, igual ao recebimento de compra. Nada aqui faz commit: a rota decide.

Recursos para qualquer tipo de produto fabricado:
- Unidade da receita: o insumo pode ser digitado em g/ml/cm mesmo estocado em kg/L/m.
- Receita em vários níveis: semiacabado com ficha própria entra como insumo de outra ficha;
  ciclo (A usa B que usa A) é recusado; a necessidade explode os níveis (produzir x comprar).
- Grade: cada variação (tamanho/cor) tem a sua ficha; uma ficha pode ser copiada para as irmãs.
- Versões: cada edição da ficha guarda uma foto (quem, quando, como era) e a OP grava a versão.
- Apontamento parcial: a OP entrega aos poucos (turno, fornada), cada entrega com lote próprio.
- Estorno: OP apontada/encerrada volta inteira (insumos aos lotes de origem, acabado sai),
  com PIN de gerente e auditoria (na rota).
- Insumo separado: OP em produção segura o que ainda vai consumir; outra OP não conta com ele.
- Validade: prazo na ficha preenche a validade do lote; validade passada é recusada.
- Rastreio de lote (recall): para trás (ordem e lotes de insumo com fornecedor) e para frente
  (ordens que usaram, lotes produzidos e vendas com cliente).
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models import MovimentacaoEstoque, Produto, ProdutoLote, db
from app.models_producao import (
    PAPEIS_PRODUCAO, ApontamentoProducao, FichaTecnica, FichaTecnicaItem, FichaTecnicaVersao,
    OrdemProducao, OrdemProducaoItem,
)
from app.services import estoque_service
from app.utils.timezone import agora_local, hoje_local, now_utc

CENT = Decimal("0.01")
Q4 = Decimal("0.0001")
CEM = Decimal("100")
ZERO = Decimal("0")
PROFUNDIDADE_MAXIMA = 12  # níveis de receita (semiacabado dentro de semiacabado...)


class ProducaoError(ValueError):
    """Erro de regra da produção (vira HTTP 400/409 na rota)."""

    def __init__(self, mensagem, faltas=None):
        super().__init__(mensagem)
        self.faltas = faltas or []


def _dec(valor, rotulo, minimo=ZERO, permitir_zero=True):
    try:
        numero = Decimal(str(valor if valor not in (None, "") else 0).replace(",", "."))
    except Exception:
        raise ProducaoError(f"{rotulo} inválido") from None
    if not numero.is_finite() or numero < minimo or (not permitir_zero and numero == 0):
        raise ProducaoError(f"{rotulo} inválido")
    return numero


def _d(valor):
    return Decimal(str(valor or 0))


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


# ── Unidades ──────────────────────────────────────────────────────────────
# família -> {unidade exibida: fator para a base da família}
_FAMILIAS = {
    "massa": {"mg": Decimal("0.000001"), "g": Decimal("0.001"), "kg": Decimal("1"), "t": Decimal("1000")},
    "volume": {"ml": Decimal("0.001"), "L": Decimal("1"), "m3": Decimal("1000")},
    "comprimento": {"mm": Decimal("0.001"), "cm": Decimal("0.01"), "m": Decimal("1")},
    "area": {"cm2": Decimal("0.0001"), "m2": Decimal("1")},
    "unidade": {"UN": Decimal("1")},
}
_APELIDOS = {
    "MG": "mg", "G": "g", "GR": "g", "GRS": "g", "GRAMA": "g", "GRAMAS": "g",
    "KG": "kg", "KGS": "kg", "KILO": "kg", "KILOS": "kg", "QUILO": "kg", "QUILOS": "kg",
    "T": "t", "TON": "t", "TONELADA": "t",
    "ML": "ml", "L": "L", "LT": "L", "LTS": "L", "LITRO": "L", "LITROS": "L", "M3": "m3",
    "MM": "mm", "CM": "cm", "M": "m", "MT": "m", "MTS": "m", "METRO": "m", "METROS": "m",
    "CM2": "cm2", "M2": "m2",
    "UN": "UN", "UND": "UN", "UNID": "UN", "UNIDADE": "UN", "UNIDADES": "UN", "U": "UN",
    "PC": "UN", "PCS": "UN", "PÇ": "UN", "PÇS": "UN", "PECA": "UN", "PEÇA": "UN", "PECAS": "UN", "PEÇAS": "UN",
}


def _unidade(codigo):
    """(família, unidade canônica, fator) ou família própria para unidade desconhecida (CX, PCT...)."""
    bruto = (codigo or "UN").strip().replace(".", "")
    canonica = _APELIDOS.get(bruto.upper())
    if canonica:
        for familia, unidades in _FAMILIAS.items():
            if canonica in unidades:
                return familia, canonica, unidades[canonica]
    return f"_{bruto.upper()}", bruto.upper(), Decimal("1")


def unidades_compativeis(unidade_estoque):
    """Unidades em que a receita pode pedir este insumo (a de estoque vem primeiro)."""
    familia, canonica, _ = _unidade(unidade_estoque)
    if familia.startswith("_"):
        return [canonica]
    return [canonica] + [u for u in _FAMILIAS[familia] if u != canonica]


def converter(quantidade, de, para):
    """Converte `quantidade` da unidade `de` para `para`; famílias diferentes = erro."""
    fam_de, can_de, fator_de = _unidade(de)
    fam_para, can_para, fator_para = _unidade(para)
    if fam_de != fam_para:
        raise ProducaoError(f"Não dá para converter {can_de} em {can_para}")
    return Decimal(str(quantidade)) * fator_de / fator_para


# ── Ficha técnica ─────────────────────────────────────────────────────────

def _fichas_ativas(estab_id):
    fichas = FichaTecnica.query.filter_by(estabelecimento_id=estab_id, ativa=True) \
        .options(selectinload(FichaTecnica.itens)).all()
    return {f.produto_id: f for f in fichas}


def _usa(produto_id, alvo_id, fichas, profundidade=0):
    """True se a receita de `produto_id` (em qualquer nível) consome `alvo_id`."""
    if profundidade > PROFUNDIDADE_MAXIMA:
        return True  # profundidade absurda = trate como ciclo
    ficha = fichas.get(produto_id)
    if not ficha:
        return False
    for item in ficha.itens:
        if item.insumo_id == alvo_id or _usa(item.insumo_id, alvo_id, fichas, profundidade + 1):
            return True
    return False


def _foto(ficha, funcionario_id=None):
    dados = ficha_dict(ficha, com_capacidade=False)
    db.session.add(FichaTecnicaVersao(estabelecimento_id=ficha.estabelecimento_id, ficha_id=ficha.id,
                                      versao=ficha.versao, funcionario_id=funcionario_id,
                                      dados=json.dumps(dados, ensure_ascii=False, default=str)))


def salvar_ficha(estab_id, dados, ficha=None, funcionario_id=None):
    """Cria ou substitui a ficha (cabeçalho + itens) e grava a versão. OPs já criadas guardam a cópia."""
    produto = _produto_da_loja(int(dados.get("produto_id") or (ficha.produto_id if ficha else 0)), estab_id)
    if getattr(produto, "eh_grade_modelo", False):
        raise ProducaoError(f"{produto.nome} é o modelo da grade: faça a ficha de cada variação "
                            "(e copie para as outras)")
    nova = ficha is None
    if nova:
        if FichaTecnica.query.filter_by(estabelecimento_id=estab_id, produto_id=produto.id).first():
            raise ProducaoError(f"{produto.nome} já tem ficha técnica: edite a existente")
        ficha = FichaTecnica(estabelecimento_id=estab_id, produto_id=produto.id, versao=1)
        ficha.produto = produto
        db.session.add(ficha)
    else:
        ficha.versao = int(ficha.versao or 1) + 1
    ficha.rendimento = _dec(dados.get("rendimento"), "Rendimento", permitir_zero=False)
    ficha.minutos_mao_de_obra = _dec(dados.get("minutos_mao_de_obra"), "Minutos de mão de obra")
    ficha.custo_hora_mao_de_obra = _dec(dados.get("custo_hora_mao_de_obra"), "Custo/hora")
    ficha.custo_indireto_percentual = _dec(dados.get("custo_indireto_percentual"), "Custo indireto %")
    ficha.markup_percentual = _dec(dados.get("markup_percentual", 100), "Markup %")
    validade_dias = dados.get("validade_dias")
    if validade_dias in (None, "", 0, "0"):
        ficha.validade_dias = None
    else:
        try:
            ficha.validade_dias = int(str(validade_dias))
        except ValueError:
            raise ProducaoError("Prazo de validade inválido") from None
        if not 1 <= ficha.validade_dias <= 3650:
            raise ProducaoError("Prazo de validade deve ficar entre 1 e 3650 dias")
    ficha.observacoes = (dados.get("observacoes") or None)
    ficha.ativa = bool(dados.get("ativa", True))

    itens = dados.get("itens") or []
    if not itens:
        raise ProducaoError("A ficha precisa de pelo menos um insumo")
    fichas = _fichas_ativas(estab_id)
    vistos = set()
    novos = []
    for bruto in itens:
        insumo = _produto_da_loja(int(bruto.get("insumo_id") or 0), estab_id, "Insumo")
        if insumo.id == produto.id:
            raise ProducaoError("O produto não pode ser insumo dele mesmo")
        if insumo.id in vistos:
            raise ProducaoError(f"{insumo.nome} aparece duas vezes na ficha")
        if getattr(insumo, "eh_grade_modelo", False):
            raise ProducaoError(f"{insumo.nome} é o modelo da grade: escolha a variação usada")
        if _usa(insumo.id, produto.id, fichas):
            raise ProducaoError(f"{insumo.nome} já é feito a partir de {produto.nome}: a receita ficaria em círculo")
        vistos.add(insumo.id)
        perda = _dec(bruto.get("perda_percentual"), f"Perda de {insumo.nome}")
        if perda >= CEM:
            raise ProducaoError(f"Perda de {insumo.nome} precisa ser menor que 100%")
        digitada = _dec(bruto.get("quantidade"), f"Quantidade de {insumo.nome}", permitir_zero=False)
        unidade_estoque = insumo.unidade_medida or "UN"
        unidade = (bruto.get("unidade") or "").strip() or None
        quantidade = converter(digitada, unidade, unidade_estoque) if unidade else digitada
        quantidade = quantidade.quantize(Q4, rounding=ROUND_HALF_UP)
        if quantidade <= 0:
            raise ProducaoError(f"Quantidade de {insumo.nome} some na conversão para {unidade_estoque}: "
                                f"cadastre o insumo numa unidade menor")
        item = FichaTecnicaItem(insumo_id=insumo.id, quantidade=quantidade, perda_percentual=perda,
                                quantidade_receita=digitada if unidade else None,
                                unidade_receita=_unidade(unidade)[1] if unidade else None)
        item.insumo = insumo
        novos.append(item)
    ficha.itens = novos
    if not produto.papel_producao or produto.papel_producao == "revenda":
        produto.papel_producao = "fabricado"
    db.session.flush()
    _foto(ficha, funcionario_id)
    return ficha


def copiar_ficha(estab_id, ficha, produto_ids, funcionario_id=None):
    """Grade: replica a receita para outras variações (tamanho/cor) que ainda não têm ficha."""
    criadas, ignoradas = [], []
    base = {
        "rendimento": ficha.rendimento, "minutos_mao_de_obra": ficha.minutos_mao_de_obra,
        "custo_hora_mao_de_obra": ficha.custo_hora_mao_de_obra,
        "custo_indireto_percentual": ficha.custo_indireto_percentual,
        "markup_percentual": ficha.markup_percentual, "validade_dias": ficha.validade_dias,
        "observacoes": ficha.observacoes,
        "itens": [{"insumo_id": i.insumo_id,
                   "quantidade": i.quantidade_receita if i.unidade_receita else i.quantidade,
                   "unidade": i.unidade_receita, "perda_percentual": i.perda_percentual} for i in ficha.itens],
    }
    for produto_id in dict.fromkeys(int(p) for p in (produto_ids or [])):
        produto = Produto.query.filter_by(id=produto_id, estabelecimento_id=estab_id).filter(
            Produto.deleted_at.is_(None)).first()
        if not produto or produto.id == ficha.produto_id:
            continue
        if FichaTecnica.query.filter_by(estabelecimento_id=estab_id, produto_id=produto.id).first():
            ignoradas.append({"produto_id": produto.id, "produto_nome": produto.nome, "motivo": "já tem ficha"})
            continue
        try:
            with db.session.begin_nested():
                criadas.append(salvar_ficha(estab_id, dict(base, produto_id=produto.id),
                                            funcionario_id=funcionario_id))
        except ProducaoError as erro:
            ignoradas.append({"produto_id": produto.id, "produto_nome": produto.nome, "motivo": str(erro)})
    return criadas, ignoradas


def _consumo_com_perda(quantidade, perda_percentual):
    return _d(quantidade) * (1 + _d(perda_percentual) / CEM)


def custo_padrao(ficha):
    """Custo da receita pelo custo médio atual dos insumos, por unidade, e preço sugerido."""
    linhas = []
    material = ZERO
    for item in ficha.itens:
        consumo = _consumo_com_perda(item.quantidade, item.perda_percentual)
        custo_insumo = _d(item.insumo.preco_custo)
        total = consumo * custo_insumo
        material += total
        linhas.append({
            "insumo_id": item.insumo_id, "insumo_nome": item.insumo.nome,
            "unidade": item.insumo.unidade_medida or "UN",
            "quantidade": float(item.quantidade), "perda_percentual": float(item.perda_percentual or 0),
            "consumo_com_perda": float(consumo.quantize(Q4)), "custo_unitario_insumo": float(custo_insumo),
            "custo_total": float(total.quantize(CENT, rounding=ROUND_HALF_UP)),
        })
    mao_de_obra = _d(ficha.minutos_mao_de_obra) / 60 * _d(ficha.custo_hora_mao_de_obra)
    indireto = (material + mao_de_obra) * _d(ficha.custo_indireto_percentual) / CEM
    total_receita = material + mao_de_obra + indireto
    rendimento = _d(ficha.rendimento)
    unitario = total_receita / rendimento
    preco = unitario * (1 + _d(ficha.markup_percentual) / CEM)
    preco_atual = _d(ficha.produto.preco_venda)
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


def _comprometido_em_producao(insumo, exceto_op_id=None):
    """Insumo separado para ordens EM PRODUÇÃO: o previsto que elas ainda não consumiram.

    Ordem iniciada garante o material dela: outra ordem não pode contar com o mesmo saldo.
    Com entrega parcial, o que já saiu do estoque deixa de ser separado (prevista - consumida).
    """
    from sqlalchemy import func
    consulta = db.session.query(func.coalesce(func.sum(
        OrdemProducaoItem.quantidade_prevista - func.coalesce(OrdemProducaoItem.quantidade_consumida, 0)), 0)).join(
        OrdemProducao, OrdemProducao.id == OrdemProducaoItem.ordem_id).filter(
        OrdemProducao.estabelecimento_id == insumo.estabelecimento_id,
        OrdemProducao.status == "em_producao",
        OrdemProducaoItem.insumo_id == insumo.id)
    if exceto_op_id is not None:
        consulta = consulta.filter(OrdemProducao.id != exceto_op_id)
    return max(_d(consulta.scalar()), ZERO)


def _disponivel(insumo, descontar_producao=False, exceto_op_id=None):
    """Saldo utilizável do insumo: estoque - vencido em quarentena - reservado para pedido.

    ``descontar_producao`` também tira o que está separado para ordens em produção.
    """
    saldo = (_d(insumo.quantidade) - estoque_service.quantidade_em_quarentena(insumo)
             - estoque_service.reservado_no_produto(insumo))
    if descontar_producao:
        saldo -= _comprometido_em_producao(insumo, exceto_op_id)
    return saldo


def capacidade(ficha):
    """Quantas unidades dá para fazer com o insumo que há, e qual insumo é o gargalo."""
    rendimento = _d(ficha.rendimento)
    melhor, gargalo = None, None
    for item in ficha.itens:
        por_unidade = _consumo_com_perda(item.quantidade, item.perda_percentual) / rendimento
        if por_unidade <= 0:
            continue
        possivel = (max(_disponivel(item.insumo, descontar_producao=True), ZERO) / por_unidade).to_integral_value(rounding=ROUND_DOWN)
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
    rendimento = _d(ficha.rendimento)
    padrao = custo_padrao(ficha)
    fator = quantidade / rendimento
    # Duas OPs criadas no mesmo instante disputam o número: a unique (loja, número) decide e a
    # perdedora tenta o próximo, sem derrubar a requisição com 500.
    for _ in range(5):
        op = OrdemProducao(
            estabelecimento_id=estab_id, numero=_proximo_numero(estab_id), ficha_id=ficha.id,
            ficha_versao=ficha.versao, produto_id=ficha.produto_id, status="planejada",
            quantidade_planejada=quantidade, rendimento_ficha=rendimento,
            minutos_mao_de_obra=(_d(ficha.minutos_mao_de_obra) * fator).quantize(CENT),
            custo_hora_mao_de_obra=ficha.custo_hora_mao_de_obra or 0,
            custo_indireto_percentual=ficha.custo_indireto_percentual or 0,
            custo_unitario_padrao=Decimal(str(padrao["custo_unitario"])),
            funcionario_id=funcionario_id, observacoes=observacoes or None,
        )
        op.itens = [OrdemProducaoItem(insumo_id=item.insumo_id,
                                      quantidade_prevista=(_consumo_com_perda(item.quantidade, item.perda_percentual)
                                                           * fator).quantize(Q4, rounding=ROUND_HALF_UP))
                    for item in ficha.itens]
        try:
            with db.session.begin_nested():
                db.session.add(op)
                db.session.flush()
            return op
        except IntegrityError:
            continue
    raise ProducaoError("Não foi possível numerar a ordem agora: tente de novo")


def faltas_da_ordem(op):
    """O que falta para esta ordem, já descontando o insumo separado para outras ordens em produção."""
    faltas = []
    for item in op.itens:
        disponivel = _disponivel(item.insumo, descontar_producao=True, exceto_op_id=op.id)
        precisa = _d(item.quantidade_prevista) - _d(item.quantidade_consumida)
        if precisa <= 0:
            continue
        if disponivel < precisa:
            faltas.append({"insumo_id": item.insumo_id, "insumo_nome": item.insumo.nome,
                           "unidade": item.insumo.unidade_medida or "UN",
                           "precisa": float(precisa), "disponivel": float(max(disponivel, ZERO)),
                           "falta": float((precisa - max(disponivel, ZERO)).quantize(Q4))})
    return faltas


def iniciar_ordem(op):
    if op.status != "planejada":
        raise ProducaoError("Só uma ordem planejada pode ser iniciada")
    faltas = faltas_da_ordem(op)
    if faltas:
        raise ProducaoError("Insumo insuficiente para esta ordem", faltas=faltas)
    op.status = "em_producao"
    op.data_inicio = now_utc()


def _ativos(op):
    return [a for a in op.apontamentos if not a.estornado]


def apontar(op, dados, funcionario_id, final=False):
    """Entrega da OP: baixa o consumo desta etapa e dá entrada nas peças boas com lote próprio.

    Parcial (final=False): o consumo e a mão de obra saem proporcionais ao que foi feito
    (boas + refugo) sobre o planejado. Final: sai o que falta do previsto e a OP encerra.
    O consumo real pode ser informado por insumo. Tudo ou nada (a rota faz commit).
    """
    if op.status not in ("planejada", "em_producao"):
        raise ProducaoError("Esta ordem já foi encerrada, estornada ou cancelada")
    boa = _dec(dados.get("quantidade_produzida"), "Quantidade produzida (boa)")
    refugo = _dec(dados.get("quantidade_refugo"), "Refugo")
    anteriores = _ativos(op)
    if boa == 0 and refugo == 0 and not (final and anteriores):
        raise ProducaoError("Informe a quantidade produzida ou o refugo")
    motivo_refugo = (dados.get("motivo_refugo") or "").strip()[:200] or None
    if refugo > 0 and not motivo_refugo:
        raise ProducaoError("Informe o motivo do refugo (bolha, rachadura, quebra...)")

    feito = boa + refugo
    planejada = _d(op.quantidade_planejada)
    proporcao = (feito / planejada) if planejada > 0 else ZERO
    consumo_real = {int(c.get("insumo_id")): c.get("quantidade")
                    for c in (dados.get("consumo") or []) if c.get("insumo_id") is not None}
    sequencia = max([a.sequencia for a in op.apontamentos] or [0]) + 1
    motivo = f"Consumo {op.numero}" + (f" #{sequencia}" if sequencia > 1 else "")
    material = ZERO
    consumo, lotes_insumo = [], []
    for item in op.itens:
        insumo = Produto.query.filter_by(id=item.insumo_id, estabelecimento_id=op.estabelecimento_id) \
            .populate_existing().with_for_update().first()
        restante = max(_d(item.quantidade_prevista) - _d(item.quantidade_consumida), ZERO)
        if item.insumo_id in consumo_real:
            quantidade = _dec(consumo_real[item.insumo_id], f"Consumo de {insumo.nome}")
        elif final:
            quantidade = restante if feito > 0 else ZERO
        else:
            quantidade = min((_d(item.quantidade_prevista) * proporcao).quantize(Q4, rounding=ROUND_HALF_UP),
                             restante)
        if op.status == "planejada" and quantidade > 0:
            # Apontar/encerrar sem iniciar não pode usar o material separado para outra ordem.
            livre = _disponivel(insumo, descontar_producao=True, exceto_op_id=op.id)
            if quantidade > livre:
                raise ProducaoError(f"Insumo insuficiente: {insumo.nome}", faltas=[{
                    "insumo_id": insumo.id, "insumo_nome": insumo.nome, "unidade": insumo.unidade_medida or "UN",
                    "precisa": float(quantidade), "disponivel": float(max(livre, ZERO)),
                    "falta": float((quantidade - max(livre, ZERO)).quantize(Q4))}])
        if quantidade == 0:
            if item.custo_unitario is None:
                item.custo_unitario = _d(insumo.preco_custo)
            continue
        try:
            movimento, custo = estoque_service.registrar_saida(
                insumo, quantidade, venda_id=None, funcionario_id=funcionario_id, motivo=motivo[:100])
        except estoque_service.EstoqueIndisponivelError as erro:
            raise ProducaoError(f"Insumo insuficiente: {insumo.nome}",
                                faltas=[{"insumo_id": insumo.id, "insumo_nome": insumo.nome,
                                         "unidade": insumo.unidade_medida or "UN",
                                         "precisa": float(quantidade)}]) from erro
        except estoque_service.ProdutoVencidoError as erro:
            raise ProducaoError(f"{insumo.nome} está vencido: não pode entrar na produção") from erro
        item.quantidade_consumida = _d(item.quantidade_consumida) + quantidade
        item.custo_unitario = custo
        material += custo * quantidade
        movimento_id = None
        if movimento is not None:
            db.session.flush()
            movimento_id = item.movimentacao_id = movimento.id
            lotes_insumo.append({"insumo_id": insumo.id, "rastro": json.loads(movimento.observacoes or "{}")})
        consumo.append({"insumo_id": insumo.id, "quantidade": str(quantidade), "custo_unitario": str(custo),
                        "movimentacao_id": movimento_id})

    if dados.get("minutos_mao_de_obra") not in (None, ""):
        minutos = _dec(dados.get("minutos_mao_de_obra"), "Minutos de mão de obra")
    elif final:
        ja = sum((_d(a.minutos_mao_de_obra) for a in anteriores), ZERO)
        minutos = max(_d(op.minutos_mao_de_obra) - ja, ZERO) if feito > 0 else ZERO
    else:
        minutos = (_d(op.minutos_mao_de_obra) * proporcao).quantize(CENT, rounding=ROUND_HALF_UP)
    mao_de_obra = minutos / 60 * _d(op.custo_hora_mao_de_obra)
    indireto = (material + mao_de_obra) * _d(op.custo_indireto_percentual) / CEM

    ap = ApontamentoProducao(
        estabelecimento_id=op.estabelecimento_id, sequencia=sequencia, final=final,
        quantidade_boa=boa, quantidade_refugo=refugo, motivo_refugo=motivo_refugo,
        minutos_mao_de_obra=minutos, custo_material=material.quantize(Q4),
        custo_mao_de_obra=mao_de_obra.quantize(Q4), custo_indireto=indireto.quantize(Q4),
        consumo=json.dumps(consumo), funcionario_id=funcionario_id,
    )
    op.apontamentos.append(ap)

    if boa > 0:
        # O refugo não vira estoque: o custo dele recai sobre as peças boas (custo real).
        unitario = ((material + mao_de_obra + indireto) / boa).quantize(Q4, rounding=ROUND_HALF_UP)
        ap.custo_unitario = unitario
        produto = Produto.query.filter_by(id=op.produto_id, estabelecimento_id=op.estabelecimento_id) \
            .populate_existing().with_for_update().first()
        validade = dados.get("data_validade")
        ficha = db.session.get(FichaTecnica, op.ficha_id)
        if validade:
            try:
                validade = datetime.strptime(str(validade)[:10], "%Y-%m-%d").date()
            except ValueError:
                raise ProducaoError("Validade do lote inválida") from None
            if validade < hoje_local():
                raise ProducaoError("A validade do lote não pode ser anterior a hoje")
        elif ficha is not None and ficha.validade_dias:
            validade = hoje_local() + timedelta(days=int(ficha.validade_dias))
        elif produto.controlar_validade:
            raise ProducaoError(f"Informe a validade do lote de {produto.nome} "
                                "(ou cadastre o prazo de validade na ficha técnica)")
        else:
            validade = hoje_local() + timedelta(days=365 * 5)
        numero_lote = op.numero if sequencia == 1 else f"{op.numero}-{sequencia}"
        if ProdutoLote.query.filter_by(estabelecimento_id=op.estabelecimento_id, numero_lote=numero_lote).first():
            numero_lote = f"{numero_lote}-{op.id}"
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
        movimento.observacoes = json.dumps({"ordem_producao_id": op.id, "apontamento": sequencia,
                                            "insumos": lotes_insumo})
        db.session.add(movimento)
        db.session.flush()
        ap.lote_id = lote.id
        ap.movimentacao_id = movimento.id
        if not op.lote_id:
            op.lote_id = lote.id

    _totalizar(op)
    if op.status == "planejada":
        op.status = "em_producao"
        op.data_inicio = op.data_inicio or now_utc()
    if final:
        op.status = "encerrada"
        op.data_encerramento = now_utc()
    return op


def _totalizar(op):
    """Soma dos apontamentos válidos na OP (custo real = tudo que entrou / peças boas)."""
    ativos = _ativos(op)
    boa = sum((_d(a.quantidade_boa) for a in ativos), ZERO)
    material = sum((_d(a.custo_material) for a in ativos), ZERO)
    mao = sum((_d(a.custo_mao_de_obra) for a in ativos), ZERO)
    indireto = sum((_d(a.custo_indireto) for a in ativos), ZERO)
    op.quantidade_produzida = boa
    op.quantidade_refugo = sum((_d(a.quantidade_refugo) for a in ativos), ZERO)
    motivos = list(dict.fromkeys(a.motivo_refugo for a in ativos if a.motivo_refugo))
    op.motivo_refugo = "; ".join(motivos)[:200] or None
    op.custo_material_real = material.quantize(Q4)
    op.custo_mao_de_obra_real = mao.quantize(Q4)
    op.custo_indireto_real = indireto.quantize(Q4)
    op.custo_unitario_real = ((material + mao + indireto) / boa).quantize(Q4, rounding=ROUND_HALF_UP) if boa > 0 else None


def encerrar_ordem(op, dados, funcionario_id):
    """Última entrega: baixa o que falta do previsto, dá entrada nas boas e encerra a OP."""
    return apontar(op, dados, funcionario_id, final=True)


def cancelar_ordem(op):
    if op.status not in ("planejada", "em_producao"):
        raise ProducaoError("Ordem encerrada não pode ser cancelada: use Estornar para desfazer o estoque")
    if _ativos(op):
        raise ProducaoError("Esta ordem já tem produção apontada: use Estornar para desfazer o estoque")
    op.status = "cancelada"


def estornar_ordem(op, motivo, funcionario_id):
    """Desfaz a OP inteira: o acabado sai dos lotes que ela criou e os insumos voltam aos lotes de origem.

    Só estorna se as peças ainda estão no lote (nada vendido/ajustado): senão diz quantas saíram.
    Custo médio do acabado e do insumo é recomposto. Tudo ou nada (a rota faz commit).
    """
    ativos = _ativos(op)
    if op.status not in ("encerrada", "em_producao") or not ativos:
        raise ProducaoError("Só ordem com produção apontada pode ser estornada (sem apontamento, cancele)")
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        raise ProducaoError("Informe o motivo do estorno (ex.: apontei 190, eram 150)")
    texto = f"Estorno {op.numero}"[:100]

    # 1) Acabado sai primeiro: se algo já foi vendido, nada se move.
    for ap in ativos:
        boa = _d(ap.quantidade_boa)
        if boa <= 0 or not ap.lote_id:
            continue
        produto = Produto.query.filter_by(id=op.produto_id, estabelecimento_id=op.estabelecimento_id) \
            .populate_existing().with_for_update().first()
        lote = ProdutoLote.query.filter_by(id=ap.lote_id, estabelecimento_id=op.estabelecimento_id) \
            .populate_existing().with_for_update().first()
        no_lote = _d(lote.quantidade) if lote else ZERO
        if lote is None or not lote.ativo or no_lote < boa:
            saiu = boa - no_lote
            raise ProducaoError(f"{saiu.normalize():f} unidade(s) do lote {lote.numero_lote if lote else ''} já saíram "
                                "(venda, consumo ou descarte). Estorne essas saídas antes ou corrija por ajuste de estoque.")
        if _d(produto.quantidade) < boa:
            raise ProducaoError(f"O estoque de {produto.nome} ({_d(produto.quantidade).normalize():f}) é menor que o "
                                "produzido nesta ordem: corrija o estoque antes de estornar")
        anterior = _d(produto.quantidade)
        unitario = _d(ap.custo_unitario)
        restante = anterior - boa
        if restante > 0:
            custo = (anterior * _d(produto.preco_custo) - boa * unitario) / restante
            produto.preco_custo = max(custo, ZERO).quantize(Q4, rounding=ROUND_HALF_UP)
        produto.quantidade = restante
        lote.quantidade = no_lote - boa
        if lote.quantidade <= 0:
            lote.ativo = False
            lote.motivo_inativacao = texto
        db.session.add(MovimentacaoEstoque(
            estabelecimento_id=op.estabelecimento_id, produto_id=produto.id, lote_id=lote.id,
            funcionario_id=funcionario_id, tipo="saida", quantidade=boa, quantidade_anterior=anterior,
            quantidade_atual=produto.quantidade, custo_unitario=unitario,
            valor_total=(unitario * boa).quantize(CENT, rounding=ROUND_HALF_UP), motivo=texto,
            observacoes=json.dumps({"estorno_ordem_producao_id": op.id, "apontamento": ap.sequencia})))

    # 2) Insumos voltam como saíram (lotes do rastro, custo da saída).
    for ap in ativos:
        for linha in json.loads(ap.consumo or "[]"):
            quantidade = _d(linha.get("quantidade"))
            if quantidade <= 0 or not linha.get("movimentacao_id"):
                continue  # insumo sem controle de estoque: nada saiu
            insumo = Produto.query.filter_by(id=linha["insumo_id"], estabelecimento_id=op.estabelecimento_id) \
                .populate_existing().with_for_update().first()
            saida = MovimentacaoEstoque.query.filter_by(id=linha["movimentacao_id"],
                                                        estabelecimento_id=op.estabelecimento_id).first()
            custo = _d(linha.get("custo_unitario"))
            anterior = _d(insumo.quantidade)
            insumo.recalcular_preco_custo_ponderado(quantidade_entrada=quantidade, custo_unitario_entrada=custo,
                                                    estoque_atual=max(anterior, ZERO),
                                                    funcionario_id=funcionario_id, motivo=texto)
            insumo.quantidade = anterior + quantidade
            for lote_id, consumida in (estoque_service._lotes_do_rastro(saida) if saida else []):
                lote = ProdutoLote.query.filter_by(id=lote_id, produto_id=insumo.id,
                                                   estabelecimento_id=op.estabelecimento_id).with_for_update().first()
                if lote:
                    lote.quantidade = _d(lote.quantidade) + Decimal(consumida)
                    lote.ativo = True
            db.session.add(MovimentacaoEstoque(
                estabelecimento_id=op.estabelecimento_id, produto_id=insumo.id,
                lote_id=saida.lote_id if saida else None, funcionario_id=funcionario_id, tipo="entrada",
                quantidade=quantidade, quantidade_anterior=anterior, quantidade_atual=insumo.quantidade,
                custo_unitario=custo, valor_total=(custo * quantidade).quantize(CENT, rounding=ROUND_HALF_UP),
                motivo=texto, observacoes=saida.observacoes if saida else None))
            for item in op.itens:
                if item.insumo_id == insumo.id:
                    item.quantidade_consumida = max(_d(item.quantidade_consumida) - quantidade, ZERO)
        ap.estornado = True

    op.status = "estornada"
    op.data_estorno = now_utc()
    op.motivo_estorno = motivo[:200]
    op.estornada_por_id = funcionario_id
    return op


def _lotes_do_movimento(movimento):
    try:
        return json.loads(movimento.observacoes or "{}").get("lotes_consumidos", []) if movimento else []
    except (ValueError, AttributeError):
        return []


def rastreio_lote(estab_id, lote_id):
    """Rastreabilidade de um lote, para trás e para frente (recall).

    - Lote produzido aqui: de qual entrega/ordem saiu e quais lotes de insumo (com fornecedor) entraram.
    - Qualquer lote (insumo): em quais ordens e lotes de produto acabado ele foi usado.
    - Lote acabado: em quais vendas ele saiu (cliente e telefone): a lista de quem avisar num recall.
    """
    from app.models import Fornecedor, Venda
    from app.utils.timezone import iso_utc
    lote = ProdutoLote.query.filter_by(id=lote_id, estabelecimento_id=estab_id).first()
    if not lote:
        raise ProducaoError("Lote não encontrado nesta loja")
    insumos_por_id = {}

    def _lote_info(lote_obj):
        if not lote_obj:
            return None
        fornecedor = db.session.get(Fornecedor, lote_obj.fornecedor_id) if lote_obj.fornecedor_id else None
        return {"lote_id": lote_obj.id, "numero_lote": lote_obj.numero_lote, "produto_id": lote_obj.produto_id,
                "produto_nome": lote_obj.produto.nome if lote_obj.produto else None,
                "fornecedor": ((getattr(fornecedor, "nome_fantasia", None) or getattr(fornecedor, "razao_social", None))
                               if fornecedor else None),
                "data_fabricacao": lote_obj.data_fabricacao.isoformat() if lote_obj.data_fabricacao else None,
                "data_validade": lote_obj.data_validade.isoformat() if lote_obj.data_validade else None,
                "quantidade_inicial": float(lote_obj.quantidade_inicial or 0),
                "saldo": float(lote_obj.quantidade or 0)}

    def _insumo(insumo_id):
        if insumo_id not in insumos_por_id:
            insumos_por_id[insumo_id] = db.session.get(Produto, insumo_id)
        return insumos_por_id[insumo_id]

    # Para trás: a entrega (apontamento) que gerou este lote e os lotes de insumo que ela consumiu.
    origem = None
    ap = ApontamentoProducao.query.filter_by(estabelecimento_id=estab_id, lote_id=lote.id).first()
    if ap:
        op = ap.ordem
        insumos = []
        for linha in json.loads(ap.consumo or "[]"):
            saida = (db.session.get(MovimentacaoEstoque, linha["movimentacao_id"])
                     if linha.get("movimentacao_id") else None)
            lotes = []
            for lid, q in _lotes_do_movimento(saida):
                info = _lote_info(ProdutoLote.query.filter_by(id=lid, estabelecimento_id=estab_id).first())
                lotes.append(dict(info or {"lote_id": lid}, quantidade_usada=float(Decimal(str(q)))))
            insumo = _insumo(linha["insumo_id"])
            insumos.append({"insumo_id": linha["insumo_id"], "insumo_nome": insumo.nome if insumo else None,
                            "unidade": (insumo.unidade_medida if insumo else None) or "UN",
                            "quantidade_consumida": float(_d(linha.get("quantidade"))), "lotes": lotes})
        origem = {"ordem_id": op.id, "numero": op.numero, "status": op.status, "entrega": ap.sequencia,
                  "data_encerramento": iso_utc(op.data_encerramento), "insumos": insumos}

    # Para frente (insumo): entregas de ordens que consumiram este lote.
    usado_em = []
    aps = ApontamentoProducao.query.join(OrdemProducao, OrdemProducao.id == ApontamentoProducao.ordem_id).filter(
        ApontamentoProducao.estabelecimento_id == estab_id,
        OrdemProducao.id.in_(db.session.query(OrdemProducaoItem.ordem_id).filter(
            OrdemProducaoItem.insumo_id == lote.produto_id))).order_by(ApontamentoProducao.id).all()
    for ap in aps:
        usado = ZERO
        for linha in json.loads(ap.consumo or "[]"):
            if int(linha.get("insumo_id") or 0) != lote.produto_id or not linha.get("movimentacao_id"):
                continue
            saida = db.session.get(MovimentacaoEstoque, linha["movimentacao_id"])
            usado += sum((Decimal(str(q)) for lid, q in _lotes_do_movimento(saida) if int(lid) == lote.id), ZERO)
        if usado <= 0:
            continue
        acabado = db.session.get(ProdutoLote, ap.lote_id) if ap.lote_id else None
        usado_em.append({"ordem_id": ap.ordem.id, "numero": ap.ordem.numero, "status": ap.ordem.status,
                         "entrega": ap.sequencia, "estornada": ap.estornado,
                         "produto_nome": ap.ordem.produto.nome, "quantidade_usada": float(usado),
                         "lote_produzido": _lote_info(acabado)})

    # Para frente (acabado): vendas que levaram unidades deste lote.
    vendas = []
    saidas = MovimentacaoEstoque.query.filter(
        MovimentacaoEstoque.estabelecimento_id == estab_id, MovimentacaoEstoque.produto_id == lote.produto_id,
        MovimentacaoEstoque.tipo == "saida", MovimentacaoEstoque.venda_id.isnot(None)
    ).order_by(MovimentacaoEstoque.id.desc()).limit(2000).all()
    for saida in saidas:
        rastro = _lotes_do_movimento(saida)
        if rastro:
            qtd = sum((Decimal(str(q)) for lid, q in rastro if int(lid) == lote.id), ZERO)
        else:
            qtd = _d(saida.quantidade) if saida.lote_id == lote.id else ZERO
        if qtd <= 0:
            continue
        venda = db.session.get(Venda, saida.venda_id)
        cliente = getattr(venda, "cliente", None) if venda else None
        vendas.append({"venda_id": saida.venda_id, "codigo": getattr(venda, "codigo", None),
                       "data": iso_utc(getattr(venda, "data_venda", None)), "status": getattr(venda, "status", None),
                       "quantidade": float(qtd), "cliente": getattr(cliente, "nome", None),
                       "telefone": getattr(cliente, "telefone", None)})
    return {"lote": _lote_info(lote), "produzido_por": origem, "usado_em": usado_em, "vendas": vendas}


# ── Necessidade (MRP simples, vários níveis) ──────────────────────────────

def necessidade_insumos(estab_id):
    """O que comprar e o que produzir para cumprir as ordens abertas (planejadas + em produção).

    Por item: necessidade líquida = previsto - saldo utilizável (estoque - vencido - reservado)
    - pedido de compra a caminho. Item com ficha ativa (semiacabado) vira "produzir" e a
    necessidade líquida dele explode na receita dele; o resto vira "comprar". Os níveis são
    processados do mais alto para o mais baixo, então cada item é calculado uma vez só.
    """
    from app.models import PedidoCompra, PedidoCompraItem
    abertas = OrdemProducao.query.filter(OrdemProducao.estabelecimento_id == estab_id,
                                         OrdemProducao.status.in_(("planejada", "em_producao"))) \
        .options(selectinload(OrdemProducao.itens)).all()
    bruto = defaultdict(Decimal)
    ordens_por_item = defaultdict(set)
    for op in abertas:
        for item in op.itens:
            falta = max(_d(item.quantidade_prevista) - _d(item.quantidade_consumida), ZERO)
            if falta > 0:
                bruto[item.insumo_id] += falta
                ordens_por_item[item.insumo_id].add(op.numero)
    if not bruto:
        return []

    fichas = _fichas_ativas(estab_id)
    nivel = {pid: 0 for pid in bruto}
    pilha = list(bruto)
    while pilha:  # nível = caminho mais longo a partir das OPs (ordem de processamento)
        pid = pilha.pop()
        ficha = fichas.get(pid)
        if not ficha or nivel[pid] >= PROFUNDIDADE_MAXIMA:
            continue
        for item in ficha.itens:
            if nivel.get(item.insumo_id, -1) < nivel[pid] + 1:
                nivel[item.insumo_id] = nivel[pid] + 1
                pilha.append(item.insumo_id)

    ids = list(nivel)
    produtos = {p.id: p for p in Produto.query.filter(Produto.estabelecimento_id == estab_id,
                                                      Produto.id.in_(ids)).all()}
    a_caminho = defaultdict(Decimal)
    pendentes = db.session.query(PedidoCompraItem).join(PedidoCompra, PedidoCompraItem.pedido_id == PedidoCompra.id).filter(
        PedidoCompra.estabelecimento_id == estab_id,
        PedidoCompra.status.in_(("pendente", "parcial", "aprovado", "enviado")),
        PedidoCompraItem.produto_id.in_(ids)).all()
    for item in pendentes:
        saldo = (_d(item.quantidade_solicitada) - _d(item.quantidade_recebida) - _d(item.quantidade_faltante))
        if saldo > 0:
            a_caminho[item.produto_id] += saldo

    linhas = []
    for pid in sorted(ids, key=lambda i: nivel[i]):
        produto = produtos.get(pid)
        precisa = bruto.get(pid, ZERO)
        if not produto or precisa <= 0:
            continue
        disponivel = max(_disponivel(produto), ZERO)
        liquido = max(precisa - disponivel - a_caminho[pid], ZERO)
        ficha = fichas.get(pid)
        produzir = liquido if ficha else ZERO
        comprar = ZERO if ficha else liquido
        if ficha and liquido > 0:
            fator = liquido / _d(ficha.rendimento)
            for item in ficha.itens:
                bruto[item.insumo_id] += _consumo_com_perda(item.quantidade, item.perda_percentual) * fator
                ordens_por_item[item.insumo_id] |= ordens_por_item[pid]
        linhas.append({
            "insumo_id": produto.id, "insumo_nome": produto.nome, "unidade": produto.unidade_medida or "UN",
            "nivel": nivel[pid], "acao": "produzir" if ficha else "comprar",
            "previsto_ordens": float(precisa.quantize(Q4)), "disponivel": float(disponivel),
            "a_caminho": float(a_caminho[pid]),
            "comprar": float(comprar.quantize(Q4)), "produzir": float(produzir.quantize(Q4)),
            "custo_estimado": float((comprar * _d(produto.preco_custo)).quantize(CENT)),
            "ordens": sorted(ordens_por_item[pid]),
        })
    return sorted(linhas, key=lambda x: (-(x["comprar"] + x["produzir"]), x["insumo_nome"]))


# ── Serialização ──────────────────────────────────────────────────────────

def _f(valor):
    return float(valor) if valor is not None else None


def ficha_dict(ficha, com_custo=True, com_capacidade=True):
    dados = {
        "id": ficha.id, "produto_id": ficha.produto_id, "produto_nome": ficha.produto.nome,
        "produto_pai_id": getattr(ficha.produto, "produto_pai_id", None),
        "unidade_produto": ficha.produto.unidade_medida or "UN", "versao": ficha.versao or 1,
        "rendimento": _f(ficha.rendimento), "minutos_mao_de_obra": _f(ficha.minutos_mao_de_obra),
        "custo_hora_mao_de_obra": _f(ficha.custo_hora_mao_de_obra),
        "custo_indireto_percentual": _f(ficha.custo_indireto_percentual),
        "markup_percentual": _f(ficha.markup_percentual), "validade_dias": ficha.validade_dias,
        "observacoes": ficha.observacoes, "ativa": ficha.ativa,
        "itens": [{"insumo_id": i.insumo_id, "insumo_nome": i.insumo.nome,
                   "unidade": i.insumo.unidade_medida or "UN", "quantidade": _f(i.quantidade),
                   "quantidade_receita": _f(i.quantidade_receita), "unidade_receita": i.unidade_receita,
                   "unidades": unidades_compativeis(i.insumo.unidade_medida),
                   "papel": i.insumo.papel_producao or "revenda",
                   "perda_percentual": _f(i.perda_percentual)} for i in ficha.itens],
    }
    if com_custo:
        dados["custo"] = custo_padrao(ficha)
    if com_capacidade:
        dados["capacidade"] = capacidade(ficha)
    return dados


def versoes_dict(ficha):
    from app.utils.timezone import iso_utc
    versoes = FichaTecnicaVersao.query.filter_by(ficha_id=ficha.id, estabelecimento_id=ficha.estabelecimento_id) \
        .order_by(FichaTecnicaVersao.versao.desc()).all()
    saida = []
    for v in versoes:
        dados = json.loads(v.dados or "{}")
        saida.append({"versao": v.versao, "criada_em": iso_utc(v.created_at), "funcionario_id": v.funcionario_id,
                      "rendimento": dados.get("rendimento"), "itens": dados.get("itens", []),
                      "custo_unitario": (dados.get("custo") or {}).get("custo_unitario"),
                      "minutos_mao_de_obra": dados.get("minutos_mao_de_obra"),
                      "custo_hora_mao_de_obra": dados.get("custo_hora_mao_de_obra"),
                      "custo_indireto_percentual": dados.get("custo_indireto_percentual"),
                      "markup_percentual": dados.get("markup_percentual")})
    return saida


def ordem_dict(op):
    from app.utils.timezone import iso_utc
    padrao, real = op.custo_unitario_padrao, op.custo_unitario_real
    variacao = (float(((_d(real) - _d(padrao)) / _d(padrao) * CEM).quantize(CENT))
                if padrao and real is not None and _d(padrao) > 0 else None)
    lote = db.session.get(ProdutoLote, op.lote_id) if op.lote_id else None
    return {
        "variacao_custo_percentual": variacao,
        "lote_numero": lote.numero_lote if lote else None,
        "lote_validade": lote.data_validade.isoformat() if lote and lote.data_validade else None,
        "data_estorno": iso_utc(op.data_estorno), "motivo_estorno": op.motivo_estorno,
        "id": op.id, "numero": op.numero, "status": op.status, "ficha_id": op.ficha_id,
        "ficha_versao": op.ficha_versao, "produto_id": op.produto_id, "produto_nome": op.produto.nome,
        "unidade_produto": op.produto.unidade_medida or "UN",
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
        "apontamentos": [{"sequencia": a.sequencia, "final": a.final, "estornado": a.estornado,
                          "quantidade_boa": _f(a.quantidade_boa), "quantidade_refugo": _f(a.quantidade_refugo),
                          "motivo_refugo": a.motivo_refugo, "custo_unitario": _f(a.custo_unitario),
                          "lote_id": a.lote_id, "criado_em": iso_utc(a.created_at)} for a in op.apontamentos],
    }
