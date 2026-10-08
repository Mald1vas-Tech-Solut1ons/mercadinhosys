import React, { useEffect, useState } from 'react';
import {
    Building2, MapPin, Phone, Mail, Users, Package,
    ShoppingBag, TrendingUp, CheckCircle2, XCircle,
    Calendar, RefreshCw, AlertCircle, Store, Plus, Eye, Clock, Power, Ban
} from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import NovoClienteModal from '../../components/modals/NovoClienteModal';
import EstabelecimentoDetalheModal from '../../components/modals/EstabelecimentoDetalheModal';

interface Estabelecimento {
    id: number;
    nome_fantasia: string;
    razao_social: string;
    cnpj: string;
    telefone: string;
    email: string;
    logradouro: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
    ativo: boolean;
    regime_tributario: string;
    data_abertura: string;
    total_funcionarios: number;
    total_produtos: number;
    total_clientes: number;
    faturamento_total: number;
    ultima_venda: string | null;
    plano?: string | null;
    plano_status?: string | null;
    vencimento_plano?: string | null;
}

/** Dias restantes até o vencimento do plano/trial (negativo = vencido). */
const diasRestantes = (venc?: string | null): number | null => {
    if (!venc) return null;
    const d = new Date(venc + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
};

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('pt-BR');
};

const MetricPill: React.FC<{ icon: React.ElementType; label: string; value: string | number; color: string }> = ({
    icon: Icon, label, value, color
}) => (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10">
        <div className={`p-1.5 rounded-lg ${color}`}>
            <Icon size={14} className="text-white" />
        </div>
        <div>
            <p className="text-[11px] text-gray-400 leading-none">{label}</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{value}</p>
        </div>
    </div>
);

