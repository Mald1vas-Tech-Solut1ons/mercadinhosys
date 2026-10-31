import { apiClient } from '../../api/apiClient';
import { ApiResponse, Produto, ProdutosResponse, ProdutoFiltros } from '../../types';

export const productsService = {
    // ==================== ROTAS PDV ====================
    search: async (query: string, limit = 20): Promise<Produto[]> => {
        const response = await apiClient.get<{ success: boolean; produtos: Produto[] }>('/produtos/search', {
            params: { q: query, limit },
        });
        return response.data.produtos;
    },

    // Código interno EAN-13 (prefixo 20) para produto sem código do fabricante
    proximoCodigoBarras: async (): Promise<string> => {
        const response = await apiClient.get<{ success: boolean; codigo_barras: string }>('/produtos/codigo-barras/proximo');
        return response.data.codigo_barras;
    },

    gerarCodigosBarras: async (produtoIds: number[]): Promise<Record<string, string>> => {
        const response = await apiClient.post<{ success: boolean; codigos: Record<string, string> }>(
            '/produtos/codigo-barras/gerar', { produto_ids: produtoIds });
        return response.data.codigos;
    },

    getByBarcode: async (codigo: string): Promise<Produto> => {
        const response = await apiClient.get<{ success: boolean; produto: Produto }>(`/produtos/barcode/${codigo}`);
        return response.data.produto;
    },

    /** Sugestão de descrição via IA a partir do que já está no formulário. */
    gerarDescricaoIA: async (dados: {
        nome: string; categoria?: string; marca?: string; unidade_medida?: string;
        tipo_item?: string; descricao_atual?: string;
    }): Promise<string> => {
        const response = await apiClient.post<{ success: boolean; descricao: string }>('/produtos/descricao-ia', dados);
        return response.data.descricao;
    },

    /** Auto-preenchimento inteligente de Família, Categoria, Subcategoria, NCM, CFOP, CSOSN e Descrição pelo nome do produto. */
    classificarIA: async (dados: {
        nome: string;
        marca?: string;
        tipo_item?: string;
    }) => {
        const response = await apiClient.post<{
            success: boolean;
            sugestao: {
                familia_produto: string;
                familia_nome: string;
                categoria_oficial: string;
                categoria_nome: string;
                subcategoria: string;
                ncm: string;
                cfop_padrao: string;
                csosn: string;
                unidade_medida: string;
                atributos: Record<string, string>;
                descricao: string;
            };
        }>('/produtos/classificar-ia', dados);
        return response.data.sugestao;
    },

    // ==================== CRUD COMPLETO ESTOQUE ====================
    getAllEstoque: async (pagina = 1, porPagina = 25, filtros?: ProdutoFiltros): Promise<ProdutosResponse> => {
        const params: any = {
            pagina,
            por_pagina: porPagina,
        };

        if (filtros) {
            if (filtros.busca) params.busca = filtros.busca;
            if (filtros.categoria) params.categoria = filtros.categoria;
            // Taxonomia oficial (PLANO §3.4/§4 item 5): filtro por categoria e por subcategoria.
            if (filtros.categoria_oficial) params.categoria_oficial = filtros.categoria_oficial;
            if (filtros.subcategoria_oficial) params.subcategoria_oficial = filtros.subcategoria_oficial;
            if (filtros.fornecedor_id) params.fornecedor_id = filtros.fornecedor_id;
            if (filtros.ativos !== undefined) params.ativos = filtros.ativos;
            if (filtros.preco_min) params.preco_min = filtros.preco_min;
            if (filtros.preco_max) params.preco_max = filtros.preco_max;
            if (filtros.estoque_status) params.estoque_status = filtros.estoque_status;
            if (filtros.validade_proxima) params.validade_proxima = filtros.validade_proxima;
            if (filtros.dias_validade) params.dias_validade = filtros.dias_validade;
            if (filtros.vencidos) params.vencidos = filtros.vencidos;
            if (filtros.tipo) params.tipo = filtros.tipo;
            if (filtros.ordenar_por) params.ordenar_por = filtros.ordenar_por;
            if (filtros.direcao) params.direcao = filtros.direcao;
            if (filtros.filtro_rapido) params.filtro_rapido = filtros.filtro_rapido;
            if (filtros.expandir_por_lote === true) params.expandir_por_lote = "true";
        }

        const response = await apiClient.get<ProdutosResponse>('/produtos/', { params });



        return response.data;
    },

    getById: async (id: number): Promise<Produto> => {
        const response = await apiClient.get<{ success: boolean; produto: Produto }>(`/produtos/${id}/`);
        return response.data.produto;
    },

    getProductHubData: async (id: number, periodo: string = 'all'): Promise<any> => {
        const response = await apiClient.get<any>(`/produtos/${id}/hub`, {
            params: { periodo }
        });
        return response.data;
    },

    create: async (data: Partial<Produto>): Promise<{
        success: boolean;
        message: string;
        produto?: Produto;
        code?: string;
        produto_existente?: Partial<Produto>;
    }> => {
        try {
            const response = await apiClient.post<any>('/produtos/', data);
            return response.data;
        } catch (error: any) {
            // 409: EAN ou código interno já existe — retorna os dados do produto existente
            // para que a UI possa oferecer edição em vez de criação.
            if (error?.response?.status === 409) {
                return error.response.data;
            }
            // 400 do guardião do cadastro: devolve os motivos (`errors`) para a tela ensinar o que corrigir.
            if (error?.response?.status === 400 && error.response.data && typeof error.response.data === 'object') {
                return { success: false, ...error.response.data };
            }
            throw error;
        }
    },

    update: async (id: number, data: Partial<Produto>): Promise<{ success: boolean; message: string; produto: Produto }> => {
        const response = await apiClient.put<any>(`/produtos/${id}/`, data);
        return response.data;
    },

    delete: async (id: number, force?: boolean): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.delete<any>(`/produtos/${id}/`, { params: force ? { force: true } : undefined });
        return response.data;
    },

    ajustarEstoque: async (
        id: number,
        quantidade: number,
        operacao: 'entrada' | 'saida',
        motivo?: string,
        observacoes?: string,
        fornecedor_id?: number,
        lote?: string,
        data_fabricacao?: string,
        data_validade?: string,
        lote_id?: number,
        corrigir_lote_existente?: boolean
    ): Promise<{ success: boolean; message: string; produto: any }> => {
        const payload: any = {
            tipo: operacao,
            quantidade,
            motivo,
            fornecedor_id,
            lote,
            data_fabricacao,
            data_validade,
            lote_id,
            corrigir_lote_existente
        };
        if (observacoes !== undefined) payload.observacoes = observacoes;
        const response = await apiClient.post<any>(`/produtos/${id}/estoque`, payload);
        return response.data;
    },

    getLotesDisponiveis: async (produtoId: number) => {
        const response = await apiClient.get<{
            lotes: any[];
            total_lotes: number;
            total_quantidade: number;
        }>(`/produtos/${produtoId}/lotes-disponiveis`);
        return response.data;
    },

    atualizarLote: async (
        produtoId: number,
        loteId: number,
        data: {
            numero_lote?: string;
            data_fabricacao?: string;
            data_validade?: string;
            fornecedor_id?: number;
        }
    ) => {
        const response = await apiClient.patch<any>(`/produtos/${produtoId}/lotes/${loteId}`, data);
        return response.data;
    },

    getAlertas: async (): Promise<Array<any>> => {
        const response = await apiClient.get<any>('/produtos/alertas');
        return response.data.alertas || [];
    },

    toggleProductStatus: async (id: number, ativo: boolean): Promise<any> => {
        const response = await apiClient.patch<any>(`/produtos/${id}/toggle-ativo`, { ativo });
        return response.data;
    },

    // ==================== CATEGORIAS E RELATÓRIOS ====================
    getCategorias: async (ativos = true): Promise<{ categorias: string[]; total_categorias: number }> => {
        const response = await apiClient.get<any>('/produtos/categorias', {
            params: { ativos },
        });
        return response.data;
    },


    async getProductSalesHistory(id: number, dias: number = 90): Promise<any> {
        try {
            const response = await apiClient.get(`/produtos/${id}/vendas-historico`, { params: { dias } });
            return response.data;
        } catch (error) {
            console.error('Erro ao obter histórico de vendas do produto:', error);
            throw error;
        }
    },

    exportarCSV: async (ativos = true): Promise<{ success: boolean; csv: string; total_produtos: number }> => {
        const response = await apiClient.get<any>('/produtos/exportar/csv', {
            params: { ativos },
        });
        return response.data;
    },

    // ==================== FUNÇÕES ANTIGAS (MANTER COMPATIBILIDADE) ====================
    getAll: async (page = 1, perPage = 20, filters?: any): Promise<ApiResponse<Produto[]>> => {
        const response = await productsService.getAllEstoque(page, perPage, filters);
        return {
            success: true,
            data: response.produtos,
            pagination: {
                page: response.paginacao.pagina_atual,
                per_page: response.paginacao.itens_por_pagina,
                total: response.paginacao.total_itens,
                total_pages: response.paginacao.total_paginas,
            },
        };
    },

    updateStock: async (id: number, quantidade: number): Promise<Produto> => {
        const response = await productsService.ajustarEstoque(id, quantidade, 'entrada');
        return response.produto;
    },

    getLowStock: async (): Promise<Produto[]> => {
        const response = await productsService.getAllEstoque(1, 50, { estoque_status: 'baixo' });
        return response.produtos;
    },

    getByCategory: async (categoria: string): Promise<Produto[]> => {
        const response = await productsService.getAllEstoque(1, 50, { categoria });
        return response.produtos;
    },

    // ==================== NOVO: ESTATÍSTICAS AGREGADAS ====================
    getEstatisticas: async (filtros?: ProdutoFiltros & { filtro_rapido?: string }): Promise<{
        success: boolean;
        estatisticas: {
            total_produtos: number;
            produtos_baixo_estoque: number;
            produtos_esgotados: number;
            produtos_normal: number;
            valor_total_estoque: number;
            margem_media: number;
            margem_alta?: number;
            margem_baixa?: number;
            classificacao_abc: { A: number; B: number; C: number };
            giro_estoque: { rapido: number; normal: number; lento: number };
            validade: { vencidos: number; vence_15: number; vence_30: number; vence_90: number };
            top_produtos_margem: any[];
            produtos_criticos: any[];
            filtros_aplicados: any;
        };
    }> => {
        const params: any = {};

        if (filtros) {
            if (filtros.busca) params.busca = filtros.busca;
            if (filtros.categoria) params.categoria = filtros.categoria;
            if (filtros.categoria_oficial) params.categoria_oficial = filtros.categoria_oficial;
            if (filtros.subcategoria_oficial) params.subcategoria_oficial = filtros.subcategoria_oficial;
            if (filtros.fornecedor_id) params.fornecedor_id = filtros.fornecedor_id;
            if (filtros.ativos !== undefined) params.ativos = filtros.ativos;
            if (filtros.preco_min) params.preco_min = filtros.preco_min;
            if (filtros.preco_max) params.preco_max = filtros.preco_max;
            if (filtros.estoque_status) params.estoque_status = filtros.estoque_status;
            if (filtros.tipo) params.tipo = filtros.tipo;
            if (filtros.filtro_rapido) params.filtro_rapido = filtros.filtro_rapido;
        }

        const response = await apiClient.get<any>('/produtos/estatisticas', { params });

        return response.data;
    },
    bulkUpdatePrices: async (
        atualizacoes: { id: number; lote_id?: number; novo_preco: number }[]
    ): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.post('/produtos/bulk-update-prices', { atualizacoes });
        return response.data;
    },

    importarCSV: async (file: File): Promise<{
        success: boolean;
        message: string;
        total_importados: number;
        total_erros: number;
        erros: string[]
    }> => {
        const formData = new FormData();
        formData.append('arquivo', file);

        const response = await apiClient.post('/produtos/importar', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    },

    descartarProduto: async (
        id: number,
        quantidade: number,
        motivoEspecifico: string,
        observacoes?: string
    ): Promise<{ success: boolean; message: string; data: any }> => {
        const response = await apiClient.post<any>(`/produtos/${id}/descarte`, {
            quantidade,
            motivo_especifico: motivoEspecifico,
            observacoes
        });
        return response.data;
    },
};
