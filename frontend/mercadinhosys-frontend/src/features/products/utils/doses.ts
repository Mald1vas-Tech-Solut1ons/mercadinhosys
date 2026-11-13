/**
 * Venda por dose — contas do editor de doses (ao vivo, enquanto o lojista digita).
 *
 * Espelha `backend/app/services/dose_config_service.py` (calcular, sugerir_preco, detectar_volume_ml):
 * o servidor é quem manda e recalcula ao salvar; aqui só dá o retorno imediato de custo e margem.
 * Os casos de `doses.test.ts` são os mesmos de `backend/tests/test_dose_config.py`.
 *
 * Nada de dose fixa: o lojista digita o ml que quiser (30, 51,5, 100...). Os "atalhos" vêm dos padrões da loja.
 */

export interface DoseLinha {
    /** Chave local (React); a dose gravada tem também `id`. */
    chave: string;
    id?: number;
    nome: string;
    /** Texto digitado: aceita vírgula ("51,5"). */
    volume_ml: string;
    preco_venda: string;
    padrao: boolean;
}

export interface DosesEstado {
    vende_por_dose: boolean;
    volume_embalagem_ml: string;
    validade_aberta_dias: string;
    perda_esperada_pct: string;
    doses: DoseLinha[];
}

export interface PadraoDose { nome: string; volume_ml: number }

export interface ConfigDosesLoja {
    doses_padrao: PadraoDose[];
    doses_padrao_definidas: boolean;
    margem_alvo_dose_pct: number | null;
    margem_alvo_definida: boolean;
    perda_esperada_pct: number;
    alerta_garrafa_aberta_dias: number | null;
    alerta_rendimento_pct: number | null;
}

export interface CalculoDose {
    custoDose: number | null;
    margemValor: number | null;
    margemPct: number | null;
    dosesPorGarrafa: number | null;
    dosesVendaveis: number | null;
    receitaGarrafa: number | null;
    multiploDaGarrafa: number | null;
    abaixoDaGarrafa: boolean;
}

export const MAX_DOSES = 12;
export const VOLUMES_COMUNS_ML = [350, 500, 700, 750, 900, 1000, 1750];
export const PASSO_PRECO = 0.5;

let contador = 0;
export const novaChave = () => `dose-${Date.now().toString(36)}-${++contador}`;

export const estadoVazio = (): DosesEstado => ({
    vende_por_dose: false, volume_embalagem_ml: '', validade_aberta_dias: '', perda_esperada_pct: '', doses: [],
});

/** "51,5" → 51.5; vazio ou inválido → null. */
export function numero(texto: string | number | null | undefined): number | null {
    if (texto === null || texto === undefined) return null;
    if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;
    const limpo = texto.trim().replace(',', '.');
    if (!limpo) return null;
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
}

const arredonda = (valor: number, casas: number) => {
    const f = 10 ** casas;
    return Math.round((valor + Number.EPSILON) * f) / f;
};

/** Texto de ml para a tela ("50 ml", "51,5 ml", "1 L"). */
export function formatarMl(ml: number | null): string {
    if (ml === null || !Number.isFinite(ml)) return '—';
    if (ml >= 1000 && ml % 10 === 0) return `${String(ml / 1000).replace('.', ',')} L`;
    return `${String(arredonda(ml, 2)).replace('.', ',')} ml`;
}

/** Volume em ml citado no texto ("Whisky 12 anos 1L" → 1000), ou null. */
export function detectarVolumeMl(...textos: Array<string | null | undefined>): number | null {
    for (const texto of textos) {
        if (!texto) continue;
        const achado = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l|lt|lts|litro|litros)\b/i.exec(texto);
        if (!achado) continue;
        const n = Number(achado[1].replace(',', '.'));
        const unidade = achado[2].toLowerCase();
        const ml = n * (['l', 'lt', 'lts', 'litro', 'litros'].includes(unidade) ? 1000 : unidade === 'cl' ? 10 : 1);
        if (ml >= 1 && ml <= 100000) return arredonda(ml, 2);
    }
    return null;
}

/** Preço que dá a margem alvo SOBRE A VENDA, arredondado para cima ao próximo `passo` (R$ 0,50). */
export function sugerirPreco(custoDose: number, margemPct: number, passo = PASSO_PRECO): number {
    if (margemPct >= 100) throw new Error('Margem alvo inválida');
    const bruto = custoDose / (1 - margemPct / 100);
    return arredonda(Math.ceil(bruto / passo - 1e-9) * passo, 2);
}

