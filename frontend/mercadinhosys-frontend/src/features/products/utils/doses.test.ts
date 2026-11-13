import { describe, expect, it } from 'vitest';
import {
    avisosDasDoses, calcularDose, deResposta, detectarVolumeMl, estadoVazio, formatarMl, novaDose, numero,
    paraPayload, precoDaMargem, sugerirPreco, validarDoses, DosesEstado, RespostaDosesProduto,
} from './doses';

// Mesmos casos de backend/tests/test_dose_config.py (o servidor é a fonte da verdade).
describe('detectarVolumeMl', () => {
    it.each([
        ['WHISKY RED 1L', 1000], ['Vinho tinto 750ml', 750], ['Vodka 1,75L', 1750], ['Licor 70cl', 700],
        ['Refrigerante 2 Litros', 2000], ['Cachaça 600 ml', 600], ['Whisky 12 anos 1L', 1000],
        ['Cerveja Lata', null], ['Camiseta G', null], ['', null], [null, null],
    ])('%s → %s', (texto, esperado) => {
        expect(detectarVolumeMl(texto as string | null)).toBe(esperado);
    });

    it('usa o primeiro texto que tiver volume (atributo antes do nome)', () => {
        expect(detectarVolumeMl('900 ml', 'Gin 1L')).toBe(900);
        expect(detectarVolumeMl(undefined, 'Gin 1L')).toBe(1000);
    });
});

describe('sugerirPreco e precoDaMargem', () => {
    it.each([
        [6, 60, 15], [6.6667, 60, 17], [6, 50, 12], [7, 60, 17.5], [0.01, 60, 0.5],
    ])('custo %s, margem %s%% → R$ %s (próximo R$ 0,50)', (custo, margem, esperado) => {
        expect(sugerirPreco(custo, margem)).toBe(esperado);
    });

    it('margem de 100% ou mais não existe', () => {
        expect(() => sugerirPreco(6, 100)).toThrow();
        expect(Number.isNaN(precoDaMargem(6, 100))).toBe(true);
    });

    it('margem digitada vira o preço exato (centavos para cima)', () => {
        expect(precoDaMargem(6, 60)).toBe(15);
        expect(precoDaMargem(6.18, 60)).toBe(15.45);
        expect(precoDaMargem(6.6667, 60)).toBe(16.67);
    });
});

describe('calcularDose', () => {
    it('whisky de 1 L (custo R$ 120, venda R$ 150), dose de 50 ml a R$ 18', () => {
        const c = calcularDose({ custoGarrafa: 120, volumeMl: 1000, ml: 50, preco: 18, precoGarrafa: 150 });
        expect(c.custoDose).toBe(6);
        expect(c.margemValor).toBe(12);
        expect(c.margemPct).toBe(66.7);
        expect(c.dosesPorGarrafa).toBe(20);
        expect(c.receitaGarrafa).toBe(360);
        expect(c.multiploDaGarrafa).toBe(2.4);
        expect(c.abaixoDaGarrafa).toBe(false);
    });

    it('ml livre com casas decimais', () => {
        const c = calcularDose({ custoGarrafa: 120, volumeMl: 1000, ml: 51.5, preco: 19.9 });
        expect(c.custoDose).toBe(6.18);
    });

    it('a perda esperada encarece a dose e reduz as doses vendáveis', () => {
        const c = calcularDose({ custoGarrafa: 120, volumeMl: 1000, ml: 50, preco: 18, perdaPct: 10 });
        expect(c.custoDose).toBeCloseTo(6.6667, 4);
        expect(c.dosesVendaveis).toBe(18);
        expect(c.receitaGarrafa).toBe(324);
    });

    it('dose mais barata por ml que a garrafa fechada é sinalizada', () => {
        const c = calcularDose({ custoGarrafa: 120, volumeMl: 1000, ml: 50, preco: 5, precoGarrafa: 150 });
        expect(c.abaixoDaGarrafa).toBe(true);
        expect(c.margemPct).toBeLessThan(0);
    });

    it('sem volume ou sem ml não calcula nada (sem NaN)', () => {
        expect(calcularDose({ custoGarrafa: 120, volumeMl: null, ml: 50, preco: 18 }).custoDose).toBeNull();
        expect(calcularDose({ custoGarrafa: 120, volumeMl: 1000, ml: null, preco: 18 }).custoDose).toBeNull();
        expect(calcularDose({ custoGarrafa: 120, volumeMl: 1000, ml: 50, preco: null }).margemPct).toBeNull();
    });
});

describe('avisosDasDoses', () => {
    it('avisa margem negativa, margem abaixo da meta e dose mais barata que a garrafa', () => {
        const base = { custoGarrafa: 120, volumeMl: 1000, precoGarrafa: 150 };
        const avisos = avisosDasDoses({
            metaMargemPct: 70,
            doses: [
                { nome: 'Dose', calc: calcularDose({ ...base, ml: 50, preco: 18 }) },
                { nome: 'Promo', calc: calcularDose({ ...base, ml: 50, preco: 5 }) },
            ],
        });
        const tipos = avisos.map(a => `${a.dose}:${a.tipo}`);
        expect(tipos).toContain('Dose:margem_baixa');
        expect(tipos).toContain('Promo:margem_negativa');
        expect(tipos).toContain('Promo:abaixo_da_garrafa');
    });
});

const dose = (extra = {}) => ({ chave: 'k', nome: 'Dose', volume_ml: '50', preco_venda: '18', padrao: true, ...extra });
const estado = (extra: Partial<DosesEstado> = {}): DosesEstado => ({
    vende_por_dose: true, volume_embalagem_ml: '1000', validade_aberta_dias: '', perda_esperada_pct: '',
    doses: [dose()], ...extra,
});

