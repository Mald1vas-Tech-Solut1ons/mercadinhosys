import React, { useState } from 'react';
import { Edit, Trash2, Archive, ShoppingCart, FileText, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Layers, PackageX, MoreHorizontal, History, Package, ZoomIn } from 'lucide-react';
import { Produto } from '../../../types';
import { formatCurrency } from '../../../utils/formatters';
import ImageZoomModal from '../../../components/ui/ImageZoomModal';

/** Miniatura do produto com fallback gracioso e zoom ao clicar — precisa de
 * estado próprio por linha (erro de carregamento), por isso vive em seu
 * próprio componente. Tamanho maior que o antigo (40px não revelava
 * detalhe nenhum em roupa/material de construção, onde a foto importa
 * mais pra reconhecer o item). */
const ProdutoThumb: React.FC<{ produto: Produto; size?: number; onZoom: (produto: Produto) => void }> = ({ produto, size = 56, onZoom }) => {
    const [erro, setErro] = useState(false);
    const imagemUrl = (produto as any).imagem_url;
    if (imagemUrl && !erro) {
        return (
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onZoom(produto); }}
                className="relative shrink-0 group/thumb"
                style={{ width: size, height: size }}
                title="Ampliar foto"
            >
                <img
                    src={imagemUrl}
                    alt={produto.nome}
                    loading="lazy"
                    onError={() => setErro(true)}
                    style={{ width: size, height: size }}
                    className="rounded-lg object-cover border border-gray-200 dark:border-slate-700 bg-white transition-transform group-hover/thumb:scale-105"
                />
                <span className="absolute inset-0 rounded-lg bg-black/0 group-hover/thumb:bg-black/30 flex items-center justify-center transition-colors">
                    <ZoomIn className="w-4 h-4 text-gray-900 dark:text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
                </span>
            </button>
        );
    }
    return (
        <div
            style={{ width: size, height: size }}
            className="shrink-0 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center"
        >
            <Package className="text-gray-400 dark:text-slate-500" size={Math.round(size * 0.45)} />
        </div>
    );
};

export interface LinhaProdutoLote {
    produto: Produto & { lotes_no_periodo?: Array<{ id: number | null; numero_lote: string; data_validade: string | null; quantidade: number; preco_venda: number | null; preco_produto: number }> };
    lote: { id: number | null; numero_lote: string; data_validade: string | null; quantidade: number; preco_venda: number | null; preco_produto: number } | null;
}

interface ProductsTableProps {
    produtos: Produto[];
    linhasPorLote?: LinhaProdutoLote[];
    loading: boolean;
    totalItems: number;
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onEdit: (produto: Produto) => void;
    onDelete: (id: number) => void;
    onStockAdjust: (produto: Produto) => void;
    onHistory: (produto: Produto) => void;
    onMakeOrder: (produto: Produto) => void;
    onDiscard: (produto: Produto) => void;
    onViewLotes?: (produto: Produto) => void;
    onProductClick?: (produto: Produto) => void;
    onSort?: (key: string) => void;
    sortConfig?: { key: string; direction: 'asc' | 'desc' };
}

