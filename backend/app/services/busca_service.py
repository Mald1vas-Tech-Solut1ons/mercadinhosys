"""Busca global (Ctrl+K): produto, cliente, fornecedor e venda num só campo.

Tolerante sem extensão do banco: o catálogo de uma loja tem centenas ou poucos
milhares de itens, então os candidatos vêm do SQL e o ranqueamento é feito aqui —
prefixo > trecho > grafia parecida ("agau" acha "Água", "coca 2l" acha
"Coca-Cola 2 Litros"). Funciona igual no Postgres de produção e no SQLite dos testes.

Palavras de estado viram filtro em vez de texto: "vencendo", "vencido",
"sem estoque", "estoque baixo". Número e cor da grade já estão no nome da
variação ("Tênis Corrida 38 Preto"), então "tênis 38 preto" acha pelo texto.
"""
import re
import unicodedata
from datetime import timedelta
from difflib import SequenceMatcher

from app.models import Cliente, Fornecedor, Produto, Venda
from app.utils.timezone import hoje_local

_LIMITE_CANDIDATOS = 5000

# Expressões de estado -> filtro (a expressão sai do texto buscado).
_FILTROS = (
    (("sem estoque", "zerado", "zerados", "esgotado", "esgotados"), "sem_estoque"),
    (("estoque baixo", "baixo estoque", "acabando"), "estoque_baixo"),
    (("vencendo", "a vencer", "vence"), "vencendo"),
    (("vencido", "vencidos"), "vencido"),
)


def normalizar(texto) -> str:
    sem_acento = "".join(c for c in unicodedata.normalize("NFKD", str(texto or "")) if not unicodedata.combining(c))
    sem_acento = re.sub(r"(\d)([a-z])", r"\1 \2", sem_acento.lower())  # "2l" -> "2 l"
    return " ".join(re.sub(r"[^a-z0-9]+", " ", sem_acento).split())


def interpretar(q: str):
    """Separa o texto livre dos filtros de estado."""
    texto = f" {normalizar(q)} "
    filtros = []
    for expressoes, filtro in _FILTROS:
        for e in sorted(expressoes, key=len, reverse=True):
            if f" {e} " in texto:
                texto = texto.replace(f" {e} ", " ")
                if filtro not in filtros:
                    filtros.append(filtro)
    return texto.split(), filtros


def _nota_token(tq: str, tokens_alvo: list) -> float:
    melhor = 0.0
    for t in tokens_alvo:
        if t == tq:
            return 1.0
        if t.startswith(tq):
            melhor = max(melhor, 0.95)
        elif len(tq) >= 3 and tq in t:
            melhor = max(melhor, 0.85)
        elif len(tq) >= 3 and not tq.isdigit() and abs(len(t) - len(tq)) <= 2:
            r = SequenceMatcher(None, tq, t).ratio()
            if r >= 0.72:
                melhor = max(melhor, r * 0.9)
    return melhor


def pontuar(tokens_busca: list, texto_alvo: str) -> float:
    """0 = não casa. Todo token buscado precisa casar com algum token do alvo."""
    if not tokens_busca:
        return 0.5
    alvo = normalizar(texto_alvo).split()
    notas = []
    for tq in tokens_busca:
        n = _nota_token(tq, alvo)
        if n <= 0:
            return 0.0
        notas.append(n)
    return sum(notas) / len(notas)


def _ranquear(itens, tokens, texto_de, limite, desempate=None):
    pontuados = []
    for item in itens:
        nota = pontuar(tokens, texto_de(item))
        if nota > 0:
            pontuados.append((nota, desempate(item) if desempate else 0, item))
    pontuados.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [p[2] for p in pontuados[:limite]]


def _digitos(texto) -> str:
    return re.sub(r"\D", "", str(texto or ""))


