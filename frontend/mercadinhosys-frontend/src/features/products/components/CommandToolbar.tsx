import React from 'react';
import {
  Download,
  Plus,
  ShoppingCart,
  Calculator,
  Upload,
  Search,
  SlidersHorizontal,
  RefreshCw,
  ChevronDown,
  Barcode,
  QrCode,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../auth/authService';
import { canAccessRoute } from '../../../utils/permissions';

interface CommandToolbarProps {
  onNew: () => void;
  onRefresh: () => void;
  onPurchaseOrders: () => void;
  onMarkup: () => void;
  onImport: () => void;
  onExport: () => void;
  onLabels: () => void;
  search: string;
  onSearchChange: (val: string) => void;
  onToggleFilters: () => void;
  showFilters: boolean;
}

/** Ação secundária: mesmo tamanho e estilo para todas; a cor fica só no ícone. */
const Acao = ({ icon, label, onClick, title, cor, className = '' }: {
  icon: React.ReactNode; label: string; onClick: () => void; title?: string; cor: string; className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title || label}
    className={`shrink-0 inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-gray-200 dark:border-slate-700
      bg-white dark:bg-slate-800 text-sm font-semibold text-gray-700 dark:text-slate-200 whitespace-nowrap
      hover:bg-gray-50 hover:border-gray-300 dark:hover:bg-slate-700 transition-colors ${className}`}
  >
    <span className={cor}>{icon}</span>
    {label}
  </button>
);

const CommandToolbar: React.FC<CommandToolbarProps> = ({
  onNew,
  onRefresh,
  onPurchaseOrders,
  onMarkup,
  onImport,
  onExport,
  onLabels,
  search,
  onSearchChange,
  onToggleFilters,
  showFilters
}) => {
  const navigate = useNavigate();
  const podeDarEntrada = canAccessRoute('/entrada-nfe', authService.getCurrentUser());

  return (
    // min-w-0: a linha de ações rola por dentro; sem isso ela alargava a barra inteira e o
    // "Novo Produto" saía da tela no celular.
    <div className="w-full min-w-0 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-sm">
      {/* Linha 1: busca + filtros + ação principal (nunca quebra o texto do botão). */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 p-3 sm:p-4">
        <div className="relative flex-1 min-w-0 basis-full sm:basis-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="block w-full h-11 pl-10 pr-10 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800
              text-sm text-gray-800 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-all"
            placeholder="Buscar por nome, código de barras ou marca"
          />
          {search && (
            <button type="button" onClick={() => onSearchChange('')} aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleFilters}
          aria-pressed={showFilters}
          className={`shrink-0 inline-flex items-center gap-2 h-11 px-3.5 rounded-xl border text-sm font-semibold whitespace-nowrap transition-colors ${
            showFilters
              ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filtros
          <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onRefresh}
          aria-label="Atualizar lista"
          title="Atualizar lista"
          className="shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onNew}
          className="ml-auto shrink-0 inline-flex items-center gap-2 h-11 px-4 sm:px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold whitespace-nowrap shadow-sm transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="sm:hidden">Novo</span>
          <span className="hidden sm:inline">Novo Produto</span>
        </button>
      </div>

      {/* Linha 2: ações secundárias. No celular rola na horizontal em vez de estourar a tela. */}
      <div className="min-w-0 border-t border-gray-100 dark:border-slate-800 px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1">
          {podeDarEntrada && (
            <Acao icon={<QrCode className="w-4 h-4" />} label="Ler nota" cor="text-amber-500"
              title="Dar entrada no estoque pela nota fiscal (QR Code do cupom ou XML)"
              onClick={() => navigate('/entrada-nfe?ler=1')} />
          )}
          <Acao icon={<ShoppingCart className="w-4 h-4" />} label="Compras" cor="text-indigo-500"
            title="Pedidos de compra aos fornecedores" onClick={onPurchaseOrders} />
          <Acao icon={<Calculator className="w-4 h-4" />} label="Markup" cor="text-purple-500"
            title="Calcular preço de venda pela margem" onClick={onMarkup} />
          <Acao icon={<Barcode className="w-4 h-4" />} label="Etiquetas" cor="text-emerald-500"
            title="Imprimir etiquetas com código de barras" onClick={onLabels} className="tour-produtos-etiquetas" />
          <span className="shrink-0 w-px h-6 bg-gray-200 dark:bg-slate-700 mx-1" aria-hidden />
          <Acao icon={<Upload className="w-4 h-4" />} label="Importar" cor="text-gray-500 dark:text-slate-400"
            title="Importar produtos de planilha" onClick={onImport} />
          <Acao icon={<Download className="w-4 h-4" />} label="Exportar" cor="text-gray-500 dark:text-slate-400"
            title="Exportar a lista em CSV" onClick={onExport} />
        </div>
      </div>
    </div>
  );
};

export default CommandToolbar;
