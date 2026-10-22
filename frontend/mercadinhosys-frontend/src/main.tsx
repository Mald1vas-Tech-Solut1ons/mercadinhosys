import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';
import { initSentry } from './observability/sentry';
import { startUpdateManager } from './pwa/updateManager';

// Importar teste de conectividade (disponível no console como testConnection())
import './utils/testConnection';

// Monitoramento de erros (no-op se VITE_SENTRY_DSN não estiver definido).
initSentry();

// PWA: registro do SW + ciclo de atualização (deploys). Falhas não derrubam o app.
startUpdateManager();

// Fallback amigável quando algo quebra de forma irrecuperável na UI.
function ErrorFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Algo deu errado</h1>
        <p style={{ color: '#64748b', marginBottom: 16 }}>Já fomos notificados. Tente recarregar a página.</p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '10px 20px', borderRadius: 12, background: '#2563eb', color: '#fff', fontWeight: 600, border: 0, cursor: 'pointer' }}
        >
          Recarregar
        </button>
      </div>
    </div>
  );
}

// StrictMode removido — causava dupla execução de useEffect (dobrava chamadas de API)
const container = document.getElementById('root')!;

// Guarda contra dupla montagem: em PWA com service worker, uma navegação/reload
// disparado antes do documento anterior terminar de descarregar pode fazer este
// módulo rodar duas vezes, criando duas raízes React no mesmo container (o app
// inteiro renderiza duplicado, sobreposto, na tela).
if (!(container as any)._mercadinhoRootMounted) {
  (container as any)._mercadinhoRootMounted = true;
  ReactDOM.createRoot(container).render(
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  );
}
