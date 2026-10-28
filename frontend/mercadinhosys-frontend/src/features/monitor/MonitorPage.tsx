import { useState, useEffect, useCallback } from 'react';
import { Activity, Search, RefreshCw, ShoppingCart, DollarSign, Package, Users, FileText, LogIn, Trash2, Edit3, Plus, Clock } from 'lucide-react';
import { monitorService, LogAuditoria } from './monitorService';
import { showToast } from '../../utils/toast';

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (s?: string) => { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

// Ícone + cor por família de evento (heurística pelo tipo_evento)
function visual(tipo: string): { Icon: any; cls: string } {
    const t = (tipo || '').toLowerCase();
    if (t.includes('venda')) return { Icon: ShoppingCart, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' };
    if (t.includes('caixa') || t.includes('pagamento') || t.includes('despesa')) return { Icon: DollarSign, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
    if (t.includes('produto') || t.includes('estoque')) return { Icon: Package, cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' };
    if (t.includes('cliente')) return { Icon: Users, cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' };
    if (t.includes('login') || t.includes('logout')) return { Icon: LogIn, cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' };
    if (t.includes('ponto')) return { Icon: Clock, cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' };
    if (t.includes('delete') || t.includes('exclus')) return { Icon: Trash2, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' };
    if (t.includes('update') || t.includes('alter')) return { Icon: Edit3, cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' };
    if (t.includes('insert') || t.includes('cadastr') || t.includes('registrad')) return { Icon: Plus, cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' };
    return { Icon: FileText, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
}

const tipoLabel = (t: string) => (t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function MonitorPage() {
    const [logs, setLogs] = useState<LogAuditoria[]>([]);
    const [tipos, setTipos] = useState<{ tipo: string; total: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPaginas, setTotalPaginas] = useState(1);
    const [total, setTotal] = useState(0);
    const [tipoFiltro, setTipoFiltro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');

    const carregar = useCallback(async (p = 1) => {
        setLoading(true);
        try {
            const r = await monitorService.listar({ page: p, tipo: tipoFiltro || undefined, q: busca || undefined });
            setLogs(r.logs || []);
            setTotalPaginas(r.paginacao?.total_paginas || 1);
            setTotal(r.paginacao?.total || 0);
            setPage(r.paginacao?.pagina || 1);
        } catch { showToast.error('Erro ao carregar logs'); }
        finally { setLoading(false); }
    }, [tipoFiltro, busca]);

    useEffect(() => { carregar(1); }, [carregar]);
    useEffect(() => { monitorService.resumo().then(setTipos).catch(() => { }); }, []);

    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary-600 text-white"><Activity className="w-6 h-6" /></div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">Monitor &amp; Auditoria</h1>
                    <p className="text-sm text-slate-500 dark:text-gray-400">Quem fez o quê no seu sistema — {total} registro(s)</p>
                </div>
                <button onClick={() => carregar(page)} className="ml-auto text-slate-400 hover:text-slate-600"><RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>

            {/* Filtros */}
            <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar na descrição (ex: cliente, venda, produto...)"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500"
                    />
                </div>
            </div>
            {tipos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => setTipoFiltro(null)} className={`px-3 py-1 rounded-full text-xs font-semibold ${!tipoFiltro ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Todos</button>
                    {tipos.slice(0, 10).map((t) => (
                        <button key={t.tipo} onClick={() => setTipoFiltro(t.tipo)} className={`px-3 py-1 rounded-full text-xs font-semibold ${tipoFiltro === t.tipo ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                            {tipoLabel(t.tipo)} <span className="opacity-60">({t.total})</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Lista */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                    <div className="p-10 text-center text-slate-400">Carregando…</div>
                ) : logs.length === 0 ? (
                    <div className="p-10 text-center text-slate-400">Nenhum registro de auditoria ainda.</div>
                ) : logs.map((log) => {
                    const v = visual(log.tipo_evento);
                    return (
                        <div key={log.id} className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${v.cls}`}><v.Icon className="w-4 h-4" /></div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm text-slate-800 dark:text-slate-100">
                                    <span className="font-bold">{log.usuario_nome}</span> — {log.descricao}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {fmt(log.data_evento)} · {tipoLabel(log.tipo_evento)}
                                    {log.valor ? ` · ${brl(log.valor)}` : ''}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Paginação */}
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
