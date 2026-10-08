import React, { useState, useEffect } from 'react';
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    Package,
    AlertTriangle,
    BarChart3,
    PieChart,
    Activity,
    Zap,
    Clock,
    Target,
    Wrench,
    X
} from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import { Produto } from '../../../types';
import { MetricaSchema } from '../../../types/viewSchema';
import { useViewSchema, schemaHelpers } from '../../../services/viewSchemaService';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend as RechartsLegend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

interface ProductAnalyticsDashboardProps {
    produtos: Produto[];
    stats: {
        total_produtos: number;
        total_servicos?: number;
        produtos_baixo_estoque: number;
        produtos_esgotados: number;
        produtos_normal: number;
        valor_total_estoque: number;
        margem_media: number;
        classificacao_abc?: { A: number; B: number; C: number };
        giro_estoque?: { rapido: number; normal: number; lento: number };
        validade?: { vencidos: number; vence_15: number; vence_30: number; vence_90: number };
        top_produtos_margem?: any[];
        produtos_criticos?: any[];
    };
    onCardClick: (filterType: string) => void;
    onAdvancedAnalyticsClick: (type: string) => void;
    onProductClick: (produto: Produto) => void;
}

// ==================== MOTOR DE RENDERIZAÇÃO CONTEXTUAL ====================
// Os cards NÃO são fixos: vêm do catálogo de métricas (view_registry) resolvido
// pelo backend por segmento. Aqui só mapeamos ícone/tema e formatamos valores.
const ICONES_METRICA: Record<string, React.ComponentType<any>> = {
    package: Package, target: Target, alert: AlertTriangle, activity: Activity,
    dollar: DollarSign, pie: PieChart, wrench: Wrench, bar: BarChart3, zap: Zap, clock: Clock,
};

interface TemaMetrica {
    icone: string; borda: string; hover: string; valor: string; dot: string; subtitulo: string;
    modal: { header: string; text: string; button: string; stroke: string; shadow: string };
}

const TEMAS_METRICA: Record<string, TemaMetrica> = {
    blue: {
        icone: 'text-blue-500', borda: 'border-slate-800', hover: 'hover:border-blue-500/50',
        valor: 'text-white', dot: 'bg-blue-500', subtitulo: 'text-slate-500',
        modal: { header: 'bg-blue-600', text: 'text-blue-600 dark:text-blue-400', button: 'bg-blue-600 hover:bg-blue-700', stroke: '#3b82f6', shadow: 'shadow-blue-600/30' },
    },
    emerald: {
        icone: 'text-emerald-500', borda: 'border-slate-800', hover: 'hover:border-emerald-500/50',
        valor: 'text-white', dot: 'bg-emerald-500', subtitulo: 'text-slate-500',
        modal: { header: 'bg-emerald-600', text: 'text-emerald-600 dark:text-emerald-400', button: 'bg-emerald-600 hover:bg-emerald-700', stroke: '#10b981', shadow: 'shadow-emerald-600/30' },
    },
    amber: {
        icone: 'text-amber-500', borda: 'border-amber-500/30', hover: 'hover:border-amber-500/60',
        valor: 'text-amber-400', dot: 'bg-amber-500', subtitulo: 'text-amber-500/70',
        modal: { header: 'bg-amber-500', text: 'text-amber-500 dark:text-amber-400', button: 'bg-amber-500 hover:bg-amber-600', stroke: '#f59e0b', shadow: 'shadow-amber-500/30' },
    },
    rose: {
        icone: 'text-rose-500', borda: 'border-rose-500/40', hover: 'hover:border-rose-500/70',
        valor: 'text-rose-500', dot: 'bg-rose-500 animate-ping', subtitulo: 'text-rose-500/80',
        modal: { header: 'bg-rose-500', text: 'text-rose-500 dark:text-rose-400', button: 'bg-rose-500 hover:bg-rose-600', stroke: '#f43f5e', shadow: 'shadow-rose-500/30' },
    },
    purple: {
        icone: 'text-purple-500', borda: 'border-slate-800', hover: 'hover:border-purple-500/50',
        valor: 'text-white', dot: 'bg-purple-500', subtitulo: 'text-slate-500',
        modal: { header: 'bg-purple-600', text: 'text-purple-500 dark:text-purple-400', button: 'bg-purple-600 hover:bg-purple-700', stroke: '#a855f7', shadow: 'shadow-purple-600/30' },
    },
    indigo: {
        icone: 'text-indigo-500', borda: 'border-slate-800', hover: 'hover:border-indigo-500/50',
        valor: 'text-white', dot: 'bg-indigo-500', subtitulo: 'text-slate-500',
        modal: { header: 'bg-indigo-600', text: 'text-indigo-500 dark:text-indigo-400', button: 'bg-indigo-600 hover:bg-indigo-700', stroke: '#6366f1', shadow: 'shadow-indigo-600/30' },
    },
    cyan: {
        icone: 'text-cyan-500', borda: 'border-slate-800', hover: 'hover:border-cyan-500/50',
        valor: 'text-white', dot: 'bg-cyan-500', subtitulo: 'text-slate-500',
        modal: { header: 'bg-cyan-600', text: 'text-cyan-500 dark:text-cyan-400', button: 'bg-cyan-600 hover:bg-cyan-700', stroke: '#06b6d4', shadow: 'shadow-cyan-600/30' },
    },
};

