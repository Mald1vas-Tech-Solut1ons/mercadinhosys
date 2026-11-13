/**
 * Estoque de bebida que vende por dose: as garrafas fechadas vêm do estoque normal; a garrafa ABERTA é à parte,
 * em ml (o servidor manda `produto.dose` na lista e no hub do produto).
 */
export interface ResumoAberto {
    vende_por_dose: true;
    volume_embalagem_ml: number | null;
    saldo_aberto_ml: number;
    garrafas_abertas: number;
    garrafas_vencidas: number;
    dose_ml_padrao: number | null;
    doses_na_aberta: number | null;
}

export const TIPOS_RAZAO: Record<string, string> = {
    abertura: 'Garrafa aberta', venda: 'Venda', estorno: 'Estorno de venda', perda: 'Perda', cortesia: 'Cortesia',
    degustacao: 'Degustação', ajuste: 'Ajuste de contagem', descarte: 'Descarte', desvio: 'Terminou antes do previsto',
};

const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

export const mlTexto = (ml: number): string => (ml >= 1000 && ml % 10 === 0 ? `${num(ml / 1000)} L` : `${num(ml)} ml`);

/**
 * Linha de baixo do card de estoque: "1 aberta · 650 ml ≈ 13 doses". Nada quando o produto não tem garrafa aberta
 * nem vencida (a linha só aparece quando há o que dizer).
 */
export function textoDaAberta(dose?: ResumoAberto | null): string | null {
    if (!dose || (dose.garrafas_abertas <= 0 && dose.garrafas_vencidas <= 0)) return null;
    const partes: string[] = [];
    const vendaveis = dose.garrafas_abertas - dose.garrafas_vencidas;
    if (vendaveis > 0) {
        const doses = dose.doses_na_aberta !== null && dose.doses_na_aberta !== undefined ? ` ≈ ${dose.doses_na_aberta} doses` : '';
        partes.push(`${vendaveis} aberta${vendaveis > 1 ? 's' : ''} · ${mlTexto(dose.saldo_aberto_ml)}${doses}`);
    }
    if (dose.garrafas_vencidas > 0) {
        partes.push(`${dose.garrafas_vencidas} vencida${dose.garrafas_vencidas > 1 ? 's' : ''} depois de aberta`);
    }
    return partes.join(' · ');
}

/** "7 fechadas + 1 aberta" para o resumo curto (lista e KPI). */
export function estoqueEmGarrafas(fechadas: number, dose?: ResumoAberto | null): string {
    const f = `${num(fechadas)} fechada${fechadas === 1 ? '' : 's'}`;
    if (!dose || dose.garrafas_abertas <= 0) return f;
    return `${f} + ${dose.garrafas_abertas} aberta${dose.garrafas_abertas > 1 ? 's' : ''}`;
}

/** Dias desde a abertura (0 = hoje), ou null sem data. */
export function diasAberta(abertaEm?: string | null, agora: Date = new Date()): number | null {
    if (!abertaEm) return null;
    const t = new Date(abertaEm.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(abertaEm) ? abertaEm : `${abertaEm}Z`).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}
