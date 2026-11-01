import { describe, it, expect } from 'vitest';
import { ultimoDiaComVenda, periodoSemVenda, ultimoMovimentoDoPayload } from './ultimoMovimento';

const serie = [
    { data: '2026-10-28', total: 0, qtd: 0 },
    { data: '2026-10-29', total: 1200.5, qtd: 4 },
    { data: '2026-10-30', total: 843.2, qtd: 3 },
    { data: '2026-10-31', total: 0, qtd: 0 },
];

describe('ultimoDiaComVenda', () => {
    it('ignora o dia vazio no fim e devolve o último dia que vendeu', () => {
        expect(ultimoDiaComVenda(serie)).toEqual({ data: '2026-10-30', valor: 843.2, qtd: 3 });
    });

    it('aceita a chave legada "valor"', () => {
        expect(ultimoDiaComVenda([{ data: '2026-10-27', valor: 10 }])?.valor).toBe(10);
    });

    it('devolve null quando não houve venda alguma', () => {
        expect(ultimoDiaComVenda([{ data: '2026-10-31', total: 0, qtd: 0 }])).toBeNull();
    });

    it('não explode com payload ausente ou inválido', () => {
        expect(ultimoDiaComVenda(null)).toBeNull();
        expect(ultimoDiaComVenda(undefined)).toBeNull();
        expect(ultimoDiaComVenda([{} as any, { data: '2026-10-30' }])).toBeNull();
    });
});

describe('periodoSemVenda', () => {
    it('é verdadeiro quando receita e contagem de vendas são zero', () => {
        expect(periodoSemVenda({ financials: { revenue: 0 }, summary: { revenue: { value: 0, sample_size: 0 } } })).toBe(true);
    });

    it('é falso quando existe receita', () => {
        expect(periodoSemVenda({ financials: { revenue: 120.4 }, summary: { revenue: { value: 120.4, sample_size: 2 } } })).toBe(false);
    });

    it('é falso quando há vendas registradas mesmo com receita zero', () => {
        expect(periodoSemVenda({ financials: { revenue: 0 }, summary: { revenue: { value: 0, sample_size: 3 } } })).toBe(false);
    });
});

describe('ultimoMovimentoDoPayload', () => {
    it('lê charts.sales_trend', () => {
        expect(ultimoMovimentoDoPayload({ charts: { sales_trend: serie } })?.data).toBe('2026-10-30');
    });

    it('devolve null quando a série vem vazia', () => {
        expect(ultimoMovimentoDoPayload({ charts: { sales_trend: [] } })).toBeNull();
    });
});
