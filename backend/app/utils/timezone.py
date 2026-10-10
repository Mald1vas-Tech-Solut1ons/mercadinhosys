"""
Utilitário de timezone para EXIBIÇÃO.

O banco grava tudo em UTC "naive" (datetime.utcnow). Para o usuário, datas e
horas precisam aparecer no fuso local da loja. O Brasil (São Paulo) é UTC-3
fixo desde 2019 (fim do horário de verão), então usamos um offset fixo — sem
depender de `tzdata`/`zoneinfo` (que falta no Windows) e sem lógica de DST.

Configurável por env APP_UTC_OFFSET_HOURS (ex.: -4 para Manaus).
"""
import os
from datetime import datetime, timezone, timedelta

_OFFSET_HORAS = int(os.getenv("APP_UTC_OFFSET_HOURS", "-3"))
LOCAL_TZ = timezone(timedelta(hours=_OFFSET_HORAS))


def to_local(dt):
    """Converte um datetime UTC (naive ou aware) para o fuso local (aware)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LOCAL_TZ)


def fmt_local(dt, fmt="%d/%m/%Y %H:%M"):
    """Formata um datetime UTC no fuso local. Retorna '' se None."""
    loc = to_local(dt)
    return loc.strftime(fmt) if loc else ""


def iso_local(dt):
    """ISO 8601 já no fuso local, COM offset (ex.: 2026-07-03T14:30:00-03:00).
    Assim o navegador (new Date(...)) exibe a hora local correta."""
    loc = to_local(dt)
    return loc.isoformat() if loc else None


def local_date_to_utc_naive(date_or_str, fim_do_dia=False):
    """
    Converte uma data "do dia" (ex.: filtro de período vindo do frontend como
    'YYYY-MM-DD', que representa a meia-noite LOCAL da loja) para o instante
    UTC naive equivalente — coerente com as colunas do banco (utcnow naive).

    Sem essa conversão, filtros de período (SalesPage, relatórios) comparavam
    "00:00 local" contra a coluna UTC como se fossem a mesma referência,
    deslocando a fronteira do dia em 3h (perdia vendas das 21h-23h59 locais
    do dia anterior / incluía de menos as da madrugada seguinte). Efeito
    invisível em lojas que não vendem de madrugada, mas real e sistemático.

    fim_do_dia=True devolve o instante final (23:59:59.999999 local -> UTC).
    """
    if date_or_str is None:
        return None
    if isinstance(date_or_str, str):
        s = date_or_str.strip().split("T")[0]
        dt_local = datetime.strptime(s, "%Y-%m-%d")
    else:
        dt_local = datetime.combine(date_or_str, datetime.min.time())
    if fim_do_dia:
        dt_local = dt_local.replace(hour=23, minute=59, second=59, microsecond=999999)
    aware_local = dt_local.replace(tzinfo=LOCAL_TZ)
    return aware_local.astimezone(timezone.utc).replace(tzinfo=None)


# Fusos fixos por estado (sem horário de verão desde 2019). Os demais estados usam Brasília (-3).
_OFFSET_POR_UF = {"AC": -5, "AM": -4, "RO": -4, "RR": -4, "MT": -4, "MS": -4}


def fuso_da_uf(uf):
    """Fuso da loja pelo estado: documentos fiscais levam o offset real do emitente."""
    return timezone(timedelta(hours=_OFFSET_POR_UF.get((uf or "").strip().upper(), -3)))


def hoje_local():
    """Data de hoje na loja. O servidor roda em UTC: `date.today()` vira o dia 3h cedo e datava título,
    vencimento e atraso no dia seguinte entre 21h e meia-noite."""
    return to_local(datetime.now(timezone.utc)).date()


def data_local(dt):
    """Dia da loja de um instante (naive é UTC, como o banco grava)."""
    return to_local(dt).date() if dt is not None else None