const EstabelecimentoCard: React.FC<{
    est: Estabelecimento;
    onVerDetalhes: (est: Estabelecimento) => void;
    onAtivar: (est: Estabelecimento) => void;
    onInativar: (est: Estabelecimento) => void;
    processando: boolean;
}> = ({ est, onVerDetalhes, onAtivar, onInativar, processando }) => {
    const dias = diasRestantes(est.vencimento_plano);
    const emTrial = est.plano_status === 'experimental';
    return (
    <div className="relative group rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 backdrop-blur-sm shadow-md hover:shadow-xl hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-300">
        {/* Header com gradiente */}
        <div className={`px-5 pt-5 pb-4 ${est.ativo
            ? 'bg-linear-to-r from-blue-600 via-blue-500 to-indigo-500'
            : 'bg-linear-to-r from-gray-500 to-gray-600'}`}>
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                        <Store size={20} className="text-white" />
                    </div>
                    <div>
                        <h3 className="text-white font-bold text-lg leading-tight">{est.nome_fantasia}</h3>
                        <p className="text-blue-100 text-xs mt-0.5 opacity-80">{est.razao_social}</p>
                    </div>
                </div>
                <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${est.ativo
                    ? 'bg-green-400/20 text-green-200 border border-green-400/30'
                    : 'bg-red-400/20 text-red-200 border border-red-400/30'}`}>
                    {est.ativo ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                    {est.ativo ? 'Ativo' : 'Inativo'}
                </span>
            </div>

            {/* Faturamento destacado */}
            <div className="mt-4 p-3 rounded-xl bg-white/10 backdrop-blur border border-white/20">
                <p className="text-blue-100 text-[11px] uppercase tracking-wider font-medium">Faturamento Total</p>
                <p className="text-white text-2xl font-bold mt-0.5">{formatCurrency(est.faturamento_total)}</p>
            </div>

            {/* Status do plano / trial */}
            {(emTrial || est.plano_status) && (
                <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-white/90">
                    <Clock size={12} />
                    {emTrial
                        ? (dias != null
                            ? (dias < 0 ? 'Teste vencido' : `Teste: ${dias} dia(s) restante(s)`)
                            : 'Em teste')
                        : `Plano: ${est.plano_status}`}
                </div>
            )}
        </div>

        {/* Métricas */}
        <div className="px-5 py-4 grid grid-cols-2 gap-2">
            <MetricPill icon={Users} label="Funcionários" value={est.total_funcionarios} color="bg-purple-500" />
            <MetricPill icon={Package} label="Produtos" value={est.total_produtos} color="bg-orange-500" />
            <MetricPill icon={ShoppingBag} label="Clientes" value={est.total_clientes} color="bg-green-500" />
            <MetricPill icon={TrendingUp} label="Regime" value={est.regime_tributario || 'N/A'} color="bg-blue-500" />
        </div>

        {/* Informações de contato e endereço */}
        <div className="px-5 pb-5 space-y-2 border-t border-gray-100 dark:border-gray-700/50 pt-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <MapPin size={13} className="text-gray-400 shrink-0" />
                <span className="truncate">{est.logradouro}, {est.numero} — {est.bairro}, {est.cidade}/{est.estado}</span>
            </div>
            {est.telefone && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Phone size={13} className="text-gray-400 shrink-0" />
                    <span>{est.telefone}</span>
                </div>
            )}
            {est.email && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Mail size={13} className="text-gray-400 shrink-0" />
                    <span className="truncate">{est.email}</span>
                </div>
            )}
            {est.cnpj && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Building2 size={13} className="text-gray-400 shrink-0" />
                    <span>CNPJ: {est.cnpj}</span>
                </div>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Calendar size={13} className="text-gray-400 shrink-0" />
                <span>
                    Abertura: {formatDate(est.data_abertura)}
                    {est.ultima_venda && ` · Última venda: ${formatDate(est.ultima_venda)}`}
                </span>
            </div>
            
            {/* Ações */}
            <div className="pt-3 border-t border-gray-100 dark:border-gray-700/50 mt-3 space-y-2">
                <button
                    onClick={() => onVerDetalhes(est)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                    <Eye size={14} />
                    Ver Detalhes
                </button>
                {est.ativo ? (
                    <button
                        onClick={() => onInativar(est)}
                        disabled={processando}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                        <Ban size={14} /> Inativar conta
                    </button>
                ) : (
                    <button
                        onClick={() => onAtivar(est)}
                        disabled={processando}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                        <Power size={14} /> Ativar conta
                    </button>
                )}
            </div>
        </div>
    </div>
    );
};

const EstabelecimentosPage: React.FC = () => {
    const [estabelecimentos, setEstabelecimentos] = useState<Estabelecimento[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showOnboardingModal, setShowOnboardingModal] = useState(false);
    const [selectedEstabelecimento, setSelectedEstabelecimento] = useState<any>(null);
    const [showDetalheModal, setShowDetalheModal] = useState(false);

    const fetchEstabelecimentos = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await apiClient.get('/configuracao/estabelecimentos');
            setEstabelecimentos(response.data.estabelecimentos || []);
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Erro ao carregar estabelecimentos');
        } finally {
            setLoading(false);
        }
    };

    const handleOnboardingSuccess = () => {
        fetchEstabelecimentos(); // Atualiza lista após criar novo cliente
    };

    const handleVerDetalhes = (estabelecimento: Estabelecimento) => {
        setSelectedEstabelecimento(estabelecimento);
        setShowDetalheModal(true);
    };

    const [processandoId, setProcessandoId] = useState<number | null>(null);

    const handleAtivar = async (est: Estabelecimento) => {
        setProcessandoId(est.id);
        try {
            await apiClient.post(`/saas/ativar-tenant/${est.id}`);
            showToast.success(`"${est.nome_fantasia}" ativado.`);
            await fetchEstabelecimentos();
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Falha ao ativar a conta');
        } finally {
            setProcessandoId(null);
        }
    };

    const handleInativar = async (est: Estabelecimento) => {
        if (!window.confirm(`Inativar a conta "${est.nome_fantasia}"? O cliente perde o acesso até ser reativado.`)) return;
        setProcessandoId(est.id);
        try {
            await apiClient.post(`/saas/inativar-tenant/${est.id}`);
            showToast.success(`"${est.nome_fantasia}" inativado.`);
            await fetchEstabelecimentos();
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Falha ao inativar a conta');
        } finally {
            setProcessandoId(null);
        }
    };

    useEffect(() => {
        fetchEstabelecimentos();
    }, []);

    const ativos = estabelecimentos.filter(e => e.ativo).length;
    const faturamentoTotal = estabelecimentos.reduce((sum, e) => sum + e.faturamento_total, 0);

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
                            <Building2 size={22} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Estabelecimentos</h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Visão geral de todas as unidades cadastradas</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowOnboardingModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
                    >
                        <Plus size={15} />
                        Novo Cliente
                    </button>
                    <button
                        onClick={fetchEstabelecimentos}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        Atualizar
                    </button>
                </div>
            </div>

            {/* Sumário */}
            {!loading && !error && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-linear-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20">
                        <p className="text-blue-100 text-xs font-medium uppercase tracking-wider">Total de Unidades</p>
                        <p className="text-3xl font-bold mt-1">{estabelecimentos.length}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-linear-to-br from-emerald-500 to-green-600 text-white shadow-lg shadow-green-600/20">
                        <p className="text-green-100 text-xs font-medium uppercase tracking-wider">Unidades Ativas</p>
                        <p className="text-3xl font-bold mt-1">{ativos}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-linear-to-br from-purple-600 to-violet-600 text-white shadow-lg shadow-purple-600/20">
                        <p className="text-purple-100 text-xs font-medium uppercase tracking-wider">Faturamento Consolidado</p>
                        <p className="text-2xl font-bold mt-1">{formatCurrency(faturamentoTotal)}</p>
                    </div>
                </div>
            )}

            {/* Estado de carregamento */}
            {loading && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-gray-500 dark:text-gray-400 text-sm">Carregando estabelecimentos...</p>
                </div>
            )}

            {/* Erro */}
            {error && !loading && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400">
                    <AlertCircle size={18} className="shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            {/* Grid de cards */}
            {!loading && !error && estabelecimentos.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {estabelecimentos.map(est => (
                        <EstabelecimentoCard
                            key={est.id}
                            est={est}
                            onVerDetalhes={handleVerDetalhes}
                            onAtivar={handleAtivar}
                            onInativar={handleInativar}
                            processando={processandoId === est.id}
                        />
                    ))}
                </div>
            )}

            {/* Vazio */}
            {!loading && !error && estabelecimentos.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Building2 size={40} className="text-gray-300 dark:text-gray-600" />
                    <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhum estabelecimento encontrado</p>
                    <button
                        onClick={() => setShowOnboardingModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors mt-4"
                    >
                        <Plus size={15} />
                        Cadastrar Primeiro Cliente
                    </button>
                </div>
            )}

            {/* Modal de Onboarding */}
            <NovoClienteModal
                isOpen={showOnboardingModal}
                onClose={() => setShowOnboardingModal(false)}
                onSuccess={handleOnboardingSuccess}
            />

            {/* Modal de Detalhes */}
            <EstabelecimentoDetalheModal
                estabelecimento={selectedEstabelecimento}
                isOpen={showDetalheModal}
                onClose={() => setShowDetalheModal(false)}
            />
        </div>
    );
};

export default EstabelecimentosPage;
