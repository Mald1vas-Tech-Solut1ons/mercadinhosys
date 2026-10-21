"""
Regras de tributação por item da NFC-e que não dependem de tabela por estado.

Funções puras (sem banco): o emissor (emissao_service), o cadastro de produto e
o schema contextual consultam daqui, para a regra existir num lugar só.

1. PIS/COFINS monofásico de perfumaria e higiene pessoal
   Lei 10.147/2000, art. 1º, I, "b": a indústria/importador recolhe PIS/COFINS
   concentrado sobre as posições 33.03 a 33.07 e os códigos 3401.11.90 (exceto o
   Ex 01), 3401.20.10 e 9603.21.00 da TIPI; na revenda, a receita tem alíquota
   zero (art. 2º). Lucro presumido/real: CST PIS/COFINS 04. Simples Nacional: a
   receita é segregada no PGDAS-D (LC 123/2006, art. 18, § 4º-A, I) e a nota
   segue com o CST que o emissor já usa para o Simples.
   A detecção é só pelo NCM e vale para qualquer família de produto.

2. ICMS por substituição tributária (ST)
   Quem decide se um NCM tem ST é a legislação de cada UF (protocolos e
   convênios, CEST do Convênio ICMS 142/2018). O sistema não guarda tabela por
   estado: o produto é marcado como "ICMS recolhido por ST" (Produto.icms_st)
   por quem cadastra, orientado pelo contador. Marcado, a NFC-e sai com
   CSOSN 500 (Simples) ou CST 60 (regime normal) e CFOP 5405, e o CEST passa a
   ser obrigatório (NT 2015.003).
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# PIS/COFINS monofásico — Lei 10.147/2000, art. 1º, I, "b"
# ---------------------------------------------------------------------------
# Posições inteiras (prefixo de 4 dígitos). O texto legal diz "33.03 a 33.07",
# o que inclui a 33.06 (higiene bucal: creme dental, fio dental).
POSICOES_MONOFASICO_PERFUMARIA = ("3303", "3304", "3305", "3306", "3307")
# Códigos específicos (8 dígitos).
CODIGOS_MONOFASICO_PERFUMARIA = ("34011190", "34012010", "96032100")
# Código com destaque "Ex" excluído do regime: 3401.11.90 Ex 01.
EXCECOES_EX_TIPI = {("34011190", "01")}

CST_PIS_COFINS_MONOFASICO_REVENDA = "04"  # operação tributável monofásica, revenda a alíquota zero
CST_PIS_COFINS_PADRAO = "49"              # o que o emissor já usava para todos os itens

CFOP_VENDA_ST = "5405"
CSOSN_ST = "500"   # ICMS cobrado anteriormente por ST (Simples Nacional)
CST_ICMS_ST = "60"  # ICMS cobrado anteriormente por ST (regime normal)


def _so_digitos(valor) -> str:
    return re.sub(r"\D", "", str(valor or ""))


def normalizar_ex_tipi(ex_tipi) -> str:
    digitos = _so_digitos(ex_tipi)
    return digitos.zfill(2) if digitos else ""


def eh_pis_cofins_monofasico(ncm, ex_tipi=None) -> bool:
    """True quando o NCM é de perfumaria/higiene com PIS/COFINS monofásico.

    Aceita o NCM com ou sem pontuação. NCM incompleto (menos de 8 dígitos) não é
    classificado: sem o código inteiro não dá para afirmar o regime.
    `ex_tipi` é o destaque "Ex" da TIPI; o cadastro de produto ainda não guarda
    esse dado, então um 3401.11.90 Ex 01 só é excluído quando o Ex é informado.
    """
    codigo = _so_digitos(ncm)
    if len(codigo) != 8 or codigo == "00000000":
        return False
    if (codigo, normalizar_ex_tipi(ex_tipi)) in EXCECOES_EX_TIPI:
        return False
    if codigo in CODIGOS_MONOFASICO_PERFUMARIA:
        return True
    return codigo[:4] in POSICOES_MONOFASICO_PERFUMARIA


def regime_eh_simples(regime_tributario) -> bool:
    return "SIMPLES" in str(regime_tributario or "").upper()


def cst_pis_cofins_saida(ncm, regime_tributario, ex_tipi=None) -> str:
    """CST de PIS e de COFINS na venda ao consumidor.

    Simples Nacional: mantém o CST que o emissor já usava (49); a segregação da
    receita monofásica é feita no PGDAS-D a partir da marca do produto.
    Regime normal: 04 para monofásico; demais itens seguem como antes (49).
    """
    if not regime_eh_simples(regime_tributario) and eh_pis_cofins_monofasico(ncm, ex_tipi):
        return CST_PIS_COFINS_MONOFASICO_REVENDA
    return CST_PIS_COFINS_PADRAO


def cest_valido(cest) -> bool:
    return len(_so_digitos(cest)) == 7


def icms_por_st(produto) -> bool:
    return bool(getattr(produto, "icms_st", False))


def codigos_icms_st(regime_tributario) -> dict:
    """CSOSN/CST e CFOP de um item com ICMS recolhido por ST."""
    return {
        "icms_situacao_tributaria": CSOSN_ST if regime_eh_simples(regime_tributario) else CST_ICMS_ST,
        "cfop": CFOP_VENDA_ST,
    }


def regras_para_interface() -> dict:
    """Regras expostas no schema para o formulário avisar o operador ao digitar o NCM."""
    return {
        "pis_cofins_monofasico": {
            "posicoes": list(POSICOES_MONOFASICO_PERFUMARIA),
            "codigos": list(CODIGOS_MONOFASICO_PERFUMARIA),
            "base_legal": "Lei 10.147/2000, art. 1º, I, b",
        },
        "icms_st": {
            "csosn": CSOSN_ST,
            "cst_icms": CST_ICMS_ST,
            "cfop": CFOP_VENDA_ST,
            "exige_cest": True,
        },
    }
