"""Context Builder 'sistema' + ponte do Consultor com o classificador de produtos.

1. Ensina à IA do Consultor como as telas e regras do MercadinhoSys funcionam, com as famílias
   REAIS do sistema e os departamentos da loja (nada de lista fixa de 6 famílias).
2. `classificar_produto_por_nome` usa o classificador em camadas (services/classificador_produto.py):
   sinônimos do balcão → memória da loja → taxonomia → IA presa à lista oficial.
3. `extrair_intencao_cadastro_produto` lê um pedido de cadastro no chat SEM inventar preço.
"""
import re
from typing import Any

from app.services.classificador_produto import classificar
from app.services.view_schema_service import FAMILIAS_PRODUTO, sugestao_fiscal_para_familia
from app.utils.ia_copiloto import gerar_texto, ia_disponivel

# NCM de reserva quando nem a subcategoria nem a família sugerem (sugestão: o contador confirma).
_NCM_PADRAO_POR_FAMILIA: dict[str, str] = {
    "alimento": "21069090", "frios_congelados": "04069090", "hortifruti_pesaveis": "07099990",
    "bebida": "22021000", "suplementos": "21069030", "perfumaria_higiene": "33049990", "higiene": "34011190",
    "limpeza": "34022000", "bebe": "39249000", "pet": "23091000", "bazar": "39241000",
    "cama_mesa_banho": "63022100", "decoracao": "39264000", "jardinagem": "39269090",
    "embalagem_descartavel": "39232190", "papelaria": "48201000", "brinquedos": "95030099",
    "eletro": "85098000", "eletronicos": "85437099", "ferramentas": "82055900", "construcao_leve": "25232910",
    "construcao_eletrica": "85366990", "construcao_hidraulica": "39174090", "construcao_ferragem": "73181500",
    "tintas": "32091010", "vestuario": "61091000", "calcados": "64029990", "acessorios": "42022220",
    "esporte": "95069100", "autopecas": "87089990", "motopecas": "87141000",
    "tabacaria": "96138000", "servico": "00000000",
    # religioso: sem padrão. Vela, imagem, guia, erva e banho têm NCMs diferentes; sem perfil, fica em branco
    # para o contador (chutar vela para um banho é pior que não sugerir).
}

_PROIBIDO_NA_DESCRICAO = re.compile(r"\b(cura|curar|trata|tratar|tratamento de|elimina doen|repele|repelente)\w*",
                                    re.IGNORECASE)


def _descricao(nome: str, marca: str, subcategoria: str, familia: str, tipo_item: str) -> str:
    if ia_disponivel() and len(nome) >= 3:
        try:
            texto = (gerar_texto(
                "Escreva uma descrição comercial curta (1 a 2 frases, até 240 caracteres) em português do Brasil "
                "para cadastro de produto de loja de bairro. Diga o que é e para que serve. Nunca invente medida, "
                "peso, compatibilidade, validade ou preço que não estejam nos dados. Nunca faça promessa de cura, "
                "tratamento ou efeito terapêutico. Sem emojis. Retorne só o texto.",
                f"{'Serviço' if tipo_item == 'servico' else 'Produto'}: {nome}\nCategoria: {subcategoria}\n"
                f"Marca: {marca or 'não informada'}",
                max_tokens=160,
            ) or "").strip().strip('"“”')
            if texto and not _PROIBIDO_NA_DESCRICAO.search(texto):
                return texto[:500]
        except Exception:
            pass
    marca_txt = f" da marca {marca.upper()}" if marca else ""
    return f"{nome.upper()}{marca_txt} — {FAMILIAS_PRODUTO.get(familia, {}).get('nome', familia)} ({subcategoria})."


