import { apiClient } from "../../api/apiClient";

export interface Despesa {
    id: number;
    descricao: string;
    categoria: string;
    tipo: 'fixa' | 'variavel';
    valor: number;
    data_despesa: string;
    data_vencimento?: string;
    data_emissao?: string;
    forma_pagamento?: string;
    recorrente: boolean;
    fornecedor?: {
        id: number;
        nome: string;
    };
    observacoes?: string;
    created_at: string;
}

export interface CategoriaStat {
    categoria: string;
    total: number;
    quantidade: number;
    percentual: number;
}

export interface EvolucaoMes {
    mes: string;
    total: number;
    mes_nome: string;
}

export interface Estatisticas {
    total_despesas: number;
    soma_total: number;
    soma_periodo: number;
    media_valor: number;
    despesas_hoje: number;
    despesas_ontem: number;
    despesas_semana: number;
    despesas_mes_atual: number;
    despesas_mes_anterior: number;
    variacao_percentual: number;
    despesas_recorrentes: number;
    despesas_nao_recorrentes: number;
    despesas_por_categoria: CategoriaStat[];
    evolucao_mensal: EvolucaoMes[];
}

export interface FiltrosDespesas {
    inicio?: string;
    fim?: string;
    categoria?: string;
    tipo?: string;
    recorrente?: string;
    busca?: string;
    pagina?: number;
    por_pagina?: number;
    forma_pagamento?: string;
    valor_min?: number;
    valor_max?: number;
}

export interface AlertaFinanceiro {
    tipo: string;
    severidade: 'critica' | 'alta' | 'media' | 'baixa';
    titulo: string;
    descricao: string;
    acao: string;
}

export interface ResumoFinanceiro {
    success: boolean;
    periodo: {
        inicio: string;
        fim: string;
    };
    indicadores_gestao: {
        indice_comprometimento: number;
        pressao_caixa_diaria: number;
        pressao_caixa_7d?: number;
        venda_media_diaria: number;
        entrada_esperada_7d?: number;
        vence_hoje_valor: number;
        obrigacoes_hoje?: number;
        obrigacoes_7d?: number;
        obrigacoes_30d?: number;
        despesas_a_vencer?: { vence_hoje: number; vence_7d: number; vence_30d: number; vencidas: number };
        alavancagem_operacional?: number;
        ponto_equilibrio?: number;
    };
    contas_pagar: {
        total_aberto: number;
        total_vencido: number;
        vence_hoje: number;
        vence_7_dias: number;
        vence_30_dias: number;
        pago_no_mes: number;
        qtd_vencidos: number;
        qtd_vence_hoje: number;
        qtd_vence_7d: number;
    };
    despesas_mes: {
        total: number;
        recorrentes: number;
        variaveis: number;
    };
    fluxo_caixa_real: {
        entradas: number;
        saidas: number;
        saldo: number;
        interpretacao?: string;
    };
    contas_receber?: {
        total_aberto: number;
        vencido: number;
        vence_7_dias: number;
        vence_30_dias: number;
    };
    dre_consolidado: {
        receita_bruta: number;
        impostos_sobre_vendas?: number;
        receita_liquida?: number;
        impostos_configurados?: boolean;
        aliquota_impostos_venda?: number | null;
        aviso?: string | null;
        custo_mercadoria: number;
        lucro_bruto: number;
        despesas_pessoal: number;
        despesas_operacionais: number;
        total_despesas: number;
        lucro_liquido: number;
    };
    caixa_pdv?: {
        sangrias: number;
        suprimentos: number;
    };
    alertas: AlertaFinanceiro[];
    total_alertas: number;
}

export interface HistoricoInsight {
    tipo: string;
    severidade: 'critica' | 'alta' | 'media' | 'baixa';
    titulo: string;
    descricao: string;
    acao: string;
}

export interface VariacaoCategoria {
    categoria: string;
    atual: number;
    anterior: number;
    delta_percentual: number;
    cresceu: boolean;
}

export interface HistoricoComparativo {
    success: boolean;
    periodo: {
        inicio: string;
        fim: string;
        meses: Array<{ chave: string; nome: string; total: number }>;
    };
    categorias: string[];
    evolucao_por_categoria: Record<string, Array<{ mes: string; mes_nome: string; total: number }>>;
    variacoes_mes_atual: VariacaoCategoria[];
    totais_por_mes: Record<string, number>;
    meses_labels: string[];
    meses_nomes: string[];
    projecao_proximos_meses: number;
    insights: HistoricoInsight[];
    resumo_periodo: {
        total_geral: number;
        media_mensal: number;
        mes_mais_caro: string | null;
        mes_mais_barato: string | null;
    };
}

export interface BoletoItem {
    id: number;
    numero_documento?: string;
    descricao: string;
    fornecedor_nome: string;
    fornecedor_id?: number;
    valor_original: number;
    valor_atual: number;
    data_emissao?: string;
    data_vencimento?: string;
    data_pagamento?: string;
    dias_vencimento?: number;
    status: string;
    observacoes?: string;
}

export interface BoletosStatus {
    success: boolean;
    vencidos: { items: BoletoItem[]; quantidade: number; total: number };
    a_vencer: { items: BoletoItem[]; quantidade: number; total: number; dias_antecedencia: number };
    pagos: { items: BoletoItem[]; quantidade: number; total: number; inicio_periodo: string };
    resumo: {
        total_vencidos: number;
        total_a_vencer: number;
        total_pago_periodo: number;
        qtd_vencidos: number;
        qtd_a_vencer: number;
        qtd_pagos: number;
    };
}

export const expensesService = {
    async listar(filtros: FiltrosDespesas = {}) {
        const response = await apiClient.get("/despesas", { params: filtros });
        return response.data;
    },

    async listarUnificado(filtros: FiltrosDespesas = {}) {
        const response = await apiClient.get("/despesas/detalhamento-unificado", { params: filtros });
        return response.data;
    },

    async obterEstatisticas(filtros: { inicio?: string; fim?: string } = {}) {
        const response = await apiClient.get("/despesas/estatisticas", { params: filtros });
        return response.data.estatisticas;
    },

    async criar(despesa: Partial<Despesa>) {
        const response = await apiClient.post("/despesas", despesa);
        return response.data.data;
    },

    async atualizar(id: number, despesa: Partial<Despesa>) {
        const response = await apiClient.put(`/despesas/${id}`, despesa);
        return response.data.data;
    },

    async excluir(id: number) {
        const response = await apiClient.delete(`/despesas/${id}`);
        return response.data;
    },

    async resumoFinanceiro(params: { data_inicio?: string; data_fim?: string } = {}): Promise<ResumoFinanceiro> {
        const response = await apiClient.get("/despesas/resumo-financeiro/", { params });
        return response.data;
    },

    async getHistoricoComparativo(): Promise<HistoricoComparativo> {
        const response = await apiClient.get("/despesas/historico-comparativo/");
        return response.data;
    },

    async getBoletosStatus(params: { dias?: number; inicio_pagos?: string } = {}): Promise<BoletosStatus> {
        const response = await apiClient.get("/despesas/boletos-status/", { params });
        return response.data;
    },
};


