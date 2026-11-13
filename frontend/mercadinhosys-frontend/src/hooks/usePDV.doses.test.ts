import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('../features/pdv/pdvService', () => ({
  pdvService: {
    getConfiguracoes: vi.fn(),
    getCaixaAtual: vi.fn(),
    finalizarVenda: vi.fn(),
    getResumoCaixa: vi.fn(),
  },
}))
vi.mock('../utils/toast', () => ({
  showToast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))

import { pdvService } from '../features/pdv/pdvService'
import { showToast } from '../utils/toast'
import { usePDV } from './usePDV'

const svc = pdvService as unknown as Record<string, ReturnType<typeof vi.fn>>

const config = (over: Record<string, unknown> = {}) => ({
  formas_pagamento: [], controlar_validade: true, dias_alerta_validade: 30, permitir_venda_sem_estoque: false,
  permite_venda_sem_cliente: true, funcionario: { role: 'CAIXA', limite_desconto: 10, pode_dar_desconto: true },
  ...over,
})

// Whisky de 1 L: 2 garrafas fechadas + 300 ml na aberta = 2300 ml servíveis.
const whisky = (extra: Record<string, unknown> = {}) => ({
  id: 7, nome: 'WHISKY 1L', preco_venda: 150, estoque_atual: 2, vende_por_dose: true, volume_embalagem_ml: 1000,
  saldo_aberto_ml: 300,
  doses: [
    { id: 1, nome: 'Dose', volume_ml: 50, preco_venda: 18, padrao: true },
    { id: 2, nome: 'Dupla', volume_ml: 100, preco_venda: 32, padrao: false },
  ],
  ...extra,
}) as any
const dose50 = { id: 1, nome: 'Dose', volumeMl: 50 }
const dupla = { id: 2, nome: 'Dupla', volumeMl: 100 }
const livre = (ml: number) => ({ id: null, nome: 'Dose livre', volumeMl: ml, livre: true })

async function setup(cfg = config()) {
  svc.getConfiguracoes.mockResolvedValue(cfg)
  svc.getCaixaAtual.mockResolvedValue({ id: 1 })
  const hook = renderHook(() => usePDV())
  await waitFor(() => expect(hook.result.current.configuracoes).not.toBeNull())
  return hook
}

describe('usePDV — linhas por dose', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Object.values(svc).forEach(f => f.mockReset())
    Object.values(showToast).forEach(f => (f as any).mockReset())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('garrafa, dose e dupla do mesmo produto são três linhas; a mesma dose soma quantidade', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(whisky(), 1) })
    act(() => { result.current.adicionarProduto(whisky(), 2, { dose: dose50, preco: 18 }) })
    act(() => { result.current.adicionarProduto(whisky(), 1, { dose: dupla, preco: 32 }) })
    act(() => { result.current.adicionarProduto(whisky(), 3, { dose: dose50, preco: 18 }) })
    expect(result.current.carrinho).toHaveLength(3)
    const porChave = Object.fromEntries(result.current.carrinho.map(i => [i.chave ?? String(i.produto.id), i]))
    expect(porChave['7'].quantidade).toBe(1)
    expect(porChave['7:d1'].quantidade).toBe(5)
    expect(porChave['7:d1'].precoUnitario).toBe(18)
    expect(porChave['7:d2'].dose?.nome).toBe('Dupla')
    expect(result.current.subtotal).toBe(150 + 5 * 18 + 32)
  })

  it('linha de produto comum continua sem chave (carrinho salvo antes das doses segue válido)', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto({ id: 1, nome: 'Arroz', preco_venda: 10, estoque_atual: 10 } as any, 1) })
    expect(result.current.carrinho[0].chave).toBeUndefined()
    expect(result.current.carrinho[0].dose).toBeUndefined()
  })

  it('o limite da dose é em ml: aberta + fechadas, descontando as outras linhas', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(whisky(), 100, { dose: dose50, preco: 18 }) })
    expect(result.current.carrinho[0].quantidade).toBe(46)               // 2300 ml / 50 ml
    expect(showToast.warning).not.toHaveBeenCalled()
    act(() => { result.current.adicionarProduto(whisky(), 1, { dose: dose50, preco: 18 }) })
    expect(result.current.carrinho[0].quantidade).toBe(46)
    expect(showToast.warning).toHaveBeenCalled()
    // sobrou ml para nada: a dupla também é recusada
    act(() => { result.current.adicionarProduto(whisky(), 1, { dose: dupla, preco: 32 }) })
    expect(result.current.carrinho).toHaveLength(1)
    expect(showToast.error).toHaveBeenCalled()
  })

  it('dose vendida reduz quantas garrafas inteiras ainda dá para vender', async () => {
    const { result } = await setup()
    // 1000 ml de dupla: 300 saem da aberta e 700 abrem 1 garrafa → sobra 1 fechada para vender inteira
    act(() => { result.current.adicionarProduto(whisky(), 10, { dose: dupla, preco: 32 }) })
    act(() => { result.current.adicionarProduto(whisky(), 5) })
    const inteira = result.current.carrinho.find(i => !i.dose)!
    expect(inteira.quantidade).toBe(1)
  })

  it('atualizarQuantidade usa a chave da linha e respeita o limite em ml', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(whisky(), 2, { dose: dose50, preco: 18 }) })
    act(() => { result.current.adicionarProduto(whisky(), 1) })
    act(() => { result.current.atualizarQuantidade('7:d1', 4) })
    expect(result.current.carrinho.find(i => i.chave === '7:d1')!.quantidade).toBe(4)
    expect(result.current.carrinho.find(i => !i.dose)!.quantidade).toBe(1)  // a garrafa não foi tocada
    act(() => { result.current.atualizarQuantidade('7:d1', 999) })
    // 2300 ml − 1 garrafa inteira (1000 ml) = 1300 ml → 26 doses de 50 ml
    expect(result.current.carrinho.find(i => i.chave === '7:d1')!.quantidade).toBe(26)
    act(() => { result.current.atualizarQuantidade('7:d1', 0) })
    expect(result.current.carrinho).toHaveLength(1)
    expect(result.current.carrinho[0].dose).toBeUndefined()
  })

  it('remover e descontar agem só na linha escolhida', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(whisky(), 1) })
    act(() => { result.current.adicionarProduto(whisky(), 2, { dose: dose50, preco: 18 }) })
    act(() => { result.current.aplicarDescontoItem('7:d1', 1, false) })
    expect(result.current.carrinho.find(i => i.chave === '7:d1')!.desconto).toBe(1)
    expect(result.current.carrinho.find(i => !i.dose)!.desconto).toBe(0)
    act(() => { result.current.removerProduto('7:d1') })
    expect(result.current.carrinho).toHaveLength(1)
    expect(result.current.carrinho[0].dose).toBeUndefined()
    act(() => { result.current.removerProduto(7) })                       // id numérico remove a linha sem dose
    expect(result.current.carrinho).toHaveLength(0)
  })

  it('dose livre vira linha própria por ml, com chave e dose sem id', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(whisky(), 1, { dose: livre(45), preco: 16.2 }) })
    act(() => { result.current.adicionarProduto(whisky(), 1, { dose: livre(45), preco: 16.2 }) })
    act(() => { result.current.adicionarProduto(whisky(), 1, { dose: livre(60), preco: 21.6 }) })
    expect(result.current.carrinho.map(i => i.chave)).toEqual(['7:l45', '7:l60'])
    expect(result.current.carrinho[0].quantidade).toBe(2)
  })

  it('a venda manda dose_id para dose cadastrada, dose_ml para livre e nada para a garrafa', async () => {
    svc.finalizarVenda.mockResolvedValue({ id: 10, codigo: 'V-1' })
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(whisky(), 1) })
    act(() => { result.current.adicionarProduto(whisky(), 2, { dose: dose50, preco: 18 }) })
    act(() => { result.current.adicionarProduto(whisky(), 1, { dose: livre(45), preco: 16.2 }) })
    act(() => { result.current.adicionarPagamento('dinheiro', 202.2) })
    await act(async () => { await result.current.finalizarVenda() })
    const corpo = svc.finalizarVenda.mock.calls[0][0]
    expect(corpo.items).toEqual([
      { id: 7, quantity: 1, discount: 0, price: 150 },
      { id: 7, quantity: 2, discount: 0, price: 18, dose_id: 1 },
      { id: 7, quantity: 1, discount: 0, price: 16.2, dose_ml: 45 },
    ])
    expect(corpo.subtotal).toBe(202.2)
  })

  it('com venda sem estoque liberada a dose passa do limite', async () => {
    const { result } = await setup(config({ permitir_venda_sem_estoque: true }))
    act(() => { result.current.adicionarProduto(whisky({ saldo_aberto_ml: 0, estoque_atual: 0 }), 5, { dose: dose50, preco: 18 }) })
    expect(result.current.carrinho[0].quantidade).toBe(5)
  })

  it('produto que vende por dose mas sem garrafa nem ml recusa a dose', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(whisky({ saldo_aberto_ml: 0, estoque_atual: 0 }), 1, { dose: dose50, preco: 18 }) })
    expect(result.current.carrinho).toHaveLength(0)
    expect(showToast.error).toHaveBeenCalled()
  })
})