def classificar_produto_por_nome(
    nome: str,
    marca: str = "",
    tipo_item: str = "produto",
    estabelecimento_id: int | None = None,
    mix: list | None = None,
) -> dict[str, Any]:
    """Classifica pelo nome e devolve tudo que o cadastro precisa (família, subcategoria oficial,
    marca, atributos lidos do nome, NCM provável, CFOP/CSOSN sugeridos e descrição)."""
    nome_limpo = (nome or "").strip()
    if mix is None and estabelecimento_id:
        try:
            from app import db
            from app.models import Estabelecimento
            from app.services.view_schema_service import mix_permitido_para_estabelecimento
            mix = mix_permitido_para_estabelecimento(db.session.get(Estabelecimento, int(estabelecimento_id)))
        except Exception:
            mix = None
    r = classificar(nome_limpo, marca, tipo_item=tipo_item, mix=mix, estabelecimento_id=estabelecimento_id)
    familia = r["familia_produto"]
    sug_fiscal = sugestao_fiscal_para_familia(familia, tipo_item=tipo_item) or {}
    ncm = r["ncm"] or _NCM_PADRAO_POR_FAMILIA.get(familia) or ""
    return {
        **r,
        "nome": nome_limpo.upper(),
        "ncm": ncm,
        "ncm_confirmar": True,
        "cfop_padrao": str(sug_fiscal.get("cfop_padrao_sugerido") or "5102"),
        "csosn": str(sug_fiscal.get("csosn_sugerido") or "102"),
        "unidade_medida": "un",
        "descricao": _descricao(nome_limpo, r["marca"], r["categoria_nome"], familia, tipo_item),
    }


_GATILHOS_CADASTRO = ("cadastrar", "cadastro", "cadastra", "cadastro", "novo produto", "incluir produto",
                      "registrar produto")


def nome_do_pedido(mensagem: str) -> str | None:
    """Tira de 'como eu cadastro câmera de ar aro 18?' o nome do produto ('câmera de ar aro 18')."""
    if not mensagem or not any(g in mensagem.lower() for g in _GATILHOS_CADASTRO):
        return None
    limpo = re.sub(
        r"(?i)\b(n[aã]o consigo|me ajuda a|me ajuda|ajuda|como (?:eu )?(?:fa[cç]o|posso|devo)?(?: para| pra)?|"
        r"como|quero|preciso|por favor|cadastr\w*|no sistema|um produto|o produto|um item|"
        r"custo\s*r?\$?\s*[\d.,]+|venda\s*r?\$?\s*[\d.,]+|vender\s*(?:por|a)?\s*r?\$?\s*[\d.,]+|"
        r"por\s*r?\$?\s*[\d.,]+|estoque\s*\d+|quantidade\s*\d+|qtd\s*\d+|tenho\s*\d+\s*\w*)\b|[?!.]",
        " ",
        mensagem,
    )
    limpo = re.sub(r"(?i)\b(um|uma|o|a|os|as|eu|de|do|da|para|pra|isso|esse|essa)\b(?=\s|$)", " ", limpo)
    nome = " ".join(limpo.split()).strip(" ,;-")
    # O nome do produto continua com "de" interno ("câmara de ar"): recompõe pelo texto original.
    m = re.search(re.escape(nome.split()[0]) + r".*", mensagem, re.IGNORECASE) if nome else None
    if m:
        candidato = re.split(r"(?i)\s+(?:como|custo|venda|vender|estoque|qtd|quantidade|tenho|por r\$|\?)",
                             m.group(0))[0]
        candidato = " ".join(candidato.split()).strip(" ,;-?!.")
        if len(candidato) >= len(nome):
            nome = candidato
    return nome if len(nome) >= 3 else None


