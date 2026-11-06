/**
 * Contas do BI sobre o fato por produto. Funções puras: a mesma conta alimenta
 * KPI, gráfico, faixa e tabela, então nenhum número diverge entre blocos.
 */
import type { FiltrosBI, ProdutoBI } from './biTypes';
import type { LimiaresBI } from './biConfig';

// ------------------------------------------------------------------ agregação
export interface Agregado {
  produtos: number;
  receita: number;
  custo: number;
  margem: number;
  margem_pct: number | null;
  qtd: number;
  vendas: number;
  receita_anterior: number;
  variacao_pct: number | null;
  estoque: number;
  capital_custo: number;
  capital_venda: number;
  margem_potencial_pct: number | null;
  vmd: number;
  cobertura_dias: number | null;
  gmroi: number | null;
  dias_sem_venda: number | null;
  rupturas: number;
  parados: number;
  custo_estimado: number;
}

export function agregar(lista: ProdutoBI[], limiares?: LimiaresBI): Agregado {
  const a: Agregado = {
    produtos: lista.length, receita: 0, custo: 0, margem: 0, margem_pct: null, qtd: 0, vendas: 0,
    receita_anterior: 0, variacao_pct: null, estoque: 0, capital_custo: 0, capital_venda: 0,
    margem_potencial_pct: null, vmd: 0, cobertura_dias: null, gmroi: null, dias_sem_venda: null,
    rupturas: 0, parados: 0, custo_estimado: 0,
  };
  let menorSemVenda: number | null = null;
  for (const p of lista) {
    a.receita += p.receita;
    a.custo += p.custo;
    a.qtd += p.qtd;
    a.vendas += p.vendas;
    a.receita_anterior += p.receita_anterior;
    a.estoque += Math.max(p.estoque, 0);
    a.capital_custo += p.capital_custo;
    a.capital_venda += p.capital_venda;
    a.vmd += p.vmd;
    if (p.ruptura) a.rupturas += 1;
    if (p.custo_estimado) a.custo_estimado += 1;
    if (limiares && estaParado(p, limiares)) a.parados += 1;
    if (p.dias_sem_venda !== null) menorSemVenda = menorSemVenda === null ? p.dias_sem_venda : Math.min(menorSemVenda, p.dias_sem_venda);
  }
  a.margem = a.receita - a.custo;
  a.margem_pct = a.receita ? (a.margem / a.receita) * 100 : null;
  a.variacao_pct = a.receita_anterior ? ((a.receita - a.receita_anterior) / a.receita_anterior) * 100 : null;
  a.margem_potencial_pct = a.capital_venda ? ((a.capital_venda - a.capital_custo) / a.capital_venda) * 100 : null;
  a.cobertura_dias = a.vmd > 0 ? a.estoque / a.vmd : null;
  a.gmroi = a.capital_custo > 0 ? a.margem / a.capital_custo : null;
  a.dias_sem_venda = menorSemVenda;
  return a;
}

export function estaParado(p: ProdutoBI, l: LimiaresBI): boolean {
  if (p.servico || p.estoque <= 0) return false;
  return p.nunca_vendeu || (p.dias_sem_venda ?? 0) >= l.dias_parado;
}

// ------------------------------------------------------------------ giro × margem
export type Quadrante = 'estrela' | 'giro_margem_baixa' | 'nicho' | 'peso_morto' | 'sem_dado';

export const QUADRANTES: Record<Exclude<Quadrante, 'sem_dado'>, { nome: string; acao: string; cor: string }> = {
  estrela: { nome: 'Estrela', acao: 'Gira e lucra: nunca deixe faltar', cor: '#059669' },
  giro_margem_baixa: { nome: 'Gira com margem baixa', acao: 'Puxa fluxo: reveja custo ou preço', cor: '#2563eb' },
  nicho: { nome: 'Nicho', acao: 'Lucra mas gira pouco: compre menos, exponha melhor', cor: '#d97706' },
  peso_morto: { nome: 'Peso morto', acao: 'Prende capital: liquidar ou parar de comprar', cor: '#dc2626' },
};

