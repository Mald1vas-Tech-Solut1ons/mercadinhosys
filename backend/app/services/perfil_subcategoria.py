"""Perfil por SUBCATEGORIA: o que o sistema sabe de cada tipo de produto.

A família dá o formulário; a subcategoria refina o que importa de verdade:
  - validade: "obrigatoria" | "opcional" | "nao_se_aplica"
      (lâmina, escova e vela não vencem; leite, ração e banho fabricado vencem)
  - ncm: NCM provável de 8 dígitos (sugestão para conferir com o contador, nunca imposição)

Resolução: subcategoria → categoria → família (flags da família). As regras são escritas por NOME
(família, categoria, subcategoria opcional) e convertidas em chave oficial na importação; nome que
não existe na TAXONOMIA derruba a importação (o teste pega erro de digitação).
"""
from app.services.catalogo_familias import TAXONOMIA, chave_categoria, chave_subcategoria

OBRIGATORIA, OPCIONAL, NAO_SE_APLICA = "obrigatoria", "opcional", "nao_se_aplica"
REGRAS_VALIDADE_VALIDAS = (OBRIGATORIA, OPCIONAL, NAO_SE_APLICA)

# (família, categoria, [subcategorias] ou None = categoria inteira, regra)
_VALIDADE = [
    # Higiene: a família exige validade, mas acessório não vence.
    ("higiene", "Banho", ["Esponjas de Banho"], NAO_SE_APLICA),
    ("higiene", "Higiene Bucal", ["Escovas de Dente", "Escovas Interdentais", "Limpa Língua",
                                  "Dentaduras e Próteses"], NAO_SE_APLICA),
    ("higiene", "Higiene Íntima e Descartáveis", ["Papel Higiênico", "Lenços de Papel", "Algodão e Hastes",
                                                  "Coletores Menstruais"], NAO_SE_APLICA),
    ("higiene", "Barbear e Depilação", ["Lâminas e Aparelhos"], NAO_SE_APLICA),
    ("higiene", "Saúde e Primeiros Socorros", ["Termômetros", "Máscaras Faciais Descartáveis"], NAO_SE_APLICA),
    ("higiene", "Geriatria e Mobilidade", None, NAO_SE_APLICA),
    ("higiene", "Higiene Infantil", ["Escova de Dente Infantil", "Aspirador Nasal Adulto",
                                     "Cotonetes Infantis"], NAO_SE_APLICA),
    # Perfumaria: utensílio e acessório não vencem.
    ("perfumaria_higiene", "Maquiagem e Unhas", ["Unhas e Cutelaria", "Pincéis e Esponjas"], NAO_SE_APLICA),
    ("perfumaria_higiene", "Cabelos", ["Acessórios de Cabelo"], NAO_SE_APLICA),
    ("perfumaria_higiene", "Barbearia e Masculino", ["Aparadores de Barba"], NAO_SE_APLICA),
    ("perfumaria_higiene", "Presentes e Acessórios", ["Necessaires e Acessórios", "Espelhos de Bolso",
                                                      "Organizadores de Maquiagem"], NAO_SE_APLICA),
    # Limpeza: acessório (vassoura, balde, pano) não vence.
    ("limpeza", "Acessórios de Limpeza", None, NAO_SE_APLICA),
    ("limpeza", "Controle de Pragas", ["Venenos e Ratoeiras", "Espanta Pássaros"], OPCIONAL),
    # Suplementos: coqueteleira não vence.
    ("suplementos", "Acessórios de Nutrição", None, NAO_SE_APLICA),
    # Bebê (família opcional): alimento e higiene vencem; enxoval e móvel não.
    ("bebe", "Alimentação", ["Leites e Fórmulas Infantis", "Papinhas"], OBRIGATORIA),
    ("bebe", "Alimentação", ["Mamadeiras", "Bicos e Chupetas", "Mordedores", "Copos de Transição",
                             "Pratos e Talheres Infantis", "Babadores", "Potinhos e Suqueiras"], NAO_SE_APLICA),
    ("bebe", "Higiene do Bebê", ["Lenços Umedecidos", "Pomadas para Assaduras",
                                 "Shampoo e Sabonete Infantil"], OBRIGATORIA),
    ("bebe", "Higiene do Bebê", ["Banheiras e Banho", "Toalhas e Fraldas de Pano", "Aspirador Nasal"], NAO_SE_APLICA),
    ("bebe", "Enxoval e Roupas", None, NAO_SE_APLICA),
    ("bebe", "Quarto e Móveis", None, NAO_SE_APLICA),
    ("bebe", "Passeio e Segurança", None, NAO_SE_APLICA),
    ("bebe", "Brinquedos de Bebê", None, NAO_SE_APLICA),
    # Pet (família opcional): ração e remédio vencem; acessório não.
    ("pet", "Alimentação", None, OBRIGATORIA),
    ("pet", "Higiene e Saúde", ["Antipulgas e Vermífugos", "Medicamentos Pet"], OBRIGATORIA),
    ("pet", "Higiene e Saúde", ["Escovas de Pelos", "Corta-unhas e Tesouras"], NAO_SE_APLICA),
    ("pet", "Acessórios", None, NAO_SE_APLICA),
    ("pet", "Aves, Peixes e Roedores", None, NAO_SE_APLICA),
    ("pet", "Passeio e Adestramento", None, NAO_SE_APLICA),
    ("pet", "Passeio e Adestramento", ["Petiscos de Adestramento"], OBRIGATORIA),
    # Religioso (família sem validade): o que é cosmético/erva vence.
    ("religioso", "Ervas, Banhos e Defumação", ["Ervas para Banho e Defumação"], OPCIONAL),
    ("religioso", "Ervas, Banhos e Defumação", ["Banhos Prontos", "Essências, Óleos e Perfumes Ritualísticos",
                                                "Sabonetes Ritualísticos"], OBRIGATORIA),
    ("religioso", "Livros e Presentes", ["Óleo de Unção"], OPCIONAL),
    ("religioso", "Kits e Oferendas", ["Kits de Banho Ritualístico"], OPCIONAL),
]

