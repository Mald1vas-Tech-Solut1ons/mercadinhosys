import { useState, useCallback, useEffect } from 'react';
import { Produto, Cliente } from '../types';
import { pdvService, ConfiguracoesPDV, CaixaPDV } from '../features/pdv/pdvService';
import { showToast } from '../utils/toast';
import { mensagemErro } from '../utils/mensagemErro';

export interface ItemCarrinho {
    produto: Produto;
    quantidade: number;
    precoUnitario: number;
    desconto: number;
    descontoPercentual: boolean;
    total: number;
}

export interface FormaPagamento {
    tipo: string;
    label: string;
    taxa: number;
    permite_troco: boolean;
}

export interface PagamentoItem {
    id: string;
    forma: string;
    valor: number;
    bandeira?: string;
}

export interface PDVSession {
    id: string;
    carrinho: ItemCarrinho[];
    cliente: Cliente | null;
    emailRecibo: string;
    pagamentos: PagamentoItem[];
    observacoes: string;
    descontoGeral: number;
    descontoPercentual: boolean;
    paraEntregar: boolean;
    dadosEntrega: {
        distancia_km: number;
        taxa_entrega: number;
        veiculo?: 'moto' | 'carro';
        endereco: {
            cep: string;
            logradouro: string;
            numero: string;
            bairro: string;
            cidade: string;
            estado: string;
        } | null;
    };
}

const createInitialSession = (): PDVSession => ({
    id: Date.now().toString(),
    carrinho: [],
    cliente: null,
    emailRecibo: '',
    pagamentos: [],
    observacoes: '',
    descontoGeral: 0,
    descontoPercentual: false,
    paraEntregar: false,
    dadosEntrega: {
        distancia_km: 0,
        taxa_entrega: 0,
        endereco: null,
        veiculo: 'moto'
    },
});

// Persistência da sessão do caixa: sem isso, sair da tela do PDV (menu, notificação,
// bloqueio de tela) e voltar zera o carrinho inteiro, pois o estado vivia só em memória.
const PDV_STORAGE_KEY = 'pdv_sessions_v1';

const carregarSessoesSalvas = (): { sessoes: PDVSession[]; sessaoAtivaId: string } | null => {
    try {
        const raw = sessionStorage.getItem(PDV_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.sessoes) || parsed.sessoes.length === 0) return null;
        const sessaoAtivaId = parsed.sessoes.some((s: PDVSession) => s.id === parsed.sessaoAtivaId)
            ? parsed.sessaoAtivaId
            : parsed.sessoes[0].id;
        return { sessoes: parsed.sessoes, sessaoAtivaId };
    } catch {
        return null;
    }
};

