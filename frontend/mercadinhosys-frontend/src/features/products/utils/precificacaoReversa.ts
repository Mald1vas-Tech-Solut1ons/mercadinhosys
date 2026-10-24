/**
 * Paridade com backend/app/services/precificacao_reversa.py (Fase A).
 * Mesmas fórmulas e validações, em number — uso EXCLUSIVO para pré-visualização
 * na UI: a verdade permanece no servidor, que recalcula com Decimal no salvar.
 * Arredondamento: ROUND_HALF_UP em 2 casas (centavos), como Decimal.quantize.
 */

/** ROUND_HALF_UP em 2 casas: metade exata vai para cima (iguais ao Decimal do backend). */
function centavos(valor: number): number {
    if (!Number.isFinite(valor)) return valor;
    const sinal = valor < 0 ? -1 : 1;
    const abs = Math.abs(valor);
    // Math.round arredonda .5 para cima (metade exata) em absolutos —
    // com sinal aplicado depois, equivale a ROUND_HALF_UP do Decimal.
    return sinal * Math.round((abs + Number.EPSILON) * 100) / 100;
}

/** Converte entrada de formulário (string com vírgula, null) em number | null. */
export function comoNumero(valor: unknown): number | null {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

export interface EntradasMercado {
    precoReferencia: number | null;
    descontoPct: number | null;
    margemAlvoVendaPct: number | null;
}

export interface SaidaMercado {
    venda: number;
    custo: number;
    markup: number;
    erro: string | null;
}

/** venda_pelo_mercado: venda = referência × (1 − desconto/100), quantizada. */
export function vendaPeloMercado(
    precoReferencia: number | null,
    descontoPct: number | null
): { venda: number; erro: string | null } {
    const ref = comoNumero(precoReferencia);
    const desc = comoNumero(descontoPct) ?? 0;
    if (ref === null || ref <= 0) {
        return { venda: 0, erro: 'Preço de referência deve ser maior que zero' };
    }
    if (!Number.isFinite(desc) || desc < 0 || desc >= 100) {
        return { venda: 0, erro: 'Desconto deve estar entre 0% e menos de 100%' };
    }
    return { venda: centavos(ref * (1 - desc / 100)), erro: null };
}

/** custo_pela_venda: custo = venda × (1 − margem_sobre_venda/100), quantizada. */
export function custoPelaVenda(
    precoVenda: number | null,
    margemAlvoVendaPct: number | null
): { custo: number; erro: string | null } {
    const venda = comoNumero(precoVenda);
    const margem = comoNumero(margemAlvoVendaPct);
    if (venda === null || venda <= 0) {
        return { custo: 0, erro: 'Preço de venda deve ser maior que zero' };
    }
    if (margem === null || !Number.isFinite(margem) || margem <= 0 || margem >= 100) {
        return {
            custo: 0,
            erro: 'Margem sobre a venda deve estar entre 0% e 100% (exclusive). Margem de 100% sobre a venda é impossível: não sobraria custo.',
        };
    }
    return { custo: centavos(venda * (1 - margem / 100)), erro: null };
}

/** markup_de: (venda − custo) / custo × 100, 2 casas. */
export function markupDe(
    precoCusto: number | null,
    precoVenda: number | null
): { markup: number; erro: string | null } {
    const custo = comoNumero(precoCusto);
    const venda = comoNumero(precoVenda);
    if (custo === null || custo <= 0) {
        return { markup: 0, erro: 'Preço de custo deve ser maior que zero para calcular o markup' };
    }
    if (venda === null || venda <= 0) {
        return { markup: 0, erro: 'Preço de venda deve ser maior que zero' };
    }
    return { markup: centavos(((venda - custo) / custo) * 100), erro: null };
}

/**
 * Pipeline completo do modo mercado (mesmos passos do servidor):
 * venda_pelo_mercado → custo_pela_venda → markup_de.
 */
export function calcularModoMercado(entradas: EntradasMercado): SaidaMercado {
    const v = vendaPeloMercado(entradas.precoReferencia, entradas.descontoPct);
    if (v.erro) return { venda: 0, custo: 0, markup: 0, erro: v.erro };
    const c = custoPelaVenda(v.venda, entradas.margemAlvoVendaPct);
    if (c.erro) return { venda: v.venda, custo: 0, markup: 0, erro: c.erro };
    const m = markupDe(c.custo, v.venda);
    return { venda: v.venda, custo: c.custo, markup: m.markup, erro: null };
}

/** Pipeline do modo venda: custo_pela_venda → markup_de. */
export function calcularModoVenda(
    precoVenda: number | null,
    margemAlvoVendaPct: number | null
): SaidaMercado {
    const c = custoPelaVenda(precoVenda, margemAlvoVendaPct);
    if (c.erro) return { venda: 0, custo: 0, markup: 0, erro: c.erro };
    const m = markupDe(c.custo, c.custo > 0 ? precoVenda : null);
    return { venda: c.custo > 0 ? (comoNumero(precoVenda) ?? 0) : 0, custo: c.custo, markup: m.markup, erro: null };
}

/** Validações dos pcts globais (Configuração) — espelham configuracao.py:127-142. */
export function validarDescontoMercadoPct(valor: unknown): string | null {
    const n = comoNumero(valor);
    if (n === null || !Number.isFinite(n) || n < 0 || n >= 100) {
        return 'Desconto deve estar entre 0% e menos de 100%';
    }
    return null;
}

export function validarMargemAlvoVendaPct(valor: unknown): string | null {
    const n = comoNumero(valor);
    if (n === null || !Number.isFinite(n) || n <= 0 || n >= 100) {
        return 'Margem sobre a venda deve estar entre 0% e 100% (exclusive); 100% é impossível: não sobraria custo';
    }
    return null;
}