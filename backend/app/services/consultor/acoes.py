"""Motor de Ações Confirmáveis e Resumo Diário Proativo do Consultor da Loja (Fase 2+).

Princípios:
- A IA sugere ações estruturadas a partir dos dados reais da loja ou da intenção do lojista.
- O lojista confirma explicitamente na UI antes de qualquer escrita.
- Apenas ações na ACOES_WHITELIST podem ser executadas:
    1) `criar_lembrete` -> registra um lembrete auditado e cria Despesa futura/agenda
    2) `gerar_pedido_compra` -> cria um PedidoCompra em rascunho (`status="pendente"`) + itens
    3) `cadastrar_produto` -> cadastra um Produto já classificado na Taxonomia Oficial (Família/Categoria/Subcategoria/NCM)
- Toda execução grava trilha dupla de auditoria: `ConsultorInteracao` (com autor real) e `Auditoria`.
"""
import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from app import db
from app.models import (
    Auditoria,
    ConsultorInteracao,
    Despesa,
    Fornecedor,
    PedidoCompra,
    PedidoCompraItem,
    Produto,
)
from app.services.consultor.contextos.sistema import (
    classificar_produto_por_nome,
    extrair_intencao_cadastro_produto,
)
from app.services.taxonomia_service import garantir_categoria_loja, resolver
from app.utils.timezone import hoje_local, now_utc

ACOES_WHITELIST = frozenset({"criar_lembrete", "gerar_pedido_compra", "cadastrar_produto"})

# Cache em memória do resumo diário proativo: {(estabelecimento_id, "YYYY-MM-DD"): payload_dict}
_RESUMO_DIARIO_CACHE: dict[tuple[int, str], dict[str, Any]] = {}


def limpar_cache_resumo_diario() -> None:
    """Limpa o cache do resumo diário (útil em testes e invalidações manuais)."""
    _RESUMO_DIARIO_CACHE.clear()


def obter_resumo_diario_cache(estabelecimento_id: int) -> dict[str, Any] | None:
    if not estabelecimento_id or str(estabelecimento_id).lower() == "all":
        return None
    chave = (int(estabelecimento_id), hoje_local().isoformat())
    return _RESUMO_DIARIO_CACHE.get(chave)


def salvar_resumo_diario_cache(estabelecimento_id: int, payload: dict[str, Any]) -> None:
    if not estabelecimento_id or str(estabelecimento_id).lower() == "all":
        return
    chave = (int(estabelecimento_id), hoje_local().isoformat())
    _RESUMO_DIARIO_CACHE[chave] = payload


