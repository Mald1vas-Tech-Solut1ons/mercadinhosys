import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../lib/db'
import {
  codigoOffline,
  listarCuponsLocais,
  removerCupomLocal,
  salvarCabecalhoCupom,
  salvarCupomLocal,
  vincularCupomSincronizado,
  type DadosCupomVenda,
} from './cupomLocal'

const venda = (uuid: string, extra: Partial<DadosCupomVenda> = {}): DadosCupomVenda => ({
  uuid,
  offline: true,
  itens: [{ nome: 'Arroz 5kg', codigo: '789', quantidade: 2, precoUnitario: 25, total: 50 }],
  subtotal: 50,
  desconto: 0,
  total: 50,
  pagamentos: [{ forma: 'dinheiro', valor: 60 }],
  valorRecebido: 60,
  troco: 10,
  cliente: null,
  operador: 'Caixa 1',
  ...extra,
})

describe('cupomLocal', () => {
  beforeEach(async () => {
    await db.cupons.clear()
    localStorage.clear()
    localStorage.setItem('current_estabelecimento_id', '10')
  })

  it('venda offline gera cupom completo com cabeçalho da loja guardado', async () => {
    salvarCabecalhoCupom({ nome_fantasia: 'Mercado da Vera', cnpj: '00.000.000/0001-00' })
    const uuid = 'abcdef12-0000-4000-8000-000000000000'
    const c = await salvarCupomLocal(venda(uuid))
    expect(c.codigo).toBe(codigoOffline(uuid))
    expect(c.codigo).toBe('OFF-ABCDEF12')
    expect(c.dados.estabelecimento?.nome_fantasia).toBe('Mercado da Vera')
    expect(c.dados.comprovante.cliente).toBe('Consumidor Final')
    expect(c.dados.comprovante.itens[0]).toMatchObject({ nome: 'Arroz 5kg', quantidade: 2, preco_unitario: 25, total: 50 })
    expect(c.dados.comprovante.troco).toBe(10)
    expect(c.dados.venda.id).toBe(0)
  })

  it('várias formas de pagamento viram uma linha só, sem repetir', async () => {
    const c = await salvarCupomLocal(venda('u-1', {
      pagamentos: [{ forma: 'dinheiro', valor: 10 }, { forma: 'pix', valor: 40 }, { forma: 'pix', valor: 0 }],
    }))
    expect(c.dados.comprovante.forma_pagamento).toBe('dinheiro/pix')
  })

  it('sincronizou: cupom passa a ter id e código do servidor', async () => {
    await salvarCupomLocal(venda('u-2'))
    await vincularCupomSincronizado('u-2', { id: 991, codigo: 'V-000991' })
    const [c] = await listarCuponsLocais()
    expect(c).toMatchObject({ venda_id: 991, codigo: 'V-000991', offline: false })
    expect(c.dados.venda).toMatchObject({ id: 991, codigo: 'V-000991' })
  })

  it('lista só os cupons da loja logada, mais recentes primeiro', async () => {
    await salvarCupomLocal(venda('loja10-a', { offline: false, vendaId: 1, codigo: 'V-1' }))
    await new Promise(r => setTimeout(r, 5))
    await salvarCupomLocal(venda('loja10-b', { offline: false, vendaId: 2, codigo: 'V-2' }))
    localStorage.setItem('current_estabelecimento_id', '11')
    await salvarCupomLocal(venda('loja11', { offline: false, vendaId: 3, codigo: 'V-3' }))
    expect((await listarCuponsLocais()).map(c => c.codigo)).toEqual(['V-3'])
    localStorage.setItem('current_estabelecimento_id', '10')
    expect((await listarCuponsLocais()).map(c => c.codigo)).toEqual(['V-2', 'V-1'])
  })

  it('poda cupons antigos mas nunca a venda offline ainda não sincronizada', async () => {
    const velho = new Date(Date.now() - 40 * 86_400_000).toISOString()
    await db.cupons.bulkPut([
      { id: 'velho-sync', estabelecimento_id: '10', codigo: 'V-9', criadoEm: velho, offline: false, total: 1, dados: {} as any },
      { id: 'velho-off', estabelecimento_id: '10', codigo: 'OFF-1', criadoEm: velho, offline: true, total: 1, dados: {} as any },
    ])
    await salvarCupomLocal(venda('novo'))
    const ids = (await db.cupons.toArray()).map(c => c.id).sort()
    expect(ids).toEqual(['novo', 'velho-off'])
  })

  it('descartar a venda offline remove o cupom', async () => {
    await salvarCupomLocal(venda('u-3'))
    await removerCupomLocal('u-3')
    expect(await listarCuponsLocais()).toEqual([])
  })
})
