import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Clock, Percent, Calendar, ShieldCheck, AlertTriangle } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';

interface SupplierIntelligenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  fornecedorId: number;
  fornecedorNome: string;
}

interface IntelligenceData {
  score_geral: number;
  atraso_medio_dias: number;
  percentual_entregas_no_prazo: number;
  desconto_medio_percentual: number;
  prazo_pagamento_medio_dias: number;
  classificacao: string;
}

interface TimelineItem {
  id: number;
  numero: string;
  data: string;
  total: number;
  atraso_dias: number;
  no_prazo: boolean;
}

export const SupplierIntelligenceModal: React.FC<SupplierIntelligenceModalProps> = ({
  isOpen,
  onClose,
  fornecedorId,
  fornecedorNome
}) => {
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && fornecedorId) {
      loadIntelligence();
    }
  }, [isOpen, fornecedorId]);

  const loadIntelligence = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/fornecedores/${fornecedorId}/inteligencia`);
      if (response.data.success) {
        setData(response.data.inteligencia);
        setTimeline(response.data.timeline);
      }
    } catch (error) {
      console.error('Erro ao carregar inteligência:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Helpers for visual feedback
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 60) return 'text-blue-500';
    if (score >= 40) return 'text-amber-500';
    return 'text-rose-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-blue-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm sm:p-4">
      <div className="bg-gray-50 dark:bg-gray-900 w-full h-full sm:h-auto sm:max-h-[90dvh] sm:max-w-md sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Premium */}
        <div className="relative bg-linear-to-br from-indigo-600 via-blue-700 to-indigo-900 px-6 py-8 text-white shrink-0">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay"></div>
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors backdrop-blur-md"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          
          <div className="flex items-center gap-2 text-indigo-200 mb-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-bold tracking-wider uppercase">Supplier Intelligence</span>
          </div>
          <h2 className="text-2xl font-black leading-tight text-white mb-1 shadow-sm">
            {fornecedorNome}
          </h2>
          <p className="text-sm text-indigo-200">Análise de Performance e Confiabilidade</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
              <p className="text-gray-500 dark:text-gray-400 animate-pulse font-medium">Processando métricas...</p>
            </div>
          ) : data ? (
            <>
              {/* Score Circular */}
              <div className="flex flex-col items-center justify-center p-6 bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-50 dark:bg-indigo-900/20 rounded-full blur-2xl"></div>
                <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-blue-50 dark:bg-blue-900/20 rounded-full blur-2xl"></div>
                
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wider relative z-10">Score de Confiança</h3>
                
                {/* SVG Gauge */}
                <div className="relative w-40 h-40 flex items-center justify-center z-10">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-100 dark:text-gray-700" />
                    <circle 
                      cx="50" cy="50" r="45" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="8" 
                      strokeDasharray={`${(data.score_geral / 100) * 283} 283`}
                      className={`${getScoreColor(data.score_geral)} transition-all duration-1000 ease-out`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-black ${getScoreColor(data.score_geral)}`}>{data.score_geral}</span>
                    <span className="text-xs font-bold text-gray-400 uppercase">/ 100</span>
                  </div>
                </div>

                <div className="mt-4 px-4 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center gap-2 z-10">
                  <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${getScoreBg(data.score_geral)}`}></span>
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Classe {data.classificacao}</span>
                </div>
              </div>

              {/* Grid de Métricas */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
                    <Clock className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Pontualidade</span>
                  </div>
                  <span className="text-2xl font-black text-gray-900 dark:text-white">
                    {data.percentual_entregas_no_prazo}%
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">Entregas no prazo</span>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Atraso Médio</span>
                  </div>
                  <span className="text-2xl font-black text-gray-900 dark:text-white">
                    {data.atraso_medio_dias} <span className="text-sm font-semibold text-gray-400">dias</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">Histórico geral</span>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
                    <Percent className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Descontos</span>
                  </div>
                  <span className="text-2xl font-black text-gray-900 dark:text-white">
                    {data.desconto_medio_percentual}%
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">Média por pedido</span>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-1">
                    <Calendar className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Prazo Pgto.</span>
                  </div>
                  <span className="text-2xl font-black text-gray-900 dark:text-white">
                    {data.prazo_pagamento_medio_dias} <span className="text-sm font-semibold text-gray-400">dias</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">Média de respiro</span>
                </div>
              </div>

              {/* Timeline de Pedidos Recentes */}
              <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                  <h3 className="font-bold text-gray-800 dark:text-gray-200">Histórico de Entregas</h3>
                  <TrendingUp className="w-4 h-4 text-gray-400" />
                </div>
                
                <div className="p-5">
                  {timeline.length > 0 ? (
                    <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-linear-to-b before:from-transparent before:via-gray-200 dark:before:via-gray-700 before:to-transparent">
                      {timeline.map((item) => (
                        <div key={item.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                          <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-white dark:border-gray-800 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 ${item.no_prazo ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                            {item.no_prazo ? <ShieldCheck className="w-4 h-4 text-white" /> : <AlertTriangle className="w-4 h-4 text-white" />}
                          </div>
                          
                          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-gray-500 dark:text-gray-400">#{item.numero}</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.no_prazo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                                {item.no_prazo ? 'No Prazo' : `${item.atraso_dias} dias atrasado`}
                              </span>
                            </div>
                            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                              Recebido em {new Date(item.data).toLocaleDateString('pt-BR')}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Valor: R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-500 text-sm">Nenhum histórico de recebimento encontrado para montar a linha do tempo.</div>
                  )}
                </div>
              </div>

            </>
          ) : (
            <div className="text-center py-12 text-gray-500">Erro ao carregar dados de inteligência.</div>
          )}
        </div>
      </div>
    </div>
  );
};
