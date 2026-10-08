"""
Serviço de emissão de NFC-e (modelo 65) — Simples Nacional (CSOSN).

Monta o payload a partir da Venda e emite via gateway (factory get_gateway).
Persiste o DocumentoFiscal e controla a numeração por estabelecimento.

Observação de responsabilidade: os defaults tributários (CSOSN 102, CFOP 5102,
PIS/COFINS 49) cobrem o caso típico de mercadinho no Simples revendendo
mercadoria, mas a correção fiscal final é do contador do lojista.
"""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict

from app.models import db, Venda, DocumentoFiscal, Estabelecimento, utcnow
from app.services.fiscal.gateways import get_gateway, SimuladoGateway

# Mapa forma de pagamento (interno → código Focus NFe / SEFAZ)
FORMA_PGTO_COD = {
    "dinheiro": "01", "cheque": "02", "cartao de credito": "03", "cartão de crédito": "03",
    "cartao de debito": "04", "cartão de débito": "04", "credito loja": "05",
    "vale": "10", "voucher": "10", "vale_alimentacao": "10", "vale_refeicao": "11", "pix": "17", "boleto": "15", "fiado": "99", "outros": "99",
}


def _forma_cod(forma: str) -> str:
    return FORMA_PGTO_COD.get((forma or "").strip().lower(), "99")


def _ncm_valido(ncm) -> bool:
    """NCM fiscal válido: exatamente 8 dígitos e não um placeholder (tudo zero)."""
    digits = re.sub(r"\D", "", str(ncm or ""))
    return len(digits) == 8 and digits != "00000000"


def _cfop_valido(cfop) -> bool:
    digits = re.sub(r"\D", "", str(cfop or ""))
    return len(digits) == 4 and digits != "0000"


def _origem_valida(origem) -> bool:
    try:
        valor = int(origem)
    except (TypeError, ValueError):
        return False
    return 0 <= valor <= 8


def _codigo_icms_valido(prod, estab: Estabelecimento) -> bool:
    regime = (getattr(estab, "regime_tributario", "") or "").upper()
    if "SIMPLES" in regime:
        codigo = re.sub(r"\D", "", str(getattr(prod, "csosn", "") or ""))
        return len(codigo) == 3
    codigo = re.sub(r"\D", "", str(getattr(prod, "cst_icms", "") or ""))
    return len(codigo) in (2, 3)


def _codigo_icms_payload(prod, estab: Estabelecimento) -> str:
    regime = (getattr(estab, "regime_tributario", "") or "").upper()
    if "SIMPLES" in regime:
        return re.sub(r"\D", "", str(getattr(prod, "csosn", "") or ""))
    return re.sub(r"\D", "", str(getattr(prod, "cst_icms", "") or ""))


def _validar_ncm_producao(venda: Venda) -> None:
    """Em produção, recusa emitir se algum item não tiver NCM válido — em vez de
    usar o NCM-default e gerar nota com classificação fiscal errada."""
    sem_ncm = []
    for item in venda.itens:
        prod = item.produto
        if not _ncm_valido(getattr(prod, "ncm", None)):
            sem_ncm.append(item.produto_nome or (f"produto #{prod.id}" if prod else "item"))
    if sem_ncm:
        nomes = ", ".join(dict.fromkeys(sem_ncm))  # únicos, preservando ordem
        raise EmissaoError(
            "Não é possível emitir em produção: os produtos a seguir estão sem NCM "
            f"válido (8 dígitos). Cadastre o NCM correto antes de emitir: {nomes}."
        )


def _validar_cadastro_fiscal_producao(venda: Venda, estab: Estabelecimento) -> None:
    itens_invalidos = []
    for item in venda.itens:
        prod = item.produto
        nome = item.produto_nome or (f"produto #{prod.id}" if prod else "item")
        if prod is None:
            itens_invalidos.append(f"{nome}: item sem vinculo de produto")
            continue

        erros = []
        if not _ncm_valido(getattr(prod, "ncm", None)):
            erros.append("NCM invalido")
        if not _cfop_valido(getattr(prod, "cfop_padrao", None)):
            erros.append("CFOP invalido")
        if not _origem_valida(getattr(prod, "origem", None)):
            erros.append("origem invalida")
        if not _codigo_icms_valido(prod, estab):
            regime = (getattr(estab, "regime_tributario", "") or "").upper()
            erros.append("CSOSN ausente/invalido" if "SIMPLES" in regime else "CST ICMS ausente/invalido")

        if erros:
            itens_invalidos.append(f"{nome}: {', '.join(erros)}")

    if itens_invalidos:
        raise EmissaoError(
            "Não é possível emitir em produção: existem produtos com cadastro fiscal "
            f"incompleto ou inválido. Corrija antes de emitir: {'; '.join(itens_invalidos)}."
        )


