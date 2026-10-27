# app/services/view_schema_service.py
"""
Motor de Renderização Contextual (Context-Aware Rendering Engine).

O frontend NÃO decide o que exibir: ele renderiza o View Schema resolvido aqui.
A resolução é uma cascata de 3 níveis:

  1. Global (Sistema)  → tabela view_registry (seed a partir deste catálogo).
                         Define QUAIS campos/métricas existem e para quais
                         segmentos valem.
  2. Tenant (Loja)     → Estabelecimento.segmento + overrides em
                         Estabelecimento.configuracoes_json["view_schema"]
                         (ligar/desligar campos e métricas, opções custom).
  3. Produto           → atributos_json, tipo_item, controlar_estoque e
                         controlar_validade de cada produto (aplicado pelo
                         frontend por item; o schema informa as regras).

Nada de "if validade" hardcoded em tela: quem quiser saber se validade existe
pergunta ao schema.
"""
import json
import time

from app import db
from app.models import Estabelecimento, ViewRegistry
from app.services.fiscal.tributacao import regras_para_interface

# ==============================================================================
# SEGMENTOS DE NEGÓCIO
# ==============================================================================
SEGMENTOS = {
    "mercearia": {
        "nome": "Mercearia / Supermercado",
        "descricao": "Alimentos e bebidas, com controle de validade e lotes (FIFO).",
        "icone": "shopping-basket",
        "flags": {
            "usa_validade": True, "usa_lotes": True, "usa_servicos": False,
            "usa_grade": False, "usa_dimensoes": False, "usa_embalagens": True,
        },
        "unidades": ["un", "kg", "g", "l", "ml", "cx", "pct", "fardo", "duzia", "bandeja"],
        "exemplos": {
            "nome": "Ex: Arroz Tio João 5kg",
            "categoria": "Ex: Alimentos, Bebidas, Limpeza...",
            "marca": "Ex: Nestlé",
        },
    },
    "vestuario": {
        "nome": "Vestuário / Moda",
        "descricao": "Roupas e calçados: coleções, tamanhos, cores e grades.",
        "icone": "shirt",
        "flags": {
            "usa_validade": False, "usa_lotes": False, "usa_servicos": False,
            "usa_grade": True, "usa_dimensoes": False, "usa_embalagens": False,
        },
        "unidades": ["un", "par", "conjunto", "kit"],
        "exemplos": {
            "nome": "Ex: Camiseta Básica Algodão",
            "categoria": "Ex: Camisetas, Calças, Vestidos...",
            "marca": "Ex: Hering",
        },
    },
    "construcao": {
        "nome": "Material de Construção",
        "descricao": "Caixas, fardos, tonéis e medidas (largura, espessura, polegadas, diâmetro).",
        "icone": "hammer",
        "flags": {
            "usa_validade": False, "usa_lotes": False, "usa_servicos": False,
            "usa_grade": False, "usa_dimensoes": True, "usa_embalagens": True,
        },
        "unidades": ["un", "cx", "pct", "fardo", "tonel", "barrica", "saco", "lata",
                     "galao", "balde", "rolo", "barra", "m", "m2", "m3", "kg", "t", "milheiro"],
        "exemplos": {
            "nome": "Ex: Cimento CP-II 50kg",
            "categoria": "Ex: Cimento, Tintas, Ferragens...",
            "marca": "Ex: Votorantim",
        },
    },
    "autopecas": {
        "nome": "Moto Peças / Oficina",
        "descricao": "Peças com compatibilidade de veículo e serviços (troca de óleo, reparo, mecânica).",
        "icone": "wrench",
        "flags": {
            "usa_validade": False, "usa_lotes": False, "usa_servicos": True,
            "usa_grade": False, "usa_dimensoes": True, "usa_embalagens": False,
        },
        "unidades": ["un", "par", "kit", "jogo", "l", "ml", "m"],
        "exemplos": {
            "nome": "Ex: Kit Relação CG 160",
            "categoria": "Ex: Motor, Suspensão, Elétrica...",
            "marca": "Ex: Honda",
            "nome_servico": "Ex: Troca de óleo com filtro",
            "categoria_servico": "Ex: Manutenção, Mecânica...",
        },
    },
    "generico": {
        "nome": "Comércio Geral",
        "descricao": "Perfil neutro: liga tudo que precisar pelas configurações.",
        "icone": "store",
        "flags": {
            "usa_validade": True, "usa_lotes": True, "usa_servicos": True,
            "usa_grade": False, "usa_dimensoes": False, "usa_embalagens": True,
        },
        "unidades": ["un", "kg", "g", "l", "ml", "cx", "pct", "fardo", "duzia",
                     "par", "kit", "m", "m2", "rolo"],
        "exemplos": {
            "nome": "Ex: Nome do item",
            "categoria": "Ex: Categoria do produto",
            "marca": "Ex: Marca / Fabricante",
            "nome_servico": "Ex: Nome do serviço",
            "categoria_servico": "Ex: Categoria do serviço",
        },
    },
}

# Fallback aplicado a todo segmento sem par nome_servico/categoria_servico
# explícito: reaproveita os exemplos de produto (evita repetir os mesmos 2
# textos em cada segmento que habilita serviços).
_EXEMPLOS_SERVICO_PADRAO = {
    "nome_servico": "Ex: Nome do serviço",
    "categoria_servico": "Ex: Categoria do serviço",
}
for _seg in SEGMENTOS.values():
    for _chave, _valor in _EXEMPLOS_SERVICO_PADRAO.items():
        _seg["exemplos"].setdefault(_chave, _valor)

SEGMENTO_PADRAO = "mercearia"

