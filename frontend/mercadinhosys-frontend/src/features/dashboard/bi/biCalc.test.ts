import { describe, expect, it } from 'vitest';
import type { ProdutoBI } from './biTypes';
import { FILTROS_VAZIOS } from './biTypes';
import { CONFIG_PADRAO } from './biConfig';
import {
  agregar, aplicarFiltros, capitalVsReceita, curvaPareto, estaParado, faixasPadrao, montarArvore,
  montarFaixas, quadrante,
} from './biCalc';

const L = CONFIG_PADRAO.limiares; // margem mínima 20%, parado 60 dias

function prod(id: number, parcial: Partial<ProdutoBI>): ProdutoBI {
  return {
    id, nome: `P${id}`, ean: null, marca: null, fornecedor: null,
    familia_key: 'bazar', familia: 'Bazar', categoria_key: 'bazar.cozinha', categoria: 'Cozinha',
    subcategoria_key: 'bazar.cozinha.panela', subcategoria: 'Panela', servico: false, custo_estimado: false,
    estoque: 10, estoque_minimo: 2, preco_custo: 10, preco_venda: 20,
    receita: 0, custo: 0, margem: 0, margem_pct: null, qtd: 0, vendas: 0, dias_com_venda: 0,
    receita_anterior: 0, variacao_pct: null, vmd: 0, cobertura_dias: null, capital_custo: 100,
    capital_venda: 200, margem_potencial_pct: 50, gmroi: null, dias_sem_venda: null, nunca_vendeu: true,
    validade_dias: null, cv: null, xyz: null, abc: null, ruptura: false, abaixo_minimo: false,
    ...parcial,
  };
}

const estrela = prod(1, { receita: 1000, custo: 500, margem: 500, margem_pct: 50, capital_custo: 100, nunca_vendeu: false, dias_sem_venda: 1, vmd: 2, abc: 'A' });
const margemBaixa = prod(2, { receita: 800, custo: 720, margem: 80, margem_pct: 10, capital_custo: 100, nunca_vendeu: false, dias_sem_venda: 2, vmd: 1, abc: 'A' });
const nicho = prod(3, { receita: 100, custo: 40, margem: 60, margem_pct: 60, capital_custo: 1000, nunca_vendeu: false, dias_sem_venda: 20, vmd: 0.1, abc: 'C',
  categoria_key: 'bazar.mesa', categoria: 'Mesa', subcategoria_key: 'bazar.mesa.copo', subcategoria: 'Copo' });
const morto = prod(4, { capital_custo: 500, categoria_key: 'bazar.mesa', categoria: 'Mesa', subcategoria_key: 'bazar.mesa.copo', subcategoria: 'Copo' });
const todos = [estrela, margemBaixa, nicho, morto];

describe('agregar', () => {
  it('soma e deriva margem, GMROI e Δ% do recorte', () => {
    const a = agregar([estrela, margemBaixa]);
    expect(a.receita).toBe(1800);
    expect(a.margem).toBe(580);
    expect(a.margem_pct).toBeCloseTo(32.2, 1);
    expect(a.gmroi).toBeCloseTo(2.9, 5);
    expect(a.variacao_pct).toBeNull();
  });
});

describe('quadrante giro × margem', () => {
  it('classifica pelos cortes de margem mínima e giro mediano', () => {
    const corte = 3; // giros: 5, 7.2, 0.04
    expect(quadrante(estrela, corte, L)).toBe('estrela');
    expect(quadrante(margemBaixa, corte, L)).toBe('giro_margem_baixa');
    expect(quadrante(nicho, corte, L)).toBe('nicho');
    expect(quadrante(morto, corte, L)).toBe('peso_morto');
  });
});

describe('faixas', () => {
  it('distribui por margem e põe quem não vendeu na barra própria', () => {
    const def = faixasPadrao(L).find(d => d.id === 'margem_pct')!;
    const faixas = montarFaixas(todos, def);
    expect(faixas.find(f => f.rotulo === '0%–10%')!.produtos).toBe(0);
    expect(faixas.find(f => f.rotulo === '10%–20%')!.produtos).toBe(1);
    expect(faixas.find(f => f.rotulo === '≥ 50%')!.produtos).toBe(2);
    expect(faixas.find(f => f.semValor)!.produtos).toBe(1);
    expect(faixas.find(f => f.semValor)!.capital).toBe(500);
  });

  it('o filtro de faixa devolve exatamente os produtos da barra', () => {
    const r = aplicarFiltros(todos, { ...FILTROS_VAZIOS, faixa: { metrica: 'margem_pct', nomeMetrica: 'Margem', rotulo: '≥ 50%', min: 50, max: null } }, L);
    expect(r.map(p => p.id).sort()).toEqual([1, 3]);
    const sem = aplicarFiltros(todos, { ...FILTROS_VAZIOS, faixa: { metrica: 'margem_pct', nomeMetrica: 'Margem', rotulo: 'Sem venda', min: null, max: null, semValor: true } }, L);
    expect(sem.map(p => p.id)).toEqual([4]);
  });
});

describe('filtros e árvore', () => {
  it('parado = com saldo e sem venda além do limiar (ou nunca vendeu)', () => {
    expect(estaParado(morto, L)).toBe(true);
    expect(estaParado(nicho, L)).toBe(false);
    expect(aplicarFiltros(todos, { ...FILTROS_VAZIOS, situacao: 'parado' }, L).map(p => p.id)).toEqual([4]);
  });

  it('categoria filtra e a árvore fecha os totais por nível', () => {
    const mesa = aplicarFiltros(todos, { ...FILTROS_VAZIOS, categorias: ['bazar.mesa'] }, L);
    expect(mesa.map(p => p.id).sort()).toEqual([3, 4]);
    const arvore = montarArvore(todos, L);
    expect(arvore).toHaveLength(1);
    expect(arvore[0].agregado.capital_custo).toBe(1700);
    expect(arvore[0].filhos.map(c => c.nome).sort()).toEqual(['Cozinha', 'Mesa']);
    const copo = arvore[0].filhos.find(c => c.nome === 'Mesa')!.filhos[0];
    expect(copo.filhos.map(n => n.produto!.id).sort()).toEqual([3, 4]);
  });

  it('busca ignora acento e caixa', () => {
    const r = aplicarFiltros([{ ...estrela, nome: 'Café Pilão' }, margemBaixa], { ...FILTROS_VAZIOS, busca: 'cafe pilao' }, L);
    expect(r.map(p => p.id)).toEqual([1]);
  });
});

describe('correlações', () => {
  it('capital × faturamento aponta a categoria que prende capital', () => {
    const linhas = capitalVsReceita(todos);
    const mesa = linhas.find(l => l.chave === 'bazar.mesa')!;
    expect(mesa.capital_pct).toBeCloseTo((1500 / 1700) * 100, 5);
    expect(mesa.eficiencia!).toBeLessThan(0.1);
  });

  it('Pareto acumula até 100% do faturamento', () => {
    const curva = curvaPareto(todos);
    expect(curva).toHaveLength(3);
    expect(curva[curva.length - 1].pct_receita).toBeCloseTo(100, 5);
    expect(curva[0].receita).toBe(1000);
  });
});