# NCM provável por subcategoria (ou categoria inteira). Sugestão para conferir, nunca imposição.
_NCM = [
    # Motopeças (capítulo 87.14 = partes de motocicleta; pneu/câmara/bateria/vela têm posição própria)
    ("motopecas", "Motor", None, "87141000"),
    ("motopecas", "Motor", ["Velas de Ignição de Moto"], "85111000"),
    ("motopecas", "Motor", ["Filtros de Óleo de Moto"], "84212300"),
    ("motopecas", "Motor", ["Filtros de Ar de Moto"], "84213100"),
    ("motopecas", "Transmissão e Relação", None, "87141000"),
    ("motopecas", "Freios", None, "87141000"),
    ("motopecas", "Suspensão e Direção", None, "87141000"),
    ("motopecas", "Pneus e Rodas", None, "87141000"),
    ("motopecas", "Pneus e Rodas", ["Pneus de Moto"], "40114000"),
    ("motopecas", "Pneus e Rodas", ["Câmaras de Ar de Moto"], "40139000"),
    ("motopecas", "Elétrica e Iluminação", ["Baterias de Moto"], "85071000"),
    ("motopecas", "Carenagem e Plásticos", None, "87141000"),
    ("motopecas", "Acessórios e Segurança", ["Capacetes de Moto"], "65061000"),
    ("motopecas", "Lubrificantes e Manutenção", ["Óleos de Motor 4T", "Óleos 2T"], "27101932"),
    # Autopeças (carro): 87.08 = partes de veículos automóveis
    ("autopecas", "Motor e Transmissão", None, "87089990"),
    ("autopecas", "Freios e Suspensão", ["Pastilhas e Lonas"], "68138110"),
    ("autopecas", "Freios e Suspensão", ["Amortecedores"], "87088000"),
    ("autopecas", "Pneus", ["Pneus e Câmaras"], "40111000"),
    ("autopecas", "Elétrica Automotiva", ["Baterias"], "85071000"),
    ("autopecas", "Arrefecimento", ["Radiadores"], "87089100"),
    # Peças de celular (só a bateria tem posição inequívoca; as demais o contador confirma)
    ("eletronicos", "Peças para Celular", ["Baterias de Celular"], "85076000"),
    # Religioso (confirmar com o contador: imagem depende do material)
    ("religioso", "Velas", None, "34060000"),
    ("religioso", "Imagens e Estátuas", None, "39264000"),
    ("religioso", "Artigos Católicos", ["Terços e Rosários", "Medalhas Religiosas", "Escapulários"], "71179000"),
    ("religioso", "Umbanda e Candomblé", ["Guias e Fios de Conta"], "71179000"),
    ("religioso", "Ervas, Banhos e Defumação", ["Incensos Religiosos"], "33074100"),
    ("religioso", "Ervas, Banhos e Defumação", ["Defumadores"], "33074900"),
    ("religioso", "Ervas, Banhos e Defumação", ["Ervas para Banho e Defumação"], "12119090"),
    ("religioso", "Ervas, Banhos e Defumação", ["Sabonetes Ritualísticos"], "34011190"),
    ("religioso", "Ervas, Banhos e Defumação", ["Banhos Prontos", "Sal Grosso para Banho"], "33073000"),
    ("religioso", "Ervas, Banhos e Defumação", ["Essências, Óleos e Perfumes Ritualísticos"], "33030010"),
    ("religioso", "Livros e Presentes", ["Bíblias", "Livros Católicos", "Livros Espíritas",
                                         "Livros de Umbanda e Candomblé"], "49019900"),
]

