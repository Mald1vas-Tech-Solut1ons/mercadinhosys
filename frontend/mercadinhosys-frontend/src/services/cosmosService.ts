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
    fabricante?: string | null;
    /** Calculado para a loja que consultou: família do mix dela, categoria dela, atributos da família. */
    sugestoes?: {
        familia_produto: string | null;
        categoria: string | null;
        atributos: Record<string, any>;
        descricao: string;
    };
}

export interface CatalogoLookupResult {
    success: boolean;
    source?: 'catalogo' | 'bigdatacorp' | 'openfoodfacts' | 'openbeautyfacts' | 'openproductsfacts';
    code?: 'ean_invalido' | 'nao_encontrado' | 'interno' | 'quota' | 'token' | 'conexao' | 'api' | 'erro_interno';
    message?: string;
    data?: CatalogoLookupData;
}

export interface CatalogoBuscaItem {
    ean: string;
    nome: string;
    marca: string | null;
    imagem_url: string | null;
    fonte: string | null;
}

export interface CatalogoBuscaResult {
    success: boolean;
    source?: 'catalogo' | 'bigdatacorp';
    code?: 'termo_curto' | 'nao_encontrado' | 'sem_cota' | 'erro' | 'nao_configurado' | 'conexao';
    message?: string;
    data?: CatalogoBuscaItem[];
}

export const cosmosService = {
    /**
     * Busca por nome: Catálogo Mestre e, com poucos achados, BigDataCorp (até 5 produtos).
     * O operador escolhe um item e o cadastro segue pelo lookup do EAN, que já sai do catálogo.
     */
    async buscarPorNome(termo: string): Promise<CatalogoBuscaResult> {
        try {
            const { data } = await apiClient.get<CatalogoBuscaResult>('/produtos/catalogo/busca', { params: { q: termo } });
            return data;
        } catch (error: any) {
            const resp = error?.response?.data;
            if (resp && typeof resp === 'object' && 'message' in resp) return resp as CatalogoBuscaResult;
            return { success: false, code: 'conexao', message: 'Falha de conexão ao buscar o produto.' };
        }
    },

    /**
     * Lookup inteligente por EAN: tenta o catálogo local (sem franquia) e, no miss,
     * BigDataCorp e bases abertas (gravando no catálogo). Não lança em falha de negócio — retorna
     * o objeto com success/code/message para a UI exibir a causa real.
     * `familia`: a que o operador já escolheu no cadastro; o backend preenche os campos dela.
     */
    async lookup(ean: string, force: boolean = false, familia?: string): Promise<CatalogoLookupResult> {
        try {
            const params: Record<string, string> = {};
            if (force) params.force = 'true';
            if (familia) params.familia = familia;
            const { data } = await apiClient.get<CatalogoLookupResult>(`/produtos/catalogo/lookup/${ean}`, { params });
            return data;
        } catch (error: any) {
            const resp = error?.response?.data;
            if (resp && typeof resp === 'object') return resp as CatalogoLookupResult;
            return { success: false, code: 'conexao', message: 'Falha de conexão ao consultar o produto.' };
        }
    },
};
