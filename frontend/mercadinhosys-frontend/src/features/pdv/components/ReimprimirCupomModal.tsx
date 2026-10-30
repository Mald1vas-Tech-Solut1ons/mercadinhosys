import React, { useEffect, useState } from 'react';
import { Printer, X, WifiOff, Search } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';
import { dataLocalISO } from '../../../utils/dataLocal';
import { formatCurrency } from '../../../utils/formatters';
import { CupomRecente, listarCuponsRecentes } from '../cupomLocal';

interface ReimprimirCupomModalProps {
    aberto: boolean;
    onFechar: () => void;
    onEscolher: (cupom: CupomRecente) => void;
}

/**
 * Últimas vendas para reimprimir o cupom: as deste aparelho (inclusive offline, ainda não
 * sincronizadas) e, com internet, as de hoje no servidor (outro caixa ou já sincronizadas).
 */
const ReimprimirCupomModal: React.FC<ReimprimirCupomModalProps> = ({ aberto, onFechar, onEscolher }) => {
    const [cupons, setCupons] = useState<CupomRecente[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [busca, setBusca] = useState('');
    useBodyScrollLock(aberto);

    useEffect(() => {
        if (!aberto) return;
        setBusca('');
        const locais = listarCuponsRecentes();
        setCupons(locais);
        if (!navigator.onLine) return;
        let ativo = true;
        setCarregando(true);
        const hoje = dataLocalISO();
        apiClient.get('/vendas', { params: { page: 1, per_page: 50, data_inicio: hoje, data_fim: hoje } })
            .then(({ data }) => {
                if (!ativo) return;
                const lista: any[] = data?.vendas || data?.data || [];
                const doServidor: CupomRecente[] = lista
                    .filter(v => v?.id && v.status !== 'cancelada')
                    .map(v => ({
                        chave: String(v.id), codigo: v.codigo, data: v.data_venda || v.created_at || v.data,
                        total: Number(v.total) || 0, vendaId: Number(v.id), offline: false,
                    }));
                const ids = new Set(doServidor.map(c => c.chave));
                const juntos = [...locais.filter(c => !ids.has(c.chave)), ...doServidor]
                    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
                setCupons(juntos);
            })
            .catch(() => { /* sem permissão ou sem rede: fica a lista deste aparelho */ })
            .finally(() => { if (ativo) setCarregando(false); });
        return () => { ativo = false; };
    }, [aberto]);

    if (!aberto) return null;

    const termo = busca.trim().toLowerCase();
    const visiveis = termo
        ? cupons.filter(c => c.codigo.toLowerCase().includes(termo) || formatCurrency(c.total).includes(termo))
        : cupons;

    const quando = (iso: string) => {
        const d = new Date(iso);
        return isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
            onClick={e => e.target === e.currentTarget && onFechar()}>
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[85dvh]">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <Printer className="w-5 h-5 text-blue-600" />
                        <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Reimprimir cupom</p>
                    </div>
                    <button onClick={onFechar} aria-label="Fechar"
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="px-4 pt-3">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Código da venda ou valor"
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-2">
                    {carregando && cupons.length === 0 && (
                        <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando vendas de hoje...</p>
                    )}
                    {!carregando && visiveis.length === 0 && (
                        <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                            Nenhuma venda recente. Vendas de outros dias: menu Vendas → abrir a venda → Imprimir cupom.
                        </p>
                    )}
                    {visiveis.map(c => (
                        <button key={c.chave} type="button" onClick={() => onEscolher(c)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 active:bg-blue-100 text-left">
                            <span className="min-w-0">
                                <span className="flex items-center gap-1.5 font-mono font-bold text-sm text-slate-900 dark:text-white">
                                    {c.offline && <WifiOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                                    {c.codigo}
                                </span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">
                                    {quando(c.data)}{c.offline ? ' · offline' : ''}
                                </span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                                <span className="font-black tabular-nums text-slate-900 dark:text-white">{formatCurrency(c.total)}</span>
                                <Printer className="w-4 h-4 text-blue-600" />
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ReimprimirCupomModal;
