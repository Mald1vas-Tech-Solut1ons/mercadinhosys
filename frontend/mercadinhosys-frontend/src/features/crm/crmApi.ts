import { apiClient } from '../../api/apiClient';

/** Contrato do /api/crm. Datas chegam com offset da loja (iso_local); valores em reais. */

export type Etapa = 'prospeccao' | 'qualificacao' | 'proposta' | 'negociacao' | 'ganha' | 'perdida';
export const ETAPAS_ABERTAS: Etapa[] = ['prospeccao', 'qualificacao', 'proposta', 'negociacao'];
export const ETAPA_LABEL: Record<Etapa, string> = {
    prospeccao: 'Prospecção', qualificacao: 'Qualificação', proposta: 'Proposta',
    negociacao: 'Negociação', ganha: 'Ganha', perdida: 'Perdida',
};

export interface Lead {
    id: number; nome: string; empresa?: string; documento?: string; telefone?: string; email?: string;
    cidade?: string; estado?: string; origem: string; status: string; responsavel_id: number;
    responsavel_nome?: string; cliente_id?: number; motivo_descarte?: string; observacoes?: string;
    created_at: string; convertido_em?: string;
}

export interface Oportunidade {
    id: number; titulo: string; cliente_id?: number; cliente_nome?: string; lead_id?: number; lead_nome?: string;
    responsavel_id: number; responsavel_nome?: string; etapa: Etapa; valor_estimado: number; probabilidade: number;
    valor_ponderado: number; data_prevista_fechamento?: string; pedido_venda_id?: number; valor_ganho?: number;
    motivo_perda?: string; concorrente?: string; created_at: string; fechada_em?: string;
}

export interface Atividade {
    id: number; tipo: string; assunto: string; descricao?: string; vencimento?: string; concluida_em?: string;
    resultado?: string; atrasada: boolean; responsavel_id: number; responsavel_nome?: string; cliente_id?: number;
    lead_id?: number; oportunidade_id?: number; chamado_id?: number; created_at: string;
}

export interface Chamado {
    id: number; numero: string; cliente_id: number; cliente_nome?: string; venda_id?: number; tipo: string;
    prioridade: 'alta' | 'media' | 'baixa'; status: string; assunto: string; descricao?: string;
    responsavel_id?: number; sla_vencimento: string; sla_estourado: boolean; atrasado: boolean;
    primeira_resposta_em?: string; resolvido_em?: string; fechado_em?: string; resolucao?: string; created_at: string;
}

export interface Funil {
    pipeline: { etapas: { etapa: Etapa; quantidade: number; valor: number; valor_ponderado: number }[];
                valor_total: number; valor_ponderado: number; quantidade: number; previsao_vencida: number };
    periodo: { inicio: string; fim: string; ganhas: number; perdidas: number; valor_ganho: number;
               taxa_conversao: number | null; ciclo_medio_dias: number | null;
               motivos_perda: { motivo: string; quantidade: number }[] };
    atividades: { abertas: number; atrasadas: number; hoje: number };
}

export interface Campanha {
    id: number; nome: string; canal: string; mensagem: string; filtros: Record<string, unknown>;
    janela_conversao_dias: number; status: 'rascunho' | 'ativa' | 'encerrada'; created_at: string;
    iniciada_em?: string; encerrada_em?: string; resultado?: ResultadoCampanha;
    envios?: EnvioCampanha[];
}

export interface ResultadoCampanha {
    publico: number; enviados: number; respondidos: number; descadastrados: number; convertidos: number;
    receita_atribuida: number; taxa_conversao: number | null; criterio: string; por_status: Record<string, number>;
}

export interface EnvioCampanha {
    id: number; cliente_id: number; cliente_nome?: string; destino: string; status: string;
    enviado_em?: string; respondido_em?: string; observacao?: string; link?: string;
}

export interface PreviaCampanha {
    publico_filtrado: number; sem_consentimento: number; sem_destino: number; aptos: number;
    amostra: { cliente_id: number; nome: string; destino: string }[];
}

export interface ExtratoComissao {
    vendedor_id: number; vendedor_nome: string; competencia: string; fechada: boolean; fechado_em?: string;
    base_vendas: number; base_cancelamentos: number; base_devolucoes: number; base_liquida: number;
    percentual: number | null; origem_percentual?: string; valor_comissao: number; aviso?: string | null;
    eventos?: { tipo: string; venda_id: number; codigo: string; data: string; valor: number }[];
}

export interface ResumoDevolucao {
    venda_id: number; codigo: string; status: string; total: number; valor_devolvido: number; titulos_em_aberto: number;
    itens: { venda_item_id: number; produto_id: number; produto_nome: string; quantidade: number; devolvido: number;
             restante: number; valor_unitario_liquido: number;
             lotes: { lote_id: number; numero_lote?: string; data_validade?: string; saiu: number; restante: number }[] }[];
    devolucoes: { id: number; tipo: string; motivo: string; destino: string; forma_reembolso: string; valor_total: number;
                  created_at: string }[];
}

export interface ClienteResumo {
    cliente: { id: number; nome: string; documento: string; tipo_pessoa: string; celular?: string; email?: string;
               vendedor_id?: number; limite_credito: number; saldo_devedor: number; ultima_compra?: string };
    oportunidades: Oportunidade[]; atividades: Atividade[]; chamados: Chamado[];
    vendas: { id: number; codigo: string; data: string; total: number; status: string }[];
    titulos_abertos: { id: number; documento: string; vencimento: string; valor: number; vencido: boolean }[];
    consentimento: { vigente: { canal: string; finalidade: string; concedido: boolean; desde: string }[];
                     historico: { id: number; canal: string; concedido: boolean; origem: string; evidencia?: string;
                                  registrado_em: string }[] };
}

