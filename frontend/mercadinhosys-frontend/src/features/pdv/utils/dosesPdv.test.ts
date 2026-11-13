import { beforeEach, describe, expect, it } from 'vitest';
import {
    LinhaCarrinho, OfertaDose, ProdutoPdv, chaveDaLinha, chaveDe, formatarMlPdv, maxDaLinha, mlDisponivel, mlNoCarrinho,
    nomeDaLinha, opcaoInicial, precoDoseLivre, rotuloDaDose, salvarUltimaEscolha, temDoses, ultimaEscolha, validarMlLivre,
} from './dosesPdv';

const whisky = (extra: Partial<ProdutoPdv> = {}) => ({
    id: 7, nome: 'WHISKY 1L', preco_venda: 150, quantidade: 2, unidade_medida: 'UN',
    vende_por_dose: true, volume_embalagem_ml: 1000, saldo_aberto_ml: 300,
    doses: [
        { id: 1, nome: 'Dose', volume_ml: 50, preco_venda: 18, padrao: true },
        { id: 2, nome: 'Dupla', volume_ml: 100, preco_venda: 32, padrao: false },
    ],
    ...extra,
}) as unknown as ProdutoPdv & OfertaDose;

const dose50 = { id: 1, nome: 'Dose', volumeMl: 50 };
const dupla = { id: 2, nome: 'Dupla', volumeMl: 100 };

describe('identidade da linha', () => {
    it('produto comum mantém o id; dose e dose livre ganham chave própria', () => {
        expect(chaveDaLinha(7)).toBe('7');
        expect(chaveDaLinha(7, dose50)).toBe('7:d1');
        expect(chaveDaLinha(7, { id: null, nome: 'Dose livre', volumeMl: 45, livre: true })).toBe('7:l45');
    });

    it('garrafa, dose e dupla do mesmo produto são linhas diferentes', () => {
        const chaves = [chaveDaLinha(7), chaveDaLinha(7, dose50), chaveDaLinha(7, dupla)];
        expect(new Set(chaves).size).toBe(3);
    });

    it('carrinho salvo antes das doses (sem chave) vale o id do produto', () => {
        expect(chaveDe({ produto: { id: 9 }, quantidade: 1 })).toBe('9');
        expect(chaveDe({ produto: { id: 9 }, quantidade: 1, dose: dose50 })).toBe('9:d1');
        expect(chaveDe({ produto: { id: 9 }, quantidade: 1, chave: 'x' })).toBe('x');
    });
});

describe('textos', () => {
    it('rótulo e nome do item no carrinho/cupom', () => {
        expect(rotuloDaDose(dose50)).toBe('Dose · 50 ml');
        expect(rotuloDaDose({ id: null, nome: 'Dose livre', volumeMl: 45.5, livre: true })).toBe('Dose livre · 45,5 ml');
        expect(nomeDaLinha('WHISKY 1L', dose50)).toBe('WHISKY 1L · Dose · 50 ml');
        expect(nomeDaLinha('WHISKY 1L')).toBe('WHISKY 1L');
    });

    it('formatarMlPdv', () => {
        expect(formatarMlPdv(50)).toBe('50 ml');
        expect(formatarMlPdv(1000)).toBe('1 L');
        expect(formatarMlPdv(1750)).toBe('1,75 L');
        expect(formatarMlPdv(750)).toBe('750 ml');
    });
});