/** Preço exato (centavos para cima) para uma margem digitada pelo lojista. */
export function precoDaMargem(custoDose: number, margemPct: number): number {
    if (margemPct >= 100) return NaN;
    const bruto = custoDose / (1 - margemPct / 100);
    return arredonda(Math.ceil(bruto * 100 - 1e-9) / 100, 2);
}

export function custoDaDose(custoGarrafa: number, volumeMl: number, ml: number, perdaPct = 0): number | null {
    const util = volumeMl * (1 - Math.max(0, Math.min(perdaPct, 50)) / 100);
    if (!(custoGarrafa >= 0) || !(util > 0) || !(ml > 0)) return null;
    return custoGarrafa / util * ml;
}

export function calcularDose(opts: {
    custoGarrafa: number; volumeMl: number | null; ml: number | null; preco: number | null;
    perdaPct?: number; precoGarrafa?: number | null;
}): CalculoDose {
    const vazio: CalculoDose = {
        custoDose: null, margemValor: null, margemPct: null, dosesPorGarrafa: null, dosesVendaveis: null,
        receitaGarrafa: null, multiploDaGarrafa: null, abaixoDaGarrafa: false,
    };
    const { custoGarrafa, volumeMl, ml, preco } = opts;
    if (!volumeMl || volumeMl <= 0 || !ml || ml <= 0) return vazio;
    const perda = Math.max(0, Math.min(opts.perdaPct ?? 0, 50));
    const util = volumeMl * (1 - perda / 100);
    const custoDose = custoDaDose(custoGarrafa, volumeMl, ml, perda);
    const saida: CalculoDose = {
        ...vazio,
        custoDose: custoDose === null ? null : arredonda(custoDose, 4),
        dosesPorGarrafa: arredonda(volumeMl / ml, 2),
        dosesVendaveis: arredonda(util / ml, 2),
    };
    if (preco && preco > 0 && custoDose !== null) {
        const receita = preco * (util / ml);
        saida.margemValor = arredonda(preco - custoDose, 2);
        saida.margemPct = arredonda((preco - custoDose) / preco * 100, 1);
        saida.receitaGarrafa = arredonda(receita, 2);
        if (opts.precoGarrafa && opts.precoGarrafa > 0) {
            saida.multiploDaGarrafa = arredonda(receita / opts.precoGarrafa, 2);
            saida.abaixoDaGarrafa = preco / ml < opts.precoGarrafa / volumeMl;
        }
    }
    return saida;
}

export interface AvisoDose { dose: string; tipo: 'margem_negativa' | 'margem_baixa' | 'abaixo_da_garrafa'; mensagem: string }

export function avisosDasDoses(opts: {
    doses: Array<{ nome: string; calc: CalculoDose }>; metaMargemPct?: number | null;
}): AvisoDose[] {
    const avisos: AvisoDose[] = [];
    for (const { nome, calc } of opts.doses) {
        if (calc.margemPct !== null && calc.margemPct < 0) {
            avisos.push({ dose: nome, tipo: 'margem_negativa',
                mensagem: `${nome}: o preço não cobre o custo da dose (margem ${String(calc.margemPct).replace('.', ',')}%).` });
        } else if (opts.metaMargemPct && calc.margemPct !== null && calc.margemPct < opts.metaMargemPct) {
            avisos.push({ dose: nome, tipo: 'margem_baixa',
                mensagem: `${nome}: margem de ${String(calc.margemPct).replace('.', ',')}%, abaixo da meta de ${opts.metaMargemPct}%.` });
        }
        if (calc.abaixoDaGarrafa) {
            avisos.push({ dose: nome, tipo: 'abaixo_da_garrafa',
                mensagem: `${nome}: cada ml sai mais barato que na garrafa fechada.` });
        }
    }
    return avisos;
}