export const usePDV = () => {
    // Configurações e permissões globais
    const [configuracoes, setConfiguracoes] = useState<ConfiguracoesPDV | null>(null);
    const [formasPagamento, setFormasPagamento] = useState<FormaPagamento[]>([]);
    const [loading, setLoading] = useState(false);
    const [caixaAberto, setCaixaAberto] = useState<CaixaPDV | null>(null);

    const refreshCaixa = useCallback(async () => {
        try {
            const caixa = await pdvService.getCaixaAtual();
            setCaixaAberto(caixa);
            return caixa;
        } catch (error) {
            console.error('Erro ao atualizar status do caixa:', error);
            setCaixaAberto(null);
            return null;
        }
    }, []);

    // Múltiplas Sessões do PDV — restauradas do sessionStorage ao remontar a tela
    const [estadoInicial] = useState(() => carregarSessoesSalvas());
    const [sessoes, setSessoes] = useState<PDVSession[]>(() => estadoInicial?.sessoes ?? [createInitialSession()]);
    const [sessaoAtivaId, setSessaoAtivaId] = useState<string>(() => estadoInicial?.sessaoAtivaId ?? sessoes[0].id);

    useEffect(() => {
        try {
            sessionStorage.setItem(PDV_STORAGE_KEY, JSON.stringify({ sessoes, sessaoAtivaId }));
        } catch {
            // sessionStorage indisponível (modo privado/quota) — segue apenas em memória
        }
    }, [sessoes, sessaoAtivaId]);

    const sessaoAtiva = sessoes.find(s => s.id === sessaoAtivaId) || sessoes[0];

    // Getters da sessão atual
    const carrinho = sessaoAtiva.carrinho;
    const cliente = sessaoAtiva.cliente;
    const emailRecibo = sessaoAtiva.emailRecibo;
    const pagamentos = sessaoAtiva.pagamentos || [];
    const observacoes = sessaoAtiva.observacoes;
    const descontoGeral = sessaoAtiva.descontoGeral;
    const descontoPercentual = sessaoAtiva.descontoPercentual;
    const paraEntregar = sessaoAtiva.paraEntregar;
    const dadosEntrega = sessaoAtiva.dadosEntrega;

    const updateSessao = useCallback((updates: Partial<PDVSession>) => {
        setSessoes(prev => prev.map(s => s.id === sessaoAtivaId ? { ...s, ...updates } : s));
    }, [sessaoAtivaId]);

    const setCarrinho = useCallback((value: ItemCarrinho[] | ((prev: ItemCarrinho[]) => ItemCarrinho[])) => {
        setSessoes(prev => prev.map(s => {
            if (s.id !== sessaoAtivaId) return s;
            const newValue = typeof value === 'function' ? value(s.carrinho) : value;
            return { ...s, carrinho: newValue };
        }));
    }, [sessaoAtivaId]);

    const setCliente = useCallback((c: Cliente | null) => {
        setSessoes(prev => prev.map(s => {
            if (s.id !== sessaoAtivaId) return s;
            return { ...s, cliente: c, emailRecibo: c?.email || '' };
        }));
    }, [sessaoAtivaId]);

    const setEmailRecibo = useCallback((e: string) => updateSessao({ emailRecibo: e }), [updateSessao]);

    const setPagamentos = useCallback((p: PagamentoItem[] | ((prev: PagamentoItem[]) => PagamentoItem[])) => {
        setSessoes(prev => prev.map(s => {
            if (s.id !== sessaoAtivaId) return s;
            const n = typeof p === 'function' ? p(s.pagamentos) : p;
            return { ...s, pagamentos: n };
        }));
    }, [sessaoAtivaId]);

    const adicionarPagamento = useCallback((forma: string, valor: number, bandeira?: string) => {
        const novo: PagamentoItem = { id: Date.now().toString(), forma, valor, bandeira };
        setPagamentos(prev => [...prev, novo]);
    }, [setPagamentos]);

    const removerPagamento = useCallback((id: string) => {
        setPagamentos(prev => prev.filter(p => p.id !== id));
    }, [setPagamentos]);

    const setObservacoes = useCallback((o: string) => updateSessao({ observacoes: o }), [updateSessao]);
    const setDescontoGeral = useCallback((d: number | ((prev: number) => number)) => {
        setSessoes(prev => prev.map(s => {
            if (s.id !== sessaoAtivaId) return s;
            const n = typeof d === 'function' ? d(s.descontoGeral) : d;
            return { ...s, descontoGeral: n };
        }));
    }, [sessaoAtivaId]);
    const setDescontoPercentual = useCallback((dp: boolean | ((prev: boolean) => boolean)) => {
        setSessoes(prev => prev.map(s => {
            if (s.id !== sessaoAtivaId) return s;
            const n = typeof dp === 'function' ? dp(s.descontoPercentual) : dp;
            return { ...s, descontoPercentual: n };
        }));
    }, [sessaoAtivaId]);
    
    const setParaEntregar = useCallback((p: boolean) => updateSessao({ paraEntregar: p }), [updateSessao]);
    const setDadosEntrega = useCallback((d: Partial<PDVSession['dadosEntrega']>) => {
        setSessoes(prev => prev.map(s => {
            if (s.id !== sessaoAtivaId) return s;
            return { ...s, dadosEntrega: { ...s.dadosEntrega, ...d } };
        }));
    }, [sessaoAtivaId]);

    // Gestão de Sessões
    const adicionarSessao = useCallback(() => {
        const nova = createInitialSession();
        setSessoes(prev => [...prev, nova]);
        setSessaoAtivaId(nova.id);
    }, []);

    const alternarSessao = useCallback((id: string) => {
        setSessaoAtivaId(id);
    }, []);

    const removerSessao = useCallback((id: string) => {
        setSessoes(prev => {
            if (prev.length <= 1) {
                const nova = createInitialSession();
                setSessaoAtivaId(nova.id);
                return [nova];
            }
            const novas = prev.filter(s => s.id !== id);
            if (sessaoAtivaId === id && novas.length > 0) {
                setSessaoAtivaId(novas[novas.length - 1].id);
            }
            return novas;
        });
    }, [sessaoAtivaId]);

    // Carregar configurações do PDV
    useEffect(() => {
        const carregarConfiguracoes = async () => {
            try {
                const config = await pdvService.getConfiguracoes();
                setConfiguracoes(config);
                setFormasPagamento(config.formas_pagamento);
                await refreshCaixa();
            } catch (error) {
                console.error('Erro ao carregar configurações/caixa do PDV:', error);
                showToast.error(mensagemErro(error, 'Não foi possível carregar as configurações do PDV. Recarregue a página.'), { duration: 6000 });
            }
        };
        carregarConfiguracoes();
    }, [refreshCaixa]);

    useEffect(() => {
        const syncCaixa = () => {
            if (document.visibilityState === 'visible') {
                refreshCaixa();
            }
        };

        window.addEventListener('focus', syncCaixa);
        window.addEventListener('online', syncCaixa);
        document.addEventListener('visibilitychange', syncCaixa);

        return () => {
            window.removeEventListener('focus', syncCaixa);
            window.removeEventListener('online', syncCaixa);
            document.removeEventListener('visibilitychange', syncCaixa);
        };
    }, [refreshCaixa]);

    // Help: Precisão decimal rigorosa para operações financeiras
    const round = useCallback((val: number) => Math.round((val + Number.EPSILON) * 100) / 100, []);
    const getEstoqueDisponivel = useCallback((produto: Produto) => {
        const bruto = (produto as any).estoque_atual ?? (produto as any).quantidade_estoque ?? (produto as any).quantidade ?? 0;
        const valor = Number(bruto);
        return Number.isFinite(valor) ? valor : 0;
    }, []);

    // Cálculos em tempo real memoizados para performance de elite
    const subtotal = round(carrinho.reduce((sum, item) => sum + (item.precoUnitario * item.quantidade), 0));
    const descontoItens = round(carrinho.reduce((sum, item) => sum + item.desconto, 0));

    const descontoGeralCalculado = round(descontoPercentual
        ? (subtotal - descontoItens) * (descontoGeral / 100)
        : descontoGeral);

    const descontoTotal = round(descontoItens + descontoGeralCalculado);
    
    const taxaEntregaCalculada = paraEntregar ? (dadosEntrega?.taxa_entrega || 0) : 0;
    const total = Math.max(0, round(subtotal - descontoTotal + taxaEntregaCalculada));

    const totalPago = round(pagamentos.reduce((sum, p) => sum + p.valor, 0));

    const troco = (() => {
        // O troco é calculado se o total pago exceder o total da venda,
        // mas tecnicamente só aplicamos para Dinheiro. 
        // Em multi-pagamento, verificamos se há excedente geral.
        return totalPago > total ? round(totalPago - total) : 0;
    })();

    // Adicionar produto ao carrinho
    // Retorna false quando o item foi recusado antes de ir ao carrinho (produto vencido).
    const adicionarProduto = useCallback((produto: Produto, quantidade: number = 1): boolean => {
        const controlarValidade = configuracoes?.controlar_validade ?? true;

        if (controlarValidade && produto.data_validade) {
            let y, m, d;
            if (produto.data_validade.includes('-')) {
                [y, m, d] = produto.data_validade.split('-').map(Number);
            } else {
                [d, m, y] = produto.data_validade.split('/').map(Number);
            }

            const dataValidade = new Date(y, m - 1, d);
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            if (dataValidade < hoje) {
                // Vencido não entra no carrinho (só "a vencer" é aviso).
                showToast.error(`Produto vencido — não pode ser vendido. Retire da gôndola. (${produto.nome})`, {
                    duration: 8000,
                    icon: '🚫'
                });
                return false;
            } else {
                const diasAlerta = configuracoes?.dias_alerta_validade ?? 30;
                const dataLimiteAlerta = new Date(hoje);
                dataLimiteAlerta.setDate(hoje.getDate() + diasAlerta);

                if (dataValidade <= dataLimiteAlerta) {
                    const diffTime = dataValidade.getTime() - hoje.getTime();
                    const diasRestantes = Math.round(diffTime / (1000 * 3600 * 24));

                    if (diasRestantes >= 0) {
                        showToast.warning(`AVISO: ${produto.nome} vence em ${diasRestantes === 0 ? 'hoje' : diasRestantes + ' dias'}`, {
                            duration: 5000,
                            icon: '⚠️'
                        });
                    }
                }
            }
        }

        setCarrinho(prev => {
            const itemExistente = prev.find(item => item.produto.id === produto.id);
            const estoqueDisponivel = getEstoqueDisponivel(produto);

            if (itemExistente) {
                const novaQuantidade = itemExistente.quantidade + quantidade;
                const permiteSemEstoque = configuracoes?.permitir_venda_sem_estoque ?? false;

                if (!permiteSemEstoque && novaQuantidade > estoqueDisponivel) {
                    showToast.warning(`Estoque insuficiente para ${produto.nome}`);
                    const qtdPermitida = Math.max(0, estoqueDisponivel);
                    if (itemExistente.quantidade >= qtdPermitida) return prev;

                    return prev.map(item =>
                        item.produto.id === produto.id
                            ? {
                                ...item,
                                quantidade: qtdPermitida,
                                total: round(qtdPermitida * item.precoUnitario - item.desconto),
                            }
                            : item
                    );
                }

                return prev.map(item =>
                    item.produto.id === produto.id
                        ? {
                            ...item,
                            quantidade: novaQuantidade,
                            total: round(novaQuantidade * item.precoUnitario - item.desconto),
                        }
                        : item
                );
            } else {
                const preco = (produto as any).preco_venda_efetivo ?? produto.preco_venda;
                const permiteSemEstoque = configuracoes?.permitir_venda_sem_estoque ?? false;

                let qtdPedida = quantidade;
                if (!permiteSemEstoque) {
                    qtdPedida = Math.min(quantidade, Math.max(0, estoqueDisponivel));
                }

                if (!permiteSemEstoque && qtdPedida <= 0 && estoqueDisponivel <= 0) {
                    showToast.error(`Produto ${produto.nome} sem estoque disponível`);
                    return prev;
                }

                const novoItem: ItemCarrinho = {
                    produto,
                    quantidade: qtdPedida,
                    precoUnitario: preco,
                    desconto: 0,
                    descontoPercentual: false,
                    total: round(preco * qtdPedida),
                };
                return [...prev, novoItem];
            }
        });
        return true;
    }, [configuracoes, getEstoqueDisponivel, round, setCarrinho]);

    const removerProduto = useCallback((produtoId: number) => {
        setCarrinho(prev => prev.filter(item => item.produto.id !== produtoId));
    }, [setCarrinho]);

    const atualizarQuantidade = useCallback((produtoId: number, quantidadeBruta: number) => {
        // 3 casas = gramas/ml; evita 0.1 + 0.2 = 0.30000000000000004 no granel
        const quantidade = Math.round((quantidadeBruta + Number.EPSILON) * 1000) / 1000;
        if (quantidade <= 0) {
            removerProduto(produtoId);
            return;
        }

        setCarrinho(prev =>
            prev.map(item => {
                if (item.produto.id === produtoId) {
                    const estoqueMax = getEstoqueDisponivel(item.produto);
                    const permiteSemEstoque = configuracoes?.permitir_venda_sem_estoque ?? false;

                    const qtdValida = permiteSemEstoque
                        ? (quantidade > 0 ? quantidade : 1)
                        : Math.min(quantidade, Math.max(1, estoqueMax));

                    return {
                        ...item,
                        quantidade: qtdValida,
                        total: round(qtdValida * item.precoUnitario - item.desconto),
                    };
                }
                return item;
            })
        );
    }, [removerProduto, configuracoes, getEstoqueDisponivel, round, setCarrinho]);

    const aplicarDescontoItem = useCallback((produtoId: number, desconto: number, percentual: boolean = false) => {
        setCarrinho(prev =>
            prev.map(item => {
                if (item.produto.id === produtoId) {
                    const descontoValor = percentual
                        ? item.precoUnitario * item.quantidade * (desconto / 100)
                        : desconto;

                    return {
                        ...item,
                        desconto: descontoValor,
                        descontoPercentual: percentual,
                        total: item.precoUnitario * item.quantidade - descontoValor,
                    };
                }
                return item;
            })
        );
    }, [setCarrinho]);

    const validarDescontoPermitido = useCallback((valorDesconto: number): boolean => {
        if (!configuracoes) return false;
        if (configuracoes.funcionario.role === 'ADMIN') return true;

        const percentualDesconto = (valorDesconto / subtotal) * 100;
        const limiteDesconto = configuracoes.funcionario.limite_desconto || 0;
        return percentualDesconto <= limiteDesconto;
    }, [configuracoes, subtotal]);

    const limparCarrinho = useCallback(() => {
        updateSessao({
            carrinho: [],
            cliente: null,
            emailRecibo: '',
            pagamentos: [],
            observacoes: '',
            descontoGeral: 0,
            descontoPercentual: false,
            paraEntregar: false,
            dadosEntrega: { distancia_km: 0, taxa_entrega: 0, endereco: null }
        });
    }, [updateSessao]);

    const finalizarVenda = async (
        extraData?: { data_vencimento_fiado?: string; emitir_nfce?: boolean; offline_uuid?: string },
        enqueueFn?: (payload: any) => Promise<string>) => {
        if (carrinho.length === 0) {
            throw new Error('Adicione produtos ao carrinho');
        }

        const permiteVendaSemCliente = configuracoes?.permite_venda_sem_cliente ?? true;
        if (!permiteVendaSemCliente && !cliente) {
            throw new Error('Selecione um cliente para continuar');
        }

        const totalPago = round(pagamentos.reduce((sum, p) => sum + p.valor, 0));
        if (totalPago < (total - 0.01)) {
            throw new Error(`Valor recebido insuficiente (R$ ${totalPago.toFixed(2)}). Faltam R$ ${(total - totalPago).toFixed(2)}`);
        }

        setLoading(true);

        try {
            const vendaData = {
                items: carrinho.map(item => ({
                    id: item.produto.id,
                    quantity: item.quantidade,
                    discount: item.desconto,
                    price: item.precoUnitario
                })),
                subtotal,
                desconto: descontoTotal,
                total,
                pagamentos: pagamentos.map(p => ({
                    forma: p.forma,
                    valor: p.valor,
                    bandeira: p.bandeira
                })),
                valor_recebido: totalPago,
                troco,
                cliente_id: cliente?.id ? Number(cliente.id) : null,
                email_destino: emailRecibo.trim() || undefined,
                observacoes: observacoes.trim() || undefined,
                dados_entrega: paraEntregar ? dadosEntrega : undefined,
                ...(extraData || {}),
            };

            let venda;

            if (!navigator.onLine && enqueueFn) {
                const uuid = await enqueueFn(vendaData);
                return { offline: true, codigo: uuid };
            }

            try {
                venda = await pdvService.finalizarVenda(vendaData);
            } catch (error: any) {
                if (enqueueFn && (!error.response || error.code === 'ERR_NETWORK')) {
                    const uuid = await enqueueFn(vendaData);
                    return { offline: true, codigo: uuid };
                }
                throw error;
            }

            // ── Alerta de Sangria ──────────────────────────────────────────
            const totalDinheiro = pagamentos.filter(p => p.forma === 'dinheiro').reduce((sum, p) => sum + p.valor, 0);
            const LIMITE_SANGRIA = 500;
            if (totalDinheiro > 0) {
                try {
                    const resumo = await pdvService.getResumoCaixa();
                    const saldoDinheiro = resumo?.por_forma?.dinheiro ?? resumo?.saldo_atual ?? 0;
                    if (saldoDinheiro > LIMITE_SANGRIA) {
                        showToast.warning(
                            `💰 Sangria recomendada! Dinheiro no caixa: R$ ${saldoDinheiro.toFixed(2).replace('.', ',')}. Limite: R$ ${LIMITE_SANGRIA},00`,
                            { duration: 8000, icon: '🔔' }
                        );
                    }
                } catch {
                    // Alerta de sangria é não-crítico
                }
            }

            return venda;
        } catch (error: any) {
            console.error("Erro ao finalizar venda:", error);
            throw error;
        } finally {
            setLoading(false);
        }
    };

    return {
        // Multi-Session Utilities
        sessoes,
        sessaoAtivaId,
        adicionarSessao,
        alternarSessao,
        removerSessao,

        // Current Session Data
        carrinho,
        cliente,
        setCliente,
        emailRecibo,
        setEmailRecibo,
        formasPagamento,
        pagamentos,
        setPagamentos,
        adicionarPagamento,
        removerPagamento,
        observacoes,
        setObservacoes,
        descontoGeral,
        setDescontoGeral,
        descontoPercentual,
        setDescontoPercentual,
        paraEntregar,
        setParaEntregar,
        dadosEntrega,
        setDadosEntrega,
        configuracoes,
        loading,
        subtotal,
        descontoItens,
        descontoGeralCalculado,
        descontoTotal,
        total,
        troco,
        adicionarProduto,
        removerProduto,
        atualizarQuantidade,
        aplicarDescontoItem,
        validarDescontoPermitido,
        limparCarrinho,
        finalizarVenda,
        caixaAberto,
        setCaixaAberto,
        refreshCaixa
    };
};
