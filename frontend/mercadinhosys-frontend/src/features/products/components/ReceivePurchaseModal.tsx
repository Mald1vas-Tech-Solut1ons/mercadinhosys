// src/features/products/components/ReceivePurchaseModal.tsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, FileText, DollarSign, CheckCircle, ChevronDown, CheckSquare, Square, ChevronUp, AlertCircle } from 'lucide-react';
import { PedidoCompra, ReceberPedidoData, purchaseOrderService } from '../purchaseOrderService';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';

interface ReceivePurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  pedido: PedidoCompra;
}

interface ItemRecebimento {
  item_id: number;
  produto_nome: string;
  quantidade_solicitada: number;
  quantidade_recebida: number;
  quantidade_avariada: number;
  quantidade_faltante: number;
  quantidade_bonificada: number;
  preco_unitario: number;
  data_fabricacao: string;
  data_validade: string;
  numero_lote: string;
  conferido: boolean;
  expanded?: boolean;
  imagem_url?: string;
  codigo_barras?: string;
}

const ReceivePurchaseModal: React.FC<ReceivePurchaseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  pedido
}) => {
  const [loading, setLoading] = useState(false);

  const [loadingDetails, setLoadingDetails] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    notaFiscal: false,
    boleto: true
  });


  // Form data
  const [formData, setFormData] = useState({
    numero_nota_fiscal: '',
    serie_nota_fiscal: '',
    gerar_boleto: true,
    data_vencimento: '',
    numero_documento: ''
  });

  const [itensRecebimento, setItensRecebimento] = useState<ItemRecebimento[]>([]);

  // Carregar detalhes do pedido
  useEffect(() => {
    if (isOpen && pedido) {
      loadPedidoDetails();
    }
  }, [isOpen, pedido]);

  const loadPedidoDetails = async () => {
    setLoadingDetails(true);
    try {
      const detalhes = await purchaseOrderService.obterPedido(pedido.id);


      // Inicializar itens de recebimento
      if (detalhes.itens) {
        // Calcular data de validade padrão (1 ano a partir de hoje)
        const dataValidadePadrao = new Date();
        dataValidadePadrao.setFullYear(dataValidadePadrao.getFullYear() + 1);

        const itens = detalhes.itens.map((item, index) => ({
          item_id: item.id!,
          produto_nome: item.produto_nome,
          quantidade_solicitada: item.quantidade_solicitada,
          quantidade_recebida: 0, // Inicia zerado, o usuário vai conferir
          quantidade_avariada: 0,
          quantidade_faltante: 0,
          quantidade_bonificada: 0,
          preco_unitario: item.preco_unitario,
          data_fabricacao: '',
          data_validade: dataValidadePadrao.toISOString().split('T')[0],
          numero_lote: `LOTE-${detalhes.numero_pedido}-${index + 1}`,
          conferido: false,
          expanded: false,
          imagem_url: item.produto?.imagem_url,
          codigo_barras: item.produto?.codigo_barras
        }));
        setItensRecebimento(itens);
      }

      // Configurar dados padrão do boleto
      const dataVencimento = new Date();
      dataVencimento.setDate(dataVencimento.getDate() + 30); // 30 dias por padrão

      setFormData(prev => ({
        ...prev,
        data_vencimento: dataVencimento.toISOString().split('T')[0],
        numero_documento: `BOL-${detalhes.numero_pedido}`
      }));

    } catch (error) {
      console.error('Erro ao carregar detalhes do pedido:', error);
      showToast.error('Erro ao carregar detalhes do pedido');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleQuantidadeChange = (index: number, quantidade: number) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].quantidade_recebida = Math.max(0, quantidade);
    setItensRecebimento(novosItens);
  };

  const handleQuantidadeAvariadaChange = (index: number, quantidade: number) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].quantidade_avariada = Math.max(0, quantidade);
    setItensRecebimento(novosItens);
  };

  const handleQuantidadeFaltanteChange = (index: number, quantidade: number) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].quantidade_faltante = Math.max(0, quantidade);
    setItensRecebimento(novosItens);
  };

  const handleQuantidadeBonificadaChange = (index: number, quantidade: number) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].quantidade_bonificada = Math.max(0, quantidade);
    setItensRecebimento(novosItens);
  };

  const handleDataValidadeChange = (index: number, data: string) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].data_validade = data;
    setItensRecebimento(novosItens);
  };

  const handleDataFabricacaoChange = (index: number, data: string) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].data_fabricacao = data;
    setItensRecebimento(novosItens);
  };

  const handleNumeroLoteChange = (index: number, lote: string) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].numero_lote = lote;
    setItensRecebimento(novosItens);
  };

  const toggleConferido = (index: number) => {
    const novosItens = [...itensRecebimento];
    const item = novosItens[index];
    item.conferido = !item.conferido;
    if (item.conferido && item.quantidade_recebida === 0) {
      item.quantidade_recebida = item.quantidade_solicitada;
    } else if (!item.conferido) {
      item.quantidade_recebida = 0;
    }
    setItensRecebimento(novosItens);
  };

  const toggleExpanded = (index: number) => {
    const novosItens = [...itensRecebimento];
    novosItens[index].expanded = !novosItens[index].expanded;
    setItensRecebimento(novosItens);
  };

  const handleReceberTudo = () => {
    const novosItens = itensRecebimento.map(item => ({
      ...item,
      conferido: true,
      quantidade_recebida: item.quantidade_solicitada
    }));
    setItensRecebimento(novosItens);
  };

  const handleLimparTudo = () => {
    const novosItens = itensRecebimento.map(item => ({
      ...item,
      conferido: false,
      quantidade_recebida: 0
    }));
    setItensRecebimento(novosItens);
  };

  const calcularTotalRecebido = () => {
    return itensRecebimento.reduce((total, item) => {
      return total + (item.quantidade_recebida * item.preco_unitario);
    }, 0);
  };

  const handleDevolver = async () => {
    if (window.confirm('ATENÇÃO: Você está prestes a DEVOLVER (recusar) este pedido por completo. Ele será marcado como devolvido e não entrará no estoque. Deseja continuar?')) {
      setLoading(true);
      try {
        await purchaseOrderService.devolverPedido(pedido.id);
        showToast.success('Pedido devolvido com sucesso!');
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      } catch (error) {
        showToast.error('Erro ao devolver pedido.');
        setLoading(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const itensComRecebimento = itensRecebimento.filter(item => item.quantidade_recebida > 0);

    if (itensComRecebimento.length === 0) {
      showToast.error('Informe a quantidade recebida para pelo menos um item');
      return;
    }

    if (formData.gerar_boleto && !formData.data_vencimento) {
      showToast.error('Informe a data de vencimento do boleto');
      return;
    }

    setLoading(true);

    try {
      const dadosRecebimento: ReceberPedidoData = {
        pedido_id: pedido.id,
        numero_nota_fiscal: formData.numero_nota_fiscal,
        serie_nota_fiscal: formData.serie_nota_fiscal,
        gerar_boleto: formData.gerar_boleto,
        data_vencimento: formData.gerar_boleto ? formData.data_vencimento : undefined,
        numero_documento: formData.gerar_boleto ? formData.numero_documento : undefined,
        itens: itensComRecebimento.map(item => ({
          item_id: item.item_id,
          quantidade_recebida: item.quantidade_recebida,
          quantidade_avariada: item.quantidade_avariada, // NOVO
          quantidade_faltante: item.quantidade_faltante, // NOVO
          quantidade_bonificada: item.quantidade_bonificada, // NOVO
          data_fabricacao: item.data_fabricacao || undefined, 
          data_validade: item.data_validade,  
          numero_lote: item.numero_lote       
        }))
      };

      await purchaseOrderService.receberPedido(dadosRecebimento);

      // Feedback visual detalhado
      const totalRecebido = itensComRecebimento.reduce((sum, item) => sum + item.quantidade_recebida, 0);
      const totalValor = calcularTotalRecebido();

      showToast.success(
        `✅ Pedido Recebido!\n📦 ${totalRecebido} unidades\n💰 R$ ${totalValor.toFixed(2)}\n📊 Estoque Ajustado${formData.gerar_boleto ? '\n📄 Boleto Gerado' : ''}`
      );

      // Aguardar um pouco para o usuário ver o feedback
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);

    } catch (error: any) {
      console.error('Erro ao receber pedido:', error);
      showToast.error(error.response?.data?.error || 'Erro ao receber pedido');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-210 p-2 sm:p-4" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))', paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-linear-to-r from-green-50 to-green-100 dark:from-green-900 dark:to-green-800">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Package className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 dark:text-green-300 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-white truncate">
                Receber Pedido
              </h2>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
                {pedido.numero_pedido} - {pedido.fornecedor_nome}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-green-200 dark:hover:bg-green-700 rounded-lg transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadingDetails ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
              {/* Informações do Pedido */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 sm:p-4">
                <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-2 sm:mb-3">
                  Informações do Pedido
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-xs sm:text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Data do Pedido:</span>
                    <div className="font-medium text-gray-800 dark:text-white">
                      {formatDate(pedido.data_pedido)}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Previsão de Entrega:</span>
                    <div className="font-medium text-gray-800 dark:text-white">
                      {pedido.data_previsao_entrega ? formatDate(pedido.data_previsao_entrega) : 'Não informado'}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Total do Pedido:</span>
                    <div className="font-medium text-green-600 dark:text-green-400">
                      {formatCurrency(pedido.total)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Itens para Recebimento */}
              <div>
                {(() => {
                  const itensConferidos = itensRecebimento.filter(i => i.conferido).length;
                  const progresso = itensRecebimento.length > 0 ? (itensConferidos / itensRecebimento.length) * 100 : 0;

                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-base font-semibold text-gray-800 dark:text-white">
                          Conferência de Produtos
                        </h3>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={handleReceberTudo}
                            className="px-3 py-1.5 bg-green-600/10 text-green-700 dark:text-green-400 rounded-lg text-xs font-medium hover:bg-green-600/20 transition-colors"
                          >
                            Marcar Todos
                          </button>
                          <button
                            type="button"
                            onClick={handleLimparTudo}
                            className="px-3 py-1.5 bg-gray-600/10 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium hover:bg-gray-600/20 transition-colors"
                          >
                            Desmarcar
                          </button>
                        </div>
                      </div>

                      <div className="mb-4">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Progresso</span>
                          <span className="text-xs font-bold text-green-600 dark:text-green-400">{itensConferidos} de {itensRecebimento.length}</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div className="bg-green-600 h-2 rounded-full transition-all duration-500 ease-out" style={{ width: `${progresso}%` }}></div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {itensRecebimento.map((item, index) => (
                          <div key={index} className={`border rounded-xl overflow-hidden transition-all duration-300 ${item.conferido ? 'border-green-500 bg-green-50/40 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm'}`}>
                            {/* Card Header (Clickable) */}
                            <div className="p-3 sm:p-4 flex items-center justify-between gap-3">
                              <div 
                                className="flex-1 flex items-start gap-3 cursor-pointer group"
                                onClick={() => toggleConferido(index)}
                              >
                                <div className={`mt-0.5 rounded flex items-center justify-center transition-colors ${item.conferido ? 'text-green-600' : 'text-gray-300 group-hover:text-green-500'}`}>
                                  {item.conferido ? <CheckSquare className="w-6 h-6" /> : <Square className="w-6 h-6" />}
                                </div>
                                {item.imagem_url && (
                                  <img src={item.imagem_url} alt={item.produto_nome} className="w-12 h-12 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
                                )}
                                <div className="flex-1">
                                  <h4 className={`font-semibold text-sm sm:text-base transition-colors ${item.conferido ? 'text-green-800 dark:text-green-300' : 'text-gray-800 dark:text-white'}`}>
                                    {item.produto_nome}
                                  </h4>
                                  {item.codigo_barras && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                      EAN: {item.codigo_barras}
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                    <span>Sol: <b className="text-gray-700 dark:text-gray-300">{item.quantidade_solicitada}</b></span>
                                    <span>Preço: {formatCurrency(item.preco_unitario)}</span>
                                    {item.conferido && (
                                      <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                                        Rec: {item.quantidade_recebida} <CheckCircle className="w-3 h-3" />
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Expand Button */}
                              <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleExpanded(index); }}
                                className={`p-1.5 rounded-lg transition-colors shrink-0 ${item.expanded ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200'}`}
                              >
                                {item.expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                              </button>
                            </div>

                            {/* Expanded Content */}
                            {item.expanded && (
                              <div className="p-3 sm:p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/80">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Qtd Recebida</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max={item.quantidade_solicitada}
                                      value={item.quantidade_recebida}
                                      onChange={(e) => handleQuantidadeChange(index, parseInt(e.target.value) || 0)}
                                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                                    />
                                  </div>
                                  <div className="col-span-2 sm:col-span-1">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fabricação</label>
                                    <input
                                      type="date"
                                      value={item.data_fabricacao}
                                      onChange={(e) => handleDataFabricacaoChange(index, e.target.value)}
                                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                                    />
                                  </div>
                                  <div className="col-span-2 sm:col-span-1">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Validade</label>
                                    <input
                                      type="date"
                                      value={item.data_validade}
                                      onChange={(e) => handleDataValidadeChange(index, e.target.value)}
                                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                                    />
                                  </div>
                                  <div className="col-span-2 sm:col-span-1">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Lote</label>
                                    <input
                                      type="text"
                                      value={item.numero_lote}
                                      onChange={(e) => handleNumeroLoteChange(index, e.target.value)}
                                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                                      placeholder="LOTE"
                                    />
                                  </div>
                                  <div className="col-span-2 sm:col-span-1 flex flex-col justify-end">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total do Item</div>
                                    <div className="font-semibold text-gray-800 dark:text-white">
                                      {formatCurrency(item.quantidade_recebida * item.preco_unitario)}
                                    </div>
                                  </div>

                                  {/* NOVOS CAMPOS: Discrepâncias */}
                                  <div className="col-span-2 sm:col-span-4 mt-2 mb-1 border-t border-gray-200 dark:border-gray-700 pt-3">
                                    <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">Divergências Físicas e Bonificações</h5>
                                    <div className="grid grid-cols-3 gap-3">
                                      <div>
                                        <label className="block text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">Qtd Avariada</label>
                                        <input
                                          type="number"
                                          min="0"
                                          value={item.quantidade_avariada}
                                          onChange={(e) => handleQuantidadeAvariadaChange(index, parseInt(e.target.value) || 0)}
                                          className="w-full px-2 py-1.5 text-sm border border-amber-300 dark:border-amber-600/50 rounded-lg focus:ring-2 focus:ring-amber-500 dark:bg-amber-900/10 dark:text-white placeholder-amber-200 dark:placeholder-amber-800/50"
                                          placeholder="Ex: 2"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-red-600 dark:text-red-400 mb-1">Qtd Faltante</label>
                                        <input
                                          type="number"
                                          min="0"
                                          value={item.quantidade_faltante}
                                          onChange={(e) => handleQuantidadeFaltanteChange(index, parseInt(e.target.value) || 0)}
                                          className="w-full px-2 py-1.5 text-sm border border-red-300 dark:border-red-600/50 rounded-lg focus:ring-2 focus:ring-red-500 dark:bg-red-900/10 dark:text-white placeholder-red-200 dark:placeholder-red-800/50"
                                          placeholder="Ex: 1"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Qtd Bonificada</label>
                                        <input
                                          type="number"
                                          min="0"
                                          value={item.quantidade_bonificada}
                                          onChange={(e) => handleQuantidadeBonificadaChange(index, parseInt(e.target.value) || 0)}
                                          className="w-full px-2 py-1.5 text-sm border border-blue-300 dark:border-blue-600/50 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-blue-900/10 dark:text-white placeholder-blue-200 dark:placeholder-blue-800/50"
                                          placeholder="Ex: 5"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                {item.quantidade_recebida !== item.quantidade_solicitada && item.quantidade_recebida > 0 && (
                                  <div className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg">
                                    <AlertCircle className="w-4 h-4" />
                                    Quantidade recebida diferente da solicitada
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex justify-between items-center bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total a Receber:</span>
                        <span className="text-lg font-bold text-green-600 dark:text-green-400">
                          {formatCurrency(calcularTotalRecebido())}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Informações da Nota Fiscal */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <button
                  type="button"
                  onClick={() => setExpandedSections(prev => ({ ...prev, notaFiscal: !prev.notaFiscal }))}
                  className="flex items-center justify-between w-full mb-3 text-base font-semibold text-gray-800 dark:text-white hover:text-green-600 dark:hover:text-green-400 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Nota Fiscal (Opcional)
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections.notaFiscal ? 'rotate-180' : ''}`} />
                </button>

                {expandedSections.notaFiscal && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Número da NF
                      </label>
                      <input
                        type="text"
                        value={formData.numero_nota_fiscal}
                        onChange={(e) => setFormData(prev => ({ ...prev, numero_nota_fiscal: e.target.value }))}
                        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                        placeholder="Ex: 123456"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Série
                      </label>
                      <input
                        type="text"
                        value={formData.serie_nota_fiscal}
                        onChange={(e) => setFormData(prev => ({ ...prev, serie_nota_fiscal: e.target.value }))}
                        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                        placeholder="Ex: 1"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Geração de Boleto */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <button
                  type="button"
                  onClick={() => setExpandedSections(prev => ({ ...prev, boleto: !prev.boleto }))}
                  className="flex items-center justify-between w-full mb-3 text-base font-semibold text-gray-800 dark:text-white hover:text-green-600 dark:hover:text-green-400 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Gerar Boleto para Pagamento
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections.boleto ? 'rotate-180' : ''}`} />
                </button>

                {expandedSections.boleto && (
                  <div className="pl-6 space-y-3">
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        id="gerar_boleto"
                        checked={formData.gerar_boleto}
                        onChange={(e) => setFormData(prev => ({ ...prev, gerar_boleto: e.target.checked }))}
                        className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                      />
                      <label htmlFor="gerar_boleto" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Sim, gerar boleto
                      </label>
                    </div>

                    {formData.gerar_boleto && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Data de Vencimento *
                          </label>
                          <input
                            type="date"
                            value={formData.data_vencimento}
                            onChange={(e) => setFormData(prev => ({ ...prev, data_vencimento: e.target.value }))}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                            required={formData.gerar_boleto}
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Número do Documento
                          </label>
                          <input
                            type="text"
                            value={formData.numero_documento}
                            onChange={(e) => setFormData(prev => ({ ...prev, numero_documento: e.target.value }))}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                            placeholder="Ex: BOL-PC000001"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 flex justify-between gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700" style={{ paddingBottom: 'max(1rem, calc(1rem + env(safe-area-inset-bottom)))' }}>
              <button
                type="button"
                onClick={handleDevolver}
                disabled={loading}
                className="px-3 sm:px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium rounded-lg transition-colors flex items-center gap-2 border border-transparent hover:border-red-200 dark:hover:border-red-800"
              >
                <AlertCircle className="w-4 h-4" />
                Devolver Pedido
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 sm:px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || itensRecebimento.every(item => !item.conferido || item.quantidade_recebida === 0)}
                  className="px-4 sm:px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Confirmar Recebimento
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ReceivePurchaseModal;