FAMILIAS_PRODUTO = {
    "alimento": {
        "nome": "Alimento",
        "descricao": "Item alimentar com foco em estoque, validade e rastreabilidade.",
        "segmento_base": "mercearia",
    },
    "bebida": {
        "nome": "Bebida",
        "descricao": "Bebidas frias, quentes ou alcoólicas dentro do mix da loja.",
        "segmento_base": "mercearia",
        "flags_override": {"usa_lotes": False},
        "exemplos": {"nome": "Ex: Refrigerante Cola 2L"},
    },
    "embalagem_descartavel": {
        "nome": "Embalagem Descartável",
        "descricao": "Descartáveis para lanchonete, hamburgueria e conveniência.",
        "segmento_base": "mercearia",
        "flags_override": {"usa_validade": False, "usa_lotes": False},
        "campos_ocultos": ["controlar_validade"],
        "campos_habilitados": ["cor"],
        "exemplos": {
            "nome": "Ex: Embalagem Hambúrguer Kraft G",
            "categoria": "Ex: Delivery, Marmitas, Copos...",
            "marca": "Ex: Wyda",
        },
    },
    "bazar": {
        "nome": "Bazar",
        "descricao": "Utilidades domésticas, cozinha e presentes.",
        "segmento_base": "generico",
        "flags_override": {"usa_validade": False, "usa_lotes": False, "usa_embalagens": True},
        "campos_ocultos": ["controlar_validade"],
        "campos_habilitados": ["cor"],
        "exemplos": {
            "nome": "Ex: Assadeira Redonda Antiaderente",
            "categoria": "Ex: Panelas, Formas, Organização...",
            "marca": "Ex: Tramontina",
        },
    },
    "perfumaria_higiene": {
        "nome": "Perfumaria e Higiene",
        "descricao": "Perfumes, cosméticos, higiene pessoal e bucal.",
        "segmento_base": "mercearia",
        "campos_habilitados": ["cor"],
        "exemplos": {
            "nome": "Ex: Shampoo Hidratante 350ml",
            "categoria": "Ex: Perfumes, Cabelos, Higiene Bucal...",
            "marca": "Ex: Natura",
        },
    },
    "eletro": {
        "nome": "Eletro e Eletroportáteis",
        "descricao": "Eletrodomésticos, eletroportáteis e eletrônicos: voltagem, garantia, modelo e cor.",
        "segmento_base": "generico",
        "flags_override": {"usa_validade": False, "usa_lotes": False, "usa_servicos": False},
        "campos_ocultos": ["controlar_validade"],
        "campos_habilitados": ["voltagem_eletro", "garantia_meses", "modelo", "potencia_w", "cor"],
        "exemplos": {
            "nome": "Ex: Liquidificador 600W 2L",
            "categoria": "Ex: Portáteis, Cozinha, Eletrônicos, Climatização...",
            "marca": "Ex: Mondial",
        },
    },
    "construcao_leve": {
        "nome": "Construção Leve",
        "descricao": "Itens leves de manutenção e construção vendidos em balcão de bairro.",
        "segmento_base": "construcao",
        "flags_override": {"usa_validade": False, "usa_lotes": False, "usa_servicos": False},
        "campos_ocultos": ["controlar_validade"],
        "campos_habilitados": ["cor"],
        "exemplos": {
            "nome": "Ex: Fita Isolante 20m",
            "categoria": "Ex: Elétrica, Hidráulica, Ferragens...",
            "marca": "Ex: Tigre",
        },
    },
    "construcao_eletrica": {
        "nome": "Construção — Elétrica",
        "descricao": "Fios, disjuntores, lâmpadas e material elétrico em geral.",
        "segmento_base": "construcao",
        "flags_override": {"usa_validade": False, "usa_lotes": False, "usa_servicos": False},
        "campos_ocultos": ["controlar_validade", "largura_mm", "espessura_mm", "comprimento_m",
                            "diametro_pol", "raio_mm"],
        "campos_habilitados": ["voltagem_v", "amperagem_a", "potencia_w", "cor"],
        "exemplos": {
            "nome": "Ex: Disjuntor Bipolar 25A",
            "categoria": "Ex: Elétrica, Iluminação, Fiação...",
            "marca": "Ex: Siemens",
        },
    },
    "construcao_hidraulica": {
        "nome": "Construção — Hidráulica",
        "descricao": "Tubos, conexões, registros e material hidráulico em geral.",
        "segmento_base": "construcao",
        "flags_override": {"usa_validade": False, "usa_lotes": False, "usa_servicos": False},
        "campos_ocultos": ["controlar_validade", "largura_mm", "espessura_mm",
                            "diametro_pol", "raio_mm"],
        "campos_habilitados": ["diametro_hidraulico_mm", "pressao_maxima_bar", "material_tubo", "comprimento_m", "cor"],
        "exemplos": {
            "nome": "Ex: Tubo PVC Água 25mm 6m",
            "categoria": "Ex: Hidráulica, Esgoto, Conexões...",
            "marca": "Ex: Tigre",
        },
    },
    "construcao_ferragem": {
        "nome": "Construção — Ferragem",
        "descricao": "Parafusos, dobradiças, cadeados e ferragens em geral.",
        "segmento_base": "construcao",
        "flags_override": {"usa_validade": False, "usa_lotes": False, "usa_servicos": False},
        "campos_ocultos": ["controlar_validade", "largura_mm", "espessura_mm", "comprimento_m",
                            "diametro_pol", "raio_mm", "peso_kg"],
        "campos_habilitados": ["tipo_rosca", "comprimento_parafuso_mm", "material_ferragem", "tipo_cabeca", "cor"],
        "exemplos": {
            "nome": "Ex: Parafuso Chipboard 6x40mm",
            "categoria": "Ex: Parafusos, Dobradiças, Cadeados...",
            "marca": "Ex: Ciser",
        },
    },
    "vestuario": {
        "nome": "Vestuário",
        "descricao": "Roupas, calçados e acessórios com grade e atributos têxteis.",
        "segmento_base": "vestuario",
    },
    "servico": {
        "nome": "Serviço",
        "descricao": "Itens não estocáveis cobrados como prestação de serviço.",
        "segmento_base": "generico",
        "flags_override": {"usa_validade": False, "usa_lotes": False, "usa_servicos": True},
        "campos_ocultos": ["controlar_validade"],
        "campos_habilitados": ["duracao_minutos", "garantia_dias", "exige_agendamento"],
    },
    "autopecas": {
        "nome": "Autopeças",
        "descricao": "Peças e componentes automotivos ou de moto em tenant dedicado.",
        "segmento_base": "autopecas",
        "campos_habilitados": ["cor"],
    },
}