// Fallback exibido enquanto o schema carrega (mesma composição do registro global)
const METRICAS_FALLBACK: MetricaSchema[] = [
    { chave: 'total_produtos', titulo: 'Total Produtos', subtitulo: 'Catálogo completo', escopo_ui: 'card', fonte: 'total_produtos', formato: 'int', icone: 'package', tema: 'blue', filtro: 'all', ordem: 10 },
    { chave: 'estoque_normal', titulo: 'Estoque Normal', subtitulo: '% do total', escopo_ui: 'card', fonte: 'produtos_normal', formato: 'int', icone: 'target', tema: 'emerald', filtro: 'normal', ordem: 20 },
    { chave: 'baixo_estoque', titulo: 'Baixo Estoque', subtitulo: 'Requer atenção', escopo_ui: 'card', fonte: 'produtos_baixo_estoque', formato: 'int', icone: 'alert', tema: 'amber', filtro: 'baixo', ordem: 30 },
    { chave: 'esgotados', titulo: 'Esgotados', subtitulo: 'Crítico', escopo_ui: 'card', fonte: 'produtos_esgotados', formato: 'int', icone: 'activity', tema: 'rose', filtro: 'esgotado', ordem: 40 },
    { chave: 'valor_estoque', titulo: 'Valor Estoque', subtitulo: 'Capital investido', escopo_ui: 'card', fonte: 'valor_total_estoque', formato: 'moeda', icone: 'dollar', tema: 'purple', filtro: 'valor', ordem: 50 },
    { chave: 'margem_media', titulo: 'Margem Média', subtitulo: 'Rentabilidade', escopo_ui: 'card', fonte: 'margem_media', formato: 'percent', icone: 'pie', tema: 'indigo', filtro: 'margem', ordem: 60 },
];

function valorDaFonte(stats: any, fonte: string): number {
    const bruto = fonte.split('.').reduce((acc: any, parte) => (acc == null ? acc : acc[parte]), stats);
    return typeof bruto === 'number' ? bruto : 0;
}

function formatarValor(valor: number, formato: MetricaSchema['formato']): string {
    if (formato === 'moeda') return formatCurrency(valor);
    if (formato === 'percent') return `${valor.toFixed(1)}%`;
    return String(Math.round(valor));
}

interface ClassificacaoABC {
    A: number;
    B: number;
    C: number;
}

interface StatusGiro {
    rapido: number;
    normal: number;
    lento: number;
}

