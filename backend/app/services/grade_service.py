"""Grade de calçados/roupas: cada número (e cor) é um Produto vendável.

O produto cadastrado vira o MODELO da grade: guarda os dados comuns (categoria,
preço, fiscal, família), fica inativo e não é vendido. Cada variação é um Produto
normal com código e estoque próprios, então PDV, estoque, NFC-e, etiquetas e
relatórios seguem funcionando por produto_id sem nenhuma regra especial.
O chamador faz o commit.
"""
import json
import re
import unicodedata
from decimal import Decimal, ROUND_HALF_UP

from app.models import MovimentacaoEstoque, Produto, db

# Campos copiados do modelo para cada variação.
_CAMPOS_HERDADOS = (
    "categoria_id", "fornecedor_id", "descricao", "marca", "fabricante", "tipo", "subcategoria",
    "unidade_medida", "quantidade_minima", "preco_custo", "preco_venda", "margem_lucro", "origem_custo",
    "preco_referencia_mercado", "fonte_referencia_mercado", "referencia_mercado_em", "ncm", "origem",
    "cest", "cfop_padrao", "cst_icms", "csosn", "icms_st", "unidade_tributavel", "icms_aliquota",
    "pis_aliquota", "cofins_aliquota", "imagem_url", "controlar_validade", "tipo_item", "controlar_estoque",
    "familia_produto", "perfil_fiscal", "atributos_json",
)
_MAX_VARIACOES = 200


class GradeError(ValueError):
    """Pedido de grade inválido; ValueError para as rotas responderem 400."""


def _limpar(valores) -> list:
    vistos, saida = set(), []
    for v in valores or []:
        texto = str(v or "").strip()
        if texto and texto.lower() not in vistos:
            vistos.add(texto.lower())
            saida.append(texto[:20])
    return saida


def _sigla(texto: str) -> str:
    sem_acento = "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9]", "", sem_acento.upper())[:4] or "X"


def chave_celula(numeracao, cor) -> str:
    return f"{numeracao}|{cor or ''}"


def atributos_variante(produto) -> dict:
    try:
        return json.loads(produto.atributos_variante) if produto.atributos_variante else {}
    except (ValueError, TypeError):
        return {}


def modelo_de(produto):
    """O modelo da grade a que o produto pertence (ele mesmo, se já for o modelo)."""
    if produto.eh_grade_modelo:
        return produto
    if produto.produto_pai_id:
        return Produto.query.filter_by(id=produto.produto_pai_id,
                                       estabelecimento_id=produto.estabelecimento_id).first()
    return None


def variacoes_de(modelo) -> list:
    return (Produto.query.filter_by(produto_pai_id=modelo.id, estabelecimento_id=modelo.estabelecimento_id)
            .filter(Produto.deleted_at.is_(None)).order_by(Produto.id.asc()).all())


def _codigo_unico(estab_id, base: str) -> str:
    codigo, n = base[:50], 2
    while Produto.query.filter_by(estabelecimento_id=estab_id, codigo_interno=codigo).first():
        sufixo = f"-{n}"
        codigo, n = base[:50 - len(sufixo)] + sufixo, n + 1
    return codigo