def _data_emissao(venda: Venda, estab: Estabelecimento) -> str:
    """Data/hora da venda no fuso real do emitente. O banco guarda UTC; antes o offset
    era fixo em -03:00 (errado para AM, AC, RO, RR, MT e MS)."""
    from datetime import timezone
    from app.utils.timezone import fuso_da_uf
    base = venda.data_venda or utcnow()
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base.astimezone(fuso_da_uf(getattr(estab, "estado", None))).isoformat(timespec="seconds")


def _destinatario(venda: Venda) -> Dict[str, Any]:
    """Identifica o comprador na nota quando o cliente cadastrado tem CPF/CNPJ válido."""
    from app.utils.validators import validar_cnpj, validar_cpf
    cliente = getattr(venda, "cliente", None)
    if not cliente:
        return {}
    digitos = re.sub(r"\D", "", cliente.documento or "")
    if len(digitos) == 14 and validar_cnpj(digitos):
        return {"cnpj_destinatario": digitos, "nome_destinatario": (cliente.razao_social or cliente.nome or "")[:60]}
    if len(digitos) == 11 and validar_cpf(digitos):
        return {"cpf_destinatario": digitos, "nome_destinatario": (cliente.nome or "")[:60]}
    return {}


def _build_payload(venda: Venda, estab: Estabelecimento, numero: int, serie: int) -> Dict[str, Any]:
    itens = []
    for i, item in enumerate(venda.itens, start=1):
        prod = item.produto
        cfop = (getattr(prod, "cfop_padrao", None) or "5102")
        codigo_icms = _codigo_icms_payload(prod, estab) or "102"
        unidade = (item.produto_unidade or getattr(prod, "unidade_medida", None) or "UN")
        unidade_tributavel = (
            getattr(prod, "unidade_tributavel", None)
            or unidade
        )
        qtd = float(item.quantidade or 0)
        v_unit = float(item.preco_unitario or 0)
        v_bruto = round(float(item.total_item or (qtd * v_unit)), 2)
        itens.append({
            "numero_item": i,
            "codigo_produto": str(item.produto_codigo or (prod.id if prod else i)),
            "descricao": (item.produto_nome or "Item")[:120],
            "cfop": cfop,
            "unidade_comercial": unidade[:6],
            "quantidade_comercial": qtd,
            "valor_unitario_comercial": v_unit,
            "valor_bruto": v_bruto,
            "unidade_tributavel": unidade_tributavel[:6],
            "quantidade_tributavel": qtd,
            "valor_unitario_tributavel": v_unit,
            "codigo_ncm": getattr(prod, "ncm", None) or "22021000",
            "icms_origem": str(getattr(prod, "origem", 0) or 0),
            "icms_situacao_tributaria": codigo_icms,
            "pis_situacao_tributaria": "49",
            "cofins_situacao_tributaria": "49",
        })
        cest = re.sub(r"\D", "", str(getattr(prod, "cest", "") or ""))
        if len(cest) == 7:
            itens[-1]["codigo_cest"] = cest

    pagamentos = []
    if venda.pagamentos:
        for p in venda.pagamentos:
            pagamentos.append({
                "forma_pagamento": _forma_cod(p.forma_pagamento),
                "valor_pagamento": round(float(p.valor or 0), 2),
            })
    if not pagamentos:
        pagamentos.append({"forma_pagamento": "01", "valor_pagamento": round(float(venda.total or 0), 2)})

    return {
        "modelo": "65",
        "serie": serie,
        "numero": numero,
        "cnpj_emitente": estab.cnpj,
        "natureza_operacao": "Venda ao consumidor",
        "data_emissao": _data_emissao(venda, estab),
        "presenca_comprador": "1",
        "modalidade_frete": "9",
        **_destinatario(venda),
        "items": itens,
        "formas_pagamento": pagamentos,
        # Metadados usados pelo gateway simulado (prefixo _ é removido no envio real)
        "_emitente": {"cnpj": estab.cnpj, "uf": estab.estado, "nome": estab.razao_social},
    }


