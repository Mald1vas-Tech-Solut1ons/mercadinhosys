import React, { useEffect, useMemo, useState } from 'react';
import { Printer, X, Search, WifiOff, Smartphone, Cloud } from 'lucide-react';
import { pdvService, type ComprovanteVendaResponse, type VendaHojeResumo } from '../pdvService';
import { listarCuponsLocais } from '../cupomLocal';
import type { CupomLocal } from '../../../lib/db';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';
import { formatCurrency } from '../../../utils/formatters';

export interface CupomParaReimprimir {
    vendaId: number | null;
    dadosLocais: ComprovanteVendaResponse | null;
}

interface ReimprimirCupomModalProps {
    aberto: boolean;
    online: boolean;
    onFechar: () => void;
    onSelecionar: (cupom: CupomParaReimprimir) => void;
}

const horaLocal = (iso: string) => {
    const d = new Date(iso);
    const hoje = new Date();
    const mesmoDia = d.toDateString() === hoje.toDateString();
    return mesmoDia
        ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * Reimpressão de cupom no PDV: vendas feitas neste aparelho (inclusive offline,
 * ainda sem sincronizar) + as demais vendas de hoje da loja, quando há internet.
 */
const ReimprimirCupomModal: React.FC<ReimprimirCupomModalProps> = ({ aberto, ...props }) => {
    useBodyScrollLock(aberto);
    // Monta só aberto: cada abertura começa com busca vazia e lista recarregada.
    return aberto ? <ListaReimpressao {...props} /> : null;
};

const ListaReimpressao: React.FC<Omit<ReimprimirCupomModalProps, 'aberto'>> = ({ online, onFechar, onSelecionar }) => {
    const [locais, setLocais] = useState<CupomLocal[]>([]);
    const [servidor, setServidor] = useState<VendaHojeResumo[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [falhaServidor, setFalhaServidor] = useState(false);
    const [busca, setBusca] = useState('');

    useEffect(() => {
        let ativo = true;
        Promise.all([
            listarCuponsLocais().catch(() => [] as CupomLocal[]),
            online
                ? pdvService.vendasHoje(50).catch(() => { if (ativo) setFalhaServidor(true); return [] as VendaHojeResumo[]; })
                : Promise.resolve([] as VendaHojeResumo[]),
        ]).then(([l, s]) => {
            if (!ativo) return;
            setLocais(l);
            setServidor(s);
        }).finally(() => { if (ativo) setCarregando(false); });
        return () => { ativo = false; };
    }, [online]);

    // Venda do servidor que já tem cópia neste aparelho aparece uma vez só (na lista local).
    const outrasDoServidor = useMemo(() => {
        const ids = new Set(locais.map(c => c.venda_id).filter(Boolean));
        const uuids = new Set(locais.map(c => c.id));
        return servidor.filter(v => !ids.has(v.id) && !(v.offline_uuid && uuids.has(v.offline_uuid)));
    }, [locais, servidor]);

    const termo = busca.trim().toLowerCase();
    const casa = (codigo: string, total: number) =>
        !termo || codigo.toLowerCase().includes(termo) || formatCurrency(total).includes(termo) || total.toFixed(2).includes(termo.replace(',', '.'));
    const locaisFiltrados = locais.filter(c => casa(c.codigo, c.total));
    const servidorFiltrado = outrasDoServidor.filter(v => casa(v.codigo, v.total));

    const vazio = !carregando && locaisFiltrados.length === 0 && servidorFiltrado.length === 0;

    return (
        <div
            className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
            onClick={(e) => e.target === e.currentTarget && onFechar()}
        >
            <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[90dvh]">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <div className="w-9 h-9 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center">
                            <Printer className="w-5 h-5 text-slate-700 dark:text-slate-200" />
                        </div>
                        <div>
                            <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Reimprimir cupom</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Escolha a venda para imprimir a 2ª via</p>
                        </div>
                    </div>
                    <button onClick={onFechar} aria-label="Fechar"
                        className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-4 pt-3">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            autoFocus
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar por código ou valor"
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    {!online && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                            <WifiOff className="w-3.5 h-3.5" /> Sem internet: mostrando só as vendas guardadas neste aparelho.
                        </p>
                    )}
                    {online && falhaServidor && (
                        <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                            Não foi possível buscar as vendas do servidor. Mostrando as deste aparelho.
                        </p>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {carregando && (
                        <div className="flex justify-center py-10">
                            <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
                        </div>
                    )}

                    {!carregando && locaisFiltrados.length > 0 && (
                        <section>
                            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                                <Smartphone className="w-3.5 h-3.5" /> Feitas neste aparelho
                            </p>
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                {locaisFiltrados.map(c => (
                                    <li key={c.id}>
                                        <button
                                            onClick={() => onSelecionar({ vendaId: c.venda_id ?? null, dadosLocais: c.dados })}
                                            className="w-full min-h-[52px] px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{c.codigo}</p>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                    {horaLocal(c.criadoEm)} · {c.dados.comprovante.itens.length} item(ns)
                                                    {c.offline && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold">offline</span>}
                                                </p>
                                            </div>
                                            <span className="flex items-center gap-2 shrink-0">
                                                <span className="text-sm font-black tabular-nums text-slate-900 dark:text-white">{formatCurrency(c.total)}</span>
                                                <Printer className="w-4 h-4 text-slate-400" />
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {!carregando && servidorFiltrado.length > 0 && (
                        <section>
                            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                                <Cloud className="w-3.5 h-3.5" /> Outras vendas de hoje
                            </p>
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                {servidorFiltrado.map(v => (
                                    <li key={v.id}>
                                        <button
                                            onClick={() => onSelecionar({ vendaId: v.id, dadosLocais: null })}
                                            className="w-full min-h-[52px] px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{v.codigo}</p>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{v.hora} · {v.forma_pagamento}</p>
                                            </div>
                                            <span className="flex items-center gap-2 shrink-0">
                                                <span className="text-sm font-black tabular-nums text-slate-900 dark:text-white">{formatCurrency(v.total)}</span>
                                                <Printer className="w-4 h-4 text-slate-400" />
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {vazio && (
                        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                            {termo ? 'Nenhuma venda encontrada para essa busca.' : 'Nenhuma venda recente para reimprimir.'}
                        </p>
                    )}
                </div>

                <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400"
                    style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
                    Vendas mais antigas: menu Vendas → ícone de impressora na venda.
                </div>
            </div>
        </div>
    );
};

export default ReimprimirCupomModal;
