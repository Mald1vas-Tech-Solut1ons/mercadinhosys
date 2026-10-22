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
                <Toaster
                  position="top-right"
                  reverseOrder={false}
                  gutter={12}
                  containerStyle={{ zIndex: 999999, top: '24px', right: '24px' }}
                  toastOptions={{
                    duration: 2500,
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