MIX_PADRAO_POR_SEGMENTO = {
    "mercearia": ["alimento", "bebida", "embalagem_descartavel", "bazar", "perfumaria_higiene", "construcao_leve",
                  "eletro"],
    "vestuario": ["vestuario", "bebida", "perfumaria_higiene"],
    "construcao": ["construcao_leve", "construcao_eletrica", "construcao_hidraulica", "construcao_ferragem"],
    "autopecas": ["autopecas", "servico"],
    "generico": ["alimento", "bebida", "embalagem_descartavel", "bazar", "perfumaria_higiene", "construcao_leve",
                 "construcao_eletrica", "construcao_hidraulica", "construcao_ferragem", "vestuario", "servico",
                 "eletro"],
}

PERFIL_FISCAL_PADRAO_POR_FAMILIA = {
    "alimento": "mercearia_padrao",
    "bebida": "mercearia_padrao",
    "embalagem_descartavel": "embalagem_descartavel",
    "bazar": "bazar_padrao",
    "perfumaria_higiene": "perfumaria_higiene",
    "eletro": "eletro",
    "construcao_leve": "construcao_leve",
    "construcao_eletrica": "construcao_eletrica",
    "construcao_hidraulica": "construcao_hidraulica",
    "construcao_ferragem": "construcao_ferragem",
    "vestuario": "vestuario_padrao",
    "servico": "servico",
    "autopecas": "autopecas_padrao",
}