class EmissaoError(ValueError):
    pass


def emitir_nfce(venda: Venda, estab: Estabelecimento, funcionario_id: int) -> DocumentoFiscal:
    if venda.status != "finalizada":
        raise EmissaoError("Só é possível emitir NFC-e de vendas finalizadas.")

    referencia = f"nfce-{estab.id}-{venda.id}"
    existente = DocumentoFiscal.query.filter_by(
        estabelecimento_id=estab.id, referencia=referencia
    ).first()
    if existente and existente.status in ("autorizado", "processando"):
        return existente  # idempotente: já emitido/em processamento

    serie = int(getattr(estab, "serie_nfce", 1) or 1)
    numero = int(getattr(estab, "proximo_numero_nfce", 1) or 1)
    ambiente = getattr(estab, "fiscal_ambiente", None) or "homologacao"
    gateway = get_gateway(estab)
    gw_nome = (getattr(estab, "fiscal_gateway", None) or "simulado").lower()

    # Trava de segurança: em PRODUÇÃO nunca cair em simulado silenciosamente.
    # Sem isso, uma loja mal configurada acharia que emite nota válida quando
    # na verdade está gerando documento SEM valor fiscal.
    if ambiente == "producao" and isinstance(gateway, SimuladoGateway):
        raise EmissaoError(
            "Emissão em PRODUÇÃO exige gateway fiscal real configurado "
            "(gateway 'focusnfe' + token). Configure as credenciais em "
            "Configurações → Fiscal antes de emitir notas com valor fiscal."
        )

    # Em produção, NCM válido por item é obrigatório (não emitir nota com NCM errado).
    if ambiente == "producao":
        _validar_ncm_producao(venda)
        _validar_cadastro_fiscal_producao(venda, estab)

    payload = _build_payload(venda, estab, numero, serie)

    doc = existente or DocumentoFiscal(
        estabelecimento_id=estab.id, venda_id=venda.id, funcionario_id=funcionario_id,
        tipo="nfce", modelo="65", ambiente=ambiente, gateway=gw_nome,
        referencia=referencia, serie=str(serie), numero=str(numero),
        valor_total=venda.total, status="processando",
    )
    if not existente:
        db.session.add(doc)

    try:
        resp = gateway.emitir(payload, referencia)
    except Exception as e:
        doc.status = "erro"
        doc.motivo_rejeicao = f"Falha de comunicação com o gateway: {e}"
        db.session.commit()
        return doc

    doc.status = resp.get("status", "processando")
    doc.chave_acesso = resp.get("chave")
    doc.protocolo = resp.get("protocolo")
    doc.danfe_url = resp.get("danfe_url")
    doc.xml_url = resp.get("xml_url")
    doc.xml_content = resp.get("xml")
    doc.qr_code = resp.get("qr_code")
    if doc.status == "rejeitado" or doc.status == "erro":
        msg = resp.get("mensagem")
        doc.motivo_rejeicao = str(msg) if msg else "Rejeitado pela SEFAZ"
    if doc.status == "autorizado":
        doc.autorizado_em = utcnow()
        if resp.get("numero"):
            doc.numero = str(resp["numero"])
        # Avança a numeração do estabelecimento somente quando autoriza
        estab.proximo_numero_nfce = numero + 1

    db.session.commit()
    return doc


def cancelar_nfce(doc: DocumentoFiscal, estab: Estabelecimento, justificativa: str) -> DocumentoFiscal:
    if doc.status != "autorizado":
        raise EmissaoError("Só é possível cancelar uma NFC-e autorizada.")
    if not justificativa or len(justificativa.strip()) < 15:
        raise EmissaoError("Justificativa de cancelamento deve ter ao menos 15 caracteres (exigência SEFAZ).")
    gateway = get_gateway(estab)
    resp = gateway.cancelar(doc.referencia, justificativa.strip())
    if resp.get("status") == "cancelado":
        doc.status = "cancelado"
        doc.cancelado_em = utcnow()
        doc.justificativa_cancelamento = justificativa.strip()[:255]
    else:
        doc.motivo_rejeicao = str(resp.get("mensagem") or "Falha ao cancelar")
    db.session.commit()
    return doc
