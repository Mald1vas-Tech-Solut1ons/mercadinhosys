import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import ResponsiveModal from '../ui/ResponsiveModal';
import { TaxonomiaCategoria } from '../../types/viewSchema';
import { buscarSubcategorias, chaveCanonica } from './taxonomia';

export interface EscolhaTaxonomia {
    /** Nível 2: a categoria dona da subcategoria escolhida (ex.: bazar.cozinha / "Cozinha"). */
    categoria: { chave: string; nome: string };
    /** Nível 3: a subcategoria oficial (ex.: bazar.cozinha.panela / "Panelas"). */
    subcategoria: { chave: string; nome: string };
}

interface CategoriaPickerProps {
    /** Árvore oficial da família (schema.taxonomia). Sem ela, o campo fica desabilitado. */
    taxonomia: TaxonomiaCategoria[];
    /** Chave da subcategoria escolhida (ex.: "bazar.cozinha.panela"). */
    value: string;
    /** Devolve OS DOIS níveis: a categoria é derivada da subcategoria, nunca escolhida à parte. */
    onChange: (escolha: EscolhaTaxonomia) => void;
    label?: string;
    ajuda?: string;
    erro?: string | null;
    disabled?: boolean;
}

/** ≤ 640 px (mobile) abre em tela cheia; acima disso a escolha é inline. */
const LIMITE_MOBILE = '(max-width: 639px)';

const useTelaCheia = () => {
    const consulta = () =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(LIMITE_MOBILE).matches
            : false;
    const [mobile, setMobile] = useState(consulta);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(LIMITE_MOBILE);
        const aoMudar = (evento: MediaQueryListEvent) => setMobile(evento.matches);
        mq.addEventListener?.('change', aoMudar);
        setMobile(mq.matches);
        return () => mq.removeEventListener?.('change', aoMudar);
    }, []);

    return mobile;
};

/**
 * Escolha da subcategoria oficial (Família → Categoria → Subcategoria).
 *
 * Não existe "criar categoria": o lojista escolhe o que está na lista oficial ou usa o
 * "Outros …" da família. A busca é por chave canônica (sem acento, sem maiúscula, sem
 * palavra de ligação e plural = singular), a mesma regra do backend — por isso "pan",
 * "PANELAS" e "panela" chegam na mesma subcategoria.
 */
