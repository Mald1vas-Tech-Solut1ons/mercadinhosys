/**
 * updateManager — ciclo de vida das atualizações (deploys) do PWA.
 *
 * Problema que resolve: com skipWaiting automático o service worker novo assume,
 * mas a aba/PWA aberta continua rodando o JS antigo até ser fechada. Num caixa
 * que fica dias aberto isso deixa o celular em versão velha (e quebra chunks
 * lazy cujo hash já saiu do cache).
 *
 * Política:
 *  - detecta versão nova por DOIS canais: service worker (waiting) e /version.json
 *  - checa na abertura, a cada 15 min, ao voltar para o app e ao reconectar
 *  - aplica sozinho só quando é seguro (app em segundo plano ou recém-aberto,
 *    carrinho vazio); caso contrário mostra o banner "Atualizar"
 *  - se o SW falhar em entregar a versão, oferece recarga forçada (limpa caches)
 *  - recupera de "Failed to fetch dynamically imported module" com 1 reload
 */

export type UpdateStatus = 'idle' | 'available' | 'stale' | 'applying';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  lastCheck: number | null;
}

type Listener = (s: UpdateState) => void;

export const CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const BOOT_APPLY_WINDOW_MS = 15 * 1000;
export const STALE_AFTER_MS = 30 * 1000;
// FASE 1.4: o carrinho agora é por operador (pdv_sessions_v1_<funcionario_id>). A chave
// legada continua existindo para carrinhos anteriores à troca de chave.
const PDV_STORAGE_PREFIX = 'pdv_sessions_v1';
const RELOAD_FLAG = 'pwa_chunk_reload_at';

const ehChaveDeCarrinhoPdv = (chave: string) =>
  chave === PDV_STORAGE_PREFIX || chave.startsWith(`${PDV_STORAGE_PREFIX}_`);

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'length' | 'key'>>;

/** Seguro para recarregar sem perder trabalho: nenhum carrinho/pagamento em andamento. */
export function isSafeToApply(storage: StorageLike = sessionStorage): boolean {
  try {
    const chaves: string[] = [];
    for (let i = 0; i < (storage.length ?? 0); i++) {
      const chave = storage.key?.(i);
      if (chave && ehChaveDeCarrinhoPdv(chave)) chaves.push(chave);
    }
    // Stub de teste (sem iteração de chaves): cai na chave legada.
    if (chaves.length === 0) chaves.push(PDV_STORAGE_PREFIX);

    return chaves.every((chave) => {
      const raw = storage.getItem(chave);
      if (!raw) return true;
      const { sessoes } = JSON.parse(raw);
      if (!Array.isArray(sessoes)) return true;
      return sessoes.every(
        (s: { carrinho?: unknown[]; pagamentos?: unknown[] }) => !s?.carrinho?.length && !s?.pagamentos?.length,
      );
    });
  } catch {
    return true;
  }
}

export interface ManagerDeps {
  currentVersion: string;
  /** Registra o SW e devolve a função que ativa o novo (workbox `updateSW`). */
  registerSW: (cb: {
    onNeedRefresh: () => void;
    onRegisteredSW: (url: string, reg?: ServiceWorkerRegistration) => void;
  }) => (reload?: boolean) => Promise<void>;
  fetchVersion?: () => Promise<string | null>;
  now?: () => number;
  isSafe?: () => boolean;
  hardReload?: () => Promise<void>;
}

export async function fetchRemoteVersion(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

/** Remove SW e caches e recarrega: último recurso quando o SW não entrega a versão nova. */
export async function hardReload(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map(r => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}

export function createUpdateManager(deps: ManagerDeps) {
  const now = deps.now ?? Date.now;
  const isSafe = deps.isSafe ?? (() => isSafeToApply());
  const getRemote = deps.fetchVersion ?? fetchRemoteVersion;
  const bootAt = now();
  let registration: ServiceWorkerRegistration | undefined;
  let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
  let swWaiting = false;
  let mismatchSince: number | null = null;
  let state: UpdateState = { status: 'idle', currentVersion: deps.currentVersion, latestVersion: null, lastCheck: null };
  const listeners = new Set<Listener>();

  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach(l => l(state));
  };

  async function apply(): Promise<void> {
    if (state.status === 'applying') return;
    set({ status: 'applying' });
    if (swWaiting && updateSW) {
      await updateSW(true); // SKIP_WAITING + reload quando o novo SW assumir
      return;
    }
    await (deps.hardReload ?? hardReload)();
  }

  /** Aplica sem perguntar apenas quando não há risco: recém-aberto ou em segundo plano. */
  function maybeAutoApply(hidden: boolean) {
    if (state.status !== 'available' && state.status !== 'stale') return;
    if (!isSafe()) return;
    if (hidden || now() - bootAt < BOOT_APPLY_WINDOW_MS) void apply();
  }

  async function check(): Promise<void> {
    try { await registration?.update(); } catch { /* offline: tenta de novo depois */ }
    const remote = await getRemote();
    set({ lastCheck: now() });
    if (remote && remote !== deps.currentVersion) {
      mismatchSince ??= now();
      set({ latestVersion: remote });
      if (swWaiting) {
        if (state.status === 'idle') set({ status: 'available' });
      } else if (now() - mismatchSince > STALE_AFTER_MS && state.status === 'idle') {
        // versão nova existe no servidor mas o SW não a entregou
        set({ status: 'stale' });
      }
    } else if (remote) {
      mismatchSince = null;
    }
    maybeAutoApply(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  }

  function start(): () => void {
    updateSW = deps.registerSW({
      onNeedRefresh: () => {
        swWaiting = true;
        set({ status: 'available' });
        maybeAutoApply(document.visibilityState === 'hidden');
      },
      onRegisteredSW: (_url, reg) => { registration = reg; },
    });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
      else maybeAutoApply(true);
    };
    const onOnline = () => void check();
    const onPreloadError = (e: Event) => {
      // chunk lazy sumiu após deploy: 1 reload (no máx. a cada 60s) resolve
      try {
        const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
        if (now() - last < 60_000) return;
        sessionStorage.setItem(RELOAD_FLAG, String(now()));
      } catch { /* sem sessionStorage: recarrega mesmo assim */ }
      e.preventDefault();
      window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('vite:preloadError', onPreloadError);
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const first = setTimeout(() => void check(), 3000);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('vite:preloadError', onPreloadError);
    };
  }

  return {
    start,
    check,
    apply,
    getState: () => state,
    subscribe(l: Listener) { listeners.add(l); l(state); return () => { listeners.delete(l); }; },
  };
}

// ── Instância da aplicação ───────────────────────────────────────────────────
declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

let instance: ReturnType<typeof createUpdateManager> | null = null;

export function getUpdateManager() {
  if (!instance) {
    instance = createUpdateManager({
      currentVersion: APP_VERSION,
      registerSW: (cb) => {
        let fn: (reload?: boolean) => Promise<void> = async () => {};
        import('virtual:pwa-register')
          .then(({ registerSW }) => { fn = registerSW({ immediate: true, ...cb }); })
          .catch(() => { /* SW indisponível (HTTP, modo privado): app segue normal */ });
        return (reload) => fn(reload);
      },
    });
  }
  return instance;
}

export function startUpdateManager(): () => void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return () => {};
  return getUpdateManager().start();
}
