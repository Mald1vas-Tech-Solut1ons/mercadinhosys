/**
 * Configuração do BI: o usuário decide o que ver.
 *
 * Modo (essencial/avançado), blocos visíveis e ordem, colunas da tabela-mestra,
 * limiares da loja (margem mínima, dias parado, cobertura-alvo, validade crítica)
 * e visões salvas. Fica no navegador do usuário (localStorage), com leitura e
 * escrita protegidas: sem storage, o painel abre no padrão.
 */

export type ModoBI = 'essencial' | 'avancado';

export type BlocoId =
  | 'kpis' | 'acoes' | 'arvore' | 'treemap' | 'capital_receita'
  | 'faixas' | 'matriz' | 'pareto' | 'heatmap' | 'cesta';

export interface BlocoDef { id: BlocoId; nome: string; descricao: string; avancado: boolean }

export const BLOCOS: BlocoDef[] = [
  { id: 'kpis', nome: 'Indicadores', descricao: 'Faturamento, margem, capital, GMROI, cobertura e ruptura do recorte', avancado: false },
  { id: 'acoes', nome: 'Onde agir', descricao: 'Ruptura em curva A, capital parado, validade crítica e margem abaixo do mínimo', avancado: false },
  { id: 'arvore', nome: 'Tabela-mestra', descricao: 'Família › Categoria › Subcategoria › Produto com colunas escolhidas', avancado: false },
  { id: 'treemap', nome: 'Mapa do capital', descricao: 'Onde está o dinheiro do estoque, por categoria e subcategoria', avancado: false },
  { id: 'capital_receita', nome: 'Capital × Faturamento', descricao: 'Quem prende capital sem devolver venda', avancado: false },
  { id: 'faixas', nome: 'Faixas', descricao: 'Histogramas de margem, dias sem venda, cobertura, preço e validade — clique abre os produtos', avancado: true },
  { id: 'matriz', nome: 'Matriz Giro × Margem', descricao: 'Estrela, giro com margem baixa, nicho e peso morto', avancado: true },
  { id: 'pareto', nome: 'Curva ABC (Pareto)', descricao: 'Quantos produtos fazem 80% do faturamento', avancado: true },
  { id: 'heatmap', nome: 'Mapa de calor', descricao: 'Categoria × hora e × dia da semana', avancado: true },
  { id: 'cesta', nome: 'Cesta de compras', descricao: 'Produtos que saem juntos (lift)', avancado: true },
];

export type ColunaId =
  | 'receita' | 'participacao' | 'margem' | 'margem_pct' | 'qtd' | 'variacao_pct'
  | 'capital_custo' | 'capital_venda' | 'participacao_capital' | 'margem_potencial_pct'
  | 'estoque' | 'cobertura_dias' | 'dias_sem_venda' | 'gmroi' | 'vmd'
  | 'abc' | 'xyz' | 'validade_dias' | 'produtos' | 'fornecedor' | 'marca';

export interface ColunaDef { id: ColunaId; nome: string; curto: string; avancado: boolean; dica: string }

export const COLUNAS: ColunaDef[] = [
  { id: 'produtos', nome: 'Nº de produtos', curto: 'Itens', avancado: false, dica: 'Produtos ativos no recorte' },
  { id: 'receita', nome: 'Faturamento', curto: 'Faturamento', avancado: false, dica: 'Soma do total dos itens vendidos no período (vendas finalizadas)' },
  { id: 'participacao', nome: 'Participação no faturamento', curto: '% fat.', avancado: false, dica: 'Faturamento da linha ÷ faturamento do recorte' },
  { id: 'margem', nome: 'Margem bruta R$', curto: 'Margem', avancado: false, dica: 'Faturamento − custo do item no momento da venda' },
  { id: 'margem_pct', nome: 'Margem bruta %', curto: 'Mg %', avancado: false, dica: 'Margem ÷ faturamento' },
  { id: 'qtd', nome: 'Quantidade vendida', curto: 'Qtd', avancado: false, dica: 'Unidades vendidas no período' },
  { id: 'variacao_pct', nome: 'Δ vs período anterior', curto: 'Δ ant.', avancado: false, dica: 'Faturamento contra o período anterior de mesmo tamanho' },
  { id: 'estoque', nome: 'Estoque (un.)', curto: 'Estoque', avancado: false, dica: 'Saldo atual em unidades' },
  { id: 'capital_custo', nome: 'Capital a custo', curto: 'Capital', avancado: false, dica: 'Estoque × preço de custo' },
  { id: 'capital_venda', nome: 'Capital a preço de venda', curto: 'Cap. venda', avancado: true, dica: 'Estoque × preço de venda' },
  { id: 'participacao_capital', nome: '% do capital', curto: '% cap.', avancado: false, dica: 'Capital da linha ÷ capital do recorte' },
  { id: 'margem_potencial_pct', nome: 'Margem potencial %', curto: 'Mg pot.', avancado: true, dica: 'Pelo preço de tabela do estoque: (venda − custo) ÷ venda' },
  { id: 'cobertura_dias', nome: 'Cobertura (dias)', curto: 'Cobertura', avancado: false, dica: 'Estoque ÷ venda média diária do período' },
  { id: 'dias_sem_venda', nome: 'Dias sem venda', curto: 'Sem venda', avancado: false, dica: 'Dias desde a última venda finalizada' },
  { id: 'gmroi', nome: 'GMROI do período', curto: 'GMROI', avancado: true, dica: 'Margem do período ÷ capital a custo: quanto cada R$ 1 parado devolveu' },
  { id: 'vmd', nome: 'Venda média diária', curto: 'VMD', avancado: true, dica: 'Quantidade vendida ÷ dias do período' },
  { id: 'abc', nome: 'Curva ABC', curto: 'ABC', avancado: false, dica: 'A = até 80% do faturamento da loja, B até 95%, C o resto' },
  { id: 'xyz', nome: 'Regularidade (XYZ)', curto: 'XYZ', avancado: true, dica: 'X = venda regular (CV < 0,5), Y = oscila, Z = esporádica (CV ≥ 1)' },
  { id: 'validade_dias', nome: 'Validade (dias)', curto: 'Validade', avancado: true, dica: 'Dias até o vencimento cadastrado' },
  { id: 'fornecedor', nome: 'Fornecedor', curto: 'Fornecedor', avancado: true, dica: 'Fornecedor principal do produto' },
  { id: 'marca', nome: 'Marca', curto: 'Marca', avancado: true, dica: 'Marca cadastrada' },
];

