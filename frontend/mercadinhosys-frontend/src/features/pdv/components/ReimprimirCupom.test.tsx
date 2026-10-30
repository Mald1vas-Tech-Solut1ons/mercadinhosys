import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '../../../lib/db'
import { salvarCabecalhoCupom, salvarCupomLocal, montarComprovanteLocal } from '../cupomLocal'

const printHtml = vi.fn()
vi.mock('../../../utils/printHtml', () => ({ printHtml: (html: string) => printHtml(html) }))
vi.mock('../../../contexts/ConfigContext', () => ({ useConfig: () => ({ config: { tipo_impressora: 'termica_80mm' } }) }))
const obterComprovante = vi.fn()
const vendasHoje = vi.fn()
vi.mock('../pdvService', () => ({
  pdvService: {
    obterComprovante: (id: number) => obterComprovante(id),
    vendasHoje: (n: number) => vendasHoje(n),
  },
}))

import CupomFiscalModal from './CupomFiscalModal'
import ReimprimirCupomModal from './ReimprimirCupomModal'

const dadosVenda = (uuid: string) => ({
  uuid, offline: true,
  itens: [{ nome: 'Feijão 1kg', quantidade: 1, precoUnitario: 8.5, total: 8.5 }],
  subtotal: 8.5, desconto: 0, total: 8.5,
  pagamentos: [{ forma: 'dinheiro', valor: 10 }], valorRecebido: 10, troco: 1.5,
  operador: 'Caixa 1',
})

describe('reimpressão de cupom', () => {
  beforeEach(async () => {
    await db.cupons.clear()
    localStorage.clear()
    localStorage.setItem('current_estabelecimento_id', '10')
    salvarCabecalhoCupom({ nome_fantasia: 'Mercado da Vera' })
    printHtml.mockReset(); obterComprovante.mockReset(); vendasHoje.mockReset()
  })

  it('venda offline: cupom sai do aparelho, sem servidor, e imprime', () => {
    const dados = montarComprovanteLocal(dadosVenda('deadbeef-1111-4000-8000-000000000000'))
    render(<CupomFiscalModal aberto vendaId={null} dadosLocais={dados} segundaVia onFechar={() => {}} />)
    expect(obterComprovante).not.toHaveBeenCalled()
    expect(screen.getByText('Mercado da Vera')).toBeTruthy()
    expect(screen.getByText('*** 2ª VIA ***')).toBeTruthy()
    expect(screen.getByText(/AGUARDANDO SINCRONIZAÇÃO/)).toBeTruthy()
    expect(screen.getByText('DINHEIRO')).toBeTruthy()
    fireEvent.click(screen.getByText('Imprimir'))
    expect(printHtml).toHaveBeenCalledOnce()
    expect(printHtml.mock.calls[0][0]).toContain('Feijão 1kg')
  })

  it('servidor fora do ar: cai para a cópia local em vez de travar', async () => {
    obterComprovante.mockRejectedValue(new Error('Network Error'))
    const dados = montarComprovanteLocal({ ...dadosVenda('u-2'), offline: false, vendaId: 77, codigo: 'V-77' })
    render(<CupomFiscalModal aberto vendaId={77} dadosLocais={dados} onFechar={() => {}} />)
    await waitFor(() => expect(screen.getByText('Mercado da Vera')).toBeTruthy())
    expect(screen.getByText(/cópia salva neste aparelho/)).toBeTruthy()
    expect(screen.queryByText(/AGUARDANDO SINCRONIZAÇÃO/)).toBeNull()
  })

  it('lista do PDV: offline mostra só o aparelho; online junta sem duplicar a venda sincronizada', async () => {
    await salvarCupomLocal(dadosVenda('aaaaaaaa-0000-4000-8000-000000000000'))
    await salvarCupomLocal({ ...dadosVenda('bbbbbbbb-0000-4000-8000-000000000000'), offline: false, vendaId: 5, codigo: 'V-5' })
    const onSelecionar = vi.fn()

    const { unmount } = render(<ReimprimirCupomModal aberto online={false} onFechar={() => {}} onSelecionar={onSelecionar} />)
    await waitFor(() => expect(screen.getByText('OFF-AAAAAAAA')).toBeTruthy())
    expect(screen.getByText('V-5')).toBeTruthy()
    expect(screen.getByText(/Sem internet/)).toBeTruthy()
    expect(vendasHoje).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('OFF-AAAAAAAA'))
    expect(onSelecionar).toHaveBeenCalledWith(expect.objectContaining({ vendaId: null }))
    unmount()

    vendasHoje.mockResolvedValue([
      { id: 5, codigo: 'V-5', total: 8.5, hora: '10:00', forma_pagamento: 'dinheiro', offline_uuid: 'bbbbbbbb-0000-4000-8000-000000000000' },
      { id: 6, codigo: 'V-6', total: 30, hora: '09:00', forma_pagamento: 'pix', offline_uuid: null },
    ])
    render(<ReimprimirCupomModal aberto online onFechar={() => {}} onSelecionar={onSelecionar} />)
    await waitFor(() => expect(screen.getByText('V-6')).toBeTruthy())
    expect(screen.getAllByText('V-5')).toHaveLength(1)
    fireEvent.click(screen.getByText('V-6'))
    expect(onSelecionar).toHaveBeenLastCalledWith({ vendaId: 6, dadosLocais: null })
  })
})