const data = <T,>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data);

export const erroApi = (e: unknown, padrao = 'Não foi possível concluir'): string => {
    const resposta = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
    return resposta?.error || resposta?.message || padrao;
};

export const crmApi = {
    responsaveis: () => data<{ id: number; nome: string; role: string }[]>(apiClient.get('/crm/responsaveis')),
    funil: (params: Record<string, string>) => data<Funil>(apiClient.get('/crm/funil', { params })),

    leads: (params: Record<string, string> = {}) => data<Lead[]>(apiClient.get('/crm/leads', { params })),
    criarLead: (corpo: Partial<Lead>) => data<Lead>(apiClient.post('/crm/leads', corpo)),
    atualizarLead: (id: number, corpo: Record<string, unknown>) => data<Lead>(apiClient.patch(`/crm/leads/${id}`, corpo)),
    converterLead: (id: number, cliente_id: number) => data(apiClient.post(`/crm/leads/${id}/converter`, { cliente_id })),

    oportunidades: (params: Record<string, string> = {}) =>
        data<Oportunidade[]>(apiClient.get('/crm/oportunidades', { params })),
    criarOportunidade: (corpo: Record<string, unknown>) => data<Oportunidade>(apiClient.post('/crm/oportunidades', corpo)),
    atualizarOportunidade: (id: number, corpo: Record<string, unknown>) =>
        data<Oportunidade>(apiClient.patch(`/crm/oportunidades/${id}`, corpo)),

    atividades: (params: Record<string, string>) =>
        apiClient.get('/crm/atividades', { params }).then(r => ({
            itens: r.data.data as Atividade[], resumo: r.data.resumo as Funil['atividades'] })),
    criarAtividade: (corpo: Record<string, unknown>) => data<Atividade>(apiClient.post('/crm/atividades', corpo)),
    concluirAtividade: (id: number, corpo: Record<string, unknown>) =>
        data(apiClient.post(`/crm/atividades/${id}/concluir`, corpo)),

    registrarConsentimento: (corpo: Record<string, unknown>) => data(apiClient.post('/crm/consentimentos', corpo)),
    clienteResumo: (id: number) => data<ClienteResumo>(apiClient.get(`/crm/clientes/${id}/resumo`)),

    campanhas: () => data<Campanha[]>(apiClient.get('/crm/campanhas')),
    campanha: (id: number) => data<Campanha>(apiClient.get(`/crm/campanhas/${id}`)),
    previa: (canal: string, filtros: Record<string, unknown>) =>
        data<PreviaCampanha>(apiClient.post('/crm/campanhas/previa', { canal, filtros })),
    criarCampanha: (corpo: Record<string, unknown>) => data<Campanha>(apiClient.post('/crm/campanhas', corpo)),
    iniciarCampanha: (id: number) => data<Campanha & { publico: number }>(apiClient.post(`/crm/campanhas/${id}/iniciar`, {})),
    registrarEnvio: (id: number, envioId: number, status: string) =>
        data<EnvioCampanha>(apiClient.post(`/crm/campanhas/${id}/envios/${envioId}`, { status })),
    encerrarCampanha: (id: number) => data<Campanha>(apiClient.post(`/crm/campanhas/${id}/encerrar`, {})),

    regras: () => data<{ id: number; vendedor_id: number | null; vendedor_nome: string; percentual: number; ativo: boolean }[]>(
        apiClient.get('/crm/comissoes/regras')),
    definirRegra: (corpo: Record<string, unknown>) => data(apiClient.put('/crm/comissoes/regras', corpo)),
    extrato: (params: Record<string, string>) => data<ExtratoComissao>(apiClient.get('/crm/comissoes/extrato', { params })),
    resumoComissoes: (competencia: string) =>
        data<ExtratoComissao[]>(apiClient.get('/crm/comissoes/resumo', { params: { competencia } })),
    fecharComissao: (vendedor_id: number, competencia: string) =>
        data(apiClient.post('/crm/comissoes/fechar', { vendedor_id, competencia })),

    chamados: (params: Record<string, string> = {}) => data<Chamado[]>(apiClient.get('/crm/chamados', { params })),
    painelChamados: () => data<{ abertos: number; atrasados: number; resolvidos_periodo: number;
                                 tempo_medio_resolucao_horas: number | null; sla_cumprido_percentual: number | null }>(
        apiClient.get('/crm/chamados/painel')),
    abrirChamado: (corpo: Record<string, unknown>) => data<Chamado>(apiClient.post('/crm/chamados', corpo)),
    chamado: (id: number) => data<Chamado & { atividades: Atividade[]; devolucoes: ResumoDevolucao['devolucoes'] }>(
        apiClient.get(`/crm/chamados/${id}`)),
    atualizarChamado: (id: number, corpo: Record<string, unknown>) => data<Chamado>(apiClient.patch(`/crm/chamados/${id}`, corpo)),

    buscarVendas: (params: Record<string, string>) =>
        data<{ id: number; codigo: string; data: string; total: number; cliente_id?: number; cliente_nome?: string }[]>(
            apiClient.get('/crm/vendas/busca', { params })),
    resumoDevolucao: (vendaId: number) => data<ResumoDevolucao>(apiClient.get(`/crm/vendas/${vendaId}/devolucao`)),
    registrarDevolucao: (vendaId: number, corpo: Record<string, unknown>) =>
        data(apiClient.post(`/crm/vendas/${vendaId}/devolucoes`, corpo)),

    buscarClientes: (busca: string) =>
        apiClient.get('/clientes/', { params: { busca, por_pagina: 20 } })
            .then(r => (r.data.clientes || r.data.data || []) as { id: number; nome: string; documento?: string }[]),
};
