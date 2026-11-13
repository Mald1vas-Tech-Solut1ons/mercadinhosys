import { describe, expect, it } from 'vitest';
import { ResumoAberto, diasAberta, estoqueEmGarrafas, mlTexto, textoDaAberta } from './estoqueDose';

const aberta = (extra: Partial<ResumoAberto> = {}): ResumoAberto => ({
    vende_por_dose: true, volume_embalagem_ml: 1000, saldo_aberto_ml: 650, garrafas_abertas: 1, garrafas_vencidas: 0,
    dose_ml_padrao: 50, doses_na_aberta: 13, ...extra,
});

describe('textoDaAberta', () => {
    it('garrafa aberta: saldo e quantas doses ainda rende', () => {
        expect(textoDaAberta(aberta())).toBe('1 aberta · 650 ml ≈ 13 doses');
    });

    it('litros e várias abertas', () => {
        expect(textoDaAberta(aberta({ saldo_aberto_ml: 1500, garrafas_abertas: 2, doses_na_aberta: 30 })))
            .toBe('2 abertas · 1,5 L ≈ 30 doses');
    });

    it('sem dose padrão não inventa a conta de doses', () => {
        expect(textoDaAberta(aberta({ doses_na_aberta: null, dose_ml_padrao: null }))).toBe('1 aberta · 650 ml');
    });

    it('garrafa vencida depois de aberta é avisada e não conta no saldo vendável', () => {
        expect(textoDaAberta(aberta({ saldo_aberto_ml: 0, garrafas_vencidas: 1, doses_na_aberta: 0 })))
            .toBe('1 vencida depois de aberta');
        expect(textoDaAberta(aberta({ garrafas_abertas: 2, garrafas_vencidas: 1 })))
            .toBe('1 aberta · 650 ml ≈ 13 doses · 1 vencida depois de aberta');
    });

    it('nada a dizer sem garrafa aberta, sem dado ou produto comum', () => {
        expect(textoDaAberta(aberta({ garrafas_abertas: 0, saldo_aberto_ml: 0 }))).toBeNull();
        expect(textoDaAberta(undefined)).toBeNull();
        expect(textoDaAberta(null)).toBeNull();
    });
});

describe('estoqueEmGarrafas e mlTexto', () => {
    it('fechadas + abertas', () => {
        expect(estoqueEmGarrafas(7, aberta())).toBe('7 fechadas + 1 aberta');
        expect(estoqueEmGarrafas(1, aberta({ garrafas_abertas: 2 }))).toBe('1 fechada + 2 abertas');
        expect(estoqueEmGarrafas(0, aberta({ garrafas_abertas: 0 }))).toBe('0 fechadas');
        expect(estoqueEmGarrafas(3)).toBe('3 fechadas');
    });

    it('mlTexto', () => {
        expect(mlTexto(805)).toBe('805 ml');
        expect(mlTexto(1000)).toBe('1 L');
        expect(mlTexto(1750)).toBe('1,75 L');
        expect(mlTexto(29.5)).toBe('29,5 ml');
    });
});

describe('diasAberta', () => {
    const agora = new Date('2026-11-12T12:00:00Z');
    it('conta dias desde a abertura (data do servidor é UTC, mesmo sem o Z)', () => {
        expect(diasAberta('2026-11-12T08:00:00', agora)).toBe(0);
        expect(diasAberta('2026-11-09T11:00:00', agora)).toBe(3);
        expect(diasAberta('2026-11-09T11:00:00Z', agora)).toBe(3);
        expect(diasAberta('2026-11-09T08:00:00-03:00', agora)).toBe(3);
    });

    it('sem data ou data ruim devolve null; futuro não fica negativo', () => {
        expect(diasAberta(null, agora)).toBeNull();
        expect(diasAberta('ontem', agora)).toBeNull();
        expect(diasAberta('2026-11-13T12:00:00', agora)).toBe(0);
    });
});
