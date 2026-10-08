import { ProtectedDocumentLink } from '@/components/common/ProtectedDocumentLink';
import { useState, useEffect } from 'react';
import { Clock, FileText, Upload, CheckCircle2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, AlertCircle, Paperclip, Download, Sparkles } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { showToast } from '../../../components/elements/Toast';
import HoleriteModal from './HoleriteModal';
import RetrospectivaWrapped from './RetrospectivaWrapped';
import type { HoleriteBreakdown } from '../folhaService';

/**
 * Autoatendimento de RH & Ponto (Regra de Acesso): todo funcionário — mesmo
 * fora de Admin/Gerente/RH — pode ver o PRÓPRIO holerite, conferir e assinar
 * o PRÓPRIO espelho de ponto, e enviar justificativas de falta/atraso.
 * Ninguém aqui vê dados de outros funcionários.
 */

type HoleriteData = HoleriteBreakdown;

interface RegistroDiario {
    data: string; entrada: string | null; saida: string | null;
    intervalo_inicio: string | null; intervalo_fim: string | null;
    minutos_atraso: number; minutos_extras: number; horas_trabalhadas: number;
    observacao?: string;
}

interface EspelhoData {
    nome: string; cargo: string; registros_diarios: RegistroDiario[];
    resumo: { total_dias_trabalhados: number; total_atrasos: number; total_minutos_atraso: number; total_horas_extras: number; total_horas_trabalhadas: number; media_horas_dia: number };
    assinatura: { assinado: boolean; assinado_em: string | null };
}

interface Justificativa {
    id: number; tipo: 'atraso' | 'ausencia'; data: string; motivo: string;
    status: 'pendente' | 'aprovado' | 'rejeitado'; created_at: string;
    documento_url?: string | null; motivo_rejeicao?: string | null;
}

const EXTENSOES_ACEITAS = ['pdf', 'jpg', 'jpeg', 'png'];
const TAMANHO_MAXIMO_MB = 5;

function mesAtualISO() {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

/** Espelho de ponto é sempre por mês CHEIO (dia 1 ao último dia), nunca um recorte arbitrário. */
function limitesDoMes(mesISO: string) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const inicio = new Date(ano, mes - 1, 1);
    const fim = new Date(ano, mes, 0); // dia 0 do mês seguinte = último dia deste mês
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    return { inicio: fmt(inicio), fim: fmt(fim) };
}

