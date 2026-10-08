import React from 'react';
import {
    Star,
    TrendingUp,
    AlertTriangle,
    Zap,
    Clock,
    TrendingDown,
    DollarSign,
    Percent,
    AlertCircle,
    Tag,
    Package,
} from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';

interface StrategicFiltersPanelProps {
    activeFilters: {
        abc?: 'A' | 'B' | 'C';
        giro?: 'rapido' | 'normal' | 'lento';
        margem?: 'alta' | 'media' | 'baixa';
        acao?: 'repor_urgente' | 'promocao' | 'ajustar_preco';
    };
    onFilterChange: (filterType: string, value: string | undefined) => void;
    stats: {
        abc: { A: number; B: number; C: number };
        giro: { rapido: number; normal: number; lento: number };
        margem: { alta: number; media: number; baixa: number };
        acao: { repor_urgente: number; promocao: number; ajustar_preco: number };
        financeiro: {
            capital_investido: number;
            lucro_potencial: number;
            margem_media: number;
        };
        totais: {
            produtos_filtrados: number;
            produtos_totais: number;
            alertas_criticos: number;
        };
    };
}

const StrategicFiltersPanel: React.FC<StrategicFiltersPanelProps> = ({
    activeFilters,
    onFilterChange,
    stats,
}) => {
    const isFilterActive = (type: string, value: string) => {
        return activeFilters[type as keyof typeof activeFilters] === value;
    };

    const handleFilterClick = (type: string, value: string) => {
        const currentValue = activeFilters[type as keyof typeof activeFilters];
        // Toggle: se já está ativo, desativa; senão, ativa
        onFilterChange(type, currentValue === value ? undefined : value);
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                    <Package className="w-6 h-6 text-blue-600 dark:text-blue-300" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                        🎯 Filtros Estratégicos
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Decisões rápidas baseadas em dados
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                {/* Classificação ABC */}
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                        <Star className="w-4 h-4" />
                        Classificação ABC (Pareto)
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => handleFilterClick('abc', 'A')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('abc', 'A')
                                    ? 'bg-green-500 text-white shadow-lg ring-2 ring-green-300'
                                    : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                            }`}
                        >
                            <Star className="w-4 h-4" />
                            <span>Classe A</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-green-700 dark:text-green-300 rounded-full text-xs font-bold">
                                {stats.abc.A}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('abc', 'B')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('abc', 'B')
                                    ? 'bg-yellow-500 text-white shadow-lg ring-2 ring-yellow-300'
                                    : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800'
                            }`}
                        >
                            <TrendingUp className="w-4 h-4" />
                            <span>Classe B</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-yellow-700 dark:text-yellow-300 rounded-full text-xs font-bold">
                                {stats.abc.B}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('abc', 'C')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('abc', 'C')
                                    ? 'bg-red-500 text-white shadow-lg ring-2 ring-red-300'
                                    : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
                            }`}
                        >
                            <AlertTriangle className="w-4 h-4" />
                            <span>Classe C</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 rounded-full text-xs font-bold">
                                {stats.abc.C}
                            </span>
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        A = 80% faturamento | B = 15% faturamento | C = 5% faturamento
                    </p>
                </div>

                {/* Giro de Estoque */}
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        Giro de Estoque
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => handleFilterClick('giro', 'rapido')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('giro', 'rapido')
                                    ? 'bg-green-500 text-white shadow-lg ring-2 ring-green-300'
                                    : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                            }`}
                        >
                            <Zap className="w-4 h-4" />
                            <span>Rápido (&lt;7d)</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-green-700 dark:text-green-300 rounded-full text-xs font-bold">
                                {stats.giro.rapido}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('giro', 'normal')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('giro', 'normal')
                                    ? 'bg-yellow-500 text-white shadow-lg ring-2 ring-yellow-300'
                                    : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800'
                            }`}
                        >
                            <Clock className="w-4 h-4" />
                            <span>Normal (7-30d)</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-yellow-700 dark:text-yellow-300 rounded-full text-xs font-bold">
                                {stats.giro.normal}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('giro', 'lento')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('giro', 'lento')
                                    ? 'bg-red-500 text-white shadow-lg ring-2 ring-red-300'
                                    : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
                            }`}
                        >
                            <TrendingDown className="w-4 h-4" />
                            <span>Lento (&gt;30d)</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 rounded-full text-xs font-bold">
                                {stats.giro.lento}
                            </span>
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Baseado na última venda do produto
                    </p>
                </div>

                {/* Margem de Lucro */}
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                        <Percent className="w-4 h-4" />
                        Margem de Lucro
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => handleFilterClick('margem', 'alta')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('margem', 'alta')
                                    ? 'bg-green-500 text-white shadow-lg ring-2 ring-green-300'
                                    : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                            }`}
                        >
                            <DollarSign className="w-4 h-4" />
                            <span>Alta (&gt;50%)</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-green-700 dark:text-green-300 rounded-full text-xs font-bold">
                                {stats.margem.alta}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('margem', 'media')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('margem', 'media')
                                    ? 'bg-yellow-500 text-white shadow-lg ring-2 ring-yellow-300'
                                    : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800'
                            }`}
                        >
                            <Percent className="w-4 h-4" />
                            <span>Média (30-50%)</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-yellow-700 dark:text-yellow-300 rounded-full text-xs font-bold">
                                {stats.margem.media}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('margem', 'baixa')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('margem', 'baixa')
                                    ? 'bg-red-500 text-white shadow-lg ring-2 ring-red-300'
                                    : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
                            }`}
                        >
                            <AlertCircle className="w-4 h-4" />
                            <span>Baixa (&lt;30%)</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 rounded-full text-xs font-bold">
                                {stats.margem.baixa}
                            </span>
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Rentabilidade por produto
                    </p>
                </div>

                {/* Ação Necessária */}
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Ação Necessária
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => handleFilterClick('acao', 'repor_urgente')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('acao', 'repor_urgente')
                                    ? 'bg-red-500 text-white shadow-lg ring-2 ring-red-300 animate-pulse'
                                    : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
                            }`}
                        >
                            <AlertTriangle className="w-4 h-4" />
                            <span>Repor Urgente</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 rounded-full text-xs font-bold">
                                {stats.acao.repor_urgente}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('acao', 'promocao')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('acao', 'promocao')
                                    ? 'bg-purple-500 text-white shadow-lg ring-2 ring-purple-300'
                                    : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800'
                            }`}
                        >
                            <Tag className="w-4 h-4" />
                            <span>Fazer Promoção</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-purple-700 dark:text-purple-300 rounded-full text-xs font-bold">
                                {stats.acao.promocao}
                            </span>
                        </button>
                        <button
                            onClick={() => handleFilterClick('acao', 'ajustar_preco')}
                            className={`px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                                isFilterActive('acao', 'ajustar_preco')
                                    ? 'bg-blue-500 text-white shadow-lg ring-2 ring-blue-300'
                                    : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800'
                            }`}
                        >
                            <DollarSign className="w-4 h-4" />
                            <span>Ajustar Preço</span>
                            <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 rounded-full text-xs font-bold">
                                {stats.acao.ajustar_preco}
                            </span>
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Produtos que requerem atenção imediata
                    </p>
                </div>

                {/* Resumo Financeiro */}
                <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-linear-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-300" />
                                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                                    Capital Investido
                                </p>
                            </div>
                            <p className="text-2xl font-bold text-blue-900 dark:text-white">
                                {formatCurrency(stats.financeiro.capital_investido)}
                            </p>
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                Custo × Quantidade
                            </p>
                        </div>

                        <div className="bg-linear-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-300" />
                                <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                                    Lucro Potencial
                                </p>
                            </div>
                            <p className="text-2xl font-bold text-green-900 dark:text-white">
                                {formatCurrency(stats.financeiro.lucro_potencial)}
                            </p>
                            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                {stats.financeiro.margem_media.toFixed(1)}% margem média
                            </p>
                        </div>

                        <div className="bg-linear-to-br from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Package className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                                <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                                    Produtos Filtrados
                                </p>
                            </div>
                            <p className="text-2xl font-bold text-purple-900 dark:text-white">
                                {stats.totais.produtos_filtrados}
                            </p>
                            <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                de {stats.totais.produtos_totais} totais
                            </p>
                        </div>

                        <div className="bg-linear-to-br from-red-50 to-red-100 dark:from-red-900 dark:to-red-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-300" />
                                <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                                    Alertas Críticos
                                </p>
                            </div>
                            <p className="text-2xl font-bold text-red-900 dark:text-white">
                                {stats.totais.alertas_criticos}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                Requerem ação imediata
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StrategicFiltersPanel;
