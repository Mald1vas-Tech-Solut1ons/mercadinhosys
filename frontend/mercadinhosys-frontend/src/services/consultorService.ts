import { apiClient as api } from '../api/apiClient';

export interface FonteDetalhada {
  fonte: string;
  titulo: string;
  descricao: string;
}

export interface AcaoSugerida {
  acao: 'criar_lembrete' | 'gerar_pedido_compra' | 'cadastrar_produto';
  rotulo: string;
  descricao: string;
  confirmacao: string;
  parametros: Record<string, any>;
}

export interface RelatorioTabela {
  titulo: string;
  colunas: string[];
  linhas: string[][];
}

export interface RelatorioEstruturado {
  titulo: string;
  gerado_em: string;
  resumo_kpis: Array<{
    label: string;
    valor: string;
    fonte: string;
  }>;
  tabelas: RelatorioTabela[];
}

export interface InsightResponse {
  success: boolean;
  insights?: string;
  fontes?: string[];
  fontes_detalhadas?: FonteDetalhada[];
  acoes_sugeridas?: AcaoSugerida[];
  cached?: boolean;
  provider?: string;
  aviso?: string;
  error?: string;
  duracao_ms?: number;
}

export interface ChatResponse {
  success: boolean;
  resposta?: string;
  interacao_id?: number;
  fontes?: string[];
  fontes_detalhadas?: FonteDetalhada[];
  acoes_sugeridas?: AcaoSugerida[];
  relatorio_estruturado?: RelatorioEstruturado;
  provider?: string;
  code?: string;
  error?: string;
  duracao_ms?: number;
}

export interface ResumoDiarioResponse {
  success: boolean;
  resumo?: string | null;
  fontes?: string[];
  fontes_detalhadas?: FonteDetalhada[];
  acoes_sugeridas?: AcaoSugerida[];
  cached?: boolean;
  aviso?: string;
  error?: string;
}

export interface ExecutarAcaoResponse {
  success: boolean;
  acao?: string;
  mensagem?: string;
  entidade?: Record<string, any>;
  error?: string;
}

export interface MetricasConsultorResponse {
  success: boolean;
  interacoes_hoje?: {
    chat: number;
    insights: number;
    acoes: number;
  };
  tokens_mes?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  custo_estimado_mes_usd?: number;
  por_provedor?: Record<string, number>;
  latencia_media_ms?: number;
  error?: string;
}

export const consultorService = {
  obterInsights: async (especialista: string, forceRefresh = false): Promise<InsightResponse> => {
    try {
      const response = await api.post<InsightResponse>('/consultor/insights', {
        especialista,
        force_refresh: forceRefresh,
      });
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data as InsightResponse;
      }
      return { success: false, error: 'Erro de conexão com o Consultor da Loja' };
    }
  },

  enviarMensagemChat: async (especialista: string, mensagem: string): Promise<ChatResponse> => {
    try {
      const response = await api.post<ChatResponse>('/consultor/chat', {
        especialista,
        mensagem,
      });
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data as ChatResponse;
      }
      return { success: false, error: 'Erro de conexão com o Consultor da Loja' };
    }
  },

  obterResumoDiario: async (force = false): Promise<ResumoDiarioResponse> => {
    try {
      const response = await api.get<ResumoDiarioResponse>(
        `/consultor/resumo-diario${force ? '?force=1' : ''}`
      );
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data as ResumoDiarioResponse;
      }
      return { success: false, error: 'Erro ao carregar resumo diário' };
    }
  },

  executarAcao: async (
    acao: string,
    parametros: Record<string, any>
  ): Promise<ExecutarAcaoResponse> => {
    try {
      const response = await api.post<ExecutarAcaoResponse>('/consultor/acoes/executar', {
        acao,
        parametros,
      });
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data as ExecutarAcaoResponse;
      }
      return { success: false, error: 'Erro ao executar ação do Consultor da Loja' };
    }
  },

  obterMetricas: async (): Promise<MetricasConsultorResponse> => {
    try {
      const response = await api.get<MetricasConsultorResponse>('/consultor/metricas');
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data as MetricasConsultorResponse;
      }
      return { success: false, error: 'Erro ao carregar métricas do Consultor da Loja' };
    }
  },
};
