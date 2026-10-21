// Tipos do Motor de Renderização Contextual.
// O frontend NÃO decide o que exibir: renderiza o schema resolvido pelo backend
// (cascata Global → Tenant → Produto).

export type TipoItem = 'produto' | 'servico';

export type TipoCampo =
    | 'text'
    | 'textarea'
    | 'number'
    | 'select'
    | 'multiselect'
    | 'boolean'
    | 'date'
    | 'grupo_fiscal';

export interface CampoSchema {
    chave: string;
    label: string;
    tipo: TipoCampo;
    grupo: string;              // identificacao | fiscal | precificacao | estoque | atributos | dimensoes | servico | detalhes
    origem: 'coluna' | 'atributo';
    obrigatorio?: boolean;
    opcoes?: string[];
    permite_custom?: boolean;
    unidade?: string;           // sufixo p/ number (mm, pol, kg, min...)
    placeholder?: string;
    ajuda?: string;
    aplica_tipo_item?: TipoItem[];
    ordem: number;
}

export interface MetricaSchema {
    chave: string;
    titulo: string;
    subtitulo?: string;
    escopo_ui: 'card' | 'painel';
    fonte: string;              // caminho no objeto de estatísticas do backend
    formato: 'int' | 'moeda' | 'percent' | 'painel';
    icone: string;
    tema: string;
    filtro?: string;            // id usado no onCardClick
    ordem: number;
}

export interface SegmentoExemplos {
    nome: string;
    categoria: string;
    marca: string;
    nome_servico: string;
    categoria_servico: string;
}

export interface SegmentoInfo {
    chave: string;
    nome: string;
    descricao: string;
    icone: string;
    flags?: SegmentoFlags;
    exemplos?: SegmentoExemplos;
}

export interface SegmentoFlags {
    usa_validade: boolean;
    usa_lotes: boolean;
    usa_servicos: boolean;
    usa_grade: boolean;
    usa_dimensoes: boolean;
    usa_embalagens: boolean;
}

export interface SugestaoFiscal {
    csosn_sugerido: string;
    cst_icms_sugerido: string;
    cfop_padrao_sugerido: string;
    icms_aliquota_sugerida: number;
    observacao_fiscal: string;
    // true quando a família costuma ter ICMS-ST em parte dos estados: o formulário
    // pergunta ao operador em vez de marcar sozinho.
    icms_st_a_confirmar?: boolean;
    // Só dica de NCM para conferir na embalagem/nota; nunca preenche o campo.
    ncm_exemplos?: Array<{ ncm: string; descricao: string }>;
}

export interface RegrasFiscais {
    pis_cofins_monofasico: {
        posicoes: string[];     // prefixos de 4 dígitos (ex.: "3303")
        codigos: string[];      // NCM completos de 8 dígitos
        base_legal: string;
    };
    icms_st: {
        csosn: string;
        cst_icms: string;
        cfop: string;
        exige_cest: boolean;
    };
}

export interface ViewSchema {
    segmento: SegmentoInfo;
    segmento_tenant?: SegmentoInfo;
    familia_produto?: {
        chave: string;
        nome: string;
        descricao: string;
        segmento_base: string;
        perfil_fiscal_padrao?: string;
    };
    sugestao_fiscal?: SugestaoFiscal;
    regras_fiscais?: RegrasFiscais;
    mix_permitido?: string[];
    familias_configuraveis?: Array<{
        chave: string;
        nome: string;
        descricao: string;
        segmento_base: string;
    }>;
    familias_disponiveis?: Array<{
        chave: string;
        nome: string;
        descricao: string;
        segmento_base: string;
    }>;
    flags: SegmentoFlags;
    unidades: string[];
    tipos_item: TipoItem[];
    campos: CampoSchema[];
    metricas: MetricaSchema[];
    grupos: { chave: string; label: string }[];
}

export interface ViewSchemaOverrides {
    campos_ocultos?: string[];
    campos_habilitados?: string[];
    metricas_ocultas?: string[];
    metricas_habilitadas?: string[];
    obrigatorios?: Record<string, boolean>;
    opcoes?: Record<string, string[]>;
    unidades?: string[];
    mix_produtos?: string[];
}
