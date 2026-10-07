import { Activity } from 'lucide-react';
import { formatCurrency } from '../../../../utils/formatters';

interface FinancialTabProps {
  data: any;
}

export default function FinancialTab({ data }: FinancialTabProps) {
  const faturamento = data?.financials?.revenue || data?.summary?.revenue?.value || 0;
  const cogs = data?.financials?.cogs || 0;
  const lucroBruto = data?.financials?.gross_profit || data?.summary?.gross_profit?.value || (faturamento - cogs);
  const despesas = data?.financials?.expenses || data?.total_despesas || 0;
  const lucroLiquido = data?.financials?.net_profit || data?.lucro_liquido || 0;
  const margemLiquida = data?.financials?.net_margin || 0;
  
  // Receivables Data
  const receivables = data?.receivables || {};
  const totalRecebivel = receivables.total_recebivel || 0;
  
  return (
    <div className="space-y-8">
      {/* Resumo Financeiro */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <p className="text-gray-500 dark:text-slate-400 font-bold mb-2">Entradas (Faturamento)</p>
          <p className="text-2xl font-black text-blue-400">{formatCurrency(faturamento)}</p>
        </div>
        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <p className="text-gray-500 dark:text-slate-400 font-bold mb-2">CMV (Custo Mercadoria)</p>
          <p className="text-2xl font-black text-amber-400">{formatCurrency(cogs)}</p>
        </div>
        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <p className="text-gray-500 dark:text-slate-400 font-bold mb-2">Despesas Operacionais</p>
          <p className="text-2xl font-black text-red-400">{formatCurrency(despesas)}</p>
        </div>
        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <p className="text-gray-500 dark:text-slate-400 font-bold mb-2">Lucro Líquido</p>
          <p className="text-2xl font-black text-emerald-400">{formatCurrency(lucroLiquido)}</p>
        </div>
      </div>

      {/* DRE Simplificado */}
      <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
           <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
             <Activity className="text-blue-400" /> DRE Gerencial Simplificado
           </h2>
        </div>
        <div className="p-6">
           <div className="space-y-4">
             
             {/* Faturamento */}
             <div className="flex justify-between items-center pb-4 border-b border-gray-200 dark:border-slate-700/50">
               <span className="font-bold text-gray-600 dark:text-slate-300">(=) Receita Bruta</span>
               <span className="font-bold text-gray-900 dark:text-white">{formatCurrency(faturamento)}</span>
             </div>
             
             {/* Deduções */}
             <div className="flex justify-between items-center pb-4 border-b border-gray-200 dark:border-slate-700/50">
               <span className="text-gray-500 dark:text-slate-400">(-) Custo das Mercadorias Vendidas (CMV)</span>
               <span className="text-red-400">{formatCurrency(cogs)}</span>
             </div>
             
             {/* Lucro Bruto */}
             <div className="flex justify-between items-center pb-4 border-b border-gray-200 dark:border-slate-700/50">
               <span className="font-bold text-blue-300">(=) Lucro Bruto</span>
               <span className="font-bold text-blue-400">{formatCurrency(lucroBruto)}</span>
             </div>
             
             {/* Despesas */}
             <div className="flex justify-between items-center pb-4 border-b border-gray-200 dark:border-slate-700/50">
               <span className="text-gray-500 dark:text-slate-400">(-) Despesas Operacionais e Folha</span>
               <span className="text-red-400">{formatCurrency(despesas)}</span>
             </div>
             
             {/* Lucro Líquido */}
             <div className="flex justify-between items-center pt-2">
               <span className="font-black text-emerald-400 text-xl">(=) Lucro Líquido</span>
               <div className="text-right">
                 <span className="font-black text-emerald-400 text-xl">{formatCurrency(lucroLiquido)}</span>
                 <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Margem Líquida: {margemLiquida.toFixed(1)}%</p>
               </div>
             </div>
             
           </div>
        </div>
      </div>
      {/* =======================================================================
          MÓDULO ESPECIALISTA: GESTÃO AVANÇADA DE FIADO / CREDIÁRIO
      ======================================================================= */}
      <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden mt-8">
        <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
           <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
             <Activity className="text-orange-400" /> Saúde Financeira do Crediário (Fiado)
           </h2>
           <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Análise inteligente de clientes, scores de crédito e recomendações de limites.</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
             <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700/50">
               <p className="text-sm font-semibold text-gray-500 dark:text-slate-400 mb-1">Exposição (Total Aberto)</p>
               <p className="text-2xl font-black text-gray-900 dark:text-white">{formatCurrency(data?.fiado?.total_aberto ?? totalRecebivel)}</p>
             </div>
             <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700/50">
               <p className="text-sm font-semibold text-gray-500 dark:text-slate-400 mb-1">Limite Total Cedido</p>
               <p className="text-2xl font-black text-gray-900 dark:text-white">{formatCurrency(data?.fiado?.total_limite || 0)}</p>
             </div>
             <div className="bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/20">
               <p className="text-sm font-semibold text-emerald-400 mb-1">Pagamentos (30d)</p>
               <p className="text-2xl font-black text-emerald-500">{formatCurrency(data?.fiado?.tendencias?.pagamentos_fiado_30d || 0)}</p>
               <p className="text-xs text-emerald-400/80 mt-1">Taxa Recuperação: {data?.fiado?.tendencias?.taxa_recuperacao_percentual || 0}%</p>
             </div>
             <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20">
               <p className="text-sm font-semibold text-amber-400 mb-1">Novos Fiados (30d)</p>
               <p className="text-2xl font-black text-amber-500">{formatCurrency(data?.fiado?.tendencias?.novos_fiados_30d || 0)}</p>
               <p className="text-xs text-amber-400/80 mt-1">Ticket Médio Fiado: {formatCurrency(data?.fiado?.ticket_medio_fiado || 0)}</p>
             </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Tabela de Devedores */}
            <div>
              <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-4 border-b border-red-500/20 pb-2">Top 5 Piores Devedores (Ação Necessária)</h3>
              <div className="space-y-3">
                {data?.fiado?.top_devedores?.length > 0 ? data.fiado.top_devedores.map((cliente: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center p-4 rounded-lg bg-red-950/20 hover:bg-red-950/40 transition-colors border border-red-900/30">
                    <div className="flex-1">
                      <p className="font-bold text-gray-700 dark:text-slate-200">{cliente.nome}</p>
                      <p className="text-xs text-red-400 font-medium">Uso de Limite: {(cliente.percentual_limite ?? 0).toFixed(0)}%</p>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-black text-red-400 text-lg">{formatCurrency(cliente.saldo_devedor)}</p>
                        <p className="text-[10px] font-bold text-red-300 bg-red-500/20 px-2 py-0.5 rounded-full inline-block mt-1">{cliente.recomendacao}</p>
                      </div>
                      <button 
                        onClick={() => window.open(`https://wa.me/55${cliente.celular.replace(/\D/g, '')}?text=Olá ${cliente.nome}, verificamos uma pendência...`, '_blank')}
                        className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-md text-xs font-bold hover:bg-red-500/40 transition-colors"
                      >
                        Cobrar
                      </button>
                    </div>
                  </div>
                )) : <p className="text-gray-400 dark:text-slate-500 text-sm">Nenhum devedor crítico encontrado.</p>}
              </div>
            </div>

            {/* Tabela de Bons Pagadores */}
            <div>
              <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-4 border-b border-emerald-500/20 pb-2">Top 5 Bons Pagadores (Perfil Saudável)</h3>
              <div className="space-y-3">
                {data?.fiado?.bons_pagadores?.length > 0 ? data.fiado.bons_pagadores.map((cliente: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center p-4 rounded-lg bg-emerald-950/20 hover:bg-emerald-950/40 transition-colors border border-emerald-900/30">
                    <div className="flex-1">
                      <p className="font-bold text-gray-700 dark:text-slate-200">{cliente.nome}</p>
                      <p className="text-xs text-emerald-400 font-medium">Volume total já quitado no fiado</p>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-black text-emerald-400 text-lg">{formatCurrency(cliente.volume_credito)}</p>
                      </div>
                    </div>
                  </div>
                )) : <p className="text-gray-400 dark:text-slate-500 text-sm">Nenhum bom pagador recente.</p>}
              </div>
            </div>
          </div>

          {/* Produtos mais vendidos no fiado */}
          <div className="mt-8">
            <h3 className="text-sm font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wider mb-4 border-b border-gray-200 dark:border-slate-700 pb-2">Top Produtos Vendidos no Fiado</h3>
            <div className="flex flex-wrap gap-3">
              {data?.fiado?.top_produtos?.length > 0 ? data.fiado.top_produtos.map((p: any, idx: number) => (
                <div key={idx} className="bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700/50 px-4 py-2 rounded-xl flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs">{idx + 1}º</div>
                  <div>
                    <p className="text-sm font-bold text-gray-700 dark:text-slate-200">{p.nome}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{formatCurrency(p.valor)} ({p.quantidade} un)</p>
                  </div>
                </div>
              )) : <p className="text-gray-400 dark:text-slate-500 text-sm">Nenhum dado de produto no fiado.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Inteligência de Crédito e Finanças */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="text-purple-400" /> Concentração de Vendas (Risco)
            </h2>
          </div>
          <div className="p-6">
            {data?.gini_index !== undefined ? (
              faturamento < 50 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center">
                  <div className="text-3xl font-black text-gray-400 dark:text-slate-500 mb-2">Volume Insuficiente</div>
                  <p className="text-sm text-gray-500 dark:text-slate-400 max-w-sm">
                    As vendas do período estão muito baixas (abaixo de R$ 50,00) para calcular uma concentração de horários válida. Não há dados suficientes para uma análise estatística.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700/50">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-slate-400 font-bold mb-1">Índice Técnico (Gini)</p>
                      <div className="text-3xl font-black text-purple-400">
                        {data.gini_index.toFixed(3)}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-600 dark:text-slate-300 mb-1">Status de Risco</p>
                      <div className="text-lg font-bold">
                        {data.gini_index > 0.7 ? (
                          <span className="text-rose-400 bg-rose-400/10 px-3 py-1 rounded-full">Alto (Muito Concentrado)</span>
                        ) : data.gini_index > 0.4 ? (
                          <span className="text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full">Médio (Atenção)</span>
                        ) : (
                          <span className="text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full">Baixo (Bem Distribuído)</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {data?.hourly_concentration?.top_hours?.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Top 3 Horários de Maior Receita (Cálculo Base)</h3>
                      <div className="space-y-2">
                        {data.hourly_concentration.top_hours.slice(0, 3).map((h: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center text-sm bg-white dark:bg-slate-800/40 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700/30">
                            <span className="font-bold text-gray-700 dark:text-slate-200">Às {h.hora}</span>
                            <div className="text-right">
                              <span className="text-emerald-400 font-bold mr-3">{formatCurrency(h.faturamento)}</span>
                              <span className="text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700/50 px-2 py-0.5 rounded text-xs">{h.percentual}% do total</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="h-48 flex items-center justify-center">
                <p className="text-gray-500 dark:text-slate-400 text-sm text-center">
                  Métrica de concentração não disponível para o período selecionado.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="text-cyan-400" /> Correlações Financeiras
            </h2>
          </div>
          <div className="p-6 h-48 overflow-y-auto hide-scrollbar space-y-4">
            {(data?.correlations || data?.insights_cientificos?.correlações) && (data?.correlations || data?.insights_cientificos?.correlações).length > 0 ? (
              (data?.correlations || data?.insights_cientificos?.correlações).map((corr: any, i: number) => (
                <div key={i} className="p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg border border-gray-200 dark:border-slate-700/50">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-bold text-gray-700 dark:text-slate-200">{corr.variavel1} ↔ {corr.variavel2}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${corr.correlacao > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {corr.correlacao > 0 ? '+' : ''}{(corr.correlacao * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{corr.insight || corr.descricao}</p>
                  {typeof corr.n === 'number' && typeof corr.significancia === 'number' && (
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">n = {corr.n} · p = {corr.significancia.toFixed(3)}</p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-slate-400 text-sm text-center pt-8">
                {(data?.analytics_availability?.correlations?.reasons || []).join(' ') || 'Sem correlações calculáveis com as observações do período.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
