"""BigDataCorp (Plataforma de Dados, API de Produtos): cadastro completo do produto por EAN.

Uma chamada pede até três serviços, cada um com a própria franquia de 500 consultas/mês
(contrato, Anexo I: "as primeiras 500 consultas ... contra cada um dos serviços a cada mês"):
  - extra_info_data       (Ficha Técnica): tipo, marca, fabricante, sabor, volume, NCM
  - current_pricing_data  (Preço Atual):   preço médio nas lojas online -> preço de referência
  - images_data           (Imagens):       foto mais recente

O contador fica no banco (ConsumoApiExterna, um provedor por serviço) e a vaga é reservada
ANTES da chamada; serviço com franquia esgotada ou pausado sai da chamada e os outros continuam.
Limite e liga/desliga por serviço ficam em ConfigApiExterna, editáveis no painel do super admin
(acima de 500 a BigDataCorp cobra no boleto do mês: liberar é decisão consciente do super admin).

Credenciais só do ambiente: API_BIG_DATA_CORP (AccessToken, JWT do BDC Center) e
API_BIG_DATA_CORP_TOKEN_ID (o "Token Id" da mesma linha no BDC Center, não é o jti do JWT).
"""
import os
import re
import unicodedata
from datetime import datetime

import requests
from flask import current_app
from sqlalchemy.exc import IntegrityError

from app.models import db, ConsumoApiExterna
from app.utils.timezone import hoje_local

URL_PRODUTOS = "https://plataforma.bigdatacorp.com.br/produtos"
SERVICOS = {
    "extra_info_data": "Ficha técnica",
    "current_pricing_data": "Preço de mercado",
    "images_data": "Imagens",
}


def _provedor(dataset: str) -> str:
    return f"bigdatacorp:{dataset}"


FRANQUIA_GRATIS = 500
PRECO_EXCEDENTE = 0.06  # R$ por consulta acima da franquia (tabela pública, faixa 1-10.000)


def limite_mensal(dataset: str = None) -> int:
    """Limite do serviço: o que o super admin gravou no painel; sem isso, o do ambiente (padrão 500)."""
    if dataset:
        from app.models import ConfigApiExterna
        config = ConfigApiExterna.query.filter_by(provedor=_provedor(dataset)).first()
        if config is not None:
            return max(0, int(config.limite_mensal or 0))
    try:
        return max(0, int(os.environ.get("BIGDATACORP_LIMITE_MENSAL", str(FRANQUIA_GRATIS))))
    except ValueError:
        return FRANQUIA_GRATIS


def servico_ativo(dataset: str) -> bool:
    from app.models import ConfigApiExterna
    config = ConfigApiExterna.query.filter_by(provedor=_provedor(dataset)).first()
    return True if config is None else bool(config.ativo)


def configurar_servico(dataset: str, limite_mensal_novo=None, ativo=None, usuario_id=None):
    """Grava limite e/ou liga-desliga do serviço (painel do super admin)."""
    from app.models import ConfigApiExterna
    if dataset not in SERVICOS:
        raise ValueError("Serviço desconhecido")
    config = ConfigApiExterna.query.filter_by(provedor=_provedor(dataset)).first()
    if config is None:
        config = ConfigApiExterna(provedor=_provedor(dataset), limite_mensal=limite_mensal(), ativo=True)
        db.session.add(config)
    if limite_mensal_novo is not None:
        valor = int(limite_mensal_novo)
        if not 0 <= valor <= 100000:
            raise ValueError("Limite deve ficar entre 0 e 100.000 consultas por mês")
        config.limite_mensal = valor
    if ativo is not None:
        config.ativo = bool(ativo)
    config.atualizado_por = usuario_id
    return config


def custo_estimado(consultas: int) -> float:
    """Valor que entra no boleto do mês: só o que passa da franquia grátis."""
    return round(max(0, consultas - FRANQUIA_GRATIS) * PRECO_EXCEDENTE, 2)


def configurado() -> bool:
    return bool(os.environ.get("API_BIG_DATA_CORP", "").strip()
                and os.environ.get("API_BIG_DATA_CORP_TOKEN_ID", "").strip())


def _mes_atual() -> str:
    return hoje_local().strftime("%Y-%m")


def consumo_do_mes() -> list:
    """Uma linha por serviço: consultas, encontrados, limite, se está ligado e o custo do excedente."""
    mes = _mes_atual()
    linhas = {l.provedor: l for l in ConsumoApiExterna.query.filter(
        ConsumoApiExterna.mes == mes, ConsumoApiExterna.provedor.in_([_provedor(d) for d in SERVICOS])).all()}
    saida = []
    for dataset, nome in SERVICOS.items():
        linha = linhas.get(_provedor(dataset))
        usadas = linha.consultas if linha else 0
        limite = limite_mensal(dataset)
        saida.append({"dataset": dataset, "provedor": _provedor(dataset), "servico": nome, "mes": mes,
                      "consultas": usadas, "encontrados": linha.encontrados if linha else 0,
                      "limite": limite, "restantes": max(0, limite - usadas), "ativo": servico_ativo(dataset),
                      "franquia_gratis": FRANQUIA_GRATIS, "custo_estimado": custo_estimado(usadas),
                      "custo_maximo_no_limite": custo_estimado(limite), "configurado": configurado()})
    return saida


