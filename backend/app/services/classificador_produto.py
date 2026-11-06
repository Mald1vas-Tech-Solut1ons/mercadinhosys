"""Classificador de produto em camadas: o sistema preenche, o lojista só confere.

Camadas (a primeira que decide com segurança vence):
  1. Sinônimos do balcão  — frases que o lojista usa ("câmera de ar", "kit relação", "vela 7 dias")
                             apontando para a subcategoria oficial. Determinístico e grátis.
  2. Memória da loja      — produto da PRÓPRIA loja com nome parecido já classificado.
  3. Palavras da taxonomia — interseção do nome com os nomes oficiais de subcategoria.
  4. IA restrita          — a LLM escolhe família e depois subcategoria SÓ dentro da lista oficial;
                             resposta fora da lista é descartada (nunca inventa categoria).
Em paralelo, extratores leem do nome o que dá para ler (medida/aro, cilindrada, modelo de moto →
montadora, ano, voltagem, peso/volume, altura, cor, santo/orixá, material, marca conhecida).

Serviço (tipo_item="servico") só é classificado dentro da família `servico`.
"""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from app.services.catalogo_familias import (MATERIAIS_RELIGIOSOS, TAXONOMIA, chave_categoria,
                                           chave_subcategoria, slug)
from app.services.perfil_subcategoria import ncm_provavel


def _norm(texto: str) -> str:
    """minúsculas, sem acento, pontuação vira espaço (dígitos e '.' '/' '-' preservados p/ medidas)."""
    base = unicodedata.normalize("NFKD", str(texto or ""))
    base = "".join(c for c in base if not unicodedata.combining(c)).lower()
    return " ".join(re.sub(r"[^a-z0-9./\-]+", " ", base).split())