def sugerir_acoes(
    estabelecimento_id: int | str,
    especialista: str = "geral",
    is_manager: bool = False,
    pergunta: str = "",
) -> list[dict[str, Any]]:
    """Inspeciona o estado determinístico da loja e a pergunta do usuário para sugerir ações da whitelist."""
    if not is_manager or not estabelecimento_id or str(estabelecimento_id).lower() == "all":
        return []

    est_id = int(estabelecimento_id)
    sugestoes: list[dict[str, Any]] = []

    # 0. Se o usuário pediu ajuda para cadastrar um produto específico no chat (ex.: Projetor)
    if pergunta:
        intencao_prod = extrair_intencao_cadastro_produto(pergunta)
        if intencao_prod:
            sugestoes.append({
                "acao": "cadastrar_produto",
                "rotulo": f"Cadastrar '{intencao_prod['nome'][:32]}' (R$ {intencao_prod['preco_venda']:.2f})",
                "descricao": (
                    f"Família: {intencao_prod['familia_nome']} › {intencao_prod['categoria_nome']} | "
                    f"NCM {intencao_prod['ncm']} | Custo R$ {intencao_prod['preco_custo']:.2f} | "
                    f"Venda R$ {intencao_prod['preco_venda']:.2f} | Estoque {intencao_prod['quantidade']}"
                ),
                "confirmacao": (
                    f"Deseja confirmar o cadastro imediato do produto '{intencao_prod['nome']}' "
                    f"na categoria '{intencao_prod['familia_nome']} › {intencao_prod['categoria_nome']}'?"
                ),
                "parametros": intencao_prod,
            })

    # 1. Sugerir rascunho de pedido de compra se houver produtos abaixo do mínimo com fornecedor
    if especialista in ("geral", "estoque", "compras", "fornecedores"):
        criticos = (
            Produto.query.filter(
                Produto.estabelecimento_id == est_id,
                Produto.ativo.is_(True),
                Produto.fornecedor_id.isnot(None),
                Produto.quantidade <= Produto.quantidade_minima,
            )
            .order_by(Produto.quantidade.asc())
            .limit(10)
            .all()
        )
        if criticos:
            forn_id = criticos[0].fornecedor_id
            forn = db.session.get(Fornecedor, forn_id)
            itens_forn = [p for p in criticos if p.fornecedor_id == forn_id][:5]
            if forn and itens_forn:
                itens_payload = []
                for p in itens_forn:
                    faltante = max(
                        Decimal("1"),
                        Decimal(str(p.quantidade_minima or 10)) - Decimal(str(p.quantidade or 0)),
                    )
                    itens_payload.append({
                        "produto_id": p.id,
                        "nome": p.nome,
                        "quantidade": float(faltante),
                        "preco_unitario": float(p.preco_custo or 1),
                    })
                nomes_curtos = ", ".join(p.nome for p in itens_forn[:2])
                sugestoes.append({
                    "acao": "gerar_pedido_compra",
                    "rotulo": f"Gerar rascunho de compra ({forn.nome_fantasia})",
                    "descricao": f"Repor {len(itens_payload)} item(ns) abaixo do mínimo ({nomes_curtos}).",
                    "confirmacao": (
                        f"Deseja criar um rascunho de pedido de compra para {forn.nome_fantasia} "
                        f"com {len(itens_payload)} item(ns)?"
                    ),
                    "parametros": {
                        "fornecedor_id": forn.id,
                        "observacoes": "Rascunho sugerido pelo Consultor da Loja (reposição de estoque mínimo).",
                        "itens": itens_payload,
                    },
                })

    # 2. Sugerir lembrete financeiro/operacional
    if especialista in ("geral", "financeiro", "vendas", "estoque"):
        hoje = hoje_local()
        amanha = hoje + timedelta(days=1)
        sugestoes.append({
            "acao": "criar_lembrete",
            "rotulo": "Agendar lembrete de revisão de caixa e estoque",
            "descricao": "Cria um lembrete pendente no painel financeiro para acompanhamento amanhã.",
            "confirmacao": "Deseja registrar este lembrete na agenda financeira da loja?",
            "parametros": {
                "titulo": f"Revisão recomendada pelo Consultor da Loja ({especialista})",
                "descricao": f"Revisão recomendada pelo Consultor da Loja ({especialista})",
                "categoria": "Operacional",
                "valor": 0.0,
                "data_vencimento": amanha.isoformat(),
                "observacoes": "Gerado com confirmação pelo Consultor da Loja.",
            },
        })

    return sugestoes


def _proximo_numero_pedido(estabelecimento_id: int) -> str:
    prefixo = f"PC-IA-{hoje_local().strftime('%Y%m%d')}-"
    existentes = PedidoCompra.query.filter(
        PedidoCompra.estabelecimento_id == estabelecimento_id,
        PedidoCompra.numero_pedido.like(f"{prefixo}%"),
    ).count()
    return f"{prefixo}{existentes + 1:03d}"