/** Giro do período: custo do que saiu ÷ capital a custo hoje. */
export function giro(p: ProdutoBI): number | null {
  if (p.custo > 0 && p.capital_custo <= 0) return null; // vendeu tudo: giro indefinido (alto)
  if (p.capital_custo <= 0) return null;
  return p.custo / p.capital_custo;
}

export function medianaGiro(lista: ProdutoBI[]): number {
  const valores = lista.map(giro).filter((g): g is number => g !== null && g > 0).sort((x, y) => x - y);
  if (!valores.length) return 0;
  const meio = Math.floor(valores.length / 2);
  return valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
}

export function quadrante(p: ProdutoBI, corteGiro: number, l: LimiaresBI): Quadrante {
  if (p.servico) return 'sem_dado';
  const g = giro(p);
  const giroAlto = g === null ? p.receita > 0 : g >= corteGiro;
  if (p.receita <= 0) return p.capital_custo > 0 ? 'peso_morto' : 'sem_dado';
  const margemBoa = (p.margem_pct ?? 0) >= l.margem_minima;
  if (giroAlto) return margemBoa ? 'estrela' : 'giro_margem_baixa';
  return margemBoa ? 'nicho' : 'peso_morto';
}

// ------------------------------------------------------------------ faixas
export interface FaixaDef {
  id: string;
  nome: string;
  unidade: string;
  valor: (p: ProdutoBI) => number | null;
  cortes: number[];
  /** Produtos sem valor (ex.: nunca vendeu) entram numa barra própria com este rótulo. */
  rotuloSemValor?: string;
}

export function faixasPadrao(l: LimiaresBI): FaixaDef[] {
  return [
    { id: 'margem_pct', nome: 'Margem realizada', unidade: '%', valor: p => p.margem_pct, cortes: [0, 10, l.margem_minima, 35, 50], rotuloSemValor: 'Sem venda' },
    { id: 'margem_potencial_pct', nome: 'Margem potencial do estoque', unidade: '%', valor: p => (p.capital_custo > 0 ? p.margem_potencial_pct : null), cortes: [0, 10, l.margem_minima, 35, 50] },
    { id: 'dias_sem_venda', nome: 'Dias sem venda', unidade: 'd', valor: p => (p.servico ? null : p.dias_sem_venda), cortes: [7, 30, l.dias_parado, 90, 180], rotuloSemValor: 'Nunca vendeu' },
    { id: 'cobertura_dias', nome: 'Cobertura de estoque', unidade: 'd', valor: p => p.cobertura_dias, cortes: [7, 15, l.cobertura_alvo, 60, 120] },
    { id: 'preco_venda', nome: 'Preço de venda', unidade: 'R$', valor: p => p.preco_venda, cortes: [5, 10, 20, 50, 100, 200] },
    { id: 'validade_dias', nome: 'Validade', unidade: 'd', valor: p => (p.estoque > 0 ? p.validade_dias : null), cortes: [0, 15, l.validade_critica, 60, 90] },
  ];
}

export interface Faixa { rotulo: string; min: number | null; max: number | null; produtos: number; capital: number; receita: number; semValor?: boolean }

function fmtCorte(v: number, unidade: string) {
  if (unidade === 'R$') return `R$ ${v}`;
  return `${v}${unidade === '%' ? '%' : 'd'}`;
}

