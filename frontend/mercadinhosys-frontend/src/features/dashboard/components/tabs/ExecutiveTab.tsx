import { TrendingUp, AlertTriangle, CheckCircle, Brain, Target, Shield, ArrowRight, PieChart as PieChartIcon, BarChart3, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCurrency, formatDate } from '../../../../utils/formatters';
import { useTheme } from '../../../../theme/useTheme';
import { chartColors } from '../../../../utils/chartColors';
import PorQueMudou, { type PeriodoDashboard } from '../PorQueMudou';

interface ExecutiveTabProps {
  data: any;
  onNavigateToTab?: (tabId: string) => void;
  periodo?: PeriodoDashboard;
}

export default function ExecutiveTab({ data, onNavigateToTab, periodo }: ExecutiveTabProps) {
  const navigate = useNavigate();
  // Card clicável: abre a lista que formou o número, no mesmo período.
  const abrirVendas = () => navigate(periodo ? `/sales?de=${periodo.de}&ate=${periodo.ate}` : '/sales');
  const cardClicavel = 'cursor-pointer transition-shadow hover:ring-2 hover:ring-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const { mode } = useTheme();
  const cc = chartColors(mode === 'dark');

  // Torna a recomendação acionável: leva à listagem certa, já filtrada.
  const executarRecomendacao = (rec: any) => {
    const alvo = rec?.alvo;
    const ctx = `${rec?.mensagem || ''} ${rec?.cta || ''} ${rec?.tipo || ''}`.toLowerCase();
    if (alvo === 'clientes') { navigate('/customers?segmento=Em%20Risco'); return; }
    if (alvo === 'produtos') {
      if (ctx.includes('validade') || ctx.includes('vencer') || ctx.includes('vencid') || ctx.includes('promover'))
        navigate('/products?filtro=validade');
      else if (ctx.includes('ruptura') || ctx.includes('estoque') || ctx.includes('repor') || ctx.includes('mínimo') || ctx.includes('minimo'))
        navigate('/products?filtro=baixo');
      else
        navigate('/products');
      return;
    }
    navigate(alvo === 'clientes' ? '/customers' : '/products');
  };

  const faturamento = data?.financials?.revenue || data?.summary?.revenue?.value || 0;
  const lucroLiquido = data?.financials?.net_profit || data?.lucro_liquido || 0;
  const cogs = data?.financials?.cogs || 0;
  const despesas = data?.financials?.expenses || data?.total_despesas || 0;
  const growth = data?.summary?.growth_period || data?.summary?.growth;
  const growthAvailable = growth && growth.status !== 'no_data' && growth.value !== null && growth.value !== undefined;
  const forecast = data?.forecast?.forecast || [];
  const anomalies = data?.anomalies || data?.alertas_cientificos || [];
  const temAnomalias = anomalies.length > 0;
  const waterfallMax = Math.max(faturamento, cogs, despesas, Math.abs(lucroLiquido), 1);
  const margemLiquida = data?.financials?.net_margin || (faturamento > 0 ? (lucroLiquido / faturamento) * 100 : 0);
  const ticketMedio = data?.summary?.avg_ticket?.value || 0;
  
  const recomendacoes = data?.recomendacoes || [];

  const dreData = [
    { name: 'Lucro Líquido', value: Math.max(0, lucroLiquido), color: '#10b981', desc: 'Valor real que sobrou no caixa após pagar todos os custos e despesas' },
    { name: 'Custo da Mercadoria (CMV)', value: cogs, color: '#f59e0b', desc: 'O que foi pago aos fornecedores APENAS pelos produtos que foram vendidos' },
    { name: 'Despesas Operacionais', value: despesas, color: '#ef4444', desc: 'Custos do negócio (aluguel, salários, energia, impostos)' },
  ].filter(d => d.value > 0);

  const formatRecommendationType = (tipo: string) => {
    if (!tipo) return 'Outras Ações';
    
    const dict: Record<string, string> = {
      'vencimentocritico': 'Risco de Vencimento',
      'retencao': 'Retenção de Clientes',
      'estoque': 'Otimização de Estoque',
      'ruptura': 'Prevenção de Ruptura',
      'vendas': 'Impulso de Vendas',
      'inadimplencia': 'Risco de Inadimplência',
      'churn': 'Risco de Churn (Perda)',
    };
    
    const key = tipo.toLowerCase().replace(/[_ ]/g, '');
    if (dict[key]) return dict[key];
    
    // Fallback: primeira letra maiúscula e troca _ por espaço
    const formatted = tipo.replace(/_/g, ' ').toLowerCase();
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  const aiImpact = recomendacoes.reduce((acc: any, rec: any) => {
    const t = formatRecommendationType(rec.tipo);
    if (!acc[t]) acc[t] = 0;
    acc[t] += (rec.impacto_estimado || 0);
    return acc;
  }, {});

  const radarData = Object.keys(aiImpact).map(k => ({
    tipo: k.length > 22 ? k.substring(0, 22) + '...' : k,
    impacto: aiImpact[k]
  })).sort((a, b) => b.impacto - a.impacto);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* KPIs Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Faturamento */}
        <div role="button" tabIndex={0} title="Abrir as vendas do período" aria-label="Abrir as vendas do período" onClick={abrirVendas} onKeyDown={(e) => { if (e.key === 'Enter') (abrirVendas)(); }} className={`bg-white dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 border border-gray-200 dark:border-slate-700/50 shadow-lg relative overflow-hidden group ${cardClicavel}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150" />
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-gray-500 dark:text-slate-400 font-medium text-sm flex items-center gap-1.5 group/tooltip relative">
              Faturamento
              <Info tabIndex={0} className="w-4 h-4 text-gray-400 dark:text-slate-500 cursor-help focus:outline-none" />
              <div className="invisible group-hover/tooltip:visible group-focus-within/tooltip:visible absolute top-full left-0 mt-2 w-48 p-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-gray-600 dark:text-slate-300 z-10 shadow-xl normal-case tracking-normal">
                Soma total de todas as vendas brutas realizadas no período, antes de abater qualquer custo.
              </div>
            </h3>
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <div className="text-xl lg:text-2xl xl:text-3xl font-black text-gray-900 dark:text-white mb-2 tracking-tighter whitespace-nowrap tabular-nums">
            {formatCurrency(faturamento)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs xl:text-sm">
             {growthAvailable ? (
               <span className={`flex items-center px-2 py-0.5 rounded-full font-medium ${growth.is_positive ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                  {growth.display} vs período anterior
               </span>
             ) : (
               <span className="text-gray-500 dark:text-slate-400">Variação indisponível (sem histórico comparável)</span>
             )}
          </div>
        </div>

        {/* Lucro Líquido */}
        <div role="button" tabIndex={0} title="Abrir o financeiro" aria-label="Abrir o financeiro" onClick={() => onNavigateToTab?.('financial')} onKeyDown={(e) => { if (e.key === 'Enter') (() => onNavigateToTab?.('financial'))(); }} className={`bg-white dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 border border-gray-200 dark:border-slate-700/50 shadow-lg relative overflow-hidden group ${cardClicavel}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150" />
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-gray-500 dark:text-slate-400 font-medium text-sm flex items-center gap-1.5 group/tooltip relative">
              Lucro Líquido
              <Info tabIndex={0} className="w-4 h-4 text-gray-400 dark:text-slate-500 cursor-help focus:outline-none" />
              <div className="invisible group-hover/tooltip:visible group-focus-within/tooltip:visible absolute top-full left-0 mt-2 w-48 p-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-gray-600 dark:text-slate-300 z-10 shadow-xl normal-case tracking-normal">
                O que sobrou limpo no caixa após pagar os fornecedores da mercadoria vendida e as despesas da loja.
              </div>
            </h3>
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <Target className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <div className={`text-xl lg:text-2xl xl:text-3xl font-black mb-2 tracking-tighter whitespace-nowrap tabular-nums ${lucroLiquido < 0 ? 'text-red-400' : 'text-gray-900 dark:text-white'}`}>
            {formatCurrency(lucroLiquido)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs xl:text-sm">
             <span className="text-gray-500 dark:text-slate-400">Margem líquida: </span>
             <span className={`font-bold ${margemLiquida >= 8 ? 'text-emerald-400' : margemLiquida > 0 ? 'text-amber-400' : 'text-red-400'}`}>
               {margemLiquida.toFixed(1).replace('.', ',')}%
             </span>
          </div>
        </div>

        {/* Ticket Médio */}
        <div role="button" tabIndex={0} title="Abrir as vendas do período" aria-label="Abrir as vendas do período" onClick={abrirVendas} onKeyDown={(e) => { if (e.key === 'Enter') (abrirVendas)(); }} className={`bg-white dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 border border-gray-200 dark:border-slate-700/50 shadow-lg relative overflow-hidden group ${cardClicavel}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150" />
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-gray-500 dark:text-slate-400 font-medium text-sm flex items-center gap-1.5 group/tooltip relative">
              Ticket Médio
              <Info tabIndex={0} className="w-4 h-4 text-gray-400 dark:text-slate-500 cursor-help focus:outline-none" />
              <div className="invisible group-hover/tooltip:visible group-focus-within/tooltip:visible absolute top-full left-0 mt-2 w-48 p-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-gray-600 dark:text-slate-300 z-10 shadow-xl normal-case tracking-normal">
                Faturamento dividido pelo número de vendas: quanto, em média, cada venda deixa no caixa.
              </div>
            </h3>
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Shield className="w-5 h-5 text-purple-400" />
            </div>
          </div>
          <div className="text-xl lg:text-2xl xl:text-3xl font-black text-gray-900 dark:text-white mb-2 tracking-tighter whitespace-nowrap tabular-nums">
            {formatCurrency(ticketMedio)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs xl:text-sm text-gray-500 dark:text-slate-400">
             <span className="text-gray-500 dark:text-slate-400">Valor médio por venda</span>
          </div>
        </div>
        
        {/* Caixa e Fiado */}
        <div className="bg-white dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 border border-gray-200 dark:border-slate-700/50 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150" />
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-gray-500 dark:text-slate-400 font-medium text-sm flex items-center gap-1.5 group/tooltip relative">
              A Receber
              <Info tabIndex={0} className="w-4 h-4 text-gray-400 dark:text-slate-500 cursor-help focus:outline-none" />
              <div className="invisible group-hover/tooltip:visible group-focus-within/tooltip:visible absolute top-full right-0 mt-2 w-48 p-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-xs text-gray-600 dark:text-slate-300 z-10 shadow-xl normal-case tracking-normal">
                Soma de todas as vendas a prazo (cartão pendente, carnê) incluindo vendas fiadas. Dinheiro na rua.
              </div>
            </h3>
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
            </div>
          </div>
          <div className="text-xl lg:text-2xl xl:text-3xl font-black text-gray-900 dark:text-white mb-2 tracking-tighter whitespace-nowrap tabular-nums">
            {formatCurrency(data?.receivables?.total_recebivel || 0)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs xl:text-sm mb-3">
             <span className="text-orange-400 flex items-center bg-orange-400/10 px-2 py-0.5 rounded-full font-medium">
                Fiado: {formatCurrency(data?.fiado?.total_aberto || 0)}
             </span>
          </div>
          <p className="text-gray-500 dark:text-slate-400 text-xs xl:text-sm font-semibold mb-3">
            <span className="text-red-400 font-bold">{formatCurrency(data?.receivables?.total_vencido || 0)}</span> atrasados
          </p>
          {onNavigateToTab && (
            <button 
              onClick={() => onNavigateToTab('financial')}
              className="mt-2 text-xs font-bold text-orange-400 hover:text-orange-300 flex items-center gap-1 transition-colors z-20 relative cursor-pointer"
            >
              Acessar Contas a Receber <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

      </div>

      {periodo && <PorQueMudou periodo={periodo} />}

      {/* Gráficos Estratégicos Executivos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico 1: DRE Visual */}
        <div className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
              <PieChartIcon className="w-5 h-5" />
            </div>
            <h3 className="text-gray-600 dark:text-slate-300 font-bold">Composição Financeira (DRE)</h3>
          </div>
          <div className="h-[280px] w-full flex items-center justify-center">
            {lucroLiquido < 0 ? (
              <div className="w-full max-w-md">
                <p className="text-xs font-semibold text-red-400 mb-3">Resultado negativo no período — o negócio consumiu mais do que faturou:</p>
                <div className="space-y-3">
                  {[
                    { label: 'Receita Bruta', value: faturamento, color: '#3b82f6' },
                    { label: 'Custo da Mercadoria (CMV)', value: cogs, color: '#f59e0b' },
                    { label: 'Despesas Operacionais', value: despesas, color: '#ef4444' },
                    { label: 'Prejuízo (Lucro Líquido)', value: Math.abs(lucroLiquido), color: '#ef4444' },
                  ].map((linha) => (
                    <div key={linha.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-600 dark:text-slate-300">{linha.label}</span>
                        <span className="font-bold tabular-nums" style={{ color: linha.color }}>{formatCurrency(linha.value)}</span>
                      </div>
                      <div className="h-3 bg-gray-100 dark:bg-slate-700/50 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(linha.value / waterfallMax) * 100}%`, backgroundColor: linha.color }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">
                  Lucro líquido: <span className="font-bold text-red-400">{formatCurrency(lucroLiquido)}</span>
                </p>
              </div>
            ) : dreData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip 
                    content={({ active, payload }: any) => {
                      if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-4 rounded-xl shadow-2xl max-w-[220px]">
                            <p className="font-bold text-gray-700 dark:text-slate-200 mb-1">{d.name}</p>
                            <p className="text-xl font-black" style={{ color: d.color }}>{formatCurrency(d.value)}</p>
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-2 leading-snug font-medium">{d.desc}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Pie
                    data={dreData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="50%"
                    outerRadius="75%"
                    paddingAngle={5}
                  >
                    {dreData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="rgba(0,0,0,0)" />
                    ))}
                  </Pie>
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    wrapperStyle={{ fontSize: '12px', color: cc.legendText }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-gray-400 dark:text-slate-500 font-medium">Sem dados financeiros suficientes no período.</div>
            )}
          </div>
        </div>

        {/* Gráfico 2: Radar de IA (Impacto) */}
        <div className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h3 className="text-gray-600 dark:text-slate-300 font-bold">Quanto cada alerta vale em R$</h3>
          </div>
          <div className="h-[280px] w-full">
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={radarData} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="tipo" stroke={cc.axis} fontSize={11} tickLine={false} axisLine={false} width={140} />
                  <Tooltip
                    cursor={{ fill: mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)' }}
                    contentStyle={{ backgroundColor: cc.tooltipBg, borderColor: cc.tooltipBorder, borderRadius: '0.75rem', color: cc.tooltipText }}
                    itemStyle={{ fontWeight: 'bold', color: cc.tooltipItemText }}
                    labelStyle={{ color: cc.tooltipLabelText, fontWeight: 'bold', marginBottom: '4px' }}
                    formatter={(value: number) => [formatCurrency(value), 'Impacto Potencial']}
                  />
                  <Bar dataKey="impacto" radius={[0, 4, 4, 0]} maxBarSize={24}>
                    {radarData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill="#3b82f6" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 dark:text-slate-500 font-medium">Nenhuma oportunidade com impacto mapeada.</div>
            )}
          </div>
        </div>
      </div>

      {/* AI Feed / Briefing Executivo */}
      <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <div className="p-2.5 bg-blue-500/20 rounded-xl">
               <Brain className="w-6 h-6 text-blue-400" />
             </div>
             <div>
               <h2 className="text-lg font-bold text-gray-900 dark:text-white">O que fazer hoje</h2>
               <p className="text-sm text-gray-500 dark:text-slate-400">O que você precisa saber hoje sobre seu negócio</p>
             </div>
           </div>
        </div>
        <div className="p-6 space-y-4">
           {recomendacoes && recomendacoes.length > 0 ? (
             recomendacoes.map((rec: any, idx: number) => (
               <div key={idx} className={`p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-colors ${
                 rec.prioridade === 1 ? 'bg-red-500/10 border-red-500/20 hover:bg-red-500/20' :
                 rec.prioridade === 2 ? 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20' :
                 'bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20'
               }`}>
                 <div className="flex items-start gap-4">
                   <div className="text-2xl mt-1">{rec.icone || '💡'}</div>
                   <div>
                     <h4 className={`font-bold text-lg mb-1 ${
                       rec.prioridade === 1 ? 'text-red-400' :
                       rec.prioridade === 2 ? 'text-amber-400' :
                       'text-blue-400'
                     }`}>
                       {formatRecommendationType(rec.tipo)}
                     </h4>
                     <p className="text-gray-600 dark:text-slate-300 leading-relaxed text-sm">{rec.mensagem}</p>
                     {rec.impacto_estimado > 0 && (
                       <p className="mt-2 text-sm font-semibold text-emerald-400">
                         Impacto Estimado: {formatCurrency(rec.impacto_estimado)}
                       </p>
                     )}
                   </div>
                 </div>
                 {rec.cta && (
                   <button
                     onClick={() => executarRecomendacao(rec)}
                     className="whitespace-nowrap px-5 py-2.5 bg-white hover:bg-gray-100 text-gray-900 border border-gray-200 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white dark:border-transparent font-medium rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                   >
                     {rec.cta} <ArrowRight size={16} />
                   </button>
                 )}
               </div>
             ))
           ) : (
             <div className="text-center py-12">
               <CheckCircle className="w-16 h-16 text-emerald-500/50 mx-auto mb-4" />
               <h3 className="text-xl font-bold text-gray-600 dark:text-slate-300">Tudo sob controle</h3>
               <p className="text-gray-400 dark:text-slate-500 mt-2">Nenhum risco crítico ou anomalia detectada hoje.</p>
             </div>
           )}
        </div>
      </div>

      {/* Seção Científica: Anomalias e Previsões */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Anomalias e Alertas */}
        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
             <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
               {temAnomalias && <AlertTriangle className="text-amber-400" />} Anomalias Detectadas
             </h2>
          </div>
          <div className="p-4 space-y-3 h-64 overflow-y-auto">
             {temAnomalias ? (
               anomalies.map((alerta: any, i: number) => (
                 <div key={i} className="p-4 bg-gray-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700/50 hover:border-amber-500/30 transition-colors">
                   <div className="flex items-center gap-2 mb-2">
                     <div className={`w-2 h-2 rounded-full ${alerta.severidade === 'alta' ? 'bg-red-500' : 'bg-amber-500'}`}></div>
                     <h4 className="font-bold text-gray-700 dark:text-slate-200">{alerta.titulo || alerta.tipo || 'Anomalia Detectada'}</h4>
                   </div>
                   <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">{alerta.descricao}</p>
                   {alerta.acao_recomendada && (
                     <p className="text-xs text-amber-400 font-bold flex items-center gap-1 cursor-pointer">
                       Ação recomendada: {alerta.acao_recomendada} <ArrowRight size={12} />
                     </p>
                   )}
                 </div>
               ))
             ) : (
               <p className="text-gray-400 dark:text-slate-500 text-center pt-10">Nenhuma anomalia estatística detectada no comportamento de vendas ou clientes.</p>
             )}
          </div>
        </div>

        {/* Previsão de Vendas: cada dia com faixa de incerteza e nome do feriado. */}
        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
             <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
               <Target className="text-blue-400" /> Previsão de Vendas
             </h2>
          </div>
          <div className="p-4 space-y-3 h-64 overflow-y-auto">
             {forecast.length > 0 ? (
               forecast.map((prev: any, i: number) => (
                 <div key={i} className="p-4 bg-gray-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700/50 hover:border-blue-500/30 transition-colors">
                   <div className="flex justify-between items-start gap-2 mb-1">
                     <h4 className="font-bold text-gray-700 dark:text-slate-200">
                       {prev.dia_semana || 'Previsão'}
                       {prev.data && <span className="font-normal text-gray-400 dark:text-slate-500"> · {formatDate(prev.data)}</span>}
                     </h4>
                     {prev.feriado && (
                       <span className="text-xs bg-amber-500/20 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full font-bold whitespace-nowrap">
                         {prev.feriado_nome || 'Feriado'}
                       </span>
                     )}
                   </div>
                   <p className="font-bold text-blue-400 text-lg tabular-nums">{formatCurrency(prev.valor_previsto)}</p>
                   <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                     Faixa esperada: {formatCurrency(prev.lower_bound)} – {formatCurrency(prev.upper_bound)}
                   </p>
                 </div>
               ))
             ) : (
               <p className="text-gray-400 dark:text-slate-500 text-center pt-10">
                 {data?.forecast?.reason || data?.analytics_availability?.forecast?.reason || 'Dados insuficientes para gerar previsões confiáveis neste período.'}
               </p>
             )}
          </div>
        </div>
      </div>

    </div>
  );
}
