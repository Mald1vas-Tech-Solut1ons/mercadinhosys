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

/**
 * Mapa de nomes reais para o navegador resolver pseudônimos.
 * O LLM só enxerga "Cliente #<id>" / "Funcionário #<id>"; este mapa NÃO vai no
 * prompt — chega no payload e a troca acontece só na exibição, no navegador.
 */
export interface MapaEntidades {
  funcionarios: Record<string, string>;
  clientes: Record<string, string>;
}

export type TipoInsight = 'excecao' | 'risco' | 'oportunidade';

export type TipoAcaoInsight = 'repor' | 'cobrar' | 'promocionar' | 'ver_contagem';

export interface AcaoInsight {
  tipo: TipoAcaoInsight;
  payload?: Record<string, any>;
}

/**
 * Um insight estruturado (formato 'json') devolvido pelo backend. O campo
 * `texto` é a única fonte de texto exibido — nunca deve ser fabricado no front.
 */
export interface InsightItem {
  tipo: TipoInsight;
  texto: string;
  acao?: AcaoInsight;
}

export interface InsightResponse {
  success: boolean;
  insights?: string | InsightItem[];
  formato?: 'texto' | 'json';
  mapa_entidades?: MapaEntidades;
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
  mapa_entidades?: MapaEntidades;
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
  mapa_entidades?: MapaEntidades;
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

export interface DesfazerAcaoResponse {
  success: boolean;
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

  /**
   * Desfaz uma ação já executada, usando a `entidade` devolvida pelo backend.
   * Reaproveita endpoints existentes (nenhum endpoint novo):
   * - lembrete     -> DELETE /despesas/:id
   * - produto      -> DELETE /produtos/:id/ (force: produto recém-cadastrado)
   * - pedido_compra-> POST  /pedidos-compra/:id/devolver (rascunho vira "devolvido")
   */
  desfazerAcao: async (
    entidade: { tipo?: string; id?: number | string } | null | undefined
  ): Promise<DesfazerAcaoResponse> => {
    const tipo = entidade?.tipo;
    const id = entidade?.id;
    if (!tipo || id === null || id === undefined) {
      return { success: false, error: 'Não há como desfazer esta ação.' };
    }
    try {
      if (tipo === 'lembrete') {
        await api.delete(`/despesas/${id}`);
      } else if (tipo === 'produto') {
        await api.delete(`/produtos/${id}/`, { params: { force: true } });
      } else if (tipo === 'pedido_compra') {
        await api.post(`/pedidos-compra/${id}/devolver`);
      } else {
        return { success: false, error: 'Este tipo de ação não pode ser desfeito.' };
      }
      return { success: true };
    } catch (error: any) {
      const dados = error?.response?.data;
      return {
        success: false,
        error: dados?.error || dados?.message || 'Não foi possível desfazer a ação.',
      };
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
