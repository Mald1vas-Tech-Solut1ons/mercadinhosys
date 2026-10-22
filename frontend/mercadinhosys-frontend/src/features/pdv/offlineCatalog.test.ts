import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../lib/db'
import {
  buscarOffline,
  contarCatalogo,
  lerCatalogo,
  salvarCatalogo,
  ultimoSyncCatalogo,
  type ProdutoCatalogo,
} from './offlineCatalog'

const p = (id: number, nome: string, ean: string | null = null, interno: string | null = null): ProdutoCatalogo => ({
  id, nome, codigo_barras: ean, codigo_interno: interno, preco_venda: 10, quantidade: 5, unidade_medida: 'UN',
})

describe('offlineCatalog', () => {
  beforeEach(async () => {
    await db.produtos.clear()
    localStorage.clear()
  })

  it('salvarCatalogo substitui o catálogo anterior e registra o último sync', async () => {
    await salvarCatalogo([p(1, 'Arroz')])
    await salvarCatalogo([p(2, 'Feijão'), p(3, 'Café')])
    expect(await contarCatalogo()).toBe(2)
    expect((await lerCatalogo()).map(x => x.id).sort()).toEqual([2, 3])
    expect(ultimoSyncCatalogo()).not.toBeNull()
  })

  it('buscarOffline: termo vazio retorna lista vazia', async () => {
    await salvarCatalogo([p(1, 'Arroz')])
    expect(await buscarOffline('   ')).toEqual([])
  })

  it('buscarOffline: EAN exato tem prioridade sobre busca por nome', async () => {
    await salvarCatalogo([p(1, 'Arroz 7891', '111'), p(2, 'Feijão', '7891')])
    const r = await buscarOffline('7891')
    expect(r.map(x => x.id)).toEqual([2])
  })

  it('buscarOffline: busca parcial por nome (case-insensitive) e código interno', async () => {
    await salvarCatalogo([p(1, 'Arroz Tio João'), p(2, 'Feijão', null, 'ABC-9')])
    expect((await buscarOffline('ARROZ')).map(x => x.id)).toEqual([1])
    expect((await buscarOffline('abc')).map(x => x.id)).toEqual([2])
  })

  it('buscarOffline respeita o limite', async () => {
    await salvarCatalogo(Array.from({ length: 30 }, (_, i) => p(i + 1, `Item ${i}`)))
    expect(await buscarOffline('item', 5)).toHaveLength(5)
  })
})
