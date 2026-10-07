import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { showToast } from '../../utils/toast';
import toast from 'react-hot-toast';
import {
    ShoppingCart,
    Check,
    CreditCard,
    Plus,
    X,
    User,
    WifiOff,
    CloudUpload,
    Truck,
    MapPin,
    Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ProdutoSearch from './components/ProdutoSearch';
import CarrinhoItem from './components/CarrinhoItem';
import ClienteSelect from './components/ClienteSelect';
import CaixaHeader from './components/CaixaHeader';
import NotaFiscalModal from './components/NotaFiscalModal';
import CupomFiscalModal from './components/CupomFiscalModal';
import PesoInputModal from './components/PesoInputModal';
import { usePDV } from '../../hooks/usePDV';
import { formatCurrency } from '../../utils/formatters';
import { pdvService } from './pdvService';
import { apiClient } from '../../api/apiClient';
import PDVSkeleton from './components/PDVSkeleton';
import CaixaManager from './components/CaixaManager';
import MultiPaymentManager from './components/MultiPaymentManager';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

const PDVPage: React.FC = () => {

    const {
        sessoes,
        sessaoAtivaId,
        adicionarSessao,
        alternarSessao,
        removerSessao,
        carrinho,
        cliente,
        setCliente,
        formasPagamento,
        pagamentos,
        adicionarPagamento,
        removerPagamento,
        configuracoes,
        loading,
        subtotal,
        total,
        troco,
        adicionarProduto,
        removerProduto,
        atualizarQuantidade,
        aplicarDescontoItem,
        limparCarrinho,
        finalizarVenda,
        caixaAberto,
        setCaixaAberto,
        paraEntregar,
        setParaEntregar,
        dadosEntrega,
        setDadosEntrega,
    } = usePDV();

    // Fila offline — vendas salvas localmente quando sem internet
    const { pendingCount, isSyncing, isOnline, enqueue, processQueue } = useOfflineQueue();

    // Catálogo offline — baixa quando online para permitir vender sem sinal
    const [catalogoCount, setCatalogoCount] = useState(0);
    useEffect(() => {
        let ativo = true;
        const sincronizar = async () => {
            try {
                const n = await pdvService.sincronizarCatalogoOffline();
                if (ativo) setCatalogoCount(n);
            } catch {
                // offline ou falha → usa o catálogo já cacheado (se houver)
                try {
                    const { contarCatalogo } = await import('./offlineCatalog');
                    if (ativo) setCatalogoCount(await contarCatalogo());
                } catch { /* sem catálogo ainda */ }
            }
        };
        if (isOnline) sincronizar();
        const onOnline = () => sincronizar();
        window.addEventListener('online', onOnline);
        return () => { ativo = false; window.removeEventListener('online', onOnline); };
    }, [isOnline]);

    const [formaPagamentoAberta, setFormaPagamentoAberta] = useState(false);
    const [activeSection, setActiveSection] = useState<'cliente' | 'pagamento'>('pagamento');
    const [enviandoEmail, setEnviandoEmail] = useState(false);
    const [mostrarModalNotaFiscal, setMostrarModalNotaFiscal] = useState(false);
    const [vendaFinalizada, setVendaFinalizada] = useState<{ id: number; codigo: string; offline?: boolean } | null>(null);
    const [managerCaixaAberto, setManagerCaixaAberto] = useState(false);
    const [dataVencimentoFiado, setDataVencimentoFiado] = useState('');  // data prevista pagamento do fiado
    const [cupomModalAberto, setCupomModalAberto] = useState(false);
    const [mostrarModalPeso, setMostrarModalPeso] = useState(false);
    const [produtoPendentePeso, setProdutoPendentePeso] = useState<any>(null);
    const [emitirNfce, setEmitirNfce] = useState(true);
    const caixaEstaAberto = !!caixaAberto;

    useBodyScrollLock(formaPagamentoAberta);

    const isFiado = pagamentos.some(p => p.forma === 'fiado');

    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get('manage') === 'true') {
            setManagerCaixaAberto(true);
            // Optionally remove the parameter from the URL so it doesn't stay
            navigate('/pdv', { replace: true });
        }
    }, [location.search, navigate]);

    // ── Scanner USB global (wedge): detecta leitor de código de barras pela
    //    velocidade de digitação + Enter e adiciona o produto em qualquer foco.
    //    Distingue do operador digitando manualmente (humano é mais lento).
    useEffect(() => {
        let buffer = '';
        let lastTime = 0;
        const onKeyDown = async (e: KeyboardEvent) => {
            const ativo = document.activeElement as HTMLElement | null;
            // No campo de busca o ProdutoSearch já cuida do EAN — evita leitura dupla
            if (ativo?.id === 'produto-search-input') return;

            const agora = Date.now();
            const delta = agora - lastTime;
            lastTime = agora;

            if (e.key === 'Enter') {
                const code = buffer.trim();
                buffer = '';
                if (code.length >= 8 && /^\d+$/.test(code)) {
                    e.preventDefault();
                    try {
                        const p = await pdvService.buscarPorCodigoBarras(code);
                        if (p) { adicionarProduto(p as any); showToast.success(`Lido: ${p.nome}`); }
                        else showToast.error(`Código ${code} não encontrado`);
                    } catch { showToast.error('Erro ao ler código de barras'); }
                }
                return;
            }
            if (e.key.length === 1) {
                // delta curto (<50ms) = leitor; senão reinicia (digitação humana)
                buffer = delta > 50 ? e.key : buffer + e.key;
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [adicionarProduto]);

    const handleFinalizarVenda = async () => {
        if (!caixaEstaAberto) {
            showToast.error('Caixa fechado. Abra o caixa antes de concluir a venda.', { duration: 5000 });
            setFormaPagamentoAberta(false);
            setManagerCaixaAberto(true);
            return;
        }
        if (carrinho.length === 0) return showToast.error('Carrinho vazio');
        if (pagamentos.length === 0) {
            showToast.warning('Adicione ao menos uma forma de pagamento');
            setActiveSection('pagamento');
            setFormaPagamentoAberta(true);
            return;
        }

        const totalPago = pagamentos.reduce((sum, p) => sum + p.valor, 0);
        if (totalPago < (total - 0.01)) {
            showToast.error(`Valor insuficiente. Valor total pago (R$ ${totalPago.toFixed(2)}) é menor que o total da venda (R$ ${total.toFixed(2)})`);
            setFormaPagamentoAberta(true);
            return;
        }

        // Validação de Fiado: cliente obrigatório
        if (isFiado && !cliente) {
            showToast.error('Vendas no FIADO exigem um cliente cadastrado!');
            setActiveSection('cliente');
            return;
        }

        try {
            const extraData = { 
                data_vencimento_fiado: isFiado && dataVencimentoFiado ? dataVencimentoFiado : undefined,
                emitir_nfce: emitirNfce
            };
            const venda = await showToast.promise(
                finalizarVenda(extraData, enqueue),
                {
                    loading: isOnline ? 'Finalizando venda...' : '📦 Salvando venda offline...',
                    success: (v: any) => {
                        let msg = v?.offline ? `📱 Venda salva offline! Código: ${v.codigo}` : '✅ Venda concluída!';
                        if (v?.nfce_status) {
                            if (v.nfce_status === 'autorizado') msg += ' (NFC-e Autorizada)';
                            else msg += ' (NFC-e: ' + v.nfce_status + ')';
                        }
                        return msg;
                    },
                    error: (err: any) => err.message || 'Erro ao finalizar venda'
                }
            );

            if (venda) {
                setVendaFinalizada(venda);
                setFormaPagamentoAberta(false);
                // Offline: mostra comprovante simplificado sem tentar buscar do servidor
                setMostrarModalNotaFiscal(true);
                setDataVencimentoFiado('');
                if (venda.offline) {
                    showToast.warning(`📡 ${pendingCount + 1} venda(s) aguardando sync. Serão enviadas automaticamente quando o sinal voltar.`, { duration: 6000 });
                }
            }
        } catch (error: any) {
            // 403 com CAIXA_FECHADO → avisar e abrir o gestor de caixa
            const errData = error?.response?.data;
            if (error?.response?.status === 403 && errData?.error === 'CAIXA_FECHADO') {
                showToast.error('⚠️ Caixa fechado! Abra o caixa antes de registrar vendas.', { duration: 6000 });
                setFormaPagamentoAberta(false);
                setManagerCaixaAberto(true);
                return;
            }
            // Outros erros já tratados pelo promise
        }
    };

    const handleAbrirCheckout = (section: 'cliente' | 'pagamento' = 'pagamento') => {
        if (!caixaEstaAberto) {
            showToast.error('Caixa fechado. Abra o caixa para liberar pagamentos e fechamento da venda.', { duration: 5000 });
            setManagerCaixaAberto(true);
            return;
        }
        setActiveSection(section);
        setFormaPagamentoAberta(true);
    };

    const handleLimparCarrinho = () => {
        if (carrinho.length > 0 && confirm('Deseja realmente cancelar esta venda?')) {
            limparCarrinho();
            showToast.warning('Venda cancelada');
        }
    };

    // ── Atalhos de teclado do PDV (F1/F2/F4/F9/F10/Esc) — ver registry de atalhos.
    useKeyboardShortcuts([
        {
            combo: 'f1', allowInInput: true,
            handler: () => document.getElementById('produto-search-input')?.focus(),
        },
        {
            combo: 'f2', allowInInput: true,
            handler: () => { handleAbrirCheckout('cliente'); },
        },
        {
            combo: 'f4', allowInInput: true,
            handler: () => { handleAbrirCheckout('pagamento'); },
        },
        { combo: 'f9', allowInInput: true, handler: () => handleFinalizarVenda() },
        { combo: 'f10', allowInInput: true, handler: () => handleFinalizarVenda() },
        {
            combo: 'escape',
            handler: () => { if (formaPagamentoAberta) setFormaPagamentoAberta(false); else handleLimparCarrinho(); },
        },
    ]);

    const handleProdutoSelecionado = (p: any) => {
        const aGranel = ['KG', 'G', 'L', 'ML'].includes(p.unidade_medida?.toUpperCase()) || p.tipo === 'granel';

        if (aGranel) {
            setProdutoPendentePeso(p);
            setMostrarModalPeso(true);
        } else {
            adicionarProduto(p, 1);
        }
    };

    const handleConfirmarPeso = (peso: number) => {
        if (produtoPendentePeso) {
            adicionarProduto(produtoPendentePeso, peso);
            setProdutoPendentePeso(null);
        }
    };



    if (loading && !configuracoes) return <PDVSkeleton />;

    return (
        <div className="h-screen bg-slate-50 dark:bg-slate-950 flex flex-col overflow-hidden font-sans text-slate-900 dark:text-slate-100">
            {/* Barra de status: offline + vendas pendentes */}
            <AnimatePresence>
                {(!isOnline || pendingCount > 0) && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className={`flex items-center justify-between px-4 py-2 text-xs font-bold ${
                            !isOnline ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <WifiOff className="w-3.5 h-3.5" />
                            <span>{!isOnline ? `📡 Sem conexão — vendendo offline (${catalogoCount} produtos no catálogo)` : `📦 ${pendingCount} venda(s) aguardando sincronização`}</span>
                        </div>
                        {pendingCount > 0 && isOnline && (
                            <button
                                onClick={() => processQueue().then(r => showToast.success(`${r.synced} venda(s) sincronizada(s)!`))}
                                disabled={isSyncing}
                                className="flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1 transition-all"
                            >
                                <CloudUpload className="w-3.5 h-3.5" />
                                <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}</span>
                            </button>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
            <CaixaManager
                caixaAtual={caixaAberto}
                setCaixaAtual={setCaixaAberto}
                isOpen={managerCaixaAberto}
                onClose={() => setManagerCaixaAberto(false)}
            />

            <PesoInputModal
                isOpen={mostrarModalPeso}
                onClose={() => { setMostrarModalPeso(false); setProdutoPendentePeso(null); }}
                onConfirm={handleConfirmarPeso}
                produto={produtoPendentePeso}
            />

            <div className="tour-pdv-leitor">
                <CaixaHeader
                    funcionarioNome={configuracoes?.funcionario.nome}
                    funcionarioRole={configuracoes?.funcionario.role}
                    caixaNumero={caixaAberto?.numero_caixa}
                    caixaAberto={caixaEstaAberto}
                    saldoAtualCaixa={caixaAberto?.saldo_atual}
                    dataAberturaCaixa={caixaAberto?.data_abertura}
                    onOpenCaixaManager={() => setManagerCaixaAberto(true)}
                />
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden border-t border-slate-200 dark:border-slate-800">
                {/* 🛒 LISTAGEM DE ITENS (FOCO TOTAL) */}
                <div className="lg:col-span-9 flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
                    {/* 📑 TABS DE SESSÃO */}
                    <div className="flex items-center gap-1 px-4 pt-3 bg-slate-200/50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 overflow-x-auto custom-scrollbar">
                        {sessoes.map((sessao: any, index: number) => (
                            <button
                                key={sessao.id}
                                onClick={() => alternarSessao(sessao.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl transition-all ${sessaoAtivaId === sessao.id ? 'bg-white dark:bg-slate-900 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] text-blue-600 dark:text-blue-400 font-black' : 'bg-transparent text-slate-500 hover:bg-slate-300/50 dark:hover:bg-slate-900/50 font-bold'}`}
                            >
                                <span className="text-xs uppercase tracking-wider whitespace-nowrap">Cx. {index + 1}</span>
                                {sessao.carrinho.length > 0 && (
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${sessaoAtivaId === sessao.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30' : 'bg-slate-300/50 text-slate-600 dark:bg-slate-800'}`}>
                                        {sessao.carrinho.length}
                                    </span>
                                )}
                                {sessoes.length > 1 && (
                                    <div
                                        className={`ml-1 rounded-full p-1 transition-colors ${sessaoAtivaId === sessao.id ? 'hover:bg-red-100 hover:text-red-600' : 'hover:bg-slate-300 hover:text-slate-700'}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removerSessao(sessao.id);
                                        }}
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </div>
                                )}
                            </button>
                        ))}
                        <button
                            onClick={adicionarSessao}
                            className="ml-2 mb-1 p-2 bg-slate-300/50 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 hover:text-white text-slate-500 rounded-xl transition-all shadow-sm"
                            title="Nova Sessão (Caixa Zerado)"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                        <div className="bg-white dark:bg-slate-900 p-4 border-b border-slate-200 dark:border-slate-800">
                            <ProdutoSearch onProdutoSelecionado={handleProdutoSelecionado} />
                        </div>
                    </div>

                    {/* No mobile o rodapé tem 2 barras fixas (nav 4rem + barra "Pagar" ~5rem).
                        Reservamos esse espaço para que o último item do carrinho e seus
                        controles de quantidade nunca fiquem encobertos. lg: sem reserva. */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-0">
                        {carrinho.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-20 pointer-events-none">
                                <ShoppingCart className="w-24 h-24 mb-4 text-slate-400" />
                                <h3 className="text-xl lg:text-xl xl:text-3xl font-black uppercase tracking-tighter">Aguardando Produtos</h3>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {carrinho.map((item: any) => (
                                    <CarrinhoItem
                                        key={item.produto.id}
                                        produto={item.produto}
                                        quantidade={item.quantidade}
                                        precoUnitario={item.precoUnitario}
                                        desconto={item.desconto}
                                        total={item.total}
                                        onAtualizarQuantidade={(qtd) => atualizarQuantidade(item.produto.id, qtd)}
                                        onRemover={() => removerProduto(item.produto.id)}
                                        onAplicarDesconto={(val, perc) => aplicarDescontoItem(item.produto.id, val, perc)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* 🏷️ RESUMO LATERAL (PROFISSIONAL E SÓBRIO) */}
                <div className="hidden lg:flex lg:col-span-3 flex-col bg-slate-50 dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800">
                    <div className="flex-1 p-4 sm:p-6 flex flex-col justify-end gap-4 sm:p-6">
                        <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none text-center">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Total a Pagar</span>
                            <span className="text-xl lg:text-xl xl:text-3xl font-black text-red-600 dark:text-red-400 tabular-nums block wrap-break-word leading-none">
                                {formatCurrency(total)}
                            </span>
                        </div>

                        <div className="space-y-3">
                            <button
                                onClick={() => {
                                    handleAbrirCheckout('pagamento');
                                }}
                                className={`w-full h-16 rounded-2xl flex items-center justify-center gap-3 font-bold uppercase text-xs tracking-widest shadow-lg active:scale-95 transition-all ${
                                    caixaEstaAberto
                                        ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20'
                                        : 'bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800/50 dark:hover:bg-amber-950/50'
                                }`}
                            >
                                {caixaEstaAberto ? <CreditCard className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                                <span>{caixaEstaAberto ? 'Pagar (F4)' : 'Abrir Caixa para Pagar'}</span>
                            </button>
                            <button
                                onClick={handleLimparCarrinho}
                                className="w-full py-3 text-slate-400 hover:text-red-500 font-bold text-[10px] uppercase tracking-widest transition-all"
                            >
                                Cancelar Venda
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 💳 CHECKOUT DRAWER (DESIGN PRÊMIUM E ACESSÍVEL) */}
            <AnimatePresence>
                {formaPagamentoAberta && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setFormaPagamentoAberta(false)}
                            className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-90"
                        />
                        <motion.div
                            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                            className="fixed top-0 right-0 h-dvh w-full sm:w-[480px] bg-white dark:bg-slate-900 shadow-2xl z-100 flex flex-col"
                        >
                            {/* Drawer Header */}
                            <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-slate-900 dark:bg-white rounded-xl flex items-center justify-center text-white dark:text-slate-900">
                                        <Check className="w-6 h-6" />
                                    </div>
                                    <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white">Checkout</h3>
                                </div>
                                <button
                                    onClick={() => setFormaPagamentoAberta(false)}
                                    className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                                {/* SEÇÃO: CLIENTE */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                    <button
                                        onClick={() => setActiveSection(activeSection === 'cliente' ? 'pagamento' : 'cliente')}
                                        className="w-full p-5 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cliente ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>
                                                <User className="w-5 h-5" />
                                            </div>
                                            <div className="text-left">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Identificação</p>
                                                <p className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase">{cliente?.nome || 'Consumidor Final'}</p>
                                            </div>
                                        </div>
                                        <Check className={`w-5 h-5 ${cliente ? 'text-green-500' : 'text-slate-200'}`} />
                                    </button>
                                    <AnimatePresence>
                                        {activeSection === 'cliente' && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="p-5 pt-0 overflow-visible"
                                            >
                                                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                                    <ClienteSelect 
                                                        cliente={cliente} 
                                                        onClienteSelecionado={async (c: any) => { 
                                                            setCliente(c); 
                                                            if (paraEntregar && c.cep) {
                                                                const cepDest = c.cep;
                                                                setDadosEntrega({
                                                                    endereco: {
                                                                        cep: cepDest,
                                                                        logradouro: c.logradouro || '',
                                                                        numero: c.numero || 'S/N',
                                                                        bairro: c.bairro || '',
                                                                        cidade: c.cidade || '',
                                                                        estado: c.estado || 'XX'
                                                                    }
                                                                });
                                                                
                                                                // Calcula automático a distância/taxa pelo CEP
                                                                if (cepDest) {
                                                                    try {
                                                                        const res = await apiClient.post('/logistica/estimar-taxa-cep', { 
                                                                            cep_destino: cepDest,
                                                                            veiculo: dadosEntrega?.veiculo || 'moto' 
                                                                        });
                                                                        if (res.data?.success) {
                                                                            setDadosEntrega({ 
                                                                                distancia_km: res.data.distancia_km,
                                                                                taxa_entrega: res.data.taxa_sugerida 
                                                                            });
                                                                            import('react-hot-toast').then(m => m.default.success(`Taxa calculada: R$ ${res.data.taxa_sugerida.toFixed(2)}`, { id: 'cep-toast' }));
                                                                        } else {
                                                                            import('react-hot-toast').then(m => m.default.error(res.data?.error || "Erro ao calcular taxa pelo CEP.", { id: 'cep-toast' }));
                                                                        }
                                                                    } catch (err: any) {
                                                                        console.warn("Não foi possível estimar a taxa: ", err.response?.data?.error);
                                                                    }
                                                                } else {
                                                                    import('react-hot-toast').then(m => m.default.success("Cliente sem CEP. Insira a taxa de entrega manualmente.", { id: 'cep-toast' }));
                                                                }
                                                            } else if (paraEntregar && (!c || !c.cep)) {
                                                                toast.success("Cliente sem CEP. Insira a taxa de entrega manualmente.");
                                                            }
                                                            setActiveSection('pagamento'); 
                                                        }} 
                                                    />
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                                
                                {/* SEÇÃO: ENTREGA */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                    <div className="w-full p-5 flex items-center justify-between transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${paraEntregar ? 'bg-orange-100 text-orange-600' : 'bg-slate-200 text-slate-500'}`}>
                                                <Truck className="w-5 h-5" />
                                            </div>
                                            <div className="text-left">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Logística</p>
                                                <p className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase">
                                                    Venda p/ Entregar
                                                </p>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                className="sr-only peer" 
                                                checked={paraEntregar}
                                                onChange={async (e) => {
                                                    if (e.target.checked && !cliente) {
                                                        import('react-hot-toast').then(m => m.default.error("Selecione ou cadastre um cliente primeiro para calcular a entrega."));
                                                        return;
                                                    }
                                                    setParaEntregar(e.target.checked);
                                                    if (e.target.checked && cliente?.cep) {
                                                        const cepDest = cliente.cep;
                                                        setDadosEntrega({
                                                            endereco: {
                                                                cep: cepDest,
                                                                logradouro: cliente.logradouro || '',
                                                                numero: cliente.numero || 'S/N',
                                                                bairro: cliente.bairro || '',
                                                                cidade: cliente.cidade || '',
                                                                estado: cliente.estado || 'XX'
                                                            }
                                                        });
                                                        
                                                        // Calcula automático
                                                        if (cepDest) {
                                                            try {
                                                                const res = await apiClient.post('/logistica/estimar-taxa-cep', { 
                                                                    cep_destino: cepDest,
                                                                    veiculo: dadosEntrega?.veiculo || 'moto'
                                                                });
                                                                if (res.data?.success) {
                                                                    setDadosEntrega({ 
                                                                        distancia_km: res.data.distancia_km,
                                                                        taxa_entrega: res.data.taxa_sugerida 
                                                                    });
                                                                    import('react-hot-toast').then(m => m.default.success(`Taxa calculada: R$ ${res.data.taxa_sugerida.toFixed(2)}`, { id: 'cep-toast' }));
                                                                } else {
                                                                    import('react-hot-toast').then(m => m.default.error(res.data?.error || "Erro ao calcular taxa pelo CEP.", { id: 'cep-toast' }));
                                                                }
                                                            } catch (err: any) {
                                                                console.warn("Não foi possível estimar a taxa: ", err.response?.data?.error);
                                                            }
                                                        } else {
                                                            import('react-hot-toast').then(m => m.default.success("Cliente sem CEP. Insira a taxa de entrega manualmente.", { id: 'cep-toast' }));
                                                        }
                                                    } else if (e.target.checked && !cliente?.cep) {
                                                        import('react-hot-toast').then(m => m.default.success("Cliente sem CEP. Insira a taxa de entrega manualmente.", { id: 'cep-toast' }));
                                                    }
                                                }}
                                            />
                                            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-orange-500"></div>
                                        </label>
                                    </div>
                                    <AnimatePresence>
                                        {paraEntregar && (
                                            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden p-5 pt-0">
                                                <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
                                                    {!cliente && (
                                                        <p className="text-xs text-orange-600 font-bold">⚠️ Recomendado selecionar o cliente acima para puxar o endereço automaticamente.</p>
                                                    )}
                                                    
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">CEP Destino</label>
                                                            <div className="relative flex gap-1">
                                                                <input
                                                                    type="text"
                                                                    value={dadosEntrega?.endereco?.cep || ''}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value.replace(/\D/g, '');
                                                                        const masked = val.replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9);
                                                                        setDadosEntrega({
                                                                            endereco: { ...(dadosEntrega?.endereco || {}), cep: masked } as any
                                                                        });
                                                                    }}
                                                                    placeholder="00000-000"
                                                                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        const cep = dadosEntrega?.endereco?.cep;
                                                                        if (cep && cep.length >= 8) {
                                                                            try {
                                                                                const res = await apiClient.post('/logistica/estimar-taxa-cep', {
                                                                                    cep_destino: cep,
                                                                                    veiculo: dadosEntrega?.veiculo || 'moto'
                                                                                });
                                                                                if (res.data?.success) {
                                                                                    setDadosEntrega({
                                                                                        distancia_km: res.data.distancia_km,
                                                                                        taxa_entrega: res.data.taxa_sugerida
                                                                                    });
                                                                                    import('react-hot-toast').then(m => m.default.success(`Taxa calculada: R$ ${res.data.taxa_sugerida.toFixed(2)}`, { id: 'cep-toast' }));
                                                                                } else {
                                                                                    import('react-hot-toast').then(m => m.default.error(res.data?.error || "Erro ao calcular.", { id: 'cep-toast' }));
                                                                                }
                                                                            } catch {
                                                                                import('react-hot-toast').then(m => m.default.error("Erro na API.", { id: 'cep-toast' }));
                                                                            }
                                                                        } else {
                                                                            import('react-hot-toast').then(m => m.default.error("Digite um CEP válido.", { id: 'cep-toast' }));
                                                                        }
                                                                    }}
                                                                    className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-xl px-3 flex items-center justify-center text-slate-500 dark:text-slate-300 transition-all"
                                                                    title="Calcular Taxa pelo CEP digitado"
                                                                >
                                                                    <MapPin className="w-5 h-5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Veículo</label>
                                                            <select
                                                                value={dadosEntrega?.veiculo || 'moto'}
                                                                onChange={async (e) => {
                                                                    const veiculo = e.target.value as 'moto' | 'carro';
                                                                    setDadosEntrega({ veiculo });
                                                                    const cep = dadosEntrega?.endereco?.cep;
                                                                    if (cep) {
                                                                        try {
                                                                            const res = await apiClient.post('/logistica/estimar-taxa-cep', { 
                                                                                cep_destino: cep,
                                                                                veiculo
                                                                            });
                                                                            if (res.data?.success) {
                                                                                setDadosEntrega({ 
                                                                                    distancia_km: res.data.distancia_km,
                                                                                    taxa_entrega: res.data.taxa_sugerida 
                                                                                });
                                                                                import('react-hot-toast').then(m => m.default.success(`Taxa calculada: R$ ${res.data.taxa_sugerida.toFixed(2)}`, { id: 'cep-toast' }));
                                                                            } else {
                                                                                import('react-hot-toast').then(m => m.default.error(res.data?.error || "Erro ao recalcular.", { id: 'cep-toast' }));
                                                                            }
                                                                        } catch {
                                                                            import('react-hot-toast').then(m => m.default.error("Erro na API.", { id: 'cep-toast' }));
                                                                        }
                                                                    }
                                                                }}
                                                                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                                            >
                                                                <option value="moto">🏍 Moto</option>
                                                                <option value="carro">🚗 Carro</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Distância (KM)</label>
                                                            <div className="relative">
                                                                <input
                                                                    type="number"
                                                                    disabled
                                                                    value={dadosEntrega?.distancia_km !== undefined && dadosEntrega?.distancia_km !== 0 ? dadosEntrega.distancia_km : ''}
                                                                    placeholder="Auto"
                                                                    className="w-full p-2.5 pr-14 rounded-xl border border-slate-200 dark:border-slate-700 bg-gray-100 dark:bg-gray-800/50 text-slate-700 dark:text-slate-300 text-sm font-bold opacity-80 cursor-not-allowed"
                                                                />
                                                                <span className="absolute right-2 top-2.5 px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 uppercase tracking-wider">Auto</span>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-orange-600 uppercase tracking-widest block mb-1">Taxa (R$)</label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={dadosEntrega?.taxa_entrega !== undefined ? dadosEntrega.taxa_entrega : ''}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setDadosEntrega({ taxa_entrega: (val === '' ? '' : parseFloat(val)) as any });
                                                                }}
                                                                className="w-full p-2.5 rounded-xl border border-orange-300 dark:border-orange-500/50 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 text-sm font-black focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* SEÇÃO: FORMA DE PAGAMENTO */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                    <button
                                        onClick={() => setActiveSection(activeSection === 'pagamento' ? 'cliente' : 'pagamento')}
                                        className="w-full p-5 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${pagamentos.length > 0 ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'}`}>
                                                <CreditCard className="w-5 h-5" />
                                            </div>
                                            <div className="text-left">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pagamento</p>
                                                <p className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase">
                                                    {pagamentos.length === 0 ? 'Selecione as Formas' : `${pagamentos.length} Forma(s) Adicionada(s)`}
                                                </p>
                                            </div>
                                        </div>
                                        <Check className={`w-5 h-5 ${pagamentos.length > 0 ? 'text-green-500' : 'text-slate-200'}`} />
                                    </button>
                                    <AnimatePresence>
                                        {activeSection === 'pagamento' && (
                                            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden p-5 pt-0">
                                                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                                    <MultiPaymentManager
                                                        totalVenda={total}
                                                        formasDisponiveis={formasPagamento}
                                                        pagamentosatuais={pagamentos}
                                                        onAdicionar={adicionarPagamento}
                                                        onRemover={removerPagamento}
                                                    />
                                                </div>

                                                {/* Campo de Data de Vencimento - Visível apenas para Fiado */}
                                                {isFiado && (
                                                    <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-2xl border border-orange-500/20">
                                                        {!cliente && (
                                                            <p className="text-xs text-orange-700 font-bold mb-3 text-center">
                                                                ⚠️ Fiado requer um Cliente cadastrado! Selecione acima.
                                                            </p>
                                                        )}
                                                        <label className="text-[10px] font-bold text-orange-600 uppercase tracking-widest block mb-2">
                                                            📅 Data Prevista de Pagamento
                                                        </label>
                                                        <input
                                                            type="date"
                                                            value={dataVencimentoFiado}
                                                            onChange={e => setDataVencimentoFiado(e.target.value)}
                                                            min={new Date().toISOString().split('T')[0]}
                                                            className="w-full p-3 rounded-xl border border-orange-300 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-400"
                                                        />
                                                        <p className="text-[10px] text-orange-500 mt-1">Opcional. Padrão: 30 dias.</p>
                                                    </div>
                                                )}                                                {troco > 0 && (
                                                    <div className="mt-6 p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-3xl border border-green-500/10 shadow-2xl flex justify-between items-center">
                                                        <span className="text-xs font-black text-slate-400 uppercase">Troco Calculado</span>
                                                        <span className="text-xl lg:text-xl xl:text-3xl font-black text-green-500 tabular-nums">
                                                            {formatCurrency(troco)}
                                                        </span>
                                                    </div>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            {/* Drawer Footer — paddingBottom respeita a barra de gestos/home indicator
                                para o botão "Concluir Venda" nunca ficar sob a UI do sistema. */}
                            <div
                                className="p-4 sm:p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 space-y-6 shrink-0"
                                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
                            >

                                <div className="flex justify-between items-center px-1">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Subtotal</span>
                                        <span className="text-md font-bold text-slate-500 tabular-nums">{formatCurrency(subtotal)}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] font-black text-red-600 uppercase tracking-widest block mb-1">Total a Pagar</span>
                                        <span className="text-2xl lg:text-2xl xl:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tighter leading-none">
                                            {formatCurrency(total)}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 px-1 py-2 mb-2 bg-slate-100 dark:bg-slate-900 rounded-xl">
                                    <input 
                                        type="checkbox" 
                                        id="emitir-nfce-check" 
                                        checked={emitirNfce}
                                        onChange={(e) => setEmitirNfce(e.target.checked)}
                                        className="w-5 h-5 ml-2 text-red-600 rounded"
                                    />
                                    <label htmlFor="emitir-nfce-check" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                        Emitir NFC-e (Nota Fiscal Consumidor Eletrônica)
                                    </label>
                                </div>

                                <button
                                    onClick={handleFinalizarVenda}
                                    disabled={carrinho.length === 0 || loading}
                                    className={`w-full h-16 rounded-2xl flex items-center justify-center gap-3 text-lg font-black uppercase tracking-widest shadow-xl transition-all active:scale-[0.98] ${
                                        carrinho.length === 0 || loading
                                            ? 'bg-slate-200 text-slate-400'
                                            : caixaEstaAberto
                                                ? 'bg-red-600 text-white hover:bg-red-700 shadow-red-500/20'
                                                : 'bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/20'
                                    }`}
                                >
                                    {loading ? (
                                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/20 border-t-white" />
                                    ) : (
                                        caixaEstaAberto ? <Check className="w-7 h-7" /> : <Lock className="w-7 h-7" />
                                    )}
                                    <span>{caixaEstaAberto ? 'Concluir Venda' : 'Caixa Fechado'}</span>
                                </button>
                                
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <NotaFiscalModal
                mostrar={mostrarModalNotaFiscal}
                emailCliente={cliente?.email || ''}
                onFechar={() => {
                    setMostrarModalNotaFiscal(false);
                    setVendaFinalizada(null);
                    limparCarrinho();
                }}
                onImprimir={async () => {
                    if (!vendaFinalizada) return;
                    if (vendaFinalizada.offline) {
                        import('react-hot-toast').then(m => m.default.error("Não é possível imprimir comprovante de venda offline. Aguarde a sincronização."));
                        return;
                    }
                    setMostrarModalNotaFiscal(false);
                    setCupomModalAberto(true);
                }}
                onEnviarEmail={async (email) => {
                    if (!vendaFinalizada) return;
                    if (vendaFinalizada.offline) {
                        import('react-hot-toast').then(m => m.default.error("Não é possível enviar email de venda offline. Aguarde a sincronização."));
                        return;
                    }
                    setEnviandoEmail(true);
                    try {
                        await showToast.promise(pdvService.enviarCupomFiscal(vendaFinalizada.id, email), {
                            loading: 'Enviando nota fiscal...',
                            success: 'Nota fiscal enviada por e-mail!',
                            error: (err: any) => {
                                const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao enviar e-mail';
                                return typeof msg === 'string' ? msg : 'Erro ao enviar e-mail';
                            }
                        });
                        setMostrarModalNotaFiscal(false);
                        setVendaFinalizada(null);
                        limparCarrinho();
                    } catch {
                        // Erro tratado pelo promise
                    } finally {
                        setEnviandoEmail(false);
                    }
                }}
                enviando={enviandoEmail}
                onVisualizar={async () => {
                    if (!vendaFinalizada) return;
                    if (vendaFinalizada.offline) {
                        import('react-hot-toast').then(m => m.default.error("Não é possível visualizar cupom de venda offline. Aguarde a sincronização."));
                        return;
                    }
                    setMostrarModalNotaFiscal(false);
                    setCupomModalAberto(true);
                }}
            />

            {/* CUPOM FISCAL PROFISSIONAL */}
            <CupomFiscalModal
                aberto={cupomModalAberto}
                vendaId={vendaFinalizada?.id ?? null}
                onFechar={() => {
                    setCupomModalAberto(false);
                    setVendaFinalizada(null);
                    limparCarrinho();
                }}
            />

            {/* MOBILE BAR — escondida enquanto o Gerenciador de Caixa está aberto, para que
                a Gestão de Caixa prevaleça sobre o PDV (botões de Sangria/Fechamento livres). */}
            {!managerCaixaAberto && (
                <div className="lg:hidden fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 p-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-100 dark:border-slate-800 flex items-center justify-between z-50">
                    <div className="flex flex-col pl-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Total Geral</span>
                        <span className="text-xl lg:text-xl xl:text-3xl font-black text-red-600 dark:text-red-400 tabular-nums">{formatCurrency(total)}</span>
                    </div>
                    <button
                        onClick={() => handleAbrirCheckout('pagamento')}
                        className={`h-14 px-10 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl ${
                            caixaEstaAberto
                                ? 'bg-red-600 text-white shadow-red-500/20'
                                : 'bg-amber-500 text-white shadow-amber-500/20'
                        }`}
                    >
                        {caixaEstaAberto ? 'Pagar' : 'Abrir Caixa'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default PDVPage;