const ProductAnalyticsDashboard: React.FC<ProductAnalyticsDashboardProps> = ({
    produtos,
    stats,
    onCardClick,
    onAdvancedAnalyticsClick,
    onProductClick
}) => {
    // Motor de Renderização Contextual: schema resolvido pelo backend por segmento
    const { schema } = useViewSchema();

    const [classificacaoABC, setClassificacaoABC] = useState<ClassificacaoABC>({ A: 0, B: 0, C: 0 });
    const [statusGiro, setStatusGiro] = useState<StatusGiro>({ rapido: 0, normal: 0, lento: 0 });
    const [validadeState, setValidadeState] = useState({ vencidos: 0, vence_15: 0, vence_30: 0, vence_90: 0 });
    const [topProdutos, setTopProdutos] = useState<Produto[]>([]);
    const [produtosCriticos, setProdutosCriticos] = useState<Produto[]>([]);

    const [activeMetricModal, setActiveMetricModal] = useState<{ 
        id: string, 
        title: string, 
        value: number, 
        formattedValue: string, 
        isCurrency: boolean, 
        icon: any, 
        theme: { header: string, text: string, button: string, stroke: string, shadow: string } 
    } | null>(null);

    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#6366f1', '#ec4899'];

    // Data para o gráfico do modal (Composição por Categoria)
    const getModalChartData = () => {
        if (!activeMetricModal || !produtos) return [];
        const categorias: any = {};
        let dataToProcess = produtos;

        if (activeMetricModal.id === 'normal') {
            dataToProcess = produtos.filter(p => (p.quantidade || 0) > (p.quantidade_minima || 0) && p.estoque_status !== 'esgotado');
        } else if (activeMetricModal.id === 'baixo') {
            dataToProcess = produtos.filter(p => (p.quantidade || 0) <= (p.quantidade_minima || 0) && (p.quantidade || 0) > 0);
        } else if (activeMetricModal.id === 'esgotado') {
            dataToProcess = produtos.filter(p => (p.quantidade || 0) === 0 || p.estoque_status === 'esgotado');
        }

        dataToProcess.forEach(p => {
            const cat = p.categoria || 'Sem Categoria';
            if (!categorias[cat]) {
                if (activeMetricModal.id === 'margem') categorias[cat] = { sum: 0, count: 0 };
                else categorias[cat] = 0;
            }
            
            if (activeMetricModal.id === 'valor') {
                categorias[cat] += ((p.quantidade || 0) * (p.preco_custo || 0));
            } else if (activeMetricModal.id === 'margem') {
                categorias[cat].sum += (p.margem_lucro || 0);
                categorias[cat].count += 1;
            } else {
                categorias[cat] += 1;
            }
        });

        if (activeMetricModal.id === 'margem') {
            return Object.keys(categorias).map(cat => ({
                name: cat,
                value: categorias[cat].count > 0 ? (categorias[cat].sum / categorias[cat].count) : 0
            })).sort((a, b) => b.value - a.value).slice(0, 6);
        }

        return Object.keys(categorias).map(cat => ({
            name: cat,
            value: categorias[cat]
        })).sort((a, b) => b.value - a.value).slice(0, 6);
    };

    useEffect(() => {
        // Se não tiver produtos E não tiver stats do backend, limpa tudo
        if ((!produtos || produtos.length === 0) && !stats.classificacao_abc) {
            setClassificacaoABC({ A: 0, B: 0, C: 0 });
            setStatusGiro({ rapido: 0, normal: 0, lento: 0 });
            setValidadeState({ vencidos: 0, vence_15: 0, vence_30: 0, vence_90: 0 });
            setTopProdutos([]);
            setProdutosCriticos([]);
            // Continuar execução para pegar stats se existirem
        }

        // ==================== USAR ESTATÍSTICAS DO BACKEND ====================
        // Se o backend forneceu as estatísticas, usar elas (já calculadas para TODOS os produtos)
        if (stats.classificacao_abc) {
            setClassificacaoABC(stats.classificacao_abc);
        } else if (produtos && produtos.length > 0) {
            // Fallback: calcular localmente (apenas para os produtos da página)
            const faturamentoTotal = produtos.reduce((sum, p) => sum + (p.total_vendido || 0), 0);
            const abc = { A: 0, B: 0, C: 0 };

            if (faturamentoTotal === 0) {
                abc.C = produtos.length;
            } else {
                const produtosComFaturamento = produtos.map(p => ({
                    ...p,
                    faturamento: p.total_vendido || 0
                })).sort((a, b) => b.faturamento - a.faturamento);

                let acumulado = 0;
                produtosComFaturamento.forEach(p => {
                    acumulado += p.faturamento;
                    const percentualAcumulado = acumulado / faturamentoTotal;

                    if (percentualAcumulado <= 0.80) abc.A++;
                    else if (percentualAcumulado <= 0.95) abc.B++;
                    else abc.C++;
                });
            }
            setClassificacaoABC(abc);
        }

        // ==================== USAR GIRO DO BACKEND ====================
        if (stats.giro_estoque) {
            setStatusGiro(stats.giro_estoque);
        } else if (produtos && produtos.length > 0) {
            // Fallback: calcular localmente
            const hoje = new Date();
            const giro = { rapido: 0, normal: 0, lento: 0 };

            produtos.forEach(p => {
                if (!p.ultima_venda) {
                    giro.lento++;
                } else {
                    const dataUltimaVenda = new Date(p.ultima_venda);
                    const diasDesdeVenda = Math.floor((hoje.getTime() - dataUltimaVenda.getTime()) / (1000 * 60 * 60 * 24));

                    if (diasDesdeVenda <= 7) {
                        giro.rapido++;
                    } else if (diasDesdeVenda <= 30) {
                        giro.normal++;
                    } else {
                        giro.lento++;
                    }
                }
            });
            setStatusGiro(giro);
        }

        // ==================== USAR VALIDADE DO BACKEND ====================
        if (stats.validade) {
            setValidadeState(stats.validade);
        } else if (produtos && produtos.length > 0) {
            // Fallback: calcular localmente
            const val = { vencidos: 0, vence_15: 0, vence_30: 0, vence_90: 0 };
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            produtos.forEach(p => {
                if (p.data_validade) {
                    const dataVal = new Date(p.data_validade);
                    dataVal.setHours(0, 0, 0, 0);

                    const diffTime = dataVal.getTime() - hoje.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays < 0) {
                        val.vencidos++;
                    } else if (diffDays <= 15) {
                        val.vence_15++;
                        val.vence_30++;
                        val.vence_90++;
                    } else if (diffDays <= 30) {
                        val.vence_30++;
                        val.vence_90++;
                    } else if (diffDays <= 90) {
                        val.vence_90++;
                    }
                }
            });
            setValidadeState(val);
        }

        // ==================== TOP 5 PRODUTOS POR MARGEM ====================
        if (stats.top_produtos_margem && stats.top_produtos_margem.length > 0) {
            setTopProdutos(stats.top_produtos_margem);
        } else if (produtos && produtos.length > 0) {
            // Fallback: calcular localmente
            const top = [...produtos]
                .filter(p => p.margem_lucro !== undefined && p.margem_lucro !== null)
                .sort((a, b) => (b.margem_lucro || 0) - (a.margem_lucro || 0))
                .slice(0, 5);
            setTopProdutos(top);
        } else {
            setTopProdutos([]);
        }

        // ==================== PRODUTOS CRÍTICOS (ESGOTADOS + BAIXO ESTOQUE) ====================
        if (stats.produtos_criticos && stats.produtos_criticos.length > 0) {
            setProdutosCriticos(stats.produtos_criticos);
        } else if (produtos && produtos.length > 0) {
            // Fallback: calcular localmente
            const criticos = produtos
                .filter(p => {
                    // Esgotado
                    if (p.quantidade === 0) return true;
                    if (p.estoque_status === 'esgotado') return true;

                    // Baixo estoque
                    if (p.estoque_status === 'baixo') return true;
                    if (p.quantidade <= (p.quantidade_minima || 0)) return true;

                    return false;
                })
                .sort((a, b) => {
                    // Ordenar: esgotados primeiro, depois por quantidade
                    if (a.quantidade === 0 && b.quantidade > 0) return -1;
                    if (a.quantidade > 0 && b.quantidade === 0) return 1;
                    return (a.quantidade || 0) - (b.quantidade || 0);
                })
                .slice(0, 10);

            setProdutosCriticos(criticos);
        } else {
            setProdutosCriticos([]);
        }
    }, [produtos, stats]);

    // Dados finais para exibição (prioriza backend, depois fallback local)
    const validade = stats.validade || validadeState;
    const abc = stats.classificacao_abc || classificacaoABC;
    const giro = stats.giro_estoque || statusGiro;

    const percentualABC = {
        A: stats.total_produtos > 0 ? (abc.A / stats.total_produtos * 100).toFixed(1) : '0',
        B: stats.total_produtos > 0 ? (abc.B / stats.total_produtos * 100).toFixed(1) : '0',
        C: stats.total_produtos > 0 ? (abc.C / stats.total_produtos * 100).toFixed(1) : '0',
    };

    const percentualGiro = {
        rapido: stats.total_produtos > 0 ? (giro.rapido / stats.total_produtos * 100).toFixed(1) : '0',
        normal: stats.total_produtos > 0 ? (giro.normal / stats.total_produtos * 100).toFixed(1) : '0',
        lento: stats.total_produtos > 0 ? (giro.lento / stats.total_produtos * 100).toFixed(1) : '0',
    };


    // Motor contextual: cards vindos do catálogo de métricas resolvido por segmento
    const metricasCards = schema ? schemaHelpers.metricasCard(schema) : METRICAS_FALLBACK;
    // Tailwind JIT exige classes literais — mapa estático por quantidade de cards
    const GRID_XL: Record<number, string> = {
        3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6', 7: 'xl:grid-cols-7',
    };
    const gridXl = GRID_XL[Math.min(Math.max(metricasCards.length, 3), 7)];

    return (
        <div className="space-y-6">
            {/* Cards Principais — dirigidos pelo registro de métricas (view_registry) */}
            <div className={`flex overflow-x-auto pb-6 -mx-4 px-4 sm:mx-0 sm:px-0 gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3 ${gridXl} snap-x snap-mandatory hide-scrollbar`}>
                {metricasCards.map(metrica => {
                    const tema = TEMAS_METRICA[metrica.tema] || TEMAS_METRICA.blue;
                    const Icone = ICONES_METRICA[metrica.icone] || Package;
                    const valor = valorDaFonte(stats, metrica.fonte);
                    const valorFormatado = formatarValor(valor, metrica.formato);
                    const subtitulo = metrica.chave === 'estoque_normal' && stats.total_produtos > 0
                        ? `${((valor / stats.total_produtos) * 100).toFixed(0)}% do total`
                        : metrica.subtitulo || '';
                    return (
                        <div
                            key={metrica.chave}
                            onClick={() => setActiveMetricModal({
                                id: metrica.filtro || metrica.chave, title: metrica.titulo, value: valor,
                                formattedValue: valorFormatado, isCurrency: metrica.formato === 'moeda',
                                icon: Icone, theme: tema.modal,
                            })}
                            className={`w-[200px] min-w-[200px] sm:min-w-0 sm:max-w-none snap-center sm:snap-align-none bg-slate-900 border ${tema.borda} rounded-xl shadow-lg p-4 sm:p-6 text-slate-200 cursor-pointer ${tema.hover} hover:bg-slate-800 transition-all duration-200 group shrink-0`}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <Icone className={`w-8 h-8 ${tema.icone} opacity-80 group-hover:opacity-100 transition-opacity`} />
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 leading-tight">{metrica.titulo}</p>
                            </div>
                            <p className={`${metrica.formato === 'moeda' ? 'text-xl lg:text-xl xl:text-2xl wrap-break-word leading-none' : 'text-2xl md:text-3xl'} font-black ${tema.valor}`}
                                title={valorFormatado}>
                                {valorFormatado}
                            </p>
                            <p className={`text-xs ${tema.subtitulo} mt-2 flex items-center gap-1`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${tema.dot}`}></span> {subtitulo}
                            </p>
                        </div>
                    );
                })}
            </div>

            {/* Análises Avançadas — painéis também vêm do registro de métricas */}
            <div className="flex overflow-x-auto pb-6 -mx-4 px-4 sm:mx-0 sm:px-0 gap-4 sm:grid sm:grid-cols-1 lg:grid-cols-3 sm:p-6 snap-x snap-mandatory hide-scrollbar">
                {/* Classificação ABC */}
                {schemaHelpers.metricaPainelVisivel(schema, 'analise_abc') && (
                <div className="w-[280px] min-w-[280px] sm:min-w-0 sm:max-w-none snap-center sm:snap-align-none bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 sm:p-6 shrink-0">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                            <BarChart3 className="w-6 h-6 text-blue-600 dark:text-blue-300" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                                Classificação ABC
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Análise de Pareto (80/20)
                            </p>
                        </div>
                    </div>

                    <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800">
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                            <strong>Nota:</strong> A classificação ABC ajuda a priorizar esforços.
                            <br />• <strong>Classe A:</strong> Produtos vitais (80% do faturamento). Nunca devem faltar.
                            <br />• <strong>Classe B:</strong> Intermediários (15%). Estoque moderado.
                            <br />• <strong>Classe C:</strong> Menor impacto (5%). Evitar excesso de estoque.
                        </p>
                    </div>

                    <div className="space-y-4">
                        {/* Classe A */}
                        <div onClick={() => onAdvancedAnalyticsClick('abc_a')} className="cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 -mx-2 rounded-lg transition-colors">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                    Classe A - Alta Prioridade
                                </span>
                                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                                    {abc.A} ({percentualABC.A}%)
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-linear-to-r from-green-500 to-green-600 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${percentualABC.A}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                80% do faturamento
                            </p>
                        </div>

                        {/* Classe B */}
                        <div onClick={() => onAdvancedAnalyticsClick('abc_b')} className="cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 -mx-2 rounded-lg transition-colors">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                    Classe B - Média Prioridade
                                </span>
                                <span className="text-sm font-bold text-yellow-600 dark:text-yellow-400">
                                    {abc.B} ({percentualABC.B}%)
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-linear-to-r from-yellow-500 to-yellow-600 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${percentualABC.B}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                15% do faturamento
                            </p>
                        </div>

                        {/* Classe C */}
                        <div onClick={() => onAdvancedAnalyticsClick('abc_c')} className="cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 -mx-2 rounded-lg transition-colors">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                    Classe C - Baixa Prioridade
                                </span>
                                <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                    {abc.C} ({percentualABC.C}%)
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-linear-to-r from-red-500 to-red-600 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${percentualABC.C}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                5% do faturamento
                            </p>
                        </div>
                    </div>
                </div>
                )}

                {/* Status de Giro */}
                {schemaHelpers.metricaPainelVisivel(schema, 'analise_giro') && (
                <div className="w-[280px] min-w-[280px] sm:min-w-0 sm:max-w-none snap-center sm:snap-align-none bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 sm:p-6 shrink-0">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                            <Zap className="w-6 h-6 text-purple-600 dark:text-purple-300" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                                Giro de Estoque
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Velocidade de rotação
                            </p>
                        </div>
                    </div>

                    <div className="mb-4 bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg border border-purple-100 dark:border-purple-800">
                        <p className="text-xs text-purple-800 dark:text-purple-200">
                            <strong>Nota:</strong> Mede a cobertura de dias do estoque atual baseado nas vendas (VMD).
                            <br />• <strong>Rápido:</strong> Cobertura de até 15 dias.
                            <br />• <strong>Normal:</strong> Cobertura entre 16 e 60 dias.
                            <br />• <strong>Lento:</strong> Cobertura maior que 60 dias.
                        </p>
                    </div>

                    <div className="space-y-4">
                        {/* ALERTA CRÍTICO DE COBERTURA (< 10 DIAS) */}
                        <div onClick={() => onAdvancedAnalyticsClick('alerta_cobertura')} className="cursor-pointer group hover:bg-red-50 dark:hover:bg-red-900/20 p-3 -mx-2 rounded-lg transition-all border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
                            <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-red-600 animate-pulse group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-bold text-red-700 dark:text-red-400 group-hover:underline">
                                        Alerta: Cobertura Crítica
                                    </span>
                                </div>
                                <span className="text-xs font-bold px-2 py-1 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 rounded-full">
                                    Ação Necessária
                                </span>
                            </div>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                Produtos com menos de 11 dias de estoque.
                            </p>
                        </div>
                        {/* Giro Rápido */}
                        <div onClick={() => onAdvancedAnalyticsClick('giro_rapido')} className="cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 -mx-2 rounded-lg transition-colors">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-green-600 group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                        Giro Rápido
                                    </span>
                                </div>
                                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                                    {giro.rapido} ({percentualGiro.rapido}%)
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-linear-to-r from-green-500 to-green-600 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${percentualGiro.rapido}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Cobertura de até 15 dias
                            </p>
                        </div>

                        {/* Giro Normal */}
                        <div onClick={() => onAdvancedAnalyticsClick('giro_normal')} className="cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 -mx-2 rounded-lg transition-colors">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-yellow-600 group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                        Giro Normal
                                    </span>
                                </div>
                                <span className="text-sm font-bold text-yellow-600 dark:text-yellow-400">
                                    {giro.normal} ({percentualGiro.normal}%)
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-linear-to-r from-yellow-500 to-yellow-600 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${percentualGiro.normal}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Cobertura entre 16-60 dias
                            </p>
                        </div>

                        {/* Giro Lento */}
                        <div onClick={() => onAdvancedAnalyticsClick('giro_lento')} className="cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 -mx-2 rounded-lg transition-colors">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <TrendingDown className="w-4 h-4 text-red-600 group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                        Giro Lento
                                    </span>
                                </div>
                                <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                    {giro.lento} ({percentualGiro.lento}%)
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-linear-to-r from-red-500 to-red-600 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${percentualGiro.lento}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Cobertura maior que 60 dias
                            </p>
                        </div>
                    </div>
                </div>
                )}

                {/* Monitor de Validade — some para segmentos sem validade (vestuário, construção, moto peças) */}
                {schemaHelpers.metricaPainelVisivel(schema, 'analise_validade') && (
                <div className="w-[280px] min-w-[280px] sm:min-w-0 sm:max-w-none snap-center sm:snap-align-none bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 sm:p-6 shrink-0">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                            <Clock className="w-6 h-6 text-orange-600 dark:text-orange-300" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                                Monitor de Validade
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Prevenção de perdas
                            </p>
                        </div>
                    </div>

                    <div className="mb-4 bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg border border-orange-100 dark:border-orange-800">
                        <p className="text-xs text-orange-800 dark:text-orange-200">
                            <strong>Dica:</strong> Produtos vencendo devem ser colocados em oferta
                            ou movidos para frente nas prateleiras (FEFO).
                        </p>
                    </div>

                    <div className="space-y-4">
                        {/* Já Vencidos */}
                        <div onClick={() => onCardClick('vencido')} className="cursor-pointer group">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-red-600 dark:text-red-400 group-hover:underline">
                                    Já Vencidos
                                </span>
                                <span className="text-sm font-bold text-red-600">
                                    {validade.vencidos}
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-red-600 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${stats.total_produtos > 0 ? (validade.vencidos / stats.total_produtos) * 100 : 10}%` }}
                                />
                            </div>
                        </div>

                        {/* Vence em 15 dias */}
                        <div onClick={() => onCardClick('vence_15')} className="cursor-pointer group">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                    Vence em 15 dias
                                </span>
                                <span className="text-sm font-bold text-orange-600">
                                    {validade.vence_15}
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-orange-500 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${validade.vence_90 > 0 ? (validade.vence_15 / validade.vence_90) * 100 : 0}%` }}
                                />
                            </div>
                        </div>

                        {/* Vence em 30 dias */}
                        <div onClick={() => onCardClick('vence_30')} className="cursor-pointer group">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                    Vence em 30 dias
                                </span>
                                <span className="text-sm font-bold text-yellow-600">
                                    {validade.vence_30}
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-yellow-500 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${validade.vence_90 > 0 ? (validade.vence_30 / validade.vence_90) * 100 : 0}%` }}
                                />
                            </div>
                        </div>

                        {/* Vence em 90 dias */}
                        <div onClick={() => onCardClick('vence_90')} className="cursor-pointer group">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:underline">
                                    Vence em 90 dias
                                </span>
                                <span className="text-sm font-bold text-blue-600">
                                    {validade.vence_90}
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-blue-500 h-3 rounded-full transition-all duration-500"
                                    style={{ width: `${validade.vence_90 > 0 ? 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                )}
            </div>

            {/* Top Produtos e Produtos Críticos */}
            <div className="flex overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 gap-4 sm:grid sm:grid-cols-1 lg:grid-cols-2 sm:p-6 snap-x snap-mandatory hide-scrollbar">
                {/* Top 5 Produtos por Margem */}
                <div className="min-w-[300px] sm:min-w-0 snap-start bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 shrink-0">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                            <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-300" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                                Top 5 - Maior Margem
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Produtos mais rentáveis
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {topProdutos.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                                Nenhum produto disponível
                            </p>
                        ) : (
                            topProdutos.map((produto, index) => (
                                <div
                                    key={produto.id}
                                    onClick={() => onProductClick(produto)}
                                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="shrink-0 w-8 h-8 bg-linear-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                                            {index + 1}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                                {produto.nome}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {formatCurrency(produto.preco_venda)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-lg font-bold text-green-600 dark:text-green-400">
                                            {(produto as any).margem !== undefined && (produto as any).margem !== null 
                                                ? `${Number((produto as any).margem).toFixed(1)}%` 
                                                : '-'}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Produtos Críticos */}
                <div className="min-w-[300px] sm:min-w-0 snap-start bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 shrink-0">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-300" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                                Produtos Críticos
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Requerem atenção imediata
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {produtosCriticos.length === 0 ? (
                            <div className="text-center py-8">
                                {(stats?.produtos_esgotados || 0) > 0 || (stats?.produtos_baixo_estoque || 0) > 0 ? (
                                    <>
                                        <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full mb-3">
                                            <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-300" />
                                        </div>
                                        <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                                            Atenção necessária!
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                            Existem {(stats?.produtos_esgotados || 0) + (stats?.produtos_baixo_estoque || 0)} produtos críticos no estoque global.
                                            <br />(Use os filtros da tabela para listá-los)
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full mb-3">
                                            <Target className="w-8 h-8 text-green-600 dark:text-green-300" />
                                        </div>
                                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                            Tudo sob controle!
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                            Nenhum produto crítico no momento
                                        </p>
                                    </>
                                )}
                            </div>
                        ) : (
                            produtosCriticos.map((produto) => (
                                <div
                                    key={produto.id}
                                    onClick={() => onProductClick(produto)}
                                    className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                                >
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                                {produto.nome}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {produto.categoria}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${produto.estoque_status === 'esgotado'
                                            ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
                                            }`}>
                                            {produto.quantidade} un
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Detalhes da Métrica */}
            {activeMetricModal && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90dvh] overflow-y-auto my-auto border border-gray-200 dark:border-gray-700 animate-in zoom-in-95 duration-200">
                        <div className={`p-4 sm:p-6 ${activeMetricModal.theme.header} text-white flex justify-between items-center`}>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-white/20 rounded-xl backdrop-blur-md">
                                    <activeMetricModal.icon className="w-8 h-8" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black">{activeMetricModal.title}</h2>
                                    <p className="text-white/80 font-medium">Indicador atual do estoque</p>
                                </div>
                            </div>
                            <button onClick={() => setActiveMetricModal(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-8">
                            <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4 sm:p-6">
                                <div className="text-center md:text-left">
                                    <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-1">Valor Atual</p>
                                    <p className={`text-5xl font-black ${activeMetricModal.theme.text}`}>
                                        {activeMetricModal.formattedValue}
                                    </p>
                                </div>
                            </div>

                            <div className="h-[250px] w-full mt-6">
                                {getModalChartData().length > 0 ? (
                                    <>
                                        <p className="text-center text-sm font-bold text-gray-500 uppercase mb-4">
                                            {activeMetricModal.id === 'margem' ? 'Margem Média por Categoria' : 
                                             activeMetricModal.id === 'valor' ? 'Valor por Categoria' : 
                                             'Distribuição por Categoria'}
                                        </p>
                                        <ResponsiveContainer width="100%" height="100%">
                                            {activeMetricModal.id === 'margem' || activeMetricModal.id === 'valor' ? (
                                                <BarChart data={getModalChartData()}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                                                    <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" width={80} 
                                                        tickFormatter={(val) => activeMetricModal.isCurrency ? formatCurrency(val) : `${val}%`} 
                                                    />
                                                    <RechartsTooltip 
                                                        formatter={(value: any) => [activeMetricModal.isCurrency ? formatCurrency(value) : (activeMetricModal.id === 'margem' ? `${Number(value).toFixed(1)}%` : value), activeMetricModal.id === 'margem' ? 'Margem' : 'Valor']}
                                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    />
                                                    <Bar dataKey="value" fill={activeMetricModal.theme.stroke} radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            ) : (
                                                <RechartsPieChart>
                                                    <Pie
                                                        data={getModalChartData()}
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={60}
                                                        outerRadius={80}
                                                        paddingAngle={5}
                                                        dataKey="value"
                                                        label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                                                        labelLine={false}
                                                    >
                                                        {getModalChartData().map((_, index) => (
                                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <RechartsTooltip
                                                        formatter={(value: any, _name: any, item: any) => [`${value} produto(s)`, item?.payload?.name]}
                                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    />
                                                    <RechartsLegend
                                                        verticalAlign="bottom"
                                                        align="center"
                                                        iconType="circle"
                                                        formatter={(value: string, entry: any) => {
                                                            const total = getModalChartData().reduce((acc, d) => acc + d.value, 0) || 1;
                                                            const v = entry?.payload?.value ?? 0;
                                                            const pct = (v / total * 100).toFixed(0);
                                                            return `${value} — ${v} (${pct}%)`;
                                                        }}
                                                        wrapperStyle={{ fontSize: '0.8rem', fontWeight: 600, paddingTop: '12px' }}
                                                    />
                                                </RechartsPieChart>
                                            )}
                                        </ResponsiveContainer>
                                    </>
                                ) : (
                                    <div className="h-full w-full flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                                        <BarChart3 className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                                        <p className="font-bold text-gray-500 dark:text-gray-400">
                                            Sem produtos catalogados no momento para exibir o gráfico.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductAnalyticsDashboard;