/** Mesmas regras do servidor; devolve a primeira mensagem de erro ou null. */
export function validarDoses(estado: DosesEstado): string | null {
    if (!estado.vende_por_dose) return null;
    const volume = numero(estado.volume_embalagem_ml);
    if (volume === null || volume <= 0) return 'Informe o volume da garrafa (ml) para vender por dose.';
    if (!estado.doses.length) return 'Cadastre ao menos uma dose.';
    if (estado.doses.length > MAX_DOSES) return `No máximo ${MAX_DOSES} doses por produto.`;
    const nomes = new Set<string>();
    for (const [i, dose] of estado.doses.entries()) {
        const ml = numero(dose.volume_ml);
        const nome = dose.nome.trim() || (ml ? `Dose ${formatarMl(ml)}` : `Dose ${i + 1}`);
        if (ml === null || ml <= 0) return `${nome}: informe quantos ml tem a dose.`;
        if (ml > volume) return `${nome}: a dose (${formatarMl(ml)}) é maior que a garrafa (${formatarMl(volume)}).`;
        const preco = numero(dose.preco_venda);
        if (preco === null || preco <= 0) return `${nome}: informe o preço da dose.`;
        if (nomes.has(nome.toLowerCase())) return `Há duas doses chamadas "${nome}": use nomes diferentes.`;
        nomes.add(nome.toLowerCase());
    }
    if (estado.doses.filter(d => d.padrao).length > 1) return 'Escolha só uma dose padrão.';
    const perda = numero(estado.perda_esperada_pct);
    if (perda !== null && (perda < 0 || perda > 50)) return 'Perda esperada: entre 0% e 50%.';
    const dias = numero(estado.validade_aberta_dias);
    if (dias !== null && (dias < 1 || dias > 3650)) return 'Validade depois de aberta: entre 1 e 3650 dias.';
    return null;
}

/** Corpo do `PUT /doses/produto/:id`. */
export function paraPayload(estado: DosesEstado) {
    return {
        vende_por_dose: estado.vende_por_dose,
        volume_embalagem_ml: numero(estado.volume_embalagem_ml),
        validade_aberta_dias: numero(estado.validade_aberta_dias),
        perda_esperada_pct: numero(estado.perda_esperada_pct),
        doses: estado.doses.map(d => ({
            ...(d.id ? { id: d.id } : {}),
            nome: d.nome.trim(),
            volume_ml: numero(d.volume_ml),
            preco_venda: numero(d.preco_venda),
            padrao: d.padrao,
        })),
    };
}

export interface RespostaDosesProduto {
    config: {
        vende_por_dose: boolean; volume_embalagem_ml: number | null; volume_sugerido_ml: number | null;
        validade_aberta_dias: number | null; perda_esperada_pct: number | null; perda_efetiva_pct: number;
    };
    doses: Array<{ id: number; nome: string; volume_ml: number; preco_venda: number; padrao: boolean; ativa: boolean }>;
    garrafas_abertas: number;
    avisos: Array<{ dose: string | null; tipo: string; mensagem: string }>;
    loja: ConfigDosesLoja;
}

const texto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

/** Estado do formulário a partir da resposta do servidor (doses arquivadas ficam de fora). */
export function deResposta(r: RespostaDosesProduto): DosesEstado {
    return {
        vende_por_dose: r.config.vende_por_dose,
        volume_embalagem_ml: texto(r.config.volume_embalagem_ml),
        validade_aberta_dias: texto(r.config.validade_aberta_dias),
        perda_esperada_pct: texto(r.config.perda_esperada_pct),
        doses: r.doses.filter(d => d.ativa).map(d => ({
            chave: novaChave(), id: d.id, nome: d.nome, volume_ml: texto(d.volume_ml),
            preco_venda: texto(d.preco_venda), padrao: d.padrao,
        })),
    };
}

export function novaDose(opts: {
    nome?: string; ml?: number | null; custoGarrafa: number; volumeMl: number | null;
    metaMargemPct?: number | null; perdaPct?: number; jaTemPadrao: boolean;
}): DoseLinha {
    let preco = '';
    if (opts.ml && opts.volumeMl && opts.metaMargemPct && opts.custoGarrafa > 0) {
        const custo = custoDaDose(opts.custoGarrafa, opts.volumeMl, opts.ml, opts.perdaPct ?? 0);
        if (custo !== null) preco = texto(sugerirPreco(custo, opts.metaMargemPct));
    }
    return {
        chave: novaChave(), nome: opts.nome ?? '', volume_ml: texto(opts.ml ?? null), preco_venda: preco,
        padrao: !opts.jaTemPadrao,
    };
}
