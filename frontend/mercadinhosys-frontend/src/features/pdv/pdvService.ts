import { apiClient } from '../../api/apiClient';
import { ApiResponse, Produto, Cliente } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { salvarCatalogo, ProdutoCatalogo } from './offlineCatalog';

// Gera um UUID (usa o nativo do browser quando disponível; senão, a lib uuid)
export const genUuid = (): string =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : uuidv4();

// Tipos específicos do PDV
export interface ConfiguracoesPDV {
    funcionario: {
        id: number;
        nome: string;
        role: string;
        pode_dar_desconto: boolean;
        limite_desconto: number;
        /** FASE 1.7: teto da loja (Configuracao.desconto_maximo_funcionario) — o backend aplica min(operador, loja). */
        limite_desconto_loja?: number;
        pode_cancelar_venda: boolean;
    };
    formas_pagamento: FormaPagamentoPDV[];
    permite_venda_sem_cliente: boolean;
    permitir_venda_sem_estoque: boolean;
    controlar_validade: boolean;
    alerta_estoque_minimo: boolean;
    dias_alerta_validade: number;
    estoque_minimo_padrao: number;
    exibe_preco_tela: boolean;
    mostrar_foto_produto_pdv: boolean;
    exige_observacao_desconto: boolean;
    /** Cabeçalho da loja no cupom — guardado no aparelho para imprimir venda offline. */
    cupom_cabecalho?: ComprovanteVendaResponse['estabelecimento'];
    /** Prontidão fiscal (backend: gateway real configurado). Ausente em backends antigos. */
    nfce?: {
        pronta: boolean;
        ambiente: 'homologacao' | 'producao' | string;
        gateway?: string;
    };
}

export interface FormaPagamentoPDV {
    tipo: string;
    label: string;
    taxa: number;
    permite_troco: boolean;
}

export interface ValidarProdutoRequest {
    produto_id?: number;
    codigo_barras?: string;
    quantidade: number;
}

export interface ValidarProdutoResponse {
    valido: boolean;
    produto: Produto;
    mensagem?: string;
}

export interface CalcularVendaRequest {
    items: {
        produto_id: number;
        quantidade: number;
        desconto: number;
    }[];
    desconto_geral: number;
    desconto_percentual: boolean;
    forma_pagamento: string;
    valor_recebido?: number;
}

export interface CalcularVendaResponse {
    success: boolean;
    calculo: {
        subtotal: number;
        desconto: number;
        total: number;
        troco: number;
        quantidade_itens: number;
        valor_recebido: number;
    };
}

export interface FinalizarVendaRequest {
    items: {
        id: number;
        quantity: number;
        discount: number;
        price: number;
    }[];
    subtotal: number;
    desconto: number;
    total: number;
    pagamentos: {
        forma?: string; // Novo padrão
        forma_pagamento?: string; // Mantido para compatibilidade
        valor: number;
        bandeira?: string;
    }[];
    valor_recebido: number;
    troco: number;
    cliente_id?: number | null;
    email_destino?: string;
    observacoes?: string;
    data_vencimento_fiado?: string;
    paymentMethod?: string; // Mantido para compatibilidade temporária
    emitir_nfce?: boolean; // Gatilho de Emissão
    offline_uuid?: string; // Idempotência: o mesmo carrinho reenviado não duplica a venda
}

export interface AutorizarGerenteRequest {
    username: string;
    password: string;
    acao: 'desconto' | 'cancelamento';
    valor_desconto?: number;
}

export interface ComprovanteVendaResponse {
    success: boolean;
    venda: {
        id: number;
        codigo: string;
        data: string;
    };
    estabelecimento?: {
        nome_fantasia?: string;
        razao_social?: string;
        cnpj?: string;
        inscricao_estadual?: string;
        telefone?: string;
        email?: string;
        endereco?: string;
    };
    comprovante: {
        funcionario: string;
        cliente: string;
        itens: Array<{
            nome: string;
            codigo?: string;
            quantidade: number;
            preco_unitario: number;
            total: number;
        }>;
        subtotal: number;
        desconto: number;
        total: number;
        forma_pagamento: string;
        valor_recebido: number;
        troco: number;
        rodape?: string;
        valor_tributos?: number;
        percentual_tributos?: number;
    };
    nfce?: {
        chave_acesso?: string;
        status?: string;
        qr_code?: string;
        danfe_url?: string;
        numero?: string;
        serie?: string;
        protocolo?: string;
    };
}