# ---------------------------------------------------------------------------------------------
# 1. Sinônimos do balcão: (frases, família, categoria, subcategoria)
# Frases já normalizadas por _norm (sem acento). A mais longa que casar vence.
# ---------------------------------------------------------------------------------------------
_SINONIMOS: list[tuple[tuple[str, ...], str, str, str]] = [
    # ---- Motopeças ----
    (("camara de ar", "camera de ar", "camara de pneu", "camera de pneu", "camara aro", "camara moto", "camara 3.00", "camara 2.75", "camara 90/90",
      "camara 80/100", "camara 100/90", "camara 2.50"), "motopecas", "Pneus e Rodas", "Câmaras de Ar de Moto"),
    (("pneu moto", "pneu de moto", "pneu traseiro", "pneu dianteiro", "pneu 90/90", "pneu 80/100", "pneu 100/80",
      "pneu 110/90", "pneu 2.75", "pneu 3.00", "pneu 140/70", "pneu 130/70"),
     "motopecas", "Pneus e Rodas", "Pneus de Moto"),
    (("bico de camara", "valvula de camara", "bico tr4", "bico tr6"), "motopecas", "Pneus e Rodas",
     "Bicos e Válvulas de Câmara"),
    (("remendo", "reparo de camara", "kit remendo"), "motopecas", "Pneus e Rodas", "Remendos e Reparos de Câmara"),
    (("aro de moto", "raio de moto", "raios", "aro 18", "aro 17"), "motopecas", "Pneus e Rodas", "Aros e Raios"),
    (("fita de aro", "protetor de camara"), "motopecas", "Pneus e Rodas", "Fitas de Aro e Protetores"),
    (("kit relacao", "kit transmissao", "relacao completa"), "motopecas", "Transmissão e Relação", "Kit Relação"),
    (("corrente moto", "corrente 428", "corrente 520", "corrente 428h"), "motopecas", "Transmissão e Relação",
     "Correntes de Moto"),
    (("coroa moto", "coroa e pinhao", "coroa aco"), "motopecas", "Transmissão e Relação", "Coroas"),
    (("pinhao moto", "pinhao de moto"), "motopecas", "Transmissão e Relação", "Pinhões"),
    (("cabo de embreagem", "cabo acelerador", "cabo do acelerador", "cabo velocimetro"), "motopecas",
     "Transmissão e Relação", "Cabos de Embreagem e Acelerador"),
    (("rolamento de roda",), "motopecas", "Transmissão e Relação", "Rolamentos de Roda de Moto"),
    (("pastilha de freio moto", "pastilha moto", "pastilha dianteira", "pastilha traseira"), "motopecas", "Freios",
     "Pastilhas de Freio de Moto"),
    (("lona de freio", "sapata de freio"), "motopecas", "Freios", "Lonas e Sapatas de Freio"),
    (("disco de freio moto",), "motopecas", "Freios", "Discos de Freio de Moto"),
    (("cabo de freio",), "motopecas", "Freios", "Cabos de Freio de Moto"),
    (("manete", "pedal de freio", "pedal de cambio"), "motopecas", "Freios", "Manetes e Pedais"),
    (("retentor de bengala", "retentor bengala", "kit retentor"), "motopecas", "Suspensão e Direção",
     "Retentores de Bengala"),
    (("amortecedor moto", "amortecedor traseiro moto", "monochoque"), "motopecas", "Suspensão e Direção",
     "Amortecedores de Moto"),
    (("bengala", "tubo de bengala"), "motopecas", "Suspensão e Direção", "Bengalas e Tubos"),
    (("caixa de direcao moto", "mesa de direcao", "rolamento de direcao"), "motopecas", "Suspensão e Direção",
     "Mesas e Caixas de Direção"),
    (("guidao", "punho", "manopla"), "motopecas", "Suspensão e Direção", "Guidões e Punhos"),
    (("kit pistao", "pistao", "aneis de pistao", "anel de segmento"), "motopecas", "Motor", "Pistões e Anéis"),
    (("kit cilindro", "cilindro moto", "kit motor"), "motopecas", "Motor", "Cilindros e Kits de Motor"),
    (("junta do cabecote", "jogo de juntas", "junta moto"), "motopecas", "Motor", "Juntas de Motor de Moto"),
    (("kit embreagem moto", "disco de embreagem moto", "embreagem moto"), "motopecas", "Motor", "Embreagem de Moto"),
    (("carburador", "bico injetor moto", "corpo de borboleta moto"), "motopecas", "Motor",
     "Carburadores e Injeção de Moto"),
    (("vela de ignicao moto", "vela moto", "vela ngk moto", "vela c7hsa", "vela cpr8ea", "vela d8ea"),
     "motopecas", "Motor", "Velas de Ignição de Moto"),
    (("filtro de ar moto",), "motopecas", "Motor", "Filtros de Ar de Moto"),
    (("filtro de oleo moto",), "motopecas", "Motor", "Filtros de Óleo de Moto"),
    (("escapamento moto", "ponteira", "silencioso moto"), "motopecas", "Motor", "Escapamentos e Ponteiras"),
    (("oleo 4t", "oleo moto", "oleo 20w50", "oleo 10w30 moto", "oleo 10w40", "mobil moto", "lubrax moto"),
     "motopecas", "Lubrificantes e Manutenção", "Óleos de Motor 4T"),
    (("oleo 2t", "oleo dois tempos"), "motopecas", "Lubrificantes e Manutenção", "Óleos 2T"),
    (("graxa de corrente", "lubrificante de corrente", "spray corrente"), "motopecas", "Lubrificantes e Manutenção",
     "Graxas e Lubrificantes de Corrente"),
    (("bateria moto", "bateria 5ah", "bateria 6ah", "bateria 7ah", "bateria ytz", "bateria yb"),
     "motopecas", "Elétrica e Iluminação", "Baterias de Moto"),
    (("lampada moto", "lampada farol moto", "lampada h4 moto"), "motopecas", "Elétrica e Iluminação",
     "Lâmpadas de Moto"),
    (("farol moto", "lanterna traseira moto", "lanterna moto"), "motopecas", "Elétrica e Iluminação",
     "Faróis e Lanternas de Moto"),
    (("pisca", "piscas", "seta moto"), "motopecas", "Elétrica e Iluminação", "Piscas"),
    (("regulador retificador", "retificador"), "motopecas", "Elétrica e Iluminação", "Reguladores Retificadores"),
    (("estator", "bobina de pulso", "bobina de ignicao moto"), "motopecas", "Elétrica e Iluminação",
     "Estatores e Bobinas de Moto"),
    (("cdi", "modulo de ignicao"), "motopecas", "Elétrica e Iluminação", "CDI e Módulos"),
    (("chave de ignicao", "comutador", "chicote"), "motopecas", "Elétrica e Iluminação",
     "Chicotes e Chaves de Ignição"),
    (("motor de partida moto", "rele de partida"), "motopecas", "Elétrica e Iluminação",
     "Motores de Partida e Relés de Moto"),
    (("carenagem", "rabeta", "aba do tanque"), "motopecas", "Carenagem e Plásticos", "Carenagens"),
    (("paralama",), "motopecas", "Carenagem e Plásticos", "Paralamas"),
    (("retrovisor moto", "espelho retrovisor moto", "par de retrovisor"), "motopecas", "Carenagem e Plásticos",
     "Retrovisores de Moto"),
    (("banco moto", "capa de banco moto"), "motopecas", "Carenagem e Plásticos", "Bancos e Capas de Banco"),
    (("tampa de tanque", "tanque moto"), "motopecas", "Carenagem e Plásticos", "Tanques e Tampas de Tanque"),
    (("capacete",), "motopecas", "Acessórios e Segurança", "Capacetes de Moto"),
    (("viseira",), "motopecas", "Acessórios e Segurança", "Viseiras"),
    (("bau moto", "bagageiro", "bau 30", "bau 45"), "motopecas", "Acessórios e Segurança", "Baús e Bagageiros"),
    (("capa de chuva moto", "capa de chuva motoqueiro"), "motopecas", "Acessórios e Segurança",
     "Capas de Chuva de Moto"),
    (("luva moto", "luva motoqueiro"), "motopecas", "Acessórios e Segurança", "Luvas de Moto"),
    (("antifurto", "trava de disco", "cadeado de disco"), "motopecas", "Acessórios e Segurança",
     "Antifurtos e Travas"),
    (("protetor de motor", "slider", "mata cachorro"), "motopecas", "Acessórios e Segurança",
     "Protetores de Motor e Carenagem"),
    (("suporte celular moto", "suporte de celular para moto"), "motopecas", "Acessórios e Segurança",
     "Suportes de Celular para Moto"),

    # ---- Autopeças (carro) ----
    (("corpo de borboleta", "tbi"), "autopecas", "Injeção e Ignição", "Corpo de Borboleta (TBI)"),
    (("bico injetor",), "autopecas", "Injeção e Ignição", "Bicos Injetores"),
    (("bobina de ignicao",), "autopecas", "Injeção e Ignição", "Bobinas de Ignição"),
    (("sensor de rotacao", "sonda lambda", "sensor map", "sensor de temperatura"), "autopecas", "Injeção e Ignição",
     "Sensores Automotivos"),
    (("bomba de combustivel",), "autopecas", "Injeção e Ignição", "Bombas de Combustível"),
    (("filtro de combustivel",), "autopecas", "Injeção e Ignição", "Filtros de Combustível"),
    (("radiador",), "autopecas", "Arrefecimento", "Radiadores"),
    (("bomba d agua", "bomba dagua"), "autopecas", "Arrefecimento", "Bombas d'Água Automotivas"),
    (("valvula termostatica",), "autopecas", "Arrefecimento", "Válvulas Termostáticas"),
    (("aditivo de radiador", "aditivo radiador", "agua desmineralizada"), "autopecas", "Arrefecimento",
     "Aditivos de Radiador"),
    (("kit embreagem", "platô", "plato", "disco de embreagem"), "autopecas", "Embreagem", "Kits de Embreagem"),
    (("terminal de direcao", "barra de direcao", "barra axial"), "autopecas", "Direção",
     "Terminais e Barras de Direção"),
    (("pivo de suspensao", "pivo inferior", "bandeja de suspensao", "bandeja dianteira"), "autopecas", "Direção", "Pivôs e Bandejas"),
    (("coxim do motor", "coxim de amortecedor", "bucha de bandeja"), "autopecas", "Direção", "Coxins e Buchas"),
    (("palheta", "limpador de para-brisa", "limpador de parabrisa"), "autopecas", "Carroceria e Vidros",
     "Palhetas de Limpador"),
    (("pastilha de freio", "pastilha"), "autopecas", "Freios e Suspensão", "Pastilhas e Lonas"),
    (("disco de freio",), "autopecas", "Freios e Suspensão", "Discos de Freio"),
    (("amortecedor",), "autopecas", "Freios e Suspensão", "Amortecedores"),
    (("correia dentada", "correia alternador", "tensor"), "autopecas", "Motor e Transmissão",
     "Correias e Tensores"),
    (("vela de ignicao", "cabo de vela"), "autopecas", "Motor e Transmissão", "Velas e Cabos de Vela"),
    (("filtro de oleo", "filtro de ar", "filtro de cabine"), "autopecas", "Motor e Transmissão", "Filtros"),
    (("oleo 5w30", "oleo 5w40", "oleo 15w40", "oleo motor", "oleo de motor"), "autopecas", "Motor e Transmissão",
     "Óleos e Lubrificantes"),
    (("bateria 60ah", "bateria 45ah", "bateria automotiva", "bateria carro"), "autopecas", "Elétrica Automotiva",
     "Baterias"),
    (("lampada h4", "lampada h7", "lampada farol", "lampada automotiva"), "autopecas", "Elétrica Automotiva",
     "Lâmpadas Automotivas"),
    (("pneu aro 13", "pneu aro 14", "pneu aro 15", "pneu 175/70", "pneu 185/65", "pneu carro"), "autopecas", "Pneus",
     "Pneus e Câmaras"),

    # ---- Peças de celular e assistência ----
    (("tela frontal", "frontal celular", "display celular", "tela celular", "tela iphone", "tela samsung", "tela motorola",
      "tela xiaomi", "tela lcd"), "eletronicos", "Peças para Celular", "Telas e Frontais"),
    (("bateria iphone", "bateria samsung", "bateria motorola", "bateria xiaomi", "bateria celular"), "eletronicos",
     "Peças para Celular", "Baterias de Celular"),
    (("conector de carga", "dock de carga", "placa de carga", "sub placa"), "eletronicos", "Peças para Celular",
     "Conectores de Carga"),
    (("tampa traseira",), "eletronicos", "Peças para Celular", "Tampas Traseiras"),
    (("flex de carga", "flex power", "flex volume", "cabo flex celular"), "eletronicos", "Peças para Celular", "Flex e Botões"),
    (("lente de camera", "camera traseira celular"), "eletronicos", "Peças para Celular",
     "Câmeras e Lentes de Celular"),
    (("pelicula", "pelicula 3d", "pelicula de vidro"), "eletronicos", "Celulares e Acessórios", "Películas"),
    (("capinha", "capa de celular", "case celular", "capa iphone", "capa samsung"), "eletronicos", "Celulares e Acessórios", "Capinhas"),

    # ---- Artigos religiosos ----
    (("vela 7 dias", "vela de 7 dias", "vela sete dias", "vela de sete dias", "vela votiva 7"), "religioso", "Velas",
     "Vela 7 Dias"),
    (("vela palito", "vela comum", "vela branca pacote", "vela n 7", "vela n7", "vela de cera"), "religioso", "Velas",
     "Vela Palito e Comum"),
    (("vela votiva",), "religioso", "Velas", "Velas Votivas"),
    (("cirio", "vela de batismo", "vela de cera de abelha"), "religioso", "Velas", "Círios e Velas de Cera"),
    (("vela colorida", "vela bicolor", "vela tricolor", "vela rubro", "vela de orixa", "vela preta e vermelha",
      "vela vermelha e preta"), "religioso", "Velas", "Velas Coloridas e de Orixá"),
    (("vela de figura", "vela casal", "vela caveira", "vela formato"), "religioso", "Velas", "Velas de Figura"),
    (("lamparina", "pavio"), "religioso", "Velas", "Lamparinas e Pavios"),
    (("imagem nossa senhora", "imagem de santo", "imagem sao", "imagem santo", "imagem santa", "imagem sagrado",
      "imagem menino jesus", "imagem divino"), "religioso", "Imagens e Estátuas", "Santos Católicos"),
    (("imagem orixa", "imagem iemanja", "imagem oxum", "imagem ogum", "imagem xango", "imagem iansa",
      "imagem oxossi", "imagem oxala", "imagem omolu", "imagem nana", "imagem obaluae"),
     "religioso", "Imagens e Estátuas", "Orixás"),
    (("preto velho", "preta velha", "pai joaquim", "vovo maria conga"), "religioso", "Imagens e Estátuas",
     "Pretos-Velhos"),
    (("caboclo", "cabocla"), "religioso", "Imagens e Estátuas", "Caboclos"),
    (("exu", "pombagira", "pomba gira", "maria padilha", "tranca rua", "ze pilintra"), "religioso",
     "Imagens e Estátuas", "Exus e Pombagiras"),
    (("cigano", "cigana"), "religioso", "Imagens e Estátuas", "Ciganos"),
    (("baiano", "baiana", "boiadeiro"), "religioso", "Imagens e Estátuas", "Baianos e Boiadeiros"),
    (("ere", "cosme e damiao", "crianca imagem"), "religioso", "Imagens e Estátuas", "Erês"),
    (("anjo",), "religioso", "Imagens e Estátuas", "Anjos"),
    (("buda", "ganesha"), "religioso", "Imagens e Estátuas", "Budas e Orientais"),
    (("presepio",), "religioso", "Imagens e Estátuas", "Presépios"),
    (("oratorio", "capelinha"), "religioso", "Imagens e Estátuas", "Oratórios e Capelinhas"),
    (("terco", "rosario", "dezena"), "religioso", "Artigos Católicos", "Terços e Rosários"),
    (("escapulario",), "religioso", "Artigos Católicos", "Escapulários"),
    (("medalha", "medalhinha"), "religioso", "Artigos Católicos", "Medalhas Religiosas"),
    (("crucifixo", "cruz de parede"), "religioso", "Artigos Católicos", "Crucifixos"),
    (("agua benta", "frasco agua benta"), "religioso", "Artigos Católicos", "Água Benta e Frascos"),
    (("santinho", "oracao"), "religioso", "Artigos Católicos", "Santinhos e Orações"),
    (("fio de conta", "colar de conta", "guia cristal", "guia micanga", "guia de micanga", "guia de cristal",
      "guia de louca", "guia de semente", "braja", "guia umbanda", "guia candomble")
     + tuple(f"guia de {o}" for o in ("oxala", "iemanja", "oxum", "ogum", "xango", "iansa", "oxossi", "omolu",
                                     "obaluae", "nana", "exu", "pombagira", "preto velho", "caboclo", "ere",
                                     "cigano", "baiano", "boiadeiro", "marinheiro", "ze pilintra")),
     "religioso", "Umbanda e Candomblé", "Guias e Fios de Conta"),
    (("pemba",), "religioso", "Umbanda e Candomblé", "Pembas"),
    (("alguidar", "louca de barro", "prato de barro"), "religioso", "Umbanda e Candomblé",
     "Alguidares e Louça de Barro"),
    (("quartinha", "porrao", "moringa"), "religioso", "Umbanda e Candomblé", "Quartinhas e Porrões"),
    (("ferramenta de orixa", "espada de ogum", "ofa", "abebe", "ferramenta de exu", "tridente"),
     "religioso", "Umbanda e Candomblé", "Ferramentas de Orixá"),
    (("buzio", "buzios"), "religioso", "Umbanda e Candomblé", "Búzios"),
    (("morim", "roupa de santo", "pano da costa", "ojá", "oja"), "religioso", "Umbanda e Candomblé",
     "Roupas de Santo e Tecidos"),
    (("atabaque", "agogo", "adja", "xere"), "religioso", "Umbanda e Candomblé", "Atabaques e Instrumentos"),
    (("charuto de entidade", "charuto de caboclo", "cachimbo de preto velho", "cachimbo de barro", "cachimbo de entidade"), "religioso", "Umbanda e Candomblé", "Cachimbos e Charutos de Entidade"),
    (("ponteiro", "punhal"), "religioso", "Umbanda e Candomblé", "Ponteiros e Punhais"),
    (("arruda", "guine", "alecrim", "erva doce", "manjericao", "espada de sao jorge erva", "folha de louro",
      "ervas para banho", "erva para banho", "erva seca", "ervas secas"), "religioso", "Ervas, Banhos e Defumação",
     "Ervas para Banho e Defumação"),
    (("banho pronto", "banho de descarrego", "banho de ervas", "banho de sal grosso", "banho de arruda",
      "banho de cheiro", "banho de abre caminho", "banho de limpeza espiritual", "banho de atrair",
      "banho de rosas"), "religioso",
     "Ervas, Banhos e Defumação", "Banhos Prontos"),
    (("defumador", "defumacao", "tablete de defumacao"), "religioso", "Ervas, Banhos e Defumação", "Defumadores"),
    (("incenso", "vareta de incenso", "incenso massala", "incenso cone"), "religioso", "Ervas, Banhos e Defumação",
     "Incensos Religiosos"),
    (("porta incenso", "incensario"), "religioso", "Ervas, Banhos e Defumação", "Porta-incensos"),
    (("turibulo", "carvao para defumacao", "carvao vegetal pastilha"), "religioso", "Ervas, Banhos e Defumação",
     "Carvão e Turíbulos"),
    (("sal grosso",), "religioso", "Ervas, Banhos e Defumação", "Sal Grosso para Banho"),
    (("po de mironga", "po ritual", "po de pemba", "po de abre caminho", "po de atrair"), "religioso", "Ervas, Banhos e Defumação", "Pós Ritualísticos"),
    (("essencia ritual", "essencia mistica", "oleo ritual", "perfume ritual", "alfazema", "agua de cheiro", "patchouli", "oleo de oxum", "perfume de pombagira"), "religioso",
     "Ervas, Banhos e Defumação", "Essências, Óleos e Perfumes Ritualísticos"),
    (("sabonete de arruda", "sabonete de sal grosso", "sabonete ritual", "sabonete de ervas", "sabonete descarrego"),
     "religioso", "Ervas, Banhos e Defumação", "Sabonetes Ritualísticos"),
    (("pedra cristal", "cristal natural", "cristal bruto", "cristal rolado", "pedra ametista", "quartzo", "drusa", "pedra natural", "selenita", "turmalina"), "religioso", "Esotérico",
     "Cristais e Pedras"),
    (("piramide", "pendulo"), "religioso", "Esotérico", "Pirâmides e Pêndulos"),
    (("taro", "baralho cigano", "oraculo"), "religioso", "Esotérico", "Tarô e Oráculos"),
    (("patua", "amuleto", "olho grego", "figa"), "religioso", "Esotérico", "Patuás e Amuletos"),
    (("mensageiro dos ventos", "sino dos ventos"), "religioso", "Esotérico", "Mensageiros dos Ventos"),
    (("filtro dos sonhos",), "religioso", "Esotérico", "Filtros dos Sonhos"),
    (("fita do bonfim", "fitinha do bonfim"), "religioso", "Esotérico", "Fitas do Bonfim"),
    (("biblia",), "religioso", "Livros e Presentes", "Bíblias"),
    (("oleo de uncao",), "religioso", "Livros e Presentes", "Óleo de Unção"),
    (("kit oferenda", "kit de oferenda"), "religioso", "Kits e Oferendas", "Kits de Oferenda"),

    # ---- Higiene/beleza que já confundiram o Consultor ----
    (("condicionador",), "perfumaria_higiene", "Cabelos", "Condicionador"),
    (("shampoo",), "perfumaria_higiene", "Cabelos", "Shampoo"),
    (("mascara capilar",), "perfumaria_higiene", "Cabelos", "Máscaras Capilares"),
    (("lamina de barbear", "aparelho de barbear", "gilete", "lamina de sobrancelha", "aparelho depilador"), "higiene", "Barbear e Depilação",
     "Lâminas e Aparelhos"),
    (("escova de dente",), "higiene", "Higiene Bucal", "Escovas de Dente"),
]

