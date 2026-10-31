import React, { useMemo } from 'react';
import { Check, Search } from 'lucide-react';
import { TaxonomiaCategoria } from '../../types/viewSchema';
import { chaveCanonica } from './taxonomia';

export interface EscolhaTaxonomia {
    /** Nível 2: a categoria dona da subcategoria escolhida (ex.: bazar.cozinha / "Cozinha"). */
    categoria: { chave: string; nome: string };
    /** Nível 3: a subcategoria oficial (ex.: bazar.cozinha.panela / "Panelas"). */
    subcategoria: { chave: string; nome: string };
}

interface CategoriaPickerProps {
    taxonomia: TaxonomiaCategoria[];
    /** Chave da subcategoria escolhida. */
    value: string;
    /** Devolve OS DOIS níveis; escolher categoria manda a categoria com subcategoria vazia. */
    onChange: (escolha: EscolhaTaxonomia) => void;
    erro?: string | null;
    disabled?: boolean;
}

/** Ordem alfabética de verdade (pt-BR: acento e caixa não mudam a posição). */
const col = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const porNome = (a: { nome: string }, b: { nome: string }) => col.compare(a.nome, b.nome);

/**
 * Classificação oficial em TRÊS degraus visíveis: Família (campo acima) → CATEGORIA → SUBCATEGORIA.
 *
 * - Busca SEMPRE visível, no topo: digitar procura em todas as subcategorias da família e mostra
 *   "Subcategoria — Categoria" (escolher já preenche os dois níveis).
 * - Sem busca: categorias em pílulas (ordem alfabética) e, da categoria escolhida, as subcategorias
 *   (também alfabéticas).
 * - Só lista oficial: sem texto livre, sem criar. "Outros" é rede de segurança interna e não aparece.
 */
