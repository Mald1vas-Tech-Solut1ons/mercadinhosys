// Regras da taxonomia oficial no cliente (PLANO §4 item 1).
// A fonte da verdade é o backend: aqui só se reproduz a CHAVE CANÔNICA para a busca do
// picker achar "pan", "PANELAS" e "panela" na mesma subcategoria — sem nunca inventar
// categoria por semelhança de letras.

import { TaxonomiaCategoria } from '../../types/viewSchema';

const LIGACOES = new Set(['e', 'de', 'da', 'do', 'das', 'dos', 'para', 'com']);

/** minúsculas, sem acento, sem pontuação, sem palavra de ligação e plural → singular simples. */
export const chaveCanonica = (texto: string): string =>
    (texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(palavra => palavra && !LIGACOES.has(palavra))
        .map(palavra => (palavra.length > 3 && palavra.endsWith('s') ? palavra.slice(0, -1) : palavra))
        .join(' ');

export interface SubcategoriaComCategoria {
    chave: string;
    nome: string;
    categoriaChave: string;
    categoriaNome: string;
}

export const todasAsSubcategorias = (taxonomia: TaxonomiaCategoria[]): SubcategoriaComCategoria[] =>
    (taxonomia || []).flatMap(categoria =>
        (categoria.subcategorias || []).map(sub => ({
            chave: sub.chave,
            nome: sub.nome,
            categoriaChave: categoria.chave,
            categoriaNome: categoria.nome,
        })),
    );

/**
 * Subcategorias que casam com o termo digitado. Termo vazio devolve tudo (a árvore é
 * desenhada por categoria). Casa pelo nome da subcategoria, pelo nome da categoria ou
 * pela chave — sempre pela chave canônica, e aceita o termo contido no nome ("pan" →
 * Panelas) e o nome contido no termo.
 */
export const buscarSubcategorias = (
    taxonomia: TaxonomiaCategoria[],
    termo: string,
): SubcategoriaComCategoria[] => {
    const todas = todasAsSubcategorias(taxonomia);
    const alvo = chaveCanonica(termo);
    if (!alvo) return todas;
    return todas.filter(sub => {
        const nome = chaveCanonica(sub.nome);
        const categoria = chaveCanonica(sub.categoriaNome);
        const chave = chaveCanonica(sub.chave.replace(/\./g, ' '));
        // O termo tem de estar contido no nome/categoria/chave — nunca o contrário
        // ("panela voadora" não casa com "Panelas", igual ao resolver do backend).
        return nome.includes(alvo) || categoria.includes(alvo) || chave.includes(alvo);
    });
};

/** Categoria dona de uma chave de subcategoria (para reabrir o picker no lugar certo). */
export const categoriaDaSubcategoria = (
    taxonomia: TaxonomiaCategoria[],
    chave: string,
): { chave: string; nome: string } | null => {
    if (!chave) return null;
    for (const categoria of taxonomia || []) {
        if ((categoria.subcategorias || []).some(sub => sub.chave === chave)) {
            return { chave: categoria.chave, nome: categoria.nome };
        }
    }
    return null;
};

/** Subcategoria "Outros …" da árvore (o item raro oficial — nunca a categoria "Geral"). */
export const subcategoriaOutros = (taxonomia: TaxonomiaCategoria[]): SubcategoriaComCategoria | null => {
    const outras = todasAsSubcategorias(taxonomia).filter(sub => chaveCanonica(sub.nome).startsWith('outro'));
    return outras.length ? outras[0] : null;
};
