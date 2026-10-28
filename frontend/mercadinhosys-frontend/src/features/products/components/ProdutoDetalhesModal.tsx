import { useState } from 'react';
import {
    Image as ImageIcon,
    Clipboard,
    Building2,
    ChevronLeft,
    ChevronRight,
    History,
    TrendingUp,
    TrendingDown,
    PackageSearch,
    Clock,
    Flame,
    AlertTriangle,
    ShieldCheck
} from 'lucide-react';
import { Produto, ProdutoLote } from '../../../types';
import { formatCurrency, formatDate, fixImageUrl } from '../../../utils/formatters';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import GradePanel from './GradePanel';

interface ProdutoDetalhesModalProps {
    produto: Produto;
    onClose: () => void;
    onGradeAlterada?: () => void;
}

// Famílias vendidas por número/tamanho; variação de grade sempre mostra a grade do modelo.
const FAMILIAS_COM_GRADE = ['calcados', 'vestuario'];

const ProdutoDetalhesModal = ({ produto, onClose, onGradeAlterada }: ProdutoDetalhesModalProps) => {
    const atributos = (produto.atributos || {}) as Record<string, any>;
    const mostrarGrade = FAMILIAS_COM_GRADE.includes(produto.familia_produto || '') || !!(produto as any).produto_pai_id;
    const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    const [currentLoteIdx, setCurrentLoteIdx] = useState(0);
    const lotes = produto.lotes || [];
    const historico = produto.historico_precos || [];
    const perdas = produto.historico_perdas || [];
    const metricas = produto.metricas_gestao || {
        giro_estoque: 0,
        dias_estoque: 0,
        cobertura_estoque: '---',
        frequencia_venda: '---'
    };

    const nextLote = () => setCurrentLoteIdx((prev) => (prev + 1) % lotes.length);
    const prevLote = () => setCurrentLoteIdx((prev) => (prev - 1 + lotes.length) % lotes.length);

    const currentLote: ProdutoLote | null = lotes.length > 0 ? lotes[currentLoteIdx] : null;

    return (
        <ResponsiveModal
            isOpen={true}
            onClose={onClose}
            title={produto.nome}
            subtitle={`${produto.categoria} | ${produto.marca || 'Sem Marca'}`}
            headerIcon={<ShieldCheck className="w-6 h-6" />}
            headerColor="blue"
            size="xl"
            footer={
                <div className="flex justify-between items-center w-full">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest hidden sm:block">
                        Smart Retail Intelligence • v2.0
                    </p>
                    <button
                        onClick={onClose}
                        className="px-8 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-white rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-all border border-gray-200 dark:border-gray-600 shadow-sm"
                    >
                        Fechar Auditoria
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-8 pb-4">
                {/* 1. Visão Geral & KPIs Críticos */}
                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="w-full lg:w-64 flex flex-col gap-4">
                        <div className="aspect-square bg-white dark:bg-gray-900 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden shadow-sm relative group">
                            {produto.imagem_url ? (
                                <img src={fixImageUrl(produto.imagem_url)} alt={produto.nome} className="w-full h-full object-contain p-4 transition-transform group-hover:scale-110 duration-500" />
                            ) : (
                                <ImageIcon className="w-16 h-16 text-gray-100 dark:text-gray-800" />
                            )}
                            <div className="absolute top-3 right-3">
                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase shadow-sm border ${produto.classificacao_abc === 'A' ? 'bg-green-500 text-white border-green-400' :
                                    produto.classificacao_abc === 'B' ? 'bg-blue-500 text-white border-blue-400' :
                                        'bg-gray-500 text-white border-gray-400'
                                    }`}>
                                    Classe {produto.classificacao_abc || 'C'}
                                </span>
                            </div>
                        </div>

                        <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/50">
                            <div className="flex justify-between items-center mb-1">
                                <p className="text-[9px] text-indigo-600 dark:text-indigo-400 uppercase font-black tracking-widest">Estoque Físico</p>
                                <span className={`w-2 h-2 rounded-full ${produto.quantidade <= 0 ? 'bg-red-500' : produto.quantidade <= (produto.quantidade_minima || 10) ? 'bg-yellow-500' : 'bg-green-500 animate-pulse'}`}></span>
                            </div>
                            <p className="text-xl font-black text-gray-900 dark:text-white">
                                {Number(produto.quantidade).toLocaleString()} <span className="text-xs font-bold text-gray-400 uppercase">{produto.unidade_medida}</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex-1 space-y-6">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                                <p className="text-[9px] text-gray-400 font-black uppercase mb-1">Preço Venda</p>
                                <p className="text-lg font-black text-gray-900 dark:text-white">{formatCurrency(produto.preco_venda)}</p>
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <p className="text-[9px] text-gray-400 font-black uppercase mb-1">Margem Real</p>
                                    {(produto.origem_custo === 'estimado' || produto.origem_custo === 'rateio_lote') && (
                                        <span
                                            className="rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400"
                                            title="Custo calculado a partir do preço de venda"
                                        >
                                            estimado
                                        </span>
                                    )}
                                </div>
                                <p className="text-lg font-black text-green-600 dark:text-green-400">{produto.margem_lucro || 0}%</p>
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <Flame className="w-3 h-3 text-orange-500" />
                                    <p className="text-[9px] text-gray-400 font-black uppercase">Giro</p>
                                </div>
                                <p className="text-lg font-black text-gray-900 dark:text-white">{metricas.frequencia_venda}</p>
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                                <p className="text-[9px] text-gray-400 font-black uppercase mb-1">Cobertura</p>
                                <p className="text-lg font-black text-gray-900 dark:text-white">{metricas.cobertura_estoque}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <Clipboard className="w-3.5 h-3.5" /> Identificação
                                </h4>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between py-1.5 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 font-bold dark:text-gray-400">Código EAN:</span>
                                        <span className="font-mono font-black text-gray-800 dark:text-gray-200">{produto.codigo_barras || 'N/D'}</span>
                                    </div>
                                    <div className="flex justify-between py-1.5 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 font-bold dark:text-gray-400">Fabricante:</span>
                                        <span className="font-black text-gray-800 dark:text-gray-200">{produto.fabricante || 'N/D'}</span>
                                    </div>
                                    <div className="flex justify-between py-1.5 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 font-bold dark:text-gray-400">Localização:</span>
                                        <span className="font-black text-gray-800 dark:text-gray-200">{produto.localizacao || 'Geral'}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <Clock className="w-3.5 h-3.5" /> Ciclo de Vida
                                </h4>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between py-1.5 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 font-bold dark:text-gray-400">Última Venda:</span>
                                        <span className="font-black text-gray-800 dark:text-gray-200">{produto.ultima_venda ? formatDate(produto.ultima_venda) : 'Nunca'}</span>
                                    </div>
                                    <div className="flex justify-between py-1.5 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 font-bold dark:text-gray-400">Cadastro em:</span>
                                        <span className="font-black text-gray-800 dark:text-gray-200">{produto.created_at ? formatDate(produto.created_at) : '---'}</span>
                                    </div>
                                    <div className="flex justify-between py-1.5 border-b border-gray-50 dark:border-gray-800">
                                        <span className="text-gray-500 font-bold dark:text-gray-400">Próx. Validade:</span>
                                        <span className={`font-black ${produto.alerta_validade ? 'text-red-500 animate-pulse' : 'text-gray-800 dark:text-gray-200'}`}>
                                            {produto.data_validade ? formatDate(produto.data_validade) : 'N/D'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {mostrarGrade && produto.id && (
                    <GradePanel
                        produtoId={produto.id}
                        numerosSugeridos={lista(atributos.numeracao).length ? lista(atributos.numeracao) : lista(atributos.tamanhos)}
                        coresSugeridas={lista(atributos.cores)}
                        onAlterada={onGradeAlterada}
                    />
                )}

                {/* 2. Rastreabilidade de Lotes (Carousel) */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                            <PackageSearch className="w-4 h-4 text-blue-500" /> Rastreabilidade por Lote (FIFO)
                        </h3>
                        {lotes.length > 1 && (
                            <div className="flex gap-2">
                                <button onClick={prevLote} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-gray-200 dark:border-gray-700">
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <button onClick={nextLote} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-gray-200 dark:border-gray-700">
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>

                    {currentLote ? (
                        <div className="bg-white dark:bg-gray-900/50 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6 relative overflow-hidden">
                            <div className="md:col-span-2 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] text-blue-500 font-black uppercase">Nr. do Lote</p>
                                        <h5 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">{currentLote.numero_lote}</h5>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-gray-400 font-black uppercase">Fornecedor</p>
                                        <p className="text-xs font-bold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                                            <Building2 className="w-3.5 h-3.5" /> {currentLote.fornecedor_nome || 'Lote Interno'}
                                        </p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 pt-2">
                                    <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                                        <p className="text-[9px] text-gray-400 font-black uppercase mb-1">Custo Lote</p>
                                        <p className="text-sm font-black text-gray-800 dark:text-gray-200">{formatCurrency(currentLote.preco_custo_unitario)}</p>
                                    </div>
                                    <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                                        <p className="text-[9px] text-gray-400 font-black uppercase mb-1">Data Entrada</p>
                                        <p className="text-sm font-black text-gray-800 dark:text-gray-200">{formatDate(currentLote.data_entrada)}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/10 p-5 rounded-xl border border-blue-100 dark:border-blue-900/30 flex flex-col justify-center text-center">
                                <p className="text-[10px] text-blue-600 dark:text-blue-400 font-black uppercase mb-1 tracking-widest">Estoque do Lote</p>
                                <p className="text-3xl font-black text-blue-900 dark:text-blue-200">{Number(currentLote.quantidade).toLocaleString()}</p>
                                <div className="w-full bg-blue-200 dark:bg-blue-900/50 h-1.5 rounded-full mt-3 overflow-hidden">
                                    <div className="bg-blue-600 h-full transition-all" style={{ width: `${(Number(currentLote.quantidade) / Number(currentLote.quantidade_inicial)) * 100}%` }}></div>
                                </div>
                                <div className="flex justify-between mt-2">
                                    <span className="text-[9px] font-bold text-blue-400">Validade: {formatDate(currentLote.data_validade)}</span>
                                    <span className={`text-[9px] font-black uppercase ${currentLote.esta_vencido ? 'text-red-500' : 'text-green-500'}`}>
                                        {currentLote.esta_vencido ? 'Vencido' : 'OK'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-center italic text-xs text-gray-400 font-bold">
                            Nenhum lote individual registrado para auditoria.
                        </div>
                    )}
                </div>

                {/* 3. Gestão Financeira: Preços & Perdas */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Histórico de Preços */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                            <History className="w-4 h-4 text-purple-500" /> Histórico de Preços
                        </h3>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-gray-50 dark:bg-gray-900/50 text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 dark:border-gray-700">
                                    <tr>
                                        <th className="px-4 py-3">Data</th>
                                        <th className="px-4 py-3 text-right">Preço</th>
                                        <th className="px-4 py-3 text-right">Var. %</th>
                                        <th className="px-4 py-3">Responsável</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                                    {historico.slice(0, 4).map((h) => (
                                        <tr key={h.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                                            <td className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{formatDate(h.data_alteracao)}</td>
                                            <td className="px-4 py-3 text-right font-black text-gray-900 dark:text-white">{formatCurrency(h.preco_venda_novo)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`inline-flex items-center gap-0.5 font-black px-1.5 py-0.5 rounded ${h.variacao_venda_pct > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50'}`}>
                                                    {h.variacao_venda_pct > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                                                    {Math.abs(h.variacao_venda_pct).toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-400 uppercase font-black tracking-tighter truncate max-w-[80px]">{h.funcionario || 'SISTEMA'}</td>
                                        </tr>
                                    ))}
                                    {historico.length === 0 && (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 font-bold italic">Sem variações registradas</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Histórico de Perdas (Descartes) */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-500" /> Histórico de Perdas
                        </h3>
                        <div className="bg-red-50/30 dark:bg-red-900/5 rounded-2xl border border-red-100 dark:border-red-900/30 overflow-hidden shadow-sm">
                            <div className="p-4 border-b border-red-100 dark:border-red-900/30 flex justify-between items-center">
                                <p className="text-[10px] font-black text-red-800 dark:text-red-400 uppercase tracking-widest">Registros de Descarte</p>
                                <span className="bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">PREJUÍZO</span>
                            </div>
                            <div className="divide-y divide-red-100 dark:divide-red-900/20">
                                {perdas.map((p) => (
                                    <div key={p.id} className="p-4 flex justify-between items-center hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-gray-800 dark:text-gray-200">-{Number(p.quantidade).toLocaleString()} {produto.unidade_medida}</span>
                                            <span className="text-[10px] text-gray-500 font-bold dark:text-gray-400">{formatDate(p.created_at || '')}</span>
                                        </div>
                                        <div className="text-right flex flex-col">
                                            <span className="text-xs font-black text-red-600">{formatCurrency(p.valor_total || (p.custo_unitario ? p.custo_unitario * p.quantidade : 0))}</span>
                                            <span className="text-[9px] text-gray-400 font-bold uppercase truncate max-w-[120px]">{p.motivo}</span>
                                        </div>
                                    </div>
                                ))}
                                {perdas.length === 0 && (
                                    <div className="p-8 text-center text-xs text-green-600 font-bold italic opacity-60">
                                        Excelente! Nenhuma perda registrada recentemente.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Descrição */}
                {produto.descricao && (
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 mt-2">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Notas Técnicas / Descrição</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed italic">"{produto.descricao}"</p>
                    </div>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default ProdutoDetalhesModal;
