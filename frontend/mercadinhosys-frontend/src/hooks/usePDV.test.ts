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
import { usePDV, limparSessaoOperador } from './usePDV'

const svc = pdvService as unknown as Record<string, ReturnType<typeof vi.fn>>

const config = (over: Record<string, unknown> = {}) => ({
  formas_pagamento: [],
  controlar_validade: true,
  dias_alerta_validade: 30,
  permitir_venda_sem_estoque: false,
  permite_venda_sem_cliente: true,
  funcionario: { role: 'CAIXA', limite_desconto: 10, pode_dar_desconto: true },
  ...over,
})

const prod = (id: number, preco: number, estoque = 100, extra: Record<string, unknown> = {}) =>
  ({ id, nome: `P${id}`, preco_venda: preco, estoque_atual: estoque, ...extra }) as any

const iso = (diasAFrente: number) => {
  const d = new Date()
  d.setDate(d.getDate() + diasAFrente)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function setup(cfg = config()) {
  svc.getConfiguracoes.mockResolvedValue(cfg)
  svc.getCaixaAtual.mockResolvedValue({ id: 1 })
  const hook = renderHook(() => usePDV())
  await waitFor(() => expect(hook.result.current.configuracoes).not.toBeNull())
  return hook
}

describe('usePDV', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Object.values(svc).forEach(f => f.mockReset())
    Object.values(showToast).forEach(f => (f as any).mockReset())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('adiciona produto, soma quantidade do mesmo item e calcula subtotal/total', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 10.1)) })
    act(() => { result.current.adicionarProduto(prod(1, 10.1), 2) })
    expect(result.current.carrinho).toHaveLength(1)
    expect(result.current.carrinho[0].quantidade).toBe(3)
    expect(result.current.subtotal).toBe(30.3)
    expect(result.current.total).toBe(30.3)
  })

  it('limita a quantidade ao estoque quando não permite venda sem estoque', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 5, 2), 5) })
    expect(result.current.carrinho[0].quantidade).toBe(2)
    act(() => { result.current.adicionarProduto(prod(1, 5, 2), 1) })
    expect(result.current.carrinho[0].quantidade).toBe(2)
    expect(showToast.warning).toHaveBeenCalled()
  })

  it('recusa produto sem estoque', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 5, 0)) })
    expect(result.current.carrinho).toHaveLength(0)
    expect(showToast.error).toHaveBeenCalled()
  })

  it('permite exceder estoque quando a configuração autoriza', async () => {
    const { result } = await setup(config({ permitir_venda_sem_estoque: true }))
    act(() => { result.current.adicionarProduto(prod(1, 5, 0), 3) })
    expect(result.current.carrinho[0].quantidade).toBe(3)
  })

  it('bloqueia produto vencido e avisa produto a vencer', async () => {
    const { result } = await setup()
    let ok = true
    act(() => { ok = result.current.adicionarProduto(prod(1, 5, 10, { data_validade: iso(-1) })) })
    expect(ok).toBe(false)
    expect(result.current.carrinho).toHaveLength(0)
    act(() => { ok = result.current.adicionarProduto(prod(2, 5, 10, { data_validade: iso(3) })) })
    expect(ok).toBe(true)
    expect(result.current.carrinho).toHaveLength(1)
    expect(showToast.warning).toHaveBeenCalled()
  })

  it('atualizarQuantidade arredonda a 3 casas e remove ao zerar', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 10)) })
    act(() => { result.current.atualizarQuantidade(1, 0.1 + 0.2) })
    expect(result.current.carrinho[0].quantidade).toBe(0.3)
    act(() => { result.current.atualizarQuantidade(1, 0) })
    expect(result.current.carrinho).toHaveLength(0)
  })

  it('desconto por item, geral percentual e taxa de entrega entram no total', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 100)) })
    act(() => { result.current.aplicarDescontoItem(1, 10) })
    act(() => { result.current.setDescontoPercentual(true) })
    act(() => { result.current.setDescontoGeral(10) })
    // (100 - 10) * 10% = 9 → desconto total 19, total 81
    expect(result.current.descontoTotal).toBe(19)
    expect(result.current.total).toBe(81)
    act(() => { result.current.setParaEntregar(true) })
    act(() => { result.current.setDadosEntrega({ taxa_entrega: 5 }) })
    expect(result.current.total).toBe(86)
  })

  it('troco considera apenas o excedente pago em dinheiro', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 50)) })
    act(() => { result.current.adicionarPagamento('dinheiro', 70) })
    expect(result.current.troco).toBe(20)
    act(() => { result.current.setPagamentos([]) })
    act(() => { result.current.adicionarPagamento('pix', 70) })
    expect(result.current.troco).toBe(0)
  })

  it('validarDescontoPermitido: admin livre, demais respeitam o limite', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 100)) })
    expect(result.current.validarDescontoPermitido(10)).toBe(true)
    expect(result.current.validarDescontoPermitido(11)).toBe(false)
    const admin = await setup(config({ funcionario: { role: 'ADMIN' } }))
    act(() => { admin.result.current.adicionarProduto(prod(1, 100)) })
    expect(admin.result.current.validarDescontoPermitido(90)).toBe(true)
  })

  it('múltiplas sessões são independentes e persistem no sessionStorage', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 10)) })
    act(() => { result.current.adicionarSessao() })
    expect(result.current.sessoes).toHaveLength(2)
    expect(result.current.carrinho).toHaveLength(0)
    const salvo = JSON.parse(sessionStorage.getItem('pdv_sessions_v1') as string)
    expect(salvo.sessoes).toHaveLength(2)
    const nova = renderHook(() => usePDV())
    expect(nova.result.current.sessoes).toHaveLength(2)
  })

  it('limparCarrinho zera a sessão ativa', async () => {
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 10)) })
    act(() => { result.current.setObservacoes('x') })
    act(() => { result.current.limparCarrinho() })
    expect(result.current.carrinho).toHaveLength(0)
    expect(result.current.observacoes).toBe('')
  })

  it('finalizarVenda valida carrinho vazio e pagamento insuficiente', async () => {
    const { result } = await setup()
    await expect(result.current.finalizarVenda()).rejects.toThrow('Adicione produtos')
    act(() => { result.current.adicionarProduto(prod(1, 50)) })
    await expect(result.current.finalizarVenda()).rejects.toThrow('insuficiente')
  })

  it('finalizarVenda online envia payload com itens e pagamentos', async () => {
    svc.finalizarVenda.mockResolvedValue({ id: 99 })
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 50)) })
    act(() => { result.current.adicionarPagamento('pix', 50) })
    const r = await result.current.finalizarVenda({ offline_uuid: 'u-1' })
    expect(r).toEqual({ id: 99 })
    expect(svc.finalizarVenda).toHaveBeenCalledWith(expect.objectContaining({
      total: 50,
      offline_uuid: 'u-1',
      items: [{ id: 1, quantity: 1, discount: 0, price: 50 }],
    }))
  })

  it('finalizarVenda enfileira offline em falha de rede e quando navigator.onLine=false', async () => {
    const enqueue = vi.fn().mockResolvedValue('q-1')
    svc.finalizarVenda.mockRejectedValue({ code: 'ERR_NETWORK' })
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 50)) })
    act(() => { result.current.adicionarPagamento('pix', 50) })
    expect(await result.current.finalizarVenda(undefined, enqueue)).toEqual({ offline: true, codigo: 'q-1' })

    svc.finalizarVenda.mockClear()
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(await result.current.finalizarVenda(undefined, enqueue)).toEqual({ offline: true, codigo: 'q-1' })
    expect(svc.finalizarVenda).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('erro do servidor (com response) não vai para a fila', async () => {
    const enqueue = vi.fn()
    svc.finalizarVenda.mockRejectedValue({ response: { status: 400 } })
    const { result } = await setup()
    act(() => { result.current.adicionarProduto(prod(1, 50)) })
    act(() => { result.current.adicionarPagamento('pix', 50) })
    await expect(result.current.finalizarVenda(undefined, enqueue)).rejects.toBeTruthy()
    expect(enqueue).not.toHaveBeenCalled()
  })

  // ─── FASE 1.7: o operador descobre o limite ANTES de montar a venda ───────────
  describe('limite de desconto (FASE 1.7)', () => {
    const caixa = (limite_desconto: number, limite_desconto_loja: number, id = 7) =>
      config({ funcionario: { id, role: 'CAIXA', limite_desconto, limite_desconto_loja, pode_dar_desconto: true } })

    it('desconto acima do limite não é aplicado e pede autorização', async () => {
      const { result } = await setup(caixa(10, 10))
      act(() => { result.current.adicionarProduto(prod(1, 100)) })
      let erro: any = null
      act(() => {
        try { result.current.aplicarDescontoItem(1, 40) } catch (e) { erro = e }
      })
      expect(erro?.code).toBe('DESCONTO_EXCEDE_LIMITE')
      expect(result.current.carrinho[0].desconto).toBe(0)
      expect(showToast.error).toHaveBeenCalled()
    })

    it('desconto dentro do limite é aplicado sem pedir PIN', async () => {
      const { result } = await setup(caixa(10, 10))
      act(() => { result.current.adicionarProduto(prod(1, 100)) })
      act(() => { result.current.aplicarDescontoItem(1, 10) })
      expect(result.current.carrinho[0].desconto).toBe(10)
      expect(result.current.total).toBe(90)
    })

    it('depois do PIN do gerente o desconto entra e fica marcado como autorizado', async () => {
      const { result } = await setup(caixa(10, 10))
      act(() => { result.current.adicionarProduto(prod(1, 100)) })
      act(() => { result.current.aplicarDescontoItemAutorizado(1, 40) })
      expect(result.current.carrinho[0].desconto).toBe(40)
      expect(result.current.carrinho[0].descontoAutorizadoExterno).toBe(true)
      expect(result.current.total).toBe(60)
    })

    it('limite 0 no permissoes_json do piloto cai no limite da loja (não trava em 0%)', async () => {
      const { result } = await setup(caixa(0, 25))
      act(() => { result.current.adicionarProduto(prod(1, 100)) })
      expect(result.current.validarDescontoPermitido(25)).toBe(true)
      expect(result.current.validarDescontoPermitido(26)).toBe(false)
      act(() => { result.current.aplicarDescontoItem(1, 25) })
      expect(result.current.carrinho[0].desconto).toBe(25)
    })

    it('admin aplica desconto alto direto, sem PIN', async () => {
      const { result } = await setup(config({ funcionario: { id: 9, role: 'ADMIN' } }))
      act(() => { result.current.adicionarProduto(prod(1, 100)) })
      act(() => { result.current.aplicarDescontoItem(1, 90) })
      expect(result.current.carrinho[0].desconto).toBe(90)
    })

    it('operador sem pode_dar_desconto tem limite 0, igual ao servidor', async () => {
      const { result } = await setup(config({
        funcionario: { id: 11, role: 'CAIXA', limite_desconto: 10, limite_desconto_loja: 10, pode_dar_desconto: false },
      }))
      act(() => { result.current.adicionarProduto(prod(1, 100)) })
      expect(result.current.validarDescontoPermitido(1)).toBe(false)
      let erro: any = null
      act(() => {
        try { result.current.aplicarDescontoItem(1, 5) } catch (e) { erro = e }
      })
      expect(erro?.code).toBe('DESCONTO_EXCEDE_LIMITE')
    })
  })

  // ─── FASE 1.4: carrinho por operador no tablet compartilhado ──────────────────
  describe('carrinho por operador (FASE 1.4)', () => {
    const operador = (id: number) => config({ funcionario: { id, role: 'CAIXA', limite_desconto: 10, pode_dar_desconto: true } })

    it('o operador seguinte começa com carrinho vazio e a chave do anterior fica intacta', async () => {
      const a = await setup(operador(101))
      act(() => { a.result.current.adicionarProduto(prod(1, 10)) })
      await waitFor(() =>
        expect(JSON.parse(sessionStorage.getItem('pdv_sessions_v1_101') as string).sessoes[0].carrinho).toHaveLength(1),
      )

      const b = await setup(operador(202))
      await waitFor(() => expect(sessionStorage.getItem('pdv_sessions_v1_202')).not.toBeNull())
      expect(b.result.current.carrinho).toHaveLength(0)
      expect(JSON.parse(sessionStorage.getItem('pdv_sessions_v1_202') as string).sessoes[0].carrinho).toHaveLength(0)
      // o carrinho da operadora A não foi apagado nem herdado
      expect(JSON.parse(sessionStorage.getItem('pdv_sessions_v1_101') as string).sessoes[0].carrinho).toHaveLength(1)
    })

    it('limparSessaoOperador apaga só a chave de quem saiu', () => {
      sessionStorage.setItem('pdv_sessions_v1_101', JSON.stringify({ sessoes: [{ id: 'x' }], sessaoAtivaId: 'x' }))
      sessionStorage.setItem('pdv_sessions_v1_202', JSON.stringify({ sessoes: [{ id: 'y' }], sessaoAtivaId: 'y' }))
      limparSessaoOperador(101)
      expect(sessionStorage.getItem('pdv_sessions_v1_101')).toBeNull()
      expect(sessionStorage.getItem('pdv_sessions_v1_202')).not.toBeNull()
    })
  })
})
