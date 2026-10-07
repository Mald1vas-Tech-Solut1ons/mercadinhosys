import React from 'react';
import { createPortal } from 'react-dom';
import { X, Package, Calendar, Truck, DollarSign, User, FileText } from 'lucide-react';
import { PedidoCompra, PedidoCompraItem } from '../purchaseOrderService';
import { formatCurrency, formatDate } from '../../../utils/formatters';

interface PurchaseOrderDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    pedido: PedidoCompra | null;
    onReceiveClick?: (pedido: PedidoCompra) => void;
    onPayClick?: (pedido: PedidoCompra) => void;
}

const PurchaseOrderDetailsModal: React.FC<PurchaseOrderDetailsModalProps> = ({
    isOpen,
    onClose,
    pedido,
    onReceiveClick,
    onPayClick
}) => {
    if (!isOpen || !pedido) return null;

    return createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-210 p-0 sm:p-4">
            <div className="bg-white dark:bg-gray-800 sm:rounded-xl shadow-2xl w-full max-w-4xl h-full sm:h-auto max-h-dvh sm:max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 shrink-0" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                            <Package className="w-6 h-6 text-blue-600 dark:text-blue-300" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                                Pedido {pedido.numero_pedido}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Criado em {formatDate(pedido.data_pedido)}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Status Bar */}
                    <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className={`px-3 py-1 rounded-full text-sm font-medium ${pedido.status === 'recebido'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                            : pedido.status === 'cancelado'
                                ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
                            }`}>
                            {pedido.status.toUpperCase()}
                        </div>
                        {pedido.data_previsao_entrega && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <Truck className="w-4 h-4" />
                                <span>Previsão: {formatDate(pedido.data_previsao_entrega)}</span>
                            </div>
                        )}
                        {pedido.data_recebimento && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <Calendar className="w-4 h-4" />
                                <span>Recebido: {formatDate(pedido.data_recebimento)}</span>
                            </div>
                        )}
                    </div>

                    {/* Info Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                                <Truck className="w-4 h-4" /> Fornecedor
                            </h3>
                            <div className="p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
                                <p className="font-medium text-gray-900 dark:text-white">{pedido.fornecedor_nome}</p>
                                {pedido.fornecedor && (
                                    <>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{pedido.fornecedor.cnpj}</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">{pedido.fornecedor.email}</p>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                                <User className="w-4 h-4" /> Solicitante
                            </h3>
                            <div className="p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
                                <p className="font-medium text-gray-900 dark:text-white">{pedido.funcionario_nome || 'N/A'}</p>
                                {pedido.funcionario && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{pedido.funcionario.cargo || 'Funcionário'}</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Items Table */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                            <Package className="w-4 h-4" /> Itens do Pedido
                        </h3>
                        <div className="space-y-3">
                            {pedido.itens?.map((item: PedidoCompraItem) => (
                                <div key={item.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm flex flex-col gap-2">
                                    <div className="flex justify-between items-start gap-3">
                                        {item.produto?.imagem_url && (
                                            <img src={item.produto.imagem_url} alt={item.produto_nome} className="w-12 h-12 object-cover rounded-lg border border-gray-200 dark:border-gray-700 shrink-0" />
                                        )}
                                        <div className="flex-1">
                                            <h4 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base leading-tight">
                                                {item.produto_nome}
                                            </h4>
                                            {item.produto?.codigo_barras && (
                                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                                                    EAN: {item.produto.codigo_barras}
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-sm font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded shrink-0">
                                            {formatCurrency(item.total_item)}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                                        <div className="flex flex-col">
                                            <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px] font-bold tracking-wider">Solicitado</span>
                                            <span className="font-medium text-gray-800 dark:text-gray-200">{item.quantidade_solicitada} {item.produto_unidade}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px] font-bold tracking-wider">Recebido</span>
                                            <span className={`font-medium ${item.quantidade_recebida && item.quantidade_recebida < item.quantidade_solicitada ? 'text-orange-600' : item.quantidade_recebida === item.quantidade_solicitada ? 'text-green-600' : 'text-gray-500'}`}>
                                                {item.quantidade_recebida || '-'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px] font-bold tracking-wider">Preço Unit.</span>
                                            <span className="font-medium">{formatCurrency(item.preco_unitario)}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px] font-bold tracking-wider">Desconto</span>
                                            <span className="font-medium">{item.desconto_percentual}%</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Totais do Pedido */}
                        <div className="mt-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700 space-y-2">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-600 dark:text-gray-400 font-medium">Subtotal</span>
                                <span className="text-gray-900 dark:text-white">{formatCurrency(pedido.subtotal)}</span>
                            </div>
                            {pedido.desconto > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-green-600 font-medium">Desconto</span>
                                    <span className="text-green-600">-{formatCurrency(pedido.desconto)}</span>
                                </div>
                            )}
                            {pedido.frete > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-orange-600 font-medium">Frete</span>
                                    <span className="text-orange-600">+{formatCurrency(pedido.frete)}</span>
                                </div>
                            )}
                            <div className="pt-2 mt-2 border-t border-gray-200 dark:border-gray-600 flex justify-between items-center">
                                <span className="text-base font-bold text-gray-900 dark:text-white">Total</span>
                                <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{formatCurrency(pedido.total)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Observations & Payment Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {pedido.observacoes && (
                            <div className="bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
                                <h3 className="text-sm font-bold text-yellow-800 dark:text-yellow-200 mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4" /> Observações
                                </h3>
                                <p className="text-sm text-yellow-800 dark:text-yellow-200 whitespace-pre-line">
                                    {pedido.observacoes}
                                </p>
                            </div>
                        )}

                        <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                            <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-2 flex items-center gap-2">
                                <DollarSign className="w-4 h-4" /> Pagamento
                            </h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600 dark:text-gray-400">Condição:</span>
                                    <span className="font-medium text-gray-900 dark:text-white">{pedido.condicao_pagamento || 'N/A'}</span>
                                </div>
                                {pedido.numero_nota_fiscal && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-600 dark:text-gray-400">Nota Fiscal:</span>
                                        <span className="font-medium text-gray-900 dark:text-white">{pedido.numero_nota_fiscal} (Série: {pedido.serie_nota_fiscal})</span>
                                    </div>
                                )}
                                {/* Exibir info do Boleto (conta a pagar) se existir */}
                                {(pedido as any).conta_pagar && (
                                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-semibold text-gray-800 dark:text-white">Boleto / Conta a Pagar</span>
                                            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${(pedido as any).conta_pagar.status === 'pago' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                {(pedido as any).conta_pagar.status.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-gray-600 dark:text-gray-400">
                                            <span>Vencimento:</span>
                                            <span className={`font-medium ${
                                                (pedido as any).conta_pagar.status !== 'pago' && new Date((pedido as any).conta_pagar.data_vencimento) < new Date() 
                                                    ? 'text-red-600' 
                                                    : 'text-gray-900 dark:text-white'
                                            }`}>
                                                {formatDate((pedido as any).conta_pagar.data_vencimento)}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 shrink-0" style={{ paddingBottom: 'max(1.5rem, calc(1rem + env(safe-area-inset-bottom)))' }}>
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded-lg transition-colors font-medium"
                    >
                        Fechar
                    </button>
                    {pedido.status === 'pendente' && onReceiveClick && (
                        <button
                            onClick={() => {
                                onClose();
                                onReceiveClick(pedido);
                            }}
                            className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-medium flex items-center gap-2"
                        >
                            <Truck className="w-4 h-4" /> Receber Pedido
                        </button>
                    )}
                    {pedido.status !== 'pendente' && (pedido as any).conta_pagar && (pedido as any).conta_pagar.status !== 'pago' && onPayClick && (
                        <button
                            onClick={() => {
                                onClose();
                                onPayClick(pedido);
                            }}
                            className="px-6 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors font-medium flex items-center gap-2"
                        >
                            <DollarSign className="w-4 h-4" /> Pagar Boleto
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default PurchaseOrderDetailsModal;
