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
    taxonomia: TaxonomiaCategoria[];
    /** Chave da subcategoria escolhida. */
    value: string;
    /** Devolve OS DOIS níveis: a categoria vem de dentro da árvore da subcategoria. */
    onChange: (escolha: EscolhaTaxonomia) => void;
    erro?: string | null;
    disabled?: boolean;
}

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
 * CategoriaPicker — PLANO §4 item 1, ao pé da letra.
 *
 * Campo de busca único ("Buscar subcategoria…") que lista "Subcategoria — Categoria" pela
 * chave canônica; abaixo dele a árvore: CATEGORIAS em pílulas roláveis e, da categoria
 * escolhida, as SUBCATEGORIAS em pílulas. O componente devolve `{categoria, subcategoria}`.
 * Não existe opção de criar; sem resultado, a mensagem da lista oficial.
 * No celular (≤640 px) abre em painel de tela cheia (ResponsiveModal), pílulas nowrap.
 */
const CategoriaPicker: React.FC<CategoriaPickerProps> = ({ taxonomia, value, onChange, erro, disabled }) => {
    const telaCheia = useTelaCheia();
    const [aberto, setAberto] = useState(false);
    const [termo, setTermo] = useState('');
    const [categoriaLocal, setCategoriaLocal] = useState('');

    const escolhida = useMemo(() => {
        for (const categoria of taxonomia || []) {
            const sub = (categoria.subcategorias || []).find(s => s.chave === value);
            if (sub) return { chave: sub.chave, nome: sub.nome, categoriaChave: categoria.chave, categoriaNome: categoria.nome };
        }
        return null;
    }, [taxonomia, value]);

    const categoriaAtiva = escolhida?.categoriaChave || categoriaLocal || (taxonomia || [])[0]?.chave || '';
    const nomeCategoriaAtiva = (taxonomia || []).find(c => c.chave === categoriaAtiva)?.nome || '';
    const subcategorias = (taxonomia || []).find(c => c.chave === categoriaAtiva)?.subcategorias || [];
    const resultados = useMemo(() => buscarSubcategorias(taxonomia || [], termo), [taxonomia, termo]);
    const buscando = chaveCanonica(termo) !== '';
    const semTaxonomia = !(taxonomia || []).length;

    const escolher = (sub: { chave: string; nome: string; categoriaChave: string; categoriaNome: string }) => {
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
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-9 text-sm text-gray-900 outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
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
            ) : buscando ? (
                resultados.length === 0 ? (
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                        Não está na lista oficial. Use “Outros …” ou peça ao suporte
                    </p>
                ) : (
                    <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {resultados.slice(0, 80).map(sub => (
                            <li key={sub.chave}>
                                <button type="button" onClick={() => escolher(sub)}
                                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${sub.chave === value
                                        ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
                                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}>
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
                    {/* Categorias (nível 2) */}
                    <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
                        {(taxonomia || []).map(categoria => (
                            <button key={categoria.chave} type="button" onClick={() => setCategoriaLocal(categoria.chave)}
                                aria-pressed={categoria.chave === categoriaAtiva} className={pildora(categoria.chave === categoriaAtiva)}>
                                {categoria.nome}
                            </button>
                        ))}
                    </div>
                    {/* Subcategorias (nível 3) da categoria escolhida */}
                    <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
                        {subcategorias.map(sub => {
                            const ativo = sub.chave === value;
                            return (
                                <button key={sub.chave} type="button" aria-pressed={ativo}
                                    onClick={() => escolher({ chave: sub.chave, nome: sub.nome, categoriaChave: categoriaAtiva, categoriaNome: nomeCategoriaAtiva })}
                                    className={`${pildora(ativo)} inline-flex items-center gap-1`}>
                                    {sub.nome}
                                    {ativo && <Check className="h-3.5 w-3.5" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="min-w-0">
            <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">Subcategoria *</label>

            {telaCheia ? (
                <>
                    <button type="button" disabled={disabled} onClick={() => setAberto(true)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-left text-sm dark:bg-gray-800 ${erro ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'}`}>
                        {escolhida ? (
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                                    {escolhida.categoriaNome}
                                </span>
                                <span className="block truncate font-semibold text-gray-900 dark:text-white">{escolhida.nome}</span>
                            </span>
                        ) : (
                            <span className="min-w-0 flex-1 text-gray-400">Escolher subcategoria…</span>
                        )}
                        <span className="shrink-0 whitespace-nowrap text-xs font-bold text-blue-600">
                            {escolhida ? 'Alterar' : 'Escolher'}
                        </span>
                    </button>
                    <ResponsiveModal isOpen={aberto} onClose={() => setAberto(false)} title="Escolher subcategoria"
                        subtitle="Categoria → subcategoria, da lista oficial" size="full">
                        {corpo}
                    </ResponsiveModal>
                </>
            ) : (
                <div className={`rounded-2xl border p-3 ${erro ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'} bg-gray-50/60 dark:bg-gray-900/40`}>
                    <div className="mb-2 min-w-0">
                        {escolhida ? (
                            <span className="text-sm">
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
        </div>
    );
};

export default CategoriaPicker;