describe('validarDoses', () => {
    it('desligado não valida nada', () => {
        expect(validarDoses(estadoVazio())).toBeNull();
    });

    it('estado correto passa, inclusive com vírgula', () => {
        expect(validarDoses(estado())).toBeNull();
        expect(validarDoses(estado({ doses: [dose({ volume_ml: '51,5', preco_venda: '19,90' })] }))).toBeNull();
    });

    it.each([
        [{ volume_embalagem_ml: '' }, 'volume da garrafa'],
        [{ volume_embalagem_ml: '0' }, 'volume da garrafa'],
        [{ doses: [] }, 'ao menos uma dose'],
        [{ doses: [dose({ volume_ml: '' })] }, 'quantos ml'],
        [{ doses: [dose({ volume_ml: '1500' })] }, 'maior que a garrafa'],
        [{ doses: [dose({ preco_venda: '' })] }, 'preço da dose'],
        [{ doses: [dose({ preco_venda: '0' })] }, 'preço da dose'],
        [{ doses: [dose(), dose({ nome: 'DOSE', volume_ml: '60', padrao: false })] }, 'duas doses'],
        [{ doses: [dose(), dose({ nome: 'B', volume_ml: '60' })] }, 'só uma dose padrão'],
        [{ perda_esperada_pct: '80' }, 'Perda esperada'],
        [{ validade_aberta_dias: '0' }, 'Validade depois de aberta'],
    ])('recusa %j', (extra, trecho) => {
        expect(validarDoses(estado(extra as Partial<DosesEstado>))).toContain(trecho);
    });

    it('mais de 12 doses é recusado', () => {
        const muitas = Array.from({ length: 13 }, (_, i) => dose({ nome: `D${i}`, volume_ml: String(10 + i), padrao: i === 0 }));
        expect(validarDoses(estado({ doses: muitas }))).toContain('No máximo');
    });
});

describe('paraPayload / deResposta', () => {
    it('converte textos com vírgula em números e mantém o id da dose gravada', () => {
        const p = paraPayload(estado({
            perda_esperada_pct: '5,5',
            doses: [{ ...dose({ volume_ml: '51,5', preco_venda: '19,90' }), id: 7 }],
        }));
        expect(p).toEqual({
            vende_por_dose: true, volume_embalagem_ml: 1000, validade_aberta_dias: null, perda_esperada_pct: 5.5,
            doses: [{ id: 7, nome: 'Dose', volume_ml: 51.5, preco_venda: 19.9, padrao: true }],
        });
    });

    it('dose nova não leva id', () => {
        expect(paraPayload(estado()).doses[0]).not.toHaveProperty('id');
    });

    it('lê a resposta do servidor e deixa as doses arquivadas de fora', () => {
        const r = {
            config: { vende_por_dose: true, volume_embalagem_ml: 1000, volume_sugerido_ml: null,
                validade_aberta_dias: 5, perda_esperada_pct: null, perda_efetiva_pct: 0 },
            doses: [
                { id: 1, nome: 'Dose', volume_ml: 50, preco_venda: 18.5, padrao: true, ativa: true },
                { id: 2, nome: 'Antiga', volume_ml: 40, preco_venda: 12, padrao: false, ativa: false },
            ],
            garrafas_abertas: 0, avisos: [], loja: {} as never,
        } as RespostaDosesProduto;
        const e = deResposta(r);
        expect(e.volume_embalagem_ml).toBe('1000');
        expect(e.validade_aberta_dias).toBe('5');
        expect(e.doses).toHaveLength(1);
        expect(e.doses[0]).toMatchObject({ id: 1, nome: 'Dose', volume_ml: '50', preco_venda: '18,5', padrao: true });
    });
});

describe('novaDose', () => {
    it('sugere o preço pela margem alvo e vira padrão só se for a primeira', () => {
        const primeira = novaDose({ nome: 'Dose', ml: 50, custoGarrafa: 120, volumeMl: 1000, metaMargemPct: 60, jaTemPadrao: false });
        expect(primeira.preco_venda).toBe('15');
        expect(primeira.padrao).toBe(true);
        const segunda = novaDose({ nome: 'Dupla', ml: 100, custoGarrafa: 120, volumeMl: 1000, metaMargemPct: 60, jaTemPadrao: true });
        expect(segunda.preco_venda).toBe('30');
        expect(segunda.padrao).toBe(false);
    });

    it('sem custo, sem meta ou sem volume o preço fica em branco para o lojista digitar', () => {
        expect(novaDose({ ml: 50, custoGarrafa: 0, volumeMl: 1000, metaMargemPct: 60, jaTemPadrao: true }).preco_venda).toBe('');
        expect(novaDose({ ml: 50, custoGarrafa: 120, volumeMl: null, metaMargemPct: 60, jaTemPadrao: true }).preco_venda).toBe('');
        expect(novaDose({ ml: 50, custoGarrafa: 120, volumeMl: 1000, metaMargemPct: null, jaTemPadrao: true }).preco_venda).toBe('');
    });
});

describe('números e formatação', () => {
    it('numero aceita vírgula e recusa lixo', () => {
        expect(numero('51,5')).toBe(51.5);
        expect(numero(' 10 ')).toBe(10);
        expect(numero('')).toBeNull();
        expect(numero('abc')).toBeNull();
        expect(numero(null)).toBeNull();
    });

    it('formatarMl', () => {
        expect(formatarMl(50)).toBe('50 ml');
        expect(formatarMl(51.5)).toBe('51,5 ml');
        expect(formatarMl(1000)).toBe('1 L');
        expect(formatarMl(1750)).toBe('1,75 L');
        expect(formatarMl(1005)).toBe('1005 ml');
        expect(formatarMl(750)).toBe('750 ml');
        expect(formatarMl(null)).toBe('—');
    });
});
