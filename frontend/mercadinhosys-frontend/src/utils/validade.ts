/**
 * FASE 1.6 — Parser ÚNICO de data de validade.
 *
 * O backend pode devolver:
 *   - "YYYY-MM-DD"        (serializer puro)
 *   - "YYYY-MM-DDTHH:mm"  (ISO com horário — vem do cupom/offline)
 *   - "DD/MM/YYYY"        (input manual legado / CSV)
 *
 * Nunca devolve NaN: vazio, string mal-formada ou sem year/month/day válido → null.
 */

const PATTERN_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/;
const PATTERN_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function parseDataValidade(input: unknown): Date | null {
    if (input == null) return null;
    const s = String(input).trim();
    if (!s) return null;

    let ano: number, mes: number, dia: number;

    const iso = s.match(PATTERN_ISO);
    if (iso) {
        ano = Number(iso[1]);
        mes = Number(iso[2]);
        dia = Number(iso[3]);
    } else {
        const br = s.match(PATTERN_BR);
        if (!br) return null;
        dia = Number(br[1]);
        mes = Number(br[2]);
        ano = Number(br[3]);
    }

    if (!Number.isFinite(ano) || !Number.isFinite(mes) || !Number.isFinite(dia)) return null;
    if (ano < 1900 || ano > 2100) return null;
    if (mes < 1 || mes > 12) return null;
    if (dia < 1 || dia > 31) return null;

    const d = new Date(ano, mes - 1, dia);
    // new Date(2026, 1, 32) "rola" para Março — checa a coerência
    if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;

    return d;
}

/** Conveniência: true se a validade passou (estritamente < hoje, zerando horas). */
export function estaVencido(input: unknown): boolean {
    const d = parseDataValidade(input);
    if (!d) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return d < hoje;
}

/** Conveniência: dias restantes até a validade (pode ser negativo se vencido). null se sem data. */
export function diasParaVencer(input: unknown): number | null {
    const d = parseDataValidade(input);
    if (!d) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - hoje.getTime()) / 86_400_000);
}
