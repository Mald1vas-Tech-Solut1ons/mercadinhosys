import { describe, expect, it } from 'vitest';
import { carimboLocal, dataDoDia, dataLocalISO, diasAte } from './dataLocal';

// 05/11/2026 22:30 no relógio do aparelho (a hora em que o dia UTC já virou para 06/11).
const NOITE = new Date(2026, 10, 5, 22, 30);

describe('datas de calendário no dia local', () => {
    it('lote que vence hoje faltam 0 dias, não -1', () => {
        expect(diasAte('2026-11-05', NOITE)).toBe(0);
        expect(diasAte('2026-11-06', NOITE)).toBe(1);
        expect(diasAte('2026-11-04', NOITE)).toBe(-1);
        expect(diasAte(null, NOITE)).toBeNull();
    });

    it('data pura é exibida no próprio dia', () => {
        expect(dataDoDia('2026-11-05').getDate()).toBe(5);
        expect(dataLocalISO(NOITE)).toBe('2026-11-05');
    });

    it('carimbo de arquivo usa a hora do aparelho', () => {
        expect(carimboLocal(NOITE)).toBe('2026-11-05_22-30-00');
    });
});