# ==============================================================================
# CATÁLOGO GLOBAL DE CAMPOS (seed do view_registry, escopo='campo')
#
# origem: 'coluna'   → campo nativo da tabela produtos (o form só liga/desliga)
#         'atributo' → persiste em produtos.atributos_json (dinâmico)
# tipos:  text | textarea | number | select | multiselect | boolean | date
# aplica_tipo_item: limita o campo a 'produto' ou 'servico' (ausente = ambos)
# ==============================================================================
CAMPOS_PADRAO = [
    # ---- Núcleo (colunas nativas, visíveis em todo segmento) ----
    {"chave": "codigo_barras", "label": "Código de Barras", "tipo": "text", "grupo": "identificacao",
     "origem": "coluna", "segmentos": ["*"], "aplica_tipo_item": ["produto"], "ordem": 10},
    {"chave": "marca", "label": "Marca / Fabricante", "tipo": "text", "grupo": "identificacao",
     "origem": "coluna", "segmentos": ["*"], "ordem": 20},
    {"chave": "unidade_medida", "label": "Unidade de Medida", "tipo": "select", "grupo": "identificacao",
     "origem": "coluna", "segmentos": ["*"], "aplica_tipo_item": ["produto"], "ordem": 30},
    {"chave": "fiscal", "label": "Tributação (NFC-e / NF-e)", "tipo": "grupo_fiscal", "grupo": "fiscal",
     "origem": "coluna", "segmentos": ["*"], "aplica_tipo_item": ["produto"], "ordem": 40},
    {"chave": "quantidade_minima", "label": "Qtd. Mínima (Alerta)", "tipo": "number", "grupo": "estoque",
     "origem": "coluna", "segmentos": ["*"], "aplica_tipo_item": ["produto"], "ordem": 50},
    {"chave": "controlar_validade", "label": "Controlar Validade", "tipo": "boolean", "grupo": "estoque",
     "origem": "coluna", "segmentos": ["mercearia", "generico"], "aplica_tipo_item": ["produto"], "ordem": 60},
    {"chave": "imagem_url", "label": "URL da Imagem", "tipo": "text", "grupo": "detalhes",
     "origem": "coluna", "segmentos": ["*"], "ordem": 70},

    # ---- Vestuário ----
    {"chave": "colecao", "label": "Coleção", "tipo": "text", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["vestuario"], "placeholder": "Ex: Verão 2026", "ordem": 100},
    {"chave": "genero", "label": "Gênero", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["vestuario"],
     "opcoes": ["Unissex", "Feminino", "Masculino", "Infantil"], "ordem": 110},
    {"chave": "tamanhos", "label": "Grade de Tamanhos", "tipo": "multiselect", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["vestuario"],
     "opcoes": ["PP", "P", "M", "G", "GG", "XG", "34", "36", "38", "40", "42", "44", "46", "48"],
     "ajuda": "Tamanhos disponíveis desta peça (grade).", "ordem": 120},
    {"chave": "cores", "label": "Cores", "tipo": "multiselect", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["vestuario"],
     "opcoes": ["Preto", "Branco", "Cinza", "Azul", "Vermelho", "Verde", "Amarelo", "Rosa", "Marrom", "Bege", "Estampado"],
     "permite_custom": True, "ordem": 130},
    {"chave": "tecido", "label": "Tecido / Material", "tipo": "text", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["vestuario"], "placeholder": "Ex: Algodão, Jeans, Poliéster", "ordem": 140},

    # ---- Cor única do item (bazar, eletro, construção, autopeças...) ----
    # Vestuário usa a grade "cores" (multiselect); aqui é UMA cor por produto —
    # a panela vermelha e a branca são SKUs (e códigos de barras) diferentes.
    # segmentos=[]: só aparece via `campos_habilitados` das famílias não alimentares.
    {"chave": "cor", "label": "Cor", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": [],
     "opcoes": ["Preto", "Branco", "Prata", "Inox", "Cinza", "Azul", "Vermelho", "Verde", "Amarelo",
                "Laranja", "Rosa", "Roxo", "Marrom", "Bege", "Dourado", "Transparente", "Colorido"],
     "permite_custom": True, "placeholder": "Selecione ou digite a cor",
     "aplica_tipo_item": ["produto"], "ordem": 150},

    # ---- Construção: embalagem e dimensões ----
    {"chave": "embalagem", "label": "Tipo de Embalagem", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["construcao", "mercearia", "generico"],
     "opcoes": ["Unidade", "Caixa", "Fardo", "Pacote", "Tonel", "Barrica", "Saco", "Lata", "Galão", "Balde", "Rolo", "Barra", "Milheiro"],
     "ordem": 200},
    {"chave": "itens_por_embalagem", "label": "Itens por Embalagem", "tipo": "number", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["construcao", "mercearia", "generico"],
     "ajuda": "Fator de conversão: quantas unidades avulsas compõem a embalagem.", "ordem": 210},
    {"chave": "largura_mm", "label": "Largura", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": ["construcao"], "unidade": "mm", "ordem": 220},
    {"chave": "espessura_mm", "label": "Espessura", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": ["construcao"], "unidade": "mm", "ordem": 230},
    {"chave": "comprimento_m", "label": "Comprimento", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": ["construcao"], "unidade": "m", "ordem": 240},
    {"chave": "diametro_pol", "label": "Diâmetro", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": ["construcao", "autopecas"], "unidade": "pol", "ordem": 250},
    {"chave": "raio_mm", "label": "Raio", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": ["construcao"], "unidade": "mm", "ordem": 260},
    {"chave": "peso_kg", "label": "Peso", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": ["construcao", "autopecas"], "unidade": "kg", "ordem": 270},

    # ---- Construção: elétrica, hidráulica e ferragem ----
    # segmentos=[] deliberado: só aparecem via `campos_habilitados` da família
    # técnica correspondente (construcao_eletrica/hidraulica/ferragem) — o
    # segmento_base de todas é "construcao", então a exclusividade por
    # sub-tipo tem que vir da família, não do segmento (mesmo padrão já usado
    # por "servico").
    {"chave": "voltagem_v", "label": "Voltagem", "tipo": "number", "grupo": "atributos",
     "origem": "atributo", "segmentos": [], "unidade": "V", "aplica_tipo_item": ["produto"], "ordem": 280},
    {"chave": "amperagem_a", "label": "Amperagem", "tipo": "number", "grupo": "atributos",
     "origem": "atributo", "segmentos": [], "unidade": "A", "aplica_tipo_item": ["produto"], "ordem": 281},
    {"chave": "potencia_w", "label": "Potência", "tipo": "number", "grupo": "atributos",
     "origem": "atributo", "segmentos": [], "unidade": "W", "aplica_tipo_item": ["produto"], "ordem": 282},
    {"chave": "diametro_hidraulico_mm", "label": "Diâmetro", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": [], "unidade": "mm", "aplica_tipo_item": ["produto"], "ordem": 283},
    {"chave": "pressao_maxima_bar", "label": "Pressão Máxima", "tipo": "number", "grupo": "atributos",
     "origem": "atributo", "segmentos": [], "unidade": "bar", "aplica_tipo_item": ["produto"], "ordem": 284},
    {"chave": "material_tubo", "label": "Material", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": [],
     "opcoes": ["PVC", "Cobre", "PPR", "Ferro Galvanizado", "Outro"], "aplica_tipo_item": ["produto"], "ordem": 285},
    {"chave": "tipo_rosca", "label": "Tipo de Rosca", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": [],
     "opcoes": ["Métrica", "BSP", "NPT", "Sem rosca"], "aplica_tipo_item": ["produto"], "ordem": 286},
    {"chave": "comprimento_parafuso_mm", "label": "Comprimento", "tipo": "number", "grupo": "dimensoes",
     "origem": "atributo", "segmentos": [], "unidade": "mm", "aplica_tipo_item": ["produto"], "ordem": 287},
    {"chave": "material_ferragem", "label": "Material", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": [],
     "opcoes": ["Aço Carbono", "Inox", "Latão", "Zamak", "Outro"], "aplica_tipo_item": ["produto"], "ordem": 288},
    {"chave": "tipo_cabeca", "label": "Tipo de Cabeça", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": [],
     "opcoes": ["Phillips", "Fenda", "Sextavada", "Allen", "Torx"], "aplica_tipo_item": ["produto"], "ordem": 289},

    # ---- Eletro e eletroportáteis (só via campos_habilitados da família "eletro") ----
    {"chave": "voltagem_eletro", "label": "Voltagem", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": [], "opcoes": ["110V", "220V", "Bivolt"],
     "aplica_tipo_item": ["produto"], "ordem": 290},
    {"chave": "garantia_meses", "label": "Garantia", "tipo": "number", "grupo": "atributos",
     "origem": "atributo", "segmentos": [], "unidade": "meses",
     "ajuda": "Garantia do fabricante em meses.", "aplica_tipo_item": ["produto"], "ordem": 291},
    {"chave": "modelo", "label": "Modelo", "tipo": "text", "grupo": "atributos",
     "origem": "atributo", "segmentos": [], "placeholder": "Ex: L-99 FB",
     "aplica_tipo_item": ["produto"], "ordem": 292},

    # ---- Moto peças ----
    {"chave": "montadora", "label": "Montadora", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["autopecas"],
     "opcoes": ["Honda", "Yamaha", "Suzuki", "Kawasaki", "BMW", "Shineray", "Haojue", "Royal Enfield", "Outra"],
     "permite_custom": True, "aplica_tipo_item": ["produto"], "ordem": 300},
    {"chave": "veiculo_compativel", "label": "Veículos Compatíveis", "tipo": "text", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["autopecas"],
     "placeholder": "Ex: CG 160 2016+, Fazer 250", "aplica_tipo_item": ["produto"], "ordem": 310},
    {"chave": "numero_oem", "label": "Código OEM / Original", "tipo": "text", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["autopecas"], "aplica_tipo_item": ["produto"], "ordem": 320},
    {"chave": "posicao", "label": "Posição", "tipo": "select", "grupo": "atributos",
     "origem": "atributo", "segmentos": ["autopecas"],
     "opcoes": ["Dianteira", "Traseira", "Esquerda", "Direita", "Motor", "Transmissão", "Elétrica"],
     "aplica_tipo_item": ["produto"], "ordem": 330},

    # ---- Serviços (qualquer segmento com usa_servicos) ----
    {"chave": "duracao_minutos", "label": "Duração Estimada", "tipo": "number", "grupo": "servico",
     "origem": "atributo", "segmentos": ["autopecas", "generico"], "unidade": "min",
     "aplica_tipo_item": ["servico"], "ordem": 400},
    {"chave": "garantia_dias", "label": "Garantia", "tipo": "number", "grupo": "servico",
     "origem": "atributo", "segmentos": ["autopecas", "generico"], "unidade": "dias",
     "aplica_tipo_item": ["servico"], "ordem": 410},
    {"chave": "exige_agendamento", "label": "Exige Agendamento", "tipo": "boolean", "grupo": "servico",
     "origem": "atributo", "segmentos": ["autopecas", "generico"],
     "aplica_tipo_item": ["servico"], "ordem": 420},
]

# ==============================================================================
# CATÁLOGO GLOBAL DE MÉTRICAS / KPIs (seed do view_registry, escopo='metrica')
#
# escopo_ui: 'card'   → cards principais da página de produtos
#            'painel' → painéis analíticos (ABC, giro, validade)
# fonte: caminho (dot-path) dentro do objeto de estatísticas do backend
# ==============================================================================
METRICAS_PADRAO = [
    {"chave": "total_produtos", "titulo": "Total Produtos", "subtitulo": "Catálogo completo",
     "escopo_ui": "card", "fonte": "total_produtos", "formato": "int", "icone": "package",
     "tema": "blue", "filtro": "all", "segmentos": ["*"], "ordem": 10},
    {"chave": "estoque_normal", "titulo": "Estoque Normal", "subtitulo": "% do total",
     "escopo_ui": "card", "fonte": "produtos_normal", "formato": "int", "icone": "target",
     "tema": "emerald", "filtro": "normal", "segmentos": ["*"], "ordem": 20},
    {"chave": "baixo_estoque", "titulo": "Baixo Estoque", "subtitulo": "Requer atenção",
     "escopo_ui": "card", "fonte": "produtos_baixo_estoque", "formato": "int", "icone": "alert",
     "tema": "amber", "filtro": "baixo", "segmentos": ["*"], "ordem": 30},
    {"chave": "esgotados", "titulo": "Esgotados", "subtitulo": "Crítico",
     "escopo_ui": "card", "fonte": "produtos_esgotados", "formato": "int", "icone": "activity",
     "tema": "rose", "filtro": "esgotado", "segmentos": ["*"], "ordem": 40},
    {"chave": "valor_estoque", "titulo": "Valor Estoque", "subtitulo": "Capital investido",
     "escopo_ui": "card", "fonte": "valor_total_estoque", "formato": "moeda", "icone": "dollar",
     "tema": "purple", "filtro": "valor", "segmentos": ["*"], "ordem": 50},
    {"chave": "margem_media", "titulo": "Margem Média", "subtitulo": "Rentabilidade",
     "escopo_ui": "card", "fonte": "margem_media", "formato": "percent", "icone": "pie",
     "tema": "indigo", "filtro": "margem", "segmentos": ["*"], "ordem": 60},
    {"chave": "servicos", "titulo": "Serviços", "subtitulo": "Catálogo de serviços",
     "escopo_ui": "card", "fonte": "total_servicos", "formato": "int", "icone": "wrench",
     "tema": "cyan", "filtro": "servicos", "segmentos": ["autopecas", "generico"], "ordem": 70},

    {"chave": "analise_abc", "titulo": "Classificação ABC", "subtitulo": "Análise de Pareto (80/20)",
     "escopo_ui": "painel", "fonte": "classificacao_abc", "formato": "painel", "icone": "bar",
     "tema": "blue", "segmentos": ["*"], "ordem": 100},
    {"chave": "analise_giro", "titulo": "Giro de Estoque", "subtitulo": "Velocidade de venda",
     "escopo_ui": "painel", "fonte": "giro_estoque", "formato": "painel", "icone": "zap",
     "tema": "emerald", "segmentos": ["*"], "ordem": 110},
    {"chave": "analise_validade", "titulo": "Controle de Validade", "subtitulo": "Vencimentos por janela",
     "escopo_ui": "painel", "fonte": "validade", "formato": "painel", "icone": "clock",
     "tema": "amber", "segmentos": ["mercearia", "generico"], "ordem": 120},
]

# Cache leve do schema resolvido (o registry muda raramente; overrides invalidam).
_CACHE_TTL_SEGUNDOS = 60
_schema_cache = {}


def invalidar_cache_view_schema(estabelecimento_id=None):
    if estabelecimento_id is None:
        _schema_cache.clear()
    else:
        estabelecimento_id = int(estabelecimento_id)
        chaves = [chave for chave in _schema_cache if isinstance(chave, tuple) and chave[0] == estabelecimento_id]
        for chave in chaves:
            _schema_cache.pop(chave, None)


def garantir_registry_seed():
    """
    Sincroniza o view_registry com o catálogo em código (CAMPOS_PADRAO/
    METRICAS_PADRAO). Idempotente e incremental: insere só as chaves que
    ainda não existem (por escopo), nunca apaga ou reescreve linha existente
    — é seguro rodar em toda resolução de schema (não é gate de "tabela
    vazia" — isso fazia com que campos novos adicionados ao catálogo depois
    do primeiro seed NUNCA chegassem ao banco de um tenant já em uso).
    """
    existentes = {
        (escopo, chave) for escopo, chave in
        db.session.query(ViewRegistry.escopo, ViewRegistry.chave).all()
    }
    novas = False
    for definicao in CAMPOS_PADRAO:
        if ("campo", definicao["chave"]) in existentes:
            continue
        d = dict(definicao)
        segmentos = d.pop("segmentos", ["*"])
        ordem = d.pop("ordem", 0)
        db.session.add(ViewRegistry(escopo="campo", chave=d["chave"], ordem=ordem,
                                    definicao_json=json.dumps(d, ensure_ascii=False),
                                    segmentos_json=json.dumps(segmentos, ensure_ascii=False)))
        novas = True
    for definicao in METRICAS_PADRAO:
        if ("metrica", definicao["chave"]) in existentes:
            continue
        d = dict(definicao)
        segmentos = d.pop("segmentos", ["*"])
        ordem = d.pop("ordem", 0)
        db.session.add(ViewRegistry(escopo="metrica", chave=d["chave"], ordem=ordem,
                                    definicao_json=json.dumps(d, ensure_ascii=False),
                                    segmentos_json=json.dumps(segmentos, ensure_ascii=False)))
        novas = True
    if novas:
        db.session.commit()
        invalidar_cache_view_schema()
    return novas


def _overrides_do_tenant(estabelecimento) -> dict:
    """Nível 2 da cascata: overrides salvos no JSON de configurações do tenant."""
    try:
        overrides = (estabelecimento.configuracoes or {}).get("view_schema") or {}
        return overrides if isinstance(overrides, dict) else {}
    except Exception:
        return {}


def normalizar_segmento(segmento: str = None) -> str:
    segmento = (segmento or SEGMENTO_PADRAO).lower().strip()
    if segmento not in SEGMENTOS:
        return SEGMENTO_PADRAO
    return segmento


def listar_familias_disponiveis(segmento: str = None, mix: list | None = None) -> list:
    segmento = normalizar_segmento(segmento)
    familias = mix or MIX_PADRAO_POR_SEGMENTO.get(segmento, MIX_PADRAO_POR_SEGMENTO[SEGMENTO_PADRAO])
    resultado = []
    for chave in familias:
        info = FAMILIAS_PRODUTO.get(chave)
        if not info:
            continue
        resultado.append({
            "chave": chave,
            "nome": info["nome"],
            "descricao": info["descricao"],
            "segmento_base": info["segmento_base"],
        })
    return resultado


def mix_permitido_para_estabelecimento(estabelecimento: Estabelecimento | None = None, segmento: str = None) -> list:
    segmento = normalizar_segmento(estabelecimento.segmento if estabelecimento is not None else segmento)
    mix_padrao = MIX_PADRAO_POR_SEGMENTO.get(segmento, MIX_PADRAO_POR_SEGMENTO[SEGMENTO_PADRAO])
    familias_permitidas = set(mix_padrao)
    mix = []
    if estabelecimento is not None:
        try:
            configuracoes = estabelecimento.configuracoes or {}
            mix = (
                configuracoes.get("mix_produtos")
                or ((configuracoes.get("view_schema") or {}).get("mix_produtos"))
                or []
            )
        except Exception:
            mix = []
    if not isinstance(mix, list) or not mix:
        mix = mix_padrao
    normalizado = []
    for familia in mix:
        chave = str(familia or "").strip().lower()
        if chave in familias_permitidas and chave not in normalizado:
            normalizado.append(chave)
    return normalizado or list(mix_padrao)


def normalizar_familia_produto(
    familia_produto: str = None,
    estabelecimento: Estabelecimento | None = None,
    segmento: str = None,
    tipo_item: str = "produto",
) -> str:
    if str(tipo_item or "produto").lower() == "servico":
        mix = mix_permitido_para_estabelecimento(estabelecimento, segmento)
        return "servico" if "servico" in mix else mix[0]
    familia = str(familia_produto or "").strip().lower()
    mix = mix_permitido_para_estabelecimento(estabelecimento, segmento)
    if familia in mix:
        return familia
    if familia in FAMILIAS_PRODUTO and estabelecimento is None:
        return familia
    return mix[0]


def inferir_perfil_fiscal_padrao(familia_produto: str = None, tipo_item: str = "produto") -> str:
    if str(tipo_item or "produto").lower() == "servico":
        return "servico"
    familia = str(familia_produto or "").strip().lower()
    return PERFIL_FISCAL_PADRAO_POR_FAMILIA.get(familia, "padrao")


# ==============================================================================
# SUGESTÃO FISCAL POR FAMÍLIA — consultoria assistida, não parecer de contador.
#
# Alimenta os campos que o motor de emissão REAL já lê e valida
# (app/services/fiscal/emissao_service.py: csosn/cst_icms/cfop_padrao/
# icms_aliquota, escolhendo csosn vs cst_icms pelo regime_tributario do
# estabelecimento). Antes disso todo produto nascia com os defaults genéricos
# do model (CFOP "5102", CSOSN "102", CST/ICMS em branco) independente da
# categoria — o "perfil_fiscal" do schema era só uma etiqueta, nada lia.
#
# NCM fica de fora deste catálogo de propósito: varia produto a produto demais
# dentro de uma família (a Cosmos, quando encontra o EAN, já traz o NCM real;
# senão, quem cadastra informa). O que este catálogo sugere é o que realmente
# é estável por categoria: regime de tributação do ICMS (CSOSN/CST), CFOP e
# uma alíquota de referência — sempre com aviso para revisar com contador,
# nunca aplicado silenciosamente por cima do que o usuário já digitou.
# ==============================================================================
FISCAL_SUGERIDO_POR_FAMILIA = {
    "alimento": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 7.0,
        "observacao_fiscal": "Itens de cesta básica costumam ter redução de base ou isenção "
                              "por convênio (ICMS 128/94) — confirme por NCM com seu contador.",
    },
    "bebida": {
        "csosn_sugerido": "500", "cst_icms_sugerido": "60", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "observacao_fiscal": "Bebidas (sobretudo alcoólicas) costumam ter ICMS-ST recolhido pelo "
                              "fornecedor — confirme se o CSOSN 500/CST 60 já reflete isso.",
    },
    "embalagem_descartavel": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0, "observacao_fiscal": "",
    },
    "bazar": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0, "observacao_fiscal": "",
    },
    # Perfumaria/higiene: o ICMS-ST depende da UF (CEST segmento 20, Convênio
    # ICMS 142/2018), então a sugestão não marca ST sozinha: pergunta. O PIS/COFINS
    # monofásico não entra aqui porque sai do NCM (services/fiscal/tributacao.py).
    "perfumaria_higiene": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "icms_st_a_confirmar": True,
        "observacao_fiscal": "Perfumaria e cosméticos têm ICMS por substituição tributária (ST) "
                              "em vários estados. Confirme com o contador se este NCM tem ST no seu "
                              "estado; se tiver, marque \"ICMS recolhido por ST\" e informe o CEST.",
        # Só dica para o operador conferir na embalagem ou na nota do fornecedor;
        # o formulário nunca preenche o NCM com isto.
        "ncm_exemplos": [
            {"ncm": "33030010", "descricao": "Perfume"},
            {"ncm": "33049990", "descricao": "Creme e loção"},
            {"ncm": "33051000", "descricao": "Xampu"},
            {"ncm": "33061000", "descricao": "Creme dental"},
            {"ncm": "34011190", "descricao": "Sabonete"},
        ],
    },
    # Eletro: muitos aparelhos estão no ICMS-ST (Convênio ICMS 142/2018, CEST
    # segmentos 21 e 28), mas depende da UF e do NCM; a sugestão pergunta e não marca.
    "eletro": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "icms_st_a_confirmar": True,
        "observacao_fiscal": "Eletrodomésticos costumam ter ICMS por substituição tributária (ST): "
                              "confirme com o contador se este NCM tem ICMS-ST no seu estado; se "
                              "tiver, marque \"ICMS recolhido por ST\" e informe o CEST.",
        # Só dica para conferir na embalagem ou na nota; o formulário nunca preenche o NCM.
        "ncm_exemplos": [
            {"ncm": "8509", "descricao": "Eletroportátil de cozinha (liquidificador, batedeira)"},
            {"ncm": "8516", "descricao": "Aquecimento (chuveiro, ferro, forno elétrico, secador)"},
            {"ncm": "8418", "descricao": "Refrigeração (geladeira, freezer)"},
            {"ncm": "8450", "descricao": "Máquina de lavar roupa"},
        ],
    },
    "construcao_leve": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "observacao_fiscal": "Alguns materiais de construção entram em ICMS-ST conforme o "
                              "protocolo do seu estado — confirme por NCM.",
    },
    "construcao_eletrica": {
        "csosn_sugerido": "500", "cst_icms_sugerido": "60", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "observacao_fiscal": "Material elétrico costuma estar no ICMS-ST (Convênio ICMS 92/2015) "
                              "— confirme com seu contador antes de emitir em produção.",
    },
    "construcao_hidraulica": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "observacao_fiscal": "Confirme se seu estado inclui tubos/conexões no regime de ICMS-ST.",
    },
    "construcao_ferragem": {
        "csosn_sugerido": "102", "cst_icms_sugerido": "00", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0, "observacao_fiscal": "",
    },
    "vestuario": {
        "csosn_sugerido": "500", "cst_icms_sugerido": "60", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "observacao_fiscal": "Vestuário tem ICMS-ST em vários estados (ex.: parte do Sudeste) "
                              "— confirme com seu contador.",
    },
    "servico": {
        "csosn_sugerido": "400", "cst_icms_sugerido": "40", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 0.0,
        "observacao_fiscal": "Serviço não é mercadoria: emitir Nota Fiscal de Serviço (NFS-e) "
                              "pela prefeitura do seu município. Aqui é só um item avulso no PDV.",
    },
    "autopecas": {
        "csosn_sugerido": "500", "cst_icms_sugerido": "60", "cfop_padrao_sugerido": "5102",
        "icms_aliquota_sugerida": 18.0,
        "observacao_fiscal": "Autopeças quase sempre têm ICMS-ST (Protocolo ICMS 41/2008) — "
                              "confirme com seu contador e fornecedor.",
    },
}


