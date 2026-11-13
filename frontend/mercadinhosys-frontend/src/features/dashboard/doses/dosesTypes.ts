/** Contrato de GET /dashboard/doses (backend: services/dose_metricas.py). */
export interface DoseResumo {
  doses: number;
  ml: number;
  receita: number;
  custo: number;
  margem: number;
  margem_pct: number | null;
  garrafas_equivalentes: number;
  perdas_custo: number;
  margem_liquida: number;
  garrafas_encerradas: number;
  rendimento_pct: number | null;
}

export interface DoseProdutoLinha {
  produto_id: number;
  produto: string;
  doses: number;
  ml: number;
  receita: number;
  custo: number;
  margem: number;
  margem_pct: number | null;
  garrafas_equivalentes: number;
  receita_por_garrafa: number | null;
  preco_garrafa: number | null;
  garrafas_fechadas_vendidas: number;
  rendimento_pct: number | null;
  garrafas_encerradas: number;
  desvio_ml: number;
  cobertura_dias: number | null;
  cobertura_doses: number | null;
}

export interface DosePerdaTipo { tipo: string; rotulo: string; ml: number; custo: number }

export interface DoseGarrafaAberta {
  id: number;
  produto_id: number;
  produto: string;
  saldo_ml: number;
  volume_inicial_ml: number;
  dias_aberta: number;
  valor_custo: number;
  vencida: boolean;
  velha: boolean;
}

export interface DoseAlerta {
  tipo: string;
  severidade: 'alta' | 'media' | 'baixa';
  titulo: string;
  descricao: string;
  acao: string;
  produto_id?: number;
}

export interface RespostaDoses {
  periodo: { inicio: string; fim: string; dias: number };
  resumo: DoseResumo;
  produtos: DoseProdutoLinha[];
  perdas: { total: number; por_tipo: DosePerdaTipo[] };
  abertas: { quantidade: number; saldo_ml: number; valor_custo: number; vencidas: number; itens: DoseGarrafaAberta[] };
  por_funcionario: { funcionario: string; ml: number; custo: number; tipos: Record<string, number> }[];
  pico_por_hora: { hora: number; doses: number; receita: number }[];
  alertas: DoseAlerta[];
  config: {
    margem_alvo_dose_pct: number | null;
    perda_esperada_pct: number | null;
    alerta_garrafa_aberta_dias: number | null;
    alerta_rendimento_pct: number | null;
  };
}

/** Quanto do rendimento esperado a loja entregou: 100% - perda esperada é o teto realista. */
export function rendimentoSaudavel(rendimentoPct: number | null, perdaEsperadaPct: number | null, minimo: number | null): 'ok' | 'baixo' | 'sem_dados' {
  if (rendimentoPct == null) return 'sem_dados';
  const limite = minimo ?? (perdaEsperadaPct != null ? 100 - perdaEsperadaPct - 5 : null);
  if (limite == null) return 'ok';
  return rendimentoPct < limite ? 'baixo' : 'ok';
}

export function horaDePico(horas: RespostaDoses['pico_por_hora']): number | null {
  if (!horas.length) return null;
  return horas.reduce((m, h) => (h.doses > m.doses ? h : m)).hora;
}
