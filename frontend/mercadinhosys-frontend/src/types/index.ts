// Tipos base para todas as entidades do sistema
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
    pagination?: {
        page: number;
        per_page: number;
        total: number;
        total_pages: number;
    };
}

// NOVO: Adicionar este tipo para a resposta completa do login
export interface LoginApiResponse {
    success: boolean;
    message?: string;
    data?: {
        access_token: string;
        refresh_token: string;
        user: User;
        session: {
            login_time: string;
            expires_in: number;
            refresh_expires_in: number;
            token_type: string;
        };
        estabelecimento: {
            id: number;
            nome: string;
            cnpj: string;
            telefone?: string;
            email?: string;
            endereco?: string;
            cidade?: string;
            estado?: string;
            plano?: string;
            plano_status?: string;
        };
    };
    error?: string;
    code?: string;
}

// TIPOS BASE - REFLETINDO OS MODELS PYTHON
export interface Estabelecimento {
    id: number;
    nome: string;
    cnpj: string;
    telefone?: string;
    email?: string;
    cep?: string;
    endereco?: string;
    cidade?: string;
    estado?: string;
    data_cadastro: string;
    ativo: boolean;
    plano?: string;
    plano_status?: string;
}

export interface Lead {
    id: number;
    nome: string;
    email: string;
    whatsapp: string;
    origem: string;
    observacao?: string;
    data_cadastro: string;
}

// Tipos de autenticação (baseado no models.py - Funcionario)
export interface Funcionario {
    id: number;
    estabelecimento_id: number;
    nome: string;
    username: string;
    cpf: string;
    telefone?: string;
    email?: string;
    foto_url?: string;
    cargo: string;
    role: string;
    status: string;
    comissao_percentual: number;
    salario_base?: number;
    horas_extras?: number;
    horas_extras_horas?: number;
    beneficios?: number;
    beneficios_detalhes?: Array<{ descricao: string; valor: number }>;
    atrasos_horas?: number;
    data_admissao: string;
    data_demissao?: string;
    ativo: boolean;
    permissoes: Record<string, boolean>;
    plano?: string;
    plano_status?: string;
    created_at?: string;
    updated_at?: string;
}

// Alias para compatibilidade (User = Funcionario)
export type User = Funcionario;

export interface LoginRequest {
    username: string;
    password: string;
}

export interface LoginResponse {
    access_token: string;
    refresh_token: string;
    user: User;
}

// Tipos para clientes (atualizado conforme models.py)
export interface Cliente {
    id: number;
    estabelecimento_id: number;
    nome: string;
    tipo_pessoa?: 'PF' | 'PJ';
    cpf?: string;
    cnpj?: string;
    documento?: string; // CPF ou CNPJ já formatado, conforme o tipo de pessoa
    razao_social?: string;
    inscricao_estadual?: string;
    contato_nome?: string;
    celular?: string;
    email?: string;
    endereco_completo?: string;
    cep?: string;
    logradouro?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    limite_credito?: number;
    saldo_devedor?: number;
    total_compras?: number;
    ativo?: boolean;
    data_cadastro?: string;
    // Campos adicionais que podem vir da API detalhada
    telefone?: string;
    rg?: string;
    data_nascimento?: string;
    ultima_compra?: string;
    valor_total_gasto?: number;
    observacoes?: string;
}

// Tipos para produtos (atualizado conforme models.py e produtos.py backend)
export interface Produto {
    id: number;
    estabelecimento_id?: number;
    fornecedor_id?: number;
    fornecedor_nome?: string;
    codigo_barras?: string;
    nome: string;
    descricao?: string;
    marca?: string;
    fabricante?: string;
    categoria: string;
    subcategoria?: string;
    tipo?: string; // 'unidade', 'granel', etc
    unidade_medida: string;
    quantidade: number;
    quantidade_estoque?: number; // Alias para quantidade
    estoque_atual?: number;      // REAL-TIME: Estoque atômico vindo do backend
    quantidade_minima: number;
    estoque_minimo?: number; // Alias para quantidade_minima
    estoque_status?: 'normal' | 'baixo' | 'esgotado';
    localizacao?: string;
    dias_estoque?: number;
    giro_estoque?: number;
    preco_custo: number;
    preco_venda: number;
    margem_lucro?: number;
    total_vendido?: number;
    quantidade_vendida?: number;
    frequencia_venda?: number;
    ultima_venda?: string;
    classificacao_abc?: 'A' | 'B' | 'C';
    classificação_abc?: 'A' | 'B' | 'C'; // Alias for compatibility
    data_fabricacao?: string;
    data_validade?: string;
    ncm?: string;
    lote?: string;
    imagem_url?: string;
    tipo_item?: 'produto' | 'servico';
    controlar_estoque?: boolean;
    familia_produto?: string;
    perfil_fiscal?: string;
    atributos?: Record<string, any>;
    alerta_validade?: boolean;
    alerta_estoque?: boolean;
    ativo: boolean;
    controla_estoque?: boolean;
    created_at?: string;
    updated_at?: string;
    /** NOVO: Lista de lotes para o carrossel de detalhes */
    lotes?: ProdutoLote[];
    historico_precos?: HistoricoPreco[];
    historico_perdas?: MovimentacaoEstoque[];
    metricas_gestao?: {
        giro_estoque: number;
        dias_estoque: number;
        cobertura_estoque: string;
        frequencia_venda: string;
    };
}

