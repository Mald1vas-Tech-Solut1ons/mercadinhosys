/**
 * Leitura honesta de um período sem venda.
 *
 * O painel abria em "Hoje" e, num dia em que a loja ainda não vendeu (ou está
 * fechada), devolvia R$ 0,00 em todos os cards — o dono lê isso como "o sistema
 * perdeu meus dados". Estes helpers dizem a verdade: o período não teve venda,
 * e aqui está o último dia que teve.
 */

export interface DiaComVenda {
    /** Dia do calendário da loja, "AAAA-MM-DD". */
    data: string;
    valor: number;
    qtd: number;
}

interface DiaSerie {
    data?: string;
    total?: number;
    valor?: number;
    qtd?: number;
}

/** Último dia, de trás para frente, em que houve venda finalizada na série diária. */
export function ultimoDiaComVenda(serie: DiaSerie[] | null | undefined): DiaComVenda | null {
    if (!Array.isArray(serie)) return null;
    for (let i = serie.length - 1; i >= 0; i -= 1) {
        const dia = serie[i];
        if (!dia || !dia.data) continue;
        const valor = Number(dia.total ?? dia.valor ?? 0);
        const qtd = Number(dia.qtd ?? 0);
        if (valor > 0 || qtd > 0) {
            return { data: String(dia.data).slice(0, 10), valor, qtd };
        }
    }
    return null;
}

/** O período consultado não tem nenhuma venda finalizada (faturamento e contagem zerados). */
export function periodoSemVenda(data: any): boolean {
    const revenue = Number(data?.financials?.revenue ?? data?.summary?.revenue?.value ?? 0);
    const vendas = Number(data?.summary?.revenue?.sample_size ?? data?.financials?.count ?? 0);
    return revenue <= 0 && vendas <= 0;
}

/**
 * Último movimento conhecido, olhando a série diária do painel
 * (`charts.sales_trend`, que cobre ao menos 90 dias) e, se ela não vier,
 * a lista de dias com venda do comparativo.
 */
export function ultimoMovimentoDoPayload(data: any): DiaComVenda | null {
    const direto = ultimoDiaComVenda(data?.charts?.sales_trend);
    if (direto) return direto;
    const alternativo = data?.charts?.sales_timeseries ?? data?.sales_timeseries;
    return ultimoDiaComVenda(alternativo);
}