const CategoriaPicker: React.FC<CategoriaPickerProps> = ({ taxonomia, value, onChange, erro, disabled }) => {
    const [busca, setBusca] = React.useState('');
    const [categoriaLocal, setCategoriaLocal] = React.useState('');

    const escolhida = useMemo(() => {
        for (const categoria of taxonomia || []) {
            const sub = (categoria.subcategorias || []).find(s => s.chave === value);
            if (sub) return { categoria, sub };
        }
        return null;
    }, [taxonomia, value]);

    // A categoria clicada pelo usuário manda enquanto o pai não devolver a subcategoria nova.
    const categoriaAtiva = categoriaLocal || escolhida?.categoria.chave || '';
    const categoria = (taxonomia || []).find(c => c.chave === categoriaAtiva) || null;

    const semTaxonomia = !(taxonomia || []).length;
    // "Outros" é rede de segurança INTERNA (importação por XML/planilha), não escolha do lojista.
    const categoriasVisiveis = useMemo(
        () => (taxonomia || []).filter(cat => chaveCanonica(cat.nome) !== 'outro').slice().sort(porNome),
        [taxonomia],
    );

    const subcategorias = useMemo(
        () => (categoria?.subcategorias || []).slice().sort(porNome),
        [categoria],
    );

    /** Resultados da busca, de todas as categorias da família: "Sub — Categoria". */
    const resultados = useMemo(() => {
        const alvo = chaveCanonica(busca);
        if (!alvo) return [];
        const achados: Array<{ categoria: TaxonomiaCategoria; sub: { chave: string; nome: string } }> = [];
        for (const cat of categoriasVisiveis) {
            if (chaveCanonica(cat.nome).includes(alvo)) continue; // a categoria em si é filtro, não resultado
            for (const sub of cat.subcategorias || []) {
                if (chaveCanonica(sub.nome).includes(alvo)) achados.push({ categoria: cat, sub });
            }
        }
        return achados.sort((a, b) => porNome(a.sub, b.sub));
    }, [busca, categoriasVisiveis]);

    const escolherCategoria = (chave: string) => {
        setBusca('');
        setCategoriaLocal(chave);
        const alvo = (taxonomia || []).find(c => c.chave === chave);
        onChange({
            categoria: alvo ? { chave: alvo.chave, nome: alvo.nome } : { chave: '', nome: '' },
            subcategoria: { chave: '', nome: '' },
        });
    };

    const escolherSubcategoria = (cat: TaxonomiaCategoria, chave: string) => {
        const sub = (cat.subcategorias || []).find(s => s.chave === chave);
        if (!sub) return;
        setBusca('');
        setCategoriaLocal('');
        onChange({
            categoria: { chave: cat.chave, nome: cat.nome },
            subcategoria: { chave: sub.chave, nome: sub.nome },
        });
    };

    const pildora = (ativo: boolean) =>
        `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${ativo
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`;

    const labelClass = 'mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300';
    const ajudaClass = 'ml-1 text-xs font-normal text-gray-500 dark:text-gray-400';
    const buscando = Boolean(chaveCanonica(busca));

    return (
        <div className="min-w-0 space-y-4">
            {/* BUSCA ÚNICA — sempre visível, procura em toda a família */}
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                    type="search"
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar categoria ou subcategoria…"
                    aria-label="Buscar categoria ou subcategoria"
                    disabled={disabled || semTaxonomia}
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition-all focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:disabled:bg-gray-900"
                />
            </div>

            {semTaxonomia && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    A lista oficial desta família não chegou. Recarregue a página antes de salvar.
                </p>
            )}

            {/* MODO BUSCA — resultados de toda a família */}
            {!semTaxonomia && buscando && (
                <div>
                    <label className={labelClass}>
                        Resultados
                        <span className={ajudaClass}>
                            {resultados.length === 1 ? '(1 subcategoria)' : `(${resultados.length} subcategorias)`}
                        </span>
                    </label>
                    <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Resultados da busca">
                        {resultados.length === 0 && (
                            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                                Não está na lista oficial. Veja as categorias da família abaixo — sem texto livre.
                            </span>
                        )}
                        {resultados.map(({ categoria: cat, sub }) => {
                            const ativo = sub.chave === value;
                            return (
                                <button key={sub.chave} type="button" role="option" aria-selected={ativo}
                                    disabled={disabled}
                                    onClick={() => escolherSubcategoria(cat, sub.chave)}
                                    className={`${pildora(ativo)} inline-flex items-center gap-1`}>
                                    {sub.nome}
                                    <span className="text-[10px] font-normal opacity-70">· {cat.nome}</span>
                                    {ativo && <Check className="h-3.5 w-3.5" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* MODO ÁRVORE — categoria (alfabética) e subcategorias da categoria */}
            {!semTaxonomia && !buscando && (
                <>
                    <div>
                        <label className={labelClass}>
                            Categoria *
                            <span className={ajudaClass}>(nível 2 — em ordem alfabética)</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categoria">
                            {categoriasVisiveis.map(cat => (
                                <button key={cat.chave} type="button" aria-pressed={cat.chave === categoriaAtiva}
                                    disabled={disabled}
                                    onClick={() => escolherCategoria(cat.chave)}
                                    className={pildora(cat.chave === categoriaAtiva)}>
                                    {cat.nome}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>
                            Subcategoria *
                            <span className={ajudaClass}>
                                {categoria ? `(nível 3 — dentro de ${categoria.nome})` : '(escolha a categoria ou use a busca acima)'}
                            </span>
                        </label>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Subcategoria">
                            {!categoria && (
                                <span className="text-sm text-gray-400">
                                    Escolha a categoria acima — ou digite na busca para achar direto.
                                </span>
                            )}
                            {categoria && subcategorias.map(sub => {
                                const ativo = sub.chave === value;
                                return (
                                    <button key={sub.chave} type="button" aria-pressed={ativo}
                                        disabled={disabled}
                                        onClick={() => escolherSubcategoria(categoria, sub.chave)}
                                        className={`${pildora(ativo)} inline-flex items-center gap-1`}>
                                        {sub.nome}
                                        {ativo && <Check className="h-3.5 w-3.5" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {erro && <p className="text-xs font-semibold text-red-600">{erro}</p>}
        </div>
    );
};

export default CategoriaPicker;
