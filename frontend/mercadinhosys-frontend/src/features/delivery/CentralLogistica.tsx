import { useEffect, useMemo, useState } from 'react';
import { Bike, Route, DollarSign, Fuel, Wallet, Clock, Users, MapPin, Filter } from 'lucide-react';
import deliveryService, { DashboardLogistica, DashboardFiltros, Motorista, Veiculo } from './deliveryService';
import { showToast } from '../../utils/toast';
import { dataLocalISO } from '../../utils/dataLocal';

/**
 * Central Logística — dashboard com filtros (período, entregador, veículo) e
 * métricas ricas: entregas, km, saldo de taxa, combustível, top clientes,
 * bairros e produtos. Dados 100% reais das entregas.
 */

const fmt = (n?: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtInt = (n?: number) => Math.round(n || 0).toLocaleString('pt-BR');

function hojeMenos(dias: number) {
    const d = new Date(); d.setDate(d.getDate() - dias);
    return dataLocalISO(d);
}

const STATUS_COR: Record<string, string> = {
    entregue: 'bg-emerald-500', em_rota: 'bg-blue-500', pendente: 'bg-amber-500',
    em_preparo: 'bg-purple-500', cancelada: 'bg-rose-500',
};

export default function CentralLogistica() {
    const [dados, setDados] = useState<DashboardLogistica | null>(null);
    const [loading, setLoading] = useState(false);
    const [motoristas, setMotoristas] = useState<Motorista[]>([]);
    const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
    const [filtros, setFiltros] = useState<DashboardFiltros>({ data_inicio: hojeMenos(30), data_fim: hojeMenos(0) });

    useEffect(() => {
        deliveryService.getMotoristas(false).then(r => setMotoristas(r.motoristas || r.data || [])).catch(() => { });
        deliveryService.getVeiculos().then(r => setVeiculos(r.veiculos || r.data || [])).catch(() => { });
    }, []);

    useEffect(() => {
        setLoading(true);
        deliveryService.getDashboard(filtros)
            .then(setDados)
            .catch((e: any) => { showToast.error(e?.response?.data?.error || 'Erro ao carregar métricas'); setDados(null); })
            .finally(() => setLoading(false));
    }, [filtros]);

    const totalStatus = useMemo(() => dados ? Object.values(dados.por_status).reduce((a, b) => a + b, 0) : 0, [dados]);
    const k = dados?.kpis;

    return (
        <div className="space-y-6">
            {/* Filtros */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 p-4">
                <div className="flex items-center gap-2 mb-3 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-wider"><Filter className="w-4 h-4" /> Filtros</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">De</label>
                        <input type="date" value={filtros.data_inicio || ''} onChange={e => setFiltros(f => ({ ...f, data_inicio: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Até</label>
                        <input type="date" value={filtros.data_fim || ''} onChange={e => setFiltros(f => ({ ...f, data_fim: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Entregador</label>
                        <select value={filtros.motorista_id || ''} onChange={e => setFiltros(f => ({ ...f, motorista_id: e.target.value ? Number(e.target.value) : undefined }))}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                            <option value="">Todos</option>
                            {motoristas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Veículo</label>
                        <select value={filtros.veiculo_id || ''} onChange={e => setFiltros(f => ({ ...f, veiculo_id: e.target.value ? Number(e.target.value) : undefined }))}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                            <option value="">Todos</option>
                            {veiculos.map(v => <option key={v.id} value={v.id}>{v.placa} · {v.modelo}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="py-16 text-center text-gray-500 text-sm dark:text-gray-400">Calculando métricas…</div>
            ) : !k ? (
                <div className="py-16 text-center text-gray-500 text-sm dark:text-gray-400">Sem dados para os filtros selecionados.</div>
            ) : (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Kpi icon={<Bike className="w-5 h-5" />} cor="text-blue-600" bg="bg-blue-50 dark:bg-blue-500/10" label="Entregas" valor={fmtInt(k.total_entregas)} />
                        <Kpi icon={<Route className="w-5 h-5" />} cor="text-indigo-600" bg="bg-indigo-50 dark:bg-indigo-500/10" label="Km percorridos" valor={`${fmtInt(k.km_total)} km`} />
                        <Kpi icon={<DollarSign className="w-5 h-5" />} cor="text-emerald-600" bg="bg-emerald-50 dark:bg-emerald-500/10" label="Taxa de entrega" valor={fmt(k.taxa_entrega_total)} />
                        <Kpi icon={<Wallet className="w-5 h-5" />} cor="text-teal-600" bg="bg-teal-50 dark:bg-teal-500/10" label="Faturamento delivery" valor={fmt(k.faturamento_delivery)} />
                        <Kpi icon={<Fuel className="w-5 h-5" />} cor="text-orange-600" bg="bg-orange-50 dark:bg-orange-500/10" label="Combustível" valor={fmt(k.combustivel_total)} />
                        <Kpi icon={<DollarSign className="w-5 h-5" />} cor="text-rose-600" bg="bg-rose-50 dark:bg-rose-500/10" label="Comissão entregadores" valor={fmt(k.comissao_total)} />
                        <Kpi icon={<Wallet className="w-5 h-5" />} cor="text-green-600" bg="bg-green-50 dark:bg-green-500/10" label="Saldo taxa (líquido)" valor={fmt(k.saldo_taxa)} />
                        <Kpi icon={<Clock className="w-5 h-5" />} cor="text-slate-600 dark:text-gray-300" bg="bg-slate-100 dark:bg-slate-500/10" label="Tempo médio" valor={`${k.tempo_medio_minutos} min`} />
                    </div>

                    {/* Distribuição por status */}
                    {totalStatus > 0 && (
                        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">Distribuição por status</p>
                            <div className="flex h-3 rounded-full overflow-hidden mb-3">
                                {Object.entries(dados!.por_status).map(([st, q]) => (
                                    <div key={st} className={`${STATUS_COR[st] || 'bg-gray-400'}`} style={{ width: `${(q / totalStatus) * 100}%` }} title={`${st}: ${q}`} />
                                ))}
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs">
                                {Object.entries(dados!.por_status).map(([st, q]) => (
                                    <span key={st} className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                                        <span className={`w-2.5 h-2.5 rounded-full ${STATUS_COR[st] || 'bg-gray-400'}`} /> {st} <b>{q}</b>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tops */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <TopLista titulo="Top clientes (Entregas)" icon={<Users className="w-4 h-4" />}
                            itens={dados!.top_clientes.map(c => ({ nome: c.nome, valor: `${c.entregas} entregas`, extra: fmt(c.taxa) }))} />
                        <TopLista titulo="Top bairros (Regiões)" icon={<MapPin className="w-4 h-4" />}
                            itens={dados!.top_bairros.map(b => ({ nome: b.bairro, valor: `${b.entregas} entregas` }))} />
                        {dados!.top_motoristas && (
                            <TopLista titulo="Top Motoristas (Por Corridas)" icon={<Bike className="w-4 h-4" />}
                                itens={dados!.top_motoristas.map((m: any) => ({ nome: m.nome, valor: `${m.entregas} entregas` }))} />
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function Kpi({ icon, cor, bg, label, valor }: { icon: React.ReactNode; cor: string; bg: string; label: string; valor: string }) {
    return (
        <div className={`rounded-2xl p-4 border border-gray-100 dark:border-gray-700/50 ${bg}`}>
            <div className={`flex items-center gap-2 ${cor} mb-1`}>{icon}<span className="text-[10px] font-bold uppercase tracking-wider">{label}</span></div>
            <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums leading-tight">{valor}</p>
        </div>
    );
}

function TopLista({ titulo, icon, itens }: { titulo: string; icon: React.ReactNode; itens: { nome: string; valor: string; extra?: string }[] }) {
    return (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase mb-3">{icon}{titulo}</div>
            {itens.length === 0 ? (
                <p className="text-sm text-gray-400">Sem dados</p>
            ) : (
                <ol className="space-y-2">
                    {itens.map((it, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 min-w-0">
                                <span className="w-5 h-5 shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 text-[11px] font-black flex items-center justify-center">{i + 1}</span>
                                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{it.nome}</span>
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{it.valor}{it.extra ? ` · ${it.extra}` : ''}</span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
