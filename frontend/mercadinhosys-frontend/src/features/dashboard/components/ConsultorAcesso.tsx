import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Sparkles, X } from 'lucide-react';
import { InsightCard } from '../../../components/consultor/InsightCard';

/**
 * Acesso ao Consultor da Loja no painel.
 *
 * Uma faixa baixa com as duas coisas que o dono quer da IA: ler a análise do período
 * (abre num painel lateral com espaço de leitura, tela cheia no celular) ou conversar
 * com os dados (leva ao chat). A análise só é pedida ao abrir o painel, então a cota
 * diária de insights não é gasta à toa.
 */
const ConsultorAcesso: React.FC = () => {
  const [aberto, setAberto] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('keydown', fechar);
    return () => document.removeEventListener('keydown', fechar);
  }, [aberto]);

  return (
    <>
      <div className="tour-ia-consultor mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-white px-4 py-3 dark:border-indigo-500/30 dark:bg-slate-800/60">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-700 text-white">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 dark:text-white">Consultor da Loja</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">Análise do período com IA e conversa com os dados da sua loja.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700 sm:flex-none"
          >
            <Sparkles className="h-4 w-4" /> Ver análise do dia
          </button>
          <button
            type="button"
            onClick={() => navigate('/consultor')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 px-3.5 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10 sm:flex-none"
          >
            <MessageSquare className="h-4 w-4" /> Conversar
          </button>
        </div>
      </div>

      {aberto && createPortal(
        <div className="fixed inset-0 z-[200] flex justify-end bg-black/40" onClick={() => setAberto(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Análise do Consultor da Loja"
            onClick={e => e.stopPropagation()}
            className="flex h-full w-full flex-col bg-gray-50 shadow-2xl dark:bg-slate-900 sm:max-w-xl lg:max-w-2xl"
          >
            <header
              className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
              style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-700 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <h2 className="min-w-0 flex-1 truncate text-base font-black text-gray-900 dark:text-white">Análise do Consultor</h2>
              <button
                type="button"
                onClick={() => navigate('/consultor')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              >
                <MessageSquare className="h-4 w-4" /> Conversar
              </button>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <InsightCard especialista="geral" titulo="Consultor da Loja" variante="painel" />
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
};

export default ConsultorAcesso;
