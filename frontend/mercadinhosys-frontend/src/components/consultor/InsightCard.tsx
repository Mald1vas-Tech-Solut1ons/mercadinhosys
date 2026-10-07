import React, { useState, useEffect } from 'react';
import { Sparkles, RefreshCw, AlertCircle, CheckCircle, TrendingUp, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { consultorService } from '../../services/consultorService';
import toast from 'react-hot-toast';
import { authService } from '../../features/auth/authService';
import { isPlanoGratis } from '../../utils/permissions';

interface InsightCardProps {
  especialista: 'financeiro' | 'vendas' | 'estoque' | 'rh' | 'compras' | 'fornecedores' | 'geral';
  titulo?: string;
  className?: string;
}

const gradientMap = {
  financeiro: 'from-green-500 to-emerald-700',
  vendas: 'from-blue-500 to-indigo-700',
  estoque: 'from-orange-500 to-amber-700',
  rh: 'from-purple-500 to-fuchsia-700',
  compras: 'from-teal-500 to-cyan-700',
  fornecedores: 'from-blue-500 to-cyan-700',
  geral: 'from-indigo-500 to-purple-700'
};

const iconMap = {
  financeiro: TrendingUp,
  vendas: TrendingUp,
  estoque: AlertCircle,
  rh: Sparkles,
  compras: CheckCircle,
  fornecedores: CheckCircle,
  geral: Sparkles
};

export const InsightCard: React.FC<InsightCardProps> = ({ especialista, titulo = 'Insights IA', className = '' }) => {
  const planoGratis = isPlanoGratis(authService.getCurrentUser());
  const [insights, setInsights] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (planoGratis) {
    return null;
  }

  const fetchInsights = async (isManual = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await consultorService.obterInsights(especialista);
      if (response.success && response.insights) {
        setInsights(response.insights);
        if (response.aviso) {
           if (isManual) toast.error(response.aviso);
        } else {
           if (isManual) toast.success('Insights atualizados com sucesso!');
        }
      } else if (response.error) {
        if (response.error.includes('Limite')) {
           setError('Limite diário de atualizações atingido.');
           if (isManual) toast.error('Limite diário atingido.');
        } else {
           setError(response.error);
        }
      } else if (response.aviso) {
         setError(response.aviso);
      }
    } catch (err) {
      setError('Falha ao carregar insights.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [especialista]);

  const parseInsights = (text: string) => {
    // Expected format: bullet points like "1. O que está bom...", "2. Ponto de atenção...", "3. Ação recomendada..."
    // or markdown asterisks. We split by lines and try to extract 3 points.
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const good = lines[0] || 'Tudo dentro do esperado.';
    const attention = lines[1] || 'Nenhum risco iminente detectado.';
    const action = lines[2] || 'Mantenha o bom trabalho.';

    const cleanText = (str: string) => str.replace(/^[1-3*]\.?\s*/, '').replace(/\*\*/g, '');

    return [
      { id: 1, type: 'good', text: cleanText(good), icon: <CheckCircle className="w-5 h-5 text-emerald-500" /> },
      { id: 2, type: 'attention', text: cleanText(attention), icon: <AlertCircle className="w-5 h-5 text-amber-500" /> },
      { id: 3, type: 'action', text: cleanText(action), icon: <TrendingUp className="w-5 h-5 text-blue-500" /> }
    ];
  };

  const Icon = iconMap[especialista] || Sparkles;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-100 dark:border-gray-700 ${className}`}
    >
      {/* Top Banner with gradient */}
      <div className={`h-2 w-full bg-linear-to-r ${gradientMap[especialista]}`}></div>
      
      <div className="p-5">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg bg-gray-50 dark:bg-gray-700 text-${especialista === 'financeiro' ? 'green' : 'blue'}-500`}>
              <Icon className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              {titulo}
              <span className="px-2 py-0.5 rounded-full bg-linear-to-r from-indigo-500 to-purple-500 text-white text-xs font-medium flex items-center gap-1 shadow-sm">
                <Sparkles className="w-3 h-3" /> IA
              </span>
            </h3>
          </div>
          <button 
            onClick={() => fetchInsights(true)} 
            disabled={loading}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 text-gray-500 dark:text-gray-400"
            title="Atualizar Insight"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-500' : ''}`} />
          </button>
        </div>

        <div className="min-h-[120px]">
          {loading && !insights ? (
            <div className="flex flex-col gap-3 animate-pulse mt-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
            </div>
          ) : error && !insights ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800">
              <HelpCircle className="w-8 h-8 text-amber-500 mb-2" />
              <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">{error}</p>
            </div>
          ) : insights ? (
            <div className="flex flex-col gap-4 mt-2">
              <AnimatePresence>
                {parseInsights(insights).map((item, i) => (
                  <motion.div 
                    key={item.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-start gap-3 bg-gray-50/50 dark:bg-gray-700/30 p-3 rounded-xl border border-transparent hover:border-gray-100 dark:hover:border-gray-600 transition-colors group"
                  >
                    <div className="mt-0.5 group-hover:scale-110 transition-transform">
                      {item.icon}
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                      {item.text}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
};
