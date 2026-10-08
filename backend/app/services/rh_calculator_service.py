"""
Serviço de cálculo de RH & Folha — FONTE ÚNICA DE VERDADE.

Toda a matemática de ponto (atraso, hora extra), holerite (proventos/descontos)
e rescisão vive aqui, para que espelho de ponto, holerite e folha nunca
divirjam. As rotas apenas orquestram; a lógica de negócio mora neste módulo.

Convenções:
- Horas extras seguem a jornada legal (CLT): o que exceder a jornada diária
  normal (ConfiguracaoHorario.jornada_diaria_minutos, padrão 8h) vira extra.
- Atraso vem do minutos_atraso gravado em cada RegistroPonto no momento da
  batida (respeita a tolerância configurada).
- Valores monetários usam Decimal e são arredondados a 2 casas (ROUND_HALF_UP).
"""
from collections import defaultdict
from datetime import datetime, date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import calendar

JORNADA_PADRAO_MIN = 480  # 8h/dia (CLT)


def _q2(valor) -> float:
    """Arredonda para 2 casas decimais (dinheiro), retornando float p/ JSON."""
    return float(Decimal(str(valor)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _fmt_hora(t):
    return t.strftime("%H:%M") if t else None


def _D(v) -> Decimal:
    return Decimal(str(v if v is not None else 0))


from app.services.tabelas_folha import calcular_irrf_mensal, parametros_folha  # noqa: E402


def obter_config_folha(estabelecimento_id):
    """Retorna a ConfiguracaoFolha da loja, criando com defaults CLT se faltar.
    Fonte única dos parâmetros de folha — nada de valores fixos no cálculo."""
    from app.models import db, ConfiguracaoFolha
    cfg = ConfiguracaoFolha.query.filter_by(estabelecimento_id=estabelecimento_id).first()
    if not cfg:
        cfg = ConfiguracaoFolha(estabelecimento_id=estabelecimento_id)
        db.session.add(cfg)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            cfg = ConfiguracaoFolha.query.filter_by(estabelecimento_id=estabelecimento_id).first() or cfg
    return cfg


def calcular_inss(base, faixas) -> Decimal:
    """INSS progressivo por faixas (aplica a alíquota sobre a parte do salário
    dentro de cada faixa, respeitando o teto da última)."""
    base = _D(base)
    total = Decimal(0)
    anterior = Decimal(0)
    for f in faixas or []:
        teto = _D(f["ate"]) if f.get("ate") is not None else base
        if base <= anterior:
            break
        tributavel = min(base, teto) - anterior
        if tributavel > 0:
            total += tributavel * _D(f["aliquota"]) / Decimal(100)
        anterior = teto
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calcular_irrf(base, faixas) -> Decimal:
    """IRRF pelo método da dedução: encontra a faixa e aplica alíquota × base −
    parcela a deduzir."""
    base = _D(base)
    for f in faixas or []:
        teto = f.get("ate")
        if teto is None or base <= _D(teto):
            imposto = base * _D(f["aliquota"]) / Decimal(100) - _D(f.get("deducao", 0))
            return max(Decimal(0), imposto).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return Decimal(0)


def limites_do_mes(ano_mes: str):
    """'YYYY-MM' -> (date primeiro dia, date último dia)."""
    ano, mes = (int(x) for x in ano_mes.split("-"))
    ultimo = calendar.monthrange(ano, mes)[1]
    return date(ano, mes, 1), date(ano, mes, ultimo)


# ---------------------------------------------------------------------------
# ESPELHO DE PONTO (consumido pelo endpoint de espelho E pelo holerite)
# ---------------------------------------------------------------------------

def calcular_espelho_ponto(funcionario, data_inicio, data_fim, config=None):
    """
    Agrega os RegistroPonto do período em registros diários + resumo.

    Tipos reais gravados por registrar_ponto: entrada, saida_almoco (início da
    pausa), retorno_almoco (fim da pausa), saida (saída final). Horas extras =
    minutos trabalhados no dia além da jornada normal (CLT).

    Retorna dict pronto para serialização (sem dados de assinatura, que são
    responsabilidade do endpoint).
    """
    from sqlalchemy import and_
    from app.models import RegistroPonto, ConfiguracaoHorario

    if config is None:
        config = ConfiguracaoHorario.query.filter_by(
            estabelecimento_id=funcionario.estabelecimento_id
        ).first()

    jornada_normal = (config.jornada_diaria_minutos if config and config.jornada_diaria_minutos
                      else JORNADA_PADRAO_MIN)

    registros = (RegistroPonto.query
                 .filter(and_(
                     RegistroPonto.funcionario_id == funcionario.id,
                     RegistroPonto.data >= data_inicio,
                     RegistroPonto.data <= data_fim,
                 ))
                 .order_by(RegistroPonto.data, RegistroPonto.hora)
                 .all())

    registros_por_dia = defaultdict(list)
    for r in registros:
        registros_por_dia[r.data].append(r)

    registros_diarios = []
    total_dias = total_atrasos = total_min_atraso = 0
    total_min_extras = 0
    total_min_trabalhados = 0

    for dia, regs in sorted(registros_por_dia.items()):
        entrada = saida = intervalo_inicio = intervalo_fim = None
        minutos_atraso = 0
        observacao = None
        tem_saida = False

        for r in regs:
            if r.tipo_registro == "entrada":
                entrada = _fmt_hora(r.hora)
                minutos_atraso += r.minutos_atraso or 0
            elif r.tipo_registro == "saida_almoco":
                intervalo_inicio = _fmt_hora(r.hora)
                minutos_atraso += r.minutos_atraso or 0
            elif r.tipo_registro == "retorno_almoco":
                intervalo_fim = _fmt_hora(r.hora)
                minutos_atraso += r.minutos_atraso or 0
            elif r.tipo_registro == "saida":
                saida = _fmt_hora(r.hora)
                tem_saida = True
            if r.observacao:
                observacao = r.observacao

        # Minutos trabalhados no dia, descontando a pausa de almoço
        minutos_trabalhados = 0
        if entrada and saida:
            try:
                e = datetime.strptime(entrada, "%H:%M")
                s = datetime.strptime(saida, "%H:%M")
                diff = (s - e).total_seconds() / 60
                if intervalo_inicio and intervalo_fim:
                    ii = datetime.strptime(intervalo_inicio, "%H:%M")
                    iff = datetime.strptime(intervalo_fim, "%H:%M")
                    diff -= (iff - ii).total_seconds() / 60
                minutos_trabalhados = max(0, diff)
            except Exception:
                minutos_trabalhados = 0

        # Hora extra (CLT): o que passar da jornada normal do dia
        minutos_extras = 0
        if tem_saida and entrada and saida:
            minutos_extras = max(0, int(minutos_trabalhados - jornada_normal))

        registros_diarios.append({
            "data": dia.isoformat(),
            "entrada": entrada,
            "saida": saida,
            "intervalo_inicio": intervalo_inicio,
            "intervalo_fim": intervalo_fim,
            "minutos_atraso": minutos_atraso,
            "minutos_extras": minutos_extras,
            "horas_trabalhadas": minutos_trabalhados,
            "observacao": observacao,
        })

        if entrada or saida:
            total_dias += 1
        if minutos_atraso > 0:
            total_atrasos += 1
            total_min_atraso += minutos_atraso
        total_min_extras += minutos_extras
        total_min_trabalhados += minutos_trabalhados

    media_horas_dia = (total_min_trabalhados / 60 / total_dias) if total_dias else 0

    return {
        "funcionario_id": funcionario.id,
        "nome": funcionario.nome,
        "cargo": funcionario.cargo,
        "registros_diarios": registros_diarios,
        "resumo": {
            "total_dias_trabalhados": total_dias,
            "total_atrasos": total_atrasos,
            "total_minutos_atraso": total_min_atraso,
            "total_minutos_extras": total_min_extras,
            "total_horas_extras": round(total_min_extras / 60, 2),
            "total_horas_trabalhadas": round(total_min_trabalhados / 60, 2),
            "media_horas_dia": round(media_horas_dia, 2),
            "jornada_diaria_minutos": jornada_normal,
        },
    }


# ---------------------------------------------------------------------------
# HOLERITE (folha mensal) — 100% no backend, lendo ConfiguracaoFolha
# ---------------------------------------------------------------------------

def calcular_holerite(funcionario, mes_referencia: str, config_folha=None) -> dict:
    """
    Holerite do mês com proventos/descontos/líquido e memória de cálculo,
    lendo TODOS os parâmetros da ConfiguracaoFolha (divisor de horas, % hora
    extra, tabelas de INSS/IRRF, FGTS, desconto de VT). Hora extra e atraso
    vêm da engine do espelho (dados reais de ponto).
    """
    from app.models import db, FuncionarioBeneficio, Beneficio

    if config_folha is None:
        config_folha = obter_config_folha(funcionario.estabelecimento_id)

    salario = _D(funcionario.salario_base)
    inicio, fim = limites_do_mes(mes_referencia)
    espelho = calcular_espelho_ponto(funcionario, inicio, fim)
    horas_extras = _D(espelho["resumo"]["total_horas_extras"])
    horas_atraso = _D(espelho["resumo"]["total_minutos_atraso"]) / Decimal(60)

    divisor = Decimal(config_folha.divisor_horas_mensais or 220)
    valor_hora = (salario / divisor) if divisor else Decimal(0)
    pct_he = _D(config_folha.percentual_hora_extra)
    valor_hora_extra = valor_hora * (Decimal(1) + pct_he / Decimal(100))

    vencimentos, descontos, memoria = [], [], []

    vencimentos.append({"descricao": "Salário base", "referencia": "30 dias", "valor": _q2(salario)})

    valor_he = horas_extras * valor_hora_extra
    if valor_he > 0:
        vencimentos.append({"descricao": f"Horas extras ({int(pct_he)}%)",
                            "referencia": f"{float(horas_extras):.2f}h", "valor": _q2(valor_he)})
        memoria.append(f"Hora extra: {float(horas_extras):.2f}h × (R${_q2(salario)}/{int(divisor)}) × (1+{int(pct_he)}%) = R${_q2(valor_he)}")

    # Benefícios ativos (VT/VA etc.) entram como provento
    beneficios = (db.session.query(FuncionarioBeneficio)
                  .join(Beneficio, FuncionarioBeneficio.beneficio_id == Beneficio.id)
                  .filter(FuncionarioBeneficio.funcionario_id == funcionario.id,
                          FuncionarioBeneficio.ativo == True).all())
    tem_vt = False
    valor_vt = Decimal(0)
    for fb in beneficios:
        nome = (fb.beneficio.nome if fb.beneficio else "Benefício")
        vencimentos.append({"descricao": nome, "referencia": "Benefício", "valor": _q2(fb.valor or 0)})
        if "transp" in nome.lower() or nome.strip().upper() in ("VT", "VALE TRANSPORTE"):
            tem_vt = True
            valor_vt += _D(fb.valor or 0)

    # Descontos legais (base: salário + horas extras)
    # Tabelas legais da competência (ou a personalizada da loja), as mesmas da rescisão.
    parametros = parametros_folha(config_folha, mes_referencia)
    base_inss = salario + valor_he
    inss = calcular_inss(base_inss, parametros["inss_faixas"])
    descontos.append({"descricao": "INSS", "referencia": f"tabela {mes_referencia[:4]}", "valor": _q2(inss)})
    memoria.append(f"INSS: tabela progressiva ({mes_referencia}) sobre R${_q2(base_inss)} = R${_q2(inss)}")

    dependentes = int(getattr(funcionario, "numero_dependentes", 0) or 0)
    ir = calcular_irrf_mensal(base_inss, inss, dependentes, parametros, calcular_irrf)
    metodo = "desconto simplificado" if ir["usa_simplificado"] else f"INSS + {dependentes} dependente(s)"
    memoria.append(f"IRRF: rendimento R${_q2(base_inss)} − dedução R${ir['deducao']} ({metodo}) = base R${ir['base']}; "
                   f"tabela R${ir['imposto_tabela']}" + (f" − redução R${ir['reducao']}" if ir["reducao"] > 0 else "")
                   + f" = R${ir['imposto']}")
    if ir["imposto"] > 0:
        descontos.append({"descricao": "IRRF", "referencia": "tabela progressiva", "valor": _q2(ir["imposto"])})

    if horas_atraso > 0:
        desc_atraso = horas_atraso * valor_hora
        descontos.append({"descricao": "Atrasos / faltas", "referencia": f"{float(horas_atraso):.2f}h", "valor": _q2(desc_atraso)})
        memoria.append(f"Atrasos: {float(horas_atraso):.2f}h × R${_q2(valor_hora)} = R${_q2(desc_atraso)}")

    pct_vt = _D(config_folha.desconto_vt_percentual)
    if tem_vt and pct_vt > 0:
        # Teto legal: o desconto não passa do valor do próprio vale-transporte concedido.
        desc_vt = min(salario * pct_vt / Decimal(100), valor_vt) if valor_vt > 0 else salario * pct_vt / Decimal(100)
        descontos.append({"descricao": f"Vale-transporte ({int(pct_vt)}%)", "referencia": "sobre salário, limitado ao VT", "valor": _q2(desc_vt)})
        memoria.append(f"Desconto VT: menor entre {int(pct_vt)}% × R${_q2(salario)} e o VT concedido (R${_q2(valor_vt)}) = R${_q2(desc_vt)}")

    total_venc = sum(_D(v["valor"]) for v in vencimentos)
    total_desc = sum(_D(d["valor"]) for d in descontos)
    liquido = total_venc - total_desc

    fgts = base_inss * _D(config_folha.fgts_percentual) / Decimal(100)

    return {
        "funcionario_id": funcionario.id,
        "nome": funcionario.nome,
        "cargo": funcionario.cargo,
        "cpf": funcionario.cpf,
        "data_admissao": funcionario.data_admissao.isoformat() if funcionario.data_admissao else None,
        "mes_referencia": mes_referencia,
        "salario_base": _q2(salario),
        "horas_extras_horas": float(horas_extras),
        "atrasos_horas": float(horas_atraso),
        "vencimentos": vencimentos,
        "descontos": descontos,
        "totais": {
            "vencimentos": _q2(total_venc),
            "descontos": _q2(total_desc),
            "liquido": _q2(liquido),
            "base_inss": _q2(base_inss),
            "fgts_mes": _q2(fgts),
        },
        "memoria_calculo": memoria,
    }


# ---------------------------------------------------------------------------
# RESCISÃO (verbas rescisórias CLT) e PROVISÕES (custo real)
# ---------------------------------------------------------------------------

TIPOS_RESCISAO = ("PEDIDO", "S_JUSTA", "C_JUSTA", "ACORDO")
TERCO = Decimal(1) / Decimal(3)  # 1/3 constitucional de férias


def _avos(inicio: date, fim: date) -> int:
    """Conta 'avos': meses no intervalo [inicio, fim] com >= 15 dias (regra CLT
    de 13º/férias proporcionais)."""
    if not inicio or not fim or fim < inicio:
        return 0
    avos = 0
    y, m = inicio.year, inicio.month
    while (y, m) <= (fim.year, fim.month):
        primeiro = date(y, m, 1)
        ultimo = date(y, m, calendar.monthrange(y, m)[1])
        ini = max(inicio, primeiro)
        fi = min(fim, ultimo)
        if (fi - ini).days + 1 >= 15:
            avos += 1
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return avos


def _ultimo_aniversario(admissao: date, referencia: date) -> date:
    """Início do período aquisitivo de férias vigente: aniversário de admissão
    mais recente <= referência."""
    ano = referencia.year
    try:
        aniv = admissao.replace(year=ano)
    except ValueError:  # 29/02 em ano não bissexto
        aniv = admissao.replace(year=ano, day=28)
    if aniv > referencia:
        try:
            aniv = admissao.replace(year=ano - 1)
        except ValueError:
            aniv = admissao.replace(year=ano - 1, day=28)
    return max(aniv, admissao)


def calcular_rescisao(funcionario, data_demissao: date, tipo_rescisao: str,
                      saldo_fgts=None, ferias_vencidas_dias: int = 0, config_folha=None,
                      aviso_cumprido: bool = False, descontos_adicionais=0.0) -> dict:
    """
    Calcula as verbas rescisórias (CLT) completas (proventos + descontos legais de INSS/aviso/adiantamento).

    tipo_rescisao ∈ {PEDIDO, S_JUSTA (dispensa sem justa causa),
    C_JUSTA (com justa causa), ACORDO (distrato 484-A)}.
    """
    tipo = (tipo_rescisao or "").upper()
    if tipo not in TIPOS_RESCISAO:
        raise ValueError(f"tipo_rescisao inválido. Use um de: {', '.join(TIPOS_RESCISAO)}")

    if config_folha is None:
        config_folha = obter_config_folha(funcionario.estabelecimento_id)
    parametros = parametros_folha(config_folha, data_demissao.strftime("%Y-%m"))
    fgts_pct = _D(config_folha.fgts_percentual) / Decimal(100)
    multa_dispensa = _D(config_folha.multa_fgts_dispensa) / Decimal(100)
    multa_acordo = _D(config_folha.multa_fgts_acordo) / Decimal(100)

    salario = Decimal(str(funcionario.salario_base or 0))
    admissao = funcionario.data_admissao
    if not admissao:
        raise ValueError("Funcionário sem data de admissão — impossível calcular rescisão")
    if data_demissao < admissao:
        raise ValueError("Data de demissão anterior à admissão")

    salario_dia = salario / Decimal(30)
    anos_completos = (data_demissao - admissao).days // 365

    # Aviso prévio: 30 dias + 3/ano trabalhado, teto de 90 dias (Lei 12.506/2011)
    dias_aviso = min(30 + 3 * anos_completos, 90)

    # Avos de 13º (ano da demissão) e de férias (período aquisitivo vigente)
    inicio_13 = max(admissao, date(data_demissao.year, 1, 1))
    avos_13 = min(_avos(inicio_13, data_demissao), 12)
    avos_ferias = min(_avos(_ultimo_aniversario(admissao, data_demissao), data_demissao), 12)

    # Saldo FGTS: se não informado, estima 8% do salário por mês trabalhado
    meses_totais = _avos(admissao, data_demissao)
    if saldo_fgts is None:
        saldo_fgts = salario * fgts_pct * Decimal(meses_totais)
        fgts_estimado = True
    else:
        saldo_fgts = Decimal(str(saldo_fgts))
        fgts_estimado = False

    proventos = []
    descontos = []
    memoria = []

    # 1) Saldo de salário — todas as modalidades
    saldo_salario = salario_dia * Decimal(data_demissao.day)
    proventos.append({"codigo": "SALDO_SALARIO", "descricao": "Saldo de salário",
                      "referencia": f"{data_demissao.day} dia(s)", "valor": _q2(saldo_salario)})
    memoria.append(f"Saldo de salário: (R${_q2(salario)}/30) × {data_demissao.day} dia(s) = R${_q2(saldo_salario)}")

    inclui_prop = tipo in ("PEDIDO", "S_JUSTA", "ACORDO")   # 13º e férias proporcionais
    inclui_aviso = tipo in ("S_JUSTA", "ACORDO")
    inclui_multa = tipo in ("S_JUSTA", "ACORDO")

    # 2) Aviso prévio indenizado (integral na dispensa; metade no acordo)
    if inclui_aviso and not aviso_cumprido:
        fator = Decimal("0.5") if tipo == "ACORDO" else Decimal(1)
        valor_aviso = salario_dia * Decimal(dias_aviso) * fator
        rotulo = "Aviso prévio indenizado" + (" (50% - acordo)" if tipo == "ACORDO" else "")
        proventos.append({"codigo": "AVISO_PREVIO", "descricao": rotulo,
                          "referencia": f"{dias_aviso} dia(s)", "valor": _q2(valor_aviso)})
        memoria.append(f"{rotulo}: (R${_q2(salario)}/30) × {dias_aviso} × {fator} = R${_q2(valor_aviso)}")

    # 3) 13º proporcional
    valor_13 = Decimal("0.00")
    if inclui_prop and avos_13 > 0:
        valor_13 = (salario / Decimal(12)) * Decimal(avos_13)
        proventos.append({"codigo": "DECIMO_TERCEIRO_PROP", "descricao": "13º salário proporcional",
                          "referencia": f"{avos_13}/12", "valor": _q2(valor_13)})
        memoria.append(f"13º proporcional: (R${_q2(salario)}/12) × {avos_13} avos = R${_q2(valor_13)}")

    # 4) Férias proporcionais + 1/3
    if inclui_prop and avos_ferias > 0:
        ferias_prop = (salario / Decimal(12)) * Decimal(avos_ferias)
        terco_prop = ferias_prop * TERCO
        proventos.append({"codigo": "FERIAS_PROP", "descricao": "Férias proporcionais",
                          "referencia": f"{avos_ferias}/12", "valor": _q2(ferias_prop)})
        proventos.append({"codigo": "TERCO_FERIAS_PROP", "descricao": "1/3 sobre férias proporcionais",
                          "referencia": "1/3", "valor": _q2(terco_prop)})
        memoria.append(f"Férias proporcionais: (R${_q2(salario)}/12) × {avos_ferias} avos = R${_q2(ferias_prop)} (+1/3 = R${_q2(terco_prop)})")

    # 5) Férias vencidas + 1/3 (todas as modalidades, inclusive justa causa)
    if ferias_vencidas_dias and ferias_vencidas_dias > 0:
        ferias_venc = salario_dia * Decimal(ferias_vencidas_dias)
        terco_venc = ferias_venc * TERCO
        proventos.append({"codigo": "FERIAS_VENCIDAS", "descricao": "Férias vencidas",
                          "referencia": f"{ferias_vencidas_dias} dia(s)", "valor": _q2(ferias_venc)})
        proventos.append({"codigo": "TERCO_FERIAS_VENCIDAS", "descricao": "1/3 sobre férias vencidas",
                          "referencia": "1/3", "valor": _q2(terco_venc)})
        memoria.append(f"Férias vencidas: (R${_q2(salario)}/30) × {ferias_vencidas_dias} = R${_q2(ferias_venc)} (+1/3 = R${_q2(terco_venc)})")

    # 6) Multa FGTS (percentuais configuráveis: dispensa vs acordo)
    if inclui_multa:
        pct = multa_acordo if tipo == "ACORDO" else multa_dispensa
        multa = saldo_fgts * pct
        proventos.append({"codigo": "MULTA_FGTS", "descricao": f"Multa FGTS ({int(pct*100)}%)",
                          "referencia": f"sobre R${_q2(saldo_fgts)}", "valor": _q2(multa)})
        origem = "estimado" if fgts_estimado else "informado"
        memoria.append(f"Multa FGTS: {int(pct*100)}% × saldo FGTS {origem} R${_q2(saldo_fgts)} = R${_q2(multa)}")

    # ─── DESCONTOS LEGAIS E RETENÇÕES (CLT) ─────────────────────────────────

    # A) INSS sobre Saldo de Salário
    inss_saldo = calcular_inss(saldo_salario, parametros["inss_faixas"])
    if inss_saldo > Decimal("0.00"):
        descontos.append({"codigo": "INSS_SALARIO", "descricao": "INSS sobre saldo de salário",
                          "referencia": "Tabela progressiva", "valor": _q2(inss_saldo)})
        memoria.append(f"Desconto INSS saldo de salário: R${_q2(inss_saldo)}")

    # B) INSS sobre 13º Salário
    if valor_13 > Decimal("0.00"):
        inss_13 = calcular_inss(valor_13, parametros["inss_faixas"])
        if inss_13 > Decimal("0.00"):
            descontos.append({"codigo": "INSS_DECIMO_TERCEIRO", "descricao": "INSS sobre 13º salário",
                              "referencia": "Tabela progressiva", "valor": _q2(inss_13)})
            memoria.append(f"Desconto INSS sobre 13º salário: R${_q2(inss_13)}")

    # C) Desconto de Aviso Prévio não cumprido no Pedido de Demissão
    if tipo == "PEDIDO" and not aviso_cumprido:
        valor_desc_aviso = salario
        descontos.append({"codigo": "DESCONTO_AVISO_PREVIO", "descricao": "Desconto de aviso prévio não cumprido",
                          "referencia": "30 dias", "valor": _q2(valor_desc_aviso)})
        memoria.append(f"Desconto de aviso prévio não cumprido: R${_q2(valor_desc_aviso)}")

    # D) Descontos adicionais / Adiantamentos informados
    desc_add_dec = _D(descontos_adicionais)
    if desc_add_dec > Decimal("0.00"):
        descontos.append({"codigo": "DESCONTOS_DIVERSOS", "descricao": "Adiantamentos / Outros descontos",
                          "referencia": "Informado", "valor": _q2(desc_add_dec)})
        memoria.append(f"Descontos adicionais/adiantamentos: R${_q2(desc_add_dec)}")

    total_proventos = sum(Decimal(str(p["valor"])) for p in proventos)
    total_descontos = sum(Decimal(str(d["valor"])) for d in descontos)
    total_liquido = max(Decimal("0.00"), total_proventos - total_descontos)

    aviso_legal = ("Cálculo detalhado de verbas rescisórias e descontos legais (CLT/INSS). "
                   "NÃO substitui a gravação final do TRCT oficial no sistema contábil.")
    if fgts_estimado:
        aviso_legal += (" O saldo de FGTS foi ESTIMADO (8% do salário por mês trabalhado); "
                        "informe o saldo real para precisão da multa.")

    return {
        "tipo_rescisao": tipo,
        "data_admissao": admissao.isoformat(),
        "data_demissao": data_demissao.isoformat(),
        "anos_completos": anos_completos,
        "salario_base": _q2(salario),
        "saldo_fgts": _q2(saldo_fgts),
        "saldo_fgts_estimado": fgts_estimado,
        "proventos": proventos,
        "descontos": descontos,
        "total_proventos": _q2(total_proventos),
        "total_descontos": _q2(total_descontos),
        "total_liquido_estimado": _q2(total_liquido),
        "memoria_calculo": memoria,
        "aviso_legal": aviso_legal,
    }


def calcular_retrospectiva(funcionario, data_inicio: date, data_fim: date) -> dict:
    """
    'Retrospectiva' (estilo Spotify Wrapped) do funcionário no período, com
    dados 100% REAIS do sistema:
      - horas trabalhadas / hora extra / dias / atrasos (engine do espelho)
      - vendas realizadas, faturamento, ticket médio, clientes atendidos
      - produtos passados (itens de venda) e mercadorias conferidas (entradas)
    Cada métrica só aparece se houver dado real; nada é inventado.
    """
    import re
    from sqlalchemy import func as sqlfunc, and_, case
    from app.models import db, Venda, VendaItem, MovimentacaoEstoque, Motorista, Entrega, EntregaItem

    # --- Ponto (reaproveita a engine única) ---
    espelho = calcular_espelho_ponto(funcionario, data_inicio, data_fim)
    resumo_ponto = espelho["resumo"]

    escopo_venda = and_(
        Venda.funcionario_id == funcionario.id,
        Venda.status == "finalizada",
        sqlfunc.date(Venda.data_venda) >= data_inicio,
        sqlfunc.date(Venda.data_venda) <= data_fim,
    )

    # --- Vendas / faturamento / clientes ---
    total_vendas, faturamento = db.session.query(
        sqlfunc.count(Venda.id), sqlfunc.coalesce(sqlfunc.sum(Venda.total), 0)
    ).filter(escopo_venda).first()
    total_vendas = int(total_vendas or 0)
    faturamento = float(faturamento or 0)
    ticket_medio = round(faturamento / total_vendas, 2) if total_vendas else 0.0

    clientes_atendidos = (db.session.query(sqlfunc.count(sqlfunc.distinct(Venda.cliente_id)))
                          .filter(escopo_venda, Venda.cliente_id.isnot(None)).scalar()) or 0

    # --- Produtos passados (soma de itens das vendas do funcionário) ---
    produtos_passados = (db.session.query(sqlfunc.coalesce(sqlfunc.sum(VendaItem.quantidade), 0))
                         .join(Venda, VendaItem.venda_id == Venda.id)
                         .filter(escopo_venda).scalar()) or 0

    # --- Mercadorias conferidas (entradas de estoque registradas pelo funcionário) ---
    mercadorias_conferidas, itens_conferidos = db.session.query(
        sqlfunc.count(MovimentacaoEstoque.id),
        sqlfunc.coalesce(sqlfunc.sum(MovimentacaoEstoque.quantidade), 0),
    ).filter(
        MovimentacaoEstoque.funcionario_id == funcionario.id,
        MovimentacaoEstoque.tipo.in_(["entrada", "ENTRADA", "compra", "recebimento"]),
        sqlfunc.date(MovimentacaoEstoque.created_at) >= data_inicio,
        sqlfunc.date(MovimentacaoEstoque.created_at) <= data_fim,
    ).first()

    # --- Entregas (motoboy/entregador): vincula Funcionário → Motorista por CPF ---
    entregas_realizadas = 0
    km_percorridos = 0.0
    clientes_entrega = 0
    bairros_visitados = 0
    produtos_transportados = 0
    cpf_digits = re.sub(r"\D", "", funcionario.cpf or "")
    motorista = None
    if cpf_digits:
        for m in Motorista.query.filter_by(estabelecimento_id=funcionario.estabelecimento_id).all():
            if re.sub(r"\D", "", m.cpf or "") == cpf_digits:
                motorista = m
                break
    if motorista:
        data_ref = sqlfunc.coalesce(Entrega.data_entrega, Entrega.data_saida, Entrega.created_at)
        escopo_entrega = and_(
            Entrega.motorista_id == motorista.id,
            Entrega.status.notin_(["cancelada", "cancelado"]),
            sqlfunc.date(data_ref) >= data_inicio,
            sqlfunc.date(data_ref) <= data_fim,
        )
        # km: usa km_percorridos quando registrado (>0), senão a distância da entrega
        km_expr = sqlfunc.sum(case((Entrega.km_percorridos > 0, Entrega.km_percorridos), else_=Entrega.distancia_km))
        entregas_realizadas, km_percorridos = db.session.query(
            sqlfunc.count(Entrega.id), sqlfunc.coalesce(km_expr, 0)
        ).filter(escopo_entrega).first()
        entregas_realizadas = int(entregas_realizadas or 0)
        km_percorridos = round(float(km_percorridos or 0), 1)
        clientes_entrega = int((db.session.query(sqlfunc.count(sqlfunc.distinct(Entrega.cliente_id)))
                                .filter(escopo_entrega, Entrega.cliente_id.isnot(None)).scalar()) or 0)
        bairros_visitados = int((db.session.query(sqlfunc.count(sqlfunc.distinct(Entrega.endereco_bairro)))
                                 .filter(escopo_entrega, Entrega.endereco_bairro.isnot(None)).scalar()) or 0)
        produtos_transportados = int(round(float((db.session.query(sqlfunc.coalesce(sqlfunc.sum(EntregaItem.quantidade), 0))
                                                  .join(Entrega, EntregaItem.entrega_id == Entrega.id)
                                                  .filter(escopo_entrega).scalar()) or 0)))

    horas_trab = resumo_ponto["total_horas_trabalhadas"]
    horas_extras = resumo_ponto["total_horas_extras"]
    dias = resumo_ponto["total_dias_trabalhados"]

    # --- Persona: pelo que a pessoa mais FEZ (contagem de atividades, não horas,
    # para não deixar a jornada dominar sempre). Horas é só fallback. ---
    candidatos_atividade = [
        ("🛒 Mestre do Caixa", total_vendas),
        ("🛵 Rei da Estrada", entregas_realizadas),
        ("📦 Guardião do Estoque", int(mercadorias_conferidas or 0)),
        ("🗺️ Desbravador de Bairros", bairros_visitados),
        ("🤝 Encantador de Clientes", int(clientes_atendidos or 0) + clientes_entrega),
    ]
    melhor = max(candidatos_atividade, key=lambda x: x[1])
    if melhor[1] > 0:
        persona = melhor[0]
    elif horas_trab > 0:
        persona = "⏱️ Maratonista da Jornada"
    else:
        persona = "🌟 Estrela em Ascensão"

    return {
        "funcionario_id": funcionario.id,
        "nome": funcionario.nome,
        "cargo": funcionario.cargo,
        "periodo": {"inicio": data_inicio.isoformat(), "fim": data_fim.isoformat()},
        "persona": persona,
        "ponto": {
            "horas_trabalhadas": horas_trab,
            "horas_extras": horas_extras,
            "dias_trabalhados": dias,
            "total_atrasos": resumo_ponto["total_atrasos"],
        },
        "vendas": {
            "total_vendas": total_vendas,
            "faturamento": round(faturamento, 2),
            "ticket_medio": ticket_medio,
            "clientes_atendidos": int(clientes_atendidos or 0),
            "produtos_passados": int(round(float(produtos_passados or 0))),
        },
        "estoque": {
            "mercadorias_conferidas": int(mercadorias_conferidas or 0),
            "itens_conferidos": int(round(float(itens_conferidos or 0))),
        },
        "entrega": {
            "entregas_realizadas": entregas_realizadas,
            "km_percorridos": km_percorridos,
            "clientes_atendidos": clientes_entrega,
            "bairros_visitados": bairros_visitados,
            "produtos_transportados": produtos_transportados,
        },
    }


def calcular_provisoes(funcionario, ano_mes: str, regime_tributario: str = None, config_folha=None) -> dict:
    """
    Provisão mensal (1/12 avos) de férias (+1/3), 13º e encargos de FGTS,
    revelando o CUSTO REAL do funcionário além do salário nominal.
    O % de FGTS vem da ConfiguracaoFolha (nada hardcoded).

    Nota: INSS patronal (~20%) não entra por padrão — no Simples Nacional é
    recolhido via DAS. Ajuste conforme o regime tributário da loja.
    """
    if config_folha is None:
        config_folha = obter_config_folha(funcionario.estabelecimento_id)
    fgts_pct = _D(config_folha.fgts_percentual) / Decimal(100)

    salario = Decimal(str(funcionario.salario_base or 0))

    provisao_ferias = (salario * (Decimal(1) + TERCO)) / Decimal(12)  # férias + 1/3, em 12 avos
    provisao_13 = salario / Decimal(12)
    fgts_salario = salario * fgts_pct
    fgts_provisoes = (provisao_ferias + provisao_13) * fgts_pct
    encargos = fgts_salario + fgts_provisoes
    custo_real = salario + provisao_ferias + provisao_13 + encargos

    return {
        "funcionario_id": funcionario.id,
        "funcionario_nome": funcionario.nome,
        "cargo": funcionario.cargo,
        "ano_mes": ano_mes,
        "salario_base": _q2(salario),
        "valor_ferias": _q2(provisao_ferias),
        "valor_decimo_terceiro": _q2(provisao_13),
        "encargos_provisionados": _q2(encargos),
        "custo_real": _q2(custo_real),
        "memoria_calculo": [
            f"Provisão de férias (com 1/3): R${_q2(salario)} × (1 + 1/3) / 12 = R${_q2(provisao_ferias)}",
            f"Provisão de 13º: R${_q2(salario)} / 12 = R${_q2(provisao_13)}",
            f"FGTS sobre salário: 8% × R${_q2(salario)} = R${_q2(fgts_salario)}",
            f"FGTS sobre provisões: 8% × (férias + 13º) = R${_q2(fgts_provisoes)}",
            f"Custo real mensal: salário + provisões + encargos = R${_q2(custo_real)}",
        ],
        "aviso_legal": ("Encargos consideram apenas FGTS (8%). INSS patronal e outros "
                        "tributos variam conforme o regime tributário da loja "
                        f"(atual: {regime_tributario or 'não informado'})."),
    }

def _fracao_de_meses(inicio: date, fim: date) -> float:
    """Fração de meses corridos no intervalo [inicio, fim], mês a mês
    (dias de overlap / dias reais do mês). Substitui o antigo `dias/30`,
    que superestimava a folha em ~3,3% em meses de 31 dias e a
    subestimava em fevereiro."""
    if not inicio or not fim or fim < inicio:
        return 0.0
    total = 0.0
    y, m = inicio.year, inicio.month
    while (y, m) <= (fim.year, fim.month):
        dias_mes = calendar.monthrange(y, m)[1]
        primeiro = date(y, m, 1)
        ultimo = date(y, m, dias_mes)
        overlap = (min(fim, ultimo) - max(inicio, primeiro)).days + 1
        if overlap > 0:
            total += overlap / dias_mes
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return total


def _minutos_ponto_por_dia(estabelecimento_id, funcionario_ids, dt_inicio, dt_fim, jornada_min):
    """UMA query de RegistroPonto do período inteiro, processada com a MESMA
    regra do espelho (pareamento entrada/saída por dia): retorna
    {(funcionario_id, data): {"extras": int, "atraso": int}} em minutos.
    Permite incluir horas extras e atrasos no custo agregado da folha sem
    N+1 (antes o custo agregado simplesmente IGNORAVA extras/atrasos)."""
    from app.models import RegistroPonto

    if not funcionario_ids:
        return {}

    registros = (RegistroPonto.query
                 .filter(RegistroPonto.funcionario_id.in_(funcionario_ids),
                         RegistroPonto.data >= dt_inicio,
                         RegistroPonto.data <= dt_fim)
                 .order_by(RegistroPonto.data, RegistroPonto.hora)
                 .all())

    por_dia = defaultdict(list)
    for r in registros:
        por_dia[(r.funcionario_id, r.data)].append(r)

    resultado = {}
    for chave, regs in por_dia.items():
        entrada = saida = ii = iff = None
        atraso = 0
        for r in regs:
            if r.tipo_registro == "entrada":
                entrada = r.hora
                atraso += r.minutos_atraso or 0
            elif r.tipo_registro == "saida_almoco":
                ii = r.hora
                atraso += r.minutos_atraso or 0
            elif r.tipo_registro == "retorno_almoco":
                iff = r.hora
                atraso += r.minutos_atraso or 0
            elif r.tipo_registro == "saida":
                saida = r.hora
        extras = 0
        if entrada and saida:
            trabalhado = (datetime.combine(date.min, saida) - datetime.combine(date.min, entrada)).total_seconds() / 60
            if ii and iff:
                trabalhado -= (datetime.combine(date.min, iff) - datetime.combine(date.min, ii)).total_seconds() / 60
            extras = max(0, int(trabalhado - jornada_min))
        resultado[chave] = {"extras": extras, "atraso": atraso}
    return resultado


def calcular_custo_folha_periodos(estabelecimento_id, periodos, incluir_ponto=True):
    """Custo real da folha para VÁRIAS janelas de uma vez (batch).

    Carrega funcionários, ConfiguracaoFolha, benefícios, rescisões e ponto UMA
    única vez para o range total e fatia por janela em Python. Substitui as 11
    chamadas independentes que as estatísticas de despesas faziam (cada uma com
    1 query de ConfiguracaoFolha POR funcionário) — a principal causa de
    lentidão da página de Despesas.

    periodos: lista de tuplas (dt_inicio: date, dt_fim: date).
    Retorna lista de dicts no mesmo formato de calcular_custo_folha_detalhado,
    na mesma ordem dos períodos.
    """
    from app.models import db, Funcionario, Rescisao, FuncionarioBeneficio, ConfiguracaoHorario
    from sqlalchemy import func, or_

    def _as_date(v):
        return v.date() if isinstance(v, datetime) else v

    periodos = [(_as_date(i), _as_date(f)) for i, f in periodos]
    validos = [(i, f) for i, f in periodos if i and f and f >= i]
    vazio = {"custo_folha": {"total_salarios": 0.0, "total_beneficios": 0.0, "total_provisoes": 0.0,
                             "total_encargos": 0.0, "total_rescisoes": 0.0, "total_horas_extras": 0.0,
                             "total_descontos_atraso": 0.0, "custo_real_total": 0.0,
                             "total_funcionarios_ativos": 0, "total_funcionarios_demitidos_periodo": 0},
             "funcionarios": []}
    if not validos:
        return [dict(vazio) for _ in periodos]

    range_inicio = min(i for i, _ in validos)
    range_fim = max(f for _, f in validos)

    # ── Cargas únicas para o range inteiro ─────────────────────────────────
    query_func = db.session.query(Funcionario).filter(
        Funcionario.data_admissao <= range_fim,
        or_(Funcionario.data_demissao == None, Funcionario.data_demissao >= range_inicio)
    )
    if str(estabelecimento_id).lower() != 'all':
        query_func = query_func.filter(Funcionario.estabelecimento_id == estabelecimento_id)
    funcionarios = query_func.all()

    config_folha = None
    jornada_min = JORNADA_PADRAO_MIN
    if funcionarios and str(estabelecimento_id).lower() != 'all':
        config_folha = obter_config_folha(estabelecimento_id)
        cfg_horario = ConfiguracaoHorario.query.filter_by(estabelecimento_id=estabelecimento_id).first()
        if cfg_horario and cfg_horario.jornada_diaria_minutos:
            jornada_min = cfg_horario.jornada_diaria_minutos

    query_ben = db.session.query(
        FuncionarioBeneficio.funcionario_id,
        func.sum(FuncionarioBeneficio.valor)
    ).filter(FuncionarioBeneficio.ativo == True,
             FuncionarioBeneficio.funcionario_id.in_([f.id for f in funcionarios]) if funcionarios else False
             ).group_by(FuncionarioBeneficio.funcionario_id)
    beneficios_map = dict(query_ben.all()) if funcionarios else {}

    query_resc = db.session.query(Rescisao.data_demissao, Rescisao.total_liquido).filter(
        Rescisao.data_demissao >= range_inicio,
        Rescisao.data_demissao <= range_fim
    )
    if str(estabelecimento_id).lower() != 'all':
        query_resc = query_resc.filter(Rescisao.estabelecimento_id == estabelecimento_id)
    rescisoes = query_resc.all()

    # Ponto (extras/atrasos) do range inteiro — 1 query. Ranges muito longos
    # (> ~14 meses) pulam o ponto para não carregar dezenas de milhares de
    # batidas; nesses casos o custo fica no accrual puro (comportamento antigo).
    ponto_por_dia = {}
    if incluir_ponto and funcionarios and (range_fim - range_inicio).days <= 430:
        try:
            ponto_por_dia = _minutos_ponto_por_dia(
                estabelecimento_id, [f.id for f in funcionarios], range_inicio, range_fim, jornada_min
            )
        except Exception:
            ponto_por_dia = {}

    # Pré-cálculo por funcionário (custo mensal e valor-hora) — 0 queries
    dados_func = []
    divisor = Decimal(getattr(config_folha, "divisor_horas_mensais", None) or 220)
    pct_he = _D(getattr(config_folha, "percentual_hora_extra", None) or 50)
    for f in funcionarios:
        prov = calcular_provisoes(f, range_fim.strftime("%Y-%m"), config_folha=config_folha) if config_folha \
            else calcular_provisoes(f, range_fim.strftime("%Y-%m"))
        salario = float(prov.get("salario_base", 0))
        valor_hora = (Decimal(str(salario)) / divisor) if divisor else Decimal(0)
        dados_func.append({
            "f": f,
            "salario": salario,
            "provisoes": float(prov.get("valor_ferias", 0)) + float(prov.get("valor_decimo_terceiro", 0)),
            "encargos": float(prov.get("encargos_provisionados", 0)),
            "beneficio": float(beneficios_map.get(f.id, 0.0)),
            "valor_hora": float(valor_hora),
            "valor_hora_extra": float(valor_hora * (Decimal(1) + pct_he / Decimal(100))),
            "admissao": _as_date(f.data_admissao),
            "demissao": _as_date(f.data_demissao),
        })

    # ── Fatiamento por janela ──────────────────────────────────────────────
    resultados = []
    for dt_inicio, dt_fim in periodos:
        if not dt_inicio or not dt_fim or dt_fim < dt_inicio:
            resultados.append(dict(vazio))
            continue

        total_salarios = total_provisoes = total_encargos = total_beneficios = 0.0
        total_he_valor = total_atraso_valor = 0.0
        lista_funcs = []
        ativos = demitidos = 0

        for d in dados_func:
            adm, dem = d["admissao"], d["demissao"]
            if adm and adm > dt_fim:
                continue
            if dem and dem < dt_inicio:
                continue
            inicio_trab = max(dt_inicio, adm) if adm else dt_inicio
            fim_trab = min(dt_fim, dem) if dem else dt_fim
            if fim_trab < inicio_trab:
                continue

            prop = _fracao_de_meses(inicio_trab, fim_trab)
            custo_mensal = d["salario"] + d["provisoes"] + d["encargos"] + d["beneficio"]

            # Extras e atrasos REAIS do ponto na janela (regra do holerite)
            min_extras = min_atraso = 0
            if ponto_por_dia:
                fid = d["f"].id
                dia = inicio_trab
                while dia <= fim_trab:
                    p = ponto_por_dia.get((fid, dia))
                    if p:
                        min_extras += p["extras"]
                        min_atraso += p["atraso"]
                    dia += timedelta(days=1)
            he_valor = (min_extras / 60.0) * d["valor_hora_extra"]
            atraso_valor = (min_atraso / 60.0) * d["valor_hora"]

            total_salarios += d["salario"] * prop
            total_provisoes += d["provisoes"] * prop
            total_encargos += d["encargos"] * prop
            total_beneficios += d["beneficio"] * prop
            total_he_valor += he_valor
            total_atraso_valor += atraso_valor

            if dem:
                demitidos += 1
            else:
                ativos += 1
            lista_funcs.append({
                "id": d["f"].id,
                "nome": d["f"].nome,
                "cargo": d["f"].cargo,
                "dias_trabalhados": (fim_trab - inicio_trab).days + 1,
                "custo_real_proporcional": round(custo_mensal * prop + he_valor - atraso_valor, 2),
            })

        total_rescisao = float(sum(
            float(v or 0) for dd, v in rescisoes if dd and dt_inicio <= _as_date(dd) <= dt_fim
        ))

        custo_total = (total_salarios + total_provisoes + total_encargos + total_beneficios
                       + total_he_valor - total_atraso_valor + total_rescisao)

        resultados.append({
            "custo_folha": {
                "total_salarios": round(total_salarios, 2),
                "total_beneficios": round(total_beneficios, 2),
                "total_provisoes": round(total_provisoes, 2),
                "total_encargos": round(total_encargos, 2),
                "total_rescisoes": round(total_rescisao, 2),
                "total_horas_extras": round(total_he_valor, 2),
                "total_descontos_atraso": round(total_atraso_valor, 2),
                "custo_real_total": round(custo_total, 2),
                "total_funcionarios_ativos": ativos,
                "total_funcionarios_demitidos_periodo": demitidos,
            },
            "funcionarios": lista_funcs,
        })

    return resultados


def calcular_custo_folha_detalhado(estabelecimento_id, dt_inicio, dt_fim):
    """Custo real da folha no período (salários + provisões + encargos +
    benefícios + horas extras − atrasos + rescisões). Wrapper de janela única
    sobre a versão batched — mesma matemática em todos os consumidores."""
    return calcular_custo_folha_periodos(estabelecimento_id, [(dt_inicio, dt_fim)])[0]