def extrair_intencao_cadastro_produto(mensagem: str, estabelecimento_id: int | None = None) -> dict[str, Any] | None:
    """Pedido de cadastro no chat → parâmetros da ação 'cadastrar_produto'.

    Preço e estoque só entram se o lojista disse; sem eles ficam 0 e o chat PERGUNTA (o botão de
    cadastrar só aparece com custo e venda informados).
    """
    nome = nome_do_pedido(mensagem)
    if not nome:
        return None
    texto_low = mensagem.lower()

    def _num_apos(padrao: str) -> float:
        m = re.search(padrao, texto_low)
        if not m:
            return 0.0
        try:
            return float(m.group(1).replace(".", "").replace(",", "."))
        except ValueError:
            return 0.0

    custo = _num_apos(r"(?:custo|paguei|compra(?:da)?)\s*(?:de\s*|por\s*)?(?:r\$\s*)?(\d+(?:[.,]\d+)?)")
    venda = _num_apos(r"(?:venda|vender|vendo|pre[cç]o)\s*(?:de\s*|por\s*|a\s*)?(?:r\$\s*)?(\d+(?:[.,]\d+)?)")
    quantidade = int(_num_apos(r"(?:estoque|qtd|quantidade|tenho)\s*(?:de\s*)?(\d+)"))

    c = classificar_produto_por_nome(nome, estabelecimento_id=estabelecimento_id)
    return {
        "nome": c["nome"], "familia_produto": c["familia_produto"], "familia_nome": c["familia_nome"],
        "categoria_oficial": c["categoria_oficial"], "subcategoria": c["subcategoria"],
        "categoria_nome": c["categoria_nome"], "marca": c["marca"], "ncm": c["ncm"],
        "cfop_padrao": c["cfop_padrao"], "csosn": c["csosn"], "unidade_medida": c["unidade_medida"],
        "preco_custo": custo, "preco_venda": venda, "quantidade": max(0, quantidade),
        "atributos": c["atributos"], "descricao": c["descricao"],
        "faltam": [k for k, v in (("custo", custo), ("preço de venda", venda)) if not v],
    }


def classificacao_para_pergunta(pergunta: str, estabelecimento_id: int | None) -> dict[str, Any] | None:
    """Evidência pontual para o Consultor: como o sistema classifica o produto perguntado."""
    nome = nome_do_pedido(pergunta)
    if not nome:
        return None
    servico = bool(re.search(r"(?i)\b(servi[cç]o|troca de|conserto|reparo|m[aã]o de obra|instala[cç][aã]o)\b",
                             pergunta))
    c = classificar_produto_por_nome(nome, tipo_item="servico" if servico else "produto",
                                     estabelecimento_id=estabelecimento_id)
    from app.services.view_schema_service import resolver_view_schema
    from app.services.perfil_subcategoria import regra_validade
    try:
        from app import db
        from app.models import Estabelecimento
        estab = db.session.get(Estabelecimento, int(estabelecimento_id)) if estabelecimento_id else None
        schema = resolver_view_schema(estab, familia_produto=c["familia_produto"],
                                      tipo_item="servico" if servico else "produto")
        campos = [campo["label"] for campo in schema.get("campos", []) if campo.get("origem") == "atributo"][:14]
        validade = regra_validade(c["subcategoria"], schema.get("flags", {}))
    except Exception:
        campos, validade = [], None
    return {
        "produto_perguntado": nome,
        "tipo": "serviço" if servico else "produto",
        "familia": c["familia_nome"],
        "subcategoria_oficial": c["categoria_nome"],
        "marca_lida_do_nome": c["marca"] or None,
        "atributos_lidos_do_nome": c["atributos"],
        "campos_do_formulario_desta_familia": campos,
        "validade": {"obrigatoria": "obrigatória quando entra estoque", "opcional": "opcional",
                     "nao_se_aplica": "não se aplica (não perguntar)"}.get(validade, "conforme o formulário"),
        "ncm_provavel": c["ncm"],
        "departamento_ligado_na_loja": not c.get("fora_dos_departamentos"),
        "confianca": c["confianca"],
        "como_fazer": (
            f"Produtos > + Novo Produto > família {c['familia_nome']} > subcategoria {c['categoria_nome']}; "
            "ou digite o nome e toque em '✨ Auto-preencher IA', que preenche família, subcategoria, marca, "
            "atributos e NCM sozinho. Confira e informe custo, venda e estoque."
            + ("" if not c.get("fora_dos_departamentos") else
               f" Se a família {c['familia_nome']} não aparecer, ligue-a em Configurações > Departamentos da Loja.")
        ),
    }