def sugestao_fiscal_para_familia(familia_produto: str = None, tipo_item: str = "produto") -> dict:
    """Sugestão assistida (não autoritativa) de CSOSN/CST/CFOP/alíquota por família."""
    if str(tipo_item or "produto").lower() == "servico":
        sugestao = dict(FISCAL_SUGERIDO_POR_FAMILIA["servico"])
    else:
        familia = str(familia_produto or "").strip().lower()
        sugestao = dict(FISCAL_SUGERIDO_POR_FAMILIA.get(familia) or FISCAL_SUGERIDO_POR_FAMILIA["alimento"])
    sugestao.setdefault("icms_st_a_confirmar", False)
    sugestao["ncm_exemplos"] = [dict(item) for item in sugestao.get("ncm_exemplos") or []]
    return sugestao


def _linha_vale_para(linha: ViewRegistry, segmento: str, habilitados: set, ocultos: set) -> bool:
    if not linha.ativo:
        return False
    if linha.chave in ocultos:
        return False
    if linha.chave in habilitados:
        return True
    segmentos = linha.segmentos
    return "*" in segmentos or segmento in segmentos


def resolver_view_schema(
    estabelecimento: Estabelecimento = None,
    segmento: str = None,
    familia_produto: str = None,
    tipo_item: str = "produto",
) -> dict:
    """
    Resolve a cascata Global → Tenant e devolve o View Schema pronto p/ renderizar.
    Sem estabelecimento (ex.: super admin na visão 'all'), resolve só o nível
    Global para o segmento informado, sem overrides e sem cache.
    """
    cache_key = None
    if estabelecimento is not None:
        cache_key = (int(estabelecimento.id), str(familia_produto or "").lower().strip(), str(tipo_item or "produto").lower())
    if cache_key is not None:
        em_cache = _schema_cache.get(cache_key)
        if em_cache and (time.time() - em_cache[0]) < _CACHE_TTL_SEGUNDOS:
            return em_cache[1]

    garantir_registry_seed()

    if estabelecimento is not None:
        segmento = estabelecimento.segmento
    segmento_tenant = normalizar_segmento(segmento)
    mix_permitido = mix_permitido_para_estabelecimento(estabelecimento, segmento_tenant)
    familia_produto = normalizar_familia_produto(
        familia_produto=familia_produto,
        estabelecimento=estabelecimento,
        segmento=segmento_tenant,
        tipo_item=tipo_item,
    )
    info_familia = FAMILIAS_PRODUTO.get(familia_produto, FAMILIAS_PRODUTO[mix_permitido[0]])
    segmento = normalizar_segmento(info_familia.get("segmento_base") or segmento_tenant)
    info_segmento = SEGMENTOS[segmento]

    overrides = _overrides_do_tenant(estabelecimento) if estabelecimento is not None else {}
    campos_ocultos = set(overrides.get("campos_ocultos") or [])
    campos_ocultos.update(info_familia.get("campos_ocultos") or [])
    campos_habilitados = set(overrides.get("campos_habilitados") or [])
    campos_habilitados.update(info_familia.get("campos_habilitados") or [])
    metricas_ocultas = set(overrides.get("metricas_ocultas") or [])
    metricas_habilitadas = set(overrides.get("metricas_habilitadas") or [])
    obrigatorios = overrides.get("obrigatorios") or {}
    opcoes_custom = overrides.get("opcoes") or {}

    linhas = ViewRegistry.query.order_by(ViewRegistry.ordem.asc(), ViewRegistry.chave.asc()).all()

    campos, metricas = [], []
    for linha in linhas:
        if linha.escopo == "campo":
            if not _linha_vale_para(linha, segmento, campos_habilitados, campos_ocultos):
                continue
            campo = dict(linha.definicao)
            campo["chave"] = linha.chave
            campo["ordem"] = linha.ordem
            if linha.chave in obrigatorios:
                campo["obrigatorio"] = bool(obrigatorios[linha.chave])
            if linha.chave in opcoes_custom and isinstance(opcoes_custom[linha.chave], list):
                campo["opcoes"] = opcoes_custom[linha.chave]
            campos.append(campo)
        elif linha.escopo == "metrica":
            if not _linha_vale_para(linha, segmento, metricas_habilitadas, metricas_ocultas):
                continue
            metrica = dict(linha.definicao)
            metrica["chave"] = linha.chave
            metrica["ordem"] = linha.ordem
            metricas.append(metrica)

    flags = dict(info_segmento["flags"])
    flags.update(info_familia.get("flags_override") or {})
    # Validade some do segmento? Então o campo/painel não sobrevive nem por override de flag.
    unidades = overrides.get("unidades") if isinstance(overrides.get("unidades"), list) else None
    exemplos = dict(info_segmento["exemplos"])
    exemplos.update(info_familia.get("exemplos") or {})

    schema = {
        "segmento": {"chave": segmento, "nome": info_segmento["nome"],
                     "descricao": info_segmento["descricao"], "icone": info_segmento["icone"],
                     "exemplos": exemplos},
        "segmento_tenant": {
            "chave": segmento_tenant,
            "nome": SEGMENTOS[segmento_tenant]["nome"],
            "descricao": SEGMENTOS[segmento_tenant]["descricao"],
            "icone": SEGMENTOS[segmento_tenant]["icone"],
        },
        "familia_produto": {
            "chave": familia_produto,
            "nome": info_familia["nome"],
            "descricao": info_familia["descricao"],
            "segmento_base": info_familia["segmento_base"],
            "perfil_fiscal_padrao": inferir_perfil_fiscal_padrao(familia_produto, tipo_item=tipo_item),
        },
        # Sugestão assistida de CSOSN/CST/CFOP/alíquota por família — o frontend
        # pré-preenche com isso (produto novo) e mostra aviso de revisão; nunca
        # sobrescreve o que o usuário já digitou.
        "sugestao_fiscal": sugestao_fiscal_para_familia(familia_produto, tipo_item=tipo_item),
        # Regras fiscais por item que valem para qualquer família (monofásico por
        # NCM, efeito da marca de ST) — o formulário avisa o operador com elas.
        "regras_fiscais": regras_para_interface(),
        "mix_permitido": mix_permitido,
        "familias_configuraveis": listar_familias_disponiveis(segmento_tenant),
        "familias_disponiveis": listar_familias_disponiveis(segmento_tenant, mix_permitido),
        "flags": flags,
        "unidades": unidades or info_familia.get("unidades") or info_segmento["unidades"],
        "tipos_item": (
            ["produto", "servico"]
            if flags.get("usa_servicos") and "servico" in mix_permitido
            else ["produto"]
        ),
        "campos": campos,
        "metricas": metricas,
        "grupos": [
            {"chave": "identificacao", "label": "Identificação"},
            {"chave": "fiscal", "label": "Tributação (NFC-e / NF-e)"},
            {"chave": "precificacao", "label": "Precificação e Lucro"},
            {"chave": "estoque", "label": "Controle de Estoque"},
            {"chave": "atributos", "label": "Atributos do Segmento"},
            {"chave": "dimensoes", "label": "Dimensões e Medidas"},
            {"chave": "servico", "label": "Dados do Serviço"},
            {"chave": "detalhes", "label": "Imagem e Detalhes"},
        ],
    }

    if cache_key is not None:
        _schema_cache[cache_key] = (time.time(), schema)
    return schema


