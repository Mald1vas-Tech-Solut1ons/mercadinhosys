import { useCallback, useEffect, useState } from 'react';
import { Database, Search, RefreshCw, Package } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import ConsumoApisPanel from './ConsumoApisPanel';
import { showToast } from '../../utils/toast';

interface ItemCatalogo {
    id: number;
    ean: string;
    nome: string | null;
    marca: string | null;
    fabricante: string | null;
    ncm: string | null;
    categoria: string | null;
    unidade: string | null;
    preco_referencia: number | null;
    imagem_url: string | null;
    fonte: string;
    status: string;
    consultado_em: string | null;
    descoberto_por_estabelecimento_id: number | null;
    descoberto_via: string | null;
}

const POR_PAGINA = 50;

const fmtData = (s?: string | null) => {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return '—'; }
};

const FONTES: Record<string, string> = {
    bigdatacorp: 'BigDataCorp', openfoodfacts: 'Open Food Facts', openbeautyfacts: 'Open Beauty Facts',
    openproductsfacts: 'Open Products Facts', tenant: 'Cadastro de loja', cosmos: 'Cosmos (antigo)',
};
const fonteLabel = (f: string) => FONTES[f] || f;
const viaLabel = (v: string | null) => (v === 'modal' ? 'Modal' : v === 'xml' ? 'XML NF-e' : '—');

export default function MasterCatalogPage() {
    const [itens, setItens] = useState<ItemCatalogo[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [busca, setBusca] = useState('');
    const [categoria, setCategoria] = useState('');
    const [fonte, setFonte] = useState('');
    const [segmentoOrigem, setSegmentoOrigem] = useState('');

    const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

    const carregar = useCallback(async (p = 1) => {
        setLoading(true);
        try {
            const { data } = await apiClient.get('/super-admin/catalogo-mestre', {
                params: {
                    pagina: p,
                    por_pagina: POR_PAGINA,
                    busca: busca || undefined,
                    categoria: categoria || undefined,
                    fonte: fonte || undefined,
                    segmento_origem: segmentoOrigem || undefined,
                },
            });
            setItens(data.data || []);
            setTotal(data.total || 0);
            setPage(data.pagina || 1);
        } catch {
            showToast.error('Erro ao carregar o Catálogo Mestre');
        } finally {
            setLoading(false);
        }
    }, [busca, categoria, fonte, segmentoOrigem]);

    useEffect(() => { carregar(1); }, [carregar]);


    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary-600 text-white"><Database className="w-6 h-6" /></div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">Catálogo Mestre</h1>
                    <p className="text-sm text-slate-500 dark:text-gray-400">Banco global de produtos verificados por EAN — {total} item(ns)</p>
                </div>
                <button onClick={() => carregar(page)} className="ml-auto text-slate-400 hover:text-slate-600">
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <ConsumoApisPanel />

            <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar por nome ou EAN..."
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500"
                    />
                </div>
                <input
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    placeholder="Categoria..."
                    className="md:w-56 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500"
                />
                <select
                    value={fonte}
                    onChange={(e) => setFonte(e.target.value)}
                    className="md:w-48 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500"
                >
                    <option value="">Todas as fontes</option>
                    {Object.entries(FONTES).filter(([k]) => k !== 'cosmos').map(([k, rotulo]) => (
                        <option key={k} value={k}>{rotulo}</option>
                    ))}
                </select>
                <select
                    value={segmentoOrigem}
                    onChange={(e) => setSegmentoOrigem(e.target.value)}
                    className="md:w-56 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500"
                >
                    <option value="">Todos os segmentos de origem</option>
                    <option value="mercearia">Mercearia</option>
                    <option value="vestuario">Vestuário</option>
                    <option value="construcao">Construção</option>
                    <option value="autopecas">Autopeças</option>
                    <option value="generico">Genérico</option>
                </select>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs text-slate-400 uppercase">
                            <th className="p-3 font-semibold">Produto</th>
                            <th className="p-3 font-semibold">EAN</th>
                            <th className="p-3 font-semibold">Categoria</th>
                            <th className="p-3 font-semibold">Fonte</th>
                            <th className="p-3 font-semibold">Origem</th>
                            <th className="p-3 font-semibold">Atualizado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {loading ? (
                            <tr><td colSpan={6} className="p-10 text-center text-slate-400">Carregando…</td></tr>
                        ) : itens.length === 0 ? (
                            <tr><td colSpan={6} className="p-10 text-center text-slate-400">Nenhum item no catálogo ainda.</td></tr>
                        ) : itens.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                <td className="p-3">
                                    <div className="flex items-center gap-3">
                                        {item.imagem_url ? (
                                            <img src={item.imagem_url} alt={item.nome || ''} loading="lazy" className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-800" />
                                        ) : (
                                            <div className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                                <Package className="w-4 h-4 text-slate-400" />
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[220px]">{item.nome || '—'}</p>
                                            {item.marca && <p className="text-xs text-slate-400">{item.marca}</p>}
                                        </div>
                                    </div>
                                </td>
                                <td className="p-3 font-mono text-xs text-slate-500 dark:text-gray-400">{item.ean}</td>
                                <td className="p-3 text-slate-600 dark:text-slate-300">{item.categoria || '—'}</td>
                                <td className="p-3">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${item.fonte === 'cosmos' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                                        {fonteLabel(item.fonte)}
                                    </span>
                                </td>
                                <td className="p-3 text-slate-500 text-xs dark:text-gray-400">{viaLabel(item.descoberto_via)}</td>
                                <td className="p-3 text-slate-400 text-xs">{fmtData(item.consultado_em)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {totalPaginas > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <button disabled={page <= 1} onClick={() => carregar(page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-40">Anterior</button>
                    <span className="text-sm text-slate-500 dark:text-gray-400">Página {page} de {totalPaginas}</span>
                    <button disabled={page >= totalPaginas} onClick={() => carregar(page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-40">Próxima</button>
                </div>
            )}
        </div>
    );
}