# Serviços (só valem com tipo_item="servico")
_SINONIMOS_SERVICO: list[tuple[tuple[str, ...], str, str, str]] = [
    (("troca de tela", "troca de frontal", "troca de display", "troca do vidro"), "servico", "Assistência de Celular",
     "Troca de Tela e Frontal"),
    (("troca de bateria",), "servico", "Assistência de Celular", "Troca de Bateria"),
    (("troca de conector", "conector de carga", "nao carrega", "troca de dock"), "servico", "Assistência de Celular",
     "Troca de Conector de Carga"),
    (("troca de camera", "troca de lente"), "servico", "Assistência de Celular", "Troca de Câmera e Lente"),
    (("alto falante", "microfone", "auricular"), "servico", "Assistência de Celular",
     "Troca de Alto-falante e Microfone"),
    (("tampa traseira",), "servico", "Assistência de Celular", "Troca de Tampa Traseira"),
    (("reparo de placa", "placa", "curto"), "servico", "Assistência de Celular", "Reparo de Placa"),
    (("desoxidacao", "molhou", "caiu na agua", "banho quimico"), "servico", "Assistência de Celular", "Desoxidação"),
    (("software", "atualizacao", "formatar celular", "reset", "desbloqueio de conta"), "servico",
     "Assistência de Celular", "Software e Atualização"),
    (("backup", "transferencia de dados"), "servico", "Assistência de Celular", "Backup e Transferência de Dados"),
    (("aplicacao de pelicula", "colocar pelicula"), "servico", "Assistência de Celular", "Aplicação de Película"),
    (("limpeza de celular",), "servico", "Assistência de Celular", "Limpeza e Manutenção de Celular"),
    (("diagnostico", "orcamento", "avaliacao tecnica"), "servico", "Assistência de Celular",
     "Diagnóstico e Orçamento"),
    (("formatacao", "formatar notebook", "instalacao de windows"), "servico", "Assistência de Eletrônicos",
     "Formatação e Instalação"),
    (("troca de oleo",), "servico", "Oficina Mecânica", "Troca de Óleo"),
    (("revisao",), "servico", "Oficina Mecânica", "Revisão Preventiva"),
    (("borracharia", "remendo de pneu", "conserto de pneu", "troca de camara", "troca de pneu"), "servico",
     "Oficina Mecânica", "Borracharia"),
    (("alinhamento", "balanceamento"), "servico", "Oficina Mecânica", "Alinhamento e Balanceamento"),
    (("troca de pastilha", "regulagem de freio", "troca de retentor"), "servico", "Oficina Mecânica",
     "Serviço de Freios e Suspensão"),
    (("mecanica", "mao de obra", "retifica"), "servico", "Oficina Mecânica", "Mecânica Geral"),
    (("lavagem", "polimento", "higienizacao"), "servico", "Oficina Mecânica", "Lavagem e Estética Automotiva"),
    (("entrega", "motoboy"), "servico", "Taxas", "Taxa de Entrega Motoboy"),
    (("instalacao",), "servico", "Serviços Gerais", "Instalação"),
    (("montagem",), "servico", "Serviços Gerais", "Montagem de Móveis"),
]


