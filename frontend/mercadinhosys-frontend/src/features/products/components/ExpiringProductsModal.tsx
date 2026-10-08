import React, { useState, useEffect, useMemo } from 'react';
import { X, Calendar, AlertTriangle, TrendingDown } from 'lucide-react';
import { Produto } from '../../../types';
import { productsService } from '../productsService';
import { formatCurrency } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';

/** Lote no período de validade (vindo da API) */
export interface LoteNoPeriodo {
    id: number | null;
    numero_lote: string;
    data_validade: string | null;
    quantidade: number;
    preco_venda: number | null;
    preco_produto: number;
    preco_custo?: number | null;
}

type Ordenacao = 'dias_asc' | 'dias_desc' | 'nome_asc';

export type ProdutoComLotes = Produto & { lotes_no_periodo?: LoteNoPeriodo[] };

/** Uma linha da tabela: produto + lote (ou só produto quando não há lotes) */
interface LinhaValidade {
    produto: ProdutoComLotes;
    lote: LoteNoPeriodo | null;
}

interface ExpiringProductsModalProps {
    isOpen: boolean;
    onClose: () => void;
    timeframe: 'vencidos' | '15' | '30' | '90';
    onDiscard?: (produto: Produto, loteId?: number) => void;
}

/** Desconto sugerido por padrão para cada janela — ponto de partida editável,
    não mais um valor travado (Rafael pediu para poder ajustar a % aplicada). */
const DESCONTO_PADRAO: Record<string, number> = { vencidos: 0, '15': 30, '30': 15, '90': 0 };

