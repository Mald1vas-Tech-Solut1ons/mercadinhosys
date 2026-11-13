/**
 * Venda por dose no caixa: identidade da linha do carrinho, quanto ainda dá para servir e as escolhas lembradas.
 *
 * O mesmo produto vira várias linhas no carrinho (garrafa inteira, dose de 50 ml, dupla, dose livre), então a
 * linha é identificada por `chave` e não só pelo id do produto. O servidor é quem baixa os ml e confere o
 * estoque de verdade; aqui o caixa só é avisado antes de tentar vender o que não existe.
 */
import type { Produto } from '../../../types';

export interface DoseOferta {
    id: number;
    nome: string;
    volume_ml: number;
    preco_venda: number;
    padrao: boolean;
}

export interface OfertaDose {
    vende_por_dose: true;
    volume_embalagem_ml: number;
    doses: DoseOferta[];
    saldo_aberto_ml: number;
    garrafas_abertas?: Array<{ id: number; saldo_ml: number; volume_inicial_ml?: number; aberta_em?: string | null }>;
}

export type ProdutoPdv = Produto & Partial<OfertaDose>;

/** Dose escolhida para a linha do carrinho (`id` nulo = dose livre, ml digitado no caixa). */
export interface DoseDaLinha {
    id: number | null;
    nome: string;
    volumeMl: number;
    livre?: boolean;
}

/** O que o carrinho precisa saber de cada linha. */
export interface LinhaCarrinho {
    produto: { id: number };
    quantidade: number;
    chave?: string;
    dose?: DoseDaLinha;
}

export const temDoses = (p: ProdutoPdv | null | undefined): p is ProdutoPdv & OfertaDose =>
    !!p && p.vende_por_dose === true && Array.isArray(p.doses) && p.doses.length > 0
    && Number(p.volume_embalagem_ml) > 0;

export const chaveDaLinha = (produtoId: number, dose?: DoseDaLinha | null): string => {
    if (!dose) return String(produtoId);
    return dose.livre || dose.id === null ? `${produtoId}:l${dose.volumeMl}` : `${produtoId}:d${dose.id}`;
};

/** Chave da linha: carrinhos salvos antes das doses não têm `chave` e valem o id do produto. */
export const chaveDe = (linha: LinhaCarrinho): string => linha.chave ?? chaveDaLinha(linha.produto.id, linha.dose);

const formatarNumero = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

export const formatarMlPdv = (ml: number): string =>
    (ml >= 1000 && ml % 10 === 0 ? `${formatarNumero(ml / 1000)} L` : `${formatarNumero(ml)} ml`);

/** "Dose · 50 ml" / "Dose livre · 45 ml" (nome na linha do carrinho e no cupom). */
export const rotuloDaDose = (dose: DoseDaLinha): string => `${dose.nome} · ${formatarMlPdv(dose.volumeMl)}`;

/** Nome do item como sai no carrinho e no cupom: "WHISKY 1L · Dose · 50 ml". */
export const nomeDaLinha = (nomeProduto: string, dose?: DoseDaLinha | null): string =>
    (dose ? `${nomeProduto} · ${rotuloDaDose(dose)}` : nomeProduto);

/** ml que dá para servir agora: o que sobrou na aberta + as garrafas fechadas em estoque. */
export const mlDisponivel = (p: ProdutoPdv, estoqueFechado: number): number =>
    Math.max(0, Number(p.saldo_aberto_ml) || 0) + Math.max(0, estoqueFechado) * (Number(p.volume_embalagem_ml) || 0);

/** ml que as linhas do carrinho já vão consumir do produto (garrafa inteira conta como o volume dela). */
export const mlNoCarrinho = (carrinho: LinhaCarrinho[], p: ProdutoPdv, ignorarChave?: string): number => {
    const volume = Number(p.volume_embalagem_ml) || 0;
    return carrinho.reduce((soma, linha) => {
        if (linha.produto.id !== p.id || chaveDe(linha) === ignorarChave) return soma;
        return soma + (linha.dose ? linha.dose.volumeMl * linha.quantidade : volume * linha.quantidade);
    }, 0);
};

