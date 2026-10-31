"""Context Builder 'sistema' + Classificador Inteligente de Produtos por Nome.

1. Ensina à IA do Consultor da Loja como cada tela, regra fiscal e fluxo do MercadinhoSys funciona
   (Produtos, PDV, Nota Fiscal XML, Financeiro/Pressão de Caixa/DRE, Estoque/Lotes, Compras, RH, Relatórios).
2. Classifica automaticamente qualquer produto pelo nome na Taxonomia Oficial (Família -> Categoria -> Subcategoria),
   sugerindo NCM (8 dígitos), CFOP, CSOSN, unidade, atributos (ex.: voltagem) e descrição comercial.
"""
import re
from typing import Any

from app.services.catalogo_familias import TAXONOMIA, chave_categoria, chave_subcategoria, slug
from app.services.taxonomia_service import outros, resolver
from app.services.view_schema_service import FAMILIAS_PRODUTO, sugestao_fiscal_para_familia
from app.utils.ia_copiloto import gerar_texto, ia_disponivel

# Mapa determinístico de NCMs reais de 8 dígitos para itens frequentes que travam o lojista
_NCM_POR_TERMO: list[tuple[tuple[str, ...], str, str, str]] = [
    (("projetor", "datashow", "retroprojetor"), "eletronicos", "Projetores", "85286200"),
    (("tela projecao", "tela de projecao"), "eletronicos", "Telas de Projeção", "90106000"),
    (("caixa de som", "caixa som", "soundbar"), "eletronicos", "Caixas de Som", "85182200"),
    (("fone", "headset", "earphone", "airpods"), "eletronicos", "Fones de Ouvido", "85183000"),
    (("carregador", "fonte usb"), "eletronicos", "Carregadores", "85044010"),
    (("cabo hdmi", "hdmi"), "eletronicos", "Cabos HDMI e Áudio", "85444200"),
    (("cabo usb", "cabo tipo c", "cabo lightning"), "eletronicos", "Cabos e Adaptadores", "85444200"),
    (("mouse", "teclado"), "eletronicos", "Mouses e Teclados", "84716052"),
    (("notebook", "tablet"), "eletronicos", "Notebooks e Tablets", "84713012"),
    (("smart tv", "televisor", "tv led"), "eletronicos", "Smart TVs", "85287200"),
    (("pilha", "bateria alcalina"), "eletronicos", "Pilhas Comuns", "85061010"),
    (("air fryer", "fritadeira"), "eletro", "Air Fryers e Fritadeiras", "85167910"),
    (("liquidificador",), "eletro", "Liquidificadores", "85094010"),
    (("ventilador",), "eletro", "Ventiladores", "84145110"),
    (("cafeteira",), "eletro", "Cafeteiras Elétricas", "85167100"),
    (("micro ondas", "microondas"), "eletro", "Micro-ondas", "85165000"),
    (("panela", "frigideira"), "bazar", "Panelas", "76151000"),
    (("copo", "taca", "caneca"), "bazar", "Copos", "70133700"),
    (("arroz",), "alimento", "Arroz", "10063021"),
    (("feijao",), "alimento", "Feijão", "07133319"),
    (("acucar",), "alimento", "Açúcar", "17019900"),
    (("cafe",), "alimento", "Café", "09012100"),
    (("oleo", "azeite"), "alimento", "Óleos e Azeites", "15079011"),
    (("refrigerante", "coca", "guarana"), "bebida", "Refrigerantes", "22021000"),
    (("cerveja",), "bebida", "Cervejas", "22030000"),
    (("agua mineral",), "bebida", "Águas Minerais", "22011000"),
    (("detergente",), "limpeza", "Detergentes", "34022000"),
    (("sabao em po", "lava roupas"), "limpeza", "Lava-roupas em Pó", "34022000"),
    (("agua sanitaria",), "limpeza", "Água Sanitária", "28289011"),
    (("shampoo",), "perfumaria_higiene", "Shampoo", "33051000"),
    (("creme dental", "pasta de dente"), "higiene", "Creme Dental", "33061000"),
    (("sabonete",), "higiene", "Sabonetes em Barra", "34011190"),
    (("papel higienico",), "higiene", "Papel Higiênico", "48181000"),
    (("racao",), "pet", "Ração para Cães", "23091000"),
    (("cimento",), "construcao_leve", "Cimento", "25232910"),
    (("lampada",), "construcao_eletrica", "Lâmpadas de LED", "85395200"),
    (("furadeira", "parafusadeira"), "ferramentas", "Furadeiras e Parafusadeiras", "84672100"),
]

