import React, { useState, useEffect, useMemo } from 'react';
import {
    Search, User, Clock, MapPin, Hash, Truck, CheckCircle2, XCircle,
    Package, Loader2, DollarSign, Eye,
} from 'lucide-react';
import { deliveryService, Entrega } from './deliveryService';
import DetalheEntregaModal from './DetalheEntregaModal';
import toast from 'react-hot-toast';
import AcertoEntregaModal from './AcertoEntregaModal';
import { authService } from '../auth/authService';
import { canAccess } from '../../utils/permissions';

// Configuração visual e de fluxo por status (paleta oficial do app)
const STATUS_CONFIG: Record<string, { label: string; classe: string; dot: string }> = {
    pendente:    { label: 'Pendente',   classe: 'bg-warning-100 text-warning-700 border-warning-200', dot: 'bg-warning-500' },
    em_preparo:  { label: 'Em preparo', classe: 'bg-warning-100 text-warning-700 border-warning-200', dot: 'bg-warning-500' },
    em_rota:     { label: 'Em rota',    classe: 'bg-primary-100 text-primary-700 border-primary-200', dot: 'bg-primary-500' },
    entregue:    { label: 'Entregue',   classe: 'bg-success-100 text-success-700 border-success-200', dot: 'bg-success-500' },
    cancelada:   { label: 'Cancelada',  classe: 'bg-error-100 text-error-700 border-error-200',       dot: 'bg-error-500' },
};

const FILTROS: Array<{ key: string; label: string }> = [
    { key: 'todos', label: 'Todas' },
    { key: 'pendente', label: 'Pendentes' },
    { key: 'em_rota', label: 'Em rota' },
    { key: 'entregue', label: 'Entregues' },
    { key: 'cancelada', label: 'Canceladas' },
    { key: 'acerto_pendente', label: 'Acertos pendentes' },
];

