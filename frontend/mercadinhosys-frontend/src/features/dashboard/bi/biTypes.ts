/** Contrato de GET /dashboard/bi — uma linha por produto, pronta para cruzar. */

export interface ProdutoBI {
  id: number;
  nome: string;
  ean: string | null;
  marca: string | null;
  fornecedor: string | null;
  familia_key: string;
  familia: string;
  categoria_key: string;
  categoria: string;
  subcategoria_key: string;
  subcategoria: string;
  servico: boolean;
  custo_estimado: boolean;
  estoque: number;
  estoque_minimo: number;
  preco_custo: number;
  preco_venda: number;
  receita: number;
  custo: number;
  margem: number;
  margem_pct: number | null;
  qtd: number;
  vendas: number;
  dias_com_venda: number;
  receita_anterior: number;
  variacao_pct: number | null;
  vmd: number;
  cobertura_dias: number | null;
  capital_custo: number;
  capital_venda: number;
  margem_potencial_pct: number | null;
  gmroi: number | null;
  dias_sem_venda: number | null;
  nunca_vendeu: boolean;
  validade_dias: number | null;
  cv: number | null;
  xyz: 'X' | 'Y' | 'Z' | null;
  abc: 'A' | 'B' | 'C' | null;
  ruptura: boolean;
  abaixo_minimo: boolean;
}

export interface RespostaBI {
  periodo: { inicio: string; fim: string; dias: number; anterior_inicio: string; anterior_fim: string };
  produtos: ProdutoBI[];
  temporal: {
    hora: { categoria_key: string; hora: number; receita: number }[];
    dia_semana: { categoria_key: string; dia: number; receita: number }[];
  };
  cesta: {
    vendas: number;
    pares: { a: number; b: number; vezes: number; suporte_pct: number; confianca_pct: number; lift: number }[];
  };
}

export type SituacaoEstoque = 'todos' | 'com_saldo' | 'ruptura' | 'abaixo_minimo' | 'parado' | 'vencendo';

export interface FiltrosBI {
  busca: string;
  familias: string[];
  categorias: string[];
  subcategorias: string[];
  fornecedores: string[];
  marcas: string[];
  abc: string[];
  xyz: string[];
  situacao: SituacaoEstoque;
  /** Faixa clicada num histograma: só os produtos dela. */
  faixa: { metrica: string; nomeMetrica: string; rotulo: string; min: number | null; max: number | null; semValor?: boolean } | null;
  /** Quadrante clicado na matriz giro × margem. */
  quadrante: string | null;
}

export const FILTROS_VAZIOS: FiltrosBI = {
  busca: '', familias: [], categorias: [], subcategorias: [], fornecedores: [], marcas: [],
  abc: [], xyz: [], situacao: 'todos', faixa: null, quadrante: null,
};
