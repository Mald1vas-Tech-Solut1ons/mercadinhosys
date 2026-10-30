import { describe, expect, it } from 'vitest'
import { conversaWhatsApp, gerarCupomPdf, nomeArquivoCupom } from './cupomPdf'
import { montarComprovanteLocal } from './cupomLocal'

const dados = montarComprovanteLocal({
  uuid: 'abcdef12-0000-4000-8000-000000000000', offline: false, vendaId: 7, codigo: 'V-7',
  itens: [{ nome: 'Arroz 5kg', quantidade: 2, precoUnitario: 25, total: 50 }],
  subtotal: 50, desconto: 0, total: 50, pagamentos: [{ forma: 'pix', valor: 50 }],
  valorRecebido: 50, troco: 0, operador: 'Caixa 1',
})

describe('cupom em PDF para o WhatsApp', () => {
  it('gera um PDF de verdade com nome pelo código da venda', async () => {
    const blob = await gerarCupomPdf(dados, true)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(1000)
    expect(nomeArquivoCupom(dados)).toBe('cupom-V-7.pdf')
  })

  it('abre a conversa do número no WhatsApp Web, com DDI 55 quando falta', () => {
    expect(conversaWhatsApp('(11) 98888-7777')).toBe('https://web.whatsapp.com/send?phone=5511988887777')
    expect(conversaWhatsApp('5511988887777')).toBe('https://web.whatsapp.com/send?phone=5511988887777')
    expect(conversaWhatsApp('')).toBe('https://web.whatsapp.com/')
  })
})
