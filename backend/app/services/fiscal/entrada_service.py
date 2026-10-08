"""
Serviço de importação de NF-e de entrada (compra).

- preview(parsed, estab_id): mostra o que será importado (sem gravar nada).
- importar(parsed, xml, estab_id, func_id, opcoes): efetiva a entrada.

Responsabilidades ao importar:
- Upsert do Fornecedor pelo CNPJ do emitente.
- Para cada item: localiza o Produto (por EAN/código) ou cria um novo.
- Dá entrada no estoque (Produto.quantidade + MovimentacaoEstoque) e recalcula o
  custo médio ponderado (CMP), registrando no histórico de preços.
- Gera Conta a Pagar (pelas duplicatas da nota ou pelo total).
- Registra a NotaFiscalEntrada (idempotente pela chave de acesso) guardando o XML.
"""
from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from app.models import (
    db, Produto, Fornecedor, CategoriaProduto, MovimentacaoEstoque,
    ContaPagar, NotaFiscalEntrada, Estabelecimento, utcnow,
)
from app.services.catalogo_mestre_service import registrar_produto_se_novo

CATEGORIA_IMPORTACAO = "Importação NF-e"


class ImportacaoError(ValueError):
    pass


def _parse_data(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    v = value.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v[:25] if "%z" in fmt else v[:19] if "T" in fmt else v[:10], fmt)
        except ValueError:
            continue
    return None


def _produto_existente(estab_id: int, ean: Optional[str], codigo: Optional[str]) -> Optional[Produto]:
    q = Produto.query.filter(Produto.estabelecimento_id == estab_id)
    if ean:
        p = q.filter(Produto.codigo_barras == ean).first()
        if p:
            return p
    if codigo:
        p = q.filter(Produto.codigo_interno == codigo).first()
        if p:
            return p
    return None


def _get_or_create_categoria_importacao(estab_id: int) -> CategoriaProduto:
    cat = CategoriaProduto.query.filter_by(estabelecimento_id=estab_id, nome=CATEGORIA_IMPORTACAO).first()
    if not cat:
        cat = CategoriaProduto(estabelecimento_id=estab_id, nome=CATEGORIA_IMPORTACAO,
                               descricao="Produtos cadastrados automaticamente via importação de XML")
        db.session.add(cat)
        db.session.flush()
    return cat


def _upsert_fornecedor(estab_id: int, emit: Dict[str, Any]) -> Optional[Fornecedor]:
    cnpj = emit.get("cnpj") or ""
    if not cnpj:
        return None
    forn = Fornecedor.query.filter_by(estabelecimento_id=estab_id, cnpj=cnpj).first()
    if forn:
        return forn
    nome = emit.get("nome") or "Fornecedor sem nome"
    forn = Fornecedor(
        estabelecimento_id=estab_id,
        razao_social=nome[:150],
        nome_fantasia=(emit.get("fantasia") or nome)[:150],
        cnpj=cnpj,
        inscricao_estadual=emit.get("ie"),
        telefone=(emit.get("telefone") or "Não informado")[:30],
        email="naoinformado@fornecedor.local",
        cep=(emit.get("cep") or "00000000")[:9],
        logradouro=(emit.get("logradouro") or "Não informado")[:200],
        numero=(emit.get("numero") or "S/N")[:10],
        bairro=(emit.get("bairro") or "Não informado")[:100],
        cidade=(emit.get("municipio") or "Não informado")[:100],
        estado=(emit.get("uf") or "NA")[:2],
    )
    db.session.add(forn)
    db.session.flush()
    return forn


