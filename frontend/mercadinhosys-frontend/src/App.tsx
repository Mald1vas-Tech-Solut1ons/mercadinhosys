// src/App.tsx
import React from 'react';
console.log('🚀 [PHASE-3] FRONTEND_LOADED_SUCCESSFULLY - BYPASS PRO ATIVO');
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes/AppRoutes';
import DebugRoutes from './components/DebugRoutes';
import { ThemeProvider } from './theme/ThemeProvider';
import { ConfigProvider } from './contexts/ConfigContext';
import { AuthProvider } from './contexts/AuthContext';
import { SuperAdminProvider } from './contexts/SuperAdminContext';
import { Toaster } from 'react-hot-toast';
import { estiloBaseToast } from './utils/toast';
import { ConfirmacaoHost } from './components/ui/Confirmacao';
import { PedidoPinHost } from './components/ui/PedidoPin';
import ErrorBoundary from './components/ErrorBoundary';
import { useGlobalOverlayScrollLock } from './hooks/useBodyScrollLock';

import UpdatePrompt from './pwa/UpdatePrompt';

const App: React.FC = () => {
  // Trava automaticamente o scroll do body sempre que qualquer modal "fixed inset-0"
  // estiver montado em qualquer lugar do app — cobre todos os modais do sistema.
  useGlobalOverlayScrollLock();

  return (
    <ErrorBoundary name="MercadinhoSys Global">
      <SuperAdminProvider>
        <AuthProvider>
          <ConfigProvider>
            <ThemeProvider defaultMode="dark">
              <Router>
                <DebugRoutes />
                <AppRoutes />
                <UpdatePrompt />
                <ConfirmacaoHost />
                <PedidoPinHost />
                {/* Aviso único: mesmo visual de utils/toast para quem chama toast() direto.
                    Embaixo à direita, acima da barra de navegação do celular. */}
                <Toaster
                  position="bottom-right"
                  reverseOrder={false}
                  gutter={10}
                  containerStyle={{ zIndex: 999999, bottom: 'calc(env(safe-area-inset-bottom) + 84px)', right: '16px' }}
                  toastOptions={{
                    duration: 2500,
                    style: estiloBaseToast,
                    // Aviso que não é anunciado é aviso que não existe: o caixa pode ser
                    // lerdo de vista e o toast dizer "produto vencido". role/aria-live
                    // fazem o leitor de tela falar a mensagem crítica.
                    ariaProps: { role: 'status', 'aria-live': 'polite' },
                    success: { style: { ...estiloBaseToast, borderLeft: '4px solid #10b981' }, iconTheme: { primary: '#10b981', secondary: '#0f172a' } },
                    error: {
                      duration: 6000,
                      style: { ...estiloBaseToast, borderLeft: '4px solid #ef4444' },
                      iconTheme: { primary: '#ef4444', secondary: '#0f172a' },
                      ariaProps: { role: 'alert', 'aria-live': 'assertive' },
                    },
                  }}
                />
              </Router>
            </ThemeProvider>
          </ConfigProvider>
        </AuthProvider>
      </SuperAdminProvider>
    </ErrorBoundary>
  );
};

export default App;
