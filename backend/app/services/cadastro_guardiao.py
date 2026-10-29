"""Guardião do cadastro de produtos — qualidade que vale em TODA entrada.

O piloto provou o custo de não ter (banco Oracle, 29/10):
201/215 nomes em minúscula, 16 produtos com estoque 0, unidade "un"/"UN"
dividida 80×91 e itens soltos de pallet cadastrados 2× com nomes diferentes.
Cada regra abaixo travou uma dessas portas.

Regras de QUALIDADE sempre valem (toda loja, todo plano):
  Q1  nome que é só código de barras -> recusa (o form ensina o caminho certo)
  Q2  GTIN com dígito verificador inválido -> recusa (não polui o catálogo global)
  Q3  estoque 0 em produto físico -> recusa, com exceção CONSCIENTE
      ("entrar sem estoque" marca cadastro_pendente_revisao -> Lista de Revisão)
  Q4  nome/marca/fabricante/categoria gravados em UPPERCASE canônico
      (trim + colapso de espaços; idempotente; etiqueta/PDV/relatório iguais)
  Q5  unidade de medida normalizada (e aceita só letras: "un"->"UN")

Regras FISCAIS condicionais (emissao_habilitada): cadastro NUNCA recusa por
fiscal de loja sem add-on de emissão — fiscal enriquece, não trava (o rigor
existe quando a loja liga o add-on Focus e passa pelo pré-check do wizard).

Consumidores: criar_produto, atualizar_produto, catalogo_importar, importação
de planilha. Toda nova entrada de produto chama daqui — única fonte de regra.
"""
import re
import unicodedata

# ---------------------------------------------------------------------------
# Normalização canônica (Q4)
# ---------------------------------------------------------------------------

def canonicalizar_texto(texto) -> str:
    """Trim, colapso de espaços internos e UPPERCASE — idempotente."""
    if texto is None:
        return ""
    plano = " ".join(str(texto).split())
    return plano.upper()


def gtin_valido(codigo_barras) -> bool:
    """Dígito verificador de GTIN-8/12/13/14 (padrão GS1). False quando inválido."""
    if codigo_barras is None:
        return False
    digitos = re.sub(r"\D", "", str(codigo_barras))
    if len(digitos) not in (8, 12, 13, 14):
        return False
    corpo, dv = digitos[:-1], int(digitos[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(corpo)))
    return (10 - total % 10) % 10 == dv


def e_somente_codigo_de_barras(nome, codigo_barras=None) -> bool:
    """Q1: nome vazio de informação — só dígitos (>=7, cara de EAN) ou idêntico ao EAN.

    "2 L" e "12%" passam (não são cara de código); "7896036200056" não passa.
    """
    if nome is None:
        return True
    nome = str(nome).strip()
    if not nome:
        return True
    if codigo_barras:
        ean = re.sub(r"\D", "", str(codigo_barras))
        if ean and re.sub(r"\D", "", nome) == ean:
            return True
    if re.fullmatch(r"\d{7,14}", nome):
        return True
    return False


# ---------------------------------------------------------------------------
# Estoque (Q3) — exceção consciente
# ---------------------------------------------------------------------------

def avaliar_estoque(quantidade, tipo_item, controlar_estoque, data) -> tuple:
    """Devolve (erros, kwargs_estoque) para o fluxo de criação.

    Produto físico com quantidade <= 0 recusa — exceto quando o chamador
    marcou a exceção consciente (data['entrar_sem_estoque'] verdadeiro): aí
    grava com cadastro_pendente_revisao=True (Lista de Revisão do dono).
    """
    if tipo_item == "servico" or not controlar_estoque:
        return [], {"quantidade": max(0, _decimal(quantidade) or 0),
                    "cadastro_pendente_revisao": False}
    qtd = _decimal(quantidade)
    if qtd is None or qtd <= 0:
        if _marcado(data.get("entrar_sem_estoque")):
            return [], {"quantidade": 0, "cadastro_pendente_revisao": True}
        return (["Estoque zerado no cadastro. Dê entrada da quantidade inicial — "
                 "ou use \"Entrar sem estoque agora\" para revisar depois."],
                {"quantidade": 0, "cadastro_pendente_revisao": False})
    return [], {"quantidade": qtd, "cadastro_pendente_revisao": False}


