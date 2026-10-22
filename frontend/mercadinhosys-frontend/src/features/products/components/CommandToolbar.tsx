import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  Plus,
  ShoppingCart,
  Calculator,
  Upload,
  MoreVertical,
  Search,
  Filter,
  RefreshCw,
  ChevronDown,
  Barcode,
  QrCode
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
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const podeDarEntrada = canAccessRoute('/entrada-nfe', authService.getCurrentUser());

  // Close more menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMoreMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 dark:bg-slate-900/80 backdrop-blur-md border border-gray-200 dark:border-slate-800 p-4 rounded-2xl shadow-xl">
      
      {/* Left Area: Title & Search */}
      <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto flex-1">
        <div className="relative w-full md:w-80 group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-500 dark:text-slate-400 group-focus-within:text-blue-500 transition-colors" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl leading-5 bg-white dark:bg-slate-800/50 text-gray-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-all sm:text-sm"
            placeholder="Pesquisar por nome, código..."
          />
        </div>
        
        <button
          onClick={onToggleFilters}
          className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors ${
            showFilters 
              ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' 
              : 'bg-white dark:bg-slate-800/50 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filtros
          <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        <button 
          onClick={onRefresh}
          className="p-2.5 bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white transition-colors"
          title="Atualizar Dados"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Right Area: Primary Actions */}
      <div className="flex items-center gap-2 w-full md:w-auto">
        <button
          onClick={onPurchaseOrders}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 rounded-xl transition-all text-sm font-medium"
        >
          <ShoppingCart className="w-4 h-4" />
          <span className="hidden sm:inline">Compras</span>
        </button>

        <button
          onClick={onMarkup}
          className="flex items-center gap-2 px-4 py-2.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded-xl transition-all text-sm font-medium"
        >
          <Calculator className="w-4 h-4" />
          <span className="hidden sm:inline">Markup</span>
        </button>

        {podeDarEntrada && (
          <button
            onClick={() => navigate('/entrada-nfe?ler=1')}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-xl transition-all text-sm font-medium"
            title="Dar entrada no estoque pela nota fiscal (QR Code do cupom ou XML)"
          >
            <QrCode className="w-4 h-4" />
            <span className="hidden sm:inline">Nota fiscal (QR Code)</span>
          </button>
        )}

        <button
          onClick={onLabels}
          className="tour-produtos-etiquetas flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-500 rounded-xl transition-all text-sm font-medium"
          title="Imprimir etiquetas com código de barras"
        >
          <Barcode className="w-4 h-4" />
          <span className="hidden sm:inline">Etiquetas</span>
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className="p-2.5 bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white transition-colors"
            title="Mais Ações"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          
          {showMoreMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
              <button
                onClick={() => { setShowMoreMenu(false); onImport(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white transition-colors"
              >
                <Upload className="w-4 h-4" /> Importar Planilha
              </button>
              <button
                onClick={() => { setShowMoreMenu(false); onExport(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white transition-colors"
              >
                <Download className="w-4 h-4" /> Exportar CSV
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-8 bg-gray-100 dark:bg-slate-700 mx-1 hidden sm:block"></div>

        <button
          onClick={onNew}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all text-sm font-bold shadow-[0_0_15px_rgba(37,99,235,0.4)]"
        >
          <Plus className="w-4 h-4" />
          Novo Produto
        </button>
      </div>
    </div>
  );
};

export default CommandToolbar;
