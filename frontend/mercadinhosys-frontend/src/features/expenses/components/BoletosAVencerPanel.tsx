// src/features/expenses/components/BoletosAVencerPanel.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  Clock,
  Truck,
  Eye,
  CreditCard,
  Search,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal
} from 'lucide-react';
import { BoletoFornecedor, purchaseOrderService } from '../../products/purchaseOrderService';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';

interface BoletosAVencerPanelProps {
  className?: string;
}

const BoletosAVencerPanel: React.FC<BoletosAVencerPanelProps> = ({ className = '' }) => {
  const [boletos, setBoletos] = useState<BoletoFornecedor[]>([]);
  const [resumo, setResumo] = useState({
    total_boletos: 0,
    total_valor: 0,
    vencidos: 0,
    vence_hoje: 0,
    vence_7_dias: 0,
    valor_vencidos: 0,
    valor_vence_hoje: 0,
    valor_vence_7_dias: 0
  });
  const [loading, setLoading] = useState(false);
  
  // Novos filtros e estados
  const [filtro, setFiltro] = useState<'todos' | 'vencidos' | 'hoje' | '7_dias'>('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFornecedores, setExpandedFornecedores] = useState<Record<string, boolean>>({});
  
  const [showPayModal, setShowPayModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBoleto, setSelectedBoleto] = useState<BoletoFornecedor | null>(null);

  const loadBoletos = async () => {
    setLoading(true);
    try {
      const response = await purchaseOrderService.boletosAVencer({
        dias: 30,
        apenas_vencidos: false
      });

      setBoletos(response.boletos);
      setResumo(response.resumo);
    } catch (error) {
      console.error('Erro ao carregar boletos:', error);
      showToast.error('Erro ao carregar boletos a vencer');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoletos();
  }, []);

  const getStatusBadge = (status: string) => {
    const styles = {
      vencido: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border border-red-200 dark:border-red-800',
      vence_hoje: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 border border-orange-200 dark:border-orange-800',
      vence_em_breve: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800',
      normal: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border border-green-200 dark:border-green-800'
    };

    const icons = {
      vencido: AlertTriangle,
      vence_hoje: Clock,
      vence_em_breve: Calendar,
      normal: CheckCircle
    };

    const labels = {
      vencido: 'Vencido',
      vence_hoje: 'Vence Hoje',
      vence_em_breve: 'Vence em Breve',
      normal: 'Normal'
    };

    const Icon = icons[status as keyof typeof icons] || Clock;
    const label = labels[status as keyof typeof labels] || 'Normal';

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${styles[status as keyof typeof styles] || styles.normal}`}>
        <Icon className="w-3 h-3" />
        {label}
      </span>
    );
  };

  const handlePagar = async (boleto: BoletoFornecedor) => {
    setSelectedBoleto(boleto);
    setShowPayModal(true);
  };

  const handleVerDetalhes = (boleto: BoletoFornecedor) => {
    setSelectedBoleto(boleto);
    setShowDetailModal(true);
  };
  
  const toggleFornecedor = (fornecedorNome: string) => {
    setExpandedFornecedores(prev => ({
      ...prev,
      [fornecedorNome]: !prev[fornecedorNome]
    }));
  };

  // Filtragem Inteligente e Agrupamento
  const fornecedoresAgrupados = useMemo(() => {
    let filtrados = boletos.filter(boleto => {
      // 1. Filtro de Status (pelos Cards)
      let matchStatus = true;
      if (filtro === 'vencidos') matchStatus = boleto.status_vencimento === 'vencido';
      if (filtro === 'hoje') matchStatus = boleto.status_vencimento === 'vence_hoje';
      if (filtro === '7_dias') matchStatus = boleto.status_vencimento === 'vence_em_breve';

      // 2. Filtro de Busca (Search)
      let matchSearch = true;
      if (searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase();
        const fName = (boleto.fornecedor_nome || '').toLowerCase();
        const doc = (boleto.numero_documento || '').toLowerCase();
        const ped = (boleto.pedido_numero || '').toLowerCase();
        matchSearch = fName.includes(term) || doc.includes(term) || ped.includes(term);
      }

      return matchStatus && matchSearch;
    });

    // 3. Agrupar por Fornecedor
    const grupos: Record<string, { nome: string, boletos: BoletoFornecedor[], total: number, qtd: number }> = {};
    
    filtrados.forEach(b => {
      const nome = b.fornecedor_nome || 'Desconhecido';
      if (!grupos[nome]) {
        grupos[nome] = { nome, boletos: [], total: 0, qtd: 0 };
      }
      grupos[nome].boletos.push(b);
      grupos[nome].total += b.valor_atual;
      grupos[nome].qtd += 1;
    });

    // Converter para array e ordenar (maiores devedores primeiro)
    return Object.values(grupos).sort((a, b) => b.total - a.total);
  }, [boletos, filtro, searchTerm]);


  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 ${className}`}>
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg ${className}`}>
      {/* Header */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-orange-600" />
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">
              Painel Inteligente de Boletos
            </h2>
          </div>
          <button
            onClick={loadBoletos}
            className="px-3 py-1 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 font-semibold text-sm transition-colors"
          >
            Atualizar
          </button>
        </div>

        {/* Barra de Busca */}
        <div className="relative mb-6">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-gray-50 dark:bg-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 sm:text-sm transition-all"
            placeholder="Buscar por fornecedor, documento ou pedido..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Resumo - Agora Interativo como Filtros */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {/* Card Vencidos */}
          <button 
            onClick={() => setFiltro(filtro === 'vencidos' ? 'todos' : 'vencidos')}
            className={`text-left p-4 rounded-xl transition-all border-2 flex flex-col justify-between ${
              filtro === 'vencidos' 
                ? 'border-red-500 bg-red-50 dark:bg-red-900/50 shadow-md scale-[1.02]' 
                : 'border-transparent bg-red-50/50 hover:bg-red-50 dark:bg-red-900/30 dark:hover:bg-red-900/50'
            }`}
          >
            <div className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">Vencidos</div>
            <div className="text-2xl font-black text-red-800 dark:text-red-200 mb-1">
              {resumo.vencidos}
            </div>
            <div className="text-xs font-bold text-red-600/80 dark:text-red-400/80">
              {formatCurrency(resumo.valor_vencidos)}
            </div>
          </button>

          {/* Card Hoje */}
          <button 
            onClick={() => setFiltro(filtro === 'hoje' ? 'todos' : 'hoje')}
            className={`text-left p-4 rounded-xl transition-all border-2 flex flex-col justify-between ${
              filtro === 'hoje' 
                ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/50 shadow-md scale-[1.02]' 
                : 'border-transparent bg-orange-50/50 hover:bg-orange-50 dark:bg-orange-900/30 dark:hover:bg-orange-900/50'
            }`}
          >
            <div className="text-sm font-semibold text-orange-600 dark:text-orange-400 mb-1">Vence Hoje</div>
            <div className="text-2xl font-black text-orange-800 dark:text-orange-200 mb-1">
              {resumo.vence_hoje}
            </div>
            <div className="text-xs font-bold text-orange-600/80 dark:text-orange-400/80">
              {formatCurrency(resumo.valor_vence_hoje)}
            </div>
          </button>

          {/* Card 7 Dias */}
          <button 
            onClick={() => setFiltro(filtro === '7_dias' ? 'todos' : '7_dias')}
            className={`text-left p-4 rounded-xl transition-all border-2 flex flex-col justify-between ${
              filtro === '7_dias' 
                ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/50 shadow-md scale-[1.02]' 
                : 'border-transparent bg-yellow-50/50 hover:bg-yellow-50 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50'
            }`}
          >
            <div className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 mb-1">Próx. 7 Dias</div>
            <div className="text-2xl font-black text-yellow-800 dark:text-yellow-200 mb-1">
              {resumo.vence_7_dias}
            </div>
            <div className="text-xs font-bold text-yellow-600/80 dark:text-yellow-400/80">
              {formatCurrency(resumo.valor_vence_7_dias)}
            </div>
          </button>

          {/* Card Total (Todos) */}
          <button 
            onClick={() => setFiltro('todos')}
            className={`text-left p-4 rounded-xl transition-all border-2 flex flex-col justify-between ${
              filtro === 'todos' 
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/50 shadow-md scale-[1.02]' 
                : 'border-transparent bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-900/30 dark:hover:bg-blue-900/50'
            }`}
          >
            <div className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-1">Total Pendente</div>
            <div className="text-2xl font-black text-blue-800 dark:text-blue-200 mb-1">
              {resumo.total_boletos}
            </div>
            <div className="text-xs font-bold text-blue-600/80 dark:text-blue-400/80">
              {formatCurrency(resumo.total_valor)}
            </div>
          </button>
        </div>
      </div>

      {/* Accordion de Boletos por Fornecedor */}
      <div className="p-6 bg-slate-50 dark:bg-gray-800/50 rounded-b-xl">
        {fornecedoresAgrupados.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2">
              Nenhum boleto encontrado
            </h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              {filtro === 'todos' && searchTerm === ''
                ? 'Seu fluxo de caixa está limpo! Não há boletos pendentes no momento.'
                : 'Nenhum resultado corresponde aos filtros aplicados.'
              }
            </p>
            {(filtro !== 'todos' || searchTerm !== '') && (
              <button 
                onClick={() => { setFiltro('todos'); setSearchTerm(''); }}
                className="mt-4 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-300 transition-colors"
              >
                Limpar Filtros
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center px-2 mb-2">
              <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">{fornecedoresAgrupados.length} Fornecedores listados</span>
              <span className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><SlidersHorizontal className="w-4 h-4"/> Agrupado</span>
            </div>
            
            {fornecedoresAgrupados.map(grupo => {
              const isExpanded = expandedFornecedores[grupo.nome];
              
              return (
                <div key={grupo.nome} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-200">
                  {/* Cabeçalho do Accordion */}
                  <button 
                    onClick={() => toggleFornecedor(grupo.nome)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${isExpanded ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                        <Truck className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">{grupo.nome}</h3>
                        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                          {grupo.qtd} boleto{grupo.qtd > 1 ? 's' : ''} pendente{grupo.qtd > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Total devido</p>
                        <p className="text-lg font-black text-slate-800 dark:text-white">{formatCurrency(grupo.total)}</p>
                      </div>
                      <div className="p-1">
                        {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                      </div>
                    </div>
                  </button>

                  {/* Conteúdo Expandido (Lista de Boletos do Fornecedor) */}
                  {isExpanded && (
                    <div className="bg-slate-50/50 dark:bg-gray-800/30 p-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                      {grupo.boletos.map(boleto => (
                        <div
                          key={boleto.id}
                          className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:shadow-md transition-shadow"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h4 className="text-md font-bold text-gray-800 dark:text-white">
                                {boleto.numero_documento}
                              </h4>
                              {getStatusBadge(boleto.status_vencimento)}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600 dark:text-gray-400 font-medium">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="w-4 h-4 text-gray-400" />
                                <span>Vence: <strong className="text-gray-700 dark:text-gray-200">{formatDate(boleto.data_vencimento)}</strong></span>
                              </div>
                              
                              {boleto.pedido_numero && (
                                <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                                  <span>Ped: <strong>{boleto.pedido_numero}</strong></span>
                                </div>
                              )}
                            </div>

                            {boleto.dias_vencimento < 0 && (
                              <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-bold bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Atrasado há {Math.abs(boleto.dias_vencimento)} dias
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between lg:justify-end gap-4 w-full lg:w-auto border-t lg:border-t-0 border-gray-100 dark:border-gray-600 pt-3 lg:pt-0 mt-2 lg:mt-0">
                            <div className="text-left lg:text-right">
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Valor Atual</p>
                              <div className="text-xl font-black text-gray-900 dark:text-white">
                                {formatCurrency(boleto.valor_atual)}
                              </div>
                            </div>
                            
                            <div className="flex flex-col sm:flex-row items-center gap-2">
                              <button
                                onClick={() => handleVerDetalhes(boleto)}
                                className="w-full sm:w-auto px-3 py-2 bg-slate-100 text-slate-700 dark:bg-slate-600 dark:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-500 flex items-center justify-center gap-1.5 text-sm font-semibold transition-colors"
                              >
                                <Eye className="w-4 h-4" />
                                Detalhes
                              </button>
                              
                              <button
                                onClick={() => handlePagar(boleto)}
                                className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-1.5 text-sm font-semibold transition-colors shadow-sm"
                              >
                                <CreditCard className="w-4 h-4" />
                                Pagar
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Detalhes do Boleto */}
      {showDetailModal && selectedBoleto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto my-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-800 dark:text-white">
                  Detalhes do Boleto
                </h3>
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    setSelectedBoleto(null);
                  }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Informações Principais */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Número do Documento
                  </label>
                  <div className="text-lg font-semibold text-gray-800 dark:text-white">
                    {selectedBoleto.numero_documento}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Status
                  </label>
                  <div>
                    {getStatusBadge(selectedBoleto.status_vencimento)}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Fornecedor
                  </label>
                  <div className="text-gray-800 dark:text-white">
                    {selectedBoleto.fornecedor_nome}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Data de Vencimento
                  </label>
                  <div className="text-gray-800 dark:text-white">
                    {formatDate(selectedBoleto.data_vencimento)}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Valor Original
                  </label>
                  <div className="text-lg font-semibold text-gray-800 dark:text-white">
                    {formatCurrency(selectedBoleto.valor_original)}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Valor Atual
                  </label>
                  <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                    {formatCurrency(selectedBoleto.valor_atual)}
                  </div>
                </div>
              </div>

              {/* Tipo / Origem */}
              <div className={`p-4 rounded-lg ${selectedBoleto.origem === 'mercadoria'
                  ? 'bg-blue-50 dark:bg-blue-900'
                  : 'bg-purple-50 dark:bg-purple-900'
                }`}>
                <h4 className={`font-semibold mb-3 ${selectedBoleto.origem === 'mercadoria'
                    ? 'text-blue-900 dark:text-blue-100'
                    : 'text-purple-900 dark:text-purple-100'
                  }`}>
                  {selectedBoleto.origem === 'mercadoria' ? 'Pedido de Compra (Mercadoria)' : 'Despesa Fixa / Operacional'}
                </h4>

                {selectedBoleto.origem === 'mercadoria' && selectedBoleto.pedido_numero ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-blue-700 dark:text-blue-300">Número do Pedido:</span>
                      <div className="font-medium text-blue-900 dark:text-blue-100">
                        {selectedBoleto.pedido_numero}
                      </div>
                    </div>
                    {selectedBoleto.data_pedido && (
                      <div>
                        <span className="text-blue-700 dark:text-blue-300">Data do Pedido:</span>
                        <div className="font-medium text-blue-900 dark:text-blue-100">
                          {formatDate(selectedBoleto.data_pedido)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm">
                    <span className="text-purple-700 dark:text-purple-300">Descrição:</span>
                    <div className="font-medium text-purple-900 dark:text-purple-100">
                      {selectedBoleto.descricao || selectedBoleto.observacoes || 'Despesa recorrente'}
                    </div>
                  </div>
                )}
              </div>

              {/* Informações de Vencimento */}
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                <h4 className="font-semibold text-gray-800 dark:text-white mb-3">
                  Informações de Vencimento
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Dias para Vencer:</span>
                    <div className={`font-medium text-lg ${selectedBoleto.dias_vencimento < 0
                      ? 'text-red-600 dark:text-red-400'
                      : selectedBoleto.dias_vencimento === 0
                        ? 'text-orange-600 dark:text-orange-400'
                        : 'text-green-600 dark:text-green-400'
                      }`}>
                      {selectedBoleto.dias_vencimento < 0
                        ? `Vencido há ${Math.abs(selectedBoleto.dias_vencimento)} dias`
                        : selectedBoleto.dias_vencimento === 0
                          ? 'Vence Hoje'
                          : `${selectedBoleto.dias_vencimento} dias`
                      }
                    </div>
                  </div>

                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Juros/Multa:</span>
                    <div className="font-medium text-gray-800 dark:text-white">
                      {formatCurrency(selectedBoleto.valor_juros || 0)}
                    </div>
                  </div>

                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Desconto:</span>
                    <div className="font-medium text-gray-800 dark:text-white">
                      {formatCurrency(selectedBoleto.valor_desconto || 0)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Observações */}
              {selectedBoleto.observacoes && (
                <div className="bg-yellow-50 dark:bg-yellow-900 p-4 rounded-lg">
                  <h4 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                    Observações
                  </h4>
                  <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                    {selectedBoleto.observacoes}
                  </p>
                </div>
              )}

              {/* Produtos do Pedido */}
              {selectedBoleto.itens && selectedBoleto.itens.length > 0 && (
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <h4 className="font-semibold text-gray-800 dark:text-white mb-4">
                    Produtos do Pedido ({selectedBoleto.itens.length})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-600">
                          <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">
                            Produto
                          </th>
                          <th className="text-right py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">
                            Qtd. Solicitada
                          </th>
                          <th className="text-right py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">
                            Qtd. Recebida
                          </th>
                          <th className="text-right py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">
                            Preço Unit.
                          </th>
                          <th className="text-right py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBoleto.itens.map((item, idx) => (
                          <tr key={idx} className="border-b border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                            <td className="py-3 px-3 text-gray-800 dark:text-white">
                              {item.produto_nome}
                            </td>
                            <td className="text-right py-3 px-3 text-gray-800 dark:text-white">
                              {item.quantidade_solicitada}
                            </td>
                            <td className="text-right py-3 px-3 text-gray-800 dark:text-white">
                              {item.quantidade_recebida}
                            </td>
                            <td className="text-right py-3 px-3 text-gray-800 dark:text-white">
                              {formatCurrency(item.preco_unitario)}
                            </td>
                            <td className="text-right py-3 px-3 font-medium text-gray-800 dark:text-white">
                              {formatCurrency(item.total_item)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Ações */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    setSelectedBoleto(null);
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Fechar
                </button>
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    handlePagar(selectedBoleto);
                  }}
                  className="px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  Pagar Agora
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Pagamento Funcional */}
      {showPayModal && selectedBoleto && (
        <ModalPagamentoBoleto
          boleto={selectedBoleto}
          onClose={() => { setShowPayModal(false); setSelectedBoleto(null); }}
          onPago={() => {
            setShowPayModal(false);
            setSelectedBoleto(null);
            loadBoletos();
            showToast.success('Boleto pago com sucesso!');
          }}
        />
      )}
    </div>
  );
};

// ===============================================
// Componente Modal de Pagamento de Boleto
// ===============================================

export interface ModalPagamentoBoletoProps {
  boleto: BoletoFornecedor;
  onClose: () => void;
  onPago: () => void;
}

export const ModalPagamentoBoleto: React.FC<ModalPagamentoBoletoProps> = ({ boleto, onClose, onPago }) => {
  const [paymentKey] = useState(() => crypto.randomUUID());
  const [formaPagamento, setFormaPagamento] = useState('pix');
  const [valorPago, setValorPago] = useState(boleto.valor_atual.toString());
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().split('T')[0]);
  const [observacoes, setObservacoes] = useState('');
  const [processando, setProcessando] = useState(false);

  const handlePagar = async () => {
    setProcessando(true);
    try {
      await purchaseOrderService.pagarBoleto(boleto.id, {
        idempotency_key: paymentKey,
        valor_pago: parseFloat(valorPago),
        data_pagamento: dataPagamento,
        forma_pagamento: formaPagamento,
        observacoes: observacoes || undefined,
      });
      onPago();
    } catch (error: any) {
      console.error('Erro ao pagar boleto:', error);
      showToast.error(error.response?.data?.error || 'Erro ao registrar pagamento');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full my-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/40 rounded-lg">
                <CreditCard className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                Registrar Pagamento
              </h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <span className="text-xl">&times;</span>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Resumo do boleto */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Documento</span>
              <span className="font-medium text-gray-800 dark:text-white">{boleto.numero_documento}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Fornecedor</span>
              <span className="font-medium text-gray-800 dark:text-white">{boleto.fornecedor_nome}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Vencimento</span>
              <span className={`font-medium ${boleto.dias_vencimento < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-white'}`}>
                {formatDate(boleto.data_vencimento)}
                {boleto.dias_vencimento < 0 && ` (${Math.abs(boleto.dias_vencimento)}d atrasado)`}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
              <span className="text-gray-500 dark:text-gray-400 font-medium">Valor</span>
              <span className="font-bold text-lg text-blue-600 dark:text-blue-400">{formatCurrency(boleto.valor_atual)}</span>
            </div>
          </div>

          {/* Formulario de pagamento */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Valor Pago (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Data do Pagamento
              </label>
              <input
                type="date"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Forma de Pagamento
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'pix', label: 'PIX' },
                { value: 'transferencia', label: 'Transf.' },
                { value: 'boleto', label: 'Boleto' },
                { value: 'dinheiro', label: 'Dinheiro' },
                { value: 'cartao_debito', label: 'Debito' },
                { value: 'cheque', label: 'Cheque' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setFormaPagamento(value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${formaPagamento === value
                      ? 'bg-green-600 text-white border-green-600 shadow-md'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Observacoes (opcional)
            </label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white text-sm resize-none"
              placeholder="Comprovante, numero da transacao..."
            />
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={processando}
            className="px-5 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handlePagar}
            disabled={processando || !valorPago || parseFloat(valorPago) <= 0}
            className="px-5 py-2.5 bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            {processando ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Confirmar Pagamento
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BoletosAVencerPanel;
