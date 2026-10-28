import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { APP_VERSION, getUpdateManager, type UpdateState } from './updateManager';

/** Banner discreto; só aparece quando há versão nova pendente. */
export default function UpdatePrompt() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => getUpdateManager().subscribe(setState), []);

  if (!state || state.status === 'idle') return null;
  const aplicando = state.status === 'applying';

  return (
    <div
      role="status"
      className="fixed left-3 right-3 bottom-24 md:bottom-4 md:left-auto md:right-4 md:w-96 z-[300] flex items-center gap-3 rounded-xl border border-blue-400/40 bg-blue-700 text-white px-4 py-3 shadow-xl"
    >
      <RefreshCw className={`h-5 w-5 shrink-0 ${aplicando ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1 text-sm leading-tight">
        <p className="font-semibold">{aplicando ? 'Atualizando…' : 'Nova versão disponível'}</p>
        <p className="opacity-80 text-xs">Suas vendas pendentes ficam guardadas.</p>
      </div>
      {!aplicando && (
        <button
          onClick={() => void getUpdateManager().apply()}
          className="rounded-lg bg-white/95 px-3 py-1.5 text-sm font-semibold text-blue-800 active:scale-95 dark:bg-gray-800/95"
        >
          Atualizar
        </button>
      )}
    </div>
  );
}

/** Rótulo de versão; clicar força uma verificação. */
export function VersaoDoApp() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => getUpdateManager().subscribe(setState), []);
  const nova = state?.latestVersion && state.latestVersion !== APP_VERSION ? ` → ${state.latestVersion}` : '';
  return (
    <button
      type="button"
      onClick={() => void getUpdateManager().check()}
      className="text-xs opacity-60 hover:opacity-100"
      title="Verificar atualização"
    >
      Versão {APP_VERSION}{nova}
    </button>
  );
}
