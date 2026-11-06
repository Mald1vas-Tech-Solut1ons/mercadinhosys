import { useEffect, useState } from 'react';
import { apiClient } from '../api/apiClient';
import { SegmentoInfo, ViewSchema, ViewSchemaOverrides } from '../types/viewSchema';

// Cache de módulo: o schema muda raramente (troca de segmento/overrides invalida).
let schemaCache: ViewSchema | null = null;
let schemaPromise: Promise<ViewSchema> | null = null;
const listeners = new Set<(schema: ViewSchema) => void>();

interface SchemaRequestParams {
    forceRefresh?: boolean;
    familiaProduto?: string;
    tipoItem?: string;
}

function notificar(schema: ViewSchema) {
    schemaCache = schema;
    listeners.forEach(l => l(schema));
}

export const viewSchemaService = {
    getSchema: async (forceRefresh = false): Promise<ViewSchema> => {
        if (schemaCache && !forceRefresh) return schemaCache;
        if (!schemaPromise || forceRefresh) {
            schemaPromise = apiClient
                .get<{ success: boolean; schema: ViewSchema }>('/view-schema/')
                .then(res => {
                    notificar(res.data.schema);
                    return res.data.schema;
                })
                .finally(() => { schemaPromise = null; });
        }
        return schemaPromise;
    },

    getSchemaForContext: async ({ forceRefresh = false, familiaProduto, tipoItem = 'produto' }: SchemaRequestParams = {}): Promise<ViewSchema> => {
        if (!familiaProduto && tipoItem === 'produto') {
            return viewSchemaService.getSchema(forceRefresh);
        }
        const res = await apiClient.get<{ success: boolean; schema: ViewSchema }>('/view-schema/', {
            params: {
                familia_produto: familiaProduto,
                tipo_item: tipoItem,
            },
        });
        return res.data.schema;
    },

    invalidate: () => {
        schemaCache = null;
    },

    /** Schema-base do segmento (sem overrides) + overrides salvos — usado nas configurações. */
    getSchemaBase: async (): Promise<{ schema: ViewSchema; overrides: ViewSchemaOverrides }> => {
        const res = await apiClient.get<{ success: boolean; schema: ViewSchema; overrides: ViewSchemaOverrides }>(
            '/view-schema/', { params: { base: 1 } },
        );
        return { schema: res.data.schema, overrides: res.data.overrides || {} };
    },

    getSegmentos: async (): Promise<SegmentoInfo[]> => {
        const res = await apiClient.get<{ success: boolean; segmentos: SegmentoInfo[] }>('/view-schema/segmentos');
        return res.data.segmentos;
    },

    setSegmento: async (segmento: string): Promise<ViewSchema> => {
        const res = await apiClient.put<{ success: boolean; schema: ViewSchema }>('/view-schema/segmento', { segmento });
        notificar(res.data.schema);
        return res.data.schema;
    },

    saveOverrides: async (overrides: ViewSchemaOverrides): Promise<ViewSchema> => {
        const res = await apiClient.put<{ success: boolean; schema: ViewSchema }>('/view-schema/overrides', overrides);
        notificar(res.data.schema);
        return res.data.schema;
    },
};

/**
 * Hook do Motor de Renderização Contextual: entrega o View Schema resolvido
 * pelo backend e re-renderiza quando o segmento/overrides mudarem.
 */
export function useViewSchema(familiaProduto?: string, tipoItem: string = 'produto'): { schema: ViewSchema | null; loading: boolean } {
    const usaContextoCustom = !!familiaProduto || tipoItem !== 'produto';
    const [schema, setSchema] = useState<ViewSchema | null>(usaContextoCustom ? null : schemaCache);
    const [loading, setLoading] = useState(usaContextoCustom ? true : !schemaCache);

    useEffect(() => {
        if (usaContextoCustom) {
            setLoading(true);
            viewSchemaService.getSchemaForContext({ familiaProduto, tipoItem })
                .then(setSchema)
                .catch(err => console.error('Erro ao carregar view schema contextual:', err))
                .finally(() => setLoading(false));
            return;
        }

        const listener = (s: ViewSchema) => setSchema(s);
        listeners.add(listener);
        if (!schemaCache) {
            viewSchemaService.getSchema()
                .then(setSchema)
                .catch(err => console.error('Erro ao carregar view schema:', err))
                .finally(() => setLoading(false));
        }
        return () => { listeners.delete(listener); };
    }, [familiaProduto, tipoItem, usaContextoCustom]);

    return { schema, loading };
}

/**
 * Flags da família refinadas pela subcategoria escolhida (mesma regra do servidor em
 * perfil_subcategoria.flags_efetivas): lâmina não pede validade em Higiene; banho ritualístico
 * pede validade em Artigos Religiosos.
 */
export function flagsDaSubcategoria(schema: ViewSchema | null, chaveSubcategoria?: string) {
    const base = { ...(schema?.flags || {}) } as ViewSchema['flags'];
    const regra = chaveSubcategoria ? schema?.perfis_subcategoria?.[chaveSubcategoria]?.validade : undefined;
    if (!schema || !regra) return base;
    const familiaUsaValidade = !!schema.flags?.usa_validade;
    return {
        ...base,
        usa_validade: regra !== 'nao_se_aplica',
        validade_obrigatoria: regra === 'obrigatoria',
        usa_lotes: regra === 'nao_se_aplica' ? false : (familiaUsaValidade ? base.usa_lotes : true),
        exige_fabricacao: regra === 'nao_se_aplica' ? false : base.exige_fabricacao,
    };
}

/** Helpers de consulta — o "if validade" mora aqui, alimentado pelo schema. */
export const schemaHelpers = {
    // Fail-closed: enquanto o schema do tenant/segmento atual não chegou (null),
    // nada schema-dependente aparece. Fail-open aqui já causou um bug real: um
    // painel de outro segmento (ex.: Monitor de Validade em loja de moto peças)
    // ficava visível durante a janela entre trocar de tenant e o fetch resolver.
    campoVisivel: (schema: ViewSchema | null, chave: string): boolean =>
        !!schema && schema.campos.some(c => c.chave === chave),

    campo: (schema: ViewSchema | null, chave: string) =>
        schema?.campos.find(c => c.chave === chave),

    camposDoGrupo: (schema: ViewSchema | null, grupo: string, tipoItem: string = 'produto') =>
        (schema?.campos || [])
            .filter(c => c.grupo === grupo && c.origem === 'atributo')
            .filter(c => !c.aplica_tipo_item || c.aplica_tipo_item.includes(tipoItem as any))
            .sort((a, b) => a.ordem - b.ordem),

    metricasCard: (schema: ViewSchema | null) =>
        (schema?.metricas || []).filter(m => m.escopo_ui === 'card').sort((a, b) => a.ordem - b.ordem),

    metricaPainelVisivel: (schema: ViewSchema | null, chave: string): boolean =>
        !!schema && schema.metricas.some(m => m.chave === chave && m.escopo_ui === 'painel'),

    usaValidade: (schema: ViewSchema | null): boolean => !!schema?.flags?.usa_validade,
    usaServicos: (schema: ViewSchema | null): boolean => !!schema?.flags?.usa_servicos,
};
