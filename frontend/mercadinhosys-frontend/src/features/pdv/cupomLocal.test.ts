import { beforeEach, describe, expect, it } from 'vitest';
import { codigoOffline, guardarLojaCupom, listarCuponsRecentes, montarComprovanteLocal, registrarCupomRecente } from './cupomLocal';

describe('cupom local (venda offline e reimpressão)', () => {
    beforeEach(() => localStorage.clear());

    it('monta o cupom da venda offline com itens, pagamentos e a loja do último cupom', () => {
        guardarLojaCupom({ nome_fantasia: 'MERCADINHO DA VERA', cnpj: '00.000.000/0001-00' });
        const c = montarComprovanteLocal({
            offlineUuid: 'abcd1234-ef56-7890-abcd-ef1234567890',
            itens: [{ nome: 'ARROZ 5KG', quantidade: 2, precoUnitario: 25, total: 50 }],
            subtotal: 50, desconto: 0, total: 50,
            pagamentos: [{ forma: 'dinheiro', valor: 40 }, { forma: 'pix', valor: 20 }],
            valorRecebido: 60, troco: 10, cliente: null, funcionario: 'CAIXA 1',
        });
        expect(c.venda.codigo).toBe('OFF-ABCD1234');
        expect(c.estabelecimento?.nome_fantasia).toBe('MERCADINHO DA VERA');
        expect(c.comprovante.itens[0]).toMatchObject({ nome: 'ARROZ 5KG', quantidade: 2, preco_unitario: 25, total: 50 });
        expect(c.comprovante.forma_pagamento).toBe('DINHEIRO + PIX');
        expect(c.comprovante.troco).toBe(10);
        expect(c.comprovante.cliente).toBe('Consumidor Final');
    });

    it('guarda as últimas vendas sem duplicar e mais recente primeiro', () => {
        registrarCupomRecente({ chave: '1', codigo: 'V1', data: '2026-10-30T10:00:00Z', total: 10, vendaId: 1, offline: false });
        registrarCupomRecente({ chave: 'u', codigo: codigoOffline('u'), data: '2026-10-30T11:00:00Z', total: 5, vendaId: null, offline: true });
        registrarCupomRecente({ chave: '1', codigo: 'V1', data: '2026-10-30T12:00:00Z', total: 10, vendaId: 1, offline: false });
        const lista = listarCuponsRecentes();
        expect(lista.map(c => c.chave)).toEqual(['1', 'u']);
    });
});
