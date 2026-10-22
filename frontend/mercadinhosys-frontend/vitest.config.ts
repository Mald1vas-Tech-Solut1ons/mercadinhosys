import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'virtual:pwa-register': path.resolve(__dirname, 'src/test/pwa-register-stub.ts') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: [
        'src/hooks/usePDV.ts',
        'src/hooks/useOfflineQueue.ts',
        'src/features/pdv/offlineCatalog.ts',
        'src/lib/db.ts',
        'src/pwa/updateManager.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 40, statements: 40, functions: 40, branches: 40 },
    },
  },
})
