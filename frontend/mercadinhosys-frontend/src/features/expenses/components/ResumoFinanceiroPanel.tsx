// src/features/expenses/components/ResumoFinanceiroPanel.tsx
import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  Bell,
  ChevronRight,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
} from 'lucide-react';
import { expensesService, ResumoFinanceiro, AlertaFinanceiro } from '../expensesService';

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface ResumoFinanceiroPanelProps {
  className?: string;
}

const ResumoFinanceiroPanel: React.FC<ResumoFinanceiroPanelProps> = ({ className = '' }) => {
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState(true);

  const carregarResumo = async () => {
    setLoading(true);
    setErro(null);
    try {
      const data = await expensesService.resumoFinanceiro();
      setResumo(data);
    } catch (err: any) {
      console.error('Erro ao carregar resumo financeiro:', err);
      setErro('Erro ao carregar dados financeiros');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarResumo();
  }, []);

  const getSeverityColor = (severidade: string) => {
    switch (severidade) {
      case 'critica': return {
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
        text: 'text-red-700 dark:text-red-300',
        icon: 'text-red-600 dark:text-red-400',
        accent: 'bg-red-500'
      };
      case 'alta': return {
        bg: 'bg-orange-500/10',
        border: 'border-orange-500/20',
        text: 'text-orange-700 dark:text-orange-300',
        icon: 'text-orange-600 dark:text-orange-400',
        accent: 'bg-orange-500'
      };
      case 'media': return {
        bg: 'bg-yellow-500/10',
        border: 'border-yellow-500/20',
        text: 'text-yellow-700 dark:text-yellow-300',
        icon: 'text-yellow-600 dark:text-yellow-400',
        accent: 'bg-yellow-500'
      };
      default: return {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
        text: 'text-blue-700 dark:text-blue-300',
        icon: 'text-blue-600 dark:text-blue-400',
        accent: 'bg-blue-500'
      };
    }
  };

  const getAlertIcon = (tipo: string) => {
    switch (tipo) {
      case 'boleto_vencido': return XCircle;
      case 'boleto_vencendo': return Bell;
      case 'cliente_inadimplente': return AlertTriangle;
      case 'fluxo_caixa_negativo': return TrendingDown;
      case 'despesas_fixas_altas': return AlertTriangle;
      default: return Bell;
    }
  };

  if (loading) {
    return (
      <div className={`backdrop-blur-xl bg-white/40 dark:bg-slate-900/40 border border-white/20 dark:border-slate-800/40 rounded-3xl p-8 ${className}`}>
        <div className="flex flex-col items-center justify-center py-10">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
            <RefreshCw className="w-6 h-6 text-blue-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <span className="mt-4 text-slate-500 dark:text-slate-400 font-medium animate-pulse">Sincronizando Inteligência Financeira...</span>
        </div>
      </div>
    );
  }

  if (erro || !resumo) {
    return (
      <div className={`backdrop-blur-xl bg-white/40 dark:bg-slate-900/40 border border-white/20 dark:border-slate-800/40 rounded-3xl p-8 ${className}`}>
        <div className="text-center py-10 px-4">
          <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-amber-500" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Ponto de Atenção</h3>
          <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-xs mx-auto text-sm">
            {erro || 'Não foi possível consolidar os dados financeiros neste momento.'}
          </p>
          <button
            onClick={carregarResumo}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-sm transition-all shadow-lg shadow-blue-500/25 active:scale-95"
          >
            Tentar Restaurar
          </button>
        </div>
      </div>
    );
  }

  const fluxo = resumo.fluxo_caixa_real;
  const fluxoPositivo = fluxo.saldo >= 0;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Premium Glass Card */}
      <div className="backdrop-blur-2xl bg-white/70 dark:bg-slate-900/70 border border-white/40 dark:border-slate-800/50 rounded-[2.5rem] shadow-2xl relative overflow-hidden transition-all duration-500">
        {/* Subtle background glow */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />

        <div
          className="p-8 flex flex-col md:flex-row md:items-center justify-between cursor-pointer group"
          onClick={() => setExpandido(!expandido)}
        >
          <div className="flex items-center gap-6">
            <div className="relative">
              <div className="absolute inset-0 bg-linear-to-tr from-blue-600 to-emerald-500 blur-xl opacity-30 group-hover:opacity-50 transition-opacity" />
              <div className="relative p-5 bg-linear-to-br from-slate-900 to-slate-800 dark:from-white dark:to-slate-200 rounded-2xl shadow-xl transform group-hover:scale-105 transition-transform">
                <Wallet className="w-8 h-8 text-white dark:text-slate-900" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">
                  Painel Financeiro
                </h2>
                <div className="flex gap-1">
                  <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter">V2.0</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter">PRO</span>
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400 max-w-sm">
                Inteligência de fluxo, contas a pagar e saúde financeira consolidada
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-6 md:mt-0">
            {resumo.total_alertas > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-2xl text-xs font-black uppercase tracking-wider animate-pulse">
                <AlertTriangle className="w-4 h-4" />
                {resumo.total_alertas} Alerta{resumo.total_alertas > 1 ? 's' : ''}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); carregarResumo(); }}
              className="p-3 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-all rounded-xl hover:bg-blue-500/5 active:scale-90"
              title="Sincronizar"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <div className={`p-2 rounded-xl bg-slate-100 dark:bg-slate-800 transition-all ${expandido ? 'rotate-90' : ''}`}>
              <ChevronRight className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </div>
          </div>
        </div>

        {expandido && (
          <div className="px-8 pb-8 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">

              {/* Card 1: A Pagar */}
              <div className="relative p-6 rounded-4xl bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 overflow-hidden group">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-rose-500/10 text-rose-500 rounded-xl">
                    <ArrowDownRight className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Contas a Pagar</span>
                </div>
                <div className="text-3xl font-black text-slate-900 dark:text-white mb-2 leading-none">
                  {formatCurrency(resumo.contas_pagar.total_aberto)}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-400 font-medium">Pago no mês</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">{formatCurrency(resumo.contas_pagar.pago_no_mes)}</span>
                  </div>
                  <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 w-[60%] rounded-full shadow-[0_0_10px_rgba(244,63,94,0.5)]" />
                  </div>
                  {resumo.contas_pagar.qtd_vencidos > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700/50 flex items-center gap-2 text-[10px] font-black uppercase text-rose-600 dark:text-rose-400 bg-rose-500/5 p-2 rounded-lg">
                      <ShieldCheck className="w-3 h-3 text-rose-500" />
                      {resumo.contas_pagar.qtd_vencidos} Títulos Vencidos
                    </div>
                  )}
                </div>
              </div>

              {/* Card 2: Despesas Mês */}
              <div className="relative p-6 rounded-4xl bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 overflow-hidden group">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-indigo-500/10 text-indigo-500 rounded-xl">
                    <BadgeDollarSign className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Gasto Operacional</span>
                </div>
                <div className="text-3xl font-black text-slate-900 dark:text-white mb-2 leading-none">
                  {formatCurrency(resumo.despesas_mes.total)}
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-white/50 dark:bg-slate-900/50 p-3 rounded-2xl border border-white dark:border-slate-700/30">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">Fixas</p>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(resumo.despesas_mes.recorrentes)}</p>
                  </div>
                  <div className="bg-white/50 dark:bg-slate-900/50 p-3 rounded-2xl border border-white dark:border-slate-700/30">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">Variáveis</p>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(resumo.despesas_mes.variaveis)}</p>
                  </div>
                </div>
              </div>

              {/* Card 3: Fluxo de Caixa */}
              <div className="relative p-6 rounded-4xl bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 blur-[60px] rounded-full" />
                <div className="flex items-center justify-between mb-6">
                  <div className="p-2 bg-emerald-500 text-white dark:text-white rounded-xl">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest">Cashflow Realizado</span>
                </div>
                <div className={`text-4xl font-black mb-2 leading-none tracking-tighter ${fluxoPositivo ? 'text-emerald-400 dark:text-emerald-600' : 'text-rose-400 dark:text-rose-600'}`}>
                  {fluxoPositivo ? '+' : ''}{formatCurrency(fluxo.saldo)}
                </div>
                <div className="flex items-center gap-4 mt-6">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600" />
                    <span className="text-[10px] font-black text-emerald-400 dark:text-emerald-600 uppercase tracking-tighter">Entradas</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 rounded-full border border-rose-500/20">
                    <ArrowDownRight className="w-3.5 h-3.5 text-rose-400 dark:text-rose-600" />
                    <span className="text-[10px] font-black text-rose-400 dark:text-rose-600 uppercase tracking-tighter">Saídas</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Business Insights KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
              {/* Insight: Comprometimento */}
              <div className="group relative p-8 rounded-[2.5rem] bg-linear-to-br from-slate-900 to-slate-800 text-white overflow-hidden shadow-2xl">
                <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-500/20 blur-[80px] rounded-full" />
                <div className="absolute bottom-0 right-0 p-8 opacity-5">
                  <BarChart3 className="w-32 h-32" />
                </div>

                <div className="flex items-center justify-between mb-8 relative">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-blue-400 mb-1">Índice de Comprometimento</h3>
                    <p className="text-slate-400 text-[10px]">Percentual da venda futura já comprometido</p>
                  </div>
                  <div className="text-4xl font-black text-white italic">
                    {resumo.indicadores_gestao.indice_comprometimento.toFixed(1)}<span className="text-xl text-blue-400">%</span>
                  </div>
                </div>

                <div className="relative h-3 bg-white/10 rounded-full mb-8 overflow-hidden backdrop-blur-sm border border-white/5">
                  <div
                    className={`h-full transition-all duration-1000 shadow-[0_0_15px_rgba(59,130,246,0.5)] ${resumo.indicadores_gestao.indice_comprometimento > 80 ? 'bg-rose-500' : 'bg-linear-to-r from-blue-600 to-cyan-400'}`}
                    style={{ width: `${Math.min(100, resumo.indicadores_gestao.indice_comprometimento)}%` }}
                  />
                </div>

                <div className="bg-white/5 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
                  <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    Para cada R$&nbsp;100,00 que você vende, <strong className="text-blue-400">{resumo.indicadores_gestao.indice_comprometimento.toFixed(1).replace(".", ",")}</strong> estão comprometidos com boletos e despesas.
                  </p>
                </div>
              </div>

              {/* Insight: Pressão de Caixa */}
              <div className="group relative p-8 rounded-[2.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-orange-500/10 blur-[80px] rounded-full" />

                <div className="flex items-center justify-between mb-8 relative">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-orange-600 mb-1">Pressão de Caixa (7 dias)</h3>
                    <p className="text-slate-500 text-[10px]">Obrigações dos próximos 7 dias vs entrada esperada</p>
                  </div>
                  <div className={`text-4xl font-black italic ${resumo.indicadores_gestao.pressao_caixa_diaria > 100 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {resumo.indicadores_gestao.pressao_caixa_diaria.toFixed(0)}<span className="text-xl">%</span>
                  </div>
                </div>

                <div className="flex items-end gap-3 mb-8">
                  <div className="text-5xl font-black text-slate-900 tracking-tighter">
                    {formatCurrency(resumo.indicadores_gestao.obrigacoes_7d ?? resumo.indicadores_gestao.vence_hoje_valor)}
                  </div>
                  <div className="pb-1">
                    <span className="text-[10px] font-black uppercase text-slate-600 tracking-widest leading-none block">Vence em</span>
                    <span className="text-[10px] font-black uppercase text-slate-900 tracking-widest leading-none block">7 dias</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className={`p-2 rounded-full ${resumo.indicadores_gestao.pressao_caixa_diaria > 100 ? 'bg-rose-500/10 text-rose-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                    {resumo.indicadores_gestao.pressao_caixa_diaria > 100 ? <AlertTriangle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  </div>
                  <p className="text-xs text-slate-600 leading-tight font-medium">
                    {resumo.indicadores_gestao.pressao_caixa_diaria > 100
                      ? "Risco: a venda esperada dos próximos 7 dias não cobre os compromissos do período."
                      : `Saudável: a entrada esperada de ${formatCurrency(resumo.indicadores_gestao.entrada_esperada_7d ?? 0)} absorve os compromissos.`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modern Alertas Feed */}
      {expandido && resumo.alertas.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {resumo.alertas.map((alerta: AlertaFinanceiro, idx: number) => {
            const style = getSeverityColor(alerta.severidade);
            const Icon = getAlertIcon(alerta.tipo);
            return (
              <div
                key={idx}
                className={`backdrop-blur-md ${style.bg} ${style.border} border rounded-4xl p-6 flex flex-col gap-4 shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-default relative overflow-hidden`}
              >
                <div className={`absolute top-0 right-0 w-2 h-full ${style.accent}`} />
                <div className="flex items-center justify-between">
                  <div className={`p-3 rounded-2xl ${style.bg}`}>
                    <Icon className={`w-5 h-5 ${style.icon}`} />
                  </div>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${style.accent} text-white`}>
                    {alerta.severidade}
                  </span>
                </div>
                <div>
                  <h4 className={`font-black text-sm mb-1 uppercase tracking-tight ${style.text}`}>
                    {alerta.titulo}
                  </h4>
                  <p className={`text-xs ${style.text} opacity-70 leading-relaxed font-medium mb-3`}>
                    {alerta.descricao}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 group">
                    Recommendation: {alerta.acao}
                    <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ResumoFinanceiroPanel;
