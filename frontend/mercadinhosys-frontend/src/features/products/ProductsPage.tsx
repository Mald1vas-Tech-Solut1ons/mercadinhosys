import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Calculator,
  X,
  PackageX
} from 'lucide-react';
import { Fornecedor, Produto, ProdutoFiltros, ProdutoLote } from '../../types';
import { productsService } from './productsService';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { formatCurrency } from '../../utils/formatters';

import ProductAnalyticsDashboard from './components/ProductAnalyticsDashboard';
import QuickFiltersPanel from './components/QuickFiltersPanel';
import ProductHistoryModal from './components/ProductHistoryModal';
import PurchaseOrdersPanel from './components/PurchaseOrdersPanel';
import PurchaseOrderModal from './components/PurchaseOrderModal';
import CommandToolbar from './components/CommandToolbar';

import ProductFormModal from './components/ProductFormModal';
import PinDialog from '../../components/modals/PinDialog';
import { ProductsTable } from './components/ProductsTable';
import LotesDisponiveisModal from './components/LotesDisponiveisModal';
import { InsightCard as ConsultorInsightCard } from '../../components/consultor/InsightCard';
import ExpiringProductsModal from './components/ExpiringProductsModal';
import ProductImportModal from './components/ProductImportModal';
import ProdutoDetalhesModal from './components/ProdutoDetalhesModal';
import AdvancedAnalyticsModal from './components/AdvancedAnalyticsModal';
import AdvancedFiltersModal from './components/AdvancedFiltersModal';

type LoteNoPeriodo = { id: number | null; numero_lote: string; data_validade: string | null; quantidade: number; preco_venda: number | null; preco_produto: number };
type ProdutoComLotes = Produto & { lotes_no_periodo?: LoteNoPeriodo[] };
type LinhaProdutoLote = { produto: ProdutoComLotes; lote: LoteNoPeriodo | null };

const ProductsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  // todosProdutos removed in favor of server-side stats
  const [loading, setLoading] = useState(true);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [stockLotes, setStockLotes] = useState<ProdutoLote[]>([]);
  const [loadingStockLotes, setLoadingStockLotes] = useState(false);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [stats, setStats] = useState({
    total_produtos: 0,
    produtos_baixo_estoque: 0,
    produtos_esgotados: 0,
    produtos_normal: 0,
    valor_total_estoque: 0,
    margem_media: 0,
    margem_alta: 0,
    margem_baixa: 0,
    classificacao_abc: { A: 0, B: 0, C: 0 },
    giro_estoque: { rapido: 0, normal: 0, lento: 0 },
    validade: { vencidos: 0, vence_15: 0, vence_30: 0, vence_90: 0 },
    top_produtos_margem: [] as any[],
    produtos_criticos: [] as any[]
  });

  const [filtros, setFiltros] = useState<ProdutoFiltros>({
    busca: '',
    ativos: true,
    ordenar_por: 'nome',
    direcao: 'asc',
  });
  const [buscaLocal, setBuscaLocal] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filtroRapido, setFiltroRapido] = useState<string | null>(null);

  const [showProductModal, setShowProductModal] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showMarkupCalculator, setShowMarkupCalculator] = useState(false);
  const [showProductHistory, setShowProductHistory] = useState(false);
  const [showPurchaseOrders, setShowPurchaseOrders] = useState(false);
  const [pedidoInicialFornecedor, setPedidoInicialFornecedor] = useState<number | undefined>(undefined);
  const [showLotesModal, setShowLotesModal] = useState(false);
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [expiryTimeframe, setExpiryTimeframe] = useState<'vencidos' | '15' | '30' | '90'>('30');
  const [showAdvancedAnalyticsModal, setShowAdvancedAnalyticsModal] = useState(false);
  const [advancedAnalyticsType, setAdvancedAnalyticsType] = useState<string>('');

  const [selectedProduct, setSelectedProduct] = useState<Produto | null>(null);
  const [selectedProductForOrder, setSelectedProductForOrder] = useState<Produto | null>(null);
  const [editMode, setEditMode] = useState(false);
  // Gate de PIN para operações sensíveis (editar/desativar/descartar)
  const [pinAction, setPinAction] = useState<{ run: () => void; title: string; description: string } | null>(null);
  const requirePin = (run: () => void, title: string, description: string) =>
    setPinAction({ run, title, description });

  // Regra sênior: operações sensíveis pedem o PIN ANTES de iniciar o fluxo, nunca
  // depois. Aqui o descarte só abre o formulário de perda após o PIN ser validado —
  // ponto de entrada único usado pela tabela, pelo modal de vencidos e por deep-link.
  const abrirFluxoDescarte = (produto: Produto, motivoPadrao: string = '') => {
    requirePin(
      () => {
        setSelectedProduct(produto);
        setDiscardData({ quantidade: 0, motivo_especifico: motivoPadrao || 'Avaria', observacoes: '' });
        setShowDiscardModal(true);
      },
      'Autorizar descarte',
      `Autorize com o PIN para registrar a perda de "${produto.nome}".`,
    );
  };
  const [returnToRoute, setReturnToRoute] = useState<string | null>(null);

  const [stockAdjust, setStockAdjust] = useState({
    quantidade: 0,
    operacao: 'entrada' as 'entrada' | 'saida',
    motivo: '',
    fonte: 'Estoque Loja / Geral', // NOVO: Fonte do ajuste
    fornecedor_id: undefined as number | undefined,
    lote_id: undefined as number | undefined,
    corrigir_lote_existente: false,
    lote: '',
    data_fabricacao: '',
    data_validade: '',
  });

  const [markupCalc, setMarkupCalc] = useState({
    preco_custo: 0,
    markup: 30,
    preco_venda: 0,
  });

  const [discardData, setDiscardData] = useState({
    quantidade: 0,
    motivo_especifico: 'Vencido',
    observacoes: '',
  });

  // Data Loading
  const loadProdutos = useCallback(async () => {
    try {
      setLoading(true);
      const response = await productsService.getAllEstoque(page, 25, filtros);
      setProdutos(response?.produtos ?? []);
      setTotalPages(response?.paginacao?.total_paginas ?? 1);
      setTotalItems(response?.paginacao?.total_itens ?? 0);
    } catch (error: any) {
      console.error('Erro ao carregar produtos:', error);
      showToast.error('Erro ao carregar produtos');
      setProdutos([]);
    } finally {
      setLoading(false);
    }
  }, [page, filtros]);

  const loadStats = useCallback(async () => {
    try {
      const response = await productsService.getEstatisticas(filtros);
      if (response.success && response.estatisticas) {
        setStats({
          ...response.estatisticas,
          margem_alta: response.estatisticas.margem_alta ?? 0,
          margem_baixa: response.estatisticas.margem_baixa ?? 0,
          validade: response.estatisticas.validade || { vencidos: 0, vence_15: 0, vence_30: 0, vence_90: 0 }
        });
      }
    } catch (error: any) {
      console.error('Erro ao carregar estatísticas:', error);
    }
  }, [filtros]);

  const loadCategorias = useCallback(async () => {
    try {
      const response = await productsService.getCategorias(true);
      setCategorias(response.categorias);
    } catch (error: any) {
      console.error('Erro ao carregar categorias:', error);
    }
  }, []);

  const loadFornecedores = useCallback(async () => {
    try {
      const response = await apiClient.get<{ fornecedores: Fornecedor[] }>('/fornecedores/', { params: { per_page: 100 } });
      setFornecedores(response.data.fornecedores || []);
    } catch (error: any) {
      console.error('Erro ao carregar fornecedores:', error);
    }
  }, []);

  useEffect(() => {
    // Guard de igualdade: sem ele, o debounce criava um objeto novo de filtros
    // mesmo com a busca inalterada — recarregando lista e estatísticas em dobro
    // já na abertura da página.
    const timer = setTimeout(() => {
      setFiltros(prev => (prev.busca === buscaLocal ? prev : { ...prev, busca: buscaLocal }));
    }, 500);
    return () => clearTimeout(timer);
  }, [buscaLocal]);

  // Carrega apenas no mount (não depende de filtros)
  useEffect(() => {
    loadCategorias();
    loadFornecedores();
  }, [loadCategorias, loadFornecedores]);

  // Carrega produtos quando página ou filtros mudam
  useEffect(() => {
    loadProdutos();
  }, [loadProdutos]);

  // Stats carregam com debounce quando filtros mudam, sem bloquear a listagem
  useEffect(() => {
    const timer = setTimeout(() => { loadStats(); }, 600);
    return () => clearTimeout(timer);
  }, [loadStats]);

  // Handle location state for opening modals from Hub
  // Guarda de reprocessamento: produtos recarregam várias vezes (ajuste de
  // estoque, refresh) e o location.state não muda — sem a guarda, o modal
  // REABRIA sozinho depois de cada ação (a "dificuldade" de navegação do Hub).
  const stateTratadoRef = useRef<unknown>(null);

  useEffect(() => {
    if (!location.state || stateTratadoRef.current === location.state) return;
    const state = location.state as any;

    // O Hub envia o próprio objeto do produto (state.produto): o modal abre
    // IMEDIATAMENTE, sem esperar a lista carregar. Antes o clique ficava
    // travado até a listagem terminar e falhava em silêncio se o produto não
    // estivesse na página atual (25 itens por página).
    const resolver = (id?: number): Produto | undefined => {
      if (state.produto && (!id || state.produto.id === id)) return state.produto as Produto;
      return produtos.find(p => p.id === id);
    };

    let tratado = true;

    if (state.openHistoryFor) {
      const prod = resolver(state.openHistoryFor);
      if (prod) { setSelectedProduct(prod); setShowProductHistory(true); } else tratado = false;
    } else if (state.openAdjustFor) {
      const prod = resolver(state.openAdjustFor);
      if (prod) { openStockModal(prod); } else tratado = false;
    } else if (state.openDiscardFor) {
      const prod = resolver(state.openDiscardFor);
      if (prod) { abrirFluxoDescarte(prod); } else tratado = false;
    } else if (state.openEditFor) {
      const prod = resolver(state.openEditFor);
      // Deep-link do HUB também exige PIN ANTES de abrir a edição — mesma
      // regra do botão de editar da lista (openEditModal).
      if (prod) { openEditModal(prod); } else tratado = false;
    } else if (state.openDeleteFor) {
      // Exclusão vinda do Hub passa pelo MESMO fluxo com PIN da lista — o
      // botão do Hub excluía com window.confirm, pulando o PIN.
      const prod = resolver(state.openDeleteFor);
      if (prod) { handleDelete(prod.id, prod); } else tratado = false;
    } else if (state.abrirPedido) {
      // Deep-link "Fazer Pedido" vindo do card de fornecedor no dashboard:
      // abre o painel de pedidos já com o fornecedor selecionado.
      setPedidoInicialFornecedor(state.fornecedorId);
      setShowPurchaseOrders(true);
    }

    if (tratado) {
      if (state.returnTo) setReturnToRoute(state.returnTo);
      stateTratadoRef.current = location.state;
      // Clear state so it doesn't reopen on reload
      window.history.replaceState({}, document.title);
    }
    // Sem snapshot e produto ainda não listado: mantém o state para
    // reprocessar quando a lista carregar.
  }, [location.state, produtos]);

  const handleCloseModal = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(false);
    if (returnToRoute) {
      const route = returnToRoute;
      setReturnToRoute(null);
      navigate(route);
    }
  };

  // Handlers
  const doDelete = async (id: number) => {
    try {
      await showToast.promise(productsService.delete(id, true), {
        loading: 'Excluindo produto...',
        success: 'Produto excluído definitivamente!',
        error: 'Erro ao excluir produto'
      });
      loadProdutos();
      loadStats();
    } catch {
      // Erro já tratado pelo promise
    }
  };

  const handleDelete = (id: number, produtoRef?: Produto) => {
    const prod = produtoRef ?? produtos.find(p => p.id === id);
    requirePin(
      () => doDelete(id),
      'Excluir produto',
      `Autorize com o PIN para EXCLUIR DEFINITIVAMENTE ${prod ? `"${prod.nome}"` : 'este produto'}. Esta ação não pode ser desfeita.`,
    );
  };

  const handleStockAdjust = async () => {
    if (!selectedProduct || !stockAdjust.motivo.trim()) {
      showToast.error('Informe o motivo do ajuste');
      return;
    }
    if (stockAdjust.quantidade <= 0 && !(stockAdjust.operacao === 'entrada' && stockAdjust.corrigir_lote_existente && stockAdjust.lote_id)) {
      showToast.error('Informe uma quantidade válida');
      return;
    }
    try {
      const motivoFinal = stockAdjust.fonte ? `[Origem: ${stockAdjust.fonte}] ${stockAdjust.motivo}` : stockAdjust.motivo;
      
      await showToast.promise(
        productsService.ajustarEstoque(
          selectedProduct.id, 
          stockAdjust.quantidade, 
          stockAdjust.operacao, 
          motivoFinal,
          undefined, // observacoes
          stockAdjust.fornecedor_id,
          stockAdjust.lote,
          stockAdjust.data_fabricacao,
          stockAdjust.data_validade,
          stockAdjust.lote_id,
          stockAdjust.corrigir_lote_existente
        ), 
        {
          loading: stockAdjust.corrigir_lote_existente ? 'Salvando lote...' : 'Ajustando estoque...',
          success: stockAdjust.corrigir_lote_existente ? 'Lote atualizado com sucesso!' : 'Estoque ajustado com sucesso!',
          error: 'Erro ao ajustar estoque'
        }
      );
      setShowStockModal(false);
      loadProdutos();
      loadStats();
    } catch {
      // Erro já tratado pelo promise
    }
  };

  const doDiscard = async () => {
    if (!selectedProduct) return;
    try {
      await showToast.promise(
        productsService.descartarProduto(
          selectedProduct.id,
          discardData.quantidade,
          discardData.motivo_especifico,
          discardData.observacoes
        ),
        {
          loading: 'Processando descarte...',
          success: 'Descarte realizado e prejuízo registrado!',
          error: (err: any) => err.response?.data?.message || 'Erro ao processar descarte'
        }
      );
      setShowDiscardModal(false);
      loadProdutos();
      loadStats();
    } catch (error: any) {
      console.error('Erro no descarte:', error);
    }
  };

  const handleDiscard = () => {
    if (!selectedProduct) return;
    if (discardData.quantidade <= 0) {
      showToast.error('Quantidade deve ser maior que zero');
      return;
    }
    // O PIN já foi validado ao abrir este fluxo (abrirFluxoDescarte). Aqui apenas
    // executa — não pedimos PIN de novo para não duplicar a autorização.
    doDiscard();
  };

  const handleExportCSV = async () => {
    try {
      const response = await productsService.exportarCSV(true);
      const blob = new Blob([response.csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `produtos_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      showToast.info(`${response.total_produtos} produtos exportados!`);
    } catch {
      showToast.error('Erro ao exportar');
    }
  };

  const openEditModal = (produto: Produto) => {
    requirePin(
      () => {
        setSelectedProduct(produto);
        setEditMode(true);
        setShowProductModal(true);
      },
      'Editar produto',
      `Autorize com o PIN para editar "${produto.nome}".`,
    );
  };

  const aplicarLoteSelecionadoNoAjuste = useCallback((loteId?: number) => {
    const loteSelecionado = stockLotes.find((item) => item.id === loteId);
    setStockAdjust(prev => ({
      ...prev,
      lote_id: loteSelecionado?.id,
      lote: loteSelecionado?.numero_lote || '',
      data_fabricacao: loteSelecionado?.data_fabricacao || '',
      data_validade: loteSelecionado?.data_validade || '',
      fornecedor_id: loteSelecionado?.fornecedor_id ?? prev.fornecedor_id,
    }));
  }, [stockLotes]);

  const carregarLotesParaAjuste = useCallback(async (produtoId: number) => {
    try {
      setLoadingStockLotes(true);
      const response = await productsService.getLotesDisponiveis(produtoId);
      setStockLotes((response.lotes || []) as ProdutoLote[]);
    } catch (error) {
      console.error('Erro ao carregar lotes do produto:', error);
      setStockLotes([]);
    } finally {
      setLoadingStockLotes(false);
    }
  }, []);

  const openStockModal = (produto: Produto) => {
    setSelectedProduct(produto);
    setStockAdjust({ 
      quantidade: 0, 
      operacao: 'entrada', 
      motivo: '',
      fonte: 'Estoque Loja / Geral',
      fornecedor_id: undefined,
      lote_id: undefined,
      corrigir_lote_existente: false,
      lote: '',
      data_fabricacao: '',
      data_validade: ''
    });
    setStockLotes([]);
    carregarLotesParaAjuste(produto.id);
    setShowStockModal(true);
  };

  const openOrderModal = (produto: Produto) => {
    setSelectedProductForOrder(produto);
  };

  const openDetailModal = (produto: Produto) => {
    navigate(`/products/${produto.id}`);
  };

  const calcularMarkup = () => {
    const precoVenda = markupCalc.preco_custo * (1 + markupCalc.markup / 100);
    setMarkupCalc(prev => ({ ...prev, preco_venda: parseFloat(precoVenda.toFixed(2)) }));
  };

  const handleCardClick = (filterType: string) => {
    // Limpa outros filtros ao clicar no dashboard
    setFiltros({ busca: '', ativos: true, ordenar_por: 'nome', direcao: 'asc' });
    setFiltroRapido(null); // Desativar filtro rápido se houver lógica conflitante
    setBuscaLocal(''); // Input de busca acompanha — antes exibia um texto que não estava aplicado

    if (filterType === 'esgotado') {
      setFiltros(prev => ({ ...prev, estoque_status: 'esgotado' }));
    } else if (filterType === 'baixo') {
      setFiltros(prev => ({ ...prev, estoque_status: 'baixo' }));
    } else if (filterType === 'normal') {
      setFiltros(prev => ({ ...prev, estoque_status: 'normal' }));
    } else if (filterType === 'valor') {
      // Ordenar por valor total de estoque
      setFiltros(prev => ({ ...prev, ordenar_por: 'valor_total_estoque', direcao: 'desc' }));
    } else if (filterType === 'margem') {
      // Ordenar por margem
      setFiltros(prev => ({ ...prev, ordenar_por: 'margem_lucro', direcao: 'desc' }));
    } else if (filterType === 'vencido' || filterType === 'vence_15' || filterType === 'vence_30' || filterType === 'vence_90') {
      const timeframeMap: Record<string, 'vencidos' | '15' | '30' | '90'> = {
        'vencido': 'vencidos',
        'vence_15': '15',
        'vence_30': '30',
        'vence_90': '90'
      };
      setExpiryTimeframe(timeframeMap[filterType]);
      setShowExpiryModal(true);

      // Também filtra a tabela por consistência
      if (filterType === 'vencido') {
        setFiltros(prev => ({ ...prev, vencidos: true, validade_proxima: false, ordenar_por: 'data_validade', direcao: 'asc' }));
      } else {
        const days = parseInt(filterType.split('_')[1]);
        setFiltros(prev => ({ ...prev, validade_proxima: true, vencidos: false, dias_validade: days, ordenar_por: 'data_validade', direcao: 'asc' }));
      }
    }

    setPage(1);
  };

  const handleQuickFilterChange = (filter: string | null) => {
    setFiltroRapido(filter);
    setBuscaLocal('');

    // Resetar filtros base e aplicar o específico
    const novosFiltros: ProdutoFiltros = { busca: '', ativos: true, ordenar_por: 'nome', direcao: 'asc' };

    if (filter === 'vencimento_proximo') {
      novosFiltros.validade_proxima = true;
      novosFiltros.dias_validade = 30;
      novosFiltros.ordenar_por = 'data_validade';
      novosFiltros.direcao = 'asc';
    } else if (filter === 'vencido') {
      novosFiltros.vencidos = true;
      novosFiltros.ordenar_por = 'data_validade';
      novosFiltros.direcao = 'asc';
    } else if (filter === 'classe_a') {
      novosFiltros.filtro_rapido = 'classe_a';
      novosFiltros.ordenar_por = 'total_vendido';
      novosFiltros.direcao = 'desc';
    } else if (filter === 'classe_b') {
      novosFiltros.filtro_rapido = 'classe_b';
      novosFiltros.ordenar_por = 'total_vendido';
      novosFiltros.direcao = 'desc';
    } else if (filter === 'classe_c') {
      novosFiltros.filtro_rapido = 'classe_c';
      novosFiltros.ordenar_por = 'total_vendido';
      novosFiltros.direcao = 'asc';
    } else if (filter === 'repor_urgente') {
      novosFiltros.filtro_rapido = 'repor_urgente';
      novosFiltros.ordenar_por = 'quantidade';
      novosFiltros.direcao = 'asc';
    } else if (filter === 'margem_alta') {
      novosFiltros.filtro_rapido = 'margem_alta';
      novosFiltros.ordenar_por = 'margem_lucro';
      novosFiltros.direcao = 'desc';
    } else if (filter === 'margem_baixa') {
      novosFiltros.filtro_rapido = 'margem_baixa';
      novosFiltros.ordenar_por = 'margem_lucro';
      novosFiltros.direcao = 'asc';
    } else if (filter === 'giro_rapido') {
      novosFiltros.filtro_rapido = 'giro_rapido';
      novosFiltros.ordenar_por = 'ultima_venda';
      novosFiltros.direcao = 'desc';
    } else if (filter === 'giro_normal') {
      novosFiltros.filtro_rapido = 'giro_normal';
      novosFiltros.ordenar_por = 'ultima_venda';
      novosFiltros.direcao = 'desc';
    } else if (filter === 'giro_lento') {
      novosFiltros.filtro_rapido = 'giro_lento';
      novosFiltros.ordenar_por = 'ultima_venda';
      novosFiltros.direcao = 'asc';
    }

    setFiltros(novosFiltros);
    setPage(1);
  };

  // Aplica filtro vindo da URL (dashboard -> /products?filtro=baixo|validade|repor_urgente|classe_a...).
  // Torna os cards/recomendações do dashboard acionáveis: o clique já abre a lista filtrada.
  useEffect(() => {
    const f = new URLSearchParams(location.search).get('filtro');
    if (!f) return;
    if (f === 'baixo' || f === 'esgotado' || f === 'normal') handleCardClick(f);
    else if (f === 'validade' || f === 'vencimento_proximo') handleQuickFilterChange('vencimento_proximo');
    else if (f === 'vencido') handleQuickFilterChange('vencido');
    else if (['repor_urgente', 'classe_a', 'classe_b', 'classe_c', 'margem_alta', 'margem_baixa', 'giro_rapido', 'giro_lento'].includes(f)) handleQuickFilterChange(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const handleSort = (key: string) => {
    setFiltros(prev => ({
      ...prev,
      ordenar_por: key,
      direcao: prev.ordenar_por === key && prev.direcao === 'asc' ? 'desc' : 'asc'
    }));
    setPage(1);
  };

  const linhasPorLote = useMemo((): LinhaProdutoLote[] => {
    if (!filtros.expandir_por_lote || !Array.isArray(produtos) || produtos.length === 0) return [];
    const out: LinhaProdutoLote[] = [];
    for (const p of produtos as ProdutoComLotes[]) {
      const lotes = p.lotes_no_periodo && p.lotes_no_periodo.length > 0 ? p.lotes_no_periodo : null;
      if (lotes) {
        for (const lote of lotes) out.push({ produto: p, lote });
      } else {
        out.push({ produto: p, lote: null });
      }
    }
    return out;
  }, [produtos, filtros.expandir_por_lote]);

  const currentTableData = {
    produtos: Array.isArray(produtos) ? produtos : [],
    totalItems: totalItems,
    totalPages: totalPages,
    linhasPorLote: filtros.expandir_por_lote ? linhasPorLote : undefined,
  };

  const contadoresFiltros = useMemo(() => ({
    total: stats.total_produtos,
    esgotado: stats.produtos_esgotados,
    baixo: stats.produtos_baixo_estoque,
    normal: stats.produtos_normal,
    classe_a: stats.classificacao_abc?.A || 0,
    classe_c: stats.classificacao_abc?.C || 0,
    giro_rapido: stats.giro_estoque?.rapido || 0,
    giro_lento: stats.giro_estoque?.lento || 0,
    margem_alta: stats.margem_alta ?? 0,
    margem_baixa: stats.margem_baixa ?? 0,
    repor_urgente: stats.produtos_esgotados + stats.produtos_baixo_estoque,
    sem_fornecedor: 0,
    vencimento_proximo: stats.validade?.vence_30 || 0,
    vencido: stats.validade?.vencidos || 0
  }), [stats]);

  return (
    <div className="space-y-6 p-6">

      <div className="tour-produtos-upload">
        <CommandToolbar 
          onNew={() => { setEditMode(false); setSelectedProduct(null); setShowProductModal(true); }}
          onRefresh={loadProdutos}
          onPurchaseOrders={() => setShowPurchaseOrders(true)}
          onMarkup={() => setShowMarkupCalculator(true)}
          onImport={() => setShowImportModal(true)}
          onExport={handleExportCSV}
          search={buscaLocal}
          onSearchChange={setBuscaLocal}
          onToggleFilters={() => setShowFilters(!showFilters)}
          showFilters={showFilters}
        />
      </div>

      <ConsultorInsightCard especialista="estoque" titulo="Consultor IA - Inteligência de Estoque" className="mb-2" />

      <ProductAnalyticsDashboard 
        produtos={produtos} 
        stats={stats} 
        onCardClick={handleCardClick} 
        onAdvancedAnalyticsClick={(type) => {
          setAdvancedAnalyticsType(type);
          setShowAdvancedAnalyticsModal(true);
        }}
        onProductClick={openDetailModal}
      />

      <QuickFiltersPanel activeFilter={filtroRapido} onFilterChange={handleQuickFilterChange} counts={contadoresFiltros} />

      <AdvancedFiltersModal
        show={showFilters}
        onClose={() => setShowFilters(false)}
        filtros={filtros}
        categorias={categorias}
        fornecedores={fornecedores}
        onApply={(novosFiltros) => {
          // Troca atômica: uma única fonte de verdade. O chip de filtro rápido
          // acompanha o que foi aplicado — antes "Limpar" no modal zerava o
          // filtro mas o chip continuava aceso.
          setFiltros(novosFiltros);
          setFiltroRapido(novosFiltros.filtro_rapido ?? null);
          setBuscaLocal(novosFiltros.busca ?? '');
          setShowFilters(false);
          setPage(1);
        }}
      />

      <div className="products-table-wrapper">
        <ProductsTable
          produtos={currentTableData.produtos}
        linhasPorLote={currentTableData.linhasPorLote}
        loading={loading}
        totalItems={currentTableData.totalItems}
        page={page}
        totalPages={currentTableData.totalPages}
        onPageChange={setPage}
        onEdit={openEditModal}
        onDelete={handleDelete}
        onStockAdjust={openStockModal}
        onHistory={(p) => { setSelectedProduct(p); setShowProductHistory(true); }}
        onMakeOrder={openOrderModal}
        onViewLotes={(p) => { setSelectedProduct(p); setShowLotesModal(true); }}
        onDiscard={(p) => abrirFluxoDescarte(p)}
        onProductClick={openDetailModal}
        onSort={handleSort}
        sortConfig={{ key: filtros.ordenar_por || 'nome', direction: filtros.direcao || 'asc' }}
      />
      </div>

      <ProductFormModal
        show={showProductModal}
        editMode={editMode}
        produto={selectedProduct}
        categorias={categorias}
        onClose={() => { handleCloseModal(setShowProductModal); setSelectedProduct(null); setEditMode(false); }}
        onSuccess={() => { handleCloseModal(setShowProductModal); loadProdutos(); loadStats(); }}
      />

      <PinDialog
        open={!!pinAction}
        title={pinAction?.title}
        description={pinAction?.description}
        onSuccess={() => { const a = pinAction; setPinAction(null); a?.run(); }}
        onClose={() => setPinAction(null)}
      />

      {showStockModal && selectedProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-200 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-bold">Ajustar Estoque</h3>
              <button onClick={() => setShowStockModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                <p className="font-medium">{selectedProduct.nome}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Estoque atual: {selectedProduct.quantidade} {selectedProduct.unidade_medida}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Operação</label>
                  <select value={stockAdjust.operacao} onChange={(e) => setStockAdjust(prev => ({ ...prev, operacao: e.target.value as 'entrada' | 'saida' }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600">
                    <option value="entrada">Entrada (+)</option>
                    <option value="saida">Saída (-)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Quantidade</label>
                  <input type="number" min={stockAdjust.operacao === 'entrada' && stockAdjust.corrigir_lote_existente ? "0" : "1"} value={stockAdjust.quantidade} onChange={(e) => setStockAdjust(prev => ({ ...prev, quantidade: parseInt(e.target.value) || 0 }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
                  {stockAdjust.operacao === 'entrada' && stockAdjust.corrigir_lote_existente && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-300 mt-1">
                      Use `0` para apenas corrigir lote, fabricação e validade sem mexer no estoque.
                    </p>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Fonte / Origem do Ajuste *</label>
                <input 
                  type="text" 
                  value={stockAdjust.fonte} 
                  onChange={(e) => setStockAdjust(prev => ({ ...prev, fonte: e.target.value }))} 
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" 
                  placeholder="Ex: Estoque Loja, Veículo 1, Caminhão..." 
                  list="fontes-sugestoes"
                />
                <datalist id="fontes-sugestoes">
                  <option value="Estoque Loja / Geral" />
                  <option value="Veículo de Entrega" />
                  <option value="Veículo do Proprietário" />
                  <option value="Fornecedor (Devolução)" />
                  <option value="Perda / Avaria (Prateleira)" />
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Motivo / Justificativa *</label>
                <textarea value={stockAdjust.motivo} onChange={(e) => setStockAdjust(prev => ({ ...prev, motivo: e.target.value }))} rows={2} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" placeholder="Informe o motivo do ajuste..." />
              </div>

              {stockAdjust.operacao === 'entrada' && (
                <div className="bg-blue-50/50 dark:bg-blue-900/10 p-3 rounded-xl border border-blue-100 dark:border-blue-800 space-y-3">
                  <h4 className="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-widest">Informações Adicionais (Opcional)</h4>
                  {stockLotes.length > 0 && (
                    <div className="space-y-2">
                      <label className="flex items-start gap-2 text-xs font-medium text-blue-900 dark:text-blue-200">
                        <input
                          type="checkbox"
                          checked={stockAdjust.corrigir_lote_existente}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setStockAdjust(prev => ({
                              ...prev,
                              corrigir_lote_existente: checked,
                              lote_id: checked ? prev.lote_id ?? stockLotes[0]?.id : undefined,
                              quantidade: checked ? prev.quantidade : prev.quantidade,
                            }));
                            if (checked) {
                              aplicarLoteSelecionadoNoAjuste(stockAdjust.lote_id ?? stockLotes[0]?.id);
                            }
                          }}
                        />
                        <span>
                          Corrigir um lote existente em vez de criar outro.
                          <span className="block text-[11px] text-blue-700/80 dark:text-blue-300/80">
                            Ideal para ajustar o lote recém-recebido quando faltou informar fabricação ou validade.
                          </span>
                        </span>
                      </label>
                      {stockAdjust.corrigir_lote_existente && (
                        <div>
                          <label className="block text-xs font-medium mb-1">Lote existente</label>
                          <select
                            value={stockAdjust.lote_id || ''}
                            onChange={(e) => aplicarLoteSelecionadoNoAjuste(e.target.value ? Number(e.target.value) : undefined)}
                            className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                          >
                            <option value="">-- Selecione um lote --</option>
                            {stockLotes.map((lote) => (
                              <option key={lote.id} value={lote.id}>
                                {lote.numero_lote} • {lote.quantidade} un • {lote.data_validade}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                  {loadingStockLotes && (
                    <p className="text-[11px] text-blue-700 dark:text-blue-300">Carregando lotes já existentes...</p>
                  )}
                  <div>
                    <label className="block text-xs font-medium mb-1">Fornecedor (Origem)</label>
                    <select value={stockAdjust.fornecedor_id || ''} onChange={(e) => setStockAdjust(prev => ({ ...prev, fornecedor_id: e.target.value ? Number(e.target.value) : undefined }))} className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600">
                      <option value="">-- Nenhum --</option>
                      {fornecedores.map(f => (
                        <option key={f.id} value={f.id}>{f.nome_fantasia || f.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Nº Lote</label>
                      <input type="text" value={stockAdjust.lote} onChange={(e) => setStockAdjust(prev => ({ ...prev, lote: e.target.value }))} className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600" placeholder="L2024..." />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Fabricação</label>
                      <input type="date" value={stockAdjust.data_fabricacao} onChange={(e) => setStockAdjust(prev => ({ ...prev, data_fabricacao: e.target.value }))} className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Validade</label>
                    <input type="date" value={stockAdjust.data_validade} onChange={(e) => setStockAdjust(prev => ({ ...prev, data_validade: e.target.value }))} className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t dark:border-gray-700 shrink-0" style={{ paddingBottom: 'max(1rem, calc(0.5rem + env(safe-area-inset-bottom)))' }}>
              <button onClick={() => setShowStockModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={handleStockAdjust} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {showDiscardModal && selectedProduct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-150 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between p-6 border-b dark:border-slate-800 bg-rose-50/50 dark:bg-rose-900/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
                  <PackageX className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Registrar Perda</h3>
                  <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Gestão Profissional</p>
                </div>
              </div>
              <button onClick={() => setShowDiscardModal(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-6 md:p-8 space-y-6 overflow-y-auto flex-1">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-center shrink-0">
                <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Produto para Descarte</p>
                <p className="text-xl font-black text-slate-900 dark:text-white">{selectedProduct.nome}</p>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <span className="text-xs font-bold px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300">
                    Estoque: {selectedProduct.quantidade} {selectedProduct.unidade_medida}
                  </span>
                  <span className="text-xs font-bold px-2 py-1 bg-rose-100 dark:bg-rose-900/30 rounded-md text-rose-600 dark:text-rose-400">
                    Custo: {formatCurrency(selectedProduct.preco_custo)}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 ml-1">Quantidade a Descartar</label>
                  <input
                    type="number"
                    max={selectedProduct.quantidade}
                    value={discardData.quantidade}
                    onChange={(e) => setDiscardData(prev => ({ ...prev, quantidade: parseFloat(e.target.value) || 0 }))}
                    className="w-full text-3xl font-black text-center py-4 bg-slate-50 dark:bg-slate-800/50 border-2 border-transparent focus:border-rose-500 rounded-2xl outline-none transition-all tabular-nums text-slate-900 dark:text-white"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 ml-1">Motivo Profissional</label>
                  <select
                    value={discardData.motivo_especifico}
                    onChange={(e) => setDiscardData(prev => ({ ...prev, motivo_especifico: e.target.value }))}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl outline-none focus:border-rose-500 font-bold text-slate-700 dark:text-slate-200 appearance-none"
                  >
                    <option value="Vencido">Produto Vencido</option>
                    <option value="Avariado">Produto Estragado/Avariado</option>
                    <option value="Quebra">Quebra de Manuseio</option>
                    <option value="Extravio">Extravio / Furto</option>
                    <option value="Outros">Outros Motivos</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 ml-1">Observações Internas</label>
                  <textarea
                    value={discardData.observacoes}
                    onChange={(e) => setDiscardData(prev => ({ ...prev, observacoes: e.target.value }))}
                    rows={2}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl outline-none focus:border-rose-500 font-medium text-slate-700 dark:text-slate-200 text-sm"
                    placeholder="Detalhes adicionais sobre a perda..."
                  />
                </div>
              </div>

              {/* Impacto Financeiro Preview */}
              <div className="p-4 bg-rose-50 dark:bg-rose-900/10 rounded-2xl border border-rose-100 dark:border-rose-500/20 text-center">
                <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Impacto Previsto em Despesas</p>
                <p className="text-2xl font-black text-rose-600 dark:text-rose-400 tabular-nums">
                  {formatCurrency(discardData.quantidade * selectedProduct.preco_custo)}
                </p>
              </div>
            </div>

            <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex gap-3 shrink-0" style={{ paddingBottom: 'max(1rem, calc(1rem + env(safe-area-inset-bottom)))' }}>
              <button
                onClick={() => setShowDiscardModal(false)}
                className="flex-1 py-4 px-6 rounded-2xl font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-all uppercase text-xs tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={handleDiscard}
                disabled={discardData.quantidade <= 0 || discardData.quantidade > selectedProduct.quantidade}
                className={`flex-1 py-4 px-6 rounded-2xl font-black flex items-center justify-center gap-3 transition-all uppercase text-xs tracking-widest shadow-lg ${discardData.quantidade > 0 && discardData.quantidade <= selectedProduct.quantidade
                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/20 active:scale-95'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'
                  }`}
              >
                Confirmar Descarte
              </button>
            </div>
          </div>
        </div>
      )}

      {showMarkupCalculator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-200 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-bold flex items-center gap-2"><Calculator className="w-5 h-5" />Calculadora de Markup</h3>
              <button onClick={() => setShowMarkupCalculator(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4 flex-1 overflow-y-auto" style={{ paddingBottom: 'max(1rem, calc(1rem + env(safe-area-inset-bottom)))' }}>
              <div>
                <label className="block text-sm font-medium mb-1">Preco de Custo</label>
                <input type="number" step="0.01" value={markupCalc.preco_custo} onChange={(e) => setMarkupCalc(prev => ({ ...prev, preco_custo: parseFloat(e.target.value) || 0 }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Markup (%)</label>
                <input type="number" step="0.1" value={markupCalc.markup} onChange={(e) => setMarkupCalc(prev => ({ ...prev, markup: parseFloat(e.target.value) || 0 }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
              </div>
              <button onClick={calcularMarkup} className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">Calcular</button>
              <div className="bg-purple-50 dark:bg-purple-900 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-600 dark:text-gray-400">Preco de Venda Sugerido</p>
                <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{formatCurrency(markupCalc.preco_venda)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProductHistory && selectedProduct && (
        <ProductHistoryModal produto={selectedProduct as any} onClose={() => { handleCloseModal(setShowProductHistory); setSelectedProduct(null); }} />
      )}

      <PurchaseOrdersPanel isOpen={showPurchaseOrders} onClose={() => { setShowPurchaseOrders(false); setPedidoInicialFornecedor(undefined); }} fornecedores={fornecedores} initialSupplierId={pedidoInicialFornecedor} />

      {selectedProductForOrder && (
        <PurchaseOrderModal
          isOpen={!!selectedProductForOrder}
          onClose={() => setSelectedProductForOrder(null)}
          onSuccess={() => { setSelectedProductForOrder(null); loadProdutos(); }}
          fornecedores={fornecedores}
          initialProduct={selectedProductForOrder as Produto}
          initialSupplierId={selectedProductForOrder?.fornecedor_id}
        />
      )}

      {showLotesModal && selectedProduct && (
        <LotesDisponiveisModal
          produtoId={selectedProduct.id}
          produtoNome={selectedProduct.nome}
          onClose={() => { setShowLotesModal(false); setSelectedProduct(null); }}
        />
      )}

      <ExpiringProductsModal
        isOpen={showExpiryModal}
        onClose={() => {
          setShowExpiryModal(false);
          loadStats();
          loadProdutos();
        }}
        timeframe={expiryTimeframe}
        onDiscard={(produto) => abrirFluxoDescarte(produto, 'Vencido')}
      />

      <AdvancedAnalyticsModal
        isOpen={showAdvancedAnalyticsModal}
        onClose={() => setShowAdvancedAnalyticsModal(false)}
        type={advancedAnalyticsType}
      />

      <ProductImportModal
        show={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={() => {
          loadProdutos();
          loadStats();
          loadCategorias();
        }}
      />

      {showDetailModal && selectedProduct && (
        <ProdutoDetalhesModal
          produto={selectedProduct}
          onClose={() => { setShowDetailModal(false); setSelectedProduct(null); }}
        />
      )}
    </div>
  );
};

export default ProductsPage;