_NCM_PADRAO_POR_FAMILIA: dict[str, str] = {
    "alimento": "21069090",
    "frios_congelados": "04069090",
    "hortifruti_pesaveis": "07099990",
    "bebida": "22021000",
    "suplementos": "21069030",
    "perfumaria_higiene": "33049990",
    "higiene": "34011190",
    "limpeza": "34022000",
    "bebe": "39249000",
    "pet": "23091000",
    "bazar": "39241000",
    "cama_mesa_banho": "63022100",
    "decoracao": "39264000",
    "jardinagem": "39269090",
    "embalagem_descartavel": "39232190",
    "papelaria": "48201000",
    "brinquedos": "95030099",
    "eletro": "85098000",
    "eletronicos": "85437099",
    "ferramentas": "82055900",
    "construcao_leve": "25232910",
    "construcao_eletrica": "85366990",
    "construcao_hidraulica": "39174090",
    "construcao_ferragem": "73181500",
    "tintas": "32091010",
    "vestuario": "61091000",
    "calcados": "64029990",
    "acessorios": "42022220",
    "esporte": "95069100",
    "autopecas": "87089990",
    "tabacaria": "96138000",
    "servico": "00000000",
}


def classificar_produto_por_nome(
    nome: str,
    marca: str = "",
    tipo_item: str = "produto",
) -> dict[str, Any]:
    """Classifica um produto na Taxonomia Oficial a partir do nome e retorna todos os campos
    necessários para preencher ou cadastrar o item sem travar o lojista.
    """
    nome_limpo = (nome or "").strip()
    texto_canonico = slug(f"{nome_limpo} {marca}").replace("_", " ")
    palavras_nome = set(texto_canonico.split())

    familia_escolhida = "servico" if tipo_item == "servico" else None
    subcategoria_nome = None
    ncm_sugerido = None

    # 1. Casamento direto no dicionário de termos frequentes (ex.: Projetor -> eletronicos / Projetores / 85286200)
    if not familia_escolhida:
        for termos, fam, sub_nome, ncm in _NCM_POR_TERMO:
            if any(t in texto_canonico for t in termos):
                familia_escolhida = fam
                subcategoria_nome = sub_nome
                ncm_sugerido = ncm
                break

    # 2. Busca por interseção de palavras canônicas em todas as subcategorias da TAXONOMIA
    if not familia_escolhida or not subcategoria_nome:
        melhor_score = 0
        for fam, categorias in TAXONOMIA.items():
            if tipo_item != "servico" and fam == "servico":
                continue
            for cat_nome, subs in categorias.items():
                if cat_nome == "Outros":
                    continue
                for sub in subs:
                    sub_tokens = set(slug(sub).split("_"))
                    comum = palavras_nome & sub_tokens
                    if comum:
                        score = len(comum) * 10 - len(sub_tokens)
                        if score > melhor_score:
                            melhor_score = score
                            familia_escolhida = fam
                            subcategoria_nome = sub

    # 3. Se ainda não achou família, tenta IA ou cai em bazar/alimento
    if not familia_escolhida:
        familia_escolhida = "bazar"

    # Resolve chaves oficiais (categoria_oficial, subcategoria_oficial)
    resolvido = resolver(familia_escolhida, subcategoria_nome) if subcategoria_nome else None
    if not resolvido:
        # Pega a primeira subcategoria real da família ou Outros
        categorias_fam = TAXONOMIA.get(familia_escolhida, {})
        primeira_cat = next((c for c in categorias_fam if c != "Outros"), None)
        if primeira_cat and categorias_fam[primeira_cat]:
            subcategoria_nome = categorias_fam[primeira_cat][0]
            resolvido = (
                chave_categoria(familia_escolhida, primeira_cat),
                chave_subcategoria(familia_escolhida, primeira_cat, subcategoria_nome),
            )
        else:
            resolvido = outros(familia_escolhida)
            subcategoria_nome = "Outros"

    chave_cat, chave_sub = resolvido

    # Sugestão fiscal da família (CFOP, CSOSN, NCM)
    sug_fiscal = sugestao_fiscal_para_familia(familia_escolhida) or {}
    if not ncm_sugerido:
        exemplos_ncm = sug_fiscal.get("ncm_exemplos") or []
        if exemplos_ncm and exemplos_ncm[0].get("ncm"):
            ncm_sugerido = str(exemplos_ncm[0]["ncm"]).replace(".", "")[:8]
        else:
            ncm_sugerido = _NCM_PADRAO_POR_FAMILIA.get(familia_escolhida, "39241000")

    cfop = str(sug_fiscal.get("cfop_padrao_sugerido") or "5102")
    csosn = str(sug_fiscal.get("csosn_sugerido") or "102")

    # Atributos automáticos extraídos do nome (ex.: voltagem)
    atributos: dict[str, Any] = {}
    upper = nome_limpo.upper()
    if "BIVOLT" in upper:
        atributos["voltagem_eletro"] = "Bivolt"
    elif "220V" in upper or "220 V" in upper:
        atributos["voltagem_eletro"] = "220V"
    elif "110V" in upper or "127V" in upper:
        atributos["voltagem_eletro"] = "110V"

    # Descrição comercial (com IA se disponível, ou determinística clara)
    descricao = ""
    if ia_disponivel() and len(nome_limpo) >= 3:
        try:
            descricao = (
                gerar_texto(
                    "Escreva uma descrição comercial curta (1 a 2 frases) em português para cadastro de produto.",
                    f"Produto: {nome_limpo}\nCategoria: {subcategoria_nome}\nMarca: {marca or 'Não informada'}",
                    max_tokens=120,
                )
                or ""
            ).strip()
        except Exception:
            descricao = ""
    if not descricao:
        marca_txt = f" da marca {marca.upper()}" if marca else ""
        descricao = (
            f"{nome_limpo.upper()}{marca_txt} — classificado em "
            f"{FAMILIAS_PRODUTO.get(familia_escolhida, {}).get('nome', familia_escolhida)} ({subcategoria_nome})."
        )

    return {
        "nome": nome_limpo.upper(),
        "familia_produto": familia_escolhida,
        "familia_nome": FAMILIAS_PRODUTO.get(familia_escolhida, {}).get("nome", familia_escolhida),
        "categoria_oficial": chave_cat,
        "subcategoria": chave_sub,
        "categoria_nome": subcategoria_nome,
        "ncm": ncm_sugerido,
        "cfop_padrao": cfop,
        "csosn": csosn,
        "unidade_medida": "un",
        "atributos": atributos,
        "descricao": descricao,
    }


