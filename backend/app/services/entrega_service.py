"""Transições logísticas e acerto financeiro, na transação da venda."""
import json
import re
from decimal import Decimal

from app.models import (db, Auditoria, EntregaItem, Motorista, Veiculo, Pagamento,
                        Caixa, MovimentacaoCaixa, RastreamentoEntrega, utcnow)
from app.decorators.rbac import nivel_do_role
from app.utils.sale_validation import number, validate_payments

TRANSICOES = {
    "pendente": {"em_preparo", "em_rota", "cancelada"},
    "em_preparo": {"em_rota", "cancelada"},
    "em_rota": {"entregue", "cancelada"},
    "entregue": set(), "cancelada": set(),
}


class EntregaError(ValueError):
    def __init__(self, mensagem, status=400):
        super().__init__(mensagem)
        self.status = status


def _motorista(entrega, motorista_id):
    motorista = Motorista.query.filter_by(
        id=motorista_id, estabelecimento_id=entrega.estabelecimento_id,
        ativo=True).populate_existing().with_for_update().first()
    if not motorista:
        raise EntregaError("Selecione um motorista ativo desta loja")
    return motorista


def atualizar_status(entrega, venda, usuario, data):
    novo = data.get("status")
    if not isinstance(novo, str) or novo not in TRANSICOES:
        raise EntregaError("Status de entrega inválido")
    nivel = nivel_do_role(usuario.role)
    if not usuario.is_super_admin and nivel not in {1, 2, 4, 5, 6}:
        raise EntregaError("Sem permissão para atualizar entregas", 403)
    motorista_id = entrega.motorista_id or data.get("motorista_id")
    motorista = None
    if nivel == 6 and not usuario.is_super_admin:
        motorista = _motorista(entrega, motorista_id)
        cpf = lambda value: re.sub(r"\D", "", value or "")
        if not cpf(usuario.cpf) or cpf(usuario.cpf) != cpf(motorista.cpf):
            raise EntregaError("Esta entrega pertence a outro motorista", 403)
    if entrega.status == novo:
        return  # Repetir a confirmação não muda horário, itens ou indicadores.
    if novo not in TRANSICOES.get(entrega.status, set()):
        raise EntregaError("Transição de entrega não permitida", 409)
    if venda.status != "finalizada" and novo != "cancelada":
        raise EntregaError("A venda não está finalizada", 409)
    agora = utcnow()
    if novo == "em_rota":
        motorista = motorista or _motorista(entrega, motorista_id)
        veiculo_id = data.get("veiculo_id") or entrega.veiculo_id
        if veiculo_id and not Veiculo.query.filter_by(
                id=veiculo_id, estabelecimento_id=entrega.estabelecimento_id,
                ativo=True).first():
            raise EntregaError("Selecione um veículo ativo desta loja")
        entrega.motorista_id = motorista.id
        entrega.veiculo_id = veiculo_id
        entrega.data_saida = agora
    elif novo == "entregue":
        motorista = motorista or _motorista(entrega, entrega.motorista_id)
        entrega.data_entrega = agora
        entrega.tempo_real_minutos = max(0, int((agora - entrega.data_saida).total_seconds() / 60)) if entrega.data_saida else None
        motorista.total_entregas = int(motorista.total_entregas or 0) + 1
        if entrega.veiculo_id:
            veiculo = Veiculo.query.filter_by(id=entrega.veiculo_id,
                estabelecimento_id=entrega.estabelecimento_id).populate_existing().with_for_update().first()
            if veiculo:
                veiculo.total_entregas = int(veiculo.total_entregas or 0) + 1
        for item in EntregaItem.query.filter_by(entrega_id=entrega.id).all():
            item.quantidade_entregue = item.quantidade
            item.status = "entregue"
    elif novo == "cancelada":
        motivo = data.get("observacao")
        if not isinstance(motivo, str) or not motivo.strip():
            raise EntregaError("Informe o motivo do cancelamento da entrega")
        entrega.data_cancelamento = agora
        entrega.motivo_cancelamento = motivo.strip()[:255]
    entrega.status = novo
    db.session.add(RastreamentoEntrega(
        entrega_id=entrega.id, status=novo,
        observacao=str(data.get("observacao") or f"Status alterado para {novo}")[:255],
        latitude=data.get("latitude"), longitude=data.get("longitude")))
    Auditoria.registrar(estabelecimento_id=entrega.estabelecimento_id,
                       tipo_evento="entrega_status", usuario_id=usuario.id,
                       descricao=f"Entrega {entrega.codigo_rastreamento}: {novo}")


