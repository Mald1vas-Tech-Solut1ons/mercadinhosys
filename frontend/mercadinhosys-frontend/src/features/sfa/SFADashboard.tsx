import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../api/apiClient';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { MapPin, UserCircle, RefreshCcw, ShoppingCart, Clock, Target, TrendingUp, Users, AlertTriangle, PackageOpen, Search, X, Map as MapIcon, History as HistoryIcon } from 'lucide-react';
import { showToast } from '../../utils/toast';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../utils/formatters';
import SFABottomNav from './SFABottomNav';

export default function SFADashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [clientes, setClientes] = useState<any[]>([]);
    const [kpi, setKpi] = useState<any>(null);
    const [selectedCliente, setSelectedCliente] = useState<any>(null);

    const loadData = async () => {
        if (!user?.id) return;
        try {
            setLoading(true);
            
            // 1. Carrega dados de sincronia (Offline/Rotas)
            const resSync = apiClient.get(`/sfa/sync-data?vendedor_id=${user.id}`);
            
            // 2. Carrega KPIs de Inteligencia de Vendas
            const resKpi = apiClient.get(`/sfa/kpi/vendedor?vendedor_id=${user.id}`);
            
            const [syncData, kpiData] = await Promise.all([resSync, resKpi]);
            
            if (syncData.data?.status === 'success') {
                const clientesData = syncData.data.data.clientes || [];
                setClientes(clientesData);
                
                // Salvar offline para o fluxo de pedido
                localStorage.setItem('@sfa_clientes', JSON.stringify(clientesData));
                localStorage.setItem('@sfa_produtos', JSON.stringify(syncData.data.data.produtos || []));
                localStorage.setItem('@sfa_tabelas', JSON.stringify(syncData.data.data.tabelas_preco || []));
                localStorage.setItem('@sfa_tabelas_itens', JSON.stringify(syncData.data.data.tabelas_preco_itens || []));
            }
            
            if (kpiData.data?.status === 'success') {
                setKpi(kpiData.data.data);
            }
            
            showToast.success('Roteiro e Metas atualizados!');
        } catch (error) {
            console.error('Erro ao sincronizar SFA:', error);
            // Fallback offline
            const offlineClientes = localStorage.getItem('@sfa_clientes');
            if (offlineClientes) {
                setClientes(JSON.parse(offlineClientes));
                showToast.update('Você está offline. Exibindo dados locais e KPIs desativados.');
            } else {
                showToast.error('Erro ao carregar roteiro.');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [user]);

    const iniciarAtendimento = (cliente: any) => {
        navigate('/sfa/pedido', { state: { cliente } });
    };

    const isAtrasado = kpi?.realizado?.tendencia < kpi?.meta?.faturamento;

    return (
        <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 -m-6 p-4 md:p-6 pb-24 overflow-y-auto">
            <div className="flex justify-between items-center mb-6 pt-2">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        Força de Vendas <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full">SFA</span>
                    </h1>
                    <p className="text-sm text-slate-500 font-medium">Bem-vindo, {user?.nome}</p>
                </div>
                <Button variant="outline" size="icon" onClick={loadData} disabled={loading}>
                    <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            {/* AI Briefing - Vendedor */}
            {kpi && (
                <div className="mb-6">
                    <div className="bg-slate-900 rounded-3xl p-5 md:p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
                        
                        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                            <Target className="text-blue-400" /> Resumo do Mês
                        </h2>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {/* Meta vs Realizado */}
                            <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/50">
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Realizado</p>
                                <p className="text-2xl font-black text-white">{formatCurrency(kpi.realizado.faturamento)}</p>
                                <p className="text-xs text-slate-500 mt-1">Meta: {formatCurrency(kpi.meta.faturamento)}</p>
                            </div>
                            
                            {/* Tendencia */}
                            <div className={`bg-slate-800/80 p-4 rounded-2xl border ${isAtrasado ? 'border-amber-500/30' : 'border-emerald-500/30'}`}>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1 flex justify-between">
                                    Tendência 
                                    {isAtrasado ? <AlertTriangle className="w-3 h-3 text-amber-500" /> : <TrendingUp className="w-3 h-3 text-emerald-500" />}
                                </p>
                                <p className={`text-2xl font-black ${isAtrasado ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {formatCurrency(kpi.realizado.tendencia)}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">Projeção p/ o fim do mês</p>
                            </div>
                            
                            {/* Carteira e Positivação */}
                            <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/50">
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Users className="w-3 h-3" /> Positivação
                                </p>
                                <p className="text-2xl font-black text-white">{kpi.carteira.positivados} <span className="text-sm font-medium text-slate-500">/ {kpi.carteira.base_clientes} cl.</span></p>
                                <p className="text-xs text-slate-500 mt-1">Faltam {kpi.carteira.nao_compraram} clientes</p>
                            </div>

                            {/* Produtos Foco */}
                            <div className="bg-slate-800/80 p-4 rounded-2xl border border-blue-500/30 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-2"><PackageOpen className="w-8 h-8 text-blue-500/20" /></div>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Produto Foco</p>
                                <p className="text-2xl font-black text-blue-400">{kpi.produto_foco.total_itens_vendidos} un</p>
                                <p className="text-xs text-slate-500 mt-1">Vendidos neste mês</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="mb-4">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                    <MapPin className="w-5 h-5 text-blue-500" />
                    Clientes na Rota Hoje ({clientes.length})
                </h2>
                
                {loading && clientes.length === 0 ? (
                    <div className="flex justify-center p-8">
                        <RefreshCcw className="w-8 h-8 animate-spin text-blue-500" />
                    </div>
                ) : clientes.length === 0 ? (
                    <Card className="border-dashed bg-transparent border-2 border-slate-200 dark:border-slate-800 shadow-none">
                        <CardContent className="flex flex-col items-center justify-center py-12 text-slate-500">
                            <MapPin className="w-12 h-12 mb-3 text-slate-300" />
                            <p className="font-medium">Nenhum cliente no seu roteiro hoje.</p>
                            <p className="text-sm text-slate-400">Verifique a sincronização com o retaguarda.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {clientes.map((c, idx) => (
                            <Card key={c.id || idx} className="overflow-hidden hover:shadow-lg transition-all border-slate-200 dark:border-slate-800 rounded-2xl">
                                <CardContent className="p-0">
                                    <div className="p-5 flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700">
                                            <UserCircle className="w-7 h-7 text-slate-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-extrabold text-slate-900 dark:text-white text-lg truncate leading-tight">{c.nome}</h3>
                                            <p className="text-sm text-slate-500 truncate mt-0.5">{c.endereco_completo || c.cidade + '/' + c.estado}</p>
                                            
                                            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs font-bold">
                                                <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-1 rounded-md border border-emerald-100 dark:border-emerald-500/20">
                                                    Limite: R$ {parseFloat(c.limite_credito || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </span>
                                                {c.saldo_devedor > 0 && (
                                                    <span className="text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-400 px-2 py-1 rounded-md border border-red-100 dark:border-red-500/20">
                                                        Em Atraso: R$ {parseFloat(c.saldo_devedor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900 p-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-4">
                                        <div className="text-xs font-medium text-slate-500 flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-slate-400" />
                                            Última compra: {c.ultima_compra ? new Date(c.ultima_compra).toLocaleDateString() : 'N/A'}
                                        </div>
                                        <Button 
                                            onClick={() => setSelectedCliente(c)}
                                            className="w-full sm:w-auto bg-blue-100 hover:bg-blue-200 text-blue-700 shadow-sm font-bold rounded-xl"
                                            variant="outline"
                                        >
                                            <Search className="w-4 h-4 mr-2" />
                                            Ver Detalhes
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal de Detalhes do Cliente */}
            {selectedCliente && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-0">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95">
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center">
                                    <UserCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-slate-900 dark:text-white leading-tight">{selectedCliente.nome}</h3>
                                    <p className="text-xs text-slate-500">ID: {selectedCliente.id}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedCliente(null)} className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-full transition-colors">
                                <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                            </button>
                        </div>
                        
                        <div className="p-5 space-y-6">
                            {/* Endereço */}
                            <div>
                                <h4 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-2 uppercase tracking-wider">
                                    <MapIcon className="w-4 h-4 text-blue-500" /> Localização
                                </h4>
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-sm text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-700">
                                    {selectedCliente.endereco_completo || `${selectedCliente.endereco || ''} ${selectedCliente.numero || ''}, ${selectedCliente.bairro || ''} - ${selectedCliente.cidade || ''}/${selectedCliente.estado || ''}`}
                                    <a href={`https://maps.google.com/?q=${encodeURIComponent(selectedCliente.endereco_completo || selectedCliente.nome)}`} target="_blank" rel="noopener noreferrer" className="mt-2 text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-500/10 px-2 py-1 rounded-md w-max">
                                        <MapPin className="w-3 h-3" /> Abrir no Maps
                                    </a>
                                </div>
                            </div>

                            {/* Histórico Simulado/Real */}
                            <div>
                                <h4 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-2 uppercase tracking-wider">
                                    <HistoryIcon className="w-4 h-4 text-emerald-500" /> Histórico Recente
                                </h4>
                                <div className="space-y-2">
                                    {/* Mocking recent history since there is no detailed API for it yet, but using real last purchase date */}
                                    {selectedCliente.ultima_compra ? (
                                        <div className="bg-emerald-50 dark:bg-emerald-500/10 p-3 rounded-xl border border-emerald-100 dark:border-emerald-500/20 flex justify-between items-center">
                                            <div>
                                                <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Último Pedido</p>
                                                <p className="text-xs text-emerald-700 dark:text-emerald-400">{new Date(selectedCliente.ultima_compra).toLocaleDateString()}</p>
                                            </div>
                                            <span className="text-emerald-700 font-bold dark:text-emerald-300 text-sm">Realizado</span>
                                        </div>
                                    ) : (
                                        <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 text-center text-sm text-slate-500">
                                            Nenhuma compra recente registrada para este cliente.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                            <Button 
                                onClick={() => iniciarAtendimento(selectedCliente)}
                                className="w-full bg-blue-600 hover:bg-blue-700 shadow-lg font-bold rounded-xl py-6 text-lg"
                            >
                                <ShoppingCart className="w-5 h-5 mr-2" />
                                Iniciar Pedido Agora
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            <SFABottomNav />
        </div>
    );
}
