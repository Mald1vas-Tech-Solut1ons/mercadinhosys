import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, MapPin, User, Truck, Clock, Navigation, FileText } from 'lucide-react';
import deliveryService, { DetalheEntregaResposta } from './deliveryService';

/**
 * Detalhe do pedido de venda vinculado à entrega: itens, data da venda,
 * cliente, endereço, valores e a linha do tempo de rastreamento (eventos
 * com posição). Aberto ao clicar num card de entrega.
 */

interface Props {
    entregaId: number | null;
    onClose: () => void;
}

const fmt = (n?: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (s?: string | null) => s ? new Date(s).toLocaleString('pt-BR') : '—';

/** Duração relativa da entrega: minutos → "45 min" ou "1h 05min". */
function duracao(min?: number | null): string | null {
    if (min == null || min < 0) return null;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`;
}

const STATUS_LABEL: Record<string, string> = {
    saiu_para_entrega: 'Saiu para entrega', chegou_no_local: 'Chegou no local',
    entrega_concluida: 'Entrega concluída', pendente: 'Pendente', em_rota: 'Em rota',
    entregue: 'Entregue', cancelada: 'Cancelada',
};

export default function DetalheEntregaModal({ entregaId, onClose }: Props) {
    const [dados, setDados] = useState<DetalheEntregaResposta | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!entregaId) { setDados(null); return; }
        setLoading(true);
        deliveryService.getDetalheEntrega(entregaId)
            .then(setDados)
            .catch(() => setDados(null))
            .finally(() => setLoading(false));
    }, [entregaId]);

    if (!entregaId) return null;
    const e = dados?.entrega;
    const v = dados?.venda;

    return createPortal(
        <div className="fixed inset-0 z-200 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 w-full sm:max-w-2xl sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
                {/* Header */}
                <div className="sticky top-0 bg-linear-to-r from-blue-700 to-indigo-800 text-white p-5 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-white/15"><Package className="w-5 h-5" /></div>
                        <div>
                            <h3 className="font-black text-lg leading-tight">Pedido {e?.codigo_rastreamento || ''}</h3>
                            <p className="text-white/70 text-xs">{v ? `Venda ${v.codigo} · ${dataHora(v.data_venda)}` : 'Detalhe da entrega'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/15"><X className="w-5 h-5" /></button>
                </div>

                {loading ? (
                    <div className="py-16 text-center text-gray-500 text-sm">Carregando pedido…</div>
                ) : !dados ? (
                    <div className="py-16 text-center text-gray-500 text-sm">Não foi possível carregar o pedido.</div>
                ) : (
                    <div className="p-5 space-y-5">
                        {/* Resumo cliente / entregador / veículo */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Info icon={<User className="w-4 h-4" />} label="Cliente" valor={e?.cliente_nome || v?.cliente_nome || '—'} />
                            <Info icon={<Truck className="w-4 h-4" />} label="Entregador" valor={e?.motorista_nome || 'Não atribuído'} />
                            <Info icon={<Navigation className="w-4 h-4" />} label="Veículo" valor={e?.veiculo_placa || '—'} />
                        </div>

                        {/* Linha de tempo da entrega (saída → conclusão) */}
                        {(e?.data_saida || e?.data_entrega) && (
                            <div className="rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 p-4">
                                <div className="flex items-center justify-between flex-wrap gap-3">
                                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                                        <Clock className="w-5 h-5" />
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400">Tempo de entrega</p>
                                            <p className="text-2xl font-black leading-none">{duracao(e?.tempo_real_minutos) || 'Em andamento'}</p>
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-600 dark:text-gray-300 text-right">
                                        <p>Saída: <b>{dataHora(e?.data_saida)}</b></p>
                                        <p>Entregue: <b>{dataHora(e?.data_entrega)}</b></p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Endereço */}
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase mb-1"><MapPin className="w-4 h-4" /> Endereço de entrega</div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{e?.endereco_completo || '—'}</p>
                            <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                                <span>Bairro: <b className="text-gray-700 dark:text-gray-300">{e?.endereco_bairro || '—'}</b></span>
                                <span>Distância: <b className="text-gray-700 dark:text-gray-300">{(e?.distancia_km || 0).toLocaleString('pt-BR')} km</b></span>
                                <span>Taxa: <b className="text-emerald-600 dark:text-emerald-400">{fmt(e?.taxa_entrega)}</b></span>
                            </div>
                        </div>

                        {/* Itens da venda */}
                        <div>
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase mb-2"><FileText className="w-4 h-4" /> Itens do pedido ({dados.itens.length})</div>
                            <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
                                        <tr><th className="text-left px-3 py-2 font-bold text-xs uppercase">Produto</th><th className="text-center px-3 py-2 font-bold text-xs uppercase">Qtd</th><th className="text-right px-3 py-2 font-bold text-xs uppercase">Total</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {dados.itens.length === 0 ? (
                                            <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400 text-sm">Sem itens vinculados</td></tr>
                                        ) : dados.itens.map((it, i) => (
                                            <tr key={i}>
                                                <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{it.produto_nome}</td>
                                                <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-300">{it.quantidade.toLocaleString('pt-BR')} {it.produto_unidade || ''}</td>
                                                <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">{fmt(it.total_item)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    {v && (
                                        <tfoot className="bg-gray-50 dark:bg-gray-800/60 border-t-2 border-gray-200 dark:border-gray-700">
                                            <tr className="text-xs"><td className="px-3 py-2 text-right text-gray-500" colSpan={2}>Subtotal</td><td className="px-3 py-2 text-right font-semibold">{fmt(v.subtotal)}</td></tr>
                                            {v.desconto > 0 && <tr className="text-xs"><td className="px-3 py-2 text-right text-gray-500" colSpan={2}>Desconto</td><td className="px-3 py-2 text-right text-rose-500">- {fmt(v.desconto)}</td></tr>}
                                            <tr className="text-xs"><td className="px-3 py-2 text-right text-gray-500" colSpan={2}>Total dos produtos</td><td className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">{fmt(v.total)}</td></tr>
                                            <tr className="text-xs"><td className="px-3 py-2 text-right text-gray-500" colSpan={2}>Taxa de entrega</td><td className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">+ {fmt(e?.taxa_entrega)}</td></tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                            {/* Total a cobrar em destaque — inclui a taxa, para o entregador nunca cobrar errado */}
                            {v && (
                                <div className="mt-3 rounded-xl bg-emerald-600 dark:bg-emerald-700 text-white p-4 flex items-center justify-between shadow-lg shadow-emerald-600/20">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">Total a cobrar do cliente</p>
                                        <p className="text-[10px] text-emerald-100/80">Produtos + taxa de entrega</p>
                                    </div>
                                    <p className="text-2xl font-black">{fmt(v.total_com_taxa)}</p>
                                </div>
                            )}
                        </div>

                        {/* Linha do tempo de rastreamento */}
                        <div>
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase mb-2"><Clock className="w-4 h-4" /> Rastreamento</div>
                            {dados.rastreamento.length === 0 ? (
                                <p className="text-sm text-gray-400">Nenhum evento de rastreamento ainda.</p>
                            ) : (
                                <ol className="relative border-l-2 border-blue-200 dark:border-blue-900 ml-2 space-y-4">
                                    {dados.rastreamento.map(ev => (
                                        <li key={ev.id} className="ml-4">
                                            <div className="absolute left-[-9px] w-4 h-4 rounded-full bg-blue-600 border-2 border-white dark:border-gray-900" />
                                            <p className="text-sm font-bold text-gray-900 dark:text-white">{STATUS_LABEL[ev.status] || ev.status}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">{dataHora(ev.data_hora)}{ev.latitude ? ` · 📍 ${ev.latitude.toFixed(4)}, ${ev.longitude?.toFixed(4)}` : ''}</p>
                                            {ev.observacao && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{ev.observacao}</p>}
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}

function Info({ icon, label, valor }: { icon: React.ReactNode; label: string; valor: string }) {
    return (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
            <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-bold uppercase tracking-wider">{icon}{label}</div>
            <p className="text-sm font-bold text-gray-900 dark:text-white mt-1 truncate">{valor}</p>
        </div>
    );
}
