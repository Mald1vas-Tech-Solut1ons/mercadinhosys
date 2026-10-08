import React, { useState, useEffect } from 'react';
import { X, SlidersHorizontal, Trash2 } from 'lucide-react';
import { ProdutoFiltros, Fornecedor } from '../../../types';

interface AdvancedFiltersModalProps {
  show: boolean;
  onClose: () => void;
  filtros: ProdutoFiltros;
  categorias: string[];
  fornecedores: Fornecedor[];
  /** Recebe o rascunho completo — o pai troca os filtros de uma vez só. */
  onApply: (novosFiltros: ProdutoFiltros) => void;
}

const AdvancedFiltersModal: React.FC<AdvancedFiltersModalProps> = ({
  show,
  onClose,
  filtros,
  categorias,
  fornecedores,
  onApply
}) => {
  // Rascunho local: mexer nos selects NÃO dispara requisições — antes cada
  // toque já aplicava o filtro (lista + estatísticas) com o modal aberto,
  // e o botão "Aplicar" era ilusório.
  const [draft, setDraft] = useState<ProdutoFiltros>(filtros);

  useEffect(() => {
    if (show) setDraft(filtros);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  const handleChange = (key: keyof ProdutoFiltros, value: any) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleClearFiltros = () => {
    setDraft(prev => ({
      busca: prev.busca, // preserve search
      ativos: true,
      ordenar_por: 'nome',
      direcao: 'asc',
      // Reset all others
      categoria: undefined,
      fornecedor_id: undefined,
      estoque_status: undefined,
      tipo: undefined,
      vencidos: false,
      validade_proxima: false,
      dias_validade: undefined,
      filtro_rapido: undefined
    }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-200 flex items-center justify-center p-4">
      <div 
        className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{ maxHeight: '90dvh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Filtros Avançados</h2>
              <p className="text-xs font-medium text-slate-500">Refine a busca no catálogo de produtos</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Categoria */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Categoria</label>
              <select
                value={draft.categoria || ''}
                onChange={(e) => handleChange('categoria', e.target.value || undefined)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">Todas as Categorias</option>
                {categorias.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>

            {/* Fornecedor */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Fornecedor</label>
              <select 
                value={draft.fornecedor_id || ''}
                onChange={(e) => handleChange('fornecedor_id', e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">Todos os Fornecedores</option>
                {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome_fantasia}</option>)}
              </select>
            </div>

            {/* Status Estoque */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status do Estoque</label>
              <select 
                value={draft.estoque_status || ''}
                onChange={(e) => handleChange('estoque_status', e.target.value || undefined)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">Qualquer Nível</option>
                <option value="normal">Estoque Normal</option>
                <option value="baixo">Estoque Baixo</option>
                <option value="esgotado">Esgotado (Zero)</option>
              </select>
            </div>

            {/* Tipo */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Classificação (Tipo)</label>
              <select 
                value={draft.tipo || ''}
                onChange={(e) => handleChange('tipo', e.target.value || undefined)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">Todos os Tipos</option>
                <option value="Higiene">Higiene</option>
                <option value="Limpeza">Limpeza</option>
                <option value="Alimentos">Alimentos</option>
                <option value="Bebidas">Bebidas</option>
                <option value="Hortifruti">Hortifruti</option>
              </select>
            </div>

            {/* Validade */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Condição de Validade</label>
              <select 
                value={draft.vencidos ? 'vencidos' : (draft.validade_proxima ? `proxima_${draft.dias_validade || 30}` : '')}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'vencidos') {
                    setDraft(prev => ({ ...prev, vencidos: true, validade_proxima: false, dias_validade: undefined }));
                  } else if (val.startsWith('proxima_')) {
                    setDraft(prev => ({ ...prev, validade_proxima: true, vencidos: false, dias_validade: parseInt(val.split('_')[1]) }));
                  } else {
                    setDraft(prev => ({ ...prev, vencidos: false, validade_proxima: false, dias_validade: undefined }));
                  }
                }}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">Ignorar Validade</option>
                <option value="vencidos">Produtos Já Vencidos</option>
                <option value="proxima_15">Vence em até 15 dias</option>
                <option value="proxima_30">Vence em até 30 dias</option>
                <option value="proxima_90">Vence em até 90 dias</option>
              </select>
            </div>

          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* Status e Ordenação */}
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Status do Produto */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status do Produto</label>
                <select 
                  value={draft.ativos === true ? 'ativos' : (draft.ativos === false ? 'inativos' : 'todos')}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'ativos') handleChange('ativos', true);
                    else if (val === 'inativos') handleChange('ativos', false);
                    else handleChange('ativos', undefined);
                  }}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="ativos">Apenas Ativos</option>
                  <option value="inativos">Apenas Inativos</option>
                  <option value="todos">Todos (Ativos e Inativos)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Critério</label>
                <select 
                  value={draft.ordenar_por || 'nome'}
                  onChange={(e) => handleChange('ordenar_por', e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="nome">Nome Alfabético</option>
                  <option value="quantidade">Qtd. Estoque</option>
                  <option value="preco_venda">Preço de Venda</option>
                  <option value="margem_lucro">Margem de Lucro (%)</option>
                  <option value="data_validade">Data de Validade</option>
                  <option value="valor_total_estoque">Custo Total Imobilizado</option>
                  <option value="total_vendido">Volume Vendido (Popularidade)</option>
                  <option value="ultima_venda">Data da Última Venda (Giro)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Direção</label>
                <select 
                  value={draft.direcao || 'asc'}
                  onChange={(e) => handleChange('direcao', e.target.value as 'asc' | 'desc')}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="asc">Crescente (Menor para Maior / A-Z)</option>
                  <option value="desc">Decrescente (Maior para Menor / Z-A)</option>
                </select>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex gap-3 shrink-0">
          <button
            onClick={handleClearFiltros}
            className="px-6 py-3.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Trash2 className="w-4 h-4" />
            Limpar
          </button>
          <button
            onClick={() => onApply(draft)}
            className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 active:scale-95 transition-all text-sm uppercase tracking-wider"
          >
            Aplicar Filtros
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdvancedFiltersModal;