# NCM da imagem pelo material (o material é atributo do produto).
NCM_IMAGEM_POR_MATERIAL = {
    "Resina": "39264000", "Gesso": "68099000", "Porcelana": "69131000", "Cerâmica": "69139000",
    "Barro": "69139000", "Louça": "69139000", "Metal": "83062900",
}
_CHAVE_CAT_IMAGENS = chave_categoria("religioso", "Imagens e Estátuas")


# Campos de atributo que IMPORTAM em cada tipo de produto. Onde há regra, o formulário mostra só estes
# (os campos núcleo — código de barras, marca, unidade, fiscal, preço, estoque — continuam sempre).
_AUTO = ["montadora", "veiculo_compativel", "ano_aplicacao", "codigo_fabricante", "numero_oem"]
_MOTO = _AUTO + ["cilindrada"]
_CARRO = _AUTO + ["motorizacao"]
_CAMPOS = [
    # Motopeças
    ("motopecas", "Pneus e Rodas", None, ["medida_pneu", "aro", "uso_pneu", "montadora", "veiculo_compativel",
                                          "codigo_fabricante"]),
    ("motopecas", "Pneus e Rodas", ["Câmaras de Ar de Moto", "Bicos e Válvulas de Câmara"],
     ["medida_pneu", "aro", "tipo_valvula", "montadora", "veiculo_compativel", "codigo_fabricante"]),
    ("motopecas", "Motor", None, _MOTO),
    ("motopecas", "Transmissão e Relação", None, _MOTO),
    ("motopecas", "Freios", None, _MOTO + ["posicao"]),
    ("motopecas", "Suspensão e Direção", None, _MOTO + ["posicao"]),
    ("motopecas", "Elétrica e Iluminação", None, _MOTO + ["posicao"]),
    ("motopecas", "Carenagem e Plásticos", None, _MOTO + ["posicao", "cor"]),
    ("motopecas", "Acessórios e Segurança", None, ["montadora", "veiculo_compativel", "codigo_fabricante", "cor"]),
    ("motopecas", "Acessórios e Segurança", ["Capacetes de Moto"], ["cor", "codigo_fabricante"]),
    ("motopecas", "Lubrificantes e Manutenção", None, ["peso_volume", "codigo_fabricante"]),
    # Autopeças (carro)
    ("autopecas", "Pneus", None, ["medida_pneu", "aro", "codigo_fabricante"]),
    ("autopecas", "Motor e Transmissão", None, _CARRO),
    ("autopecas", "Freios e Suspensão", None, _CARRO + ["posicao"]),
    ("autopecas", "Injeção e Ignição", None, _CARRO),
    ("autopecas", "Arrefecimento", None, _CARRO),
    ("autopecas", "Embreagem", None, _CARRO),
    ("autopecas", "Direção", None, _CARRO + ["posicao"]),
    ("autopecas", "Escapamento", None, _CARRO),
    ("autopecas", "Carroceria e Vidros", None, _CARRO + ["posicao", "cor"]),
    ("autopecas", "Elétrica Automotiva", None, _CARRO),
    # Religioso
    ("religioso", "Velas", None, ["cor", "peso_volume", "tempo_queima_h", "tipo_pavio", "fragrancia", "entidade",
                                  "tradicao_religiosa", "procedencia"]),
    ("religioso", "Imagens e Estátuas", None, ["entidade", "tradicao_religiosa", "altura_cm", "material",
                                               "acabamento_imagem", "procedencia"]),
    ("religioso", "Artigos Católicos", None, ["entidade", "material", "cor", "altura_cm", "procedencia"]),
    ("religioso", "Umbanda e Candomblé", None, ["entidade", "tradicao_religiosa", "cor", "material", "procedencia"]),
    ("religioso", "Ervas, Banhos e Defumação", None, ["peso_volume", "fragrancia", "entidade", "procedencia"]),
    ("religioso", "Ervas, Banhos e Defumação", ["Banhos Prontos", "Essências, Óleos e Perfumes Ritualísticos",
                                                "Sabonetes Ritualísticos"],
     ["peso_volume", "fragrancia", "entidade", "procedencia", "regularizacao_sanitaria", "registro_anvisa"]),
    ("religioso", "Esotérico", None, ["material", "cor", "peso_volume", "procedencia"]),
    ("religioso", "Livros e Presentes", None, ["tradicao_religiosa", "procedencia"]),
    ("religioso", "Kits e Oferendas", None, ["entidade", "tradicao_religiosa", "procedencia"]),
    # Peças de celular
    ("eletronicos", "Peças para Celular", None, ["modelo_compativel", "qualidade_peca", "cor"]),
]


