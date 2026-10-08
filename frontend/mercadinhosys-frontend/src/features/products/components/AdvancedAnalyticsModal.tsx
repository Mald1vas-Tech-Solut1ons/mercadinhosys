import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, BarChart3, Zap, Clock, TrendingDown } from 'lucide-react';
import { Produto } from '../../../types';
import { productsService } from '../productsService';
import { formatCurrency } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';

interface AdvancedAnalyticsModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: string; // 'abc_a', 'abc_b', 'abc_c', 'giro_rapido', 'giro_normal', 'giro_lento'
}

const AdvancedAnalyticsModal: React.FC<AdvancedAnalyticsModalProps> = ({ isOpen, onClose, type }) => {
    const [loading, setLoading] = useState(false);
    const [produtosFiltrados, setProdutosFiltrados] = useState<Produto[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        if (isOpen && type) {
            carregarProdutos();
        }
    }, [isOpen, type]);

    const carregarProdutos = async () => {
        try {
            setLoading(true);
            
            let targetFilter = '';
            if (type === 'abc_a') targetFilter = 'classe_a';
            else if (type === 'abc_b') targetFilter = 'classe_b';
            else if (type === 'abc_c') targetFilter = 'classe_c';
            else if (type === 'giro_rapido') targetFilter = 'giro_rapido';
            else if (type === 'giro_normal') targetFilter = 'giro_normal';
            else if (type === 'giro_lento') targetFilter = 'giro_lento';
            
            const response = await productsService.getAllEstoque(1, 100, {
                filtro_rapido: targetFilter || undefined,
                estoque_status: type === 'alerta_cobertura' ? 'baixo' : undefined,
                ordenar_por: type.startsWith('abc_') ? 'total_vendido' : 'quantidade',
                direcao: type.startsWith('abc_') ? 'desc' : 'asc'
            });
            const allProducts = response.produtos || [];
            
            let filtered = [...allProducts];

            if (type.startsWith('giro_') || type === 'alerta_cobertura') {
                // FONTE ÚNICA: usa vmd/cobertura_dias vindos do backend (janela de
                // 90d, ledger real). Antes o modal reimplementava a matemática no
                // cliente com a coluna denormalizada e created_at, divergindo do card
                // que o abriu. Agora card = lista = modal = Hub.
                filtered.forEach(p => {
                    const vmd = (p as any).vmd ?? 0;
                    const cobertura = (p as any).cobertura_dias;
                    (p as any)._vmd_calc = vmd;
                    (p as any)._cobertura_calc = (cobertura === null || cobertura === undefined) ? 999 : cobertura;
                });

                filtered.sort((a, b) => (a as any)._cobertura_calc - (b as any)._cobertura_calc);

                if (type === 'alerta_cobertura') {
                    filtered = filtered.filter(p => (p as any)._cobertura_calc <= 10);
                }
            }

            setProdutosFiltrados(filtered);
        } catch (error) {
            console.error('Erro ao carregar produtos avançados:', error);
            showToast.error('Erro ao carregar lista de produtos');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const titulos: Record<string, string> = {
        'abc_a': 'Produtos Classe A (80% Faturamento)',
        'abc_b': 'Produtos Classe B (15% Faturamento)',
        'abc_c': 'Produtos Classe C (5% Faturamento)',
        'giro_rapido': 'Giro Rápido (Cobertura de até 15 dias)',
        'giro_normal': 'Giro Normal (Cobertura de 16 a 60 dias)',
        'giro_lento': 'Giro Lento (Cobertura acima de 60 dias)',
        'alerta_cobertura': 'Estoque Crítico (Menos de 11 dias de cobertura)'
    };

    const isABC = type.startsWith('abc_');
    const isGiro = type.startsWith('giro_');
    const headerColor = isABC ? 'bg-blue-100 text-blue-600' : (type === 'alerta_cobertura' ? 'bg-red-100 text-red-600' : 'bg-purple-100 text-purple-600');
    const Icon = isABC ? BarChart3 : (type === 'alerta_cobertura' ? TrendingDown : (type === 'giro_rapido' ? Zap : (type === 'giro_normal' ? Clock : TrendingDown)));

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100 p-4 animate-in fade-in duration-300" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden border border-gray-100 dark:border-gray-700">
                {/* Header */}
                <div className="p-6 border-b dark:border-gray-700 flex items-center justify-between bg-linear-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${headerColor}`}>
                            <Icon className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{titulos[type] || 'Análise de Produtos'}</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total de {produtosFiltrados.length} produtos listados nesta categoria.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <X className="w-6 h-6 text-gray-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-gray-500 font-medium">Analisando dados...</p>
                        </div>
                    ) : produtosFiltrados.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-full mb-4">
                                <Icon className="w-10 h-10 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">Nenhum produto nesta categoria</h3>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider border-b dark:border-gray-700">
                                <div className="col-span-5">Produto</div>
                                <div className="col-span-2 text-right">Estoque</div>
                                <div className="col-span-2 text-right">Preço Venda</div>
                                <div className="col-span-3 text-right">Métrica Relevante</div>
                            </div>
                            {produtosFiltrados.map((p, idx) => {
                                return (
                                    <div key={`p-${p.id}-${idx}`} 
                                         onClick={() => {
                                             onClose();
                                             navigate(`/products/${p.id}`);
                                         }}
                                         className="flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-4 items-start md:items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all border border-transparent hover:border-blue-300 cursor-pointer">
                                        <div className="w-full md:col-span-5 flex flex-col md:block">
                                            <p className="font-bold text-gray-900 dark:text-white truncate text-base md:text-sm">{p.nome}</p>
                                            <p className="text-xs text-gray-500 mt-0.5 md:mt-0">
                                                {p.categoria} | Código: {p.codigo_barras || p.id}
                                            </p>
                                        </div>
                                        
                                        <div className="w-full grid grid-cols-3 gap-2 md:contents">
                                            <div className="flex flex-col md:block md:col-span-2 md:text-right bg-white dark:bg-gray-800 md:bg-transparent p-2 rounded-lg md:p-0 md:rounded-none border border-gray-100 dark:border-gray-700 md:border-none">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 md:hidden mb-1 block">Estoque</span>
                                                <p className={`text-sm font-bold ${p.quantidade <= 0 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                                                    {p.quantidade} <span className="text-xs font-normal text-gray-500 md:hidden">{p.unidade_medida}</span><span className="hidden md:inline">{p.unidade_medida}</span>
                                                </p>
                                            </div>
                                            
                                            <div className="flex flex-col md:block md:col-span-2 md:text-right bg-white dark:bg-gray-800 md:bg-transparent p-2 rounded-lg md:p-0 md:rounded-none border border-gray-100 dark:border-gray-700 md:border-none">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 md:hidden mb-1 block">Preço</span>
                                                <p className="text-sm font-medium text-green-600 dark:text-green-400">{formatCurrency(p.preco_venda)}</p>
                                            </div>
                                            
                                            <div className="flex flex-col md:block md:col-span-3 md:text-right bg-white dark:bg-gray-800 md:bg-transparent p-2 rounded-lg md:p-0 md:rounded-none border border-gray-100 dark:border-gray-700 md:border-none">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 md:hidden mb-1 block">Métrica</span>
                                                {isABC ? (
                                                    <div className="flex flex-col md:items-end">
                                                        <span className="text-sm font-bold text-blue-600 truncate">Fat: {formatCurrency(p.total_vendido || 0)}</span>
                                                    </div>
                                                ) : (isGiro || type === 'alerta_cobertura') ? (
                                                    <div className="flex flex-col md:items-end">
                                                        <span className={`text-sm font-bold ${(p as any)._cobertura_calc <= 10 ? 'text-red-600' : 'text-purple-600'}`}>
                                                            Cob: {(p as any)._cobertura_calc === 999 ? 'Infinito' : `${Math.ceil((p as any)._cobertura_calc)}d`}
                                                        </span>
                                                        <span className="text-[10px] md:text-xs text-gray-500 truncate">
                                                            VMD: {((p as any)._vmd_calc || 0).toFixed(1)}/dia
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col md:items-end">
                                                        <span className="text-sm font-medium text-purple-600 truncate">
                                                            {p.ultima_venda ? new Date(p.ultima_venda).toLocaleDateString('pt-BR') : 'Nunca'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-between items-center">
                    <p className="text-xs text-gray-500 italic">
                        {isABC ? '* A Classificação ABC é baseada no faturamento (preço x vendas).' : '* O Giro de Estoque é baseado na cobertura em dias considerando a Venda Média Diária.'}
                    </p>
                    <button onClick={onClose} className="px-6 py-2 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-all">
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdvancedAnalyticsModal;
