import React, { useState, useEffect, useCallback } from 'react';
import {
    Building2,
    Users,
    Package,
    DollarSign,
    TrendingUp,
    RefreshCcw,
    BarChart3,
    Activity
} from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import toast from 'react-hot-toast';
import EstablishmentSelector from '../../components/EstablishmentSelector';

interface Estabelecimento {
    id: number;
    nome_fantasia: string;
    razao_social: string;
    cnpj: string;
    cidade: string;
    estado: string;
    plano: string;
    plano_status: string;
    ativo: boolean;
    vendas_hoje: number;
    total_vendas: number;
    produtos_count: number;
    funcionarios_count: number;
    clientes_count: number;
}

interface DashboardEspecifico {
    vendas_hoje: {
        quantidade: number;
        valor: number;
    };
    vendas_mes: {
        quantidade: number;
        valor: number;
    };
    produtos: {
        total: number;
        baixo_estoque: number;
    };
    clientes: {
        total: number;
        novos: number;
        ativos: number;
    };
    funcionarios: {
        total: number;
        ativos: number;
    };
    financeiro: {
        receitas_mes: number;
        despesas_mes: number;
        lucro_mes: number;
    };
}

interface ResumoSistema {
    sistema: {
        total_estabelecimentos: number;
        total_funcionarios: number;
        total_produtos: number;
        vendas_totais: {
            quantidade: number;
            valor: number;
        };
        vendas_30_dias: {
            quantidade: number;
            valor: number;
        };
    };
    top_estabelecimentos: Array<{
        estabelecimento_id: number;
        nome: string;
        vendas_quantidade: number;
        vendas_valor: number;
    }>;
    data_geracao: string;
}