def _expandir(regras):
    """[(familia, categoria, subs|None, valor)] -> ({chave_categoria: valor}, {chave_subcategoria: valor})."""
    por_categoria, por_sub = {}, {}
    for familia, categoria, subs, valor in regras:
        arvore = TAXONOMIA.get(familia)
        if arvore is None or categoria not in arvore:
            raise KeyError(f"perfil_subcategoria: categoria inexistente {familia}/{categoria}")
        if subs is None:
            por_categoria[chave_categoria(familia, categoria)] = valor
            continue
        for sub in subs:
            if sub not in arvore[categoria]:
                raise KeyError(f"perfil_subcategoria: subcategoria inexistente {familia}/{categoria}/{sub}")
            por_sub[chave_subcategoria(familia, categoria, sub)] = valor
    return por_categoria, por_sub


_VALIDADE_CAT, _VALIDADE_SUB = _expandir(_VALIDADE)
_NCM_CAT, _NCM_SUB = _expandir(_NCM)
_CAMPOS_CAT, _CAMPOS_SUB = _expandir(_CAMPOS)


def campos_da_subcategoria(chave_sub: str | None) -> list | None:
    """Campos de atributo relevantes para o tipo de produto (None = sem regra: mostra os da família)."""
    campos = _da_chave(chave_sub, _CAMPOS_CAT, _CAMPOS_SUB)
    return list(campos) if campos else None


def _da_chave(chave_sub: str | None, por_cat: dict, por_sub: dict):
    if not chave_sub:
        return None
    if chave_sub in por_sub:
        return por_sub[chave_sub]
    chave_cat = ".".join(chave_sub.split(".")[:2])
    return por_cat.get(chave_cat)


def regra_validade_da_familia(flags_familia: dict) -> str:
    flags = flags_familia or {}
    if not flags.get("usa_validade", True):
        return NAO_SE_APLICA
    return OBRIGATORIA if flags.get("validade_obrigatoria") else OPCIONAL


def regra_validade(chave_sub: str | None, flags_familia: dict) -> str:
    """Regra efetiva: a da subcategoria (ou da categoria dela) vence a da família."""
    return _da_chave(chave_sub, _VALIDADE_CAT, _VALIDADE_SUB) or regra_validade_da_familia(flags_familia)


def flags_efetivas(chave_sub: str | None, flags_familia: dict) -> dict:
    """Flags da família com a validade refinada pela subcategoria."""
    base = dict(flags_familia or {})
    flags = dict(base)
    regra = regra_validade(chave_sub, base)
    flags["usa_validade"] = regra != NAO_SE_APLICA
    flags["validade_obrigatoria"] = regra == OBRIGATORIA
    if regra == NAO_SE_APLICA:
        flags["usa_lotes"] = False
        flags["exige_fabricacao"] = False
    elif not base.get("usa_validade", True):
        flags["usa_lotes"] = True  # família sem validade, mas este tipo vence: lote junto da validade
    return flags


def ncm_provavel(chave_sub: str | None, material: str | None = None) -> str | None:
    if material and chave_sub and chave_sub.startswith(_CHAVE_CAT_IMAGENS + "."):
        por_material = NCM_IMAGEM_POR_MATERIAL.get(str(material).strip().capitalize())
        if por_material:
            return por_material
    return _da_chave(chave_sub, _NCM_CAT, _NCM_SUB)


def perfis_da_familia(familia: str, flags_familia: dict) -> dict:
    """{chave_subcategoria: {"validade": regra, "ncm": ncm|None}} de toda a família (vai no schema)."""
    perfis = {}
    for categoria, subs in (TAXONOMIA.get(familia) or {}).items():
        for sub in subs:
            chave = chave_subcategoria(familia, categoria, sub)
            perfis[chave] = {"validade": regra_validade(chave, flags_familia), "ncm": ncm_provavel(chave),
                             "campos": campos_da_subcategoria(chave)}
    return perfis