export const ProductsTable: React.FC<ProductsTableProps> = ({
    produtos = [],
    linhasPorLote,
    loading,
    totalItems,
    page,
    totalPages,
    onPageChange,
    onEdit,
    onDelete,
    onStockAdjust,
    onHistory,
    onMakeOrder,
    onDiscard,
    onViewLotes,
    onProductClick,
    onSort,
    sortConfig,
}) => {
    const [produtoZoom, setProdutoZoom] = useState<Produto | null>(null);

    const SortIcon = ({ columnKey }: { columnKey: string }) => {
        if (!sortConfig || sortConfig.key !== columnKey) {
            return <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-gray-400 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />;
        }
        return sortConfig.direction === 'asc' ?
            <ArrowUp className="w-3.5 h-3.5 ml-1 text-blue-500" /> :
            <ArrowDown className="w-3.5 h-3.5 ml-1 text-blue-500" />;
    };

    const handleSort = (key: string) => {
        if (onSort) onSort(key);
    };

    const getStockBadge = (produto: Produto) => {
        if (produto.quantidade <= 0) return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
        if (produto.quantidade <= produto.quantidade_minima) return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    };

    const getStockLabel = (produto: Produto) => {
        if (produto.quantidade <= 0) return 'Esgotado';
        if (produto.quantidade <= produto.quantidade_minima) return 'Baixo';
        return 'Normal';
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-24 bg-gray-50 dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800">
                <div className="relative w-12 h-12">
                    <div className="absolute inset-0 border-t-2 border-blue-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-2 border-r-2 border-emerald-500 rounded-full animate-spin reverse"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="overflow-x-auto hidden lg:block">
                <table className="w-full text-left border-collapse whitespace-nowrap min-w-[1000px]">
                    <thead className="bg-gray-50 dark:bg-slate-900/90 backdrop-blur-sm sticky top-0 z-10 border-b border-gray-200 dark:border-slate-800">
                        <tr>
                            <th 
                                className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-gray-900 dark:text-white transition-colors group"
                                onClick={() => handleSort('nome')}
                            >
                                <div className="flex items-center">
                                    Produto
                                    <SortIcon columnKey="nome" />
                                </div>
                            </th>
                            <th 
                                className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-gray-900 dark:text-white transition-colors group"
                                onClick={() => handleSort('quantidade')}
                            >
                                <div className="flex items-center">
                                    Estoque
                                    <SortIcon columnKey="quantidade" />
                                </div>
                            </th>
                            <th className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                            <th className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Lote</th>
                            <th 
                                className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-gray-900 dark:text-white transition-colors group"
                                onClick={() => handleSort('data_validade')}
                            >
                                <div className="flex items-center">
                                    Validade
                                    <SortIcon columnKey="data_validade" />
                                </div>
                            </th>
                            <th 
                                className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-gray-900 dark:text-white transition-colors group text-right"
                                onClick={() => handleSort('preco_custo')}
                            >
                                <div className="flex items-center justify-end">
                                    Custo
                                    <SortIcon columnKey="preco_custo" />
                                </div>
                            </th>
                            <th 
                                className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-gray-900 dark:text-white transition-colors group text-right"
                                onClick={() => handleSort('preco_venda')}
                            >
                                <div className="flex items-center justify-end">
                                    Venda
                                    <SortIcon columnKey="preco_venda" />
                                </div>
                            </th>
                            <th 
                                className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-gray-900 dark:text-white transition-colors group text-right"
                                onClick={() => handleSort('margem_lucro')}
                            >
                                <div className="flex items-center justify-end">
                                    Margem
                                    <SortIcon columnKey="margem_lucro" />
                                </div>
                            </th>
                            <th className="px-5 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider text-right">
                                {/* Placeholder for actions */}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {(produtos || []).map((produto) => (
                            <tr key={produto.id} className="hover:bg-white dark:hover:bg-slate-800/50 transition-colors group cursor-pointer" onClick={(e) => {
                                // Prevent navigating if clicking on buttons
                                const target = e.target as HTMLElement;
                                if (!target.closest('.actions-container')) {
                                    onProductClick?.(produto);
                                }
                            }}>
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <ProdutoThumb produto={produto} onZoom={setProdutoZoom} />
                                    <div className="min-w-0">
                                    <div className="font-semibold text-gray-700 dark:text-slate-200">
                                        {produto.nome}
                                        {produto.ativo === false && (
                                            <span className="ml-2 px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] uppercase tracking-wider font-bold">
                                                Inativo
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 flex items-center gap-2">
                                        <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400">{produto.categoria}</span>
                                        {produto.codigo_barras && <span>{produto.codigo_barras}</span>}
                                    </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-5 py-3 tabular-nums font-medium text-gray-600 dark:text-slate-300">
                                    {produto.quantidade} <span className="text-xs text-gray-400 dark:text-slate-500">{produto.unidade_medida}</span>
                                </td>
                                <td className="px-5 py-3">
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStockBadge(produto)}`}>
                                        {getStockLabel(produto)}
                                    </span>
                                </td>
                                <td className="px-5 py-3">
                                    {produto.lote ? (
                                        <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono text-[10px] uppercase tracking-wider">
                                            {produto.lote}
                                        </span>
                                    ) : (
                                        <span className="text-gray-400 dark:text-slate-600">-</span>
                                    )}
                                </td>
                                <td className="px-5 py-3 text-sm">
                                    {produto.data_validade ? (
                                        (() => {
                                            const hoje = new Date();
                                            const validade = new Date(produto.data_validade);
                                            const dias = Math.floor((validade.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

                                            if (dias < 0) {
                                                return (
                                                    <div className="flex flex-col">
                                                        <span className="text-rose-500 font-medium tabular-nums">{new Date(produto.data_validade).toLocaleDateString('pt-BR')}</span>
                                                        <span className="text-[9px] text-rose-500/70 uppercase tracking-widest font-bold">Vencido</span>
                                                    </div>
                                                );
                                            }
                                            if (dias <= 30) {
                                                return (
                                                    <div className="flex flex-col">
                                                        <span className="text-amber-500 font-medium tabular-nums">{new Date(produto.data_validade).toLocaleDateString('pt-BR')}</span>
                                                        <span className="text-[9px] text-amber-500/70 uppercase tracking-widest font-bold">{dias} Dias</span>
                                                    </div>
                                                );
                                            }
                                            return (
                                                <div className="flex flex-col">
                                                    <span className="text-emerald-500 font-medium tabular-nums">
                                                        {new Date(produto.data_validade).toLocaleDateString('pt-BR')}
                                                    </span>
                                                    <span className="text-[9px] text-emerald-500/70 uppercase tracking-widest font-bold">No Prazo</span>
                                                </div>
                                            );
                                        })()
                                    ) : (
                                        <span className="text-gray-400 dark:text-slate-600">-</span>
                                    )}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums text-gray-500 dark:text-slate-400 font-medium">
                                    {formatCurrency(produto.preco_custo)}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums text-gray-900 dark:text-white font-bold">
                                    {formatCurrency(produto.preco_venda)}
                                </td>
                                <td className="px-5 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <span className={`font-semibold tabular-nums ${(produto.margem_lucro || 0) >= 30 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            {(produto.margem_lucro || 0).toFixed(1)}%
                                        </span>
                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: (produto.margem_lucro || 0) >= 30 ? '#10b981' : '#f59e0b' }}></div>
                                    </div>
                                </td>
                                <td className="px-5 py-3 text-right actions-container relative">
                                    <div className="flex justify-end opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
                                        <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-lg border border-gray-200 dark:border-slate-700 shadow-xl">
                                            <button onClick={() => onMakeOrder(produto)} className="p-2 md:p-1.5 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center" title="Fazer Pedido">
                                                <ShoppingCart className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => onStockAdjust(produto)} className="p-2 md:p-1.5 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center" title="Ajustar Estoque">
                                                <Archive className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => onEdit(produto)} className="p-2 md:p-1.5 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center" title="Editar">
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            
                                            {/* Dropdown for secondary actions if needed, or just keep them inline for now */}
                                            <div className="w-px h-4 bg-gray-100 dark:bg-slate-700 mx-1"></div>
                                            
                                            {onViewLotes && (
                                                <button onClick={() => onViewLotes(produto)} className="p-2 md:p-1.5 text-gray-500 dark:text-slate-400 hover:text-purple-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center" title="Ver Lotes (FIFO)">
                                                    <Layers className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button onClick={() => onHistory(produto)} className="p-2 md:p-1.5 text-gray-500 dark:text-slate-400 hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center" title="Histórico">
                                                <FileText className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => onDiscard(produto)} className="p-2 md:p-1.5 text-gray-500 dark:text-slate-400 hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center" title="Descartar (Prejuízo)">
                                                <PackageX className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => onDelete(produto.id)} className="p-2 md:p-1.5 text-gray-500 dark:text-slate-400 hover:text-rose-500 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center" title="Excluir">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                    {/* Small dots icon when not hovered to indicate actions exist */}
                                    <div className="hidden md:flex justify-end opacity-100 group-hover:opacity-0 transition-opacity duration-200 absolute right-8 mt-[-10px]">
                                        <MoreHorizontal className="w-5 h-5 text-gray-400 dark:text-slate-600" />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Visualização em Cards (Mobile) */}
            <div className="lg:hidden flex flex-col gap-4 p-4">
                {(produtos || []).length === 0 ? (
                    <div className="text-center text-gray-400 dark:text-slate-500 py-8 italic font-semibold">Nenhum produto encontrado.</div>
                ) : (
                    (produtos || []).map((produto) => (
                        <div key={produto.id} className="bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700/50 rounded-xl p-4 flex flex-col gap-4 relative cursor-pointer hover:bg-white dark:hover:bg-slate-800 transition-colors active:scale-[0.99]" onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (!target.closest('.actions-container-mobile')) {
                                onProductClick?.(produto);
                            }
                        }}>
                            <div className="flex justify-between items-start">
                                <div className="flex-1 pr-4 flex items-start gap-3">
                                  <ProdutoThumb produto={produto} size={52} onZoom={setProdutoZoom} />
                                  <div className="min-w-0 flex-1">
                                    <h4 className="font-bold text-gray-700 dark:text-slate-200 text-lg leading-tight">{produto.nome}</h4>
                                    <div className="text-xs text-gray-500 dark:text-slate-400 mt-1 flex items-center gap-2">
                                        <span className="px-1.5 py-0.5 rounded bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300">{produto.categoria}</span>
                                        {produto.codigo_barras && <span className="font-mono text-gray-400 dark:text-slate-500">{produto.codigo_barras}</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStockBadge(produto)} whitespace-nowrap`}>
                                        {getStockLabel(produto)}
                                    </span>
                                    <ChevronRight className="w-5 h-5 text-gray-400 dark:text-slate-500" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="flex flex-col bg-gray-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-gray-200 dark:border-slate-800">
                                    <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-slate-500 tracking-wider">Estoque</span>
                                    <span className="font-semibold text-gray-700 dark:text-slate-200">{produto.quantidade} <span className="text-xs text-gray-500 dark:text-slate-400 font-normal">{produto.unidade_medida}</span></span>
                                </div>
                                <div className="flex flex-col bg-gray-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-gray-200 dark:border-slate-800">
                                    <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-slate-500 tracking-wider">Venda</span>
                                    <span className="font-bold text-emerald-400">{formatCurrency(produto.preco_venda)}</span>
                                </div>
                                <div className="flex flex-col bg-gray-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-gray-200 dark:border-slate-800">
                                    <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-slate-500 tracking-wider">Lote / Validade</span>
                                    <span className="font-medium text-gray-600 dark:text-slate-300">
                                        {produto.lote ? <span className="text-blue-400">{produto.lote}</span> : '-'} / {produto.data_validade ? new Date(produto.data_validade).toLocaleDateString('pt-BR') : '-'}
                                    </span>
                                </div>
                                <div className="flex flex-col bg-gray-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-gray-200 dark:border-slate-800">
                                    <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-slate-500 tracking-wider">Margem</span>
                                    <span className={`font-bold ${(produto.margem_lucro || 0) >= 30 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {(produto.margem_lucro || 0).toFixed(1)}%
                                    </span>
                                </div>
                            </div>

                            <div className="actions-container-mobile grid grid-cols-4 gap-2 pt-3 border-t border-gray-200 dark:border-slate-700/50 mt-1">
                                <button onClick={() => onEdit(produto)} className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-100 dark:bg-slate-700/30 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white transition-colors active:scale-95" title="Editar">
                                    <Edit className="w-5 h-5 mb-1" />
                                    <span className="text-[9px] font-bold uppercase">Editar</span>
                                </button>
                                <button onClick={() => onStockAdjust(produto)} className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-100 dark:bg-slate-700/30 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white transition-colors active:scale-95" title="Estoque">
                                    <Archive className="w-5 h-5 mb-1" />
                                    <span className="text-[9px] font-bold uppercase">Estoque</span>
                                </button>
                                <button onClick={() => onDiscard(produto)} className="flex flex-col items-center justify-center p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-gray-900 dark:text-white transition-colors active:scale-95 border border-rose-500/20" title="Descartar">
                                    <PackageX className="w-5 h-5 mb-1" />
                                    <span className="text-[9px] font-bold uppercase">Descartar</span>
                                </button>
                                <button onClick={() => onHistory(produto)} className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-100 dark:bg-slate-700/30 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:text-white transition-colors active:scale-95" title="Histórico">
                                    <History className="w-5 h-5 mb-1" />
                                    <span className="text-[9px] font-bold uppercase">Histórico</span>
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>


            {/* Pagination - Sleek Dark */}
            <div className="flex items-center justify-between px-6 py-4 bg-gray-50 dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800">
                <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    {linhasPorLote && linhasPorLote.length > 0
                        ? `Exibindo ${linhasPorLote.length} de ${produtos.length}`
                        : `Mostrando ${produtos.length} de ${totalItems} registros`}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onPageChange(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="p-2 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 dark:hover:text-slate-400 transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-4 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-semibold text-gray-700 dark:text-slate-200 tabular-nums">
                        {page} / {totalPages}
                    </span>
                    <button
                        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                        disabled={page === totalPages}
                        className="p-2 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 dark:hover:text-slate-400 transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <ImageZoomModal
                src={produtoZoom ? (produtoZoom as any).imagem_url : null}
                alt={produtoZoom?.nome}
                onClose={() => setProdutoZoom(null)}
            />
        </div>
    );
};
