import { apiClient } from '../../api/apiClient';

export interface NotaEntradaItemPreview {
    descricao: string;
    ean: string | null;
    codigo: string | null;
    ncm: string | null;
    quantidade: number;
    valor_unitario: number;
    valor_total: number;
    produto_existente: boolean;
    produto_id: number | null;
    produto_nome: string | null;
    acao: 'atualizar_estoque' | 'criar_produto';
}

export interface NotaEntradaPreview {
    pedidos_fornecedor: { id: number; numero_pedido: string; status: string; total: number }[];
    chave_acesso: string;
    ja_importada: boolean;
    numero: string;
    serie: string;
    data_emissao: string | null;
    natureza_operacao: string | null;
    emitente: { cnpj: string; nome: string; uf?: string; municipio?: string };
    fornecedor_cadastrado: any | null;
    total: number;
    qtd_itens: number;
    duplicatas: { numero: string; vencimento: string; valor: number }[];
    itens: NotaEntradaItemPreview[];
}

export interface NotaEntrada {
    pedido_compra_id: number | null;
    id: number;
    chave_acesso: string;
    numero: string;
    serie: string;
    emitente_nome: string;
    fornecedor_nome: string;
    data_emissao: string | null;
    valor_total: number;
    qtd_itens: number;
    status: string;
}

export interface DocumentoFiscal {
    id: number;
    venda_id: number | null;
    tipo: string;
    modelo: string;
    ambiente: string;
    gateway: string;
    numero: string | null;
    serie: string | null;
    chave_acesso: string | null;
    protocolo: string | null;
    status: string;
    motivo_rejeicao: string | null;
    valor_total: number;
    danfe_url: string | null;
    qr_code: string | null;
    created_at: string | null;
    autorizado_em: string | null;
}

export const fiscalService = {
    // ----- Entrada (XML de compra) -----
    previewEntrada: async (file: File): Promise<NotaEntradaPreview> => {
        const fd = new FormData();
        fd.append('xml', file);
        const { data } = await apiClient.post('/fiscal/entrada/preview', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data.preview;
    },

    importarEntrada: async (file: File, pedidoId?: number, compraAvulsa = false): Promise<any> => {
        const fd = new FormData();
        fd.append('xml', file);
        if (pedidoId) fd.append('pedido_id', String(pedidoId));
        fd.append('compra_avulsa', String(compraAvulsa));
        const { data } = await apiClient.post('/fiscal/entrada/importar', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
    },

    listarEntradas: async (page = 1): Promise<{ notas: NotaEntrada[]; paginacao: any }> => {
        const { data } = await apiClient.get('/fiscal/entrada', { params: { page, per_page: 20 } });
        return data;
    },

    urlXmlEntrada: (id: number) => `/fiscal/entrada/${id}/xml`,

    // ----- Saída (NFC-e) -----
    emitirNFCe: async (vendaId: number): Promise<{ success: boolean; documento: DocumentoFiscal; message: string }> => {
        const { data } = await apiClient.post(`/fiscal/vendas/${vendaId}/nfce`, {});
        return data;
    },

    listarDocumentos: async (page = 1, status?: string): Promise<{ documentos: DocumentoFiscal[]; paginacao: any }> => {
        const { data } = await apiClient.get('/fiscal/documentos', { params: { page, per_page: 20, status } });
        return data;
    },

    cancelarDocumento: async (id: number, justificativa: string): Promise<{ success: boolean; message: string }> => {
        const { data } = await apiClient.post(`/fiscal/documentos/${id}/cancelar`, { justificativa });
        return data;
    },
};

export default fiscalService;
