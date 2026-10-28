import { apiClient } from "../../api/apiClient";
import { dataLocalISO } from '../../utils/dataLocal';

export interface SalesAnalyticsData {
    vendasPorDia: Array<{ data: string; quantidade: number; total: number }>;
    topProdutos: Array<{ produto_id: number; nome: string; quantidade: number; total: number }>;
    topFuncionarios: Array<{ funcionario: string; quantidade: number; total: number }>;
    vendasPorHora: Array<{ hora: number; quantidade: number; total: number }>;
    formasPagamento: Array<{ forma: string; quantidade: number; total: number; percentual: number }>;
}

export const salesService = {
    async getAnalytics(filtros?: any): Promise<SalesAnalyticsData> {
        try {
            const params: any = {};
            if (filtros?.data_inicio) params.data_inicio = filtros.data_inicio;
            if (filtros?.data_fim) params.data_fim = filtros.data_fim;
            if (filtros?.forma_pagamento) params.forma_pagamento = filtros.forma_pagamento;
            if (filtros?.funcionario_id) params.funcionario_id = filtros.funcionario_id;
            if (filtros?.cliente_id) params.cliente_id = filtros.cliente_id;

            const response = await apiClient.get("/vendas/estatisticas", { params });
            
            return {
                vendasPorDia: response.data.vendas_por_dia || [],
                topProdutos: response.data.produtos_mais_vendidos || [],
                topFuncionarios: response.data.vendas_por_funcionario || [],
                vendasPorHora: response.data.vendas_por_hora || [],
                formasPagamento: response.data.formas_pagamento || [],
            };
        } catch (error) {
            console.error("Erro ao buscar análises:", error);
            throw error;
        }
    },

    async getFuncionarios(): Promise<Array<{ id: number; nome: string }>> {
        try {
            const response = await apiClient.get("/funcionarios", {
                params: { simples: true, por_pagina: 200, incluir_estatisticas: false },
            });
            return response.data?.data || response.data?.funcionarios || [];
        } catch (error) {
            console.error("Erro ao buscar funcionários:", error);
            return [];
        }
    },

    async getClientes(): Promise<Array<{ id: number; nome: string }>> {
        try {
            const response = await apiClient.get("/clientes");
            return response.data.clientes || [];
        } catch (error) {
            console.error("Erro ao buscar clientes:", error);
            return [];
        }
    },

    async exportToExcel(filtros: any): Promise<void> {
        try {
            const params = { ...filtros, formato: "excel" };
            const response = await apiClient.get("/vendas/exportar", {
                params,
                responseType: "blob",
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `vendas-${dataLocalISO(new Date())}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error("Erro ao exportar para Excel:", error);
            throw error;
        }
    },

    async exportToPDF(filtros: any): Promise<void> {
        try {
            const params = { ...filtros, formato: "pdf" };
            const response = await apiClient.get("/vendas/exportar", {
                params,
                responseType: "blob",
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `vendas-${dataLocalISO(new Date())}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error("Erro ao exportar para PDF:", error);
            throw error;
        }
    },
};