export interface HistoricoPreco {
    id: number;
    produto_id: number;
    produto_nome?: string;
    funcionario?: string;
    preco_custo_anterior: number;
    preco_venda_anterior: number;
    margem_anterior: number;
    preco_custo_novo: number;
    preco_venda_novo: number;
    margem_nova: number;
    variacao_custo_pct: number;
    variacao_venda_pct: number;
    motivo: string;
    observacoes?: string;
    data_alteracao: string;
}

export interface ProdutoLote {
    id: number;
    numero_lote: string;
    produto_id: number;
    produto_nome?: string;
    pedido_compra_id?: number | null;
    fornecedor_id?: number | null;
    quantidade: number;
    quantidade_inicial: number;
    data_fabricacao?: string | null;
    data_validade: string;
    data_entrada: string;
    dias_para_vencer: number;
    esta_vencido: boolean;
    preco_custo_unitario: number;
    preco_venda: number | null;
    fornecedor_nome?: string;
    ultima_venda?: string;
    ativo: boolean;
}

// Response da API de produtos com estatísticas
export interface ProdutosResponse {
    produtos: Produto[];
    paginacao: {
        pagina_atual: number;
        total_paginas: number;
        total_itens: number;
        itens_por_pagina: number;
        tem_proxima: boolean;
        tem_anterior: boolean;
        primeira_pagina: number;
        ultima_pagina: number;
    };
    estatisticas?: {
        total_produtos: number;
        produtos_baixo_estoque: number;
        produtos_esgotados: number;
        produtos_normal: number;
        validade?: {
            vencidos: number;
            vence_15: number;
            vence_30: number;
            vence_90: number;
        };
        giro_estoque?: {
            rapido: number;
            normal: number;
            lento: number;
        };
    };
    filtros_aplicados?: Record<string, any>;
}

// Filtros para listagem de produtos
export interface ProdutoFiltros {
    busca?: string;
    categoria?: string;
    fornecedor_id?: number;
    ativos?: boolean;
    preco_min?: number;
    preco_max?: number;
    estoque_status?: 'baixo' | 'esgotado' | 'normal';
    validade_proxima?: boolean;
    dias_validade?: number;
    vencidos?: boolean;
    tipo?: string;
    ordenar_por?: string;
    direcao?: 'asc' | 'desc';
    filtro_rapido?: string;
    /** true = API retorna lotes_no_periodo para cada produto (listagem por lote) */
    expandir_por_lote?: boolean;
}

// Tipos para vendas - COMPLETAMENTE ATUALIZADO
export interface VendaItem {
    id: number;
    venda_id: number;
    produto_id: number;
    produto_nome: string;
    descricao?: string;
    produto_codigo?: string;
    produto_unidade: string;
    quantidade: number;
    preco_unitario: number;
    desconto: number;
    total_item: number;
    custo_unitario?: number;
    margem_item?: number;
    created_at: string;
}

export interface Venda {
    id: number;
    estabelecimento_id: number;
    cliente_id?: number;
    funcionario_id: number;
    codigo: string;
    subtotal: number;
    desconto: number;
    total: number;
    forma_pagamento: string;
    valor_recebido: number;
    troco: number;
    status: 'finalizada' | 'cancelada' | 'pendente';
    quantidade_itens: number;
    tipo_venda: 'normal' | 'atacado' | 'promocional';
    observacoes?: string;
    data_venda: string;
    data_cancelamento?: string;
    motivo_cancelamento?: string;
    created_at: string;
    updated_at: string;
    itens: VendaItem[];
    cliente?: Cliente;
    funcionario?: Funcionario;
}

// Tipos para fornecedores
export interface Fornecedor {
    id: number;
    estabelecimento_id: number;
    nome: string;
    nome_fantasia?: string;
    razao_social?: string;
    cnpj?: string;
    telefone?: string;
    email?: string;
    endereco?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
    pais?: string;
    contato_comercial?: string;
    contato_nome?: string;
    contato_principal?: string;
    contato_telefone?: string;
    celular_comercial?: string;
    observacoes?: string;
    total_produtos?: number;
    produtos_ativos?: number;
    total_compras?: number;
    valor_total_comprado?: number;
    classificacao?: string;
    ativo: boolean;
    prazo_entrega?: number;
    forma_pagamento?: string;
    avaliacao?: number;
    tempo_medio_entrega?: number;
    taxa_atendimento?: number;
    created_at?: string;
    updated_at?: string;
}

// Tipos para despesas (atualizado conforme models.py)
export interface Despesa {
    id: number;
    estabelecimento_id: number;
    descricao: string;
    categoria: string;
    tipo: 'fixa' | 'variavel';
    valor: number;
    data_despesa: string;
    forma_pagamento?: string;
    recorrente: boolean;
    observacoes?: string;
    created_at: string;
    updated_at: string;
}