def preview(parsed: Dict[str, Any], estab_id: int) -> Dict[str, Any]:
    """Monta a prévia da importação sem gravar nada."""
    chave = parsed["chave_acesso"]
    ja_importada = NotaFiscalEntrada.query.filter_by(
        estabelecimento_id=estab_id, chave_acesso=chave
    ).first() is not None

    fornecedor = Fornecedor.query.filter_by(
        estabelecimento_id=estab_id, cnpj=parsed["emitente"]["cnpj"]
    ).first() if parsed["emitente"].get("cnpj") else None

    itens_preview: List[Dict[str, Any]] = []
    for it in parsed["itens"]:
        prod = _produto_existente(estab_id, it.get("ean"), it.get("codigo"))
        itens_preview.append({
            "descricao": it["descricao"],
            "ean": it["ean"],
            "codigo": it["codigo"],
            "ncm": it["ncm"],
            "quantidade": float(it["quantidade"]),
            "valor_unitario": float(it["valor_unitario"]),
            "valor_total": float(it["valor_total"]),
            "produto_existente": prod is not None,
            "produto_id": prod.id if prod else None,
            "produto_nome": prod.nome if prod else None,
            "acao": "atualizar_estoque" if prod else "criar_produto",
        })

    return {
        "chave_acesso": chave,
        "ja_importada": ja_importada,
        "numero": parsed["numero"], "serie": parsed["serie"],
        "data_emissao": parsed["data_emissao"],
        "natureza_operacao": parsed["natureza_operacao"],
        "emitente": parsed["emitente"],
        "fornecedor_cadastrado": fornecedor.to_dict() if fornecedor else None,
        "total": float(parsed["total"]),
        "qtd_itens": len(parsed["itens"]),
        "duplicatas": [{"numero": d["numero"], "vencimento": d["vencimento"], "valor": float(d["valor"])}
                       for d in parsed["duplicatas"]],
        "itens": itens_preview,
    }


