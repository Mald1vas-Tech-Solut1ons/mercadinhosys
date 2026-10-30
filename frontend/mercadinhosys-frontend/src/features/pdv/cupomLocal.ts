/**
 * Cupom não fiscal guardado no aparelho: permite imprimir venda offline (antes da sincronização)
 * e reimprimir as últimas vendas do PDV sem depender da tela pós-venda.
 *
 * Venda online guarda só o id (o cupom é buscado no servidor, com NFC-e se houver);
 * venda offline guarda o cupom montado a partir do carrinho, já que ainda não existe no servidor.
 */
import type { ComprovanteVendaResponse } from './pdvService';

const CHAVE_HISTORICO = 'mercadinhosys_cupons_recentes';
const CHAVE_LOJA = 'mercadinhosys_cupom_estabelecimento';
const MAX_HISTORICO = 30;

export interface CupomRecente {
    chave: string;            // id da venda ou offline_uuid
    codigo: string;
    data: string;             // ISO
    total: number;
    vendaId: number | null;   // null = venda offline (cupom local)
    offline: boolean;
    comprovante?: ComprovanteVendaResponse;
}

const ler = <T,>(chave: string, padrao: T): T => {
    try {
        const bruto = localStorage.getItem(chave);
        return bruto ? (JSON.parse(bruto) as T) : padrao;
    } catch {
        return padrao;
    }
};

const gravar = (chave: string, valor: unknown) => {
    try {
        localStorage.setItem(chave, JSON.stringify(valor));
    } catch {
        // armazenamento cheio/bloqueado: a reimpressão local fica indisponível, a venda não
    }
};

/** Dados da loja do último cupom carregado do servidor: cabeçalho do cupom offline. */
export const guardarLojaCupom = (estabelecimento: ComprovanteVendaResponse['estabelecimento']) => {
    if (estabelecimento) gravar(CHAVE_LOJA, estabelecimento);
};

export const listarCuponsRecentes = (): CupomRecente[] => ler<CupomRecente[]>(CHAVE_HISTORICO, []);

export const registrarCupomRecente = (cupom: CupomRecente) => {
    const lista = listarCuponsRecentes().filter(c => c.chave !== cupom.chave);
    gravar(CHAVE_HISTORICO, [cupom, ...lista].slice(0, MAX_HISTORICO));
};

const FORMA_LABEL: Record<string, string> = {
    dinheiro: 'DINHEIRO', pix: 'PIX', cartao_credito: 'CARTÃO DE CRÉDITO',
    cartao_debito: 'CARTÃO DE DÉBITO', fiado: 'FIADO / CRÉDITO',
};

export interface VendaLocal {
    offlineUuid: string;
    itens: Array<{ nome: string; codigo?: string; quantidade: number; precoUnitario: number; total: number }>;
    subtotal: number;
    desconto: number;
    total: number;
    pagamentos: Array<{ forma: string; valor: number }>;
    valorRecebido: number;
    troco: number;
    cliente?: string | null;
    funcionario?: string | null;
}

/** Código curto e estável da venda offline (o servidor dá o código definitivo na sincronização). */
export const codigoOffline = (uuid: string) => `OFF-${uuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const montarComprovanteLocal = (venda: VendaLocal): ComprovanteVendaResponse => {
    const formas = Array.from(new Set(venda.pagamentos.map(p => FORMA_LABEL[p.forma] || p.forma.toUpperCase())));
    return {
        success: true,
        venda: { id: 0, codigo: codigoOffline(venda.offlineUuid), data: new Date().toLocaleString('pt-BR') },
        estabelecimento: ler(CHAVE_LOJA, undefined),
        comprovante: {
            funcionario: venda.funcionario || 'Operador',
            cliente: venda.cliente || 'Consumidor Final',
            itens: venda.itens.map(i => ({
                nome: i.nome, codigo: i.codigo, quantidade: i.quantidade,
                preco_unitario: i.precoUnitario, total: i.total,
            })),
            subtotal: venda.subtotal,
            desconto: venda.desconto,
            total: venda.total,
            forma_pagamento: formas.join(' + ') || '—',
            valor_recebido: venda.valorRecebido,
            troco: venda.troco,
            rodape: 'Venda offline: será sincronizada quando a internet voltar.',
        },
    };
};
