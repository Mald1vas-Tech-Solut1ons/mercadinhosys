"""Tabelas legais de folha por vigência (competência AAAA-MM).

2026: conferidas na fonte oficial em 08/10/2026 —
  IRRF: Receita Federal, tabela mensal a partir de jan/2026 (Lei 15.191/2025) e redução
  da Lei 15.270/2025; INSS: Portaria Interministerial MPS/MF nº 13, de 09/01/2026.
2024 e 2025: valores que o sistema já usava (INSS 2025 pela Portaria MPS/MF nº 6/2025);
  conferir com a contabilidade antes de recalcular competências antigas.
Competências anteriores à primeira vigência usam a primeira tabela.

Tabela personalizada da loja (ConfiguracaoFolha) prevalece sobre a legal; tabela igual a
qualquer uma das legais é tratada como "padrão" e segue a lei da competência.
"""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP

INSS_VIGENCIAS = [
    ("2024-01", [{"ate": 1412.00, "aliquota": 7.5}, {"ate": 2666.68, "aliquota": 9.0},
                 {"ate": 4000.03, "aliquota": 12.0}, {"ate": 7786.02, "aliquota": 14.0}]),
    ("2025-01", [{"ate": 1518.00, "aliquota": 7.5}, {"ate": 2793.88, "aliquota": 9.0},
                 {"ate": 4190.83, "aliquota": 12.0}, {"ate": 8157.41, "aliquota": 14.0}]),
    ("2026-01", [{"ate": 1621.00, "aliquota": 7.5}, {"ate": 2902.84, "aliquota": 9.0},
                 {"ate": 4354.27, "aliquota": 12.0}, {"ate": 8475.55, "aliquota": 14.0}]),
]

_IRRF_2024 = [
    {"ate": 2259.20, "aliquota": 0.0, "deducao": 0.0},
    {"ate": 2826.65, "aliquota": 7.5, "deducao": 169.44},
    {"ate": 3751.05, "aliquota": 15.0, "deducao": 381.44},
    {"ate": 4664.68, "aliquota": 22.5, "deducao": 662.77},
    {"ate": None, "aliquota": 27.5, "deducao": 896.00},
]
_IRRF_2025 = [
    {"ate": 2428.80, "aliquota": 0.0, "deducao": 0.0},
    {"ate": 2826.65, "aliquota": 7.5, "deducao": 182.16},
    {"ate": 3751.05, "aliquota": 15.0, "deducao": 394.16},
    {"ate": 4664.68, "aliquota": 22.5, "deducao": 675.49},
    {"ate": None, "aliquota": 27.5, "deducao": 908.73},
]
IRRF_VIGENCIAS = [
    ("2024-02", {"faixas": _IRRF_2024, "dependente": 189.59, "simplificado": 564.80, "reducao": None}),
    ("2025-05", {"faixas": _IRRF_2025, "dependente": 189.59, "simplificado": 607.20, "reducao": None}),
    # Lei 15.270/2025: imposto zerado até R$ 5.000; de 5.000,01 a 7.350 a redução decresce linearmente.
    ("2026-01", {"faixas": _IRRF_2025, "dependente": 189.59, "simplificado": 607.20,
                 "reducao": {"isento_ate": 5000.00, "teto_reducao": 312.89, "fim": 7350.00,
                             "constante": 978.62, "coeficiente": 0.133145}}),
]


def _D(valor) -> Decimal:
    return Decimal(str(valor if valor is not None else 0))


def _q2(valor) -> Decimal:
    return _D(valor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _vigente(vigencias, competencia):
    escolhido = vigencias[0][1]
    for inicio, dados in vigencias:
        if competencia >= inicio:
            escolhido = dados
    return deepcopy(escolhido)


def _assinatura(faixas):
    return [(_q2(f.get("ate")) if f.get("ate") is not None else None, _q2(f.get("aliquota")),
             _q2(f.get("deducao", 0))) for f in (faixas or [])]


def _eh_padrao(faixas, tabelas):
    return not faixas or any(_assinatura(faixas) == _assinatura(t) for t in tabelas)


def parametros_folha(config, competencia: str) -> dict:
    """Parâmetros de INSS/IRRF aplicáveis à competência (AAAA-MM)."""
    inss_legal = _vigente(INSS_VIGENCIAS, competencia)
    irrf_legal = _vigente(IRRF_VIGENCIAS, competencia)
    inss = getattr(config, "inss_faixas", None)
    irrf = getattr(config, "irrf_faixas", None)
    todas_inss = [t for _, t in INSS_VIGENCIAS]
    todas_irrf = [d["faixas"] for _, d in IRRF_VIGENCIAS]
    dependente = getattr(config, "deducao_por_dependente", None)
    return {
        "inss_faixas": inss_legal if _eh_padrao(inss, todas_inss) else inss,
        "irrf_faixas": irrf_legal["faixas"] if _eh_padrao(irrf, todas_irrf) else irrf,
        "dependente": float(dependente) if dependente else irrf_legal["dependente"],
        "simplificado": irrf_legal["simplificado"],
        "reducao": irrf_legal["reducao"],
        "personalizada": {"inss": not _eh_padrao(inss, todas_inss), "irrf": not _eh_padrao(irrf, todas_irrf)},
    }


def calcular_irrf_mensal(rendimento_tributavel, inss, dependentes, params, calcular_imposto) -> dict:
    """IRRF mensal: desconta o maior entre (INSS + dependentes) e o desconto simplificado,
    aplica a tabela progressiva e, se vigente, a redução da Lei 15.270/2025.

    ``calcular_imposto(base, faixas)`` é a função de tabela progressiva do serviço de folha.
    """
    rtb = _D(rendimento_tributavel)
    deducao_legal = _D(inss) + _D(params["dependente"]) * int(dependentes or 0)
    simplificado = _D(params["simplificado"])
    usa_simplificado = simplificado > deducao_legal
    deducao = max(deducao_legal, simplificado)
    base = max(Decimal("0"), rtb - deducao)
    imposto_tabela = _D(calcular_imposto(base, params["irrf_faixas"]))

    reducao = Decimal("0")
    regra = params.get("reducao")
    if regra and imposto_tabela > 0:
        if rtb <= _D(regra["isento_ate"]):
            reducao = min(imposto_tabela, _D(regra["teto_reducao"]))
        elif rtb < _D(regra["fim"]):
            reducao = _D(regra["constante"]) - _D(regra["coeficiente"]) * rtb
            reducao = min(imposto_tabela, max(Decimal("0"), reducao))
    return {
        "imposto": _q2(max(Decimal("0"), imposto_tabela - reducao)),
        "imposto_tabela": _q2(imposto_tabela),
        "reducao": _q2(reducao),
        "base": _q2(base),
        "deducao": _q2(deducao),
        "usa_simplificado": usa_simplificado,
    }
