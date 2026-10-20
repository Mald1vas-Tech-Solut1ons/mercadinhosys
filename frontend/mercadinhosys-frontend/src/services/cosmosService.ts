import { apiClient } from '../api/apiClient';

export interface CosmosProductData {
    gtin: number;
    description: string;
    brand: {
        name: string;
        picture: string;
    };
    ncm: {
        code: string;
        description: string;
        full_description: string;
    };
    gpc: {
        code: string;
        description: string;
    };
    category?: {
        name: string;
        description: string;
    };
    price: string;
    avg_price: number;
    max_price: number;
    thumbnail: string;
    width: number;
    height: number;
    length: number;
    net_weight: number;
    gross_weight: number;
}

// Resultado normalizado do lookup inteligente (catálogo local -> Cosmos -> bases abertas)
export interface CatalogoLookupData {
    ean: string;
    nome: string | null;
    marca: string | null;
    ncm: string | null;
    cest?: string | null;
    categoria: string | null;
    imagem_url: string | null;
    preco_referencia: number | null;
}

export interface CatalogoLookupResult {
    success: boolean;
    source?: 'catalogo' | 'cosmos' | 'openfoodfacts' | 'openbeautyfacts' | 'openproductsfacts';
    code?: 'ean_invalido' | 'nao_encontrado' | 'interno' | 'quota' | 'token' | 'conexao' | 'api' | 'erro_interno';
    message?: string;
    data?: CatalogoLookupData;
}

export const cosmosService = {
    async buscarPorGtin(gtin: string): Promise<CosmosProductData> {
        const response = await apiClient.get<CosmosProductData>(`/produtos/cosmos/${gtin}`);
        return response.data;
    },

    /**
     * Lookup inteligente por EAN: tenta o catálogo local (sem quota) e, no miss,
     * o Cosmos (gravando no catálogo). Não lança em falha de negócio — retorna
     * o objeto com success/code/message para a UI exibir a causa real.
     */
    async lookup(ean: string, force: boolean = false): Promise<CatalogoLookupResult> {
        try {
            const url = force ? `/produtos/catalogo/lookup/${ean}?force=true` : `/produtos/catalogo/lookup/${ean}`;
            const { data } = await apiClient.get<CatalogoLookupResult>(url);
            return data;
        } catch (error: any) {
            const resp = error?.response?.data;
            if (resp && typeof resp === 'object') return resp as CatalogoLookupResult;
            return { success: false, code: 'conexao', message: 'Falha de conexão ao consultar o produto.' };
        }
    },
};
