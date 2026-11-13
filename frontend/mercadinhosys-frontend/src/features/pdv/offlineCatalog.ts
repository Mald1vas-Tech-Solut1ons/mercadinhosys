import { db } from '../../lib/db';
import type { DoseOferta } from './utils/dosesPdv';

export interface ProdutoCatalogo {
  id: number;
  nome: string;
  codigo_barras: string | null;
  codigo_interno: string | null;
  preco_venda: number;
  quantidade: number;        // estoque/disponibilidade no momento do último sync
  unidade_medida: string;
  // Venda por dose (só em bebida que vende por dose): o caixa serve doses mesmo sem sinal.
  vende_por_dose?: boolean;
  volume_embalagem_ml?: number;
  doses?: DoseOferta[];
  saldo_aberto_ml?: number;
}

const LS_LAST_SYNC = 'catalogo_offline_last_sync';

/** Substitui todo o catálogo cacheado pelo recebido do servidor. */
export async function salvarCatalogo(produtos: ProdutoCatalogo[]): Promise<void> {
  await db.transaction('rw', db.produtos, async () => {
    await db.produtos.clear();
    await db.produtos.bulkAdd(produtos);
  });
  try { localStorage.setItem(LS_LAST_SYNC, new Date().toISOString()); } catch { /* ignore */ }
}

export async function lerCatalogo(): Promise<ProdutoCatalogo[]> {
  return await db.produtos.toArray();
}

/** Produtos do catálogo salvo que vendem por dose (cardápio de doses sem internet). */
export async function listarComDoses(): Promise<ProdutoCatalogo[]> {
  const todos = await db.produtos.toArray();
  return todos.filter(p => p.vende_por_dose && (p.doses || []).length > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function contarCatalogo(): Promise<number> {
  return await db.produtos.count();
}

/** Busca offline por nome, código de barras ou código interno. */
export async function buscarOffline(termo: string, limite = 20): Promise<ProdutoCatalogo[]> {
  const t = (termo || '').trim().toLowerCase();
  if (!t) return [];
  
  // EAN exato primeiro (scanner)
  const exato = await db.produtos.where('codigo_barras').equals(termo.trim()).toArray();
  if (exato.length) return exato.slice(0, limite);
  
  // Como o Dexie não tem "includes" nativo de forma eficiente em index (precisa de regex/filter),
  // e o catálogo não costuma ter milhões de itens (são alguns milhares), podemos fazer em memória.
  const todos = await db.produtos.toArray();
  return todos
    .filter((p: ProdutoCatalogo) =>
      p.nome.toLowerCase().includes(t) ||
      (p.codigo_barras || '').toLowerCase().includes(t) ||
      (p.codigo_interno || '').toLowerCase().includes(t)
    )
    .slice(0, limite);
}

export function ultimoSyncCatalogo(): string | null {
  try { return localStorage.getItem(LS_LAST_SYNC); } catch { return null; }
}
