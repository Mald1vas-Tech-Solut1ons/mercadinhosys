import { apiClient } from '../../api/apiClient';

export interface Estabelecimento {
    id: number;
    nome_fantasia: string;
    razao_social: string;
    cnpj: string;
    inscricao_estadual?: string;
    telefone: string;
    email: string;
    cep: string;
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    estado: string;
    regime_tributario?: string;
    // Configuração fiscal (NFC-e/NF-e)
    fiscal_ambiente?: string;
    fiscal_gateway?: string;
    fiscal_token?: string;
    fiscal_csc?: string;
    fiscal_csc_id?: string;
    serie_nfce?: number;
}

export interface Configuracao {
    id: number;
    estabelecimento_id: number;
    logo_url?: string;
    logo_base64?: string;
    cor_principal: string;
    tema_escuro: boolean;

    // Vendas
    emitir_nfe: boolean;
    emitir_nfce: boolean;
    impressao_automatica: boolean;
    tipo_impressora: 'termica_80mm' | 'termica_58mm' | 'a4';
    exibir_preco_tela: boolean;
    mostrar_foto_produto_pdv: boolean;
    permitir_venda_sem_estoque: boolean;
    desconto_maximo_percentual: number;
    desconto_maximo_funcionario: number;
    aliquota_impostos_venda?: number | null; // % efetivo de impostos sobre vendas (DRE)
    arredondamento_valores: boolean;
    formas_pagamento: string[];
    motivos_estorno: string[];

    // Estoque
    controlar_validade: boolean;
    alerta_estoque_minimo: boolean;
    dias_alerta_validade: number;
    estoque_minimo_padrao: number;

    // Sistema
    tempo_sessao_minutos: number;
    tentativas_senha_bloqueio: number;
    alertas_email: boolean;
    alertas_whatsapp: boolean;

    // Localização do estabelecimento
    latitude_estabelecimento?: number;
    longitude_estabelecimento?: number;
    raio_validacao_metros?: number;

    // Horários de ponto
    hora_entrada_ponto?: string;
    hora_saida_almoco_ponto?: string;
    hora_retorno_almoco_ponto?: string;
    hora_saida_ponto?: string;

    // Validação de ponto
    exigir_foto_ponto?: boolean;
    exigir_localizacao_ponto?: boolean;
    tolerancia_atraso_minutos?: number;
}

/**
 * Configuração REAL de ponto (tabela ConfiguracaoHorario no backend).
 * Diferente do objeto `Configuracao` acima: estes campos são lidos e usados
 * pelo motor de ponto (cálculo de atraso, hora extra e espelho de ponto).
 */
export interface PontoConfig {
    hora_entrada?: string;
    hora_saida_almoco?: string;
    hora_retorno_almoco?: string;
    hora_saida?: string;
    tolerancia_entrada?: number;
    tolerancia_saida_almoco?: number;
    tolerancia_retorno_almoco?: number;
    tolerancia_saida?: number;
    jornada_diaria_minutos?: number;
    jornada_diaria_horas?: number;
    exigir_foto?: boolean;
    exigir_localizacao?: boolean;
    raio_permitido_metros?: number;
}

export interface SubscriptionStatus {
    plano: string;
    status: string;
    vencimento: string | null;
    is_active: boolean;
}

export interface PreferenciasUsuario {
    tema_escuro: boolean;
    notificacoes_desktop: boolean;
    idioma: string;
}

const settingsService = {
    getConfig: async () => {
        const response = await apiClient.get<{ success: boolean; config: Configuracao }>('/configuracao/');
        return response.data.config;
    },

    updateConfig: async (data: Partial<Configuracao>) => {
        console.log('🔧 settingsService.updateConfig - Enviando:', data);
        const response = await apiClient.put<{ success: boolean; config: Configuracao }>('/configuracao/', data);
        console.log('📦 settingsService.updateConfig - Resposta:', {
            estabelecimento_id: response.data.config.estabelecimento_id,
            cor_principal: response.data.config.cor_principal,
            tema_escuro: response.data.config.tema_escuro
        });
        return response.data.config;
    },

    getPreferencias: async () => {
        const response = await apiClient.get<{ success: boolean; preferencias: PreferenciasUsuario }>('/configuracao/preferencias');
        return response.data.preferencias;
    },

    updatePreferencias: async (data: Partial<PreferenciasUsuario>) => {
        const response = await apiClient.put<{ success: boolean; preferencias: PreferenciasUsuario }>('/configuracao/preferencias', data);
        return response.data.preferencias;
    },

    getEstabelecimento: async () => {
        const response = await apiClient.get<{ success: boolean; estabelecimento: Estabelecimento }>('/configuracao/estabelecimento');
        return response.data.estabelecimento;
    },

    updateEstabelecimento: async (data: Partial<Estabelecimento>) => {
        const response = await apiClient.put<{ success: boolean; estabelecimento: Estabelecimento }>('/configuracao/estabelecimento', data);
        return response.data.estabelecimento;
    },

    uploadLogo: async (file: File) => {
        const formData = new FormData();
        formData.append('logo', file);
        const response = await apiClient.post<{ success: boolean; logo_url: string }>('/configuracao/logo', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data.logo_url;
    },

    getSubscriptionStatus: async () => {
        const response = await apiClient.get<{ success: boolean; data: SubscriptionStatus }>('/saas/assinatura/status');
        return response.data.data;
    },

    createCheckoutSession: async (planName: string) => {
        const response = await apiClient.post<{ success: boolean; checkout_url: string }>('/billing/checkout', { plan_name: planName });
        return response.data;
    },

    openPortal: async () => {
        const response = await apiClient.post<{ success: boolean; portal_url: string }>('/billing/portal', {});
        return response.data;
    },

    // ----- Configuração de ponto (motor real: ConfiguracaoHorario) -----
    getPontoConfig: async () => {
        const response = await apiClient.get<{ success: boolean; data: PontoConfig }>('/ponto/configuracao');
        return response.data.data;
    },

    updatePontoConfig: async (data: Partial<PontoConfig>) => {
        const response = await apiClient.put<{ success: boolean; data: PontoConfig }>('/ponto/configuracao', data);
        return response.data.data;
    },

    // ----- PIN de segurança (autorização de operações sensíveis) -----
    getPinStatus: async () => {
        const response = await apiClient.get<{ success: boolean; tem_pin: boolean }>('/configuracao/pin');
        return response.data;
    },

    setPin: async (pin: string) => {
        const response = await apiClient.put<{ success: boolean; tem_pin: boolean; message?: string }>('/configuracao/pin', { pin });
        return response.data;
    },

    verifyPin: async (pin: string): Promise<boolean> => {
        try {
            const response = await apiClient.post<{ success: boolean }>('/configuracao/verificar-pin', { pin });
            return response.data.success === true;
        } catch {
            return false;
        }
    },
};

export default settingsService;