/** Quantas unidades DESTA linha ainda cabem, descontado o que as outras linhas do produto já pegaram. */
export const maxDaLinha = (
    carrinho: LinhaCarrinho[], p: ProdutoPdv, estoqueFechado: number, dose?: DoseDaLinha | null,
): number => {
    const volume = Number(p.volume_embalagem_ml) || 0;
    const livre = mlDisponivel(p, estoqueFechado) - mlNoCarrinho(carrinho, p, chaveDaLinha(p.id, dose));
    const porUnidade = dose ? dose.volumeMl : volume;
    return porUnidade > 0 ? Math.max(0, Math.floor((livre + 1e-9) / porUnidade)) : 0;
};

/**
 * Garrafas INTEIRAS que ainda dá para vender: as fechadas do estoque menos as que as doses do carrinho vão abrir
 * (ml de dose além do que já sobrou na aberta). O saldo da aberta não vira garrafa inteira.
 */
export const maxGarrafasInteiras = (carrinho: LinhaCarrinho[], p: ProdutoPdv, estoqueFechado: number): number => {
    const volume = Number(p.volume_embalagem_ml) || 0;
    if (volume <= 0) return Math.max(0, Math.floor(estoqueFechado));
    const mlDeDose = carrinho.reduce((soma, l) => (
        l.produto.id === p.id && l.dose ? soma + l.dose.volumeMl * l.quantidade : soma), 0);
    const abrirao = Math.ceil(Math.max(0, mlDeDose - Math.max(0, Number(p.saldo_aberto_ml) || 0)) / volume - 1e-9);
    return Math.max(0, Math.floor(estoqueFechado - abrirao));
};

/**
 * Preço de uma dose livre: R$/ml da dose padrão x ml, arredondado PARA CIMA ao centavo (o servidor trata preço
 * abaixo da referência como desconto, e o caixa comum não tem desconto).
 */
export const precoDoseLivre = (p: ProdutoPdv & OfertaDose, ml: number): number => {
    const base = p.doses.find(d => d.padrao) || p.doses[0];
    const porMl = base.preco_venda / base.volume_ml;
    return Math.ceil(porMl * ml * 100 - 1e-9) / 100;
};

/** Valida o ml digitado: positivo e no máximo uma garrafa. Devolve o erro ou null. */
export const validarMlLivre = (p: ProdutoPdv & OfertaDose, ml: number | null): string | null => {
    if (ml === null || !Number.isFinite(ml) || ml <= 0) return 'Informe quantos ml vão no copo.';
    if (ml > p.volume_embalagem_ml) return `O copo (${formatarMlPdv(ml)}) é maior que a garrafa (${formatarMlPdv(p.volume_embalagem_ml)}).`;
    return null;
};

// ── Última escolha por produto (um toque repete o que o caixa serviu da última vez) ─────────────────────────

const CHAVE_LS = 'pdv_dose_ultima_escolha_v1';
export type Opcao = 'garrafa' | `d${number}`;

const lerMapa = (): Record<string, string> => {
    try {
        const bruto = localStorage.getItem(CHAVE_LS);
        const dados = bruto ? JSON.parse(bruto) : {};
        return dados && typeof dados === 'object' ? dados : {};
    } catch {
        return {};
    }
};

export const ultimaEscolha = (produtoId: number): string | null => lerMapa()[String(produtoId)] ?? null;

export const salvarUltimaEscolha = (produtoId: number, opcao: string): void => {
    try {
        const mapa = lerMapa();
        mapa[String(produtoId)] = opcao;
        localStorage.setItem(CHAVE_LS, JSON.stringify(mapa));
    } catch { /* sem localStorage (modo privado): só não lembra */ }
};

/** Opção realçada ao abrir a folha: a última usada se ainda existe; senão a dose padrão. */
export const opcaoInicial = (p: ProdutoPdv & OfertaDose): string => {
    const ultima = ultimaEscolha(p.id);
    if (ultima === 'garrafa') return 'garrafa';
    if (ultima && p.doses.some(d => `d${d.id}` === ultima)) return ultima;
    const padrao = p.doses.find(d => d.padrao) || p.doses[0];
    return `d${padrao.id}`;
};
