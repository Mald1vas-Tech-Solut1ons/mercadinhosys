import React, { useEffect, useState, useCallback, useRef } from 'react';
import { authService } from '../auth/authService';
import { deliveryService, Entrega } from './deliveryService';
import { apiClient } from '../../api/apiClient';
import {
    Navigation, MapPin, Phone, CheckCircle2, Clock,
    PackageCheck, Truck, AlertCircle, RefreshCw,
    Smartphone, Package, Radio, WifiOff, Fuel, CalendarDays, Timer, Wrench
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import DetalheEntregaModal from './DetalheEntregaModal';
import { AbastecimentoModal } from './AbastecimentoModal';
import { MeuVeiculoPanel } from './MeuVeiculoPanel';



// ─── Detecta mobile ───────────────────────────────────────────────────────────
const isMobile = () =>
    window.innerWidth < 900 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// ─── Intervalo de envio GPS (ms) ─────────────────────────────────────────────
const GPS_INTERVAL_MS = 15_000; // 15 segundos

// ─── Hook: GPS Tracker ────────────────────────────────────────────────────────
// Quando ativo, captura a posição do celular a cada 15s e envia para o backend.
// Para de enviar automaticamente quando `entregaAtiva` for null.
function useGpsTracker(entregaAtiva: Entrega | null) {
    const [gpsStatus, setGpsStatus] = useState<'idle' | 'tracking' | 'denied' | 'unsupported'>('idle');
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const watchRef = useRef<number | null>(null);
    const lastPosRef = useRef<GeolocationCoordinates | null>(null);

    const enviarPing = useCallback(async (coords: GeolocationCoordinates, entrega: Entrega) => {
        try {
            await apiClient.post('/logistica/eventos', {
                venda_id: entrega.venda_id,
                status: 'em_rota',
                latitude: coords.latitude,
                longitude: coords.longitude,
            });
        } catch {
            // Falha silenciosa no ping — não interrompe o motorista
        }
    }, []);

    useEffect(() => {
        // Para tudo se não há entrega ativa em rota
        if (!entregaAtiva || entregaAtiva.status !== 'em_rota') {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
            setGpsStatus('idle');
            return;
        }

        if (!navigator.geolocation) {
            setGpsStatus('unsupported');
            return;
        }

        // Pede permissão e começa a rastrear
        watchRef.current = navigator.geolocation.watchPosition(
            (pos) => {
                lastPosRef.current = pos.coords;
                setGpsStatus('tracking');
            },
            (err) => {
                if (err.code === err.PERMISSION_DENIED) setGpsStatus('denied');
            },
            { enableHighAccuracy: true, maximumAge: 10_000 }
        );

        // Envia ping a cada 15s usando a última posição conhecida
        intervalRef.current = setInterval(() => {
            if (lastPosRef.current) {
                enviarPing(lastPosRef.current, entregaAtiva);
            }
        }, GPS_INTERVAL_MS);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
        };
    }, [entregaAtiva, enviarPing]);

    return gpsStatus;
}

// ─── Configuração visual por status ──────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
    pendente:   { label: 'Aguardando',  color: 'text-amber-700',  bg: 'bg-amber-100',   icon: Clock },
    em_preparo: { label: 'Em Preparo',  color: 'text-blue-700',   bg: 'bg-blue-100',    icon: PackageCheck },
    em_rota:    { label: 'Em Rota',     color: 'text-indigo-700', bg: 'bg-indigo-100',  icon: Truck },
    entregue:   { label: 'Entregue',    color: 'text-green-700',  bg: 'bg-green-100',   icon: CheckCircle2 },
    cancelada:  { label: 'Cancelada',   color: 'text-red-700',    bg: 'bg-red-100',     icon: AlertCircle },
};