def executar_acao_confirmada(
    estabelecimento_id: int,
    funcionario_id: int | None,
    acao: str,
    parametros: dict[str, Any] | None,
) -> tuple[dict[str, Any], int]:
    """Executa uma ação previamente confirmada pelo gestor, respeitando whitelist e isolamento multi-tenant."""
    if not acao or acao not in ACOES_WHITELIST:
        return (
            {
                "success": False,
                "error": f"Ação '{acao}' não permitida. Apenas ações da whitelist ({sorted(ACOES_WHITELIST)}) são aceitas.",
            },
            400,
        )

    params = parametros or {}
    extra_fields: dict[str, Any] = {}
    valor_auditoria = Decimal("0.00")

    if acao == "criar_lembrete":
        titulo = str(params.get("titulo") or params.get("descricao") or "").strip()[:200]
        if not titulo:
            return {"success": False, "error": "Título ou descrição do lembrete é obrigatório."}, 400

        observacoes = str(params.get("observacoes") or "Criado pelo Consultor da Loja mediante confirmação.").strip()
        categoria = str(params.get("categoria") or "Operacional").strip()[:50]
        try:
            valor = Decimal(str(params.get("valor", 0) or 0))
            if valor < 0:
                raise ValueError("Valor negativo")
        except Exception:
            return {"success": False, "error": "Valor inválido para o lembrete."}, 400

        data_str = params.get("data_vencimento")
        if data_str:
            try:
                vencimento = date.fromisoformat(str(data_str)[:10])
            except ValueError:
                return {"success": False, "error": "data_vencimento inválida (use YYYY-MM-DD)."}, 400
        else:
            vencimento = hoje_local() + timedelta(days=1)

        lembrete = Despesa(
            estabelecimento_id=estabelecimento_id,
            descricao=f"[Lembrete IA] {titulo}"[:200],
            categoria=categoria,
            tipo="variavel",
            valor=valor,
            data_despesa=hoje_local(),
            data_emissao=hoje_local(),
            data_vencimento=vencimento,
            recorrente=False,
            observacoes=observacoes,
        )
        db.session.add(lembrete)
        db.session.flush()

        tipo_evento_audit = "lembrete_consultor"
        descricao_audit = f"Lembrete criado via Consultor da Loja: {titulo} — {observacoes}"[:500]
        valor_auditoria = valor
        entidade_info = {
            "tipo": "lembrete",
            "id": lembrete.id,
            "titulo": titulo,
            "descricao": lembrete.descricao,
            "data_vencimento": lembrete.data_vencimento.isoformat(),
        }
        resumo_resposta = f"Lembrete #{lembrete.id} ('{titulo}') criado para {lembrete.data_vencimento.isoformat()}."

    elif acao == "gerar_pedido_compra":
        fornecedor_id = params.get("fornecedor_id")
        itens = params.get("itens") or []
        if not fornecedor_id or not isinstance(itens, list) or len(itens) == 0:
            return {"success": False, "error": "fornecedor_id e lista de itens são obrigatórios."}, 400

        fornecedor = Fornecedor.query.filter_by(
            id=int(fornecedor_id),
            estabelecimento_id=estabelecimento_id,
        ).first()
        if not fornecedor:
            return {"success": False, "error": "Fornecedor não encontrado neste estabelecimento."}, 404

        numero_pedido = _proximo_numero_pedido(estabelecimento_id)
        pedido = PedidoCompra(
            estabelecimento_id=estabelecimento_id,
            fornecedor_id=fornecedor.id,
            funcionario_id=funcionario_id,
            numero_pedido=numero_pedido,
            data_pedido=now_utc(),
            status="pendente",
            observacoes=str(
                params.get("observacoes")
                or "Rascunho gerado pelo Consultor da Loja mediante confirmação do gestor."
            ),
        )
        db.session.add(pedido)
        db.session.flush()

        subtotal = Decimal("0.00")
        itens_criados = 0
        for item_raw in itens[:30]:
            prod_id = item_raw.get("produto_id")
            if not prod_id:
                continue
            produto = Produto.query.filter_by(
                id=int(prod_id),
                estabelecimento_id=estabelecimento_id,
            ).first()
            if not produto:
                continue

            qtd = max(Decimal("1"), Decimal(str(item_raw.get("quantidade") or 1)))
            preco_unit = Decimal(str(item_raw.get("preco_unitario") or produto.preco_custo or 1))
            if preco_unit <= 0:
                preco_unit = Decimal("1.00")
            total_item = (qtd * preco_unit).quantize(Decimal("0.01"))

            item_db = PedidoCompraItem(
                estabelecimento_id=estabelecimento_id,
                pedido_id=pedido.id,
                produto_id=produto.id,
                produto_nome=produto.nome,
                produto_unidade=produto.unidade_medida or "UN",
                quantidade_solicitada=qtd,
                preco_unitario=preco_unit,
                total_item=total_item,
                status="pendente",
            )
            db.session.add(item_db)
            subtotal += total_item
            itens_criados += 1

        if itens_criados == 0:
            db.session.rollback()
            return {"success": False, "error": "Nenhum produto válido da loja foi informado para o pedido."}, 400

        pedido.subtotal = subtotal
        pedido.total = subtotal
        db.session.flush()

        tipo_evento_audit = "pedido_compra_consultor"
        descricao_audit = (
            f"Rascunho de Pedido de Compra {pedido.numero_pedido} criado via Consultor da Loja "
            f"para fornecedor #{fornecedor.id} ({itens_criados} itens)."
        )[:500]
        valor_auditoria = subtotal
        extra_fields["pedido_compra_id"] = pedido.id
        entidade_info = {
            "tipo": "pedido_compra",
            "id": pedido.id,
            "numero_pedido": pedido.numero_pedido,
            "fornecedor_id": fornecedor.id,
            "status": pedido.status,
            "total": float(pedido.total),
            "itens_count": itens_criados,
        }
        resumo_resposta = (
            f"Rascunho de Pedido de Compra {pedido.numero_pedido} criado com status '{pedido.status}' "
            f"({itens_criados} item(ns), total R$ {float(pedido.total):.2f})."
        )

    elif acao == "cadastrar_produto":
        nome = str(params.get("nome") or "").strip().upper()[:150]
        if len(nome) < 2:
            return {"success": False, "error": "Nome do produto é obrigatório para o cadastro."}, 400

        classificado = classificar_produto_por_nome(nome=nome, marca=str(params.get("marca") or ""))
        familia_produto = str(params.get("familia_produto") or classificado["familia_produto"]).strip()
        sub_informada = str(params.get("subcategoria") or classificado["subcategoria"]).strip()

        resolvido = resolver(familia_produto, sub_informada)
        if not resolvido:
            resolvido = (classificado["categoria_oficial"], classificado["subcategoria"])
            familia_produto = classificado["familia_produto"]
        chave_cat, chave_sub = resolvido

        categoria_loja = garantir_categoria_loja(estabelecimento_id, chave_cat)

        try:
            preco_custo = Decimal(str(params.get("preco_custo") or 50)).quantize(Decimal("0.01"))
            if preco_custo <= 0:
                preco_custo = Decimal("50.00")
            preco_venda = Decimal(str(params.get("preco_venda") or (preco_custo * Decimal("1.4")))).quantize(
                Decimal("0.01")
            )
            if preco_venda <= 0:
                preco_venda = (preco_custo * Decimal("1.4")).quantize(Decimal("0.01"))
            margem = (((preco_venda - preco_custo) / preco_custo) * Decimal("100")).quantize(Decimal("0.01"))
        except Exception:
            return {"success": False, "error": "Preços de custo/venda inválidos."}, 400

        quantidade = max(Decimal("0"), Decimal(str(params.get("quantidade") or 1)))
        ncm = str(params.get("ncm") or classificado["ncm"]).replace(".", "")[:8]
        cfop = str(params.get("cfop_padrao") or classificado["cfop_padrao"])[:4]
        csosn = str(params.get("csosn") or classificado["csosn"])[:3]
        unidade = str(params.get("unidade_medida") or classificado["unidade_medida"] or "un")[:10]
        descricao_prod = str(params.get("descricao") or classificado["descricao"])[:500]
        atributos = params.get("atributos") if isinstance(params.get("atributos"), dict) else classificado["atributos"]

        novo_produto = Produto(
            estabelecimento_id=estabelecimento_id,
            categoria_id=categoria_loja.id,
            nome=nome,
            descricao=descricao_prod,
            familia_produto=familia_produto,
            categoria_oficial=chave_cat,
            subcategoria_oficial=chave_sub,
            ncm=ncm,
            cfop_padrao=cfop,
            csosn=csosn,
            unidade_medida=unidade,
            preco_custo=preco_custo,
            preco_venda=preco_venda,
            margem_lucro=margem,
            quantidade=quantidade,
            quantidade_minima=Decimal(str(params.get("quantidade_minima") or 2)),
            controlar_estoque=True,
            ativo=True,
            atributos_json=json.dumps(atributos, ensure_ascii=False) if atributos else None,
        )
        db.session.add(novo_produto)
        db.session.flush()

        tipo_evento_audit = "cadastro_produto_consultor"
        descricao_audit = (
            f"Produto #{novo_produto.id} ('{novo_produto.nome}') cadastrado via Consultor da Loja "
            f"na família '{familia_produto}' / subcategoria '{chave_sub}'."
        )[:500]
        valor_auditoria = preco_venda
        extra_fields["produto_id"] = novo_produto.id
        entidade_info = {
            "tipo": "produto",
            "id": novo_produto.id,
            "nome": novo_produto.nome,
            "familia_produto": novo_produto.familia_produto,
            "categoria_oficial": novo_produto.categoria_oficial,
            "subcategoria_oficial": novo_produto.subcategoria_oficial,
            "ncm": novo_produto.ncm,
            "preco_custo": float(novo_produto.preco_custo),
            "preco_venda": float(novo_produto.preco_venda),
            "quantidade": float(novo_produto.quantidade),
        }
        resumo_resposta = (
            f"Produto #{novo_produto.id} ('{novo_produto.nome}') cadastrado com sucesso em "
            f"{categoria_loja.nome} por R$ {float(novo_produto.preco_venda):.2f}!"
        )

    # Trilha 1: ConsultorInteracao (histórico do Consultor)
    interacao = ConsultorInteracao(
        estabelecimento_id=estabelecimento_id,
        funcionario_id=funcionario_id,
        especialista=f"acao_{acao}",
        pergunta=json.dumps({"acao": acao, "parametros": params}, ensure_ascii=False, default=str)[:4000],
        resposta=resumo_resposta,
        provider="sistema",
        duracao_ms=0,
        prompt_tokens=0,
        completion_tokens=0,
        custo_estimado_usd=Decimal("0"),
    )
    db.session.add(interacao)

    # Trilha 2: Auditoria oficial do ERP
    log = Auditoria(
        estabelecimento_id=estabelecimento_id,
        usuario_id=funcionario_id,
        tipo_evento=tipo_evento_audit,
        descricao=descricao_audit,
        valor=valor_auditoria,
    )
    db.session.add(log)
    db.session.commit()

    payload_retorno = {
        "success": True,
        "acao": acao,
        "mensagem": resumo_resposta,
        "entidade": entidade_info,
        **extra_fields,
    }
    return payload_retorno, 200