def _compilar(regras):
    compiladas = []
    for frases, familia, categoria, sub in regras:
        assert sub in TAXONOMIA[familia][categoria], (familia, categoria, sub)  # erro de digitação = falha já
        for frase in frases:
            compiladas.append((_norm(frase), familia, categoria, sub))
    # Frase mais longa primeiro: "pastilha de freio moto" antes de "pastilha".
    return sorted(compiladas, key=lambda r: -len(r[0]))


_REGRAS_PRODUTO = _compilar(_SINONIMOS)
_REGRAS_SERVICO = _compilar(_SINONIMOS_SERVICO)

# Contexto que vira peça de carro em peça de moto quando a regra caiu em autopecas.
_PALAVRAS_MOTO = {"moto", "motocicleta", "cg", "titan", "fan", "start", "bros", "biz", "pop", "cb", "twister",
                  "xre", "factor", "fazer", "crosser", "lander", "nmax", "pcx", "ybr", "xtz", "tenere", "cbx",
                  "nxr", "elite", "lead", "dafra", "shineray", "mottu", "ybr125", "cg160", "cg150", "cg125"}

# Modelos de moto → montadora (o balconista escreve o modelo, não a marca).
_MODELOS_MOTO = {
    "Honda": ["cg", "titan", "fan", "start", "bros", "biz", "pop", "cb", "cb300", "cb250", "twister", "xre", "nxr",
              "pcx", "elite", "lead", "cbx", "hornet", "cg160", "cg150", "cg125", "nc750", "adv"],
    "Yamaha": ["factor", "fazer", "crosser", "lander", "nmax", "ybr", "xtz", "tenere", "neo", "fluo", "mt03", "mt07",
               "xj6", "r3", "ybr125"],
    "Suzuki": ["yes", "intruder", "burgman", "gsr", "bandit", "vstrom", "katana"],
    "Shineray": ["jet", "phoenix", "worker"],
}

