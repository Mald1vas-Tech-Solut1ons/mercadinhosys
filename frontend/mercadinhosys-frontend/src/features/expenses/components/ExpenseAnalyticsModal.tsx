import React from 'react';
import { BrainCircuit, TrendingDown, Activity, AlertTriangle, ShieldCheck, Zap, X } from 'lucide-react';
import { ResumoFinanceiro } from '../expensesService';
import { formatCurrency } from '../../../utils/formatters';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface ExpenseAnalyticsModalProps {
    isOpen: boolean;
    onClose: () => void;
    resumo: ResumoFinanceiro | null;
}

const ExpenseAnalyticsModal: React.FC<ExpenseAnalyticsModalProps> = ({ isOpen, onClose, resumo }) => {
    if (!isOpen) return null;

    if (!resumo) {
        return (
            <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-md">
                <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 p-8 rounded-3xl flex flex-col items-center">
                    <BrainCircuit className="w-12 h-12 text-indigo-500 animate-pulse mb-4" />
                    <p className="text-gray-900 dark:text-white font-bold">Iniciando Redes Neurais Financeiras...</p>
                </div>
            </div>
        );
    }

    const ind = resumo.indicadores_gestao;
    const desp = resumo.despesas_mes;
    const cp = resumo.contas_pagar;

    // Simulação preditiva básica baseada nos dados do resumo (Projeção 3 Meses)
    const atualMesReceita = resumo.dre_consolidado.receita_bruta;
    const atualMesDespesa = desp.total;

    // Projeção Estatística (Crescimento linear simples ou estático considerando o breakeven e margem)
    const meses = ['Mês Atual', 'Mês +1 (Proj)', 'Mês +2 (Proj)', 'Mês +3 (Proj)'];

    // Supondo cenário Estável
    const projReceita = [atualMesReceita, atualMesReceita * 1.02, atualMesReceita * 1.04, atualMesReceita * 1.06];
    const projDespesa = [atualMesDespesa, desp.recorrentes + (desp.variaveis * 1.01), desp.recorrentes + (desp.variaveis * 1.02), desp.recorrentes + (desp.variaveis * 1.03)];
    const projLucro = projReceita.map((r, i) => r - projDespesa[i] - resumo.dre_consolidado.custo_mercadoria); // Simplificação de custo fixo mercadoria

    const chartData = {
        labels: meses,
        datasets: [
            {
                label: 'Projeção de Caixa/Lucro Líquido',
                data: projLucro,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointBackgroundColor: '#10b981',
            },
            {
                label: 'Trajetória de Despesas',
                data: projDespesa,
                borderColor: '#f43f5e',
                backgroundColor: 'transparent',
                borderDash: [5, 5],
                tension: 0.4,
                borderWidth: 2,
                pointBackgroundColor: '#f43f5e',
            }
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: { color: 'rgba(255,255,255,0.7)', font: { family: 'Inter', weight: 600 as any } }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#fff',
                bodyColor: '#cbd5e1',
                borderColor: 'rgba(51, 65, 85, 0.5)',
                borderWidth: 1,
                padding: 12,
                callbacks: {
                    label: (ctx: any) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                }
            }
        },
        scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
            x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } }
        }
    };

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 md:p-6 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <div className="w-full max-w-6xl bg-linear-to-br from-slate-900 to-indigo-950 border border-indigo-500/30 rounded-[2.5rem] shadow-2xl relative overflow-hidden flex flex-col my-auto max-h-[95dvh]">

                {/* Efeitos Decorativos Glass */}
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/20 blur-[100px] rounded-full pointer-events-none" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-rose-500/10 blur-[100px] rounded-full pointer-events-none" />
                <div className="absolute top-[40%] right-[-5%] w-[20%] h-[20%] bg-emerald-500/10 blur-[80px] rounded-full pointer-events-none" />

                {/* Header Cientista */}
                <div className="px-8 py-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-gray-50 dark:bg-slate-900/50 backdrop-blur-md z-10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-500/20 rounded-2xl border border-indigo-500/30 relative">
                            <BrainCircuit className="w-8 h-8 text-indigo-400" />
                            <div className="absolute top-0 right-0 w-3 h-3 bg-indigo-400 rounded-full animate-ping" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
                                AI Assistant <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30 uppercase tracking-widest">Consultor Financeiro</span>
                            </h2>
                            <p className="text-sm font-medium text-indigo-200/60">Análise preditiva de risco, simulação de estresse e diagnóstico estrutural.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:text-white transition-all border border-white/5">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Conteúdo do Consultor */}
                <div className="p-8 overflow-y-auto space-y-8 z-10 custom-scrollbar">

                    {/* Sumário do Diagnóstico (A Voz da IA) */}
                    <div className="bg-indigo-900/40 border border-indigo-500/30 rounded-3xl p-6 flex gap-6 items-start">
                        <div className="hidden md:flex p-4 bg-indigo-500/20 rounded-2xl border border-indigo-400/30">
                            <Zap className="w-8 h-8 text-indigo-400" />
                        </div>
                        <div className="flex-1 space-y-3">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white uppercase tracking-wider text-sm text-indigo-300">Diagnóstico Síntese da Mente Artificial</h3>
                            <p className="text-indigo-100/90 leading-relaxed font-medium">
                                Baseado na correlação dos seus dados de passivo ({formatCurrency(cp.total_aberto)} devedor) com sua geração de caixa bruta ({formatCurrency(atualMesReceita)}),
                                observei que seu <strong>Índice de Comprometimento é de {ind.indice_comprometimento.toFixed(1)}%</strong>.
                                {ind.indice_comprometimento > 50
                                    ? " Isto indica que a operação trabalha asfixiada para pagar fornecedores; o modelo sugere renegociação imediata de prazos médios de pagamento (PMP) para blindar seu fluxo de caixa contra inadimplências sazonais."
                                    : " Sua dinâmica entre recebimentos e pagamentos (PMR vs PMP) encontra-se num platô saudável, provendo liquidez passiva ótima para reinvestimentos."}
                            </p>
                            <p className="text-indigo-100/90 leading-relaxed font-medium">
                                Operacionalmente, a rigidez do negócio (despesas fixas sobre variáveis) está em {(ind.alavancagem_operacional ?? 0).toFixed(1)}%. O Ponto de Equilíbrio exato calibrado pela IA exige que a loja fature <strong className="text-gray-900 dark:text-white bg-indigo-500/30 px-2 py-0.5 rounded">{formatCurrency(ind.ponto_equilibrio ?? 0)}</strong> neste mês para não ativar destruição de capital de giro.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Simulação: Redução de Custo Fixo */}
                        <div className="col-span-1 bg-white/5 border border-white/10 rounded-3xl p-6 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 blur-2xl rounded-full transition-all group-hover:bg-rose-500/20" />
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-slate-400 mb-6 flex items-center gap-2">
                                <TrendingDown className="w-4 h-4 text-rose-400" /> Simulação de Estresse
                            </h4>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-slate-400 font-medium mb-1">Se as Vendas caírem 20% (Cenário Pessimista)</p>
                                    <div className="text-2xl font-black text-rose-400">
                                        {formatCurrency(atualMesReceita * 0.8 - (desp.recorrentes + desp.variaveis * 0.8) - resumo.dre_consolidado.custo_mercadoria * 0.8)}
                                    </div>
                                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">Lucro Líquido Projetado (Destruição de valor iminente se negativo)</p>
                                </div>
                                <div className="h-px w-full bg-white/10" />
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-slate-400 font-medium mb-1">Impacto de R$ {formatCurrency(desp.recorrentes * 0.1)} a menos (Corte 10% Fixo)</p>
                                    <div className="text-2xl font-black text-emerald-400">
                                        + {formatCurrency(desp.recorrentes * 0.1)}
                                    </div>
                                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">Direto no fundo do caixa mensalmente. A IA recomenda focar na redução de energia elétrica e renegociação de aluguel.</p>
                                </div>
                            </div>
                        </div>

                        {/* Gráfico Preditivo */}
                        <div className="col-span-1 lg:col-span-2 bg-white/5 border border-white/10 rounded-3xl p-6">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-slate-400 mb-6 flex items-center gap-2">
                                <Activity className="w-4 h-4 text-emerald-400" /> Predição Algorítmica de Caixa (Trismestre)
                            </h4>
                            <div className="h-64 w-full">
                                <Line data={chartData} options={chartOptions} />
                            </div>
                        </div>
                    </div>

                    {/* Resumo de Dívidas Científico */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-linear-to-r from-rose-950/40 to-slate-900/40 border border-rose-500/20 rounded-3xl p-6">
                            <h4 className="text-sm font-bold text-rose-400 mb-4 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5" /> Passivo Circulante Vencido (Imediato)
                            </h4>
                            <div className="text-4xl font-black text-gray-900 dark:text-white mb-2">{formatCurrency(cp.total_vencido)}</div>
                            <p className="text-xs text-rose-200/70 font-medium">Equivalente a {cp.qtd_vencidos} obrigações legais em default. Estas faturas estão gerando encargos compostos que sabotam a rentabilidade bruta da vitrine.</p>
                        </div>
                        <div className="bg-linear-to-r from-emerald-950/40 to-slate-900/40 border border-emerald-500/20 rounded-3xl p-6">
                            <h4 className="text-sm font-bold text-emerald-400 mb-4 flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5" /> Resiliência Hoje
                            </h4>
                            <div className="text-4xl font-black text-gray-900 dark:text-white mb-2">{ind.pressao_caixa_diaria.toFixed(1)}%</div>
                            <p className="text-xs text-emerald-200/70 font-medium">A pressão diária de faturamento necessária. Você precisa focar em pelo menos {formatCurrency(ind.vence_hoje_valor)} nas vendas de H O J E para arcar com os vencimentos presentes sem descapitalizar o caixa principal.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExpenseAnalyticsModal;