const ExpiringProductsModal: React.FC<ExpiringProductsModalProps> = ({ isOpen, onClose, timeframe, onDiscard }) => {
    const [loading, setLoading] = useState(false);
    const [produtos, setProdutos] = useState<ProdutoComLotes[]>([]);
    const [descontoPercentual, setDescontoPercentual] = useState(DESCONTO_PADRAO[timeframe] ?? 0);
    const [ordenacao, setOrdenacao] = useState<Ordenacao>('dias_asc');

    useEffect(() => {
        if (isOpen) {
            carregarProdutos();
            setDescontoPercentual(DESCONTO_PADRAO[timeframe] ?? 0);
        }
    }, [isOpen, timeframe]);

    const carregarProdutos = async () => {
        try {
            setLoading(true);
            const params: Record<string, unknown> = { por_pagina: 100 };

            if (timeframe === 'vencidos') {
                params.vencidos = true;
            } else {
                params.validade_proxima = true;
                params.dias_validade = parseInt(timeframe, 10);
            }

            const response = await productsService.getAllEstoque(1, 100, params as import('../../../types').ProdutoFiltros);
            setProdutos((response.produtos || []) as ProdutoComLotes[]);
        } catch (error) {
            console.error('Erro ao carregar produtos expirando:', error);
            showToast.error('Erro ao carregar lista de produtos');
        } finally {
            setLoading(false);
        }
    };

    const getSugestao = () => {
        // O percentual agora vem do estado editável (descontoPercentual), não mais
        // travado em 30%/15% — o rótulo e a cor seguem indicando a urgência da janela.
        if (timeframe === 'vencidos') return { acao: 'Descarte', cor: 'text-red-600', desconto: 0 };
        if (timeframe === '15') return { acao: 'Queima de Estoque', cor: 'text-orange-600', desconto: descontoPercentual / 100 };
        if (timeframe === '30') return { acao: 'Promoção', cor: 'text-yellow-600', desconto: descontoPercentual / 100 };
        return { acao: 'Monitorar', cor: 'text-blue-600', desconto: 0 };
    };

    const diasRestantesDe = (dataValidade: string | null | undefined): number | null => {
        if (!dataValidade) return null;
        return Math.ceil((new Date(dataValidade).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    };

    /** Linhas para exibição: uma por lote (ou uma por produto quando não há lotes),
        ordenadas conforme o filtro rápido escolhido (dias faltantes ou nome). */
    const linhas = useMemo((): LinhaValidade[] => {
        const out: LinhaValidade[] = [];
        for (const p of produtos) {
            const lotes = p.lotes_no_periodo && p.lotes_no_periodo.length > 0 ? p.lotes_no_periodo : null;
            if (lotes) {
                for (const lote of lotes) {
                    out.push({ produto: p, lote });
                }
            } else {
                out.push({ produto: p, lote: null });
            }
        }
        const comDias = out.map((linha) => ({
            linha,
            dias: diasRestantesDe(linha.lote?.data_validade ?? linha.produto.data_validade) ?? Infinity,
        }));
        if (ordenacao === 'nome_asc') {
            comDias.sort((a, b) => a.linha.produto.nome.localeCompare(b.linha.produto.nome, 'pt-BR'));
        } else if (ordenacao === 'dias_desc') {
            comDias.sort((a, b) => b.dias - a.dias);
        } else {
            comDias.sort((a, b) => a.dias - b.dias);
        }
        return comDias.map((x) => x.linha);
    }, [produtos, ordenacao]);

    const handleApplyPromotions = async () => {
        const sugestao = getSugestao();
        if (sugestao.desconto === 0) return;

        const atualizacoes = linhas
            .filter(() => sugestao.desconto > 0)
            .map(({ produto, lote }) => {
                const precoAtual = lote
                    ? (lote.preco_venda ?? lote.preco_produto)
                    : produto.preco_venda;
                const novoPreco = parseFloat((precoAtual * (1 - sugestao.desconto)).toFixed(2));
                return {
                    id: produto.id,
                    lote_id: lote && lote.id != null ? lote.id : undefined,
                    novo_preco: novoPreco,
                };
            });

        if (atualizacoes.length === 0) return;

        try {
            setLoading(true);
            const response = await productsService.bulkUpdatePrices(atualizacoes);

            if (response.success) {
                showToast.update(response.message);
                onClose();
            } else {
                showToast.error(response.message || 'Erro ao aplicar promoções');
            }
        } catch (error: unknown) {
            const axiosError = error as { response?: { data?: { message?: string }; status?: number }; message?: string };
            const msg =
                axiosError.response?.data?.message ||
                (axiosError.response?.status === 401 ? 'Sessão expirada. Faça login novamente.' : null) ||
                (axiosError.response?.status === 403 ? 'Sem permissão para alterar preços.' : null) ||
                axiosError.message ||
                'Ocorreu um erro ao aplicar as promoções. Tente novamente.';
            console.error('Erro ao aplicar promoções:', error);
            showToast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const titulos = {
        'vencidos': 'Produtos Já Vencidos',
        '15': 'Produtos Vencendo em 15 dias',
        '30': 'Produtos Vencendo em 30 dias',
        '90': 'Produtos Vencendo em 90 dias'
    };

    const subtitulos = {
        'vencidos': 'Estes produtos devem ser retirados de venda imediatamente.',
        '15': 'Prioridade máxima para venda. Sugerimos descontos agressivos.',
        '30': 'Atenção necessária. Considere incluir em ofertas semanais.',
        '90': 'Acompanhamento preventivo para evitar perdas futuras.'
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100 p-4 animate-in fade-in duration-300" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden border border-gray-100 dark:border-gray-700">
                {/* Header */}
                <div className="p-6 border-b dark:border-gray-700 flex items-center justify-between bg-linear-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${timeframe === 'vencidos' ? 'bg-red-100 text-red-600' : timeframe === '15' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                            {timeframe === 'vencidos' ? <AlertTriangle className="w-6 h-6" /> : <Calendar className="w-6 h-6" />}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{titulos[timeframe]}</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{subtitulos[timeframe]}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <X className="w-6 h-6 text-gray-400" />
                    </button>
                </div>

                {/* Barra de controles: ordenação + desconto ajustável (quando aplicável) */}
                {!loading && linhas.length > 0 && (
                    <div className="px-6 py-3 border-b dark:border-gray-700 flex flex-wrap items-center gap-3 bg-gray-50/60 dark:bg-gray-900/30">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Ordenar por:</span>
                        <select
                            value={ordenacao}
                            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
                            className="text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1.5"
                        >
                            <option value="dias_asc">Dias faltantes (menor → maior)</option>
                            <option value="dias_desc">Dias faltantes (maior → menor)</option>
                            <option value="nome_asc">Nome (A → Z)</option>
                        </select>

                        {(timeframe === '15' || timeframe === '30') && (
                            <div className="flex items-center gap-2 ml-auto">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Desconto a aplicar:</span>
                                <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1">
                                    <input
                                        type="number"
                                        min={0}
                                        max={90}
                                        step={1}
                                        value={descontoPercentual}
                                        onChange={(e) => setDescontoPercentual(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
                                        className="w-14 text-sm font-bold text-right bg-transparent outline-none text-gray-900 dark:text-white"
                                    />
                                    <span className="text-sm font-bold text-gray-500">%</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-gray-500 font-medium">Analisando estoque...</p>
                        </div>
                    ) : linhas.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
                                <TrendingDown className="w-10 h-10 text-green-600" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">Nenhum produto crítico!</h3>
                            <p className="text-gray-500">Seu controle de validade está em dia.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Cabeçalho de tabela — só no desktop. No mobile cada linha vira
                                um card com rótulos, evitando colunas espremidas/sobrepostas. */}
                            <div className="hidden sm:grid grid-cols-14 gap-3 px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider border-b dark:border-gray-700">
                                <div className="col-span-3">Produto / Lote</div>
                                <div className="col-span-2">Validade</div>
                                <div className="col-span-2 text-right">Custo</div>
                                <div className="col-span-2 text-right">Preço Atual</div>
                                <div className="col-span-3 text-right">Sugestão</div>
                                <div className="col-span-2 text-right">Ação</div>
                            </div>
                            {linhas.map(({ produto: p, lote }, idx) => {
                                const sugestao = getSugestao();
                                const precoAtual = lote ? (lote.preco_venda ?? lote.preco_produto) : p.preco_venda;
                                const precoCusto = lote?.preco_custo ?? p.preco_custo ?? 0;
                                const precoSugerido = precoAtual * (1 - sugestao.desconto);
                                // Alerta visual: se o desconto ajustado deixar o preço abaixo do
                                // custo, o funcionário estaria vendendo no prejuízo — mostrar em
                                // vermelho para não passar despercebido.
                                const abaixoDoCusto = sugestao.desconto > 0 && precoCusto > 0 && precoSugerido < precoCusto;
                                const dataValidade = lote?.data_validade ?? p.data_validade;
                                const key = lote && lote.id != null ? `p-${p.id}-l-${lote.id}` : `p-${p.id}-${idx}`;
                                const diasRestantes = diasRestantesDe(dataValidade);

                                return (
                                    <div key={key} className="flex flex-col gap-3 sm:grid sm:grid-cols-14 sm:gap-3 sm:items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all border border-transparent hover:border-gray-200 dark:hover:border-gray-600">
                                        {/* Produto / Lote */}
                                        <div className="sm:col-span-3 min-w-0">
                                            <p className="font-bold text-gray-900 dark:text-white truncate">{p.nome}</p>
                                            <p className="text-xs text-gray-500 truncate">
                                                {p.categoria}
                                                {lote ? ` | Lote: ${lote.numero_lote} (${lote.quantidade} un.)` : ` | Qtd: ${p.quantidade}`}
                                            </p>
                                        </div>
                                        {/* Validade */}
                                        <div className="flex items-center justify-between sm:block sm:col-span-2">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider sm:hidden">Validade</span>
                                            <div className="flex flex-col items-end sm:items-start">
                                                <span className={`text-sm font-medium ${timeframe === 'vencidos' ? 'text-red-600' : 'text-gray-700 dark:text-gray-300'}`}>
                                                    {dataValidade ? new Date(dataValidade).toLocaleDateString() : 'N/A'}
                                                </span>
                                                {diasRestantes !== null && (
                                                    <span className="text-[10px] text-gray-400">{diasRestantes} dias</span>
                                                )}
                                            </div>
                                        </div>
                                        {/* Custo — para não haver dúvida quanto ao desconto a aplicar
                                            (Rafael pediu para ver o custo antes de decidir a %) */}
                                        <div className="flex items-center justify-between sm:block sm:col-span-2 sm:text-right">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider sm:hidden">Custo</span>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">{formatCurrency(precoCusto)}</p>
                                        </div>
                                        {/* Preço Atual */}
                                        <div className="flex items-center justify-between sm:block sm:col-span-2 sm:text-right">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider sm:hidden">Preço Atual</span>
                                            <p className="text-sm font-medium">{formatCurrency(precoAtual)}</p>
                                        </div>
                                        {/* Sugestão */}
                                        <div className="flex items-center justify-between sm:block sm:col-span-3 sm:text-right">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider sm:hidden">Sugestão</span>
                                            {sugestao.desconto > 0 ? (
                                                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                                                    <span className={`text-sm font-bold ${abaixoDoCusto ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(precoSugerido)}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${abaixoDoCusto ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                                        -{Math.round(sugestao.desconto * 100)}%{abaixoDoCusto ? ' · abaixo do custo!' : ''}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-sm text-gray-400">---</span>
                                            )}
                                        </div>
                                        {/* Ação */}
                                        <div className="sm:col-span-2 sm:text-right">
                                            {sugestao.acao === 'Descarte' ? (
                                                <button
                                                    onClick={() => onDiscard?.(p, lote?.id ?? undefined)}
                                                    className="w-full sm:w-auto text-xs font-bold px-3 py-2 sm:py-1.5 rounded-full shadow-sm border opacity-90 hover:opacity-100 uppercase tracking-tighter transition-all bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
                                                >
                                                    {sugestao.acao}
                                                </button>
                                            ) : (
                                                <span className={`inline-block text-xs font-bold px-2 py-1 rounded-full bg-white dark:bg-gray-800 shadow-sm border ${sugestao.cor} border-current opacity-80 uppercase tracking-tighter`}>
                                                    {sugestao.acao}
                                                </span>
                                            )}
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
                        * Sugestões baseadas nas melhores práticas de gestão de perecíveis.
                    </p>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-6 py-2 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-all">
                            Fechar
                        </button>
                        {timeframe !== 'vencidos' && timeframe !== '90' && (
                            <button
                                onClick={handleApplyPromotions}
                                disabled={loading}
                                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                <TrendingDown className="w-5 h-5" /> {loading ? 'Aplicando...' : 'Aplicar Promoções'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExpiringProductsModal;