# Modelos de carro → montadora.
_MODELOS_CARRO = {
    "Volkswagen": ["gol", "voyage", "fox", "polo", "saveiro", "up", "virtus", "tcross", "nivus", "jetta", "parati",
                   "golf", "amarok", "kombi"],
    "Chevrolet": ["onix", "prisma", "celta", "corsa", "cruze", "spin", "s10", "tracker", "cobalt", "agile", "montana",
                  "classic", "astra", "vectra", "meriva", "zafira"],
    "Fiat": ["uno", "palio", "siena", "strada", "toro", "mobi", "argo", "cronos", "punto", "doblo", "fiorino",
             "idea", "pulse", "fastback", "grand siena"],
    "Ford": ["ka", "fiesta", "ecosport", "focus", "ranger", "fusion", "courier"],
    "Toyota": ["corolla", "etios", "hilux", "yaris", "sw4", "rav4", "corolla cross"],
    "Hyundai": ["hb20", "creta", "tucson", "ix35", "i30"],
    "Renault": ["sandero", "logan", "duster", "kwid", "clio", "megane", "captur", "oroch"],
    "Honda": ["civic", "fit", "city", "hrv", "hr-v", "wrv"],
    "Nissan": ["march", "versa", "kicks", "sentra", "frontier", "livina"],
    "Jeep": ["renegade", "compass", "commander"],
}