const formatCurrency = (v: number) =>
    (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Tempo real da entrega (minutos) → "45 min" / "1h 05min". */
const duracaoEntrega = (min?: number | null): string | null => {
    if (min == null || min < 0) return null;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`;
};

const DeliveryList: React.FC = () => {
    const [entregas, setEntregas] = useState<Entrega[]>([]);
    const [loading, setLoading] = useState(false);
    const [filtroStatus, setFiltroStatus] = useState('todos');
    const [busca, setBusca] = useState('');
    const [acaoId, setAcaoId] = useState<number | null>(null);
    const [motoristas, setMotoristas] = useState<any[]>([]);

    // Modal de Despacho
    const [despachoModalAberto, setDespachoModalAberto] = useState(false);
    const [entregaParaDespacho, setEntregaParaDespacho] = useState<Entrega | null>(null);
    const [motoristaDespachoId, setMotoristaDespachoId] = useState('');
    const [detalheId, setDetalheId] = useState<number | null>(null);
    const [acerto, setAcerto] = useState<Entrega | null>(null);
    const usuario = authService.getCurrentUser();
    const podeReceber = canAccess('gestao_caixa', usuario);

    useEffect(() => {
        carregarEntregas();
        carregarMotoristas();
    }, [filtroStatus]);

    const carregarMotoristas = async () => {
        try {
            const res = await deliveryService.getMotoristas(true);
            setMotoristas(res.motoristas || res.data || []);
        } catch { }
    };

    const carregarEntregas = async () => {
        try {
            setLoading(true);
            const res = await deliveryService.getEntregas(filtroStatus);
            if (res.success) setEntregas(res.entregas);
        } catch {
            toast.error('Erro ao listar entregas');
        } finally {
            setLoading(false);
        }
    };

    // Próximo passo do fluxo operacional
    const proximoPasso = (status: string): { novo: string; label: string; icon: React.ElementType } | null => {
        if (status === 'pendente' || status === 'em_preparo') return { novo: 'em_rota', label: 'Despachar', icon: Truck };
        if (status === 'em_rota') return { novo: 'entregue', label: 'Confirmar entrega', icon: CheckCircle2 };
        return null;
    };

    const avancarStatus = async (entrega: Entrega, novoStatus: string) => {
        if (novoStatus === 'em_rota' && !(entrega as any).motorista_id) {
            setEntregaParaDespacho(entrega);
            setDespachoModalAberto(true);
            return;
        }
        
        executarAvanco(entrega.id, novoStatus, (entrega as any).motorista_id);
    };

    const executarAvanco = async (entregaId: number, novoStatus: string, motoristaId: number | null, observacao?: string) => {
        setAcaoId(entregaId);
        try {
            const payload: Record<string, unknown> = {};
            if (observacao) payload.observacao = observacao;
            if (novoStatus === 'em_rota') payload.motorista_id = motoristaId;
            const res = await deliveryService.atualizarStatus(entregaId, novoStatus, payload);
            if (res.success) {
                toast.success(`Entrega atualizada: ${STATUS_CONFIG[novoStatus]?.label || novoStatus}`);
                await carregarEntregas();
            } else {
                toast.error(res.error || 'Não foi possível atualizar a entrega');
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Erro ao atualizar status da entrega');
        } finally {
            setAcaoId(null);
        }
    };

    const cancelarEntrega = async (entrega: Entrega) => {
        const motivo = window.prompt(`Motivo do cancelamento da entrega ${entrega.codigo_rastreamento}. A venda deve ser tratada separadamente no financeiro.`);
        if (!motivo?.trim()) return;
        await executarAvanco(entrega.id, 'cancelada', null, motivo.trim());
    };

    const entregasFiltradas = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        if (!termo) return entregas;
        return entregas.filter((e) =>
            e.codigo_rastreamento?.toLowerCase().includes(termo) ||
            e.cliente_nome?.toLowerCase().includes(termo) ||
            e.endereco_bairro?.toLowerCase().includes(termo) ||
            String((e as any).venda_id || '').includes(termo),
        );
    }, [entregas, busca]);

    return (
        <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
            {/* Toolbar */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar por código, cliente, venda ou bairro..."
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-transparent rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                    />
                </div>

                <div className="flex bg-gray-50 dark:bg-gray-900 p-1 rounded-xl overflow-x-auto">
                    {FILTROS.map((f) => (
                        <button
                            key={f.key}
                            onClick={() => setFiltroStatus(f.key)}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                                filtroStatus === f.key
                                    ? 'bg-white dark:bg-gray-800 shadow-sm text-primary-600'
                                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Grid de cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {loading ? (
                    Array(6).fill(0).map((_, i) => (
                        <div key={i} className="h-72 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-3xl" />
                    ))
                ) : entregasFiltradas.map((entrega) => {
                    const cfg = STATUS_CONFIG[entrega.status] || STATUS_CONFIG.pendente;
                    const passo = proximoPasso(entrega.status);
                    const Icon = passo?.icon || Package;
                    const ocupado = acaoId === entrega.id;
                    const vendaId = (entrega as any).venda_id;

                    return (
                        <div
                            key={entrega.id}
                            className="bg-white dark:bg-gray-800 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-xl transition-all flex flex-col"
                        >
                            {/* Topo: status + venda vinculada */}
                            <div className="flex justify-between items-start mb-4">
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${cfg.classe}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                                    {cfg.label}
                                </span>
                                <button
                                    onClick={() => setDetalheId(entrega.id)}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:text-primary-700 hover:underline"
                                    title="Abrir pedido"
                                >
                                    <Eye className="w-3.5 h-3.5" /> {vendaId ? `Venda #${vendaId}` : 'Ver pedido'}
                                </button>
                            </div>

                            {/* Cliente em destaque — clique abre o pedido completo */}
                            <button
                                type="button"
                                onClick={() => setDetalheId(entrega.id)}
                                className="flex items-center gap-3 mb-4 text-left w-full group"
                            >
                                <div className="w-11 h-11 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-600 shrink-0">
                                    <User className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="font-bold text-gray-900 dark:text-white text-base truncate group-hover:text-primary-600">
                                        {entrega.cliente_nome || 'Cliente não identificado'}
                                    </h3>
                                    <p className="text-xs text-gray-400 font-mono flex items-center gap-1">
                                        <Hash className="w-3 h-3" /> {entrega.codigo_rastreamento}
                                    </p>
                                </div>
                            </button>

                            {/* Infos */}
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                        <Truck className="w-3 h-3" /> Motorista
                                    </p>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200 truncate">
                                        {entrega.motorista_nome || 'A despachar'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> Previsão
                                    </p>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">
                                        {entrega.data_prevista
                                            ? new Date(entrega.data_prevista).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                            : '--:--'}
                                    </p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                        <MapPin className="w-3 h-3" /> Endereço
                                    </p>
                                    <p className="font-medium text-gray-600 dark:text-gray-300 text-xs truncate">
                                        {(entrega as any).endereco_completo || entrega.endereco_bairro || 'Endereço não informado'}
                                    </p>
                                </div>
                            </div>

                            {/* Taxa + tempo real de entrega */}
                            <div className="mt-4 flex items-center justify-between rounded-xl bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                    <DollarSign className="w-3.5 h-3.5" /> Taxa de entrega
                                </span>
                                <div className="flex items-center gap-2">
                                    {duracaoEntrega((entrega as any).tempo_real_minutos) && (
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400 px-2 py-1 rounded-md">
                                            <Clock className="w-3 h-3" /> {duracaoEntrega((entrega as any).tempo_real_minutos)}
                                        </div>
                                    )}
                                    <span className="font-black text-gray-800 dark:text-white">
                                        {formatCurrency(Number(entrega.taxa_entrega || 0))}
                                    </span>
                                </div>
                            </div>

                            {/* Ações que FUNCIONAM */}
                            {entrega.pagamento_status === 'pendente' && Number(entrega.valor_a_receber) > 0 && entrega.status !== 'cancelada' && (
                                <div className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
                                    <p>Acerto pendente: <b>{formatCurrency(Number(entrega.valor_a_receber))}</b></p>
                                    {podeReceber && <button disabled={ocupado} onClick={() => setAcerto(entrega)} className="mt-2 rounded-lg bg-primary-600 text-white px-3 py-2">Registrar recebimento</button>}
                                </div>
                            )}
                            <div className="pt-4 mt-auto flex items-center gap-2">
                                {passo ? (
                                    <button
                                        onClick={() => avancarStatus(entrega, passo.novo)}
                                        disabled={ocupado}
                                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-50"
                                    >
                                        {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                                        {passo.label}
                                    </button>
                                ) : (
                                    <div className="flex-1 text-center text-xs font-semibold text-gray-400 py-2.5">
                                        {entrega.status === 'entregue' ? 'Entrega concluída' : 'Entrega encerrada'}
                                    </div>
                                )}

                                {entrega.status !== 'entregue' && entrega.status !== 'cancelada' && (
                                    <button
                                        onClick={() => cancelarEntrega(entrega)}
                                        disabled={ocupado}
                                        title="Cancelar entrega"
                                        className="inline-flex items-center justify-center rounded-xl border border-error-200 bg-error-50 px-3 py-2.5 text-error-600 transition hover:bg-error-100 disabled:opacity-50 dark:bg-error-900/20 dark:border-error-800"
                                    >
                                        <XCircle className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {!loading && entregasFiltradas.length === 0 && (
                <div className="py-24 text-center">
                    <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Package className="w-10 h-10 text-gray-300" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Nenhuma entrega encontrada</h3>
                    <p className="text-gray-500">
                        {busca ? 'Nenhum resultado para a busca.' : 'Crie uma nova entrega ou ajuste os filtros.'}
                    </p>
                </div>
            )}

            <DetalheEntregaModal entregaId={detalheId} onClose={() => setDetalheId(null)} />
            {acerto && <AcertoEntregaModal entrega={acerto} onClose={() => setAcerto(null)} onSuccess={() => { setAcerto(null); carregarEntregas(); }} />}

            {/* Modal de Despacho (quando clica em Despachar e não tem motorista) */}
            {despachoModalAberto && entregaParaDespacho && (
                <div className="fixed inset-0 z-150 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-3xl shadow-2xl p-6">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                            Atribuir Motorista
                        </h3>
                        <p className="text-sm text-gray-500 mb-6">
                            Para despachar a entrega <b>#{entregaParaDespacho.codigo_rastreamento}</b>, selecione o motorista:
                        </p>

                        <select
                            value={motoristaDespachoId}
                            onChange={(e) => setMotoristaDespachoId(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 mb-6 text-gray-900 dark:text-white"
                        >
                            <option value="">Selecione um entregador...</option>
                            {motoristas.map(m => (
                                <option key={m.id} value={m.id}>{m.nome}</option>
                            ))}
                        </select>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => { setDespachoModalAberto(false); setMotoristaDespachoId(''); }}
                                className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                disabled={!motoristaDespachoId}
                                onClick={() => {
                                    setDespachoModalAberto(false);
                                    executarAvanco(entregaParaDespacho.id, 'em_rota', Number(motoristaDespachoId));
                                    setMotoristaDespachoId('');
                                }}
                                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                Confirmar Despacho
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeliveryList;
