import { describe, expect, it } from 'vitest';
import {
    calcularModoMercado,
    calcularModoVenda,
    markupDe,
} from './precificacaoReversa';

/**
 * Paridade front/back: MESMOS vetores do pytest backend/tests/test_precificacao_reversa.py
 * (TESTES_VETORES). Não inventar vetores novos — copiar os esperados da spec da Fase A.
 */
const VETORES: Array<[number, number, number, number, number, number]> = [
    [100.0, 15, 50, 85.0, 42.5, 100.0],
    [100.0, 17.5, 50, 82.5, 41.25, 100.0],
    [59.9, 20, 40, 47.92, 28.75, 66.68],
    [10.0, 0, 30, 10.0, 7.0, 42.86],
];

describe('precificacaoReversa (paridade com o backend)', () => {
    it.each(VETORES)(
        'mercado: ref %f / desc %f / margem %f → venda %f, custo %f, markup %f',
        (ref, desc, margem, vendaExp, custoExp, markupExp) => {
            const r = calcularModoMercado({
                precoReferencia: ref,
                descontoPct: desc,
                margemAlvoVendaPct: margem,
            });
            expect(r.erro).toBeNull();
            expect(r.venda).toBe(vendaExp);
            expect(r.custo).toBe(custoExp);
            expect(r.markup).toBe(markupExp);
        }
    );

    it('venda: ref %f na margem 40 → custo 28.75 (59.90)', () => {
        const r = calcularModoVenda(47.92, 40);
        expect(r.custo).toBe(28.75);
    });

    it('markup_de: 42.50 → 85.00 = 100.00', () => {
        expect(markupDe(42.5, 85).markup).toBe(100.0);
    });

    it('validações: desconto 100 e margem 100 rejeitados', () => {
        expect(calcularModoMercado({ precoReferencia: 100, descontoPct: 100, margemAlvoVendaPct: 50 }).erro).not.toBeNull();
        expect(calcularModoVenda(100, 100).erro).not.toBeNull();
    });
});