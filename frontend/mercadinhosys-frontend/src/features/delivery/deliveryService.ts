import { apiClient } from '../../api/apiClient';

export interface Motorista {
    id: number;
    nome: string;
    cpf: string;
    rg?: string;
    cnh?: string;
    categoria_cnh?: string;
    validade_cnh?: string | null;
    cnh_documento_url?: string | null;
    cnh_dias_para_vencer?: number | null;
    cnh_vencida?: boolean;
    celular?: string;
    telefone?: string;
    email?: string;
    tipo_vinculo?: string;
    percentual_comissao?: number;
    ativo: boolean;
    disponivel: boolean;
    total_entregas: number;
    avaliacao_media: number;
}

export interface Veiculo {
    id: number;
    placa: string;
    renavam?: string | null;
    modelo: string;
    marca?: string;
    tipo: string;
    ano?: number;
    motorista_id?: number | null;
    motorista_nome?: string | null;
    km_atual?: number;
    consumo_medio?: number;
    data_vencimento_licenciamento?: string | null;
    data_vencimento_seguro?: string | null;
    data_ultima_manutencao?: string | null;
    data_proxima_manutencao?: string | null;
    crlv_documento_url?: string | null;
    licenciamento_dias_para_vencer?: number | null;
    licenciamento_vencido?: boolean;
    seguro_dias_para_vencer?: number | null;
    seguro_vencido?: boolean;
    ativo: boolean;
    disponivel?: boolean;
}

export interface ChecklistItem { item: string; ok: boolean; observacao?: string; }

export interface Checklist {
    id: number;
    veiculo_id: number;
    veiculo_placa?: string;
    motorista_id?: number | null;
    motorista_nome?: string | null;
    km_atual?: number | null;
    itens_json: ChecklistItem[];
    aprovado: boolean;
    observacoes_gerais?: string | null;
    created_at?: string | null;
}

export interface ConformidadeItem { motorista_id?: number; veiculo_id?: number; nome?: string; placa?: string; dias: number; [key: string]: any; }

export interface RelatorioConformidade {
    success: boolean;
    gerado_em: string;
    resumo: { total_motoristas: number; total_veiculos: number; total_pendencias_criticas: number; conforme: boolean };
    cnh: { vencidas: ConformidadeItem[]; a_vencer: ConformidadeItem[] };
    licenciamento: { vencido: ConformidadeItem[]; a_vencer: ConformidadeItem[] };
    seguro: { vencido: ConformidadeItem[]; a_vencer: ConformidadeItem[] };
    checklist_pendente: { veiculo_id: number; placa: string; motivo: string; data?: string }[];
}

export interface TaxaEntrega {
    id: number;
    nome_regiao: string;
    taxa_fixa: number;
    tempo_estimado_minutos: number;
}

export interface Entrega {
    id: number;
    codigo_rastreamento: string;
    venda_id: number;
    cliente_nome?: string;
    status: 'pendente' | 'em_preparo' | 'em_rota' | 'entregue' | 'cancelada';
    endereco_completo: string;
    endereco_bairro: string;
    data_prevista: string;
    data_saida?: string;
    data_entrega?: string;
    km_percorridos?: number;
    tempo_real_minutos?: number;
    custo_combustivel?: number;
    taxa_entrega: number;
    motorista_nome?: string;
    pagamento_tipo?: string;
    pagamento_status?: string;
    valor_a_receber?: number;
}

export interface CreateMotoristaData {
    nome: string;
    cpf: string;
    rg?: string;
    cnh: string;
    categoria_cnh: string;
    validade_cnh?: string;
    telefone?: string;
    celular?: string;
    email?: string;
    tipo_vinculo: string;
    percentual_comissao: number;
}

export interface CreateVeiculoData {
    placa: string;
    renavam?: string;
    modelo: string;
    ano: number;
    tipo: string;
    cor: string;
    consumo_medio: number;
    data_vencimento_licenciamento?: string;
    data_vencimento_seguro?: string;
}