def montar_contexto(estabelecimento_id: int, is_manager: bool = False) -> dict[str, Any]:
    """Base de Conhecimento Operacional do MercadinhoSys (famílias reais, não lista fixa)."""
    try:
        from app import db
        from app.models import Estabelecimento
        from app.services.view_schema_service import mix_permitido_para_estabelecimento
        estab = db.session.get(Estabelecimento, int(estabelecimento_id))
        departamentos = [FAMILIAS_PRODUTO[f]["nome"] for f in mix_permitido_para_estabelecimento(estab)
                         if f in FAMILIAS_PRODUTO]
    except Exception:
        departamentos = []
    todas = [info["nome"] for chave, info in FAMILIAS_PRODUTO.items() if chave != "servico"]
    return {
        "como_cadastrar_produto": {
            "onde_ir": "Menu lateral > Produtos > botão '+ Novo Produto'",
            "passo_a_passo": [
                "1. Digite o nome do produto como o cliente pede (ex.: 'Câmara de ar 3.00-18 Titan', "
                "'Vela 7 dias vermelha', 'Condicionador Seda 325ml') e toque em '✨ Auto-preencher IA' ou "
                "escaneie o código de barras: o sistema escolhe família, subcategoria oficial, marca, atributos "
                "(medida, aro, modelo, cor, altura, santo/orixá) e NCM provável.",
                "2. Confira a família e a subcategoria. O formulário muda sozinho: só aparecem os campos daquele "
                "tipo de produto.",
                "3. Sem código de barras na embalagem: 'Sem código? Gerar código interno' (EAN-13 que começa em 20).",
                "4. Tributação: confira NCM, CFOP e CSOSN com o contador (são sugestões).",
                "5. Preço: 'Tenho o custo', 'Defino a venda' ou 'Pelo mercado'.",
                "6. Estoque inicial. A validade só é pedida quando o tipo de produto vence (alimento, cosmético, "
                "ração, banho fabricado). Peça, vela, imagem, lâmina, escova e acessório não pedem validade.",
                "Serviço (troca de tela, troca de óleo, borracharia): marque 'Serviço' no topo do formulário.",
            ],
            "departamentos_ligados_nesta_loja": departamentos,
            "todas_as_familias_do_sistema": todas,
            "familia_nao_aparece": "Configurações > Segmento & Exibição > Departamentos da Loja: ligue a família.",
            "atalho_pelo_chat": "No chat: 'Cadastrar [nome] custo X venda Y estoque Z' e confirmar no botão. "
                                "Sem custo e venda o Consultor pergunta (nunca chuta preço).",
        },
        "guia_modulos_sistema": {
            "pdv_e_caixa": "Menu PDV: venda com leitor de código de barras ou busca por nome, múltiplos pagamentos "
                           "(PIX, Cartão, Dinheiro, Fiado) e Modo Offline automático.",
            "entrada_nota_xml": "Menu Entrada de Nota: importe o XML da NF-e do fornecedor para cadastrar produtos, "
                                "atualizar custo médio, dar entrada no estoque e lançar os boletos em Despesas.",
            "financeiro_e_pressao_caixa": "Despesas e Dashboard Financeiro: contas a pagar, DRE Gerencial e Pressão "
                                          "de Caixa Diária.",
            "compras_e_reposicao": "Compras & Doca: pedidos de compra a partir dos itens abaixo do mínimo.",
            "relatorios_e_exportacao": "Relatórios ou aqui no Consultor: 'Emitir relatório de vendas/estoque/"
                                       "financeiro' e 'Baixar PDF', 'Exportar CSV' ou 'Copiar para WhatsApp'.",
        },
    }