export function montarFaixas(lista: ProdutoBI[], def: FaixaDef): Faixa[] {
  const cortes = Array.from(new Set(def.cortes)).sort((a, b) => a - b);
  const faixas: Faixa[] = [];
  faixas.push({ rotulo: `< ${fmtCorte(cortes[0], def.unidade)}`, min: null, max: cortes[0], produtos: 0, capital: 0, receita: 0 });
  for (let i = 0; i < cortes.length - 1; i += 1) {
    faixas.push({ rotulo: `${fmtCorte(cortes[i], def.unidade)}–${fmtCorte(cortes[i + 1], def.unidade)}`, min: cortes[i], max: cortes[i + 1], produtos: 0, capital: 0, receita: 0 });
  }
  faixas.push({ rotulo: `≥ ${fmtCorte(cortes[cortes.length - 1], def.unidade)}`, min: cortes[cortes.length - 1], max: null, produtos: 0, capital: 0, receita: 0 });
  const semValor: Faixa = { rotulo: def.rotuloSemValor || 'Sem dado', min: null, max: null, produtos: 0, capital: 0, receita: 0, semValor: true };

  for (const p of lista) {
    const v = def.valor(p);
    if (v === null || Number.isNaN(v)) {
      if (def.rotuloSemValor && !p.servico) {
        semValor.produtos += 1; semValor.capital += p.capital_custo; semValor.receita += p.receita;
      }
      continue;
    }
    const alvo = faixas.find(f => (f.min === null || v >= f.min) && (f.max === null || v < f.max));
    if (alvo) { alvo.produtos += 1; alvo.capital += p.capital_custo; alvo.receita += p.receita; }
  }
  return def.rotuloSemValor ? [...faixas, semValor] : faixas;
}

export function dentroDaFaixa(p: ProdutoBI, def: FaixaDef, f: { min: number | null; max: number | null; semValor?: boolean }): boolean {
  const v = def.valor(p);
  if (f.semValor) return (v === null || Number.isNaN(v)) && !p.servico;
  if (v === null || Number.isNaN(v)) return false;
  return (f.min === null || v >= f.min) && (f.max === null || v < f.max);
}

