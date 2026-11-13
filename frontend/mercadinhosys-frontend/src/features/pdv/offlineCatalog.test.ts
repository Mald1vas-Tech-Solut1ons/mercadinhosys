import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../lib/db'
import {
  buscarOffline,
  listarComDoses,
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

describe('offlineCatalog — doses', () => {
  beforeEach(async () => {
    await db.produtos.clear()
  })

  it('guarda as doses do servidor e lista só quem vende por dose, em ordem alfabética', async () => {
    const dose = { id: 1, nome: 'Dose', volume_ml: 50, preco_venda: 18, padrao: true }
    await salvarCatalogo([
      { ...p(1, 'WHISKY'), vende_por_dose: true, volume_embalagem_ml: 1000, doses: [dose], saldo_aberto_ml: 300 },
      p(2, 'Arroz'),
      { ...p(3, 'GIN'), vende_por_dose: true, volume_embalagem_ml: 750, doses: [dose] },
      { ...p(4, 'VODKA sem dose ativa'), vende_por_dose: true, volume_embalagem_ml: 1000, doses: [] },
    ])
    const lista = await listarComDoses()
    expect(lista.map(x => x.nome)).toEqual(['GIN', 'WHISKY'])
    expect(lista[1].doses?.[0].volume_ml).toBe(50)
    expect(lista[1].saldo_aberto_ml).toBe(300)
    // a busca offline devolve os campos de dose junto, para o caixa servir sem sinal
    const achado = await buscarOffline('whisky')
    expect(achado[0].vende_por_dose).toBe(true)
  })
})
