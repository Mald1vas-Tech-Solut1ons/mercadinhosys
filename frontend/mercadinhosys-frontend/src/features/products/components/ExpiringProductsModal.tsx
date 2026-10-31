import React, { useState, useEffect, useMemo } from 'react';
import { X, Calendar, AlertTriangle, TrendingDown } from 'lucide-react';
import { Produto } from '../../../types';
import { productsService } from '../productsService';
import { formatCurrency } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';
import { confirmar } from '../../../components/ui/Confirmacao';

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
    /** Chave estável da linha (key do React + identidade no set de seleção). */
    chave: string;
}

/** Chave estável por linha: lote quando existe; índice quando o lote ainda não tem id. */
const chaveDaLinha = (produtoId: number, lote: LoteNoPeriodo | null, indiceLote = 0): string =>
    lote ? (lote.id != null ? `p-${produtoId}-l-${lote.id}` : `p-${produtoId}-li-${indiceLote}`) : `p-${produtoId}`;

/** Preço unitário vigente da linha: o preço do lote tem prioridade sobre o do produto. */
const precoDaLinha = (linha: LinhaValidade): number =>
    linha.lote ? (linha.lote.preco_venda ?? linha.lote.preco_produto) : linha.produto.preco_venda;

interface ExpiringProductsModalProps {
    isOpen: boolean;
    onClose: () => void;
    timeframe: 'vencidos' | '15' | '30' | '90';
    onDiscard?: (produto: Produto, loteId?: number) => void;
}

/** Desconto sugerido por padrão para cada janela — ponto de partida editável,
    não mais um valor travado (Rafael pediu para poder ajustar a % aplicada). */
const DESCONTO_PADRAO: Record<string, number> = { vencidos: 0, '15': 30, '30': 15, '90': 0 };

/** Janela (dias) que define o que já entra MARCADO: só o que urge entra na seleção
    inicial. Itens de validade longa (ex.: azeite vencendo em 14 dias) ficam de fora
    e precisam ser marcados manualmente — evita desconto em massa por engano. */
const DIAS_CRITICOS = 7;

