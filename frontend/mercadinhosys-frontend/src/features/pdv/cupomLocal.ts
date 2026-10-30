/**
 * Cupom guardado no aparelho — reimpressão de qualquer venda recente do PDV,
 * inclusive a feita sem internet (que ainda não tem id no servidor).
 *
 * Toda venda concluída no PDV grava aqui uma cópia do comprovante, montada com
 * o que o caixa tinha na tela. Quando a venda offline sincroniza, a cópia ganha
 * o id/código do servidor e a reimpressão passa a buscar a versão oficial.
 */
import { db, type CupomLocal } from '../../lib/db';
import type { ComprovanteVendaResponse } from './pdvService';

type Cabecalho = NonNullable<ComprovanteVendaResponse['estabelecimento']>;

const CHAVE_CABECALHO = 'pdv_cupom_cabecalho';
const MAX_CUPONS = 200;
const DIAS_RETENCAO = 30;

/** Loja logada neste aparelho (ConfigContext grava a chave no login). */
const estabAtual = (): string => {
    try { return localStorage.getItem('current_estabelecimento_id') || ''; } catch { return ''; }
};

/** Guarda o cabeçalho da loja (vem de /pdv/configuracoes) para o cupom offline. */
export function salvarCabecalhoCupom(cab: Cabecalho | null | undefined): void {
    if (!cab) return;
    try { localStorage.setItem(`${CHAVE_CABECALHO}:${estabAtual()}`, JSON.stringify(cab)); } catch { /* storage indisponível */ }
}

export function lerCabecalhoCupom(): Cabecalho | undefined {
    try {
        const bruto = localStorage.getItem(`${CHAVE_CABECALHO}:${estabAtual()}`);
        return bruto ? JSON.parse(bruto) : undefined;
    } catch { return undefined; }
}

export const codigoOffline = (uuid: string) => `OFF-${uuid.slice(0, 8).toUpperCase()}`;

export interface DadosCupomVenda {
    uuid: string;
    vendaId?: number;
    codigo?: string;
    offline: boolean;
    itens: Array<{ nome: string; codigo?: string | null; quantidade: number; precoUnitario: number; total: number }>;
    subtotal: number;
    desconto: number;
    total: number;
    pagamentos: Array<{ forma: string; valor: number }>;
    valorRecebido: number;
    troco: number;
    cliente?: string | null;
    operador?: string | null;
}

/** Comprovante no mesmo formato de GET /pdv/comprovante/:id, montado no aparelho. */
export function montarComprovanteLocal(d: DadosCupomVenda, agora = new Date()): ComprovanteVendaResponse {
    const formas = [...new Set(d.pagamentos.map(p => p.forma).filter(Boolean))];
    return {
        success: true,
        venda: {
            id: d.vendaId ?? 0,
            codigo: d.codigo || codigoOffline(d.uuid),
            data: agora.toLocaleString('pt-BR'),
        },
        estabelecimento: lerCabecalhoCupom(),
        comprovante: {
            funcionario: d.operador || 'Operador',
            cliente: d.cliente || 'Consumidor Final',
            itens: d.itens.map(it => ({
                nome: it.nome,
                codigo: it.codigo || undefined,
                quantidade: it.quantidade,
                preco_unitario: it.precoUnitario,
                total: it.total,
            })),
            subtotal: d.subtotal,
            desconto: d.desconto,
            total: d.total,
            forma_pagamento: formas.join('/') || 'Não informado',
            valor_recebido: d.valorRecebido,
            troco: d.troco,
            rodape: 'Obrigado pela preferência!',
        },
    };
}

/** Grava a cópia do cupom e poda as antigas (venda ainda não sincronizada nunca é podada). */
export async function salvarCupomLocal(d: DadosCupomVenda): Promise<CupomLocal> {
    const agora = new Date();
    const dados = montarComprovanteLocal(d, agora);
    const cupom: CupomLocal = {
        id: d.uuid,
        venda_id: d.vendaId,
        codigo: dados.venda.codigo,
        criadoEm: agora.toISOString(),
        offline: d.offline,
        total: d.total,
        dados,
        estabelecimento_id: estabAtual(),
    };
    await db.cupons.put(cupom);
    await podarCupons();
    return cupom;
}

async function podarCupons(): Promise<void> {
    const limite = new Date(Date.now() - DIAS_RETENCAO * 86_400_000).toISOString();
    const todos = await db.cupons.orderBy('criadoEm').reverse().toArray();
    const remover = todos
        .filter((c, i) => !c.offline && (i >= MAX_CUPONS || c.criadoEm < limite))
        .map(c => c.id);
    if (remover.length) await db.cupons.bulkDelete(remover);
}

/** Cupons deste aparelho para a loja logada, mais recentes primeiro. */
export async function listarCuponsLocais(): Promise<CupomLocal[]> {
    const estab = estabAtual();
    const todos = await db.cupons.orderBy('criadoEm').reverse().toArray();
    return todos.filter(c => c.estabelecimento_id === estab);
}

/** A venda offline subiu: a cópia passa a apontar para a venda do servidor. */
export async function vincularCupomSincronizado(uuid: string, venda: { id?: number; codigo?: string } | undefined): Promise<void> {
    const cupom = await db.cupons.get(uuid);
    if (!cupom) return;
    const codigo = venda?.codigo || cupom.codigo;
    await db.cupons.put({
        ...cupom,
        venda_id: venda?.id ?? cupom.venda_id,
        codigo,
        offline: false,
        dados: { ...cupom.dados, venda: { ...cupom.dados.venda, id: venda?.id ?? cupom.dados.venda.id, codigo } },
    });
}

/** Venda offline descartada pelo operador: o cupom dela não deve ser reimpresso. */
export async function removerCupomLocal(uuid: string): Promise<void> {
    await db.cupons.delete(uuid);
}