# Marcas conhecidas (balcão de autopeças, motopeças, celular, religioso).
_MARCAS = ["Pirelli", "Levorin", "Rinaldi", "Maggion", "Technic", "Metzeler", "Michelin", "Pro Tork", "Protork",
           "Cobreq", "Fras-le", "Frasle", "Vedamotors", "Riffel", "NGK", "Bosch", "Magneti Marelli", "Mobil",
           "Castrol", "Ipiranga", "Lubrax", "Shell", "Motul", "Moura", "Heliar", "Yuasa", "Cofap", "Monroe",
           "Nakata", "Metal Leve", "Mahle", "Tecfil", "Wega", "Fram", "Unifort", "Sabó", "Sabo", "KMP", "Vaz",
           "Allen", "Magnetron", "Brandy", "Kawahara", "Valflex", "Coyote", "Smart Fox", "Givi", "LS2", "Norisk",
           "Peels", "Bieffe", "Samsung", "Motorola", "Xiaomi", "Apple", "LG", "Asus", "Positivo",
           "Zuppani", "Santo Antão", "Arte Sacra"]


def _extrair_atributos(nome: str, familia: str, tipo_item: str) -> tuple[dict, str | None]:
    """(atributos lidos do nome, marca conhecida ou None)."""
    texto = _norm(nome)
    palavras = set(texto.split())
    attrs: dict[str, Any] = {}
    marca = None
    for nome_marca in sorted(_MARCAS, key=len, reverse=True):
        if re.search(rf"\b{re.escape(_norm(nome_marca))}\b", texto):
            marca = nome_marca.upper()
            break
    tokens_marca = set(_norm(marca).split()) if marca else set()

    # Medida de pneu/câmara: 3.00-18, 2.75-18, 90/90-18, 100/80-17, 175/70 R13
    m = re.search(r"\b(\d\.\d{2})\s*[-x ]\s*(\d{2})\b", texto)
    if m:
        attrs["medida_pneu"], attrs["aro"] = f"{m.group(1)}-{m.group(2)}", int(m.group(2))
    else:
        m = re.search(r"\b(\d{2,3})/(\d{2,3})\s*-?\s*r?\s*(\d{2})\b", texto)
        if m:
            sep = " R" if familia == "autopecas" else "-"
            attrs["medida_pneu"] = f"{m.group(1)}/{m.group(2)}{sep}{m.group(3)}"
            attrs["aro"] = int(m.group(3))
    m = re.search(r"\baro\s*(\d{2})\b", texto)
    if m:
        attrs["aro"] = int(m.group(1))
    m = re.search(r"\b(tr\s?\d{1,2})\b", texto)
    if m:
        attrs["tipo_valvula"] = m.group(1).replace(" ", "").upper()
    if "dianteir" in texto:
        attrs["posicao"] = "Dianteira"
    elif "traseir" in texto:
        attrs["posicao"] = "Traseira"

    # Cilindrada e anos de aplicação
    m = re.search(r"\b(\d{2,4})\s*cc\b", texto)
    if m:
        attrs["cilindrada"] = f"{m.group(1)}cc"
    m = re.search(r"\b((?:19|20)\d{2})\s*(?:a|-|/|ate)\s*((?:19|20)\d{2})\b", texto)
    if m:
        attrs["ano_aplicacao"] = f"{m.group(1)} a {m.group(2)}"
    else:
        m = re.search(r"\b((?:19|20)\d{2})\s*\+", texto)
        if m:
            attrs["ano_aplicacao"] = f"{m.group(1)} em diante"

    # Montadora pelo modelo (moto ou carro)
    if familia in ("motopecas", "autopecas"):
        modelos = _MODELOS_MOTO if familia == "motopecas" else _MODELOS_CARRO
        achados = []
        for montadora, lista in modelos.items():
            for modelo in lista:
                if (" " in modelo and modelo in texto) or modelo in palavras:
                    achados.append((montadora, modelo))
        if achados:
            attrs["montadora"] = achados[0][0]
            # "Veículos compatíveis" com o trecho original após o modelo (ex.: "Titan 150 / Fan 160")
            palavras_orig = str(nome).split()
            primeira = achados[0][1].split()[0]
            inicio = next((i for i, w in enumerate(palavras_orig) if _norm(w).startswith(primeira)), None)
            trecho = [w for w in (palavras_orig[inicio:] if inicio is not None else [])
                      if _norm(w) not in tokens_marca]
            attrs["veiculo_compativel"] = " ".join(trecho)[:80] or achados[0][1].upper()

    # Peso / volume, altura, voltagem, unidades por caixa
    m = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|lt)\b", texto)
    if m:
        unidade = {"gr": "g", "lt": "L", "l": "L"}.get(m.group(2), m.group(2))
        attrs["peso_volume"] = f"{m.group(1).replace('.', ',')} {unidade}"
    m = re.search(r"\b(\d{1,3})\s*cm\b", texto)
    if m:
        attrs["altura_cm"] = int(m.group(1))
    if "bivolt" in texto:
        attrs["voltagem_eletro"] = "Bivolt"
    elif re.search(r"\b220\s*v\b", texto):
        attrs["voltagem_eletro"] = "220V"
    elif re.search(r"\b(110|127)\s*v\b", texto):
        attrs["voltagem_eletro"] = "110V"

    # Religioso: tempo de queima, cor, entidade, material, tradição
    if familia == "religioso":
        if re.search(r"\b7\s*dias\b|\bsete\s*dias\b", texto):
            attrs["tempo_queima_h"] = 168
        from app.services.catalogo_familias import CAMPOS_FAMILIAS
        opcoes_entidade = next(c["opcoes"] for c in CAMPOS_FAMILIAS if c["chave"] == "entidade")
        for entidade in sorted(opcoes_entidade, key=len, reverse=True):
            alvo = _norm(entidade.split(" / ")[0].replace("(a)", ""))
            if alvo and re.search(rf"\b{re.escape(alvo)}\b", texto):
                attrs["entidade"] = entidade
                break
        for material in MATERIAIS_RELIGIOSOS:
            if re.search(rf"\b{re.escape(_norm(material))}\b", texto):
                attrs["material"] = material
                break
        catolicos = {"nossa senhora", "sao ", "santo ", "santa ", "sagrado", "terco", "rosario", "crucifixo",
                     "escapulario", "divino"}
        afro = {"oxum", "iemanja", "ogum", "xango", "iansa", "oxossi", "oxala", "omolu", "nana", "exu", "pombagira",
                "preto velho", "caboclo", "guia", "pemba", "alguidar", "ere", "ze pilintra"}
        if any(t in f" {texto} " for t in catolicos):
            attrs["tradicao_religiosa"] = "Católica"
        elif any(re.search(rf"\b{t}\b", texto) for t in afro):
            attrs["tradicao_religiosa"] = "Umbanda"
    # Cor (produto de cor única: vela, guia, capacete, peça)
    if tipo_item == "produto":
        cores = {"preta": "Preto", "preto": "Preto", "branca": "Branco", "branco": "Branco", "vermelha": "Vermelho",
                 "vermelho": "Vermelho", "azul": "Azul", "verde": "Verde", "amarela": "Amarelo", "amarelo": "Amarelo",
                 "rosa": "Rosa", "roxa": "Roxo", "roxo": "Roxo", "lilas": "Roxo", "laranja": "Laranja",
                 "marrom": "Marrom", "dourada": "Dourado", "dourado": "Dourado", "prata": "Prata", "cinza": "Cinza"}
        achadas = [cores[p] for p in texto.split() if p in cores]
        if "rubro negr" in texto.replace("-", " "):
            achadas = ["Vermelho", "Preto"] + achadas
        if achadas:
            attrs["cor"] = achadas[0] if len(set(achadas)) == 1 else " e ".join(dict.fromkeys(achadas))

    return attrs, marca


