import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    TrendingUp, Target, DollarSign, ShoppingCart,
    Users, Package, Brain, Lightbulb, BarChart3,
    ArrowUpRight, Calculator,
    RefreshCw
} from "lucide-react";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
    PointElement,
    LineElement,
    Filler
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
    PointElement,
    LineElement,
    Filler
);

interface ProdutoInteligente {
    id: number;
    nome: string;
    categoria: string;
    preco_venda: number;
    quantidade_vendida: number;
    faturamento: number;
    margem_lucro: number;
    tendencia: 'alta' | 'estavel' | 'baixa';
    previsao_proxima_semana: number;
    cross_sell_opportunity: string;
    icone_tendencia: any;
}

interface ClienteInteligente {
    id: number;
    nome: string;
    total_compras: number;
    ticket_medio: number;
    frequencia_compra: number;
    ultima_compra: string;
    potencial_aumento: number;
    perfil: 'premium' | 'regular' | 'ocasional';
    produtos_recomendados: string[];
    risco_churn: 'baixo' | 'medio' | 'alto';
}

interface AnaliseVendasInteligente {
    desempenho_atual: {
        total_vendas: number;
        total_receita: number;
        ticket_medio: number;
        margem_media: number;
        crescimento_vendas: number;
        crescimento_receita: number;
    };
    previsoes: {
        proxima_semana: {
            vendas_estimadas: number;
            receita_estimada: number;
            produtos_mais_vendidos: string[];
        };
        proximo_mes: {
            vendas_estimadas: number;
            receita_estimada: number;
            crescimento_projetado: number;
        };
    };
    oportunidades: Array<{
        tipo: 'cross_sell' | 'up_sell' | 'estoque' | 'preco';
        titulo: string;
        descricao: string;
        impacto_receita: number;
        acao_sugerida: string;
        prioridade: 'alta' | 'media' | 'baixa';
    }>;
    insights: Array<{
        titulo: string;
        descricao: string;
        tipo: 'tendencia' | 'oportunidade' | 'alerta';
        valor_impacto: number;
        dados_suporte: any;
    }>;
}

const VendasInteligentesPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'produtos' | 'clientes' | 'previsoes'>('dashboard');
    const [selectedPeriod, setSelectedPeriod] = useState<'7' | '30' | '90'>('30');
    const [analiseVendas, setAnaliseVendas] = useState<AnaliseVendasInteligente | null>(null);
    const [produtosInteligentes, setProdutosInteligentes] = useState<ProdutoInteligente[]>([]);
    const [clientesInteligentes, setClientesInteligentes] = useState<ClienteInteligente[]>([]);

    const formatarMoeda = (valor: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    };

    const formatarPercentual = (valor: number) => {
        return `${valor > 0 ? '+' : ''}${valor.toFixed(1)}%`;
    };

    const getCorTendencia = (tendencia: string) => {
        switch (tendencia) {
            case 'alta': return '#10B981';
            case 'baixa': return '#EF4444';
            default: return '#6B7280';
        }
    };

    const getCorPerfil = (perfil: string) => {
        switch (perfil) {
            case 'premium': return '#10B981';
            case 'regular': return '#F59E0B';
            default: return '#6B7280';
        }
    };

    const getCorRisco = (risco: string) => {
        switch (risco) {
            case 'baixo': return '#10B981';
            case 'alto': return '#EF4444';
            default: return '#F59E0B';
        }
    };

    // Simulação de análise inteligente (em produção, viria da API com IA)
    const gerarAnaliseInteligente = useCallback(() => {
        const desempenho_atual = {
            total_vendas: 1250,
            total_receita: 45750,
            ticket_medio: 36.60,
            margem_media: 28.5,
            crescimento_vendas: 12.3,
            crescimento_receita: 15.7
        };

        const previsoes = {
            proxima_semana: {
                vendas_estimadas: 320,
                receita_estimada: 11840,
                produtos_mais_vendidos: ['Arroz', 'Feijão', 'Óleo', 'Açúcar']
            },
            proximo_mes: {
                vendas_estimadas: 1450,
                receita_estimada: 53100,
                crescimento_projetado: 16.0
            }
        };

        const oportunidades = [
            {
                tipo: 'cross_sell' as const,
                titulo: 'Oportunidade Cross-Sell',
                descricao: 'Clientes que compram Arroz têm 85% de probabilidade de comprar Feijão',
                impacto_receita: 2500,
                acao_sugerida: 'Criar pacote "Arroz + Feijão" com desconto',
                prioridade: 'alta' as const
            },
            {
                tipo: 'preco' as const,
                titulo: 'Otimização de Preços',
                descricao: 'Produtos de limpeza podem ter aumento de 8% sem impacto na demanda',
                impacto_receita: 1800,
                acao_sugerida: 'Ajustar preços da categoria limpeza',
                prioridade: 'media' as const
            },
            {
                tipo: 'estoque' as const,
                titulo: 'Giro de Estoque',
                descricao: 'Reduzir estoque de produtos sazonais em 20% libera capital',
                impacto_receita: 3200,
                acao_sugerida: 'Promover liquidação de itens sazonais',
                prioridade: 'alta' as const
            }
        ];

        const insights = [
            {
                titulo: 'Tendência de Crescimento',
                descricao: 'Vendas vêm crescendo 12.3% nos últimos 30 dias',
                tipo: 'tendencia' as const,
                valor_impacto: 45750,
                dados_suporte: { crescimento: 12.3, periodo: '30 dias' }
            },
            {
                titulo: 'Oportunidade de Mercado',
                descricao: 'Demanda por produtos orgânicos aumentou 25% na região',
                tipo: 'oportunidade' as const,
                valor_impacto: 8000,
                dados_suporte: { categoria: 'orgânicos', crescimento: 25 }
            }
        ];

        return {
            desempenho_atual,
            previsoes,
            oportunidades,
            insights
        };
    }, []);

    // Simulação de produtos inteligentes
    const gerarProdutosInteligentes = useCallback(() => {
        return [
            {
                id: 1,
                nome: 'Arroz Tipo 1',
                categoria: 'Grãos',
                preco_venda: 25.90,
                quantidade_vendida: 450,
                faturamento: 11655,
                margem_lucro: 32.5,
                tendencia: 'alta' as const,
                previsao_proxima_semana: 520,
                cross_sell_opportunity: 'Feijão, Óleo de Soja',
                icone_tendencia: TrendingUp
            },
            {
                id: 2,
                nome: 'Detergente Líquido',
                categoria: 'Limpeza',
                preco_venda: 18.75,
                quantidade_vendida: 280,
                faturamento: 5250,
                margem_lucro: 45.2,
                tendencia: 'estavel' as const,
                previsao_proxima_semana: 290,
                cross_sell_opportunity: 'Esponja, Limpador Vidros',
                icone_tendencia: Target
            },
            {
                id: 3,
                nome: 'Refrigerante 2L',
                categoria: 'Bebidas',
                preco_venda: 8.50,
                quantidade_vendida: 680,
                faturamento: 5780,
                margem_lucro: 28.8,
                tendencia: 'alta' as const,
                previsao_proxima_semana: 750,
                cross_sell_opportunity: 'Salgadinhos, Amendoim',
                icone_tendencia: TrendingUp
            }
        ];
    }, []);

    // Simulação de clientes inteligentes
    const gerarClientesInteligentes = useCallback(() => {
        return [
            {
                id: 1,
                nome: 'Maria Souza',
                total_compras: 2450,
                ticket_medio: 85.50,
                frequencia_compra: 3.2, // vezes por semana
                ultima_compra: '2024-03-10',
                potencial_aumento: 450,
                perfil: 'premium' as const,
                produtos_recomendados: ['Arroz Premium', 'Carnes Selecionadas'],
                risco_churn: 'baixo' as const
            },
            {
                id: 2,
                nome: 'João Silva',
                total_compras: 1280,
                ticket_medio: 42.30,
                frequencia_compra: 1.8,
                ultima_compra: '2024-03-08',
                potencial_aumento: 180,
                perfil: 'regular' as const,
                produtos_recomendados: ['Feijão', 'Óleo', 'Açúcar'],
                risco_churn: 'medio' as const
            },
            {
                id: 3,
                nome: 'Ana Santos',
                total_compras: 450,
                ticket_medio: 28.90,
                frequencia_compra: 0.8,
                ultima_compra: '2024-03-05',
                potencial_aumento: 85,
                perfil: 'ocasional' as const,
                produtos_recomendados: ['Promoções Semanais'],
                risco_churn: 'alto' as const
            }
        ];
    }, []);

    useEffect(() => {
        setAnaliseVendas(gerarAnaliseInteligente());
        setProdutosInteligentes(gerarProdutosInteligentes());
        setClientesInteligentes(gerarClientesInteligentes());
    }, [gerarAnaliseInteligente, gerarProdutosInteligentes, gerarClientesInteligentes]);

    const dadosGraficoDesempenho = useMemo(() => {
        if (!analiseVendas) return null;

        return {
            labels: ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'],
            datasets: [
                {
                    label: 'Vendas',
                    data: [280, 320, 310, 340],
                    backgroundColor: '#3B82F6',
                    borderColor: '#3B82F6',
                    tension: 0.4
                },
                {
                    label: 'Receita',
                    data: [10200, 11840, 11450, 12560],
                    backgroundColor: '#10B981',
                    borderColor: '#10B981',
                    tension: 0.4
                }
            ]
        };
    }, [analiseVendas]);

    const dadosGraficoCategorias = useMemo(() => {
        return {
            labels: ['Grãos', 'Limpeza', 'Bebidas', 'Laticínios', 'Carnes', 'Outros'],
            datasets: [{
                data: [35, 20, 18, 12, 10, 5],
                backgroundColor: [
                    '#3B82F6', '#10B981', '#F59E0B',
                    '#8B5CF6', '#EF4444', '#6B7280'
                ]
            }]
        };
    }, []);

    return (
        <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header Inteligente */}
                <div className="bg-white rounded-2xl shadow-lg p-8 mb-8 border border-blue-100">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                                <Brain className="w-8 h-8 text-blue-600 mr-3" />
                                Centro de Vendas Inteligente
                            </h1>
                            <p className="text-gray-600 mt-2">
                                Análise preditiva, cross-selling e otimização de receitas
                            </p>
                        </div>
                        <div className="flex items-center space-x-4">
                            <select
                                value={selectedPeriod}
                                onChange={(e) => setSelectedPeriod(e.target.value as any)}
                                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="7">Últimos 7 dias</option>
                                <option value="30">Últimos 30 dias</option>
                                <option value="90">Últimos 90 dias</option>
                            </select>
                            <button className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all transform hover:scale-105">
                                <RefreshCw className="w-5 h-5" />
                                <span>Atualizar IA</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* KPIs Principais */}
                {analiseVendas && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Total de Vendas</p>
                                    <p className="text-2xl font-bold text-gray-900">
                                        {analiseVendas.desempenho_atual.total_vendas}
                                    </p>
                                    <div className="flex items-center mt-2">
                                        <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                                        <span className="text-sm font-medium text-green-500">
                                            {formatarPercentual(analiseVendas.desempenho_atual.crescimento_vendas)}
                                        </span>
                                    </div>
                                </div>
                                <div className="p-3 bg-blue-100 rounded-lg">
                                    <ShoppingCart className="w-6 h-6 text-blue-600" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Receita Total</p>
                                    <p className="text-2xl font-bold text-gray-900">
                                        {formatarMoeda(analiseVendas.desempenho_atual.total_receita)}
                                    </p>
                                    <div className="flex items-center mt-2">
                                        <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                                        <span className="text-sm font-medium text-green-500">
                                            {formatarPercentual(analiseVendas.desempenho_atual.crescimento_receita)}
                                        </span>
                                    </div>
                                </div>
                                <div className="p-3 bg-green-100 rounded-lg">
                                    <DollarSign className="w-6 h-6 text-green-600" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Ticket Médio</p>
                                    <p className="text-2xl font-bold text-gray-900">
                                        {formatarMoeda(analiseVendas.desempenho_atual.ticket_medio)}
                                    </p>
                                    <div className="flex items-center mt-2">
                                        <Target className="w-4 h-4 text-purple-500 mr-1" />
                                        <span className="text-sm font-medium text-purple-500">
                                            Meta: R$ 45,00
                                        </span>
                                    </div>
                                </div>
                                <div className="p-3 bg-purple-100 rounded-lg">
                                    <Calculator className="w-6 h-6 text-purple-600" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-orange-500">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Margem Média</p>
                                    <p className="text-2xl font-bold text-gray-900">
                                        {analiseVendas.desempenho_atual.margem_media.toFixed(1)}%
                                    </p>
                                    <div className="flex items-center mt-2">
                                        <BarChart3 className="w-4 h-4 text-orange-500 mr-1" />
                                        <span className="text-sm font-medium text-orange-500">
                                            Meta: 30%
                                        </span>
                                    </div>
                                </div>
                                <div className="p-3 bg-orange-100 rounded-lg">
                                    <TrendingUp className="w-6 h-6 text-orange-600" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Oportunidades Inteligentes */}
                {analiseVendas && (
                    <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
                        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
                            <Lightbulb className="w-6 h-6 text-yellow-500 mr-2" />
                            Oportunidades Identificadas pela IA
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {analiseVendas.oportunidades.map((oportunidade: any, index: number) => (
                                <div
                                    key={index}
                                    className={`p-4 rounded-lg border-l-4 ${oportunidade.prioridade === 'alta' ? 'bg-red-50 border-red-500' :
                                        oportunidade.prioridade === 'media' ? 'bg-yellow-50 border-yellow-500' :
                                            'bg-blue-50 border-blue-500'
                                        }`}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <h3 className="font-semibold text-gray-900">{oportunidade.titulo}</h3>
                                        <span className={`text-xs px-2 py-1 rounded-full ${oportunidade.prioridade === 'alta' ? 'bg-red-200 text-red-800' :
                                            oportunidade.prioridade === 'media' ? 'bg-yellow-200 text-yellow-800' :
                                                'bg-blue-200 text-blue-800'
                                            }`}>
                                            {oportunidade.prioridade.toUpperCase()}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-700 mb-3">{oportunidade.descricao}</p>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-gray-600">
                                            Impacto: {formatarMoeda(oportunidade.impacto_receita)}
                                        </span>
                                        <button className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center">
                                            Implementar <ArrowUpRight className="w-3 h-3 ml-1" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Tabs de Análise */}
                <div className="bg-white rounded-xl shadow-lg">
                    <div className="border-b border-gray-200">
                        <nav className="flex space-x-8 px-6">
                            {[
                                { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
                                { id: 'produtos', label: 'Produtos Inteligentes', icon: Package },
                                { id: 'clientes', label: 'Clientes IA', icon: Users },
                                { id: 'previsoes', label: 'Previsões', icon: Target }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${activeTab === tab.id
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                        </nav>
                    </div>

                    <div className="p-6">
                        {activeTab === 'dashboard' && (
                            <div className="space-y-8">
                                {/* Gráfico de Desempenho */}
                                {dadosGraficoDesempenho && (
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Tendência de Vendas</h3>
                                        <div className="bg-gray-50 rounded-lg p-4">
                                            <Line data={dadosGraficoDesempenho} options={{
                                                responsive: true,
                                                plugins: {
                                                    legend: { position: 'top' },
                                                    tooltip: {
                                                        callbacks: {
                                                            label: (context: any) => `${context.dataset.label}: ${context.dataset.label === 'Vendas' ? context.parsed.y : formatarMoeda(context.parsed.y as number)}`
                                                        }
                                                    }
                                                }
                                            }} />
                                        </div>
                                    </div>
                                )}

                                {/* Gráfico de Categorias */}
                                {dadosGraficoCategorias && (
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Vendas por Categoria</h3>
                                        <div className="bg-gray-50 rounded-lg p-4">
                                            <Doughnut data={dadosGraficoCategorias} options={{
                                                responsive: true,
                                                plugins: {
                                                    legend: { position: 'right' },
                                                    tooltip: {
                                                        callbacks: {
                                                            label: (context: any) => `${context.label}: ${context.parsed}%`
                                                        }
                                                    }
                                                }
                                            }} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'produtos' && (
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">Análise de Produtos com IA</h3>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Produto</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Categoria</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendas</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Faturamento</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Margem</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tendência</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cross-Sell</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {produtosInteligentes.map((produto: ProdutoInteligente) => (
                                                <tr key={produto.id}>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="text-sm font-medium text-gray-900">{produto.nome}</div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className="text-sm text-gray-600">{produto.categoria}</span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className="text-sm text-gray-900">{produto.quantidade_vendida}</span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className="text-sm font-medium text-gray-900">{formatarMoeda(produto.faturamento)}</span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className="text-sm text-gray-900">{produto.margem_lucro.toFixed(1)}%</span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="flex items-center">
                                                            <produto.icone_tendencia className={`w-4 h-4 mr-1`} style={{ color: getCorTendencia(produto.tendencia) }} />
                                                            <span className="text-sm" style={{ color: getCorTendencia(produto.tendencia) }}>
                                                                {produto.tendencia.charAt(0).toUpperCase() + produto.tendencia.slice(1)}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                                                            {produto.cross_sell_opportunity}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {activeTab === 'clientes' && (
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">Segmentação Inteligente de Clientes</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {clientesInteligentes.map((cliente: ClienteInteligente) => (
                                        <div key={cliente.id} className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                                            <div className="flex items-center justify-between mb-4">
                                                <h4 className="font-semibold text-gray-900">{cliente.nome}</h4>
                                                <span className={`text-xs px-2 py-1 rounded-full`} style={{
                                                    backgroundColor: getCorPerfil(cliente.perfil) + '20',
                                                    color: getCorPerfil(cliente.perfil)
                                                }}>
                                                    {cliente.perfil.toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="space-y-3">
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-gray-600">Total Compras:</span>
                                                    <span className="text-sm font-medium">{formatarMoeda(cliente.total_compras)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-gray-600">Ticket Médio:</span>
                                                    <span className="text-sm font-medium">{formatarMoeda(cliente.ticket_medio)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-gray-600">Frequência:</span>
                                                    <span className="text-sm font-medium">{cliente.frequencia_compra}/sem</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-gray-600">Risco Churn:</span>
                                                    <span className="text-sm font-medium" style={{ color: getCorRisco(cliente.risco_churn) }}>
                                                        {cliente.risco_churn.toUpperCase()}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-4 pt-4 border-t border-gray-200">
                                                <div className="text-sm text-gray-600 mb-2">Recomendado:</div>
                                                <div className="flex flex-wrap gap-1">
                                                    {cliente.produtos_recomendados.map((produto: string, index: number) => (
                                                        <span key={index} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                                            {produto}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'previsoes' && analiseVendas && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Previsão para Próxima Semana</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div className="bg-blue-50 rounded-lg p-4">
                                            <h4 className="font-medium text-blue-900 mb-2">Vendas Estimadas</h4>
                                            <p className="text-2xl font-bold text-blue-900">
                                                {analiseVendas.previsoes.proxima_semana.vendas_estimadas}
                                            </p>
                                        </div>
                                        <div className="bg-green-50 rounded-lg p-4">
                                            <h4 className="font-medium text-green-900 mb-2">Receita Estimada</h4>
                                            <p className="text-2xl font-bold text-green-900">
                                                {formatarMoeda(analiseVendas.previsoes.proxima_semana.receita_estimada)}
                                            </p>
                                        </div>
                                        <div className="bg-purple-50 rounded-lg p-4">
                                            <h4 className="font-medium text-purple-900 mb-2">Produtos em Alta</h4>
                                            <div className="space-y-1">
                                                {analiseVendas.previsoes.proxima_semana.produtos_mais_vendidos.map((produto: string, index: number) => (
                                                    <div key={index} className="text-sm text-purple-900">
                                                        • {produto}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Projeção Mensal</h3>
                                    <div className="bg-linear-to-r from-indigo-50 to-purple-50 rounded-lg p-6 border border-indigo-200">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            <div className="text-center">
                                                <h4 className="font-medium text-indigo-900 mb-2">Crescimento Projetado</h4>
                                                <p className="text-3xl font-bold text-indigo-900">
                                                    {formatarPercentual(analiseVendas.previsoes.proximo_mes.crescimento_projetado)}
                                                </p>
                                            </div>
                                            <div className="text-center">
                                                <h4 className="font-medium text-green-900 mb-2">Vendas Estimadas</h4>
                                                <p className="text-3xl font-bold text-green-900">
                                                    {analiseVendas.previsoes.proximo_mes.vendas_estimadas}
                                                </p>
                                            </div>
                                            <div className="text-center">
                                                <h4 className="font-medium text-purple-900 mb-2">Receita Projetada</h4>
                                                <p className="text-3xl font-bold text-purple-900">
                                                    {formatarMoeda(analiseVendas.previsoes.proximo_mes.receita_estimada)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VendasInteligentesPage;
