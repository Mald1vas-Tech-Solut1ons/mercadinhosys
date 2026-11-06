import { apiClient } from '../../api/apiClient';

/**
 * Uma ida ao servidor para os alertas do painel.
 *
 * "Painel do Dia" e "Alertas Operacionais" montam juntos e pediam `/dashboard/alertas`
 * cada um — rota que carrega todos os produtos ativos. Aqui a mesma promessa serve os
 * dois enquanto estiver fresca (30 s); erro não fica guardado, a próxima tentativa refaz.
 */
const VALIDADE_MS = 30_000;
let emVoo: { em: number; promessa: Promise<{ alertas?: unknown[]; total?: number }> } | null = null;

export function buscarAlertasDashboard<T = unknown>(): Promise<{ alertas?: T[]; total?: number }> {
  if (!emVoo || Date.now() - emVoo.em > VALIDADE_MS) {
    const promessa = apiClient.get('/dashboard/alertas').then(r => r.data || {});
    promessa.catch(() => { if (emVoo?.promessa === promessa) emVoo = null; });
    emVoo = { em: Date.now(), promessa };
  }
  return emVoo.promessa as Promise<{ alertas?: T[]; total?: number }>;
}