def historico(meses: int = 6) -> list:
    """Consumo dos últimos meses por serviço, mais recente primeiro."""
    linhas = (ConsumoApiExterna.query.filter(ConsumoApiExterna.provedor.in_([_provedor(d) for d in SERVICOS]))
              .order_by(ConsumoApiExterna.mes.desc()).all())
    por_mes = {}
    for l in linhas:
        dataset = l.provedor.split(":", 1)[1]
        por_mes.setdefault(l.mes, {})[dataset] = {"consultas": l.consultas, "encontrados": l.encontrados,
                                                  "custo_estimado": custo_estimado(l.consultas)}
    return [{"mes": m, "servicos": por_mes[m]} for m in sorted(por_mes, reverse=True)[:max(1, meses)]]


def reservar_consulta(dataset: str) -> bool:
    """Reserva 1 consulta do serviço no mês, com trava de linha; False quando a franquia acabou."""
    return reservar_consultas(dataset, 1) == 1


def reservar_consultas(dataset: str, quantidade: int) -> int:
    """Reserva até ``quantidade`` consultas do mês; devolve quantas couberam na franquia (0 = acabou)."""
    if quantidade <= 0 or not servico_ativo(dataset):  # pausado no painel do super admin
        return 0
    provedor, mes, limite = _provedor(dataset), _mes_atual(), limite_mensal(dataset)
    for _ in range(2):
        linha = (ConsumoApiExterna.query.filter_by(provedor=provedor, mes=mes)
                 .with_for_update().first())
        if linha is None:
            try:
                linha = ConsumoApiExterna(provedor=provedor, mes=mes, consultas=0, encontrados=0)
                db.session.add(linha)
                db.session.flush()
            except IntegrityError:  # outra loja criou a linha do mês ao mesmo tempo
                db.session.rollback()
                continue
        reservadas = min(quantidade, max(0, limite - linha.consultas))
        linha.consultas += reservadas
        db.session.commit()  # solta a trava antes da chamada externa
        return reservadas
    return 0


def devolver_consultas(dataset: str, quantidade: int):
    """Busca por termo reserva o máximo; o que a BigDataCorp não devolveu (e não cobrou) volta à franquia."""
    if quantidade <= 0:
        return
    linha = (ConsumoApiExterna.query.filter_by(provedor=_provedor(dataset), mes=_mes_atual())
             .with_for_update().first())
    if linha:
        linha.consultas = max(0, linha.consultas - quantidade)
    db.session.commit()


def registrar_encontrado(dataset: str):
    linha = (ConsumoApiExterna.query.filter_by(provedor=_provedor(dataset), mes=_mes_atual())
             .with_for_update().first())
    if linha:
        linha.encontrados += 1


def _chave(texto) -> str:
    sem_acento = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode()
    return " ".join(sem_acento.upper().split())


def _primeiro(atributos: list, *chaves):
    for attrs in atributos:
        for chave in chaves:
            valor = str(attrs.get(chave) or "").strip()
            if valor:
                return valor
    return ""


def _texto(valor) -> str:
    """Valor da ficha sem HTML e sem espaço sobrando (lojas como a Droga Raia mandam HTML)."""
    import html
    sem_tags = re.sub(r"<[^>]+>", " ", html.unescape(str(valor or "")))
    return " ".join(sem_tags.split())


_SUFIXO_LOJA = re.compile(r"\s*(?:\||:|–|-)\s*(?:menor pre[cç]o|droga ?raia|drogasil|drogaria s[aã]o paulo|"
                          r"magazine ?luiza|p[aã]o de a[cç][uú]car|leroy ?merlin|kabum|amazon|americanas|"
                          r"submarino|carrefour|casas bahia)\b.*$", re.IGNORECASE)


def _titulo_loja(atributos: list) -> str:
    """Nome do produto como a loja de origem publica (título da página): fichas sem MARCA/TIPO.

    Ex.: META_TITLE "Lavitan Vitamina C Turma da Mônica Melancia 60 Comps | Droga Raia"
    -> "Lavitan Vitamina C Turma da Mônica Melancia 60 Comps".
    """
    for chaves in (("TITULO", "TITLE", "NOME", "NOME DO PRODUTO", "NOME COMERCIAL"), ("META_TITLE",)):
        bruto = _texto(_primeiro(atributos, *chaves))
        titulo = _SUFIXO_LOJA.sub("", bruto).strip(" |:-–")
        if len(titulo) >= 3:
            return titulo
    meta = _texto(_primeiro(atributos, "META_DESCRIPTION"))
    achado = re.match(r"^Encontre (.+?) com o menor pre", meta, re.IGNORECASE)
    return achado.group(1).strip() if achado else ""