// Tipos para movimentação de estoque
export interface MovimentacaoEstoque {
    id: number;
    estabelecimento_id: number;
    produto_id: number;
    venda_id?: number;
    funcionario_id?: number;
    tipo: 'entrada' | 'saida' | 'ajuste';
    quantidade: number;
    quantidade_anterior: number;
    quantidade_atual: number;
    custo_unitario?: number;
    valor_total?: number;
    motivo: string;
    observacoes?: string;
    created_at: string;
}

// Tipos para dashboard
// Tipos para produtos estrela/lentos e vendas recentes
export interface ProdutoEstrela {
    id: number;
    nome: string;
    categoria?: string;
    classificacao?: string;
    margem?: number;
    market_share?: number;
    total_vendido?: number;
    quantidade_vendida?: number;
}

export interface ProdutoLento {
    id: number;
    nome: string;
    categoria?: string;
    quantidade?: number;
    total_vendido?: number;
}

export interface UltimaVenda {
    id: number;
    codigo: string;
    cliente?: string;
    forma_pagamento?: string;
    total?: number;
    data_venda?: string;
    itens?: VendaItem[];
}
export interface DashboardMetrics {
    total_vendas_hoje: number;
    total_vendas_mes: number;
    ticket_medio: number;
    clientes_novos_mes: number;
    produtos_baixo_estoque: number;
    despesas_mes: number;
    lucro_mes: number;
    vendas_por_categoria: Array<{
        categoria: string;
        total: number;
    }>;
    vendas_ultimos_7_dias: Array<{
        data: string;
        total: number;
    }>;
    ultimas_vendas?: UltimaVenda[];
}

export interface DashboardDonoMetrics extends DashboardMetrics {
    faturamento_hoje: number;
    faturamento_mes: number;
    clientes_hoje: number;
    alertas_criticos: number;
    status_operacional: string;
    meta_diaria: number;
    atingimento_meta: number;
    decisao_do_dia: Record<string, unknown>;
    // Propriedades extras do dashboard dono
    faturamento_anual?: number;
    margem_lucro_media?: number;
    top_produtos?: Array<{
        produto_id: number;
        nome: string;
        quantidade_vendida: number;
        total_vendido: number;
    }>;
    top_clientes?: Array<{
        cliente_id: number;
        nome: string;
        total_compras: number;
    }>;
}

// Tipos para configurações
export interface Configuracao {
    id: number;
    estabelecimento_id: number;
    logo_url?: string;
    cor_principal: string;
    tema_escuro: boolean;
    impressao_automatica: boolean;
    tipo_impressora: string;
    exibir_preco_tela: boolean;
    permitir_venda_sem_estoque: boolean;
    desconto_maximo_percentual: number;
    arredondamento_valores: number;
    dias_alerta_validade: number;
    estoque_minimo_padrao: number;
    tempo_sessao_minutos: number;
    tentativas_senha_bloqueio: number;
    formas_pagamento: {
        dinheiro: { ativo: boolean; taxa: number; exige_troco: boolean };
        cartao_credito: { ativo: boolean; taxa: number; parcelas: number };
        cartao_debito: { ativo: boolean; taxa: number };
        pix: { ativo: boolean; taxa: number };
    };
    meta_vendas_diaria: number;
    meta_vendas_mensal: number;
    alerta_estoque_minimo: boolean;
    alerta_validade_proxima: boolean;
    alerta_churn_clientes: boolean;
    dashboard_analytics_avancado: boolean;
    alertas_email: boolean;
    alertas_whatsapp: boolean;
    // Propriedades de localização do estabelecimento
    latitude_estabelecimento?: number;
    longitude_estabelecimento?: number;
    raio_validacao_metros?: number;
    // Propriedades de horários de ponto
    hora_entrada_ponto?: string;
    hora_saida_almoco_ponto?: string;
    hora_retorno_almoco_ponto?: string;
    hora_saida_ponto?: string;
    // Propriedades de validação de ponto
    exigir_foto_ponto?: boolean;
    exigir_localizacao_ponto?: boolean;
    tolerancia_atraso_minutos?: number;
    created_at: string;
    updated_at: string;
}

// Tipos para relatórios
export interface RelatorioAgendado {
    id: number;
    estabelecimento_id: number;
    nome: string;
    tipo: 'vendas' | 'estoque' | 'financeiro' | 'clientes' | 'analytics';
    formato: 'pdf' | 'excel' | 'csv' | 'json';
    frequencia: 'diario' | 'semanal' | 'mensal' | 'trimestral';
    analises_incluidas: {
        tendencia: boolean;
        sazonalidade: boolean;
        previsao: boolean;
        segmentacao: boolean;
        anomalias: boolean;
        benchmarking: boolean;
    };
    horario_envio: string;
    destinatarios_email?: string[];
    enviar_para_proprietario: boolean;
    parametros?: Record<string, unknown>;
    ativo: boolean;
    ultima_execucao?: string;
    proxima_execucao?: string;
    created_at: string;
    updated_at: string;
}