describe('quanto ainda dá para servir', () => {
    it('soma o saldo da aberta com as garrafas fechadas', () => {
        expect(mlDisponivel(whisky(), 2)).toBe(2300);
        expect(mlDisponivel(whisky({ saldo_aberto_ml: 0 }), 0)).toBe(0);
        expect(mlDisponivel(whisky(), -1)).toBe(300);                    // estoque negativo não subtrai
    });

    it('carrinho vazio: máximo de doses de 50 ml = 2300 / 50 = 46', () => {
        expect(maxDaLinha([], whisky(), 2, dose50)).toBe(46);
        expect(maxDaLinha([], whisky(), 2, dupla)).toBe(23);
        expect(maxDaLinha([], whisky(), 2)).toBe(2);                     // garrafa inteira: 2 fechadas + a aberta não conta inteira
    });

    it('as outras linhas do mesmo produto já ocuparam ml', () => {
        const carrinho: LinhaCarrinho[] = [
            { produto: { id: 7 }, quantidade: 10, dose: dupla, chave: '7:d2' },     // 1000 ml
            { produto: { id: 7 }, quantidade: 1 },                                  // 1 garrafa = 1000 ml
            { produto: { id: 8 }, quantidade: 5 },                                  // outro produto: não conta
        ];
        expect(mlNoCarrinho(carrinho, whisky())).toBe(2000);
        expect(maxDaLinha(carrinho, whisky(), 2, dose50)).toBe(6);                  // (2300 - 2000) / 50
    });

    it('a própria linha não se desconta duas vezes ao mudar a quantidade', () => {
        const carrinho: LinhaCarrinho[] = [{ produto: { id: 7 }, quantidade: 5, dose: dose50, chave: '7:d1' }];
        expect(maxDaLinha(carrinho, whisky(), 2, dose50)).toBe(46);
    });

    it('nunca devolve negativo', () => {
        const carrinho: LinhaCarrinho[] = [{ produto: { id: 7 }, quantidade: 99, dose: dupla, chave: '7:d2' }];
        expect(maxDaLinha(carrinho, whisky(), 2, dose50)).toBe(0);
    });
});

describe('dose livre', () => {
    it('preço = R$/ml da dose padrão x ml, sempre para cima ao centavo', () => {
        expect(precoDoseLivre(whisky(), 45)).toBe(16.2);                 // 18/50 x 45
        expect(precoDoseLivre(whisky(), 33)).toBe(11.88);
        const quebrado = whisky({ doses: [{ id: 1, nome: 'Dose', volume_ml: 30, preco_venda: 10, padrao: true }] as any });
        expect(precoDoseLivre(quebrado, 31)).toBe(10.34);                // 10/30 x 31 = 10,3333… → 10,34 (nunca abaixo)
    });

    it('sem dose marcada como padrão usa a primeira', () => {
        const p = whisky({ doses: [{ id: 5, nome: 'X', volume_ml: 40, preco_venda: 12, padrao: false }] as any });
        expect(precoDoseLivre(p, 40)).toBe(12);
    });

    it('valida o ml: positivo e no máximo uma garrafa', () => {
        expect(validarMlLivre(whisky(), 45)).toBeNull();
        expect(validarMlLivre(whisky(), 1000)).toBeNull();
        expect(validarMlLivre(whisky(), null)).toContain('Informe');
        expect(validarMlLivre(whisky(), 0)).toContain('Informe');
        expect(validarMlLivre(whisky(), 1500)).toContain('maior que a garrafa');
    });
});

describe('temDoses', () => {
    it('só vale com doses ativas e volume da garrafa', () => {
        expect(temDoses(whisky())).toBe(true);
        expect(temDoses(whisky({ doses: [] }))).toBe(false);
        expect(temDoses(whisky({ volume_embalagem_ml: 0 }))).toBe(false);
        expect(temDoses(whisky({ vende_por_dose: false as any }))).toBe(false);
        expect(temDoses({ id: 1, nome: 'Arroz' } as any)).toBe(false);
        expect(temDoses(null)).toBe(false);
    });
});

describe('última escolha', () => {
    beforeEach(() => localStorage.clear());

    it('sem histórico realça a dose padrão', () => {
        expect(opcaoInicial(whisky())).toBe('d1');
    });

    it('lembra o que o caixa serviu da última vez, por produto', () => {
        salvarUltimaEscolha(7, 'd2');
        salvarUltimaEscolha(8, 'garrafa');
        expect(ultimaEscolha(7)).toBe('d2');
        expect(opcaoInicial(whisky())).toBe('d2');
        expect(opcaoInicial(whisky({ id: 8 }))).toBe('garrafa');
    });

    it('dose lembrada que o lojista apagou volta para a padrão', () => {
        salvarUltimaEscolha(7, 'd99');
        expect(opcaoInicial(whisky())).toBe('d1');
    });

    it('localStorage corrompido não derruba o caixa', () => {
        localStorage.setItem('pdv_dose_ultima_escolha_v1', '{quebrado');
        expect(ultimaEscolha(7)).toBeNull();
        expect(opcaoInicial(whisky())).toBe('d1');
    });
});