def _por_sinonimo(texto: str, tipo_item: str):
    regras = _REGRAS_SERVICO if tipo_item == "servico" else _REGRAS_PRODUTO
    alvo = f" {texto} "
    for frase, familia, categoria, sub in regras:
        if f" {frase} " in alvo:
            if familia == "autopecas" and _PALAVRAS_MOTO & set(texto.split()):
                # "pastilha de freio titan 150" é moto: a mesma peça na família de moto
                for frase_m, fam_m, cat_m, sub_m in regras:
                    if fam_m == "motopecas" and frase_m.startswith(frase):
                        return fam_m, cat_m, sub_m
            return familia, categoria, sub
    return None


def _por_taxonomia(palavras: set, familias: list) -> tuple[str, str, str] | None:
    melhor, melhor_score = None, 0
    for familia in familias:
        for categoria, subs in TAXONOMIA.get(familia, {}).items():
            if categoria == "Outros":
                continue
            for sub in subs:
                tokens = set(slug(sub).split("_"))
                comum = palavras & tokens
                if not comum:
                    continue
                score = len(comum) * 10 - len(tokens)
                if score > melhor_score:
                    melhor, melhor_score = (familia, categoria, sub), score
    return (melhor, melhor_score) if melhor_score >= 8 else None


def _por_memoria_da_loja(estab_id: int | None, palavras: set, tipo_item: str):
    """Produto da própria loja com nome parecido (≥ 2 palavras significativas em comum)."""
    if not estab_id:
        return None
    try:
        from app.models import Produto
        significativas = [p for p in palavras if len(p) > 3 and not p.isdigit()]
        if len(significativas) < 2:
            return None
        from sqlalchemy import or_
        candidatos = (Produto.query
                      .filter(Produto.estabelecimento_id == estab_id, Produto.deleted_at.is_(None),
                              Produto.subcategoria_oficial.isnot(None), Produto.tipo_item == tipo_item,
                              or_(*[Produto.nome.ilike(f"%{p}%") for p in significativas[:6]]))
                      .order_by(Produto.updated_at.desc()).limit(40).all())
    except Exception:
        return None
    melhor, melhor_comum = None, 1
    for p in candidatos:
        comum = len(set(_norm(p.nome).split()) & set(significativas))
        if comum > melhor_comum:
            melhor, melhor_comum = p, comum
    if not melhor:
        return None
    from app.services.taxonomia_service import _SUBCATEGORIAS_POR_CHAVE
    trio = _SUBCATEGORIAS_POR_CHAVE.get(melhor.subcategoria_oficial)
    return trio  # (familia, categoria, sub)


def _por_ia(nome: str, marca: str, familias: list, tipo_item: str):
    """IA em 2 passos, cada um preso a uma lista fechada. None se a IA não estiver disponível."""
    from app.utils.ia_copiloto import gerar_texto, ia_disponivel
    if not ia_disponivel():
        return None
    from app.services.view_schema_service import FAMILIAS_PRODUTO
    if tipo_item == "servico":
        familia = "servico"
    else:
        opcoes = {f: FAMILIAS_PRODUTO[f]["nome"] for f in familias if f in FAMILIAS_PRODUTO and f != "servico"}
        lista = "\n".join(f"- {k}: {v} — {FAMILIAS_PRODUTO[k].get('descricao', '')}" for k, v in opcoes.items())
        resposta = gerar_texto(
            "Você é especialista em varejo brasileiro e classifica produtos para cadastro. Responda SOMENTE a "
            "chave da família, sem mais nada. Se nenhuma servir com clareza, responda: nenhuma.",
            f"Produto: {nome}\nMarca: {marca or 'não informada'}\n\nFamílias:\n{lista}\n\nChave:",
            max_tokens=20,
        )
        familia = str(resposta or "").strip().strip("`'\".").lower().split()[0] if resposta else ""
        if familia not in opcoes:
            return None
    linhas = [f"{categoria} > {sub}" for categoria, subs in TAXONOMIA[familia].items() for sub in subs]
    resposta = gerar_texto(
        "Você classifica produtos de varejo brasileiro numa lista oficial. Responda SOMENTE um JSON "
        '{"subcategoria": "<exatamente um item da lista, no formato Categoria > Subcategoria>", '
        '"marca": "<marca do produto se estiver no nome, senão vazio>"}. Nunca invente item fora da lista.',
        f"Produto: {nome}\n\nLista oficial:\n" + "\n".join(linhas),
        max_tokens=120,
    )
    try:
        bruto = re.search(r"\{.*\}", resposta or "", re.S)
        dado = json.loads(bruto.group(0)) if bruto else {}
    except (ValueError, AttributeError):
        dado = {}
    escolha = str(dado.get("subcategoria") or "")
    categoria, _, sub = [p.strip() for p in escolha.partition(">")]
    if categoria in TAXONOMIA[familia] and sub in TAXONOMIA[familia][categoria]:
        return (familia, categoria, sub), (str(dado.get("marca") or "").strip()[:60] or None)
    return None