def _data_bdc(texto):
    """Datas da API vêm como 'MM/DD/AAAA HH:MM:SS' ou ISO; None se não der para ler."""
    for formato in ("%m/%d/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(texto), formato)
        except ValueError:
            continue
    return None


def _preco_referencia(resultado: dict):
    """Preço médio de venda nas lojas online (a API já descarta preço velho no agregado)."""
    dados = resultado.get("CurrentPriceData") or {}
    agregado = dados.get("AggregatedPriceData") or {}
    preco = agregado.get("AverageSalePrice") or agregado.get("AverageFullPrice")
    try:
        preco = round(float(preco), 2)
    except (TypeError, ValueError):
        return None, 0
    fontes = dados.get("PriceDataBySource") or []
    return (preco if preco > 0 else None), (len(fontes) if isinstance(fontes, list) else 0)


def _imagem_mais_recente(resultado: dict):
    """Foto mais recente entre as lojas de origem (só https)."""
    melhor_data, melhor_url = None, None
    por_fonte = ((resultado.get("ImagesData") or {}).get("ImagesPerSource") or {})
    for fonte in por_fonte.values():
        historico = (fonte or {}).get("ImagesDetailsHistory") or {}
        if not isinstance(historico, dict):
            continue
        for quando, imagens in historico.items():
            data = _data_bdc(quando)
            for img in imagens or []:
                url = str((img or {}).get("ImageUrl") or "")
                if url.startswith("https://") and data and (melhor_data is None or data > melhor_data):
                    melhor_data, melhor_url = data, url
    if melhor_url:
        return melhor_url
    _, atributos = _fichas(resultado)
    imagem = _primeiro(atributos, "IMAGE", "IMAGEM", "SMALL_IMAGE")
    return imagem if imagem.startswith("https://") else None


def mapear(resultado: dict) -> dict:
    """Campos do cadastro a partir da resposta (Ficha Técnica, Preço Atual e Imagens).

    A API não devolve um nome pronto: o nome é "tipo + marca + sabor + volume"
    (ex.: "Refrigerante Coca-Cola Cola Original 2 L"). Sem tipo e sem marca, não há nome.
    """
    fontes = ((resultado.get("ExtraInfoData") or {}).get("ExtraInfoPerSource") or {}).values()
    atributos = [{_chave(k): v for k, v in ((f or {}).get("UncategorizedExtraInfo") or {}).items()}
                 for f in fontes]
    fabricante_remedio = _primeiro([((f or {}).get("MedicineExtraInfo") or {}) for f in fontes], "Manufacturer")
    # Loja com mais atributos primeiro: costuma ser a ficha mais completa.
    atributos.sort(key=len, reverse=True)
    tipo = _primeiro(atributos, "NOME PRINCIPAL DO ITEM", "TIPO DE PRODUTO", "TIPO", "PRODUTO")
    marca = _primeiro(atributos, "MARCA")
    fabricante = _primeiro(atributos, "FABRICANTE") or fabricante_remedio
    sabor = _primeiro(atributos, "SABOR", "FRAGRANCIA", "AROMA", "VARIACAO")
    volume = _primeiro(atributos, "VOLUME", "PESO LIQUIDO", "CONTEUDO")
    if not volume:
        quantidade = _primeiro(atributos, "CONTEUDO LIQUIDO")
        unidade = _primeiro(atributos, "UNID CONTEUDO LIQUIDO", "UNID CONT LIQUIDO")
        volume = f"{quantidade} {unidade}".strip() if quantidade else ""
    partes, vistos = [], set()
    for parte in (tipo, marca, sabor, volume):
        if parte and _chave(parte) not in vistos:
            partes.append(parte)
            vistos.add(_chave(parte))
    ncm = "".join(c for c in _primeiro(atributos, "NCM", "CODIGO NCM") if c.isdigit())[:8]
    preco, lojas_com_preco = _preco_referencia(resultado)
    # O título que a loja publica é o nome mais fiel; "tipo + marca" só quando não há título
    # (um "tipo" solto de uma loja virava nome errado: mamadeira MAM saiu "Antivazamento MAM").
    titulo = _titulo_loja(atributos)
    nome = titulo or (" ".join(partes) if (tipo or marca) else "")
    if titulo and tipo and _chave(tipo) not in _chave(titulo):
        tipo = titulo.split()[0]  # tipo que não aparece no título é de outro produto/variação
    return {
        "nome": nome[:200],
        "marca": marca[:100] or None,
        "fabricante": (fabricante or marca)[:150] or None,
        "categoria": tipo[:60] or None,
        "ncm": ncm if len(ncm) == 8 else None,
        "preco_referencia": preco,
        "lojas_com_preco": lojas_com_preco,
        "imagem_url": (_imagem_mais_recente(resultado) or "")[:500] or None,
    }


def consultar_ean(ean: str):
    """Devolve ``(motivo, resultado|None, datasets_consultados)``.

    motivo: 'encontrado' | 'nao_encontrado' | 'sem_cota' | 'nao_configurado' | 'erro'.
    Cada serviço com franquia no mês entra na chamada; a vaga é gasta antes (conta conservadora).
    """
    if not configurado():
        return "nao_configurado", None, []
    datasets = [d for d in SERVICOS if reservar_consulta(d)]
    if not datasets:
        return "sem_cota", None, []
    headers = {
        "AccessToken": os.environ["API_BIG_DATA_CORP"].strip(),
        "TokenId": os.environ["API_BIG_DATA_CORP_TOKEN_ID"].strip(),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        resp = requests.post(URL_PRODUTOS, json={"Datasets": ",".join(datasets), "q": f"ean{{{ean}}}", "Limit": 1},
                             headers=headers, timeout=10)
        dados = resp.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        current_app.logger.warning(f"BigDataCorp sem resposta para {ean}: {e}")
        return "erro", None, datasets
    status = dados.get("Status") or {}
    erros_login = [s for s in (status.get("login") or []) if s.get("Code") not in (0, None)]
    if erros_login:
        current_app.logger.error(f"BigDataCorp recusou o acesso: {erros_login[0].get('Message')}")
        return "erro", None, datasets
    resultado = (dados.get("Result") or [None])[0]
    if not resultado:
        return "nao_encontrado", None, datasets
    return "encontrado", resultado, datasets


# ---------------------------------------------------------------------------
# Sugestões para o cadastro da loja: família, atributos da família e descrição
# ---------------------------------------------------------------------------

# Palavras do tipo/nome do item -> família (só vale se a família estiver no mix da loja).
PALAVRAS_FAMILIA = {
    # Ordem importa: a primeira família do mix da loja que casar vence (as específicas vêm antes,
    # ex.: "FIO DENTAL" é higiene antes de "FIO" ser elétrica; "MAMADEIRA" é bebê antes de bazar).
    "bebe": ("MAMADEIRA", "CHUPETA", "MORDEDOR", "BICO DE MAMADEIRA", "LENCO UMEDECIDO", "FRALDA INFANTIL",
             "FRALDA DESCARTAVEL", "POMADA PARA ASSADURA", "BODY BEBE", "BANHEIRA INFANTIL", "COPO DE TRANSICAO"),
    "pet": ("RACAO", "PETISCO", "AREIA SANITARIA", "AREIA HIGIENICA", "COLEIRA", "ANTIPULGAS", "VERMIFUGO",
            "TAPETE HIGIENICO", "ARRANHADOR", "CAES", "GATOS"),
    "higiene": ("CREME DENTAL", "ESCOVA DENTAL", "ESCOVA DE DENTE", "FIO DENTAL", "ENXAGUANTE BUCAL",
                "SABONETE", "DESODORANTE", "ABSORVENTE", "PROTETOR DIARIO", "PAPEL HIGIENICO", "LENCO DE PAPEL",
                "APARELHO DE BARBEAR", "LAMINA DE BARBEAR", "ESPUMA DE BARBEAR", "ALGODAO", "HASTE FLEXIVEL",
                "COTONETE", "CURATIVO", "PRESERVATIVO", "FRALDA GERIATRICA", "POMADA", "RELAXANTE MUSCULAR"),
    "limpeza": ("DETERGENTE", "SABAO EM PO", "SABAO LIQUIDO", "SABAO EM BARRA", "AMACIANTE", "ALVEJANTE",
                "TIRA MANCHAS", "AGUA SANITARIA", "DESINFETANTE", "MULTIUSO", "LIMPA VIDROS", "DESENGORDURANTE",
                "LUSTRA MOVEIS", "INSETICIDA", "REPELENTE", "ODORIZADOR", "ESPONJA", "PALHA DE ACO",
                "PANO DE CHAO", "SACO DE LIXO", "SACO PARA LIXO", "VASSOURA", "RODO", "PRENDEDOR"),
    "perfumaria_higiene": ("SHAMPOO", "CONDICIONADOR", "PERFUME", "COLONIA", "BODY SPLASH", "HIDRATANTE",
                           "PROTETOR SOLAR", "ESMALTE", "BATOM", "MAQUIAGEM", "BASE LIQUIDA", "RIMEL",
                           "MASCARA DE CILIOS", "TINTURA", "COLORACAO", "CREME DE PENTEAR", "MASCARA CAPILAR",
                           "SERUM", "DEMAQUILANTE"),
    "suplementos": ("WHEY", "CREATINA", "SUPLEMENTO", "PROTEINA EM PO", "BCAA", "MULTIVITAMINICO",
                    "VITAMINA", "OMEGA 3", "COLAGENO", "PRE TREINO", "TERMOGENICO", "GLUTAMINA", "MELATONINA"),
    "bebida": ("REFRIGERANTE", "SUCO", "AGUA MINERAL", "AGUA DE COCO", "CERVEJA", "VINHO", "ENERGETICO",
               "ISOTONICO", "CHA PRONTO", "CACHACA", "VODKA", "WHISKY", "GIN", "LICOR", "ESPUMANTE", "BEBIDA"),
    "frios_congelados": ("IOGURTE", "QUEIJO", "REQUEIJAO", "PRESUNTO", "MORTADELA", "SALAME", "SALSICHA",
                         "LINGUICA", "PEITO DE PERU", "MANTEIGA", "MARGARINA", "CONGELADO", "SORVETE",
                         "PIZZA CONGELADA", "EMPANADO", "POLPA DE FRUTA", "CREME DE LEITE", "LEITE CONDENSADO"),
    "tabacaria": ("CIGARRO", "SEDA PARA CIGARRO", "ISQUEIRO", "FUMO", "PALHEIRO", "NARGUILE"),
    "cama_mesa_banho": ("JOGO DE LENCOL", "LENCOL", "FRONHA", "COLCHA", "COBRE LEITO", "EDREDOM", "COBERTOR",
                        "MANTA", "TRAVESSEIRO", "TOALHA DE BANHO", "TOALHA DE ROSTO", "TOALHA DE MESA", "ROUPAO",
                        "TAPETE", "CORTINA", "ALMOFADA", "PANO DE PRATO", "JOGO AMERICANO", "PROTETOR DE COLCHAO"),
    "brinquedos": ("BRINQUEDO", "BONECA", "BONECO", "CARRINHO DE BRINQUEDO", "QUEBRA CABECA", "PELUCIA",
                   "JOGO DE TABULEIRO", "BLOCOS DE MONTAR", "MASSINHA", "SLIME", "PATINETE"),
    "papelaria": ("CADERNO", "CANETA", "LAPIS", "LAPISEIRA", "BORRACHA ESCOLAR", "APONTADOR", "MARCA TEXTO",
                  "AGENDA", "FICHARIO", "ESTOJO", "PAPEL SULFITE", "ENVELOPE", "GRAMPEADOR", "CLIPS",
                  "COLA BRANCA", "TESOURA ESCOLAR", "MOCHILA ESCOLAR", "POST IT"),
    "eletronicos": ("CARREGADOR", "CABO USB", "FONE DE OUVIDO", "CAIXA DE SOM", "CAPINHA", "PELICULA",
                    "POWER BANK", "SMARTWATCH", "SMARTPHONE", "CELULAR", "PEN DRIVE", "CARTAO DE MEMORIA",
                    "MOUSE", "TECLADO", "PILHA", "BATERIA RECARREGAVEL", "CONTROLE REMOTO", "ADAPTADOR"),
    "eletro": ("LIQUIDIFICADOR", "BATEDEIRA", "FERRO DE PASSAR", "VENTILADOR", "MICROONDAS", "MICRO ONDAS",
               "CAFETEIRA", "SANDUICHEIRA", "AIR FRYER", "FRITADEIRA", "SECADOR", "CHAPINHA", "ASPIRADOR",
               "TELEVISOR", "MIXER", "PROCESSADOR DE ALIMENTOS", "CHALEIRA ELETRICA", "TORRADEIRA", "AQUECEDOR"),
    "ferramentas": ("FURADEIRA", "PARAFUSADEIRA", "ESMERILHADEIRA", "LIXADEIRA", "SERRA", "SERROTE", "ALICATE",
                    "MARTELO", "CHAVE DE FENDA", "CHAVE PHILLIPS", "CHAVE ALLEN", "CHAVE COMBINADA", "TRENA",
                    "NIVEL", "BROCA", "CAIXA DE FERRAMENTAS", "FERRAMENTA"),
    "tintas": ("TINTA", "VERNIZ", "ESMALTE SINTETICO", "SELADOR", "MASSA CORRIDA", "ROLO DE PINTURA",
               "PINCEL", "THINNER", "AGUARRAS", "SPRAY"),
    "jardinagem": ("VASO", "CACHEPO", "SEMENTE", "MUDA", "ADUBO", "FERTILIZANTE", "SUBSTRATO", "TERRA VEGETAL",
                   "REGADOR", "MANGUEIRA DE JARDIM", "ESGUICHO", "SUCULENTA", "CACTO", "PLANTA"),
    "decoracao": ("QUADRO", "PORTA RETRATO", "FLOR ARTIFICIAL", "ESPELHO", "RELOGIO DE PAREDE",
                  "VELA DECORATIVA", "DIFUSOR", "AROMATIZADOR", "ENFEITE", "ESCULTURA", "NICHO", "ARRANJO"),
    "embalagem_descartavel": ("DESCARTAVEL", "GUARDANAPO", "SACO PLASTICO", "SACOLA", "FILME PVC",
                              "PAPEL ALUMINIO", "MARMITEX", "CANUDO", "BALAO", "BEXIGA", "VELA DE ANIVERSARIO",
                              "FORMINHA"),
    "calcados": ("TENIS", "SAPATO", "SANDALIA", "CHINELO", "BOTA", "SAPATILHA", "MOCASSIM", "TAMANCO", "PANTUFA",
                 "RASTEIRA", "COTURNO"),
    "acessorios": ("BOLSA", "CARTEIRA", "NECESSAIRE", "MALA DE VIAGEM", "CINTO", "OCULOS DE SOL", "RELOGIO",
                   "BIJUTERIA", "BRINCO", "COLAR", "PULSEIRA", "ANEL", "GUARDA CHUVA", "BONE", "CHAPEU"),
    "vestuario": ("CAMISETA", "CAMISA", "CALCA", "BERMUDA", "SHORT", "VESTIDO", "SAIA", "BLUSA", "JAQUETA",
                  "MOLETOM", "MEIA", "CUECA", "CALCINHA", "SUTIA", "PIJAMA", "REGATA", "LEGGING"),
    "esporte": ("BOLA", "HALTER", "ANILHA", "TAPETE DE YOGA", "BICICLETA", "CAPACETE", "BARRACA",
                "SACO DE DORMIR", "VARA DE PESCA", "MOLINETE", "COOLER", "CAIXA TERMICA", "SKATE", "PATINS"),
    "construcao_eletrica": ("FIO", "CABO FLEXIVEL", "DISJUNTOR", "TOMADA", "INTERRUPTOR", "ELETRODUTO",
                            "QUADRO DE DISTRIBUICAO", "FITA ISOLANTE", "PLUGUE", "LAMPADA", "LUMINARIA",
                            "EXTENSAO", "FILTRO DE LINHA"),
    "construcao_hidraulica": ("TUBO", "CANO", "CONEXAO", "JOELHO", "REGISTRO", "TORNEIRA", "SIFAO", "VALVULA",
                              "CAIXA D AGUA", "CHUVEIRO", "DUCHA", "RALO"),
    "construcao_ferragem": ("PARAFUSO", "PREGO", "PORCA", "ARRUELA", "BUCHA", "DOBRADICA", "CADEADO",
                            "FECHADURA", "TRINCO", "ABRACADEIRA", "PUXADOR"),
    "construcao_leve": ("CIMENTO", "ARGAMASSA", "REJUNTE", "LIXA", "IMPERMEABILIZANTE", "TIJOLO", "SILICONE",
                        "LONA", "ARAME"),
    "autopecas": ("PASTILHA DE FREIO", "VELA DE IGNICAO", "FILTRO DE OLEO", "FILTRO DE AR", "OLEO DE MOTOR",
                  "OLEO LUBRIFICANTE", "KIT RELACAO", "PNEU", "CAMARA DE AR", "AMORTECEDOR", "RETROVISOR",
                  "MANETE", "ADITIVO", "FLUIDO DE FREIO"),
    "bazar": ("POTE", "PANELA", "FRIGIDEIRA", "TALHER", "COPO", "CANECA", "XICARA", "PRATO", "TRAVESSA",
              "UTENSILIO", "AMOLADOR", "TABUA", "ESCORREDOR", "BALDE", "GARRAFA TERMICA", "GARRAFA", "SQUEEZE",
              "ASSADEIRA", "FORMA", "REFRATARIO", "ORGANIZADOR", "CABIDE", "LIXEIRA", "PORTA TEMPERO",
              "FACA", "CONCHA", "ESPATULA", "PENEIRA", "FUNIL", "ABRIDOR"),
    "alimento": ("ARROZ", "FEIJAO", "BISCOITO", "BOLACHA", "MACARRAO", "CAFE", "ACUCAR", "OLEO DE SOJA",
                 "FARINHA", "LEITE", "CHOCOLATE", "SALGADINHO", "TEMPERO", "MOLHO", "SARDINHA", "ATUM", "MILHO",
                 "ERVILHA", "CEREAL", "AVEIA", "GELATINA", "BALA", "ACHOCOLATADO", "MAIONESE", "KETCHUP"),
}

# NCM (posição de 4 dígitos ou capítulo de 2) -> família; posição vale antes do capítulo.
NCM_POSICAO_FAMILIA = {
    "2106": "suplementos", "2309": "pet",
    "0401": "frios_congelados", "0402": "frios_congelados", "0403": "frios_congelados", "0405": "frios_congelados",
    "0406": "frios_congelados", "1601": "frios_congelados", "2105": "frios_congelados",
    "3401": "higiene", "3306": "higiene", "3307": "higiene", "4818": "higiene", "9603": "higiene",
    "9619": "higiene", "3005": "higiene",
    "3402": "limpeza", "3808": "limpeza", "3405": "limpeza",
    "2402": "tabacaria", "2403": "tabacaria", "9613": "tabacaria",
    "6301": "cama_mesa_banho", "6302": "cama_mesa_banho", "6303": "cama_mesa_banho", "5705": "cama_mesa_banho",
    "9503": "brinquedos", "9504": "brinquedos",
    "4820": "papelaria", "9608": "papelaria", "9609": "papelaria", "4802": "papelaria", "4817": "papelaria",
    "8517": "eletronicos", "8518": "eletronicos", "8471": "eletronicos", "8506": "eletronicos",
    "8507": "eletronicos", "8523": "eletronicos", "8504": "eletronicos",
    "8467": "ferramentas", "8203": "ferramentas", "8204": "ferramentas", "8205": "ferramentas",
    "8207": "ferramentas", "9017": "ferramentas",
    "3208": "tintas", "3209": "tintas", "3210": "tintas", "3214": "tintas",
    "0602": "jardinagem", "1209": "jardinagem", "3101": "jardinagem", "3105": "jardinagem",
    "4202": "acessorios", "7117": "acessorios", "9004": "acessorios", "9102": "acessorios", "6505": "acessorios",
    "9506": "esporte",
    "7323": "bazar", "6911": "bazar", "6912": "bazar", "7013": "bazar", "8215": "bazar", "8211": "bazar",
    "8708": "autopecas", "4011": "autopecas", "4013": "autopecas",
    "8536": "construcao_eletrica", "8544": "construcao_eletrica", "8547": "construcao_eletrica",
    "8539": "construcao_eletrica",
    "3917": "construcao_hidraulica", "8481": "construcao_hidraulica", "7307": "construcao_hidraulica",
    "7318": "construcao_ferragem", "8301": "construcao_ferragem", "8302": "construcao_ferragem",
}
NCM_CAPITULO_FAMILIA = {"22": "bebida", "24": "tabacaria", "33": "perfumaria_higiene", "64": "calcados",
                        "61": "vestuario", "62": "vestuario", "63": "cama_mesa_banho", "84": "eletro",
                        "85": "eletro", "25": "construcao_leve", "32": "tintas", "68": "construcao_leve",
                        "95": "brinquedos", "71": "acessorios", "49": "papelaria"}


def familia_por_evidencia(ncm, textos, mix):
    """Família pelo NCM e pelas palavras do tipo/nome; None sem evidência ou fora do mix da loja."""
    candidatas = []
    ncm = "".join(ch for ch in str(ncm or "") if ch.isdigit())
    if len(ncm) >= 4:
        if ncm[:4] in NCM_POSICAO_FAMILIA:
            candidatas.append(NCM_POSICAO_FAMILIA[ncm[:4]])
        if ncm[:2] in NCM_CAPITULO_FAMILIA:
            candidatas.append(NCM_CAPITULO_FAMILIA[ncm[:2]])
        elif "01" <= ncm[:2] <= "21":
            candidatas.append("alimento")
    palavras_texto = " " + _chave(" ".join(t for t in textos if t)) + " "
    for familia, palavras in PALAVRAS_FAMILIA.items():
        if any(f" {p} " in palavras_texto for p in palavras):
            candidatas.append(familia)
    return next((f for f in candidatas if f in mix), None)


def _numero(texto):
    """Primeiro número do texto ('1.200 W' -> 1200.0, '2,5 mm' -> 2.5); None se não houver."""
    import re
    m = re.search(r"\d+(?:[.,]\d+)*", str(texto or ""))
    if not m:
        return None
    bruto = m.group(0)
    if "," in bruto:
        bruto = bruto.replace(".", "").replace(",", ".")
    elif bruto.count(".") > 1 or (bruto.count(".") == 1 and len(bruto.split(".")[1]) == 3):
        bruto = bruto.replace(".", "")
    try:
        return float(bruto)
    except ValueError:
        return None


def _fichas(resultado: dict):
    fontes = list(((resultado.get("ExtraInfoData") or {}).get("ExtraInfoPerSource") or {}).values())
    atributos = [{_chave(k): v for k, v in ((f or {}).get("UncategorizedExtraInfo") or {}).items()} for f in fontes]
    atributos.sort(key=len, reverse=True)
    return fontes, atributos


def atributos_candidatos(resultado: dict) -> dict:
    """Valores brutos para os atributos de família; o schema da loja filtra e valida depois."""
    fontes, atributos = _fichas(resultado)
    p = lambda *chaves: _primeiro(atributos, *chaves)
    c = {}
    c["cor"] = c["cores"] = p("COR", "COR PREDOMINANTE", "COR DO PRODUTO")
    c["modelo"] = p("MODELO", "REFERENCIA DO MODELO")
    voltagem = p("VOLTAGEM", "TENSAO", "TENSAO NOMINAL")
    c["voltagem_eletro"] = voltagem
    c["voltagem_v"] = _numero(voltagem)
    c["potencia_w"] = _numero(p("POTENCIA", "POTENCIA (W)", "POTENCIA MAXIMA"))
    c["amperagem_a"] = _numero(p("CORRENTE", "AMPERAGEM", "CORRENTE NOMINAL"))
    garantia = p("GARANTIA", "GARANTIA DO FORNECEDOR", "PRAZO DE GARANTIA")
    meses = _numero(garantia)
    c["garantia_meses"] = meses * 12 if meses is not None and "ANO" in _chave(garantia) else meses
    largura_cm = _numero(p("LARGURA (CM)", "LARGURA DO PRODUTO (CM)"))
    c["largura_mm"] = largura_cm * 10 if largura_cm else _numero(p("LARGURA (MM)"))
    comprimento_cm = _numero(p("COMPRIMENTO (CM)"))
    c["comprimento_m"] = _numero(p("COMPRIMENTO (M)", "METRAGEM")) or (comprimento_cm / 100 if comprimento_cm else None)
    c["espessura_mm"] = _numero(p("ESPESSURA (MM)", "ESPESSURA"))
    c["diametro_pol"] = _numero(p("BITOLA (POL)", "DIAMETRO (POL)", "BITOLA"))
    c["diametro_hidraulico_mm"] = _numero(p("DIAMETRO (MM)", "DIAMETRO NOMINAL", "DIAMETRO"))
    c["pressao_maxima_bar"] = _numero(p("PRESSAO MAXIMA", "PRESSAO (BAR)"))
    peso = _numero(p("PESO LIQUIDO (KG)", "PESO (KG)", "PESO BRUTO"))
    if peso is None:
        peso = next((g.get("Weight") for g in (((f or {}).get("GenericExtraInfo") or {}) for f in fontes)
                     if g.get("Weight") not in (None, -1, 0)), None)
    c["peso_kg"] = peso
    material = p("MATERIAL", "MATERIAL PRINCIPAL", "MATERIAL EXTERNO")
    c["material_tubo"] = c["material_ferragem"] = c["material_calcado"] = material
    c["tecido"] = p("TECIDO", "COMPOSICAO", "MATERIAL")
    c["tipo_rosca"] = p("TIPO DE ROSCA", "ROSCA")
    c["tipo_cabeca"] = p("TIPO DE CABECA", "FENDA")
    c["comprimento_parafuso_mm"] = _numero(p("COMPRIMENTO (MM)"))
    c["numeracao"] = c["tamanhos"] = p("TAMANHO", "NUMERACAO", "TAMANHO DO CALCADO")
    c["genero"] = p("GENERO", "SEXO", "PUBLICO")
    c["tipo_calcado"] = p("NOME PRINCIPAL DO ITEM", "TIPO DE CALCADO")
    c["embalagem"] = p("TIPO DE EMBALAGEM", "EMBALAGEM")
    itens = _numero(p("QUANTIDADE DE UNIDADES", "QTD UNIDADES", "UNIDADES POR EMBALAGEM"))
    c["itens_por_embalagem"] = itens if itens and itens > 1 else None
    c["sabor"] = p("SABOR")
    c["forma_apresentacao"] = p("FORMA FARMACEUTICA", "APRESENTACAO", "FORMA")
    c["dose_porcao"] = p("PORCAO", "DOSE")
    c["doses_por_embalagem"] = _numero(p("PORCOES POR EMBALAGEM", "DOSES POR EMBALAGEM"))
    c["nutriente_principal"] = p("NOME PRINCIPAL DO ITEM", "TIPO DE SUPLEMENTO")
    alergenicos = []
    for chave, contem, sem in (("GLUTEN", "Contém glúten", "Sem glúten"), ("LACTOSE", "Contém lactose", "Sem lactose")):
        valor = _chave(p(chave))
        if valor:
            alergenicos.append(sem if ("NAO" in valor or "SEM" in valor) else contem)
    c["alergenicos"] = alergenicos or None
    c["registro_anvisa"] = p("REGISTRO MS", "REGISTRO ANVISA") or _primeiro(
        [((f or {}).get("MedicineExtraInfo") or {}) for f in fontes], "MSRegister")
    c["montadora"] = p("MONTADORA", "MARCA DO VEICULO")
    c["veiculo_compativel"] = p("VEICULOS COMPATIVEIS", "COMPATIBILIDADE", "APLICACAO")
    c["numero_oem"] = p("CODIGO ORIGINAL", "NUMERO OEM", "CODIGO OEM", "REFERENCIA ORIGINAL")
    return {k: v for k, v in c.items() if v not in (None, "", [])}


def descricao_produto(resultado: dict) -> str:
    """Descrição da loja de origem ou, sem ela, os ingredientes (alimento/bebida)."""
    _, atributos = _fichas(resultado)
    descricao = _texto(_primeiro(atributos, "DESCRICAO", "DESCRICAO DO PRODUTO", "CARACTERISTICAS",
                                 "SHORT_DESCRIPTION", "DESCRIPTION"))
    if descricao:
        return descricao[:1000]
    ingredientes = _primeiro(atributos, "INGREDIENTES")
    return f"Ingredientes: {ingredientes}"[:1000] if ingredientes else ""


LIMITE_PAYLOAD = 60000


def payload_compacto(resultado: dict) -> str:
    """JSON da resposta que cabe na coluna sem ser cortado no meio (o corte gerava JSON inválido).

    Textos longos (descrição em HTML) são encurtados; se ainda não couber, fica só a ficha técnica.
    """
    import json

    def encurtar(valor, limite):
        if isinstance(valor, dict):
            return {k: encurtar(v, limite) for k, v in valor.items()}
        if isinstance(valor, list):
            return [encurtar(v, limite) for v in valor[:20]]
        if isinstance(valor, str) and len(valor) > limite:
            return valor[:limite]
        return valor

    texto = json.dumps(resultado, ensure_ascii=False)
    for limite in (4000, 1500, 500):
        if len(texto) <= LIMITE_PAYLOAD:
            return texto
        texto = json.dumps(encurtar(resultado, limite), ensure_ascii=False)
    if len(texto) > LIMITE_PAYLOAD:
        texto = json.dumps({k: encurtar(resultado.get(k), 300) for k in ("PrimaryId", "ExtraInfoData")},
                           ensure_ascii=False)
    return texto if len(texto) <= LIMITE_PAYLOAD else json.dumps({"PrimaryId": resultado.get("PrimaryId")})


def buscar_por_termo(termo: str, limite: int = 5):
    """Busca por nome (chave ``searchterms`` da API de Produtos): ``(motivo, resultados)``.

    Só a Ficha Técnica, que traz nome, marca e foto. A API cobra 1 consulta por produto
    devolvido: reserva ``limite`` e devolve à franquia o que não veio.
    """
    if not configurado():
        return "nao_configurado", []
    dataset = "extra_info_data"
    reservadas = reservar_consultas(dataset, limite)
    if not reservadas:
        return "sem_cota", []
    termo_limpo = " ".join(re.sub(r"[{}]", " ", str(termo)).split())[:80]
    headers = {
        "AccessToken": os.environ["API_BIG_DATA_CORP"].strip(),
        "TokenId": os.environ["API_BIG_DATA_CORP_TOKEN_ID"].strip(),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        resp = requests.post(URL_PRODUTOS, json={"Datasets": dataset,
                                                 "q": f"searchterms{{{termo_limpo}}}, matchtype{{flexible}}",
                                                 "Limit": reservadas}, headers=headers, timeout=15)
        dados = resp.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        current_app.logger.warning(f"BigDataCorp sem resposta na busca '{termo_limpo}': {e}")
        devolver_consultas(dataset, reservadas)
        return "erro", []
    status = dados.get("Status") or {}
    erros_login = [s for s in (status.get("login") or []) if s.get("Code") not in (0, None)]
    if erros_login:
        current_app.logger.error(f"BigDataCorp recusou o acesso: {erros_login[0].get('Message')}")
        devolver_consultas(dataset, reservadas)
        return "erro", []
    resultados = [r for r in (dados.get("Result") or []) if isinstance(r, dict)]
    devolver_consultas(dataset, reservadas - len(resultados))
    return ("encontrado" if resultados else "nao_encontrado"), resultados