function mesLabel(mesISO: string) {
    const [ano, mes] = mesISO.split('-').map(Number);
    return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function deslocarMes(mesISO: string, delta: number) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const d = new Date(ano, mes - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MeuRH() {
    const [holerite, setHolerite] = useState<HoleriteData | null>(null);
    const [holeriteModalAberto, setHoleriteModalAberto] = useState(false);
    const [espelho, setEspelho] = useState<EspelhoData | null>(null);
    const [loadingEspelho, setLoadingEspelho] = useState(false);
    const [assinando, setAssinando] = useState(false);
    const [expandedDay, setExpandedDay] = useState<string | null>(null);
    const [justificativas, setJustificativas] = useState<Justificativa[]>([]);
    const [novaJustificativa, setNovaJustificativa] = useState({ tipo: 'atraso' as 'atraso' | 'ausencia', data: '', motivo: '' });
    const [documento, setDocumento] = useState<File | null>(null);
    const [enviando, setEnviando] = useState(false);
    const [wrappedAberto, setWrappedAberto] = useState(false);

    const selecionarDocumento = (file: File | null) => {
        if (!file) { setDocumento(null); return; }
        const extensao = file.name.split('.').pop()?.toLowerCase() || '';
        if (!EXTENSOES_ACEITAS.includes(extensao)) {
            showToast.error('Formato inválido. Envie PDF, JPG ou PNG.');
            return;
        }
        if (file.size > TAMANHO_MAXIMO_MB * 1024 * 1024) {
            showToast.error(`Documento muito grande. Máximo ${TAMANHO_MAXIMO_MB}MB.`);
            return;
        }
        setDocumento(file);
    };

    const mesAtual = mesAtualISO();
    const [mesSelecionado, setMesSelecionado] = useState(mesAtual);
    const { inicio, fim } = limitesDoMes(mesSelecionado);

    useEffect(() => {
        carregarHolerite();
        carregarJustificativas();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        carregarEspelho();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mesSelecionado]);

    const carregarHolerite = async () => {
        try {
            const { data } = await apiClient.get('/funcionarios/me/holerite');
            setHolerite(data?.data || null);
        } catch {
            // silencioso: holerite é opcional na tela inicial
        }
    };

    const carregarEspelho = async () => {
        const { inicio: dataInicio, fim: dataFim } = limitesDoMes(mesSelecionado);
        try {
            setLoadingEspelho(true);
            const { data } = await apiClient.get('/dashboard/rh/ponto/espelho', { params: { data_inicio: dataInicio, data_fim: dataFim } });
            setEspelho(data?.data || null);
        } catch {
            setEspelho(null);
        } finally {
            setLoadingEspelho(false);
        }
    };

    const carregarJustificativas = async () => {
        try {
            const { data } = await apiClient.get('/rh/justificativas');
            setJustificativas(data?.data || []);
        } catch {
            setJustificativas([]);
        }
    };

    const assinarEspelho = async () => {
        try {
            setAssinando(true);
            await apiClient.post('/dashboard/rh/ponto/espelho/assinar', { data_inicio: inicio, data_fim: fim });
            showToast.success('Espelho de ponto assinado!');
            carregarEspelho();
        } catch (e: any) {
            showToast.error(e?.response?.data?.message || 'Erro ao assinar espelho');
        } finally {
            setAssinando(false);
        }
    };

    const enviarJustificativa = async () => {
        if (!holerite || !novaJustificativa.data || !novaJustificativa.motivo.trim()) {
            showToast.error('Preencha a data e o motivo');
            return;
        }
        try {
            setEnviando(true);
            const formData = new FormData();
            formData.append('funcionario_id', String(holerite.funcionario_id));
            formData.append('tipo', novaJustificativa.tipo);
            formData.append('data', novaJustificativa.data);
            formData.append('motivo', novaJustificativa.motivo);
            if (documento) formData.append('documento', documento);
            await apiClient.post('/rh/justificativas', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            showToast.success('Justificativa enviada!');
            setNovaJustificativa({ tipo: 'atraso', data: '', motivo: '' });
            setDocumento(null);
            carregarJustificativas();
        } catch (e: any) {
            showToast.error(e?.response?.data?.message || 'Erro ao enviar justificativa');
        } finally {
            setEnviando(false);
        }
    };


    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Meu RH & Ponto</h2>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">Seus próprios dados de folha, ponto e justificativas</p>
            </div>

            {/* Retrospectiva (Wrapped) — destaque premium */}
            <button
                onClick={() => setWrappedAberto(true)}
                className="group relative w-full overflow-hidden rounded-2xl p-[2px] bg-linear-to-r from-fuchsia-500 via-purple-500 to-indigo-500 shadow-lg shadow-purple-500/20 text-left"
            >
                <div className="rounded-2xl bg-linear-to-r from-fuchsia-600 via-purple-600 to-indigo-700 px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-white/20 backdrop-blur text-white group-hover:scale-110 transition-transform">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-white font-black text-lg leading-tight">Minha Retrospectiva</p>
                            <p className="text-white/80 text-sm">Veja seu desempenho do mês em números 🎉</p>
                        </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-white/80 group-hover:translate-x-1 transition-transform" />
                </div>
            </button>

            {/* Meu Holerite */}
            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-indigo-500" />
                        <h3 className="font-bold text-gray-900 dark:text-white">Meu Holerite</h3>
                    </div>
                    <button
                        onClick={() => setHoleriteModalAberto(true)}
                        disabled={!holerite}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-600/20 disabled:opacity-50 transition-all"
                    >
                        Ver Holerite Completo
                    </button>
                </div>
                {holerite && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div><p className="text-gray-500 dark:text-gray-400 text-xs uppercase font-bold">Referência</p><p className="font-bold text-gray-900 dark:text-white">{holerite.mes_referencia}</p></div>
                        <div><p className="text-gray-500 dark:text-gray-400 text-xs uppercase font-bold">Horas Extras</p><p className="font-bold text-emerald-600">{holerite.horas_extras_horas}h</p></div>
                        <div><p className="text-gray-500 dark:text-gray-400 text-xs uppercase font-bold">Atrasos</p><p className="font-bold text-rose-600">{holerite.atrasos_horas}h</p></div>
                    </div>
                )}
            </div>

            {/* Meu Espelho de Ponto */}
            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-indigo-500" />
                        <h3 className="font-bold text-gray-900 dark:text-white">Meu Espelho de Ponto</h3>
                    </div>
                    {espelho && (
                        espelho.assinatura.assinado ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-bold">
                                <CheckCircle2 className="w-4 h-4" /> Assinado
                            </span>
                        ) : (
                            <button
                                onClick={assinarEspelho}
                                disabled={assinando}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-600/20 disabled:opacity-50 transition-all"
                            >
                                {assinando ? 'Assinando...' : 'Assinar Espelho'}
                            </button>
                        )
                    )}
                </div>

                {/* Navegação de mês — o espelho é sempre o mês CHEIO (dia 1 ao último dia) */}
                <div className="flex items-center justify-center gap-4 mb-5 bg-gray-50 dark:bg-gray-900/50 rounded-xl py-2 px-3 border border-gray-100 dark:border-gray-800">
                    <button
                        onClick={() => setMesSelecionado(m => deslocarMes(m, -1))}
                        className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        aria-label="Mês anterior"
                    >
                        <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    </button>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200 capitalize min-w-[160px] text-center">
                        {mesLabel(mesSelecionado)}
                    </span>
                    <button
                        onClick={() => setMesSelecionado(m => deslocarMes(m, 1))}
                        disabled={mesSelecionado >= mesAtual}
                        className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Próximo mês"
                    >
                        <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    </button>
                </div>

                {loadingEspelho ? (
                    <div className="py-6 text-center text-gray-500 text-sm">Carregando...</div>
                ) : espelho ? (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-xl border border-blue-100 dark:border-blue-500/20">
                                <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase">Dias Trabalhados</p>
                                <p className="text-xl font-black text-blue-700 dark:text-blue-300">{espelho.resumo.total_dias_trabalhados}</p>
                            </div>
                            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 rounded-xl border border-rose-100 dark:border-rose-500/20">
                                <p className="text-[10px] text-rose-600 dark:text-rose-400 font-bold uppercase">Atrasos</p>
                                <p className="text-xl font-black text-rose-700 dark:text-rose-300">{espelho.resumo.total_atrasos}</p>
                            </div>
                            <div className="p-3 bg-orange-50 dark:bg-orange-500/10 rounded-xl border border-orange-100 dark:border-orange-500/20">
                                <p className="text-[10px] text-orange-600 dark:text-orange-400 font-bold uppercase">Horas Extras</p>
                                <p className="text-xl font-black text-orange-700 dark:text-orange-300">{espelho.resumo.total_horas_extras.toFixed(1)}h</p>
                            </div>
                            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase">Trabalhadas</p>
                                <p className="text-xl font-black text-emerald-700 dark:text-emerald-300">{espelho.resumo.total_horas_trabalhadas.toFixed(1)}h</p>
                            </div>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                            {espelho.registros_diarios.length === 0 ? (
                                <p className="p-4 text-center text-sm text-gray-500">Nenhum registro este mês</p>
                            ) : espelho.registros_diarios.map(r => (
                                <div key={r.data} className="p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50" onClick={() => setExpandedDay(expandedDay === r.data ? null : r.data)}>
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                                            {new Date(r.data).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                                            {' — '}{r.entrada || '--:--'} às {r.saida || '--:--'}
                                        </p>
                                        {expandedDay === r.data ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                    </div>
                                    {expandedDay === r.data && (
                                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 grid grid-cols-2 gap-2">
                                            <span>Pausa: {r.intervalo_inicio || '--'} às {r.intervalo_fim || '--'}</span>
                                            <span>Trabalhadas: {(r.horas_trabalhadas / 60).toFixed(1)}h</span>
                                            {r.minutos_atraso > 0 && <span className="text-rose-500">Atraso: {r.minutos_atraso}m</span>}
                                            {r.observacao && <span className="col-span-2">Obs: {r.observacao}</span>}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-gray-500">Não foi possível carregar o espelho de ponto.</p>
                )}
            </div>

            {/* Minhas Justificativas */}
            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="w-5 h-5 text-indigo-500" />
                    <h3 className="font-bold text-gray-900 dark:text-white">Minhas Justificativas</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                    <select
                        value={novaJustificativa.tipo}
                        onChange={e => setNovaJustificativa({ ...novaJustificativa, tipo: e.target.value as 'atraso' | 'ausencia' })}
                        className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white"
                    >
                        <option value="atraso">Atraso</option>
                        <option value="ausencia">Ausência</option>
                    </select>
                    <input
                        type="date"
                        value={novaJustificativa.data}
                        onChange={e => setNovaJustificativa({ ...novaJustificativa, data: e.target.value })}
                        className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white"
                    />
                    <input
                        type="text"
                        placeholder="Motivo"
                        value={novaJustificativa.motivo}
                        onChange={e => setNovaJustificativa({ ...novaJustificativa, motivo: e.target.value })}
                        className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white md:col-span-1"
                    />
                    <button
                        onClick={enviarJustificativa}
                        disabled={enviando}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        <Upload className="w-4 h-4" /> {enviando ? 'Enviando...' : 'Enviar'}
                    </button>
                </div>

                <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer w-fit px-3 py-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                        <Paperclip className="w-4 h-4" />
                        {documento ? documento.name : 'Anexar atestado / foto (PDF, JPG, PNG — máx. 5MB)'}
                        <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            className="hidden"
                            onChange={e => selecionarDocumento(e.target.files?.[0] || null)}
                        />
                    </label>
                </div>

                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {justificativas.length === 0 ? (
                        <p className="py-4 text-center text-sm text-gray-500">Nenhuma justificativa enviada</p>
                    ) : justificativas.map(j => (
                        <div key={j.id} className="py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{j.tipo === 'atraso' ? 'Atraso' : 'Ausência'} — {new Date(j.data).toLocaleDateString('pt-BR')}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{j.motivo}</p>
                                    {j.documento_url && (
                                        <ProtectedDocumentLink url={j.documento_url} className="inline-flex items-center gap-1 mt-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
                                            <Download className="w-3.5 h-3.5" /> Ver anexo
                                        </ProtectedDocumentLink>
                                    )}
                                </div>
                                <span className={`px-2.5 py-1 text-xs font-bold rounded-md whitespace-nowrap ${j.status === 'pendente' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400' : j.status === 'aprovado' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'}`}>
                                    {j.status === 'pendente' ? 'Em Análise' : j.status === 'aprovado' ? 'Aprovado' : 'Rejeitado'}
                                </span>
                            </div>
                            {j.status === 'rejeitado' && j.motivo_rejeicao && (
                                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">
                                    <strong>Motivo da recusa:</strong> {j.motivo_rejeicao}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {holerite && (
                <HoleriteModal
                    isOpen={holeriteModalAberto}
                    onClose={() => setHoleriteModalAberto(false)}
                    holerite={holerite}
                />
            )}

            <RetrospectivaWrapped open={wrappedAberto} onClose={() => setWrappedAberto(false)} anoMes={mesSelecionado} />
        </div>
    );
}