// ─── Cronômetro Dinâmico ──────────────────────────────────────────────────────
const Cronometro: React.FC<{ dataSaida?: string }> = ({ dataSaida }) => {
    const [tempoRodado, setTempoRodado] = useState<string>('00:00');

    useEffect(() => {
        if (!dataSaida) return;
        const start = new Date(dataSaida).getTime();
        const updateTimer = () => {
            const diff = Math.floor((Date.now() - start) / 1000); // Em segundos
            if (diff < 0) return;
            const m = Math.floor(diff / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            setTempoRodado(`${m}:${s}`);
        };
        updateTimer();
        const t = setInterval(updateTimer, 1000);
        return () => clearInterval(t);
    }, [dataSaida]);

    if (!dataSaida) return null;
    return (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-black animate-pulse">
            <Timer className="w-3.5 h-3.5" />
            {tempoRodado}
        </div>
    );
};

// ─── Card de cada entrega ─────────────────────────────────────────────────────
const CardEntrega: React.FC<{ entrega: Entrega; onRefresh: () => void; onClickDetalhes: () => void; assumindo?: boolean; meuMotoristaId?: number | null }> = ({ entrega, onRefresh, onClickDetalhes, assumindo = false, meuMotoristaId = null }) => {
    const [loading, setLoading] = useState(false);
    
    let next = '';
    let labelAcao = '';
    if (assumindo) {
        labelAcao = 'Assumir e Iniciar';
        next = 'em_rota';
    } else if (entrega.status === 'em_preparo' || entrega.status === 'pendente') {
        labelAcao = 'Iniciar Entrega';
        next = 'em_rota';
    } else if (entrega.status === 'em_rota') {
        labelAcao = 'Confirmar Entrega';
        next = 'entregue';
    }

    const cfg = STATUS_CFG[entrega.status] ?? STATUS_CFG['pendente'];
    const Icon = cfg.icon;

    const handleAcao = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!next) return;
        
        if (assumindo && !meuMotoristaId) {
            toast.error("Motorista não identificado. Confira seu CPF no cadastro de funcionário e de motorista.");
            return;
        }

        setLoading(true);
        try {
            const payload: any = {};
            if (next === 'em_rota') {
                payload.motorista_id = meuMotoristaId || (entrega as any).motorista_id;
            }
            
            await deliveryService.atualizarStatus(entrega.id, next, payload);
            toast.success(
                next === 'em_rota'
                    ? '🚀 Rota iniciada! GPS ativado automaticamente.'
                    : '✅ Entrega confirmada! GPS desativado.'
            );
            onRefresh();
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Erro ao atualizar status');
        } finally {
            setLoading(false);
        }
    };

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entrega.endereco_completo)}`;
    const telefone = (entrega as any).cliente_telefone?.replace(/\D/g, '');
    const wppUrl = telefone
        ? `https://wa.me/55${telefone}?text=${encodeURIComponent(
            `Olá! Sou o entregador. Estou a caminho com seu pedido #${entrega.codigo_rastreamento} 🛵`
          )}`
        : null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden"
        >
            <div 
                className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={onClickDetalhes}
            >
                <div>
                    <p className="text-[10px] font-mono text-gray-400">#{entrega.codigo_rastreamento}</p>
                    <p className="font-bold text-gray-900 dark:text-white text-sm">{entrega.cliente_nome || 'Cliente'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${cfg.bg} ${cfg.color}`}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                    </span>
                    {entrega.status === 'em_rota' && entrega.data_saida && (
                        <Cronometro dataSaida={entrega.data_saida} />
                    )}
                </div>
            </div>

            <div className="flex items-start gap-3 px-4 py-3">
                <MapPin className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200 leading-snug">{entrega.endereco_completo}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{entrega.endereco_bairro}</p>
                </div>
            </div>

            {entrega.status !== 'entregue' && entrega.status !== 'cancelada' && (
                <div className="flex gap-2 p-3 bg-gray-50 dark:bg-gray-900/30 flex-wrap">
                    <button
                        onClick={onClickDetalhes}
                        className="flex-1 min-w-[30%] flex items-center justify-center gap-1.5 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-200 hover:border-blue-400 transition-all"
                    >
                        <Package className="w-4 h-4 text-blue-500" />
                        Pedido
                    </button>
                    
                    <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 min-w-[30%] flex items-center justify-center gap-1.5 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-200 hover:border-blue-400 transition-all"
                    >
                        <Navigation className="w-4 h-4 text-blue-500" />
                        Navegar
                    </a>

                    {wppUrl && (
                        <a
                            href={wppUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 flex items-center justify-center px-4 py-2.5 bg-green-500 hover:bg-green-600 rounded-xl text-white transition-all"
                        >
                            <Phone className="w-4 h-4" />
                        </a>
                    )}

                    {labelAcao && (
                        <button
                            onClick={handleAcao}
                            disabled={loading}
                            className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 mt-1 ${
                                next === 'em_rota'
                                    ? 'bg-indigo-600 hover:bg-indigo-700'
                                    : 'bg-green-600 hover:bg-green-700'
                            }`}
                        >
                            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : labelAcao}
                        </button>
                    )}
                </div>
            )}
        </motion.div>
    );
};

// ─── Badge de status GPS ──────────────────────────────────────────────────────
const GpsBadge: React.FC<{ status: string }> = ({ status }) => {
    if (status === 'idle') return null;
    if (status === 'unsupported') return null;

    if (status === 'denied') return (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-3 py-2 text-xs font-medium">
            <WifiOff className="w-3.5 h-3.5" />
            GPS negado — Gerente não vê sua posição
        </div>
    );

    return (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl px-3 py-2 text-xs font-medium">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            GPS ativo — Transmitindo posição a cada 15s
        </div>
    );
};
// ─── Abertura de Turno ───────────────────────────────────────────────────────────
const AberturaTurno: React.FC<{ onTurnoIniciado: () => void, motoristaId: number | null }> = ({ onTurnoIniciado, motoristaId }) => {
    const [kmInicial, setKmInicial] = useState('');
    const [veiculos, setVeiculos] = useState<any[]>([]);
    const [veiculoId, setVeiculoId] = useState<number | ''>('');
    const [combustivel, setCombustivel] = useState('gasolina');
    const [loading, setLoading] = useState(false);
    const [checklist, setChecklist] = useState([
        { item: 'Luzes e Farol', ok: false },
        { item: 'Setas', ok: false },
        { item: 'Pneus', ok: false },
        { item: 'Freios', ok: false },
        { item: 'EPIs (Capacete, Colete)', ok: false },
        { item: 'Antena Corta Pipa', ok: false }
    ]);

    const checklistProgress = checklist.length > 0 ? (checklist.filter(c => c.ok).length / checklist.length) * 100 : 100;
    const isChecklistComplete = checklistProgress === 100;

    useEffect(() => {
        deliveryService.getVeiculos().then(res => {
            const veics = res.veiculos || res.data || [];
            setVeiculos(veics);
            if (veics.length === 1) setVeiculoId(veics[0].id);
        }).catch(() => {});
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!kmInicial || isNaN(Number(kmInicial))) return toast.error('KM Inicial inválido');
        setLoading(true);
        try {
            await deliveryService.iniciarTurno({
                km_inicial: Number(kmInicial),
                veiculo_id: veiculoId ? Number(veiculoId) : undefined,
                tipo_combustivel: combustivel,
                checklist,
                motorista_id: motoristaId ? Number(motoristaId) : undefined
            });
            toast.success('Turno iniciado com sucesso!');
            onTurnoIniciado();
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Erro ao iniciar turno');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col p-5">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md mx-auto mt-10">
                <div className="bg-blue-600 rounded-t-3xl p-6 text-white text-center">
                    <Truck className="w-12 h-12 mx-auto mb-3 opacity-90" />
                    <h1 className="text-2xl font-black">Iniciar Turno</h1>
                    <p className="text-blue-200 text-sm mt-1">Preencha os dados para começar a rodar</p>
                </div>
                
                <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-b-3xl p-6 shadow-xl border border-t-0 border-gray-100 dark:border-gray-800 space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">KM Inicial (Painel)</label>
                        <input
                            type="number"
                            required
                            value={kmInicial}
                            onChange={e => setKmInicial(e.target.value)}
                            placeholder="Ex: 12500"
                            className="w-full bg-gray-50 dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 font-bold text-gray-900 dark:text-white text-lg focus:border-blue-500 outline-none transition-colors"
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Veículo Utilizado</label>
                        <select
                            value={veiculoId}
                            onChange={e => setVeiculoId(Number(e.target.value))}
                            className="w-full bg-gray-50 dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 font-bold text-gray-900 dark:text-white focus:border-blue-500 outline-none transition-colors"
                        >
                            <option value="">(Nenhum / Não Cadastrado)</option>
                            {veiculos.map(v => (
                                <option key={v.id} value={v.id}>{v.placa} - {v.modelo}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Tipo Combustível</label>
                        <select
                            value={combustivel}
                            onChange={e => setCombustivel(e.target.value)}
                            className="w-full bg-gray-50 dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 font-bold text-gray-900 dark:text-white focus:border-blue-500 outline-none transition-colors"
                        >
                            <option value="gasolina">Gasolina</option>
                            <option value="alcool">Álcool</option>
                            <option value="diesel">Diesel</option>
                        </select>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/10 rounded-2xl p-4 border border-amber-100 dark:border-amber-800/30">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold text-amber-800 dark:text-amber-400 text-sm flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4" /> Checklist Diário do Veículo
                            </h3>
                            <span className="text-xs font-bold text-amber-700 dark:text-amber-500">
                                {Math.round(checklistProgress)}%
                            </span>
                        </div>
                        <div className="w-full bg-amber-200/50 dark:bg-amber-800/30 rounded-full h-2 mb-4 overflow-hidden">
                            <div 
                                className="bg-amber-500 h-2 rounded-full transition-all duration-500 ease-out" 
                                style={{ width: `${checklistProgress}%` }}
                            ></div>
                        </div>
                        <div className="space-y-3">
                            {checklist.map((item, idx) => (
                                <label key={idx} className="flex items-center gap-3 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={item.ok}
                                        onChange={e => {
                                            setChecklist(checklist.map((c, i) => i === idx ? { ...c, ok: e.target.checked } : c));
                                        }}
                                        className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 bg-white border-gray-300 dark:bg-gray-800 dark:border-gray-600"
                                    />
                                    <span className={`text-sm font-medium transition-colors ${item.ok ? 'text-gray-500 line-through dark:text-gray-500' : 'text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'}`}>
                                        {item.item}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !isChecklistComplete}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-lg py-4 rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Iniciando...' : 'Iniciar Turno de Entregas'}
                    </button>
                </form>
            </motion.div>
        </div>
    );
};

const PainelMobile: React.FC<{ user: any }> = ({ user }) => {
    const [entregas, setEntregas] = useState<Entrega[]>([]);
    const [loading, setLoading] = useState(true);
    const [turno, setTurno] = useState<any>(undefined);
    const [finalizando, setFinalizando] = useState(false);
    const [tab, setTab] = useState<'disponiveis' | 'ativas' | 'concluidas' | 'historico' | 'veiculo'>('ativas');
    const [detalheModalId, setDetalheModalId] = useState<number | null>(null);
    const [meuMotoristaId, setMeuMotoristaId] = useState<number | null>(null);
    const [abastecimentoModalOpen, setAbastecimentoModalOpen] = useState(false);

    useEffect(() => {
        if (user?.id) {
            deliveryService.getMeuMotorista().then(res => {
                setMeuMotoristaId(res.motorista_id);
            }).catch(() => setMeuMotoristaId(null));
        }
    }, [user?.id]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [resEntregas, resTurno] = await Promise.all([
                deliveryService.getEntregas('todos'),
                deliveryService.getTurnoAtual().catch(() => ({ turno: null }))
            ]);
            if (resEntregas.success) setEntregas(resEntregas.entregas ?? []);
            setTurno(resTurno?.turno || null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const entregaEmRota = entregas.find(e => e.status === 'em_rota' && (e as any).motorista_id === meuMotoristaId) ?? null;
    const gpsStatus = useGpsTracker(entregaEmRota);

    const disponiveis = entregas.filter(e => (e.status === 'pendente' || e.status === 'em_preparo') && !(e as any).motorista_id);
    const ativas = entregas.filter(e => !['entregue', 'cancelada', 'pendente', 'em_preparo'].includes(e.status) && (e as any).motorista_id === meuMotoristaId);
    
    // Filtros de Turno e Histórico
    const dataTurno = (turno?.horario_inicio || turno?.data_turno) ? new Date(turno.horario_inicio || turno.data_turno).getTime() : null;
    const todasConcluidas = entregas.filter(e => e.status === 'entregue' && (e as any).motorista_id === meuMotoristaId);
    
    const concluidasTurno = dataTurno 
        ? todasConcluidas.filter(e => e.data_entrega && new Date(e.data_entrega).getTime() >= dataTurno)
        : todasConcluidas; // Fallback

    const lista = tab === 'ativas' ? ativas : tab === 'concluidas' ? concluidasTurno : tab === 'historico' ? todasConcluidas : disponiveis;

    // Métricas de Inteligência
    const kmRodadosTurno = concluidasTurno.reduce((acc, curr) => acc + (curr.km_percorridos || 0), 0);
    const tempoTotalMinutos = concluidasTurno.reduce((acc, curr) => acc + (curr.tempo_real_minutos || 0), 0);
    const tempoMedio = concluidasTurno.length > 0 ? (tempoTotalMinutos / concluidasTurno.length).toFixed(0) : 0;
    
    // Tenta pegar o consumo padrão do veículo no backend
    const [consumoMedio, setConsumoMedio] = useState(15.0); // Padrão
    useEffect(() => {
        if (turno?.veiculo_id) {
            deliveryService.getVeiculos().then(res => {
                const veiculo = (res.veiculos || []).find((v: any) => v.id === turno.veiculo_id);
                if (veiculo && veiculo.consumo_medio) {
                    setConsumoMedio(veiculo.consumo_medio);
                }
            }).catch(() => {});
        }
    }, [turno?.veiculo_id]);

    const kmPorLitroCalculado = consumoMedio > 0 ? consumoMedio.toFixed(1) : "15.0";

    const handleFinalizarTurno = async () => {
        const kmFinal = window.prompt("Para finalizar o turno, digite o KM FINAL do painel do veículo:");
        if (!kmFinal) return;
        if (isNaN(Number(kmFinal))) return toast.error("KM inválido. Digite apenas números.");
        
        setFinalizando(true);
        try {
            await deliveryService.finalizarTurno({ km_final: Number(kmFinal) });
            toast.success("Turno encerrado e custos calculados!");
            setTurno(null);
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Erro ao finalizar turno');
        } finally {
            setFinalizando(false);
        }
    };

    // Splash Screen Loading
    if (turno === undefined) {
        return <div className="min-h-screen bg-blue-600 flex flex-col items-center justify-center text-white"><Truck className="w-12 h-12 animate-pulse mb-3" /><p className="font-bold">Carregando painel...</p></div>;
    }

    // Tela de Iniciar Turno (Trava)
    if (turno === null) {
        return <AberturaTurno onTurnoIniciado={load} motoristaId={meuMotoristaId} />;
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
            <div className="bg-linear-to-br from-blue-700 to-indigo-800 px-5 pt-10 pb-5 text-white">
                <div className="flex items-center justify-between z-10 relative">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-white backdrop-blur-sm border border-white/10">
                            <Truck className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white leading-tight">{user.nome?.split(' ')[0]}</h2>
                            <p className="text-blue-200 text-xs font-medium">Turno Ativo</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {turno && (
                            <button
                                onClick={() => setAbastecimentoModalOpen(true)}
                                className="flex flex-col items-center justify-center bg-emerald-500/80 hover:bg-emerald-500 text-white px-3 py-1 rounded-xl transition-colors backdrop-blur-sm shadow-sm"
                            >
                                <Fuel className="w-4 h-4 mb-0.5" />
                                <span className="text-[9px] font-black uppercase">Posto</span>
                            </button>
                        )}
                        <button
                            onClick={handleFinalizarTurno}
                            disabled={finalizando || ativas.length > 0}
                            className="bg-white/10 hover:bg-red-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm border border-white/20 hover:border-transparent"
                        >
                            {finalizando ? 'Fechando...' : 'Encerrar'}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-6 z-10 relative">
                    <div className="bg-white/10 rounded-2xl p-3 text-center border border-white/10 backdrop-blur-md">
                        <p className="text-2xl font-black">{ativas.length}</p>
                        <p className="text-blue-200 text-[10px] font-bold uppercase tracking-wider">Em Aberto</p>
                    </div>
                    <div className="bg-white/10 rounded-2xl p-3 text-center border border-white/10 backdrop-blur-md">
                        <p className="text-2xl font-black text-emerald-300">{kmRodadosTurno.toFixed(1)}</p>
                        <p className="text-blue-200 text-[10px] font-bold uppercase tracking-wider">KM Turno</p>
                    </div>
                    <div className="bg-white/10 rounded-2xl p-3 text-center border border-white/10 backdrop-blur-md">
                        <p className="text-2xl font-black text-amber-300">{tempoMedio}'</p>
                        <p className="text-blue-200 text-[10px] font-bold uppercase tracking-wider">Tempo Médio</p>
                    </div>
                </div>
                
                <div className="flex items-center justify-between mt-3 px-1">
                    <span className="text-xs text-blue-100/70 font-medium flex items-center gap-1"><Clock className="w-3 h-3" /> Início: {new Date(turno.horario_inicio || turno.data_turno).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <span className="text-xs text-emerald-100/90 font-bold flex items-center gap-1 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/30"><Fuel className="w-3 h-3" /> {kmPorLitroCalculado} KM/L</span>
                </div>
                
                <button
                    onClick={load}
                    disabled={loading}
                    className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-all shrink-0"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>

                {entregaEmRota && (
                    <div className="mt-4">
                        <GpsBadge status={gpsStatus} />
                    </div>
                )}

            </div>

            <div className="bg-blue-800 p-2 sticky top-0 z-10 shadow-sm border-b border-blue-900/50 overflow-x-auto hide-scrollbar">
                <div className="flex gap-1 bg-blue-900/50 p-1 rounded-xl min-w-max">
                    <button
                        onClick={() => setTab('disponiveis')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all relative ${tab === 'disponiveis' ? 'bg-white text-blue-700 shadow-sm' : 'text-blue-200 hover:text-white'}`}
                    >
                        Disponíveis
                        {disponiveis.length > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-[10px] flex items-center justify-center text-white border-2 border-blue-900">
                                {disponiveis.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setTab('ativas')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'ativas' ? 'bg-white text-blue-700 shadow-sm' : 'text-blue-200 hover:text-white'}`}
                    >
                        Minha Rota
                    </button>
                    <button
                        onClick={() => setTab('concluidas')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'concluidas' ? 'bg-white text-blue-700 shadow-sm' : 'text-blue-200 hover:text-white'}`}
                    >
                        Concluídas (Turno)
                    </button>
                    <button
                        onClick={() => setTab('historico')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'historico' ? 'bg-white text-blue-700 shadow-sm' : 'text-blue-200 hover:text-white'}`}
                    >
                        <CalendarDays className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                        Histórico
                    </button>
                    <button
                        onClick={() => setTab('veiculo')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'veiculo' ? 'bg-white text-blue-700 shadow-sm' : 'text-blue-200 hover:text-white'}`}
                    >
                        <Wrench className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                        Meu Veículo
                    </button>
                </div>
            </div>

            {tab === 'veiculo' ? (
                <MeuVeiculoPanel veiculoId={turno.veiculo_id} kmAtual={turno.km_inicial} />
            ) : (
                <div className="flex-1 p-4 space-y-3 overflow-y-auto pb-8">
                    <AnimatePresence mode='wait'>
                    {loading ? (
                        [1, 2].map(i => (
                            <div key={i} className="h-36 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
                        ))
                    ) : lista.length > 0 ? (
                        lista.map(e => <CardEntrega key={e.id} entrega={e} onRefresh={load} onClickDetalhes={() => setDetalheModalId(e.id)} assumindo={tab === 'disponiveis'} meuMotoristaId={meuMotoristaId} />)
                    ) : (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center py-20 text-gray-400"
                        >
                            <Package className="w-12 h-12 mb-3 opacity-30" />
                            <p className="font-medium text-center text-sm">
                                {tab === 'ativas'
                                    ? 'Nenhuma entrega atribuída no momento'
                                    : tab === 'concluidas'
                                    ? 'Nenhuma entrega concluída neste turno'
                                    : tab === 'historico'
                                    ? 'Seu histórico está vazio'
                                    : 'Não há entregas pendentes na loja'}
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            )}
            
            <DetalheEntregaModal entregaId={detalheModalId} onClose={() => setDetalheModalId(null)} />
            {turno && (
                <AbastecimentoModal 
                    isOpen={abastecimentoModalOpen}
                    onClose={() => setAbastecimentoModalOpen(false)}
                    veiculoId={turno.veiculo_id}
                    kmAtualVeiculo={turno.km_inicial + kmRodadosTurno} // Estimate based on DB initial + driven
                    onSuccess={(novoKml) => {
                        setConsumoMedio(novoKml);
                    }}
                />
            )}
        </div>
    );
};

// ─── Aviso Desktop ────────────────────────────────────────────────────────────
const AvisoDesktop: React.FC<{ user: any }> = ({ user }) => (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center max-w-lg mx-auto">
        <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-6">
            <Smartphone className="w-10 h-10 text-blue-600" />
        </div>
        <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-3">
            Olá, {user?.nome?.split(' ')[0] || 'Motorista'}!
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            O painel de entregas é feito para ser usado <strong>no celular</strong>, durante a rota.
            <br /><br />
            Abra o navegador no seu celular, acesse o endereço abaixo e logue com suas credenciais.
            O sistema detecta que é mobile e abre seus pedidos direto.
        </p>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 w-full border border-gray-200 dark:border-gray-700 mb-4">
            <p className="text-xs text-gray-400 mb-1">Endereço do sistema</p>
            <p className="font-mono text-sm font-bold text-blue-600 break-all">
                {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
                    ? `http://[IP-DO-COMPUTADOR]:${window.location.port}`
                    : window.location.origin}
            </p>
            {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                <p className="text-[10px] text-gray-500 mt-2 font-medium">
                    Dica: Como você está no "localhost", o celular não vai encontrar a página. 
                    Descubra o IP do seu computador na rede Wi-Fi (ex: 192.168.1.10) e digite no celular.
                </p>
            )}
        </div>
        <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4 text-left w-full">
            <Radio className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700 dark:text-blue-300">
                Quando você iniciar uma entrega pelo celular, o GPS do aparelho é ativado automaticamente
                e transmite sua posição ao gestor a cada 15 segundos em tempo real.
            </p>
        </div>
    </div>
);

// ─── Componente principal ─────────────────────────────────────────────────────
const PortalEntregador: React.FC = () => {
    const user = authService.getCurrentUser();
    return isMobile() ? <PainelMobile user={user} /> : <AvisoDesktop user={user} />;
};

export default PortalEntregador;