def _quantidade(valor) -> Decimal:
    try:
        q = Decimal(str(valor or 0)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    except Exception:
        raise GradeError("Quantidade inválida na grade") from None
    if q < 0 or q > Decimal("999999"):
        raise GradeError("Quantidade inválida na grade")
    return q


def gerar_grade(produto, numeracoes, cores=None, quantidades=None, funcionario_id=None) -> list:
    """Cria as variações que faltam (número × cor) e devolve as criadas.

    Chamar de novo acrescenta números/cores sem duplicar os existentes.
    ``quantidades``: {"38|Preto": 2, "39|": 1} — estoque inicial de cada célula nova.
    """
    if produto.produto_pai_id:
        raise GradeError("Este item já é uma variação; abra a grade pelo modelo.")
    if (produto.tipo_item or "produto") == "servico":
        raise GradeError("Serviço não tem grade.")
    numeracoes = _limpar(numeracoes)
    cores = _limpar(cores) or [None]
    if not numeracoes:
        raise GradeError("Informe ao menos um número/tamanho.")
    quantidades = quantidades or {}

    existentes = {}
    if produto.eh_grade_modelo:
        for v in variacoes_de(produto):
            a = atributos_variante(v)
            existentes[chave_celula(a.get("numeracao"), a.get("cor"))] = v
    elif Decimal(str(produto.quantidade or 0)) > 0:
        raise GradeError(f"{produto.nome} tem {Decimal(str(produto.quantidade)).normalize():f} em estoque sem número. "
                         "Zere o estoque do produto antes de criar a grade e lance as quantidades por número.")

    novas = [(n, c) for n in numeracoes for c in cores if chave_celula(n, c) not in existentes]
    if len(existentes) + len(novas) > _MAX_VARIACOES:
        raise GradeError(f"A grade passa de {_MAX_VARIACOES} variações.")

    estab_id = produto.estabelecimento_id
    base_codigo = produto.codigo_interno or f"P{produto.id}"
    criadas = []
    for numeracao, cor in novas:
        variacao = Produto(estabelecimento_id=estab_id)
        for campo in _CAMPOS_HERDADOS:
            setattr(variacao, campo, getattr(produto, campo))
        variacao.nome = f"{produto.nome} {numeracao}{' ' + cor if cor else ''}"[:100]
        variacao.codigo_interno = _codigo_unico(
            estab_id, f"{base_codigo}-{_sigla(numeracao)}{'-' + _sigla(cor) if cor else ''}")
        variacao.codigo_barras = None
        variacao.produto_pai_id = produto.id
        variacao.atributos_variante = json.dumps({"numeracao": numeracao, "cor": cor}, ensure_ascii=False)
        variacao.ativo = True
        variacao.quantidade = Decimal("0")
        db.session.add(variacao)
        db.session.flush()

        inicial = _quantidade(quantidades.get(chave_celula(numeracao, cor)))
        if inicial > 0:
            variacao.quantidade = inicial
            custo = Decimal(str(variacao.preco_custo or 0))
            db.session.add(MovimentacaoEstoque(
                estabelecimento_id=estab_id, produto_id=variacao.id, funcionario_id=funcionario_id,
                tipo="entrada", quantidade=inicial, quantidade_anterior=Decimal("0"), quantidade_atual=inicial,
                custo_unitario=custo, valor_total=(custo * inicial).quantize(Decimal("0.01")),
                motivo="Estoque inicial da grade",
            ))
        criadas.append(variacao)

    # O modelo deixa de ser vendável: sai do caixa, das listas e dos alertas.
    produto.eh_grade_modelo = True
    produto.ativo = False
    produto.quantidade = Decimal("0")
    return criadas


def matriz(produto) -> dict:
    """Grade do modelo (a partir dele ou de qualquer variação): números × cores com estoque."""
    modelo = modelo_de(produto)
    if modelo is None:
        return {"modelo": None, "numeracoes": [], "cores": [], "celulas": [], "total": 0}
    celulas, numeracoes, cores = [], [], []
    for v in variacoes_de(modelo):
        a = atributos_variante(v)
        n, c = a.get("numeracao"), a.get("cor")
        if n not in numeracoes:
            numeracoes.append(n)
        if c and c not in cores:
            cores.append(c)
        celulas.append({
            "id": v.id, "nome": v.nome, "numeracao": n, "cor": c,
            "quantidade": float(v.quantidade or 0), "quantidade_minima": float(v.quantidade_minima or 0),
            "vendidos": float(v.quantidade_vendida or 0),
            "codigo_barras": v.codigo_barras, "codigo_interno": v.codigo_interno,
            "preco_venda": float(v.preco_venda or 0), "ativo": bool(v.ativo),
        })

    def _ordem(n):
        try:
            return (0, float(str(n).replace(",", ".")), str(n))
        except ValueError:
            return (1, 0.0, str(n))

    numeracoes.sort(key=_ordem)
    return {
        "modelo": {"id": modelo.id, "nome": modelo.nome, "codigo_interno": modelo.codigo_interno},
        "numeracoes": numeracoes, "cores": cores, "celulas": celulas,
        "total": float(sum(c["quantidade"] for c in celulas)),
        "total_vendidos": float(sum(c["vendidos"] for c in celulas)),
    }
