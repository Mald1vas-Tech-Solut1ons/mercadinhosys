import React from 'react';
import {
    Star,
    AlertTriangle,
    Zap,
    TrendingDown,
    DollarSign,
    Package,
    Clock,
} from 'lucide-react';
import { useViewSchema, schemaHelpers } from '../../../services/viewSchemaService';

interface QuickFiltersPanelProps {
    activeFilter: string | null;
    onFilterChange: (filter: string | null) => void;
    counts: {
        classe_a: number;
        classe_c: number;
        giro_rapido: number;
        giro_lento: number;
        margem_alta: number;
        margem_baixa: number;
        repor_urgente: number;
        sem_fornecedor: number;
        vencimento_proximo: number;
        vencido: number;
    };
}

const QuickFiltersPanel: React.FC<QuickFiltersPanelProps> = ({
    activeFilter,
    onFilterChange,
    counts,
}) => {
    // Motor contextual: chips de validade só existem se o segmento controla validade
    const { schema } = useViewSchema();
    const usaValidade = schemaHelpers.usaValidade(schema);

    const filters = [
        {
            id: 'classe_a',
            label: 'Estrelas (Classe A)',
            icon: <Star className="w-4 h-4" />,
            color: 'green',
            count: counts.classe_a,
            description: '80% do faturamento',
        },
        {
            id: 'classe_c',
            label: 'Encalhados (Classe C)',
            icon: <AlertTriangle className="w-4 h-4" />,
            color: 'red',
            count: counts.classe_c,
            description: 'Baixo faturamento',
        },
        ...(usaValidade ? [
            {
                id: 'vencimento_proximo',
                label: 'Vence em 30 dias',
                icon: <Clock className="w-4 h-4" />,
                color: 'yellow',
                count: counts.vencimento_proximo,
                description: 'Atenção à validade',
                pulse: counts.vencimento_proximo > 0,
            },
            {
                id: 'vencido',
                label: 'Vencidos',
                icon: <AlertTriangle className="w-4 h-4" />,
                color: 'red',
                count: counts.vencido,
                description: 'Remover do estoque',
                pulse: counts.vencido > 0,
            },
        ] : []),
        {
            id: 'giro_rapido',
            label: 'Giro Rápido',
            icon: <Zap className="w-4 h-4" />,
            color: 'blue',
            count: counts.giro_rapido,
            // Descrições espelham o critério REAL (cobertura de estoque via
            // classificar_giro_produto no backend) — o rótulo antigo prometia
            // "vendeu nos últimos 7 dias", que não era o que o filtro fazia.
            description: 'Estoque gira em até 15 dias no ritmo atual de venda',
        },
        {
            id: 'giro_lento',
            label: 'Giro Lento',
            icon: <TrendingDown className="w-4 h-4" />,
            color: 'orange',
            count: counts.giro_lento,
            description: 'Estoque leva mais de 60 dias para girar (ou sem vendas)',
        },
        {
            id: 'margem_alta',
            label: 'Alta Margem (>50%)',
            icon: <DollarSign className="w-4 h-4" />,
            color: 'emerald',
            count: counts.margem_alta,
            description: 'Mais rentáveis',
        },
        {
            id: 'repor_urgente',
            label: 'Repor Urgente',
            icon: <Package className="w-4 h-4" />,
            color: 'red',
            count: counts.repor_urgente,
            description: 'Esgotados ou baixo estoque',
            pulse: true,
        },
    ];

    const colorClasses = {
        green: {
            bg: 'bg-green-100 dark:bg-green-900',
            text: 'text-green-700 dark:text-green-300',
            hover: 'hover:bg-green-200 dark:hover:bg-green-800',
            active: 'bg-green-500 text-white ring-2 ring-green-300',
        },
        red: {
            bg: 'bg-red-100 dark:bg-red-900',
            text: 'text-red-700 dark:text-red-300',
            hover: 'hover:bg-red-200 dark:hover:bg-red-800',
            active: 'bg-red-500 text-white ring-2 ring-red-300',
        },
        blue: {
            bg: 'bg-blue-100 dark:bg-blue-900',
            text: 'text-blue-700 dark:text-blue-300',
            hover: 'hover:bg-blue-200 dark:hover:bg-blue-800',
            active: 'bg-blue-500 text-white ring-2 ring-blue-300',
        },
        orange: {
            bg: 'bg-orange-100 dark:bg-orange-900',
            text: 'text-orange-700 dark:text-orange-300',
            hover: 'hover:bg-orange-200 dark:hover:bg-orange-800',
            active: 'bg-orange-500 text-white ring-2 ring-orange-300',
        },
        emerald: {
            bg: 'bg-emerald-100 dark:bg-emerald-900',
            text: 'text-emerald-700 dark:text-emerald-300',
            hover: 'hover:bg-emerald-200 dark:hover:bg-emerald-800',
            active: 'bg-emerald-500 text-white ring-2 ring-emerald-300',
        },
        yellow: {
            bg: 'bg-yellow-100 dark:bg-yellow-900',
            text: 'text-yellow-700 dark:text-yellow-300',
            hover: 'hover:bg-yellow-200 dark:hover:bg-yellow-800',
            active: 'bg-yellow-500 text-white ring-2 ring-yellow-300',
        },
        gray: {
            bg: 'bg-gray-100 dark:bg-gray-700',
            text: 'text-gray-700 dark:text-gray-300',
            hover: 'hover:bg-gray-200 dark:hover:bg-gray-600',
            active: 'bg-gray-500 text-white ring-2 ring-gray-300',
        },
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Filtros Rápidos
                </h3>
                {activeFilter && (
                    <button
                        onClick={() => onFilterChange(null)}
                        className="ml-auto text-xs px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                        Limpar Filtro
                    </button>
                )}
            </div>

            <div className="flex overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 gap-2 sm:grid sm:grid-cols-4 lg:grid-cols-8 snap-x snap-mandatory hide-scrollbar">
                {filters.map((filter) => {
                    const isActive = activeFilter === filter.id;
                    const colors = colorClasses[filter.color as keyof typeof colorClasses];

                    return (
                        <button
                            key={filter.id}
                            onClick={() => onFilterChange(isActive ? null : filter.id)}
                            className={`
                                p-3 rounded-lg transition-all duration-200 text-left min-w-[150px] sm:min-w-0 snap-start shrink-0
                                ${isActive ? colors.active : `${colors.bg} ${colors.text} ${colors.hover}`}
                                ${filter.pulse && !isActive ? 'animate-pulse' : ''}
                            `}
                            title={filter.description}
                        >
                            <div className="flex items-center gap-2 mb-1">
                                {filter.icon}
                                <span className="text-lg font-bold">{filter.count}</span>
                            </div>
                            <p className="text-xs font-medium leading-tight">
                                {filter.label}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default QuickFiltersPanel;
