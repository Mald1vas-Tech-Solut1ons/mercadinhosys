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

/**
 * Classificação oficial em TRÊS degraus visíveis: Família (campo acima) → CATEGORIA → SUBCATEGORIA.
 *
 * Cada nível tem campo e rótulo próprios, na ordem da árvore: a subcategoria pertence à
 * categoria escolhida (nunca um par de árvores diferentes). Só lista oficial — sem texto
 * livre, sem criar; o item raro é o "Outros …" da categoria. A busca filtra as subcategorias
 * da categoria ativa pela chave canônica (sem acento, sem maiúscula, plural = singular).
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

    const subcategorias = useMemo(() => {
        const lista = categoria?.subcategorias || [];
        const alvo = chaveCanonica(busca);
        return alvo ? lista.filter(sub => chaveCanonica(sub.nome).includes(alvo)) : lista;
    }, [categoria, busca]);

    const semTaxonomia = !(taxonomia || []).length;
    // "Outros" é rede de segurança INTERNA (importação por XML/planilha), não escolha do lojista:
    // o cadastro só oferece categoria de verdade, com as subcategorias dela.
    const categoriasVisiveis = useMemo(
        () => (taxonomia || []).filter(cat => chaveCanonica(cat.nome) !== 'outro'),
        [taxonomia],
    );

    const escolherCategoria = (chave: string) => {
        setBusca('');
        setCategoriaLocal(chave);
        const alvo = (taxonomia || []).find(c => c.chave === chave);
        onChange({
            categoria: alvo ? { chave: alvo.chave, nome: alvo.nome } : { chave: '', nome: '' },
            subcategoria: { chave: '', nome: '' },
        });
    };

    const escolherSubcategoria = (chave: string) => {
        if (!categoria) return;
        const sub = categoria.subcategorias.find(s => s.chave === chave);
        if (!sub) return;
        setCategoriaLocal('');
        onChange({
            categoria: { chave: categoria.chave, nome: categoria.nome },
            subcategoria: { chave: sub.chave, nome: sub.nome },
        });
    };

    const pildora = (ativo: boolean) =>
        `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${ativo
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`;

    const labelClass = 'mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300';
    const ajudaClass = 'ml-1 text-xs font-normal text-gray-500 dark:text-gray-400';

    return (
        <div className="min-w-0 space-y-4">
            {/* NÍVEL 2 — CATEGORIA */}
            <div>
                <label className={labelClass}>
                    Categoria *
                    <span className={ajudaClass}>(nível 2 — onde o produto entra dentro da família)</span>
                </label>
                {semTaxonomia ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        A lista oficial desta família não chegou. Recarregue a página antes de salvar.
                    </p>
                ) : (
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
                )}
            </div>

            {/* NÍVEL 3 — SUBCATEGORIA */}
            <div>
                <label className={labelClass}>
                    Subcategoria *
                    <span className={ajudaClass}>
                        {categoria ? `(nível 3 — dentro de ${categoria.nome})` : '(escolha a categoria primeiro)'}
                    </span>
                </label>

                <div className="relative mb-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        type="search"
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar subcategoria…"
                        aria-label="Buscar subcategoria"
                        disabled={!categoria || disabled}
                        className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition-all focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:disabled:bg-gray-900"
                    />
                </div>

                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Subcategoria">
                    {!categoria && (
                        <span className="text-sm text-gray-400">Escolha a categoria acima para ver as subcategorias.</span>
                    )}
                    {categoria && subcategorias.length === 0 && (
                        <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                            Não está na lista oficial. Use “Outros …” ou peça ao suporte
                        </span>
                    )}
                    {subcategorias.map(sub => {
                        const ativo = sub.chave === value;
                        return (
                            <button key={sub.chave} type="button" aria-pressed={ativo}
                                disabled={disabled}
                                onClick={() => escolherSubcategoria(sub.chave)}
                                className={`${pildora(ativo)} inline-flex items-center gap-1`}>
                                {sub.nome}
                                {ativo && <Check className="h-3.5 w-3.5" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {erro && <p className="text-xs font-semibold text-red-600">{erro}</p>}
        </div>
    );
};

export default CategoriaPicker;
