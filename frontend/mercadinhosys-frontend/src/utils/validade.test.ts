import { describe, it, expect } from 'vitest';
import { parseDataValidade, estaVencido, diasParaVencer } from './validade';

describe('parseDataValidade — FASE 1.6 (parser único)', () => {
    describe('formatos suportados', () => {
        it('aceita ISO puro YYYY-MM-DD', () => {
            const d = parseDataValidade('2026-12-25');
            expect(d).not.toBeNull();
            expect(d!.getFullYear()).toBe(2026);
            expect(d!.getMonth()).toBe(11);
            expect(d!.getDate()).toBe(25);
        });

        it('aceita ISO com horário YYYY-MM-DDTHH:mm', () => {
            const d = parseDataValidade('2026-12-25T18:30:00');
            expect(d).not.toBeNull();
            expect(d!.getFullYear()).toBe(2026);
            expect(d!.getMonth()).toBe(11);
            expect(d!.getDate()).toBe(25);
        });

        it('aceita BR DD/MM/YYYY', () => {
            const d = parseDataValidade('25/12/2026');
            expect(d).not.toBeNull();
            expect(d!.getFullYear()).toBe(2026);
            expect(d!.getMonth()).toBe(11);
            expect(d!.getDate()).toBe(25);
        });

        it('aceita datas com zeros omitidos em BR', () => {
            const d = parseDataValidade('5/1/2026');
            expect(d).not.toBeNull();
            expect(d!.getFullYear()).toBe(2026);
        });
    });

    describe('entradas inválidas retornam null (nunca NaN)', () => {
        it('null/undefined → null', () => {
            expect(parseDataValidade(null)).toBeNull();
            expect(parseDataValidade(undefined)).toBeNull();
        });

        it('string vazia → null', () => {
            expect(parseDataValidade('')).toBeNull();
            expect(parseDataValidade('   ')).toBeNull();
        });

        it('formatos irreconhecíveis → null', () => {
            expect(parseDataValidade('hello')).toBeNull();
            expect(parseDataValidade('12-25-2026')).toBeNull(); // MM-DD-YYYY não é contrato
            expect(parseDataValidade('2026/12/25')).toBeNull(); // YYYY/MM/DD não é contrato
        });

        it('datas semanticamente inválidas → null (sem rollover)', () => {
            expect(parseDataValidade('2026-02-30')).toBeNull(); // fev não tem 30
            expect(parseDataValidade('2026-13-15')).toBeNull(); // mês 13
            expect(parseDataValidade('32/01/2026')).toBeNull(); // dia 32
        });

        it('anos fora da faixa plausível → null', () => {
            expect(parseDataValidade('1800-06-01')).toBeNull();
            expect(parseDataValidade('2200-06-01')).toBeNull();
        });
    });

    describe('estaVencido', () => {
        it('null/false para quem não tem data', () => {
            expect(estaVencido(null)).toBe(false);
            expect(estaVencido('')).toBe(false);
        });

        it('detecta passado claramente', () => {
            expect(estaVencido('2020-01-01')).toBe(true);
            expect(estaVencido('01/01/2020')).toBe(true);
        });

        it('não marca futuro', () => {
            expect(estaVencido('2099-12-31')).toBe(false);
        });
    });

    describe('diasParaVencer', () => {
        it('null para inválido/vazio', () => {
            expect(diasParaVencer(null)).toBeNull();
            expect(diasParaVencer('abc')).toBeNull();
        });

        it('numérico para válido (positivo ou negativo)', () => {
            const amanha = new Date();
            amanha.setDate(amanha.getDate() + 1);
            const iso = amanha.toISOString().slice(0, 10);
            const v = diasParaVencer(iso);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);

            const ontem = new Date();
            ontem.setDate(ontem.getDate() - 1);
            const isoOntem = ontem.toISOString().slice(0, 10);
            expect(diasParaVencer(isoOntem)).toBeLessThan(0);
        });
    });
});