def extrair_intencao_cadastro_produto(mensagem: str) -> dict[str, Any] | None:
    """Detecta quando o usuário pede ajuda para cadastrar um produto específico no chat
    (ex.: 'Não consigo cadastrar um Projetor Epson bivolt custo 850 venda 1290 estoque 2')
    e devolve os parâmetros prontos para a ação 'cadastrar_produto'.
    """
    if not mensagem or not isinstance(mensagem, str):
        return None
    texto_low = mensagem.lower()
    gatilhos = ("cadastrar", "cadastro", "cadastra", "novo produto", "incluir produto", "registrar produto")
    if not any(g in texto_low for g in gatilhos):
        return None

    # Extrai possíveis números: custo, venda e estoque
    def _num_apos(padrao: str, default: float) -> float:
        m = re.search(padrao, texto_low)
        if not m:
            return default
        try:
            return float(m.group(1).replace(".", "").replace(",", "."))
        except ValueError:
            return default

    custo = _num_apos(r"(?:custo|paguei|compra)\s*(?:de\s*)?(?:r\$\s*)?(\d+(?:[.,]\d+)?)", 0.0)
    venda = _num_apos(r"(?:venda|vender|por|preco|preço)\s*(?:de\s*|por\s*)?(?:r\$\s*)?(\d+(?:[.,]\d+)?)", 0.0)
    estoque_float = _num_apos(r"(?:estoque|qtd|quantidade|tenho|unidades?)\s*(?:de\s*)?(\d+)", 1.0)
    quantidade = max(1, int(estoque_float))

    # Limpa a frase para extrair o nome do produto
    limpo = re.sub(
        r"(?i)(não consigo|nao consigo|me ajuda a|como|quero|preciso|por favor|cadastrar|cadastro de|cadastra|"
        r"um produto|o produto|no sistema|me ajuda|ajuda|custo\s*r?\$?\s*[\d.,]+|venda\s*r?\$?\s*[\d.,]+|"
        r"por\s*r?\$?\s*[\d.,]+|estoque\s*\d+|quantidade\s*\d+|\?|\!|\.)",
        " ",
        mensagem,
    )
    limpo = re.sub(r"\b(um|uma|o|a|de|do|da)\b", " ", limpo, flags=re.IGNORECASE)
    nome_extraido = " ".join(limpo.split()).strip(" ,;-")
    if len(nome_extraido) < 3:
        return None

    classificacao = classificar_produto_por_nome(nome_extraido)
    if venda <= 0 and custo > 0:
        venda = round(custo * 1.35, 2)
    elif custo <= 0 and venda > 0:
        custo = round(venda * 0.7, 2)
    elif custo <= 0 and venda <= 0:
        custo = 50.0
        venda = 75.0

    return {
        "nome": classificacao["nome"],
        "familia_produto": classificacao["familia_produto"],
        "familia_nome": classificacao["familia_nome"],
        "categoria_oficial": classificacao["categoria_oficial"],
        "subcategoria": classificacao["subcategoria"],
        "categoria_nome": classificacao["categoria_nome"],
        "ncm": classificacao["ncm"],
        "cfop_padrao": classificacao["cfop_padrao"],
        "csosn": classificacao["csosn"],
        "unidade_medida": classificacao["unidade_medida"],
        "preco_custo": custo,
        "preco_venda": venda,
        "quantidade": quantidade,
        "atributos": classificacao["atributos"],
        "descricao": classificacao["descricao"],
    }


