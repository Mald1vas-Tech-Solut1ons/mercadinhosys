import { TrendingUp, DollarSign, Clock, Users, BarChart3, Package, Calendar, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Produto } from '../../../types';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { apiClient } from '../../../api/apiClient';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';

interface ProductHistoryModalProps {
    produto: Produto;
    onClose: () => void;
}

interface HistoricoPreco {
    id: number;
    data_alteracao: string;
    preco_custo_anterior: number;
    preco_custo_novo: number;
    preco_venda_anterior: number;
    preco_venda_novo: number;
    margem_anterior: number;
    margem_nova: number;
    motivo: string;
    funcionario_nome?: string;
}

interface VendaHistoricoDetailed {
    data: string;
    quantidade: number;
    valor_total: number;
    numero_vendas: number;
    ticket_medio: number;
}

interface EstatisticasVendas {
    total_vendido_90d: number;
    faturamento_90d: number;
    dias_com_venda: number;
    dias_sem_venda: number;
    media_diaria: number;
    ticket_medio: number;
}

interface FornecedorInfo {
    id: number;
    razao_social: string;
    nome_fantasia?: string;
    cnpj: string;
    email?: string;
    telefone?: string;
    cidade?: string;
    estado?: string;
}

const ProductHistoryModal = ({ produto, onClose }: ProductHistoryModalProps) => {
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'vendas' | 'precos' | 'estoque' | 'fornecedor'>('vendas');
    const [historicoPrecos, setHistoricoPrecos] = useState<HistoricoPreco[]>([]);
    const [vendasHistorico, setVendasHistorico] = useState<VendaHistoricoDetailed[]>([]);
    const [estatisticasVendas, setEstatisticasVendas] = useState<EstatisticasVendas | null>(null);
    const [fornecedorInfo, setFornecedorInfo] = useState<FornecedorInfo | null>(null);
    const [, setUltimaCompra] = useState<any | null>(null);
    const [historicoCompras, setHistoricoCompras] = useState<any[]>([]);
    const [movimentacoesEstoque, setMovimentacoesEstoque] = useState<any[]>([]);

    useEffect(() => {
        loadData();
    }, [produto.id]);

    const loadData = async () => {
        try {
            setLoading(true);

            // TODAS as requisições em paralelo. Antes eram 5 awaits em cascata:
            // o modal levava a SOMA das latências (segundos no banco remoto)
            // para abrir; agora leva o tempo da mais lenta.
            const [precosRes, vendasRes, prodRes, fornecedorRes, pedidosRes] = await Promise.allSettled([
                apiClient.get(`/produtos/${produto.id}/historico-precos`),
                apiClient.get(`/produtos/${produto.id}/vendas-historico`),
                apiClient.get(`/produtos/${produto.id}`),
                produto.fornecedor_id
                    ? apiClient.get(`/fornecedores/${produto.fornecedor_id}`)
                    : Promise.reject(new Error('sem fornecedor')),
                produto.fornecedor_id
                    ? apiClient.get('/pedidos-compra/', { params: { fornecedor_id: produto.fornecedor_id, per_page: 5 } })
                    : Promise.reject(new Error('sem fornecedor')),
            ]);

            if (precosRes.status === 'fulfilled') {
                setHistoricoPrecos(precosRes.value.data.historico || []);
            } else {
                console.error('Erro ao carregar histórico de preços:', precosRes.reason);
                setHistoricoPrecos([]);
            }

            if (vendasRes.status === 'fulfilled') {
                setVendasHistorico(vendasRes.value.data.historico || []);
                setEstatisticasVendas(vendasRes.value.data.estatisticas || null);
            } else {
                console.error('Erro ao carregar histórico de vendas:', vendasRes.reason);
                setVendasHistorico([]);
                setEstatisticasVendas(null);
            }

            let prodData: any = null;
            if (prodRes.status === 'fulfilled') {
                prodData = prodRes.value.data;
                setMovimentacoesEstoque(prodData.movimentacoes || []);
            } else {
                console.error('Erro ao carregar movimentações:', prodRes.reason);
                setMovimentacoesEstoque([]);
            }

            if (produto.fornecedor_id) {
                if (fornecedorRes.status === 'fulfilled') {
                    setFornecedorInfo(fornecedorRes.value.data.fornecedor || fornecedorRes.value.data);
                } else {
                    console.error('Erro ao carregar fornecedor:', fornecedorRes.reason);
                    setFornecedorInfo(null);
                }
                if (pedidosRes.status === 'fulfilled') {
                    setUltimaCompra(pedidosRes.value.data.pedidos?.[0] || null);
                    setHistoricoCompras(pedidosRes.value.data.pedidos || []);
                } else {
                    console.error('Erro ao carregar última compra:', pedidosRes.reason);
                    setUltimaCompra(null);
                    setHistoricoCompras([]);
                }
            } else {
                // Tenta usar o fornecedor mapeado via pedidos_compra pelo backend
                setFornecedorInfo(prodData?.produto?.fornecedor || null);
                setUltimaCompra(null);
            }
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
        } finally {
            setLoading(false);
        }
    };

    const calcularDiasDesdeUltimaVenda = () => {
        if (!produto.ultima_venda) return null;
        const hoje = new Date();
        const ultimaVenda = new Date(produto.ultima_venda);
        return Math.floor((hoje.getTime() - ultimaVenda.getTime()) / (1000 * 60 * 60 * 24));
    };

    const diasDesdeUltimaVenda = calcularDiasDesdeUltimaVenda();

    return (
        <ResponsiveModal
            isOpen={true}
            onClose={onClose}
            title={produto.nome}
            subtitle={`${produto.categoria} • ${produto.codigo_barras || 'Sem código'}`}
            headerIcon={<Clock className="w-6 h-6" />}
            headerColor="indigo"
            size="xl"
            footer={
                <button
                    onClick={onClose}
                    className="px-8 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-white rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-all border border-gray-200 dark:border-gray-600"
                >
                    Fechar
                </button>
            }
        >
            <div className="space-y-6">
                <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-none items-center -mx-1 px-1">
                    <button
                        onClick={() => setActiveTab('vendas')}
                        className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'vendas'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 hover:bg-gray-100'
                            }`}
                    >
                        <TrendingUp className="w-4 h-4" />
                        Vendas
                    </button>
                    <button
                        onClick={() => setActiveTab('precos')}
                        className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'precos'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 hover:bg-gray-100'
                            }`}
                    >
                        <DollarSign className="w-4 h-4" />
                        Preços
                    </button>
                    <button
                        onClick={() => setActiveTab('estoque')}
                        className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'estoque'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 hover:bg-gray-100'
                            }`}
                    >
                        <Package className="w-4 h-4" />
                        Estoque
                    </button>
                    <button
                        onClick={() => setActiveTab('fornecedor')}
                        className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'fornecedor'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 hover:bg-gray-100'
                            }`}
                    >
                        <Users className="w-4 h-4" />
                        Fornecedor
                    </button>
                </div>

                <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh]">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                            <p className="text-gray-500 animate-pulse font-medium">Carregando informações...</p>
                        </div>
                    ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                            {activeTab === 'vendas' && (
                                <div className="space-y-8">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <div className="bg-indigo-50 dark:bg-indigo-900/20 p-5 rounded-2xl border border-indigo-100 dark:border-indigo-800">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2 bg-indigo-100 dark:bg-indigo-800 rounded-lg">
                                                    <Package className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                                </div>
                                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Total Vendido</span>
                                            </div>
                                            <p className="text-2xl font-black text-indigo-900 dark:text-white">
                                                {estatisticasVendas?.total_vendido_90d || 0}
                                                <span className="text-sm font-bold ml-1 text-indigo-500 uppercase">{produto.unidade_medida || 'un'}</span>
                                            </p>
                                            <p className="text-xs text-indigo-500 mt-1 font-medium italic">nos últimos 90 dias</p>
                                        </div>

                                        <div className="bg-green-50 dark:bg-green-900/20 p-5 rounded-2xl border border-green-100 dark:border-green-800">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2 bg-green-100 dark:bg-green-800 rounded-lg">
                                                    <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
                                                </div>
                                                <span className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">Faturamento</span>
                                            </div>
                                            <p className="text-2xl font-black text-green-900 dark:text-white">
                                                {formatCurrency(estatisticasVendas?.faturamento_90d || 0)}
                                            </p>
                                            <p className="text-xs text-green-500 mt-1 font-medium italic">receita bruta total</p>
                                        </div>

                                        <div className="bg-purple-50 dark:bg-purple-900/20 p-5 rounded-2xl border border-purple-100 dark:border-purple-800">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2 bg-purple-100 dark:bg-purple-800 rounded-lg">
                                                    <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                                </div>
                                                <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Última Venda</span>
                                            </div>
                                            <p className="text-2xl font-black text-purple-900 dark:text-white">
                                                {produto.ultima_venda ? formatDate(produto.ultima_venda) : '---'}
                                            </p>
                                            {diasDesdeUltimaVenda !== null && (
                                                <p className="text-xs text-purple-500 mt-1 font-medium italic">
                                                    há {diasDesdeUltimaVenda} {diasDesdeUltimaVenda === 1 ? 'dia' : 'dias'}
                                                </p>
                                            )}
                                        </div>

                                        <div className="bg-amber-50 dark:bg-amber-900/20 p-5 rounded-2xl border border-amber-100 dark:border-amber-800">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2 bg-amber-100 dark:bg-amber-800 rounded-lg">
                                                    <BarChart3 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                                                </div>
                                                <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Média Diária</span>
                                            </div>
                                            <p className="text-2xl font-black text-amber-900 dark:text-white">
                                                {formatCurrency(estatisticasVendas?.media_diaria || 0)}
                                            </p>
                                            <p className="text-xs text-amber-500 mt-1 font-medium italic">por dia útil</p>
                                        </div>
                                    </div>

                                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
                                        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                            <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                                <Calendar className="w-5 h-5 text-indigo-500" />
                                                Vendas por Data
                                            </h3>
                                        </div>
                                        <div className="p-0">
                                            {vendasHistorico.length > 0 ? (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-left">
                                                        <thead className="bg-gray-50 dark:bg-gray-900/50">
                                                            <tr>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Data</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest text-center">Quant.</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Valor Total</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Ticket Médio</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                            {vendasHistorico.map((venda, idx) => (
                                                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                                                                    <td className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300">{formatDate(venda.data)}</td>
                                                                    <td className="px-6 py-4 text-center">
                                                                        <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-3 py-1 rounded-full text-xs font-bold">
                                                                            {venda.quantidade} {produto.unidade_medida || 'un'}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-6 py-4 text-right font-black text-gray-800 dark:text-white">{formatCurrency(venda.valor_total)}</td>
                                                                    <td className="px-6 py-4 text-right font-bold text-indigo-500">{formatCurrency(venda.ticket_medio)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="py-20 flex flex-col items-center justify-center opacity-40">
                                                    <Package className="w-16 h-16 mb-4" />
                                                    <p className="font-bold">Nenhuma venda registrada nos últimos 90 dias</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {diasDesdeUltimaVenda !== null && diasDesdeUltimaVenda > 30 && (
                                        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-2xl border border-amber-200 dark:border-amber-800 flex items-center gap-4 animate-pulse">
                                            <div className="p-3 bg-amber-100 dark:bg-amber-800 rounded-xl">
                                                <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                            </div>
                                            <div>
                                                <h4 className="font-black text-amber-800 dark:text-amber-200 uppercase text-xs">Atenção: Produto com baixa rotatividade</h4>
                                                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 font-medium">
                                                    Este produto não é vendido há mais de {diasDesdeUltimaVenda} dias. Considere uma promoção para girar o estoque.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'precos' && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="p-6 bg-linear-to-br from-indigo-500 to-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-500/20">
                                            <div className="flex justify-between items-start mb-6">
                                                <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                                                    <BarChart3 className="w-5 h-5 text-white" />
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Insight de Preço</span>
                                            </div>
                                            <p className="text-white/80 text-xs font-bold uppercase mb-1">Preço Atual</p>
                                            <p className="text-3xl font-black mb-4">
                                                {formatCurrency(produto.preco_venda)}
                                                <span className="text-xs ml-1 opacity-60 font-medium">por {produto.unidade_medida || 'un'}</span>
                                            </p>
                                            <div className="h-1 w-full bg-white/20 rounded-full overflow-hidden">
                                                <div className="h-full bg-white w-2/3"></div>
                                            </div>
                                            <p className="text-[10px] mt-2 opacity-60 italic font-medium">Margem atual: {produto.margem_lucro || 0}%</p>
                                        </div>

                                        <div className="p-6 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                                            <div className="flex items-center gap-3 mb-4">
                                                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                                                    <DollarSign className="w-5 h-5 text-amber-600" />
                                                </div>
                                                <h3 className="font-black text-gray-800 dark:text-white uppercase text-xs tracking-wider">Análise de Lucro</h3>
                                            </div>
                                            <div className="space-y-4">
                                                <div className="flex justify-between text-sm py-2 border-b border-gray-50 dark:border-gray-750">
                                                    <span className="text-gray-500">Preço de Custo</span>
                                                    <span className="font-bold text-gray-700 dark:text-gray-300">{formatCurrency(produto.preco_custo)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm py-2 text-indigo-600 dark:text-indigo-400 font-bold">
                                                    <span>Lucro Bruto Un.</span>
                                                    <span className="text-lg font-black">{formatCurrency(produto.preco_venda - produto.preco_custo)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
                                        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
                                            <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                                <Clock className="w-5 h-5 text-indigo-500" />
                                                Histórico de Alterações
                                            </h3>
                                        </div>
                                        <div className="p-0">
                                            {historicoPrecos.length > 0 ? (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-left">
                                                        <thead className="bg-gray-50 dark:bg-gray-900/50">
                                                            <tr>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Data</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Alteração</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Motivo</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Responsável</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                            {historicoPrecos.map((hist, idx) => (
                                                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                                                                    <td className="px-6 py-4 text-xs font-bold text-gray-500">{formatDate(hist.data_alteracao)}</td>
                                                                    <td className="px-6 py-4">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-xs text-gray-400 line-through">{formatCurrency(hist.preco_venda_anterior)}</span>
                                                                            <TrendingUp className={`w-3 h-3 ${hist.preco_venda_novo > hist.preco_venda_anterior ? 'text-green-500' : 'text-red-500'}`} />
                                                                            <span className="font-black text-gray-800 dark:text-white">{formatCurrency(hist.preco_venda_novo)}</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-4 text-xs text-gray-600 dark:text-gray-400 font-medium">{hist.motivo}</td>
                                                                    <td className="px-6 py-4 text-xs font-black text-indigo-600 dark:text-indigo-400">{hist.funcionario_nome || 'Sistema'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="py-16 flex flex-col items-center justify-center opacity-30">
                                                    <DollarSign className="w-12 h-12 mb-3" />
                                                    <p className="font-bold text-sm">Nenhuma alteração de preço registrada</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'estoque' && (
                                <div className="space-y-6">
                                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
                                        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                            <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                                <Package className="w-5 h-5 text-indigo-500" />
                                                Movimentações de Estoque
                                            </h3>
                                        </div>
                                        <div className="p-0">
                                            {movimentacoesEstoque.length > 0 ? (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-left">
                                                        <thead className="bg-gray-50 dark:bg-gray-900/50">
                                                            <tr>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Data</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Tipo</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Quantidade</th>
                                                                <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Motivo / Estoque Atual</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                            {movimentacoesEstoque.map((mov, idx) => (
                                                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                                                                    <td className="px-6 py-4 text-xs font-bold text-gray-500">{formatDate(mov.created_at)}</td>
                                                                    <td className="px-6 py-4">
                                                                        <span className={`px-2 py-1 rounded text-xs font-bold ${mov.tipo === 'entrada' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                            {mov.tipo.toUpperCase()}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-6 py-4 font-black text-gray-800 dark:text-white">
                                                                        {mov.tipo === 'entrada' ? '+' : '-'}{mov.quantidade}
                                                                    </td>
                                                                    <td className="px-6 py-4">
                                                                        <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{mov.motivo || '---'}</p>
                                                                        <p className="text-xs text-gray-400 mt-1">
                                                                            Ficou: <span className="font-bold">{mov.quantidade_atual}</span> un. · Resp: {mov.funcionario || 'Sistema'}
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="py-16 flex flex-col items-center justify-center opacity-30">
                                                    <Package className="w-12 h-12 mb-3" />
                                                    <p className="font-bold text-sm">Nenhuma movimentação registrada</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {activeTab === 'fornecedor' && (
                                <div className="space-y-6">
                                    {fornecedorInfo ? (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            <div className="md:col-span-2 bg-linear-to-br from-gray-800 to-gray-950 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-500">
                                                    <Users className="w-40 h-40" />
                                                </div>
                                                <p className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.3em] mb-4">Parceiro Comercial</p>
                                                <h3 className="text-3xl font-black mb-8 leading-tight">{fornecedorInfo.nome_fantasia || fornecedorInfo.razao_social}</h3>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] text-gray-500 font-black uppercase">CNPJ</p>
                                                        <p className="font-bold text-gray-200">{fornecedorInfo.cnpj}</p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] text-gray-500 font-black uppercase">E-mail</p>
                                                        <p className="font-bold text-gray-200 truncate">{fornecedorInfo.email || '---'}</p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] text-gray-500 font-black uppercase">Telefone</p>
                                                        <p className="font-bold text-gray-200">{fornecedorInfo.telefone || '---'}</p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] text-gray-500 font-black uppercase">Cidade/UF</p>
                                                        <p className="font-bold text-gray-200">{fornecedorInfo.cidade} / {fornecedorInfo.estado}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm h-full">
                                                    <p className="text-[10px] text-gray-500 font-black uppercase mb-4 flex items-center justify-between">
                                                        <span>Últimos Pedidos</span>
                                                        <span className="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-0.5 rounded-full">{historicoCompras.length}</span>
                                                    </p>
                                                    {historicoCompras.length > 0 ? (
                                                        <div className="space-y-4">
                                                            {historicoCompras.map((compra) => (
                                                                <div key={compra.id} className="relative pl-4 border-l-2 border-indigo-100 dark:border-gray-700">
                                                                    <div className="absolute w-2 h-2 bg-indigo-500 rounded-full left-[-5px] top-1.5 ring-4 ring-white dark:ring-gray-800"></div>
                                                                    <p className="text-sm font-black text-gray-800 dark:text-white">
                                                                        {formatDate(compra.data_pedido || compra.created_at)}
                                                                    </p>
                                                                    <p className="text-xs text-gray-500 mt-0.5">
                                                                        Pedido <span className="font-bold text-indigo-500">#{compra.numero_pedido}</span>
                                                                    </p>
                                                                    <div className="flex items-center justify-between mt-1.5">
                                                                        <span className="font-bold text-gray-800 dark:text-gray-300 text-xs">{formatCurrency(compra.total || 0)}</span>
                                                                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${compra.status === 'Entregue' || compra.status === 'Concluído' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                                                                            {compra.status}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="py-8 text-center">
                                                            <p className="text-xs text-gray-400 italic font-medium">Nenhum pedido de compra encontrado para este fornecedor.</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="py-24 bg-gray-50 dark:bg-gray-900/30 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-800 flex flex-col items-center justify-center">
                                            <div className="p-4 bg-white dark:bg-gray-800 rounded-full mb-4 shadow-sm">
                                                <Users className="w-10 h-10 text-gray-300" />
                                            </div>
                                            <h3 className="font-black text-gray-400 uppercase text-xs tracking-widest">Nenhum fornecedor vinculado</h3>
                                            <p className="text-xs text-gray-500 mt-2 font-medium">Vincule um fornecedor no cadastro do produto</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </ResponsiveModal>
    );
};

export default ProductHistoryModal;