const SuperAdminDashboardFixed: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'overview' | 'estabelecimentos' | 'dashboard' | 'vendas' | 'produtos' | 'clientes' | 'financeiro'>('overview');
    const [loading, setLoading] = useState(false);
    const [estabelecimentos, setEstabelecimentos] = useState<Estabelecimento[]>([]);
    const [selectedEstabelecimento, setSelectedEstabelecimento] = useState<number | null>(null);
    const [dashboardData, setDashboardData] = useState<DashboardEspecifico | null>(null);
    const [resumoSistema, setResumoSistema] = useState<ResumoSistema | null>(null);
    const [sincronizando, setSincronizando] = useState(false);

    // Carregar lista de estabelecimentos
    const fetchEstabelecimentos = useCallback(async () => {
        try {
            setLoading(true);
            const response = await apiClient.get('/super-admin-dashboard/estabelecimentos-ativos');
            if (response.data?.success) {
                setEstabelecimentos(response.data.estabelecimentos);
            } else {
                toast.error('Erro ao carregar estabelecimentos');
            }
        } catch (error) {
            console.error('Erro ao carregar estabelecimentos:', error);
            toast.error('Erro ao carregar estabelecimentos');
        } finally {
            setLoading(false);
        }
    }, []);

    // Carregar resumo do sistema
    const fetchResumoSistema = useCallback(async () => {
        try {
            setLoading(true);
            const response = await apiClient.get('/super-admin-dashboard/resumo-geral');
            if (response.data?.success) {
                setResumoSistema(response.data);
            } else {
                toast.error('Erro ao carregar resumo do sistema');
            }
        } catch (error) {
            console.error('Erro ao carregar resumo:', error);
            toast.error('Erro ao carregar resumo do sistema');
        } finally {
            setLoading(false);
        }
    }, []);

    // Carregar dashboard específico
    const fetchDashboardEstabelecimento = useCallback(async (estabelecimentoId: number) => {
        try {
            setLoading(true);
            const response = await apiClient.get(`/super-admin-dashboard/dashboard/${estabelecimentoId}`);
            if (response.data?.success) {
                setDashboardData(response.data);
            } else {
                toast.error('Erro ao carregar dashboard do estabelecimento');
            }
        } catch (error) {
            console.error('Erro ao carregar dashboard:', error);
            toast.error('Erro ao carregar dashboard do estabelecimento');
        } finally {
            setLoading(false);
        }
    }, []);

    // Sincronizar dados
    const sincronizarDados = async () => {
        try {
            setSincronizando(true);
            const response = await apiClient.post('/super-admin-dashboard/sincronizar', {
                estabelecimento_id: selectedEstabelecimento
            });

            if (response.data?.success) {
                toast.success('Dados sincronizados com sucesso!');
                if (selectedEstabelecimento) {
                    fetchDashboardEstabelecimento(selectedEstabelecimento);
                }
            } else {
                toast.error('Erro ao sincronizar dados');
            }
        } catch (error) {
            console.error('Erro ao sincronizar:', error);
            toast.error('Erro ao sincronizar dados');
        } finally {
            setSincronizando(false);
        }
    };

    // Carregar dados iniciais
    useEffect(() => {
        if (activeTab === 'estabelecimentos') {
            fetchEstabelecimentos();
        } else if (activeTab === 'overview') {
            fetchResumoSistema();
        }
    }, [activeTab, fetchEstabelecimentos, fetchResumoSistema]);

    const formatarMoeda = (valor: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    };


    return (
        <div className="min-h-screen bg-gray-50 p-6 dark:bg-gray-900">
            <div className="max-w-7xl mx-auto">
                {/* Header com Seletor de Estabelecimento */}
                <div className="bg-white rounded-lg shadow-sm p-6 mb-6 dark:bg-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 flex items-center dark:text-gray-100">
                                <Building2 className="w-8 h-8 text-blue-600 mr-3" />
                                Super Admin Dashboard
                            </h1>
                            <p className="text-gray-600 mt-2 dark:text-gray-300">
                                Gerencie todos os estabelecimentos
                            </p>
                        </div>

                        {/* Seletor de Estabelecimento */}
                        <EstablishmentSelector
                            selectedEstablishment={selectedEstabelecimento}
                            onEstablishmentChange={(estabelecimentoId) => {
                                setSelectedEstabelecimento(estabelecimentoId);
                                fetchDashboardEstabelecimento(estabelecimentoId);
                                setActiveTab('dashboard');
                            }}
                            className="w-96"
                        />
                    </div>
                </div>

                {/* Conteúdo Principal */}
                {activeTab === 'overview' && resumoSistema && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                        {/* Cards do Resumo */}
                        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                            <div className="flex items-center">
                                <Building2 className="w-8 h-8 text-blue-600 mr-3" />
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Estabelecimentos</h3>
                                    <p className="text-3xl font-bold text-blue-600">{resumoSistema.sistema.total_estabelecimentos}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                            <div className="flex items-center">
                                <Users className="w-8 h-8 text-green-600 mr-3" />
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Funcionários</h3>
                                    <p className="text-3xl font-bold text-green-600">{resumoSistema.sistema.total_funcionarios}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                            <div className="flex items-center">
                                <Package className="w-8 h-8 text-purple-600 mr-3" />
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Produtos</h3>
                                    <p className="text-3xl font-bold text-purple-600">{resumoSistema.sistema.total_produtos}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                            <div className="flex items-center">
                                <DollarSign className="w-8 h-8 text-orange-600 mr-3" />
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Vendas Totais</h3>
                                    <p className="text-3xl font-bold text-orange-600">{resumoSistema.sistema.vendas_totais.quantidade}</p>
                                    <p className="text-sm text-gray-600 dark:text-gray-300">{formatarMoeda(resumoSistema.sistema.vendas_totais.valor)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'estabelecimentos' && (
                    <div className="bg-white rounded-lg shadow-sm overflow-hidden dark:bg-gray-800">
                        <div className="p-6">
                            <h2 className="text-2xl font-bold text-gray-900 mb-6 dark:text-gray-100">Todos os Estabelecimentos</h2>

                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50 dark:bg-gray-900">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Estabelecimento</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Cidade</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Plano</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Status</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Vendas Hoje</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800">
                                            {estabelecimentos.map((estabelecimento) => (
                                                <tr key={estabelecimento.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {estabelecimento.nome_fantasia}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="text-sm text-gray-600 dark:text-gray-300">
                                                            {estabelecimento.cidade}/{estabelecimento.estado}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                            {estabelecimento.plano}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                            {estabelecimento.plano_status}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="text-sm text-gray-900 dark:text-gray-100">
                                                            {estabelecimento.vendas_hoje}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                        <button
                                                            onClick={() => {
                                                                setSelectedEstabelecimento(estabelecimento.id);
                                                                fetchDashboardEstabelecimento(estabelecimento.id);
                                                                setActiveTab('dashboard');
                                                            }}
                                                            className="text-blue-600 hover:text-blue-900"
                                                        >
                                                            Ver Dashboard
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {(activeTab === 'dashboard' || activeTab === 'vendas' || activeTab === 'produtos' || activeTab === 'clientes' || activeTab === 'financeiro') && dashboardData && (
                    <div className="space-y-6">
                        {/* Header do Estabelecimento Selecionado */}
                        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                        {estabelecimentos.find(e => e.id === selectedEstabelecimento)?.nome_fantasia}
                                    </h2>
                                    <p className="text-gray-600 dark:text-gray-300">Dashboard Específico</p>
                                </div>

                                <button
                                    onClick={sincronizarDados}
                                    disabled={sincronizando}
                                    className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                                >
                                    <RefreshCcw className="w-4 h-4" />
                                    <span>{sincronizando ? 'Sincronizando...' : 'Sincronizar Dados'}</span>
                                </button>
                            </div>
                        </div>

                        {/* Tabs do Dashboard Específico */}
                        <div className="bg-white rounded-lg shadow-sm dark:bg-gray-800">
                            <div className="border-b border-gray-200 dark:border-gray-700">
                                <nav className="flex space-x-8 px-6">
                                    <button
                                        onClick={() => setActiveTab('vendas')}
                                        className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'vendas'
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                            } dark:text-gray-400`}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <TrendingUp className="w-4 h-4" />
                                            <span>Vendas</span>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('produtos')}
                                        className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'produtos'
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                            } dark:text-gray-400`}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <Package className="w-4 h-4" />
                                            <span>Produtos</span>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('clientes')}
                                        className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'clientes'
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                            } dark:text-gray-400`}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <Users className="w-4 h-4" />
                                            <span>Clientes</span>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('financeiro')}
                                        className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'financeiro'
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                            } dark:text-gray-400`}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <DollarSign className="w-4 h-4" />
                                            <span>Financeiro</span>
                                        </div>
                                    </button>
                                </nav>
                            </div>
                        </div>

                        {/* Conteúdo do Dashboard */}
                        <div className="p-6">
                            {activeTab === 'vendas' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Vendas Hoje</h3>
                                        <p className="text-3xl font-bold text-blue-600">{dashboardData.vendas_hoje.quantidade}</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">{formatarMoeda(dashboardData.vendas_hoje.valor)}</p>
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Vendas Mês</h3>
                                        <p className="text-3xl font-bold text-green-600">{dashboardData.vendas_mes.quantidade}</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">{formatarMoeda(dashboardData.vendas_mes.valor)}</p>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'produtos' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Total Produtos</h3>
                                        <p className="text-3xl font-bold text-purple-600">{dashboardData.produtos.total}</p>
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Baixo Estoque</h3>
                                        <p className="text-3xl font-bold text-red-600">{dashboardData.produtos.baixo_estoque}</p>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'clientes' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Total Clientes</h3>
                                        <p className="text-3xl font-bold text-blue-600">{dashboardData.clientes.total}</p>
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Novos Clientes</h3>
                                        <p className="text-3xl font-bold text-green-600">{dashboardData.clientes.novos}</p>
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Clientes Ativos</h3>
                                        <p className="text-3xl font-bold text-purple-600">{dashboardData.clientes.ativos}</p>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'financeiro' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Receitas Mês</h3>
                                        <p className="text-3xl font-bold text-green-600">{formatarMoeda(dashboardData.financeiro.receitas_mes)}</p>
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Despesas Mês</h3>
                                        <p className="text-3xl font-bold text-red-600">{formatarMoeda(dashboardData.financeiro.despesas_mes)}</p>
                                    </div>
                                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Lucro Mês</h3>
                                        <p className="text-3xl font-bold text-blue-600">{formatarMoeda(dashboardData.financeiro.lucro_mes)}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Tabs de Navegação */}
                <div className="bg-white rounded-lg shadow-sm mb-6 dark:bg-gray-800">
                    <div className="border-b border-gray-200 dark:border-gray-700">
                        <nav className="flex space-x-8 px-6">
                            <button
                                onClick={() => setActiveTab('overview')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'overview'
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    } dark:text-gray-400`}
                            >
                                <div className="flex items-center space-x-2">
                                    <BarChart3 className="w-4 h-4" />
                                    <span>Visão Geral</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('estabelecimentos')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'estabelecimentos'
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    } dark:text-gray-400`}
                            >
                                <div className="flex items-center space-x-2">
                                    <Building2 className="w-4 h-4" />
                                    <span>Estabelecimentos</span>
                                </div>
                            </button>
                            {selectedEstabelecimento && (
                                <button
                                    onClick={() => setActiveTab('dashboard')}
                                    className={`py-4 px-1 border-b-2 font-medium text-sm ${(activeTab === 'dashboard' || activeTab === 'vendas' || activeTab === 'produtos' || activeTab === 'clientes' || activeTab === 'financeiro')
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                        } dark:text-gray-400`}
                                >
                                    <div className="flex items-center space-x-2">
                                        <Activity className="w-4 h-4" />
                                        <span>Dashboard</span>
                                    </div>
                                </button>
                            )}
                        </nav>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SuperAdminDashboardFixed;