export const deliveryService = {
    getStats: async () => {
        const response = await apiClient.get('/delivery/stats');
        return response.data;
    },

    getMetricasLogistica: async (filtro: string = 'hoje') => {
        const response = await apiClient.get(`/logistica/dashboard/metricas?filtro=${filtro}`);
        return response.data;
    },

    getEntregas: async (status?: string) => {
        const params = status === 'acerto_pendente' ? '?pagamento_status=pendente' : status && status !== 'todos' ? `?status=${encodeURIComponent(status)}` : '';
        const response = await apiClient.get(`/delivery/entregas${params}`);
        return response.data;
    },

    getMotoristas: async (somenteDisponiveis: boolean = true) => {
        const response = await apiClient.get(`/delivery/motoristas${somenteDisponiveis ? '?ativos=true' : '?ativos=false'}`);
        return response.data;
    },

    getVeiculos: async () => {
        const response = await apiClient.get('/delivery/veiculos');
        return response.data;
    },

    getTaxas: async () => {
        const response = await apiClient.get('/delivery/taxas');
        return response.data;
    },

    getTurnoAtual: async () => {
        const response = await apiClient.get('/logistica/turno/atual');
        return response.data;
    },

    iniciarTurno: async (data: { km_inicial: number, veiculo_id?: number, tipo_combustivel: string, checklist?: any[], motorista_id?: number }) => {
        const response = await apiClient.post('/logistica/turno/iniciar', data);
        return response.data;
    },

    finalizarTurno: async (data: { km_final: number }) => {
        const response = await apiClient.post('/logistica/turno/finalizar', data);
        return response.data;
    },

    atualizarStatus: async (id: number, status: string, data: any) => {
        const response = await apiClient.put(`/delivery/entregas/${id}/status`, { status, ...data });
        return response.data;
    },

    receberEntrega: async (id: number, chave: string, pagamentos: { forma_pagamento: string; valor: string }[]) => {
        const response = await apiClient.post(`/delivery/entregas/${id}/receber`, {
            chave_operacao: chave, pagamentos,
        });
        return response.data;
    },

    getMeuMotorista: async (): Promise<{ motorista_id: number | null }> => {
        const response = await apiClient.get('/delivery/motoristas/me');
        return response.data;
    },

    getVendasPendentes: async () => {
        const response = await apiClient.get('/delivery/vendas-pendentes');
        return response.data;
    },

    criarEntrega: async (data: any) => {
        const response = await apiClient.post('/delivery/entregas', data);
        return response.data;
    },

    criarVendaEntrega: async (data: any) => {
        const response = await apiClient.post('/delivery/venda-entrega', data);
        return response.data;
    },

    criarMotorista: async (data: CreateMotoristaData) => {
        const response = await apiClient.post('/delivery/motoristas', data);
        return response.data;
    },

    criarVeiculo: async (data: CreateVeiculoData) => {
        const response = await apiClient.post('/delivery/veiculos', data);
        return response.data;
    },

    atualizarMotorista: async (id: number, data: Partial<CreateMotoristaData>) => {
        const response = await apiClient.put(`/delivery/motoristas/${id}`, data);
        return response.data;
    },

    uploadDocumentoMotorista: async (id: number, arquivo: File) => {
        const formData = new FormData();
        formData.append('documento', arquivo);
        const response = await apiClient.post(`/delivery/motoristas/${id}/documento`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },

    atualizarVeiculo: async (id: number, data: Partial<CreateVeiculoData>) => {
        const response = await apiClient.put(`/delivery/veiculos/${id}`, data);
        return response.data;
    },

    uploadDocumentoVeiculo: async (id: number, arquivo: File) => {
        const formData = new FormData();
        formData.append('documento', arquivo);
        const response = await apiClient.post(`/delivery/veiculos/${id}/documento`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },

    listarChecklist: async (veiculoId: number) => {
        const response = await apiClient.get<{ success: boolean; itens_padrao: string[]; checklists: Checklist[] }>(`/delivery/veiculos/${veiculoId}/checklist`);
        return response.data;
    },

    criarChecklist: async (veiculoId: number, payload: { km_atual?: number; itens: ChecklistItem[]; observacoes_gerais?: string; motorista_id?: number }) => {
        const response = await apiClient.post(`/delivery/veiculos/${veiculoId}/checklist`, payload);
        return response.data;
    },

    getConformidade: async (diasAlerta = 30) => {
        const response = await apiClient.get<RelatorioConformidade>('/delivery/conformidade', { params: { dias_alerta: diasAlerta } });
        return response.data;
    },

    getRastreamento: async (id: number) => {
        const response = await apiClient.get(`/delivery/rastreamento/${id}`);
        return response.data;
    },

    getDetalheEntrega: async (id: number) => {
        const response = await apiClient.get<DetalheEntregaResposta>(`/delivery/entregas/${id}/detalhe`);
        return response.data;
    },

    getDashboard: async (filtros: DashboardFiltros = {}) => {
        const response = await apiClient.get<DashboardLogistica>('/delivery/dashboard', { params: filtros });
        return response.data;
    },

    getHistoricoManutencao: async (veiculoId: number) => {
        const response = await apiClient.get<{success: boolean, manutencoes: ManutencaoVeiculo[]}>(`/logistica/manutencao/${veiculoId}`);
        return response.data;
    },

    registrarManutencao: async (data: { veiculo_id: number; km_atual: number; valor_total: number; tipo_servico: string; descricao: string }) => {
        const response = await apiClient.post('/logistica/manutencao', data);
        return response.data;
    }
};

export interface ManutencaoVeiculo {
    id: number;
    veiculo_id: number;
    motorista_id: number;
    data_manutencao: string;
    tipo_servico: string;
    descricao: string;
    km_atual: number;
    valor_total: number;
}

export interface DashboardFiltros {
    data_inicio?: string;
    data_fim?: string;
    motorista_id?: number;
    veiculo_id?: number;
}

export interface DashboardLogistica {
    success: boolean;
    kpis: {
        total_entregas: number;
        km_total: number;
        taxa_entrega_total: number;
        combustivel_total: number;
        comissao_total: number;
        faturamento_delivery: number;
        ticket_medio: number;
        tempo_medio_minutos: number;
        saldo_taxa: number;
    };
    por_status: Record<string, number>;
    top_clientes: { nome: string; entregas: number; taxa: number }[];
    top_bairros: { bairro: string; entregas: number }[];
    top_produtos: { produto: string; quantidade: number }[];
    top_motoristas?: any[];
}

export interface ItemPedido {
    produto_nome: string; produto_codigo?: string; quantidade: number;
    produto_unidade?: string; preco_unitario: number; total_item: number;
}

export interface EventoRastreio {
    id: number; status: string; latitude?: number | null; longitude?: number | null;
    observacao?: string | null; data_hora: string | null;
}

export interface DetalheEntregaResposta {
    success: boolean;
    entrega: Entrega & {
        km_percorridos?: number; distancia_km?: number; custo_combustivel?: number;
        data_saida?: string | null; data_entrega?: string | null; nota_cliente?: number | null;
        veiculo_placa?: string | null; endereco_cep?: string; tempo_entrega_minutos?: number | null;
    };
    venda: {
        id: number; codigo: string; data_venda: string | null; tipo_venda: string; status: string;
        subtotal: number; desconto: number; total: number; total_com_taxa: number;
        cliente_nome: string; funcionario_nome?: string;
    } | null;
    itens: ItemPedido[];
    rastreamento: EventoRastreio[];
}

export default deliveryService;
