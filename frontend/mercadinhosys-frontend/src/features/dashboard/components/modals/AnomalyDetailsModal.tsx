import React from 'react';
import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import ResponsiveModal from '../../../../components/ui/ResponsiveModal';

interface AnomalyData {
  tipo?: string;
  categoria?: string;
  severidade: string;
  descricao?: string;
  mensagem?: string;
  desvio?: number;
  confianca?: number;
  impacto_estimado?: number;
  acao_recomendada?: string;
  passos_investigacao?: string[];
}

interface AnomalyDetailsModalProps {
  anomaly: AnomalyData | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AnomalyDetailsModal: React.FC<AnomalyDetailsModalProps> = ({
  anomaly,
  isOpen,
  onClose
}) => {
  if (!anomaly) return null;

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'alta': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800';
      case 'média': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800';
      case 'baixa': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const getSeverityHeaderColor = (severity: string): 'red' | 'indigo' | 'purple' | 'green' | 'blue' => {
    switch (severity?.toLowerCase()) {
      case 'alta': return 'red';
      case 'média': return 'purple';
      case 'baixa': return 'blue';
      default: return 'indigo';
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(val);

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Detector de Anomalias Científico"
      subtitle={anomaly.tipo || 'Análise de Desvio Estatístico'}
      headerIcon={<AlertTriangle className="w-6 h-6 text-white" />}
      headerColor={getSeverityHeaderColor(anomaly.severidade)}
      footer={
        <div className="flex gap-3 w-full">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Ignorar
          </Button>
          <Button onClick={() => {
            console.log('Anomalia investigada:', anomaly);
            onClose();
          }} className="flex-1">
            Iniciar Investigação
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-1">Status da Detecção</h3>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100 leading-none">
              {anomaly.categoria || 'Monitoramento de Performance'}
            </p>
          </div>
          <Badge className={`${getSeverityColor(anomaly.severidade)} px-3 py-1 font-black uppercase tracking-tighter`}>
            <AlertTriangle className="w-3 h-3 mr-1.5" />
            Risco {anomaly.severidade || 'Média'}
          </Badge>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl">
          <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
            <span className="w-1.5 h-4 bg-indigo-500 rounded-full"></span>
            Descrição da Ocorrência
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed font-medium">
            {anomaly.descricao || anomaly.mensagem ||
              'O motor de IA detectou um comportamento que desvia do padrão histórico operacional.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/50">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-rose-600" />
              <span className="text-xs font-black text-rose-900/60 dark:text-rose-400 uppercase tracking-widest">Desvio</span>
            </div>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {anomaly.desvio ? `${Math.abs(anomaly.desvio).toFixed(1)}%` : 'N/A'}
            </p>
            <p className="text-[10px] font-bold text-rose-500/80 dark:text-rose-500 uppercase mt-1">
              Fora do Desvio Padrão
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-black text-blue-900/60 dark:text-blue-400 uppercase tracking-widest">Confiança</span>
            </div>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400">
              {anomaly.confianca ? `${anomaly.confianca}%` : '85%'}
            </p>
            <p className="text-[10px] font-bold text-blue-500/80 dark:text-blue-500 uppercase mt-1">
              Precisão Algorítmica
            </p>
          </div>
        </div>

        {anomaly.impacto_estimado && (
          <div className="p-5 rounded-2xl bg-linear-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 shadow-sm">
            <h4 className="text-xs font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-2">Impacto Financeiro Estimado</h4>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-black text-amber-600 dark:text-amber-400 tabular-nums">
                {formatCurrency(Math.abs(anomaly.impacto_estimado))}
              </p>
              <span className="text-xs font-bold text-amber-600/70 dark:text-amber-500 italic">
                {anomaly.impacto_estimado > 0 ? '(Oportunidade)' : '(Risco de Perda)'}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h4 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span className="w-1.5 h-4 bg-green-500 rounded-full"></span>
            Plano de Mitigação Inteligente
          </h4>
          <div className="space-y-2">
            <div className="flex items-start gap-4 p-4 bg-green-50/50 dark:bg-green-900/10 border border-green-100 dark:border-green-800/50 rounded-xl">
              <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-lg mt-1">
                <AlertTriangle className="w-4 h-4 text-green-700 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-green-900 dark:text-green-100">
                  Ação Prioritária
                </p>
                <p className="text-sm text-green-800 dark:text-green-300 font-medium mt-1">
                  {anomaly.acao_recomendada || 'Realizar auditoria profunda na categoria afetada.'}
                </p>
              </div>
            </div>

            {anomaly.passos_investigacao && anomaly.passos_investigacao.map((passo: string, index: number) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                <span className="text-indigo-500 font-black text-xs mt-0.5">{index + 1}.</span>
                <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                  {passo}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-700">
          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Ciclo de Resolução Estimado</h4>
          <div className="flex justify-between items-center px-2">
            <div className="text-center group">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-black text-xs mb-2 mx-auto ring-4 ring-white dark:ring-gray-800">1</div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">Investigar</p>
              <p className="text-[10px] text-gray-400 italic">48h</p>
            </div>
            <div className="h-[2px] flex-1 bg-gray-100 dark:bg-gray-800 mb-6"></div>
            <div className="text-center group">
              <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black text-xs mb-2 mx-auto ring-4 ring-white dark:ring-gray-800">2</div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">Executar</p>
              <p className="text-[10px] text-gray-400 italic">72h</p>
            </div>
            <div className="h-[2px] flex-1 bg-gray-100 dark:bg-gray-800 mb-6"></div>
            <div className="text-center group">
              <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 font-black text-xs mb-2 mx-auto ring-4 ring-white dark:ring-gray-800">3</div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">Validar</p>
              <p className="text-[10px] text-gray-400 italic">24h</p>
            </div>
          </div>
        </div>
      </div>
    </ResponsiveModal>
  );
};