export interface LimiaresBI {
  margem_minima: number;
  dias_parado: number;
  cobertura_alvo: number;
  validade_critica: number;
}

export interface VisaoBI {
  nome: string;
  modo: ModoBI;
  blocos: BlocoId[];
  colunas: ColunaId[];
}

export interface ConfigBI {
  modo: ModoBI;
  blocos: BlocoId[];
  colunas: ColunaId[];
  limiares: LimiaresBI;
  visoes: VisaoBI[];
  densidade: 'confortavel' | 'compacta';
}

const BLOCOS_ESSENCIAL: BlocoId[] = ['kpis', 'acoes', 'treemap', 'capital_receita', 'arvore'];
const BLOCOS_AVANCADO: BlocoId[] = ['kpis', 'acoes', 'faixas', 'matriz', 'treemap', 'capital_receita', 'pareto', 'heatmap', 'cesta', 'arvore'];
const COLUNAS_ESSENCIAL: ColunaId[] = ['produtos', 'receita', 'participacao', 'margem', 'margem_pct', 'variacao_pct', 'capital_custo', 'participacao_capital', 'cobertura_dias', 'dias_sem_venda'];
const COLUNAS_AVANCADO: ColunaId[] = ['produtos', 'receita', 'participacao', 'margem', 'margem_pct', 'qtd', 'variacao_pct', 'estoque', 'capital_custo', 'participacao_capital', 'margem_potencial_pct', 'cobertura_dias', 'dias_sem_venda', 'gmroi', 'abc', 'xyz'];

export const VISOES_PRONTAS: VisaoBI[] = [
  { nome: 'Visão geral', modo: 'essencial', blocos: BLOCOS_ESSENCIAL, colunas: COLUNAS_ESSENCIAL },
  { nome: 'Análise completa', modo: 'avancado', blocos: BLOCOS_AVANCADO, colunas: COLUNAS_AVANCADO },
  { nome: 'Capital parado', modo: 'avancado', blocos: ['kpis', 'faixas', 'treemap', 'capital_receita', 'arvore'],
    colunas: ['produtos', 'capital_custo', 'participacao_capital', 'estoque', 'cobertura_dias', 'dias_sem_venda', 'receita', 'gmroi', 'abc'] },
  { nome: 'Margem e preço', modo: 'avancado', blocos: ['kpis', 'faixas', 'matriz', 'arvore'],
    colunas: ['produtos', 'receita', 'margem', 'margem_pct', 'margem_potencial_pct', 'qtd', 'variacao_pct', 'abc', 'xyz'] },
  { nome: 'Comportamento de compra', modo: 'avancado', blocos: ['kpis', 'heatmap', 'cesta', 'pareto', 'arvore'],
    colunas: ['produtos', 'receita', 'participacao', 'qtd', 'vmd', 'xyz', 'abc', 'variacao_pct'] },
];

export const CONFIG_PADRAO: ConfigBI = {
  modo: 'avancado',
  blocos: BLOCOS_AVANCADO,
  colunas: COLUNAS_AVANCADO,
  limiares: { margem_minima: 20, dias_parado: 60, cobertura_alvo: 30, validade_critica: 30 },
  visoes: [],
  densidade: 'confortavel',
};

const CHAVE = 'mercadinhosys_bi_config_v1';

export function lerConfig(): ConfigBI {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return CONFIG_PADRAO;
    const salvo = JSON.parse(bruto) as Partial<ConfigBI>;
    const blocosValidos = new Set(BLOCOS.map(b => b.id));
    const colunasValidas = new Set(COLUNAS.map(c => c.id));
    return {
      ...CONFIG_PADRAO,
      ...salvo,
      blocos: (salvo.blocos || CONFIG_PADRAO.blocos).filter(b => blocosValidos.has(b)),
      colunas: (salvo.colunas || CONFIG_PADRAO.colunas).filter(c => colunasValidas.has(c)),
      limiares: { ...CONFIG_PADRAO.limiares, ...(salvo.limiares || {}) },
      visoes: Array.isArray(salvo.visoes) ? salvo.visoes : [],
    };
  } catch {
    return CONFIG_PADRAO;
  }
}

export function salvarConfig(config: ConfigBI) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(config));
  } catch {
    /* navegador sem storage: a configuração vale só nesta sessão */
  }
}

/** Blocos e colunas que o modo permite (o essencial esconde os avançados). */
export function blocosDoModo(config: ConfigBI): BlocoId[] {
  const avancado = new Set(BLOCOS.filter(b => b.avancado).map(b => b.id));
  return config.modo === 'avancado' ? config.blocos : config.blocos.filter(b => !avancado.has(b));
}

export function colunasDoModo(config: ConfigBI): ColunaId[] {
  const avancado = new Set(COLUNAS.filter(c => c.avancado).map(c => c.id));
  return config.modo === 'avancado' ? config.colunas : config.colunas.filter(c => !avancado.has(c));
}
