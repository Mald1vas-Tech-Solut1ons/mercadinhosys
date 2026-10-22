import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('../api/apiClient', () => ({ apiClient: { post: vi.fn() } }))

import { apiClient } from '../api/apiClient'
import { db } from '../lib/db'
import { useOfflineQueue } from './useOfflineQueue'

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>
const payload = (uuid: string) => ({ offline_uuid: uuid, total: 10 }) as any

describe('useOfflineQueue', () => {
  beforeEach(async () => {
    await db.vendas.clear()
    post.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('enqueue usa o offline_uuid do payload como chave (idempotência) e atualiza o contador', async () => {
    const { result } = renderHook(() => useOfflineQueue())
    let id = ''
    await act(async () => { id = await result.current.enqueue(payload('abc-1')) })
    expect(id).toBe('abc-1')
    expect(await db.vendas.get('abc-1')).toMatchObject({ status: 'pending' })
    await waitFor(() => expect(result.current.pendingCount).toBe(1))
  })

  it('enqueue gera uuid quando o payload não traz', async () => {
    const { result } = renderHook(() => useOfflineQueue())
    let id = ''
    await act(async () => { id = await result.current.enqueue({ total: 1 }) })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('processQueue envia, remove da fila e propaga offline_uuid', async () => {
    post.mockResolvedValue({ data: { success: true } })
    const { result } = renderHook(() => useOfflineQueue())
    await act(async () => { await result.current.enqueue(payload('u1')) })
    let r = { synced: 0, failed: 0 }
    await act(async () => { r = await result.current.processQueue() })
    expect(r).toEqual({ synced: 1, failed: 0 })
    expect(post).toHaveBeenCalledWith('/pdv/finalizar', expect.objectContaining({ offline_uuid: 'u1' }))
    expect(await db.vendas.count()).toBe(0)
  })

  it('erro de rede mantém a venda na fila e interrompe o loop', async () => {
    post.mockRejectedValue(new Error('Network Error'))
    const { result } = renderHook(() => useOfflineQueue())
    await act(async () => {
      await result.current.enqueue(payload('u1'))
      await result.current.enqueue(payload('u2'))
    })
    let r = { synced: 0, failed: 0 }
    await act(async () => { r = await result.current.processQueue() })
    expect(r).toEqual({ synced: 0, failed: 1, lastError: 'Sem conexão com o servidor' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(await db.vendas.count()).toBe(2)
  })

  it('rejeição do servidor marca erro e continua com as próximas', async () => {
    post
      .mockRejectedValueOnce({ response: { data: { message: 'estoque' } } })
      .mockResolvedValueOnce({ data: { success: true } })
    const { result } = renderHook(() => useOfflineQueue())
    await act(async () => {
      await result.current.enqueue(payload('bad'))
      await result.current.enqueue(payload('ok'))
    })
    let r = { synced: 0, failed: 0 }
    await act(async () => { r = await result.current.processQueue() })
    expect(r).toEqual({ synced: 1, failed: 1, lastError: 'estoque' })
    expect(await db.vendas.get('bad')).toMatchObject({ status: 'error', error_message: 'estoque' })
    expect(await db.vendas.get('ok')).toBeUndefined()
  })

  it('resposta 2xx sem confirmação não deixa a venda presa em "syncing"', async () => {
    post.mockResolvedValue({ data: {} })
    const { result } = renderHook(() => useOfflineQueue())
    await act(async () => { await result.current.enqueue(payload('u1')) })
    let r = { synced: 0, failed: 0 }
    await act(async () => { r = await result.current.processQueue() })
    expect(r).toEqual({ synced: 0, failed: 1, lastError: 'Resposta do servidor sem confirmação' })
    expect((await db.vendas.get('u1'))?.status).toBe('error')
  })

  it('evento "online" dispara o processamento automático', async () => {
    post.mockResolvedValue({ data: { success: true } })
    const { result } = renderHook(() => useOfflineQueue())
    await act(async () => { await result.current.enqueue(payload('u1')) })
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(post).toHaveBeenCalled())
    await waitFor(() => expect(result.current.pendingCount).toBe(0))
  })
})
