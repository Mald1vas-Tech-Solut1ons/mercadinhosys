import { apiClient } from '../../api/apiClient';
import {
    ConfigDosesLoja, DosesEstado, PadraoDose, RespostaDosesProduto, paraPayload,
} from './utils/doses';
import type { ProdutoPdv } from '../pdv/utils/dosesPdv';
import type { ResumoAberto } from './utils/estoqueDose';

export type TipoBaixa = 'perda' | 'cortesia' | 'degustacao';

export interface GarrafaAbertaDto {
    id: number; produto_id: number; saldo_ml: number; volume_inicial_ml: number; status: string;
    aberta_em: string | null; validade_aberta: string | null;
}

export interface LinhaRazao {
    id: number; garrafa_id: number; tipo: string; ml: number; custo: number | null; dose: string | null;
    venda: string | null; funcionario: string | null; motivo: string | null; em: string | null;
}

export interface RespostaRazao {
    razao: LinhaRazao[]; garrafas_abertas: GarrafaAbertaDto[]; resumo: ResumoAberto | null;
}

export interface ModeloDose {
    nome: string;
    volume_ml: number;
    /** Um dos dois: preço fixo ou margem alvo (a loja define o resto). */
    preco_venda?: number;
    margem_alvo_pct?: number;
    padrao?: boolean;
}

export interface SelecaoProdutos {
    produto_ids?: number[];
    subcategoria_oficial?: string;
    categoria_oficial?: string;
    marca?: string;
    familia_produto?: string;
}

export interface LinhaAplicacao {
    produto_id: number;
    nome: string;
    volume_embalagem_ml: number | null;
    origem_volume: 'cadastro' | 'nome' | 'padrao' | null;
    status: 'aplicar' | 'aplicado' | 'ignorado';
    motivo: string | null;
    doses: Array<{ nome: string; volume_ml: number; preco_venda: number; margem_pct: number | null }>;
}

export interface ResultadoAplicacao {
    dry_run: boolean;
    modo: 'substituir' | 'acrescentar';
    aplicados: number;
    ignorados: number;
    linhas: LinhaAplicacao[];
}

export type ConfigDosesLojaEdicao = {
    doses_padrao?: PadraoDose[];
    margem_alvo_dose_pct?: number | null;
    perda_esperada_pct?: number | null;
    alerta_garrafa_aberta_dias?: number | null;
    alerta_rendimento_pct?: number | null;
};

/** Mensagem do servidor (já em português) ou texto padrão. */
export const erroDoses = (e: any, padrao = 'Não foi possível salvar as doses') =>
    e?.response?.data?.error || e?.response?.data?.message || padrao;

export const dosesService = {
    ler: async (produtoId: number): Promise<RespostaDosesProduto> =>
        (await apiClient.get(`/doses/produto/${produtoId}`)).data,

    salvar: async (produtoId: number, estado: DosesEstado): Promise<RespostaDosesProduto> =>
        (await apiClient.put(`/doses/produto/${produtoId}`, paraPayload(estado))).data,

    config: async (): Promise<ConfigDosesLoja> => (await apiClient.get('/doses/config')).data,

    /** "Terminou a garrafa": o ml que o controle ainda mostrava vira desvio. */
    encerrarGarrafa: async (garrafaId: number): Promise<{
        desvio_ml: number; resumo: { vendido_ml: number; volume_inicial_ml: number; rendimento_pct: number | null };
    }> => (await apiClient.post(`/doses/garrafas/${garrafaId}/encerrar`)).data,

    /** Bebidas que vendem por dose e dá para servir agora (botões rápidos do caixa). */
    cardapio: async (): Promise<ProdutoPdv[]> => (await apiClient.get('/pdv/cardapio-doses')).data.produtos || [],

    /** Razão de ml do produto (mais recente primeiro) + garrafas abertas + resumo. */
    razao: async (produtoId: number, limite = 100): Promise<RespostaRazao> =>
        (await apiClient.get(`/doses/produto/${produtoId}/razao`, { params: { limite } })).data,

    /** Perda/derramamento, cortesia ou degustação em ml (caixa comum: o app pede o PIN do gerente). */
    baixar: async (produtoId: number, corpo: { tipo: TipoBaixa; ml: number; motivo?: string }): Promise<{
        ml: number; custo: number; estado: ResumoAberto | null;
    }> => (await apiClient.post(`/doses/produto/${produtoId}/baixa`, corpo)).data,

    /** Contagem física da garrafa aberta: grava a diferença contra o controle. */
    ajustarGarrafa: async (garrafaId: number, saldoFisicoMl: number, motivo?: string): Promise<{ diferenca_ml: number }> =>
        (await apiClient.post(`/doses/garrafas/${garrafaId}/ajuste`, { saldo_fisico_ml: saldoFisicoMl, motivo })).data,

    descartarGarrafa: async (garrafaId: number, motivo?: string): Promise<{ perdido_ml: number; custo: number }> =>
        (await apiClient.post(`/doses/garrafas/${garrafaId}/descartar`, { motivo })).data,

    salvarConfig: async (dados: ConfigDosesLojaEdicao): Promise<ConfigDosesLoja> =>
        (await apiClient.put('/doses/config', dados)).data,

    /** Sem `dry_run: false` o servidor só pré-visualiza (nada é gravado). */
    aplicar: async (corpo: {
        modelo: ModeloDose[]; selecao: SelecaoProdutos; modo?: 'substituir' | 'acrescentar';
        dry_run?: boolean; volume_padrao_ml?: number | null;
    }): Promise<ResultadoAplicacao> => (await apiClient.post('/doses/aplicar', corpo)).data,
};