def receber(entrega, venda, usuario, data):
    if not usuario.is_super_admin and nivel_do_role(usuario.role) not in {1, 2, 4}:
        raise EntregaError("O acerto deve ser registrado pelo caixa ou pela gestão", 403)
    chave = data.get("chave_operacao")
    if not isinstance(chave, str) or not re.fullmatch(r"[A-Za-z0-9-]{8,64}", chave):
        raise EntregaError("Identificador do acerto inválido")
    pagamentos = data.get("pagamentos")
    if not isinstance(pagamentos, list) or not pagamentos or len(pagamentos) > 20:
        raise EntregaError("Informe os pagamentos recebidos")
    normalizados = []
    for p in pagamentos:
        if not isinstance(p, dict):
            raise EntregaError("Pagamento inválido")
        forma = p.get("forma_pagamento", p.get("forma"))
        if forma not in {"dinheiro", "pix", "cartao_credito", "cartao_debito"}:
            raise EntregaError("Forma de pagamento inválida para o acerto")
        valor = number(p.get("valor"), "Pagamento", positive=True)
        if valor != valor.quantize(Decimal("0.01")):
            raise EntregaError("Pagamento deve ter no máximo duas casas decimais")
        normalizados.append({"forma_pagamento": forma, "valor": str(valor.quantize(Decimal("0.01")))})
    assinatura = json.dumps(normalizados, sort_keys=True)
    registros = Pagamento.query.filter_by(venda_id=venda.id, estabelecimento_id=entrega.estabelecimento_id)\
        .order_by(Pagamento.id).populate_existing().with_for_update().all()
    if venda.status != "finalizada" or entrega.status == "cancelada":
        raise EntregaError("Não é possível receber uma venda ou entrega cancelada", 409)
    for p in registros:
        try:
            anterior = json.loads(p.observacoes or "{}")
        except (TypeError, ValueError):
            continue
        if isinstance(anterior, dict) and anterior.get("acerto_entrega") == chave:
            if anterior.get("pagamentos") != assinatura:
                raise EntregaError("Identificador já usado com outros pagamentos", 409)
            return
    pendentes = [p for p in registros if p.forma_pagamento == "entrega" and p.status == "pendente"]
    if len(pendentes) != 1 or entrega.pagamento_status == "pago":
        raise EntregaError("Esta entrega não possui pagamento pendente para acerto", 409)
    pendente = pendentes[0]
    total = Decimal(str(pendente.valor))
    recebido = validate_payments(normalizados, total)
    if recebido < total:
        raise EntregaError("Valor recebido é menor que o saldo da entrega")
    caixa = Caixa.query.filter_by(estabelecimento_id=entrega.estabelecimento_id,
                                 funcionario_id=usuario.id, status="aberto")\
        .order_by(Caixa.id).populate_existing().with_for_update().first()
    if any(p["forma_pagamento"] == "dinheiro" for p in normalizados) and not caixa:
        raise EntregaError("Abra seu caixa para registrar o dinheiro recebido", 403)
    agora = utcnow()
    troco = recebido - total
    restante_troco = troco
    for i, p in enumerate(normalizados):
        pagamento = pendente if i == 0 else Pagamento(
            estabelecimento_id=entrega.estabelecimento_id, venda_id=venda.id)
        pagamento.forma_pagamento = p["forma_pagamento"]
        pagamento.valor = Decimal(p["valor"])
        pagamento.status = "aprovado"
        pagamento.data_pagamento = agora
        pagamento.observacoes = json.dumps({"acerto_entrega": chave, "pagamentos": assinatura,
                                            "usuario_id": usuario.id, "saldo_anterior": str(total)})
        db.session.add(pagamento)
        entrada = pagamento.valor
        if pagamento.forma_pagamento == "dinheiro":
            abatido = min(restante_troco, entrada)
            entrada -= abatido
            restante_troco -= abatido
            caixa.saldo_atual = Decimal(str(caixa.saldo_atual or 0)) + entrada
        if caixa:
            db.session.add(MovimentacaoCaixa(caixa_id=caixa.id,
                estabelecimento_id=entrega.estabelecimento_id, venda_id=venda.id,
                tipo="venda", forma_pagamento=pagamento.forma_pagamento, valor=entrada,
                descricao=f"Acerto entrega {entrega.codigo_rastreamento}"))
    venda.valor_recebido = Decimal(str(venda.valor_recebido or 0)) + recebido
    venda.troco = Decimal(str(venda.troco or 0)) + troco
    entrega.pagamento_status = "pago"
    Auditoria.registrar(estabelecimento_id=entrega.estabelecimento_id,
        tipo_evento="entrega_recebimento", usuario_id=usuario.id, valor=total,
        descricao=f"Acerto entrega {entrega.codigo_rastreamento}",
        detalhes={"chave_operacao": chave, "pagamentos": normalizados, "troco": str(troco)})