export interface VendaHojeResumo {
    id: number;
    codigo: string;
    total: number;
    hora: string;
    forma_pagamento: string;
    offline_uuid?: string | null;
}

export interface CaixaPDV {
    id: number;
    numero_caixa: string;
    saldo_inicial: number;
    saldo_atual?: number; // ausente no fechamento cego (sem permissão "ver valor esperado")
    data_abertura: string;
    data_fechamento?: string;
    status: string;
}

export interface MovimentacaoCaixaRequest {
    tipo: 'sangria' | 'suprimento';
    valor: number;
    descricao: string;
    forma_pagamento?: string;
    /** PIN de segurança de Admin/Gerente — obrigatório para sangria. */
    pin?: string;
}

export const pdvService = {
    // ==================== CONFIGURAÇÕES PDV ====================

    /**
     * Carrega configurações do PDV incluindo permissões do funcionário
     */
    getConfiguracoes: async (): Promise<ConfiguracoesPDV> => {
        const response = await apiClient.get<any>('/pdv/configuracoes');
        return response.data.configuracoes;
    },

    // ==================== VALIDAÇÃO DE PRODUTOS ====================

    /**
     * Valida produto antes de adicionar ao carrinho
     * Verifica estoque disponível e retorna dados completos
     */
    validarProduto: async (data: ValidarProdutoRequest): Promise<ValidarProdutoResponse> => {
        const response = await apiClient.post<any>('/pdv/validar-produto', data);
        return {
            valido: response.data.valido,
            produto: response.data.produto,
            mensagem: response.data.mensagem
        };
    },

    /**
     * Busca produtos para o PDV - usa a rota turbo dedicada
     * ~10x mais rápida que a listagem geral
     */
    buscarProduto: async (query: string): Promise<Produto[]> => {
        const t0 = performance.now();
        const response = await apiClient.get<any>('/pdv/buscar-produtos', {
            params: { q: query }
        });
        const t1 = performance.now();
        console.log(`🚀 Busca PDV: "${query}" → ${response.data?.produtos?.length ?? 0} resultados em ${(t1 - t0).toFixed(0)}ms`);

        if (response.data.success && Array.isArray(response.data.produtos)) {
            return response.data.produtos;
        }

        return [];
    },

    /**
     * Baixa o catálogo completo (leve) e grava no IndexedDB para venda offline.
     * Retorna a quantidade de produtos cacheados. Chamar quando online.
     */
    sincronizarCatalogoOffline: async (): Promise<number> => {
        const { data } = await apiClient.get<any>('/pdv/catalogo-offline');
        if (data?.success && Array.isArray(data.produtos)) {
            await salvarCatalogo(data.produtos as ProdutoCatalogo[]);
            return data.produtos.length;
        }
        return 0;
    },

    /**
     * Busca produto por código de barras
     */
    buscarPorCodigoBarras: async (codigo: string): Promise<Produto | null> => {
        try {
            const validacao = await pdvService.validarProduto({
                codigo_barras: codigo,
                quantidade: 1
            });
            return validacao.valido ? validacao.produto : null;
        } catch (error) {
            console.error('Erro ao buscar por código de barras:', error);
            return null;
        }
    },

    // ==================== CÁLCULOS E PREVIEW ====================

    /**
     * Calcula totais em tempo real (preview)
     * Não persiste dados, apenas retorna cálculos
     */
    calcularVenda: async (data: CalcularVendaRequest): Promise<CalcularVendaResponse> => {
        const response = await apiClient.post<CalcularVendaResponse>('/pdv/calcular-venda', data);
        return response.data;
    },

    /**
     * Finaliza venda de forma ATÔMICA.
     * - Online: POST /pdv/finalizar → backend → Aiven
     * - Offline: enfileira em IndexedDB → sincroniza quando voltar o sinal
     *
     * Retorna { venda, offline: true } quando enfileirado offline.
     */
    finalizarVenda: async (data: FinalizarVendaRequest, offlineEnqueue?: (payload: any) => Promise<string>): Promise<any> => {
        // Gera o offline_uuid ANTES da 1ª tentativa e envia já no POST online.
        // Assim, se a resposta se perder (rede caiu DEPOIS de o servidor processar),
        // o re-envio cai na idempotência do backend e NÃO duplica a venda.
        const offline_uuid = (data as any).offline_uuid || genUuid();
        const payload = { ...data, offline_uuid };
        try {
            const response = await apiClient.post<any>('/pdv/finalizar', payload);
            return response.data.venda;
        } catch (err: any) {
            // Erro de rede (sem internet) → enfileira offline (mesmo offline_uuid)
            const isNetworkError = !err?.response;
            if (isNetworkError && offlineEnqueue) {
                await offlineEnqueue(payload);
                console.log('📦 Venda salva offline:', offline_uuid);
                return {
                    id: offline_uuid,
                    offline: true,
                    offline_uuid,
                    codigo: `OFF-${offline_uuid.slice(0, 8).toUpperCase()}`,
                    total: data.total,
                    forma_pagamento: data.pagamentos?.[0]?.forma || 'dinheiro',
                    data: new Date().toISOString(),
                };
            }
            // Outro tipo de erro (500, 401, etc.) — propaga normalmente
            throw err;
        }
    },

    // ==================== ESTATÍSTICAS E RESUMOS ====================

    /**
     * Retorna resumo das vendas de hoje
     */
    getVendasHoje: async (): Promise<any> => {
        const response = await apiClient.get<any>('/pdv/vendas-hoje');
        return response.data;
    },

    /**
     * Estatísticas rápidas do PDV
     */
    getEstatisticasRapidas: async (): Promise<any> => {
        const response = await apiClient.get<any>('/pdv/estatisticas-rapidas');
        return response.data.estatisticas;
    },

    // ==================== CANCELAMENTO ====================

    /**
     * Cancela venda (requer permissão)
     */
    cancelarVenda: async (vendaId: number, motivo: string): Promise<void> => {
        await apiClient.post(`/pdv/cancelar-venda/${vendaId}`, { motivo });
    },

    // ==================== AUTORIZAÇÃO DE GERENTE ====================

    /**
     * Solicita autorização de gerente para desconto/cancelamento
     */
    autorizarGerente: async (data: AutorizarGerenteRequest): Promise<boolean> => {
        try {
            const response = await apiClient.post<any>('/auth/login', {
                username: data.username,
                password: data.password
            });

            // Verifica se tem permissão necessária
            const user = response.data.data?.user;
            if (!user) return false;

            if (data.acao === 'desconto') {
                return user.permissoes?.pode_dar_desconto || user.role === 'gerente' || user.role === 'dono';
            } else if (data.acao === 'cancelamento') {
                return user.permissoes?.pode_cancelar_venda || user.role === 'gerente' || user.role === 'dono';
            }

            return false;
        } catch (error) {
            console.error('Erro ao autorizar gerente:', error);
            return false;
        }
    },

    // ==================== CLIENTES ====================

    /**
     * Busca clientes para vincular à venda
     */
    buscarClientes: async (query: string): Promise<Cliente[]> => {
        const response = await apiClient.get<any>('/clientes/buscar', {
            params: { q: query },
        });
        console.log('👥 Resposta da API de clientes:', response.data);

        // A API retorna { success: true, clientes: [...], total: X }
        if (response.data.success && Array.isArray(response.data.clientes)) {
            return response.data.clientes;
        }

        // Fallback para compatibilidade
        return Array.isArray(response.data) ? response.data : [];
    },

    // ==================== IMPRESSÃO ====================

    /**
     * Imprime comprovante da venda
     */
    imprimirComprovante: async (vendaId: number): Promise<string> => {
        // Redireciona para o endpoint HTML que renderiza a nota Masterclass
        // O baseURL do apiClient já contém o prefixo /api
        const baseUrl = apiClient.defaults.baseURL || '';
        const token = sessionStorage.getItem('access_token');

        // Como o window.open não envia headers customizados facilmente, 
        // passamos o token via query param ou usamos uma rota que o frontend autentica
        // MAS como já temos o token, vamos montar a URL com o token para que o backend autorize via @jwt_required
        return `${baseUrl}/pdv/imprimir-html/${vendaId}?token=${token}`;
    },

    // ==================== EMAIL ====================

    /**
     * Envia cupom fiscal por email
     */
    enviarCupomEmail: async (vendaId: number): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.post<ApiResponse<any>>('/pdv/enviar-cupom', {
            venda_id: vendaId,
        });
        return {
            success: true,
            message: response.data.message || 'Email enviado com sucesso!',
        };
    },

    /**
     * Envia nota fiscal para email específico (para consumidor final ou cliente sem email)
     */
    enviarCupomFiscal: async (vendaId: number, email: string): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.post<ApiResponse<any>>('/pdv/enviar-cupom', {
            venda_id: vendaId,
            email_destino: email,
        });
        return {
            success: true,
            message: response.data.message || 'Nota fiscal enviada com sucesso!',
        };
    },

    /**
     * Busca comprovante completo para exibir em tela
     */
    obterComprovante: async (vendaId: number): Promise<ComprovanteVendaResponse> => {
        const response = await apiClient.get<ComprovanteVendaResponse>(`/pdv/comprovante/${vendaId}`);
        return response.data;
    },

    /** Vendas finalizadas hoje na loja (mais recentes primeiro) — lista de reimpressão do PDV. */
    vendasHoje: async (limite = 50): Promise<VendaHojeResumo[]> => {
        const response = await apiClient.get<any>('/pdv/vendas-hoje', { params: { limite } });
        return response.data?.ultimas_vendas || [];
    },

    // ==================== CAIXAS ====================

    getCaixaAtual: async (): Promise<CaixaPDV | null> => {
        try {
            const res = await apiClient.get('/caixas/atual');
            return res.data?.data || null;
        } catch (error) {
            console.error('Erro ao verificar caixa:', error);
            return null;
        }
    },

    getMovimentacoesCaixa: async (): Promise<any[]> => {
        try {
            const res = await apiClient.get('/caixas/atual/movimentacoes');
            return res.data?.data || [];
        } catch (error) {
            console.error('Erro ao carregar auditoria do caixa:', error);
            throw error;
        }
    },

    getResumoCaixa: async (): Promise<any> => {
        try {
            const res = await apiClient.get('/caixas/atual/resumo');
            return res.data?.data || null;
        } catch (error) {
            console.error('Erro ao carregar resumo do caixa:', error);
            throw error;
        }
    },

    abrirCaixa: async (saldo_inicial: number, observacoes?: string): Promise<CaixaPDV> => {
        const response = await apiClient.post<any>('/caixas/abrir', { saldo_inicial, observacoes });
        return response.data.data;
    },

    fecharCaixa: async (valor_informado: number, observacoes?: string): Promise<any> => {
        const response = await apiClient.post<any>('/caixas/fechar', { valor_informado, observacoes });
        // Retorna o objeto completo: { success, message, data, resumo_fechamento }
        return response.data;
    },

    registrarMovimentacao: async (data: MovimentacaoCaixaRequest): Promise<any> => {
        const response = await apiClient.post<any>('/caixas/movimentacao', data);
        return response.data;
    },

    pagarFiado: async (clienteId: number, valor: number, forma_pagamento: string, observacoes?: string, conta_receber_id?: number): Promise<any> => {
        const response = await apiClient.post<any>(`/clientes/${clienteId}/pagar_fiado`, {
            valor,
            forma_pagamento,
            observacoes,
            conta_receber_id,
        });
        return response.data;
    },
};
