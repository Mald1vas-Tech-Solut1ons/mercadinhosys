import React, { useState, useEffect } from 'react';
import {
  Package,
  Plus,
  Eye,
  CheckCircle,
  Clock,
  AlertCircle,
  Filter,
  Search,
} from 'lucide-react';
import { PedidoCompra, purchaseOrderService } from '../purchaseOrderService';
import { Fornecedor } from '../../../types';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';
import PurchaseOrderModal from './PurchaseOrderModal';
import ReceivePurchaseModal from './ReceivePurchaseModal';
import PurchaseOrderDetailsModal from './PurchaseOrderDetailsModal';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import CollapsibleSection from '../../../components/ui/CollapsibleSection';

interface PurchaseOrdersPanelProps {
  isOpen: boolean;
  onClose: () => void;
  fornecedores: Fornecedor[];
  // Deep-link "Fazer Pedido" a partir do card de fornecedor no dashboard:
  // abre o modal de criação já com este fornecedor selecionado.
  initialSupplierId?: number;
}

const PurchaseOrdersPanel: React.FC<PurchaseOrdersPanelProps> = ({
  isOpen,
  onClose,
  fornecedores,
  initialSupplierId
}) => {
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedPedido, setSelectedPedido] = useState<PedidoCompra | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [filtros, setFiltros] = useState({
    status: '',
    fornecedor_id: '',
    busca: ''
  });

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadPedidos = async () => {
    setLoading(true);
    try {
      const params: any = { page, per_page: 20 };
      if (filtros.status) params.status = filtros.status;
      if (filtros.fornecedor_id) params.fornecedor_id = filtros.fornecedor_id;

      const response = await purchaseOrderService.listarPedidos(params);
      setPedidos(response.pedidos);
      setTotalPages(response.paginacao.total_paginas);
    } catch (error) {
      console.error('Erro ao carregar pedidos:', error);
      showToast.error('Erro ao carregar pedidos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPedidos();
    }
  }, [isOpen, page, filtros]);

  // Deep-link: ao abrir o painel com fornecedor pré-selecionado, já abre o
  // modal de novo pedido com ele. Dispara uma única vez por abertura.
  useEffect(() => {
    if (isOpen && initialSupplierId) {
      setShowCreateModal(true);
    }
  }, [isOpen, initialSupplierId]);

  const getStatusBadge = (status: string) => {
    const styles = {
      pendente: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
      parcial: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
      recebido: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      cancelado: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
    };

    const icons = {
      pendente: Clock,
      parcial: Clock,
      recebido: CheckCircle,
      cancelado: AlertCircle
    };

    const Icon = icons[status as keyof typeof icons] || Clock;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || styles.pendente}`}>
        <Icon className="w-3 h-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const handleReceivePedido = (pedido: PedidoCompra) => {
    setSelectedPedido(pedido);
    setShowReceiveModal(true);
  };

  const handleVerDetalhes = (pedido: PedidoCompra) => {
    setSelectedPedido(pedido);
    setShowDetailsModal(true);
  };

  if (!isOpen) return null;

  return (
    <>
      <ResponsiveModal
        isOpen={isOpen}
        onClose={onClose}
        title="Pedidos de Compra"
        subtitle={`${pedidos.length} pedidos`}
        headerIcon={<Package className="w-6 h-6" />}
        headerColor="blue"
        size="full"
        footer={
          totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
              >
                Próxima
              </button>
            </div>
          )
        }
      >
        {/* Toolbar */}
        <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 p-3 sm:p-4 space-y-3 sm:space-y-0">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center sm:justify-start gap-2 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Novo Pedido</span>
              <span className="sm:hidden">Novo</span>
            </button>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex-1 sm:flex-none px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center sm:justify-start gap-2 transition-colors text-sm"
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Filtros</span>
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  value={filtros.status}
                  onChange={(e) => {
                    setFiltros(prev => ({ ...prev, status: e.target.value }));
                    setPage(1);
                  }}
                  className="w-full px-2 sm:px-3 py-2 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Todos</option>
                  <option value="pendente">Pendente</option>
                  <option value="parcial">Parcial</option>
                  <option value="recebido">Recebido</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Fornecedor
                </label>
                <select
                  value={filtros.fornecedor_id}
                  onChange={(e) => {
                    setFiltros(prev => ({ ...prev, fornecedor_id: e.target.value }));
                    setPage(1);
                  }}
                  className="w-full px-2 sm:px-3 py-2 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Todos</option>
                  {fornecedores.map(fornecedor => (
                    <option key={fornecedor.id} value={fornecedor.id}>
                      {fornecedor.nome_fantasia}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Buscar
                </label>
                <div className="relative">
                  <Search className="absolute left-2 sm:left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={filtros.busca}
                    onChange={(e) => {
                      setFiltros(prev => ({ ...prev, busca: e.target.value }));
                      setPage(1);
                    }}
                    placeholder="Número..."
                    className="w-full pl-8 sm:pl-10 pr-2 sm:pr-3 py-2 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Conteúdo */}
        <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : pedidos.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 mx-auto mb-3 sm:mb-4" />
              <h3 className="text-base sm:text-lg font-medium text-gray-800 dark:text-white mb-2">
                Nenhum pedido encontrado
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-4">
                Crie seu primeiro pedido de compra
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 mx-auto transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Novo Pedido
              </button>
            </div>
          ) : (
            <div className="space-y-2 sm:space-y-3">
              {pedidos.map(pedido => (
                <CollapsibleSection
                  key={pedido.id}
                  title={pedido.numero_pedido}
                  icon={<Package className="w-4 h-4" />}
                  badge={getStatusBadge(pedido.status)}
                  defaultOpen={false}
                  variant="card"
                >
                  <div className="space-y-3 sm:space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 sm:p-3">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Fornecedor</p>
                        <p className="text-sm sm:text-base font-medium text-gray-800 dark:text-white truncate">
                          {pedido.fornecedor_nome}
                        </p>
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 sm:p-3">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Data do Pedido</p>
                        <p className="text-sm sm:text-base font-medium text-gray-800 dark:text-white">
                          {formatDate(pedido.data_pedido)}
                        </p>
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 sm:p-3">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total</p>
                        <p className="text-sm sm:text-base font-bold text-blue-600 dark:text-blue-400">
                          {formatCurrency(pedido.total)}
                        </p>
                      </div>

                      {pedido.data_previsao_entrega && (
                        <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 sm:p-3">
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Previsão</p>
                          <p className="text-sm sm:text-base font-medium text-gray-800 dark:text-white">
                            {formatDate(pedido.data_previsao_entrega)}
                          </p>
                        </div>
                      )}

                      {pedido.data_recebimento && (
                        <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 sm:p-3">
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Recebido em</p>
                          <p className="text-sm sm:text-base font-medium text-green-600 dark:text-green-400">
                            {formatDate(pedido.data_recebimento)}
                          </p>
                        </div>
                      )}

                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 sm:p-3">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Itens</p>
                        <p className="text-sm sm:text-base font-medium text-gray-800 dark:text-white">
                          {pedido.total_itens} {pedido.total_itens === 1 ? 'item' : 'itens'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      {(pedido.status === 'pendente' || pedido.status === 'parcial') && (
                        <button
                          onClick={() => handleReceivePedido(pedido)}
                          className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-2 transition-colors text-sm font-medium"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Receber
                        </button>
                      )}

                      <button
                        onClick={() => handleVerDetalhes(pedido)}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 transition-colors text-sm font-medium"
                      >
                        <Eye className="w-4 h-4" />
                        Detalhes
                      </button>
                    </div>
                  </div>
                </CollapsibleSection>
              ))}
            </div>
          )}
        </div>
      </ResponsiveModal>

      <PurchaseOrderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {
          loadPedidos();
          setShowCreateModal(false);
        }}
        fornecedores={fornecedores}
        initialSupplierId={initialSupplierId}
      />

      {selectedPedido && (
        <ReceivePurchaseModal
          isOpen={showReceiveModal}
          onClose={() => {
            setShowReceiveModal(false);
            setSelectedPedido(null);
          }}
          pedido={selectedPedido}
          onSuccess={() => {
            loadPedidos();
            setShowReceiveModal(false);
            setSelectedPedido(null);
          }}
        />
      )}

      {selectedPedido && (
        <PurchaseOrderDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedPedido(null);
          }}
          pedido={selectedPedido}
        />
      )}
    </>
  );
};

export default PurchaseOrdersPanel;
