import { apiClient } from "../../api/apiClient";

export interface Funcionario {
    id: number;
    nome: string;
    cpf: string;
    rg?: string;
    data_nascimento?: string;
    telefone: string;
    celular?: string;
    email: string;
    cargo: string;
    salario?: number;
    numero_dependentes?: number; // dedução do IRRF no holerite
    data_admissao: string;
    data_demissao?: string;
    usuario: string;
    nivel_acesso: string;
    ativo: boolean;
    pin_cancelamento?: string;
    tem_pin?: boolean;
    created_at?: string;
    updated_at?: string;

    // Endereço
    cep?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    pais?: string;

    // Campos do Backend (Preferidos)
    salario_base?: number;
    username?: string;
    role?: string;

    estatisticas?: {
        total_vendas: number;
        vendas_30_dias: number;
        valor_total_vendas?: number;
        ticket_medio?: number;
        vendas_por_mes?: Array<{
            mes: string;
            mes_nome: string;
            quantidade_vendas: number;
            valor_total: number;
        }>;
        tempo_empresa_dias?: number;
        tempo_empresa_anos?: number;
    };
}

export interface EstatisticasFuncionarios {
    totais: {
        total_funcionarios: number;
        total_ativos: number;
        total_inativos: number;
        taxa_atividade: number;
    };
    salarios: {
        medio: number;
        maximo: number;
        minimo: number;
        soma_total: number;
    };
    distribuicao_cargo: Array<{
        cargo: string;
        quantidade: number;
        percentual: number;
        salario_medio: number;
    }>;
    distribuicao_nivel_acesso: Array<{
        nivel: string;
        quantidade: number;
        percentual: number;
    }>;
    admissoes_demissoes: {
        por_mes: Array<{
            mes: string;
            mes_nome: string;
            admissoes: number;
            demissoes: number;
            saldo: number;
        }>;
        total_admissoes_ano: number;
        total_demissoes_ano: number;
    };
    tempo_empresa: {
        medio_dias: number;
        medio_meses: number;
        medio_anos: number;
    };
    top_vendedores: Array<{
        id: number;
        nome: string;
        cargo: string;
        total_vendas: number;
        valor_total_vendas: number;
        ticket_medio: number;
    }>;
    indicadores: {
        rotatividade: number;
        custo_folha_mensal: number;
        funcionarios_por_nivel: Record<string, number>;
    };
}

export const employeesService = {
    async listar(params?: Record<string, unknown>) {
        const response = await apiClient.get("/funcionarios/", { params });
        return response.data;
    },

    async obterEstatisticas() {
        const response = await apiClient.get("/funcionarios/estatisticas/");
        return response.data;
    },

    async obterDetalhes(id: number) {
        const response = await apiClient.get(`/funcionarios/${id}`);
        return response.data;
    },

    async criar(dados: Partial<Funcionario>) {
        const response = await apiClient.post("/funcionarios/", dados);
        return response.data;
    },

    async atualizar(id: number, dados: Partial<Funcionario>) {
        const response = await apiClient.put(`/funcionarios/${id}`, dados);
        return response.data;
    },

    async excluir(id: number) {
        const response = await apiClient.delete(`/funcionarios/${id}`);
        return response.data;
    },

    async relatorioVendas(params?: Record<string, unknown>) {
        const response = await apiClient.get("/funcionarios/relatorio-vendas/", { params });
        return response.data;
    },
};
