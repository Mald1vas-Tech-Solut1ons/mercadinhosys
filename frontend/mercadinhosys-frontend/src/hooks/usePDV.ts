import { useState, useCallback, useEffect, useRef } from 'react';
import { Produto, Cliente } from '../types';
import { pdvService, ConfiguracoesPDV, CaixaPDV } from '../features/pdv/pdvService';
import { showToast } from '../utils/toast';
import { mensagemErro } from '../utils/mensagemErro';
import { parseDataValidade } from '../utils/validade';

export interface ItemCarrinho {
    produto: Produto;
    quantidade: number;
    precoUnitario: number;
    desconto: number;
    descontoPercentual: boolean;
    total: number;
    /** FASE 1.7: true quando o desconto foi autorizado por gerente/admin via PinDialog. */
    descontoAutorizadoExterno?: boolean;
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
// FASE 1.4: sessão keyada por operador — pdv_sessions_v1_<funcionario_id>.
// O carrinho do operador anterior não vaza para o novo operador no mesmo tablet.
/**
 * Valor de sangria a partir do qual o PDV avisa (FASE 1.x).
 * Hoje é constante porque Configuracao não tem campo de limite de sangria — quando
 * tiver, este é o único ponto a trocar (a tela não decide mais o número).
 */
export const LIMITE_SANGRIA_PADRAO = 500;

export { PDV_STORAGE_PREFIX, pdvStorageKey, limparSessaoOperador } from '../utils/pdvStorage';
import { pdvStorageKey, limparSessaoOperador } from '../utils/pdvStorage';

/**
 * FASE 1.7: limite efetivo de desconto. O backend (checkout_locking.validate_pricing) usa
 * min(funcionario.limite_desconto, config.desconto_maximo_percentual, config.desconto_maximo_funcionario).
 * `limite_desconto` 0/ausente no permissoes_json significa "sem limite explícito do funcionário" —
 * nesse caso vale o limite da LOJA, senão o operador do piloto fica travado em 0% e não vende.
 */
export const calcularLimiteDesconto = (configuracoes: ConfiguracoesPDV | null): number => {
    if (!configuracoes) return 0;
    // validate_pricing (checkout_locking.py:85): sem pode_dar_desconto o limite é 0.
    if (!configuracoes.funcionario.pode_dar_desconto) return 0;
    const daLoja = configuracoes.funcionario.limite_desconto_loja ?? 100;
    const doFuncionario = configuracoes.funcionario.limite_desconto ?? 0;
    return Math.min(doFuncionario > 0 ? doFuncionario : daLoja, daLoja);
};

const carregarSessoesSalvas = (funcionarioId?: number | string | null): { sessoes: PDVSession[]; sessaoAtivaId: string } | null => {
    try {
        const raw = sessionStorage.getItem(pdvStorageKey(funcionarioId));
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
        } catch (error: any) {
            console.error('Erro ao atualizar status do caixa:', error);
            // Falha de rede não fecha o caixa na tela: mantém o último estado conhecido.
            if (error?.response) setCaixaAberto(null);
            return null;
        }
    }, []);

    // Múltiplas Sessões do PDV — restauradas do sessionStorage ao remontar a tela.
    // FASE 1.4: storage keyada por funcionário — o carrinho do operador anterior
    // não vaza para o novo operador no mesmo tablet. Quando o operador muda (troca no
    // CaixaHeader ou logout/login), os estadoInicial/sessões são re-carregados para a
    // chave do operador atual, e o state é substituído (não "mesclado") pelo do novo.
    const [funcionarioIdSessao, setFuncionarioIdSessao] = useState<number | null>(null);
    const [estadoInicial] = useState(() => carregarSessoesSalvas(null));
    const [sessoes, setSessoes] = useState<PDVSession[]>(() => estadoInicial?.sessoes ?? [createInitialSession()]);
    const [sessaoAtivaId, setSessaoAtivaId] = useState<string>(() => estadoInicial?.sessaoAtivaId ?? sessoes[0].id);

    // Assim que 'configuracoes' chega com o operador logado, muda a chave de persistência.
    useEffect(() => {
        const fid = configuracoes?.funcionario?.id ?? null;
        if (fid === funcionarioIdSessao) return;
        let salvo = carregarSessoesSalvas(fid);
        // Migração única: carrinho que estava na chave legada (antes da FASE 1.4) é do
        // operador que está no aparelho — adota em vez de descartar o trabalho dele.
        if (!salvo && funcionarioIdSessao === null) {
            salvo = carregarSessoesSalvas(null);
            if (salvo) limparSessaoOperador(null);
        }
        setFuncionarioIdSessao(fid);
        setSessoes(salvo?.sessoes ?? [createInitialSession()]);
        setSessaoAtivaId(salvo?.sessaoAtivaId ?? (salvo?.sessoes?.[0]?.id ?? Date.now().toString()));
    }, [configuracoes?.funcionario?.id, funcionarioIdSessao]);

    useEffect(() => {
        try {
            sessionStorage.setItem(pdvStorageKey(funcionarioIdSessao), JSON.stringify({ sessoes, sessaoAtivaId }));
        } catch {
            // sessionStorage indisponível (modo privado/quota) — segue apenas em memória
        }
    }, [sessoes, sessaoAtivaId, funcionarioIdSessao]);

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
    const recarregarConfiguracoes = useCallback(async () => {
        try {
            const config = await pdvService.getConfiguracoes();
            setConfiguracoes(config);
            setFormasPagamento(config.formas_pagamento);
            await refreshCaixa();
        } catch (error) {
            console.error('Erro ao carregar configurações/caixa do PDV:', error);
            showToast.error(mensagemErro(error, 'Não foi possível carregar as configurações do PDV. Recarregue a página.'), { duration: 6000 });
        }
    }, [refreshCaixa]);

    useEffect(() => {
        void recarregarConfiguracoes();
    }, [recarregarConfiguracoes]);

    // FASE 1.4: outro operador assume o tablet sem recarregar a página. Recarrega as
    // configurações para que permissões, limite de desconto e a chave do carrinho passem
    // a ser as do operador novo (o login dispara 'auth-change').
    useEffect(() => {
        const aoTrocarOperador = () => { void recarregarConfiguracoes(); };
        window.addEventListener('auth-change', aoTrocarOperador);
        return () => window.removeEventListener('auth-change', aoTrocarOperador);
    }, [recarregarConfiguracoes]);

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

    // Troco só sobre o excedente pago em dinheiro.
    const excedente = totalPago > total ? totalPago - total : 0;
    const totalDinheiro = pagamentos.reduce((sum, p) => (p.forma === 'dinheiro' ? sum + p.valor : sum), 0);
    const troco = round(Math.min(excedente, totalDinheiro));

    const totalAnteriorRef = useRef({ sessao: sessaoAtivaId, total });
    useEffect(() => {
        // Pagamentos lançados para outro total ficariam inválidos (ex.: fiado maior que a venda).
        const anterior = totalAnteriorRef.current;
        if (anterior.sessao === sessaoAtivaId && total !== anterior.total && pagamentos.length > 0) {
            setPagamentos([]);
        }
        totalAnteriorRef.current = { sessao: sessaoAtivaId, total };
    }, [total, sessaoAtivaId, pagamentos.length, setPagamentos]);

    // Adicionar produto ao carrinho
    // Retorna false quando o item foi recusado antes de ir ao carrinho (produto vencido).
    const adicionarProduto = useCallback((produto: Produto, quantidade: number = 1): boolean => {
        const controlarValidade = configuracoes?.controlar_validade ?? true;

        if (controlarValidade && produto.data_validade) {
            const dataValidade = parseDataValidade(produto.data_validade);
            if (!dataValidade) {
                // Produto sem data legível → sem bloqueio (regra do guardião: null = sem data).
            } else {
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);

                if (dataValidade < hoje) {
                    // Vencido não entra no carrinho (só "a vencer" é aviso).
                    showToast.error(`Produto vencido — não pode ser vendido. Retire da gôndola. (${produto.nome})`, {
                        duration: 8000
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
                                duration: 5000
                            });
                        }
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
        if (!configuracoes) return;
        const item = (sessaoAtiva.carrinho || []).find(i => i.produto.id === produtoId);
        if (!item) return;

        const descontoValor = percentual
            ? item.precoUnitario * item.quantidade * (desconto / 100)
            : desconto;

        const percentualEfetivo = ((descontoValor || 0) / Math.max(subtotal, 0.01)) * 100;
        const limiteDesconto = calcularLimiteDesconto(configuracoes);
        const ehAdmin = configuracoes.funcionario.role === 'ADMIN' || configuracoes.funcionario.role === 'admin';

        // FASE 1.7: acima do limite, exige autorização de gerente/admin via PIN.
        // O PinDialog é disparado pela CAMADA UI (PDVPage) pois é visual; aqui
        // apenas decidimos se bloqueia. PDVPage chama aplicarDescontoItem e,
        // quando bloqueado, abre o PinDialog e re-chama com autorizado=true.
        if (!ehAdmin && percentualEfetivo > limiteDesconto) {
            const msg = `Desconto de ${percentualEfetivo.toFixed(1)}% excede seu limite de ${limiteDesconto}%. Um gerente precisa autorizar.`;
            showToast.error(msg, { duration: 6000 });
            // Lança erro especial que PDVPage escuta para abrir o PinDialog.
            const err: any = new Error('DESCONTO_EXCEDE_LIMITE');
            err.code = 'DESCONTO_EXCEDE_LIMITE';
            err.produtoId = produtoId;
            err.desconto = desconto;
            err.percentual = percentual;
            throw err;
        }

        setCarrinho(prev =>
            prev.map(item => {
                if (item.produto.id === produtoId) {
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
    }, [configuracoes, sessaoAtiva.carrinho, subtotal, setCarrinho]);

    const validarDescontoPermitido = useCallback((valorDesconto: number): boolean => {
        if (!configuracoes) return false;
        if (configuracoes.funcionario.role === 'ADMIN') return true;

        const percentualDesconto = (valorDesconto / subtotal) * 100;
        const limiteDesconto = calcularLimiteDesconto(configuracoes);
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
            // Sem campo de limite de sangria no backend ainda: valor nomeado aqui, num lugar só.
            const LIMITE_SANGRIA = LIMITE_SANGRIA_PADRAO;
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

    /** FASE 1.7: aplica o desconto SEM checar limite — só deve ser chamado pela UI
     *  depois que o PinDialog autorizou um gerente/admin. O `pinAutorizado` é repassado
     *  para o backend no próximo finalizarVenda para gravar Auditoria no servidor. */
    const aplicarDescontoItemAutorizado = useCallback((produtoId: number, desconto: number, percentual: boolean = false) => {
        const item = (sessaoAtiva.carrinho || []).find(i => i.produto.id === produtoId);
        if (!item) return;
        const descontoValor = percentual
            ? item.precoUnitario * item.quantidade * (desconto / 100)
            : desconto;
        setCarrinho(prev =>
            prev.map(it => it.produto.id === produtoId
                ? {
                    ...it,
                    desconto: descontoValor,
                    descontoPercentual: percentual,
                    total: it.precoUnitario * it.quantidade - descontoValor,
                    descontoAutorizadoExterno: true,
                }
                : it
            )
        );
    }, [sessaoAtiva.carrinho, setCarrinho]);

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
        aplicarDescontoItemAutorizado,
        validarDescontoPermitido,
        limparCarrinho,
        finalizarVenda,
        caixaAberto,
        setCaixaAberto,
        refreshCaixa
    };
};