const CategoriaPicker: React.FC<CategoriaPickerProps> = ({
    taxonomia,
    value,
    onChange,
    label = 'Subcategoria *',
    ajuda,
    erro,
    disabled,
}) => {
    const telaCheia = useTelaCheia();
    const [aberto, setAberto] = useState(false);
    const [termo, setTermo] = useState('');
    const [categoriaAtiva, setCategoriaAtiva] = useState<string>('');

    const escolhida = useMemo(() => {
        for (const categoria of taxonomia || []) {
            const sub = (categoria.subcategorias || []).find(s => s.chave === value);
            if (sub) return { chave: sub.chave, nome: sub.nome, categoriaChave: categoria.chave, categoriaNome: categoria.nome };
        }
        return null;
    }, [taxonomia, value]);

    useEffect(() => {
        setCategoriaAtiva(prev => {
            if (escolhida?.categoriaChave) return escolhida.categoriaChave;
            if (prev && (taxonomia || []).some(categoria => categoria.chave === prev)) return prev;
            return taxonomia?.[0]?.chave ?? '';
        });
    }, [taxonomia, value, escolhida]);

    useEffect(() => {
        if (aberto) setTermo('');
    }, [aberto]);

    const resultados = useMemo(
        () => buscarSubcategorias(taxonomia || [], termo),
        [taxonomia, termo],
    );

    const subcategoriasDaCategoria = useMemo(
        () => (taxonomia || []).find(c => c.chave === categoriaAtiva)?.subcategorias ?? [],
        [taxonomia, categoriaAtiva],
    );

    const buscar = chaveCanonica(termo) !== '';
    const semTaxonomia = !(taxonomia || []).length;

    const escolher = (sub: { chave: string; nome: string; categoriaChave: string; categoriaNome: string }) => {
        // A escolha é sempre o PAR: a categoria vem de dentro da árvore da subcategoria.
        onChange({
            categoria: { chave: sub.categoriaChave, nome: sub.categoriaNome },
            subcategoria: { chave: sub.chave, nome: sub.nome },
        });
        setAberto(false);
    };

    const pildora = (ativo: boolean) =>
        `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${ativo
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`;

    const corpo = (
        <div className="min-w-0 space-y-3">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                    type="search"
                    value={termo}
                    onChange={e => setTermo(e.target.value)}
                    placeholder="Buscar subcategoria…"
                    aria-label="Buscar subcategoria"
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
                {termo && (
                    <button type="button" onClick={() => setTermo('')} aria-label="Limpar busca"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {semTaxonomia ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    A lista oficial desta família não chegou. Recarregue a página antes de salvar.
                </p>
            ) : buscar ? (
                resultados.length === 0 ? (
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                        Não está na lista oficial. Use “Outros…” da família ou peça ao suporte.
                    </p>
                ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                        {resultados.slice(0, 60).map(sub => (
                            <li key={sub.chave}>
                                <button type="button" onClick={() => escolher(sub)}
                                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${sub.chave === value ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}>
                                    <span className="whitespace-nowrap font-semibold text-gray-800 dark:text-gray-100">
                                        {sub.nome} <span className="font-normal text-gray-500 dark:text-gray-400">— {sub.categoriaNome}</span>
                                    </span>
                                    {sub.chave === value && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                                </button>
                            </li>
                        ))}
                    </ul>
                )
            ) : (
                <div className="min-w-0 space-y-2">
                    {/* Degrau 1 — CATEGORIA */}
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        1. Categoria
                    </p>
                    <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
                        {(taxonomia || []).map(categoria => (
                            <button key={categoria.chave} type="button" onClick={() => setCategoriaAtiva(categoria.chave)}
                                aria-pressed={categoria.chave === categoriaAtiva} className={pildora(categoria.chave === categoriaAtiva)}>
                                {categoria.nome}
                            </button>
                        ))}
                    </div>
                    {/* Degrau 2 — SUBCATEGORIA da categoria escolhida */}
                    <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        2. Subcategoria de <span className="text-gray-700 dark:text-gray-200">{(taxonomia || []).find(c => c.chave === categoriaAtiva)?.nome || '—'}</span>
                    </p>
                    <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
                        {subcategoriasDaCategoria.map(sub => {
                            const chave = sub.chave;
                            const ativo = chave === value;
                            return (
                                <button key={chave} type="button" aria-pressed={ativo}
                                    onClick={() => escolher({ chave, nome: sub.nome, categoriaChave: categoriaAtiva, categoriaNome: (taxonomia || []).find(c => c.chave === categoriaAtiva)?.nome || '' })}
                                    className={`${pildora(ativo)} inline-flex items-center gap-1`}>
                                    {sub.nome}
                                    {ativo && <Check className="h-3.5 w-3.5" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                Lista oficial do sistema. Não achou? Use “Outros…” ou peça ao suporte para acrescentar.
            </p>
        </div>
    );

    return (
        <div className="min-w-0">
            <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</label>

            {telaCheia ? (
                <>
                    <button type="button" disabled={disabled} onClick={() => setAberto(true)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all ${erro ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'} bg-white text-sm dark:bg-gray-800`}>
                        <span className={escolhida ? 'min-w-0 font-semibold text-gray-900 dark:text-white' : 'text-gray-400'}>
                            {escolhida ? (
                                <span className="block truncate">
                                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">{escolhida.categoriaNome} › </span>
                                    {escolhida.nome}
                                </span>
                            ) : 'Escolher subcategoria…'}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs font-bold text-blue-600">Alterar</span>
                    </button>
                    <ResponsiveModal isOpen={aberto} onClose={() => setAberto(false)} title="Escolher subcategoria"
                        subtitle="Lista oficial — Família › Categoria › Subcategoria" size="full">
                        {corpo}
                    </ResponsiveModal>
                </>
            ) : (
                <div className={`rounded-2xl border p-3 ${erro ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'} bg-gray-50/60 dark:bg-gray-900/40`}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        {escolhida ? (
                            <span className="min-w-0 text-sm">
                                <span className="mr-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                                    {escolhida.categoriaNome}
                                </span>
                                <span className="font-semibold text-gray-900 dark:text-white">{escolhida.nome}</span>
                            </span>
                        ) : (
                            <span className="text-sm text-gray-400">Nenhuma subcategoria escolhida</span>
                        )}
                    </div>
                    {corpo}
                </div>
            )}

            {erro && <p className="mt-1 text-xs font-semibold text-red-600">{erro}</p>}
            {!erro && ajuda && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{ajuda}</p>}
        </div>
    );
};

export default CategoriaPicker;
