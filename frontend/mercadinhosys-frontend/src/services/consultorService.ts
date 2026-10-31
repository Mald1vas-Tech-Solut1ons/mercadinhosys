import { apiClient as api } from '../api/apiClient';

export interface InsightResponse {
  success: boolean;
  insights?: string; // Markdown text with the 3 points
  /** De onde veio o número (tabela/período) — o backend já devolve, a UI ignorava. */
  fontes?: string[];
  provider?: string;
  aviso?: string;
  error?: string;
  duracao_ms?: number;
}

export interface ChatResponse {
  success: boolean;
  resposta?: string;
  interacao_id?: number;
  error?: string;
  duracao_ms?: number;
}

export const consultorService = {
  obterInsights: async (especialista: string): Promise<InsightResponse> => {
    try {
      const response = await api.post<InsightResponse>('/consultor/insights', {
        especialista
      });
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data as InsightResponse;
      }
      return { success: false, error: 'Erro de conexão com o Consultor IA' };
    }
  },

  enviarMensagemChat: async (especialista: string, mensagem: string): Promise<ChatResponse> => {
    try {
      const response = await api.post<ChatResponse>('/consultor/chat', {
        especialista,
        mensagem
      });
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data as ChatResponse;
      }
      return { success: false, error: 'Erro de conexão com o Consultor IA' };
    }
  }
};