// ------------------------------------------------------------------ filtros
function semAcento(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function aplicarFiltros(lista: ProdutoBI[], f: FiltrosBI, l: LimiaresBI, ignorar: { faixa?: boolean; quadrante?: boolean } = {}): ProdutoBI[] {
  const termo = semAcento(f.busca.trim());
  const corteGiro = f.quadrante && !ignorar.quadrante ? medianaGiro(lista) : 0;
  const faixaDef = f.faixa && !ignorar.faixa ? faixasPadrao(l).find(d => d.id === f.faixa!.metrica) : undefined;
  return lista.filter(p => {
    if (f.familias.length && !f.familias.includes(p.familia_key)) return false;
    if (f.categorias.length && !f.categorias.includes(p.categoria_key)) return false;
    if (f.subcategorias.length && !f.subcategorias.includes(p.subcategoria_key)) return false;
    if (f.fornecedores.length && !f.fornecedores.includes(p.fornecedor || '—')) return false;
    if (f.marcas.length && !f.marcas.includes(p.marca || '—')) return false;
    if (f.abc.length && !f.abc.includes(p.abc || '—')) return false;
    if (f.xyz.length && !f.xyz.includes(p.xyz || '—')) return false;
    switch (f.situacao) {
      case 'com_saldo': if (p.estoque <= 0) return false; break;
      case 'ruptura': if (!p.ruptura) return false; break;
      case 'abaixo_minimo': if (!p.abaixo_minimo) return false; break;
      case 'parado': if (!estaParado(p, l)) return false; break;
      case 'vencendo': if (p.validade_dias === null || p.validade_dias > l.validade_critica || p.estoque <= 0) return false; break;
      default: break;
    }
    if (faixaDef && f.faixa && !dentroDaFaixa(p, faixaDef, f.faixa)) return false;
    if (f.quadrante && !ignorar.quadrante && quadrante(p, corteGiro, l) !== f.quadrante) return false;
    if (termo) {
      const alvo = semAcento(`${p.nome} ${p.ean || ''} ${p.marca || ''} ${p.fornecedor || ''} ${p.categoria} ${p.subcategoria}`);
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

// ------------------------------------------------------------------ árvore
export type Nivel = 'familia' | 'categoria' | 'subcategoria' | 'produto';

export interface No {
  chave: string;
  nivel: Nivel;
  nome: string;
  detalhe?: string;
  agregado: Agregado;
  produto?: ProdutoBI;
  filhos: No[];
}

export function montarArvore(lista: ProdutoBI[], l: LimiaresBI): No[] {
  const porFamilia = new Map<string, ProdutoBI[]>();
  for (const p of lista) {
    const k = p.familia_key;
    if (!porFamilia.has(k)) porFamilia.set(k, []);
    porFamilia.get(k)!.push(p);
  }
  const agrupar = (itens: ProdutoBI[], chave: (p: ProdutoBI) => string) => {
    const m = new Map<string, ProdutoBI[]>();
    for (const p of itens) { const k = chave(p); if (!m.has(k)) m.set(k, []); m.get(k)!.push(p); }
    return m;
  };
  const familias: No[] = [];
  for (const [fk, itensF] of porFamilia) {
    const categorias: No[] = [];
    for (const [ck, itensC] of agrupar(itensF, p => p.categoria_key)) {
      const subs: No[] = [];
      for (const [sk, itensS] of agrupar(itensC, p => p.subcategoria_key)) {
        subs.push({
          chave: `s:${fk}|${ck}|${sk}`, nivel: 'subcategoria', nome: itensS[0].subcategoria, agregado: agregar(itensS, l),
          filhos: itensS.map(p => ({
            chave: `p:${p.id}`, nivel: 'produto' as Nivel, nome: p.nome,
            detalhe: [p.marca, p.ean].filter(Boolean).join(' · ') || undefined,
            agregado: agregar([p], l), produto: p, filhos: [],
          })),
        });
      }
      categorias.push({ chave: `c:${fk}|${ck}`, nivel: 'categoria', nome: itensC[0].categoria, agregado: agregar(itensC, l), filhos: subs });
    }
    familias.push({ chave: `f:${fk}`, nivel: 'familia', nome: itensF[0].familia, agregado: agregar(itensF, l), filhos: categorias });
  }
  return familias;
}

// ------------------------------------------------------------------ correlações
export interface CapitalReceita { chave: string; nome: string; capital_pct: number; receita_pct: number; eficiencia: number | null; capital: number; receita: number }

export function capitalVsReceita(lista: ProdutoBI[]): CapitalReceita[] {
  const total = agregar(lista);
  const m = new Map<string, ProdutoBI[]>();
  for (const p of lista) { if (!m.has(p.categoria_key)) m.set(p.categoria_key, []); m.get(p.categoria_key)!.push(p); }
  return [...m.entries()].map(([k, itens]) => {
    const a = agregar(itens);
    const capital_pct = total.capital_custo ? (a.capital_custo / total.capital_custo) * 100 : 0;
    const receita_pct = total.receita ? (a.receita / total.receita) * 100 : 0;
    return {
      chave: k, nome: itens[0].categoria, capital: a.capital_custo, receita: a.receita, capital_pct, receita_pct,
      eficiencia: capital_pct > 0 ? receita_pct / capital_pct : null,
    };
  }).sort((x, y) => y.capital_pct + y.receita_pct - (x.capital_pct + x.receita_pct));
}

export function curvaPareto(lista: ProdutoBI[]) {
  const vendidos = lista.filter(p => p.receita > 0).sort((a, b) => b.receita - a.receita);
  const total = vendidos.reduce((s, p) => s + p.receita, 0);
  let acc = 0;
  return vendidos.map((p, i) => {
    acc += p.receita;
    return { posicao: i + 1, pct_produtos: ((i + 1) / vendidos.length) * 100, pct_receita: total ? (acc / total) * 100 : 0, nome: p.nome, receita: p.receita };
  });
}

// ------------------------------------------------------------------ formatação
// Formatadores tolerantes: um campo ausente vira "—" em vez de derrubar a tela inteira.
const vazio = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || Number.isNaN(v);
export const fmtBRL = (v: number | null | undefined) => (vazio(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtBRLCurto = (v: number | null | undefined) => {
  if (vazio(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 10_000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return fmtBRL(v);
};
export const fmtNum = (v: number | null | undefined, casas = 0) => (vazio(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));
export const fmtPct = (v: number | null | undefined, casas = 1) => (vazio(v) ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