def _marca_por_ia(nome: str) -> str | None:
    from app.utils.ia_copiloto import gerar_texto, ia_disponivel
    if not ia_disponivel():
        return None
    resposta = gerar_texto(
        "Você lê nomes de produtos do varejo brasileiro. Responda SOMENTE a marca/fabricante escrita no nome, "
        "exatamente como aparece. Se não houver marca no nome, responda: nenhuma.",
        f"Nome: {nome}\nMarca:", max_tokens=15)
    marca = str(resposta or "").strip().strip("`'\".")
    return None if not marca or marca.lower() == "nenhuma" else marca[:60]


def classificar(nome: str, marca: str = "", tipo_item: str = "produto", mix: list | None = None,
                estabelecimento_id: int | None = None, usar_ia: bool = True) -> dict[str, Any]:
    """Classifica e preenche. Sempre devolve família/categoria/subcategoria oficiais (no pior caso, "Outros")."""
    from app.services.taxonomia_service import outros
    from app.services.view_schema_service import FAMILIAS_PRODUTO

    tipo_item = "servico" if tipo_item == "servico" else "produto"
    texto = _norm(f"{nome} {marca or ''}")
    palavras = set(slug(f"{nome} {marca or ''}").split("_"))
    todas = [f for f in TAXONOMIA if f != "servico"]
    mix = [f for f in (mix or []) if f in TAXONOMIA]
    # Departamentos da loja primeiro; as outras famílias continuam valendo (a loja pode vender de tudo).
    ordem = (["servico"] if tipo_item == "servico" else [f for f in mix if f != "servico"] +
             [f for f in todas if f not in mix])

    trio, fonte, marca_ia = None, None, None
    achado = _por_sinonimo(texto, tipo_item)
    if achado:
        trio, fonte = achado, "sinonimo"
    if not trio:
        achado = _por_memoria_da_loja(estabelecimento_id, palavras, tipo_item)
        if achado and (tipo_item != "servico" or achado[0] == "servico"):
            trio, fonte = achado, "memoria_loja"
    reserva = None
    if not trio:
        achado = _por_taxonomia(palavras, ordem)
        if achado:
            candidato, score = achado
            # 2+ palavras em comum com o nome oficial = forte; 1 palavra só ("pote", "essência") = fraco:
            # a IA decide primeiro e o casamento de palavras fica de reserva.
            if score >= 15:
                trio, fonte = candidato, "taxonomia"
            else:
                reserva = candidato
    if not trio and usar_ia:
        resultado_ia = _por_ia(nome, marca, ordem, tipo_item)
        if resultado_ia:
            (trio, marca_ia), fonte = resultado_ia, "ia"
    if not trio and reserva:
        trio, fonte = reserva, "taxonomia"

    if trio:
        familia, categoria, sub = trio
        chave_cat, chave_sub = chave_categoria(familia, categoria), chave_subcategoria(familia, categoria, sub)
        confianca = {"sinonimo": "alta", "memoria_loja": "alta", "taxonomia": "media", "ia": "media"}[fonte]
    else:
        familia = "servico" if tipo_item == "servico" else (mix[0] if mix else "bazar")
        chave_cat, chave_sub = outros(familia)
        sub = TAXONOMIA[familia]["Outros"][0]
        fonte, confianca = "nenhuma", "baixa"

    atributos, marca_lida = _extrair_atributos(nome, familia, tipo_item)
    if sub in ("Pneus de Moto", "Câmaras de Ar de Moto") and atributos.get("posicao"):
        atributos["uso_pneu"] = "Dianteiro" if atributos["posicao"] == "Dianteira" else "Traseiro"
    # Marca da IA só vale se estiver escrita no nome (a IA não inventa marca).
    if marca_ia and _norm(marca_ia) not in texto:
        marca_ia = None
    if not (marca or marca_lida or marca_ia) and usar_ia and tipo_item == "produto" and len(texto.split()) >= 3:
        marca_ia = _marca_por_ia(nome)
        if marca_ia and _norm(marca_ia) not in texto:
            marca_ia = None
    if tipo_item == "produto" and familia in ("eletronicos",) and "modelo_compativel" not in atributos:
        m = re.search(r"\b(iphone\s?\d{1,2}\s?(?:pro max|pro|plus|mini)?|galaxy\s?[a-z]\d{1,3}s?|"
                      r"moto\s?[a-z]\d{1,3}|redmi\s?(?:note\s?)?\d{1,2}\w?)\b", texto)
        if m:
            atributos["modelo_compativel"] = m.group(1).title()
    if tipo_item == "servico":
        m = re.search(r"\b(iphone\s?\d{1,2}\s?(?:pro max|pro|plus)?|galaxy\s?[a-z]\d{1,3}|moto\s?[a-z]\d{1,3}|"
                      r"redmi\s?(?:note\s?)?\d{1,2})\b", texto)
        if m:
            atributos["aparelho_atendido"] = m.group(1).title()
        if familia == "servico" and chave_sub.startswith(chave_categoria("servico", "Assistência de Celular")):
            atributos.setdefault("garantia_dias", 90)  # CDC art. 26: serviço durável, 90 dias

    return {
        "familia_produto": familia,
        "familia_nome": FAMILIAS_PRODUTO.get(familia, {}).get("nome", familia),
        "categoria_oficial": chave_cat,
        "subcategoria": chave_sub,
        "categoria_nome": sub,
        "marca": (marca or "").upper() or marca_lida or (marca_ia.upper() if marca_ia else ""),
        "atributos": atributos,
        "ncm": ncm_provavel(chave_sub, atributos.get("material")),
        "fonte": fonte,
        "confianca": confianca,
        "fora_dos_departamentos": bool(mix) and familia not in mix,
    }