def montar_contexto(estabelecimento_id: int, is_manager: bool = False) -> dict[str, Any]:
    """Retorna a Base de Conhecimento Operacional do MercadinhoSys para que o Consultor da Loja
    saiba orientar o usuário em qualquer tela, erro de cadastro, regra fiscal ou emissão de relatório.
    """
    return {
        "como_cadastrar_produto": {
            "onde_ir": "Menu lateral > Produtos > botão '+ Novo Produto'",
            "passo_a_passo": [
                "1. Escolha a Família do Item (ex.: Mercearia, Bebidas, Eletrônicos, Eletroportáteis, Bazar, Construção). Todas as famílias já estão disponíveis no seletor.",
                "2. Digite o Nome do Produto e clique em '✨ Auto-preencher IA' (ou escaneie o código de barras EAN) para o sistema preencher Família, Categoria, Subcategoria oficial, NCM e Descrição automaticamente.",
                "3. Se o produto não tiver código de barras na embalagem, clique em 'Sem código? Gerar código interno' (gera um EAN-13 iniciado em 20 exclusivo da loja).",
                "4. Na seção Tributação, confira NCM (8 dígitos), CFOP (padrão 5102) e CSOSN (padrão 102, ou 500 com CEST de 7 dígitos se houver ICMS-ST).",
                "5. Na seção Precificação, escolha entre 'Tenho o custo' (custo -> venda), 'Defino a venda' (venda -> custo estimado) ou 'Pelo mercado' (preço Shopee/ML -> desconto -> custo estimado).",
                "6. Informe a Quantidade Inicial em estoque (para famílias perecíveis como Alimentos e Bebidas, informe a Data de Validade; para Eletrônicos, Eletro e Bazar não há validade).",
            ],
            "exemplos_classificacao_rapida": {
                "Projetor / Cabo HDMI / Carregador / Fone / Caixa de Som / Pilha": "Família: Eletrônicos, Celulares e Informática (eletronicos) -> Subcategoria: Projetores (NCM 85286200)",
                "Air Fryer / Liquidificador / Ventilador / Cafeteira": "Família: Eletroportáteis e Eletrodomésticos (eletro)",
                "Panela / Copo / Pote / Garrafa Térmica": "Família: Bazar e Utilidades Domésticas (bazar)",
                "Arroz / Feijão / Café / Óleo / Biscoito": "Família: Mercearia e Alimentos (alimento)",
            },
            "atalho_pelo_chat": "Você também pode pedir aqui no chat: 'Cadastrar [nome do produto] custo X venda Y estoque Z' e confirmar no botão abaixo da mensagem!",
        },
        "guia_modulos_sistema": {
            "pdv_e_caixa": "Menu PDV: venda com leitor de código de barras ou busca por nome, múltiplos pagamentos (PIX, Cartão, Dinheiro, Fiado) e Modo Offline automático (SyncQueue sincroniza quando a internet volta).",
            "entrada_nota_xml": "Menu Entrada de Nota: importe o arquivo XML da NF-e do fornecedor para cadastrar produtos novos, atualizar custo médio, dar entrada no estoque e lançar os boletos em Despesas automaticamente.",
            "financeiro_e_pressao_caixa": "Menu Despesas e Dashboard Financeiro: controla contas a pagar, DRE Gerencial e a Pressão de Caixa Diária (Boletos de hoje + Despesas Fixas/30 + Folha e Encargos/30).",
            "compras_e_reposicao": "Menu Compras & Doca: gera pedidos de compra a partir dos itens abaixo do estoque mínimo ou via botão de 1 clique aqui no Consultor da Loja.",
            "relatorios_e_exportacao": "Menu Relatórios ou diretamente aqui no Consultor da Loja: peça 'Emitir relatório de vendas/estoque/financeiro' e use os botões 'Baixar PDF', 'Exportar CSV' ou 'Copiar para WhatsApp'.",
        },
    }
