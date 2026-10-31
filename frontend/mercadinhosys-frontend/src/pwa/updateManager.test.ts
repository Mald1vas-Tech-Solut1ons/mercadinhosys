import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOOT_APPLY_WINDOW_MS,
  STALE_AFTER_MS,
  createUpdateManager,
  isSafeToApply,
} from './updateManager'

const storage = (v: unknown) => ({ getItem: () => (v === undefined ? null : JSON.stringify(v)) })

describe('isSafeToApply', () => {
  it('seguro sem sessão salva, com carrinho vazio ou JSON inválido', () => {
    expect(isSafeToApply(storage(undefined))).toBe(true)
    expect(isSafeToApply(storage({ sessoes: [{ carrinho: [], pagamentos: [] }] }))).toBe(true)
    expect(isSafeToApply({ getItem: () => '{quebrado' })).toBe(true)
  })
  it('inseguro com item no carrinho ou pagamento lançado em qualquer sessão', () => {
    expect(isSafeToApply(storage({ sessoes: [{ carrinho: [{}], pagamentos: [] }] }))).toBe(false)
    expect(isSafeToApply(storage({ sessoes: [{ carrinho: [] }, { carrinho: [], pagamentos: [{}] }] }))).toBe(false)
  })

  // FASE 1.4: o carrinho passou a ser keyado por operador (pdv_sessions_v1_<id>).
  // Se o update do PWA só olhar a chave legada, ele recarrega no meio da venda do operador.
  const storageComChaves = (mapa: Record<string, unknown>) => {
    const chaves = Object.keys(mapa)
    return {
      getItem: (k: string) => (k in mapa ? JSON.stringify(mapa[k]) : null),
      get length() { return chaves.length },
      key: (i: number) => chaves[i],
    }
  }

  it('lê o carrinho de TODOS os operadores, não só a chave legada', () => {
    expect(isSafeToApply(storageComChaves({
      pdv_sessions_v1_101: { sessoes: [{ carrinho: [], pagamentos: [] }] },
      pdv_sessions_v1_202: { sessoes: [{ carrinho: [{}], pagamentos: [] }] },
    }))).toBe(false)
  })

  it('seguro quando nenhum operador tem carrinho aberto', () => {
    expect(isSafeToApply(storageComChaves({
      pdv_sessions_v1_101: { sessoes: [{ carrinho: [], pagamentos: [] }] },
      pdv_sessions_v1_202: { sessoes: [{ carrinho: [], pagamentos: [] }] },
      outra_chave: { qualquer: true },
    }))).toBe(true)
  })
})

describe('createUpdateManager', () => {
  let t = 1_000
  let needRefresh: () => void
  const updateSW = vi.fn().mockResolvedValue(undefined)
  const hardReload = vi.fn().mockResolvedValue(undefined)
  let remote: string | null = 'v1'
  let safe = true

  const make = () => {
    const m = createUpdateManager({
      currentVersion: 'v1',
      registerSW: cb => {
        needRefresh = cb.onNeedRefresh
        return updateSW
      },
      fetchVersion: async () => remote,
      now: () => t,
      isSafe: () => safe,
      hardReload,
    })
    m.start()
    return m
  }

  beforeEach(() => {
    t = 1_000
    remote = 'v1'
    safe = true
    updateSW.mockClear()
    hardReload.mockClear()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('SW em espera nos primeiros segundos e seguro: aplica sozinho', () => {
    const m = make()
    needRefresh()
    expect(m.getState().status).toBe('applying')
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('SW em espera depois da janela de boot: só avisa, não recarrega', () => {
    const m = make()
    t += BOOT_APPLY_WINDOW_MS + 1
    needRefresh()
    expect(m.getState().status).toBe('available')
    expect(updateSW).not.toHaveBeenCalled()
  })

  it('carrinho em andamento nunca é interrompido, nem em segundo plano', () => {
    const m = make()
    t += BOOT_APPLY_WINDOW_MS + 1
    safe = false
    needRefresh()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(m.getState().status).toBe('available')
    expect(updateSW).not.toHaveBeenCalled()
  })

  it('ao ir para segundo plano com carrinho vazio, aplica a atualização pendente', () => {
    const m = make()
    t += BOOT_APPLY_WINDOW_MS + 1
    needRefresh()
    expect(m.getState().status).toBe('available')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('apply() manual chama o SW uma única vez', async () => {
    const m = make()
    t += BOOT_APPLY_WINDOW_MS + 1
    safe = false
    needRefresh()
    await m.apply()
    await m.apply()
    expect(updateSW).toHaveBeenCalledTimes(1)
  })

  it('version.json novo + SW sem entregar após STALE_AFTER_MS: estado stale e recarga forçada', async () => {
    const m = make()
    t += BOOT_APPLY_WINDOW_MS + 1
    safe = false
    remote = 'v2'
    await m.check()
    expect(m.getState()).toMatchObject({ status: 'idle', latestVersion: 'v2' })
    t += STALE_AFTER_MS + 1
    await m.check()
    expect(m.getState().status).toBe('stale')
    await m.apply()
    expect(hardReload).toHaveBeenCalled()
    expect(updateSW).not.toHaveBeenCalled()
  })

  it('versão igual no servidor não gera aviso', async () => {
    const m = make()
    await m.check()
    expect(m.getState().status).toBe('idle')
    expect(m.getState().lastCheck).not.toBeNull()
  })

  it('falha ao buscar version.json (offline) não altera o estado', async () => {
    const m = make()
    remote = null
    await m.check()
    expect(m.getState().status).toBe('idle')
  })
})