def campos_de_atributo(schema: dict, tipo_item: str = "produto") -> dict:
    """Campos de origem 'atributo' aplicáveis ao tipo de item, indexados por chave."""
    resultado = {}
    for campo in schema.get("campos", []):
        if campo.get("origem") != "atributo":
            continue
        aplica = campo.get("aplica_tipo_item")
        if aplica and tipo_item not in aplica:
            continue
        resultado[campo["chave"]] = campo
    return resultado


def sanitizar_atributos(schema: dict, atributos, tipo_item: str = "produto") -> dict:
    """
    Valida os atributos dinâmicos contra o schema resolvido do tenant.
    Chaves desconhecidas são descartadas; valores são coagidos ao tipo do campo.
    """
    if not isinstance(atributos, dict):
        return {}
    validos = campos_de_atributo(schema, tipo_item)
    limpos = {}
    for chave, valor in atributos.items():
        campo = validos.get(chave)
        if campo is None or valor is None or valor == "":
            continue
        tipo = campo.get("tipo")
        try:
            if tipo == "number":
                limpos[chave] = float(valor)
            elif tipo == "boolean":
                limpos[chave] = bool(valor)
            elif tipo == "multiselect":
                if isinstance(valor, list):
                    itens = [str(v).strip() for v in valor if str(v).strip()]
                    if itens:
                        limpos[chave] = itens[:50]
            else:  # text, textarea, select, date
                texto = str(valor).strip()
                if texto:
                    limpos[chave] = texto[:500]
        except (TypeError, ValueError):
            continue
    return limpos