def buscar(estab_id, q: str, limite: int = 6) -> dict:
    q = (q or "").strip()
    tokens, filtros = interpretar(q)
    resultado = {"produtos": [], "clientes": [], "fornecedores": [], "vendas": [], "filtros": filtros}
    if not tokens and not filtros:
        return resultado

    # ---- Produtos (modelo de grade não é item vendável) ----
    consulta = Produto.query.filter(
        Produto.estabelecimento_id == estab_id, Produto.ativo.is_(True),
        Produto.eh_grade_modelo.isnot(True), Produto.deleted_at.is_(None),
    )
    hoje = hoje_local()
    if "sem_estoque" in filtros:
        consulta = consulta.filter(Produto.quantidade <= 0)
    if "estoque_baixo" in filtros:
        consulta = consulta.filter(Produto.quantidade > 0, Produto.quantidade <= Produto.quantidade_minima)
    if "vencido" in filtros:
        consulta = consulta.filter(Produto.data_validade.isnot(None), Produto.data_validade < hoje)
    if "vencendo" in filtros:
        consulta = consulta.filter(Produto.data_validade.isnot(None), Produto.data_validade >= hoje,
                                   Produto.data_validade <= hoje + timedelta(days=30))

    digitos_q = _digitos(q)
    exatos = []
    if len(digitos_q) >= 8 and digitos_q == q.replace(" ", ""):
        # Leitor de código: EAN ou código interno exato primeiro.
        exatos = consulta.filter((Produto.codigo_barras == digitos_q) | (Produto.codigo_interno == q)).all()
    candidatos = consulta.limit(_LIMITE_CANDIDATOS).all()
    ranqueados = _ranquear(
        candidatos, tokens,
        lambda p: f"{p.nome} {p.marca or ''} {p.codigo_barras or ''} {p.codigo_interno or ''}",
        limite, desempate=lambda p: float(p.quantidade_vendida or 0),
    ) if tokens else candidatos[:limite]
    vistos = set()
    for p in exatos + ranqueados:
        if p.id in vistos or len(resultado["produtos"]) >= limite:
            continue
        vistos.add(p.id)
        resultado["produtos"].append({
            "id": p.id, "nome": p.nome, "codigo_barras": p.codigo_barras,
            "quantidade": float(p.quantidade or 0), "unidade": p.unidade_medida,
            "preco_venda": float(p.preco_venda or 0),
            "data_validade": p.data_validade.isoformat() if p.data_validade else None,
        })

    if not tokens:  # só filtro de estado: a resposta é de produtos
        return resultado

    # ---- Clientes ----
    clientes = Cliente.query.filter(Cliente.estabelecimento_id == estab_id, Cliente.deleted_at.is_(None)) \
        .limit(_LIMITE_CANDIDATOS).all()
    for c in _ranquear(clientes, tokens,
                       lambda c: f"{c.nome} {c.razao_social or ''} {_digitos(c.cpf)} {_digitos(c.cnpj)} "
                                 f"{_digitos(c.celular)}", limite):
        resultado["clientes"].append({"id": c.id, "nome": c.nome, "documento": c.cpf or c.cnpj,
                                      "celular": c.celular})

    # ---- Fornecedores ----
    fornecedores = Fornecedor.query.filter(Fornecedor.estabelecimento_id == estab_id) \
        .limit(_LIMITE_CANDIDATOS).all()
    for f in _ranquear(fornecedores, tokens,
                       lambda f: f"{f.nome_fantasia} {f.razao_social or ''} {_digitos(f.cnpj)}", limite):
        resultado["fornecedores"].append({"id": f.id, "nome": f.nome_fantasia, "cnpj": f.cnpj})

    # ---- Vendas: pelo código (o que aparece no cupom) ----
    termo_codigo = q.strip().upper()
    if len(termo_codigo) >= 3:
        vendas = Venda.query.filter(Venda.estabelecimento_id == estab_id, Venda.deleted_at.is_(None),
                                    Venda.codigo.ilike(f"%{termo_codigo}%")) \
            .order_by(Venda.id.desc()).limit(limite).all()
        for v in vendas:
            resultado["vendas"].append({
                "id": v.id, "codigo": v.codigo, "total": float(v.total or 0), "status": v.status,
                "data_venda": v.data_venda.isoformat() + "+00:00" if v.data_venda else None,
            })
    return resultado