const ExpiringProductsModal: React.FC<ExpiringProductsModalProps> = ({ isOpen, onClose, timeframe, onDiscard }) => {
    const [loading, setLoading] = useState(false);
    const [produtos, setProdutos] = useState<ProdutoComLotes[]>([]);
    const [descontoPercentual, setDescontoPercentual] = useState(DESCONTO_PADRAO[timeframe] ?? 0);
    const [ordenacao, setOrdenacao] = useState<Ordenacao>('dias_asc');
    /** Chaves das linhas marcadas — o desconto em massa só age sobre elas. */
    const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

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
        // 90 dias: sem sugestão própria (padrão 0%), mas o percentual escolhido vale.
        return { acao: 'Monitorar', cor: 'text-blue-600', desconto: descontoPercentual / 100 };
    };

    const diasRestantesDe = (dataValidade: string | null | undefined): number | null => {
        if (!dataValidade) return null;
        return Math.ceil((new Date(dataValidade).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    };

    /** Uma linha por lote (ou uma por produto quando não há lotes), com chave estável.
        A ordem é aplicada depois; a base não depende da ordenação para a seleção
        não ser perdida ao reordenar a lista. */
    const todasAsLinhas = useMemo((): LinhaValidade[] => {
        const out: LinhaValidade[] = [];
        for (const p of produtos) {
            const lotes = p.lotes_no_periodo && p.lotes_no_periodo.length > 0 ? p.lotes_no_periodo : null;
            if (lotes) {
                lotes.forEach((lote, indiceLote) => {
                    out.push({ produto: p, lote, chave: chaveDaLinha(p.id, lote, indiceLote) });
                });
            } else {
                out.push({ produto: p, lote: null, chave: chaveDaLinha(p.id, null) });
            }
        }
        return out;
    }, [produtos]);

    /** Seleção inicial: apenas o que vence dentro da janela crítica (<= DIAS_CRITICOS). */
    const selecaoPadrao = useMemo((): Set<string> => {
        const marcados = new Set<string>();
        for (const linha of todasAsLinhas) {
            const dias = diasRestantesDe(linha.lote?.data_validade ?? linha.produto.data_validade);
            if (dias !== null && dias <= DIAS_CRITICOS) marcados.add(linha.chave);
        }
        return marcados;
    }, [todasAsLinhas]);

    // Reaplica a seleção padrão a cada nova carga de lista (troca de janela/refresh).
    useEffect(() => {
        setSelecionados(new Set(selecaoPadrao));
    }, [selecaoPadrao]);

    /** Linhas para exibição, ordenadas conforme o filtro rápido escolhido
        (dias faltantes ou nome). */
    const linhas = useMemo((): LinhaValidade[] => {
        const comDias = todasAsLinhas.map((linha) => ({
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
    }, [todasAsLinhas, ordenacao]);

    const toggleSelecionado = (chave: string) => {
        setSelecionados((prev) => {
            const proximo = new Set(prev);
            if (proximo.has(chave)) proximo.delete(chave);
            else proximo.add(chave);
            return proximo;
        });
    };

    const selecionarTodos = () => setSelecionados(new Set(linhas.map((l) => l.chave)));
    const limparSelecao = () => setSelecionados(new Set());

    const sugestao = getSugestao();
    const percentual = Math.round(sugestao.desconto * 100);
    const selecionadas = linhas.filter((l) => selecionados.has(l.chave));
    const qtdSelecionados = selecionadas.length;
    const podeAplicar = sugestao.desconto > 0 && qtdSelecionados > 0 && !loading;

    /** Motivo visível quando o botão de aplicar está bloqueado (nada de botão-fantasma). */
    const motivoBloqueio = sugestao.desconto <= 0
        ? (timeframe === '90'
            ? 'Sem sugestão de desconto para 90 dias — escolha um percentual.'
            : 'Defina um percentual de desconto acima de 0%.')
        : qtdSelecionados === 0
            ? 'Marque ao menos um item para aplicar.'
            : null;

    /** Rótulo com a contagem: o dono vê exatamente quantos itens serão afetados. */
    const rotuloAplicar = loading
        ? 'Aplicando...'
        : sugestao.desconto > 0 && qtdSelecionados > 0
            ? `Aplicar ${percentual}% em ${qtdSelecionados} ${qtdSelecionados === 1 ? 'item' : 'itens'}`
            : 'Aplicar desconto';

    const handleApplyPromotions = async () => {
        if (sugestao.desconto <= 0) {
            // Nunca aplicar (nem parecer aplicar) sem percentual definido.
            showToast.error(timeframe === '90'
                ? 'Sem sugestão de desconto para 90 dias. Escolha um percentual acima de 0%.'
                : 'Defina um percentual de desconto acima de 0%.');
            return;
        }
        if (qtdSelecionados === 0) {
            showToast.error('Marque ao menos um item para aplicar o desconto.');
            return;
        }

        const atualizacoes = selecionadas.map((linha) => {
            const novoPreco = parseFloat((precoDaLinha(linha) * (1 - sugestao.desconto)).toFixed(2));
            return {
                id: linha.produto.id,
                lote_id: linha.lote && linha.lote.id != null ? linha.lote.id : undefined,
                novo_preco: novoPreco,
            };
        });

        // Confirmação nominal: o desconto sobrescreve o preço de venda e atinge
        // exatamente o que está marcado — mostrar quem, quantos e de quanto para quanto.
        const somaAntes = selecionadas.reduce((total, linha) => total + precoDaLinha(linha), 0);
        const somaDepois = somaAntes * (1 - sugestao.desconto);
        const nomes = selecionadas.slice(0, 3).map((linha) => linha.produto.nome).join(', ');
        const restantes = qtdSelecionados > 3 ? ` e mais ${qtdSelecionados - 3}` : '';
        const rotuloItens = qtdSelecionados === 1 ? 'item' : 'itens';

        const confirmado = await confirmar({
            titulo: `Aplicar ${percentual}% em ${qtdSelecionados} ${rotuloItens}?`,
            mensagem: `${nomes}${restantes}.\n\nDe ${formatCurrency(somaAntes)} para ${formatCurrency(somaDepois)} (soma dos preços).\n\nO desconto vira o novo preço de venda destes ${rotuloItens}. Ao receber o próximo lote, o preço precisa ser reajustado.`,
            acao: `Aplicar ${percentual}%`,
            cancelar: 'Revisar seleção',
        });
        if (!confirmado) return;

        try {
            setLoading(true);
            const response = await productsService.bulkUpdatePrices(atualizacoes);

            if (response.success) {
                // Aviso explícito: não existe preço promocional com data no cadastro,
                // então este desconto é definitivo até alguém reajustar o item.
                showToast.update(`${response.message} Preço definitivo: reajuste estes ${rotuloItens} na entrada do próximo lote.`);
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
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">Ordenar por:</span>
                        <select
                            value={ordenacao}
                            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
                            className="text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1.5"
                        >
                            <option value="dias_asc">Dias faltantes (menor → maior)</option>
                            <option value="dias_desc">Dias faltantes (maior → menor)</option>
                            <option value="nome_asc">Nome (A → Z)</option>
                        </select>

                        {(timeframe === '15' || timeframe === '30' || timeframe === '90') && (
                            <div className="flex items-center gap-2 ml-auto">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">Desconto a aplicar:</span>
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
                                    <span className="text-sm font-bold text-gray-500 dark:text-gray-400">%</span>
                                </div>
                            </div>
                        )}

                        {/* Seleção: o desconto em massa só atinge as linhas marcadas. */}
                        {timeframe !== 'vencidos' && (
                            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                    {qtdSelecionados} de {linhas.length} selecionados
                                </span>
                                <button
                                    type="button"
                                    onClick={selecionarTodos}
                                    className="min-h-[44px] px-3 text-xs font-bold rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                >
                                    Selecionar todos
                                </button>
                                <button
                                    type="button"
                                    onClick={limparSelecao}
                                    className="min-h-[44px] px-3 text-xs font-bold rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                >
                                    Limpar seleção
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-gray-500 font-medium dark:text-gray-400">Analisando estoque...</p>
                        </div>
                    ) : linhas.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
                                <TrendingDown className="w-10 h-10 text-green-600" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white">Nenhum produto crítico!</h3>
                            <p className="text-gray-500 dark:text-gray-400">Seu controle de validade está em dia.</p>
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
                            {linhas.map((linha) => {
                                const { produto: p, lote } = linha;
                                const precoAtual = precoDaLinha(linha);
                                const precoCusto = lote?.preco_custo ?? p.preco_custo ?? 0;
                                const precoSugerido = precoAtual * (1 - sugestao.desconto);
                                // Alerta visual: se o desconto ajustado deixar o preço abaixo do
                                // custo, o funcionário estaria vendendo no prejuízo — mostrar em
                                // vermelho para não passar despercebido.
                                const abaixoDoCusto = sugestao.desconto > 0 && precoCusto > 0 && precoSugerido < precoCusto;
                                const dataValidade = lote?.data_validade ?? p.data_validade;
                                const marcado = selecionados.has(linha.chave);
                                const idCheckbox = `sel-${linha.chave}`;
                                const diasRestantes = diasRestantesDe(dataValidade);

                                return (
                                    <div key={linha.chave} className={`flex flex-col gap-3 sm:grid sm:grid-cols-14 sm:gap-3 sm:items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all border ${marcado ? 'border-blue-200 dark:border-blue-800' : 'border-transparent hover:border-gray-200 dark:hover:border-gray-600'}`}>
                                        {/* Seleção do item + Produto / Lote */}
                                        <div className="sm:col-span-3 min-w-0 flex items-start gap-2">
                                            {timeframe !== 'vencidos' && (
                                                /* Alvo de toque >= 44px mesmo com o checkbox visual de 20px */
                                                <label htmlFor={idCheckbox} className="flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 cursor-pointer rounded-lg">
                                                    <input
                                                        id={idCheckbox}
                                                        type="checkbox"
                                                        checked={marcado}
                                                        onChange={() => toggleSelecionado(linha.chave)}
                                                        aria-label={`Selecionar ${p.nome}${lote ? ` — lote ${lote.numero_lote}` : ''}`}
                                                        className="w-5 h-5 accent-blue-600 cursor-pointer"
                                                    />
                                                </label>
                                            )}
                                            <div className="min-w-0">
                                                <p className="font-bold text-gray-900 dark:text-white truncate">{p.nome}</p>
                                                <p className="text-xs text-gray-500 truncate dark:text-gray-400">
                                                    {p.categoria_oficial_nome || p.categoria}{p.subcategoria_oficial_nome ? ` › ${p.subcategoria_oficial_nome}` : ''}
                                                    {lote ? ` | Lote: ${lote.numero_lote} (${lote.quantidade} un.)` : ` | Qtd: ${p.quantidade}`}
                                                </p>
                                            </div>
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
                <div className="p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div className="space-y-1">
                        <p className="text-xs text-gray-500 italic dark:text-gray-400">
                            * Sugestões baseadas nas melhores práticas de gestão de perecíveis.
                        </p>
                        {/* Motivo explícito do bloqueio: nunca um botão que não faz nada */}
                        {timeframe !== 'vencidos' && motivoBloqueio && (
                            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {motivoBloqueio}
                            </p>
                        )}
                    </div>
                    <div className="flex gap-3 justify-end">
                        <button onClick={onClose} className="px-6 py-2 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-all">
                            Fechar
                        </button>
                        {timeframe !== 'vencidos' && (
                            <button
                                onClick={handleApplyPromotions}
                                disabled={!podeAplicar}
                                title={motivoBloqueio ?? undefined}
                                className="px-6 py-2 min-h-[44px] bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
                            >
                                <TrendingDown className="w-5 h-5" /> {rotuloAplicar}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExpiringProductsModal;