def _decimal(valor):
    from decimal import Decimal
    if valor in (None, ""):
        return None
    try:
        return Decimal(str(valor))
    except Exception:
        return None


def _marcado(valor):
    if isinstance(valor, str):
        return valor.strip().lower() in ("1", "true", "sim", "s", "on", "yes")
    return bool(valor)


# ---------------------------------------------------------------------------
# Unidade de medida (Q5)
# ---------------------------------------------------------------------------

def normalizar_unidade(unidade, unidades_permitidas=None) -> tuple:
    """UPPER + aceita grafia minúscula; (None, erro) quando desconhecida.

    `unidades_permitidas` é a lista do schema do segmento (view_schema_service).
    Com None, aceita qualquer sigla alfanumérica de até 12 caracteres.
    """
    u = canonicalizar_texto(unidade) or "UN"
    if not re.fullmatch(r"[A-Z0-9]{1,12}", u):
        return None, f'Unidade "{unidade}" inválida (use siglas como UN, KG, CX).'
    if unidades_permitidas:
        # aceita "un", "Un", "UN"; lista canônica é comparada em UPPER
        if u not in {canonicalizar_texto(x) for x in unidades_permitidas if x}:
            sugestoes = ", ".join(unidades_permitidas[:8])
            return None, f'Unidade "{unidade}" não é do seu segmento (sugestões: {sugestoes}).'
    return u, None


# ---------------------------------------------------------------------------
# Interruptor fiscal (F0)
# ---------------------------------------------------------------------------

def emissao_habilitada(estabelecimento) -> bool:
    """True só quando a loja emite NF de verdade (add-on Focus NFe com credenciais).

    `simulado` (padrão da loja sem add-on) e credenciais faltando = False:
    o fiscal NUNCA trava o cadastro de quem não emite nota.
    """
    if estabelecimento is None:
        return False
    gateway = str(getattr(estabelecimento, "fiscal_gateway", "") or "").lower()
    if gateway in ("", "simulado"):
        return False
    return bool(getattr(estabelecimento, "fiscal_token", None)
                and getattr(estabelecimento, "fiscal_csc", None))


# ---------------------------------------------------------------------------
# Avaliação completa — retorna (erros, substituições)
#   erros: lista de mensagens (recusas de qualidade)
#   substituições: dicionário de valores canônicos para gravar
# ---------------------------------------------------------------------------

def validar_entrada(data, estabelecimento=None, unidades_permitidas=None,
                    tipo_item="produto", controlar_estoque=True) -> tuple:
    erros = []
    substitui = {}

    nome = canonicalizar_texto(data.get("nome"))
    if not nome:
        erros.append("O campo nome é obrigatório")
    elif e_somente_codigo_de_barras(nome, data.get("codigo_barras")):
        erros.append("O nome do produto não pode ser o próprio código de barras. "
                     "Escaneie o EAN ou busque por palavra-chave que o sistema "
                     "preenche os dados para você.")

    cb = data.get("codigo_barras") or None
    if cb:
        digitos = re.sub(r"\D", "", str(cb))
        ean_interno = False
        if digitos:
            from app.services.codigo_barras_service import eh_codigo_interno
            ean_interno = eh_codigo_interno(digitos)
        if not ean_interno and not gtin_valido(digitos):
            erros.append("Código de barras com dígito verificador inválido — "
                         "confira a digitação ou a bipagem.")

    estoque_erros, estoque_kwargs = avaliar_estoque(
        data.get("quantidade"), tipo_item, controlar_estoque, data)
    erros.extend(estoque_erros)
    substitui.update(estoque_kwargs)

    for campo in ("nome", "marca", "fabricante", "categoria"):
        if data.get(campo) is not None:
            substitui[campo] = canonicalizar_texto(data.get(campo))

    unidade, erro_unidade = normalizar_unidade(data.get("unidade_medida"),
                                               unidades_permitidas)
    if erro_unidade:
        erros.append(erro_unidade)
    else:
        substitui["unidade_medida"] = unidade

    return erros, substitui