def importar(parsed: Dict[str, Any], xml_text: str, estab_id: int, funcionario_id: int,
             markup_padrao: Decimal = Decimal("30")) -> Dict[str, Any]:
    """Efetiva a importação da NF-e de entrada. Idempotente pela chave de acesso."""
    chave = parsed["chave_acesso"]
    if NotaFiscalEntrada.query.filter_by(estabelecimento_id=estab_id, chave_acesso=chave).first():
        raise ImportacaoError("Esta nota já foi importada (chave de acesso duplicada).")

    forn = _upsert_fornecedor(estab_id, parsed["emitente"])
    categoria = None
    estabelecimento = Estabelecimento.query.get(estab_id)

    produtos_criados = 0
    produtos_atualizados = 0

    for it in parsed["itens"]:
        qtd = Decimal(str(it["quantidade"]))
        custo_unit = Decimal(str(it["valor_unitario"]))
        prod = _produto_existente(estab_id, it.get("ean"), it.get("codigo"))

        if prod is None:
            if categoria is None:
                categoria = _get_or_create_categoria_importacao(estab_id)
            preco_venda = (custo_unit * (1 + markup_padrao / 100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            prod = Produto(
                estabelecimento_id=estab_id,
                categoria_id=categoria.id,
                fornecedor_id=forn.id if forn else None,
                codigo_barras=it.get("ean"),
                codigo_interno=it.get("codigo"),
                nome=(it["descricao"] or "Produto importado")[:100],
                unidade_medida=(it.get("unidade") or "UN")[:20],
                quantidade=Decimal("0"),
                preco_custo=custo_unit,
                preco_venda=preco_venda,
                margem_lucro=markup_padrao,
                ncm=it.get("ncm"),
                cfop_padrao=it.get("cfop") or "5102",
                cest=it.get("cest"),
                # A NF-e não informa validade; o operador liga o controle para perecíveis.
                controlar_validade=False,
            )
            db.session.add(prod)
            db.session.flush()
            registrar_produto_se_novo(prod, estabelecimento, via="xml")
            produtos_criados += 1
        else:
            # Recalcula custo médio ponderado e registra no histórico de preços
            prod.recalcular_preco_custo_ponderado(
                quantidade_entrada=qtd, custo_unitario_entrada=custo_unit,
                registrar_historico=True, funcionario_id=funcionario_id,
                motivo=f"Entrada NF-e {parsed['numero']}",
            )
            if forn and not prod.fornecedor_id:
                prod.fornecedor_id = forn.id
            produtos_atualizados += 1

        # Entrada de estoque + movimentação
        qtd_anterior = Decimal(str(prod.quantidade or 0))
        prod.quantidade = qtd_anterior + qtd
        db.session.add(MovimentacaoEstoque(
            estabelecimento_id=estab_id, produto_id=prod.id, funcionario_id=funcionario_id,
            tipo="entrada", quantidade=qtd, quantidade_anterior=qtd_anterior,
            quantidade_atual=prod.quantidade, custo_unitario=custo_unit,
            valor_total=custo_unit * qtd,
            motivo=f"Entrada NF-e {parsed['numero']}/{parsed['serie']}",
            observacoes=f"Importação XML chave {chave}",
        ))

    # Contas a pagar (duplicatas ou total único)
    data_emissao = _parse_data(parsed.get("data_emissao"))
    contas_geradas = 0
    duplicatas = parsed.get("duplicatas") or []
    if duplicatas:
        for d in duplicatas:
            venc = _parse_data(d.get("vencimento"))
            db.session.add(ContaPagar(
                estabelecimento_id=estab_id, fornecedor_id=forn.id if forn else None,
                numero_documento=f"{parsed['numero']}-{d.get('numero') or '1'}",
                tipo_documento="duplicata",
                valor_original=d["valor"], valor_atual=d["valor"], valor_pago=Decimal("0"),
                data_emissao=(data_emissao.date() if data_emissao else date.today()),
                data_vencimento=(venc.date() if venc else date.today()),
                status="aberto",
                observacoes=f"NF-e {parsed['numero']} - {parsed['emitente'].get('nome')}",
            ))
            contas_geradas += 1
    elif parsed["total"] and parsed["total"] > 0:
        db.session.add(ContaPagar(
            estabelecimento_id=estab_id, fornecedor_id=forn.id if forn else None,
            numero_documento=str(parsed["numero"]), tipo_documento="nota_fiscal",
            valor_original=parsed["total"], valor_atual=parsed["total"], valor_pago=Decimal("0"),
            data_emissao=(data_emissao.date() if data_emissao else date.today()),
            data_vencimento=(data_emissao.date() if data_emissao else date.today()),
            status="aberto",
            observacoes=f"NF-e {parsed['numero']} - {parsed['emitente'].get('nome')}",
        ))
        contas_geradas += 1

    # Atualiza agregados do fornecedor
    if forn:
        forn.total_compras = (forn.total_compras or 0) + 1
        forn.valor_total_comprado = Decimal(str(forn.valor_total_comprado or 0)) + Decimal(str(parsed["total"]))

    nota = NotaFiscalEntrada(
        estabelecimento_id=estab_id, fornecedor_id=forn.id if forn else None,
        funcionario_id=funcionario_id, chave_acesso=chave, modelo=parsed.get("modelo", "55"),
        numero=parsed.get("numero"), serie=parsed.get("serie"),
        natureza_operacao=parsed.get("natureza_operacao"),
        emitente_cnpj=parsed["emitente"].get("cnpj"), emitente_nome=parsed["emitente"].get("nome"),
        data_emissao=data_emissao, valor_total=parsed["total"], qtd_itens=len(parsed["itens"]),
        status="importada", xml_content=xml_text,
    )
    db.session.add(nota)
    db.session.commit()

    return {
        "nota_id": nota.id, "chave_acesso": chave,
        "produtos_criados": produtos_criados, "produtos_atualizados": produtos_atualizados,
        "contas_pagar_geradas": contas_geradas,
        "fornecedor_id": forn.id if forn else None,
        "valor_total": float(parsed["total"]),
    }
