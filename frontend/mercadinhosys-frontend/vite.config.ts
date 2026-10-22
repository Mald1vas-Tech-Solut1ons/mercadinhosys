import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { execSync } from 'node:child_process'

// https://vite.dev/config/
// Versão do build: SHA do commit (Vercel ou git local) + data. Mesmo valor no bundle e em /version.json.
function buildVersion(): string {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
  if (!sha) {
    try { sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* sem git */ }
  }
  const dia = new Date().toISOString().slice(0, 10);
  return `${sha ? sha.slice(0, 7) : 'local'}-${dia}`;
}
const APP_VERSION = buildVersion();

// Publica /version.json (sem cache) para o app detectar deploy novo sem depender do service worker.
const versionJsonPlugin = () => ({
  name: 'emit-version-json',
  generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION, builtAt: new Date().toISOString() }) });
  },
});

export default defineConfig(() => {
  // VITE_API_TARGET é injetado pelo docker-compose.dev.yml como http://backend:5000
  // Se estivermos fora do Docker, 'backend' não será resolvido, então usamos localhost:5000 como fallback.
  // Como não podemos testar DNS de forma síncrona aqui de maneira trivial, 
  // confiamos na variável de ambiente ou assumimos localhost se não estivermos explicitly em um container.
  const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:5000';

  console.log('🔧 Vite proxy configurado para:', apiTarget);

  return {
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    plugins: [
      react(),
      versionJsonPlugin(),
      VitePWA({
        // 'prompt': o SW novo fica em espera até o updateManager decidir o momento seguro de aplicar.
        registerType: 'prompt',
        // Não injeta o registerSW automaticamente — controlamos manualmente
        // para evitar que erros de registro (ex: HTTP, escopo, Safari privado)
        // sejam propagados ao Sentry como erros críticos.
        injectRegister: null,
        devOptions: {
          enabled: false // Desativar SW em dev evita cache stale e erros de escopo
        },
        workbox: {
          // Ignora chamadas de API e arquivos dinâmicos no cache do SW
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/version\.json$/],
          runtimeCaching: [
            {
              urlPattern: /^\/api\//,
              handler: 'NetworkOnly', // API nunca entra em cache offline
            },
          ],
          cleanupOutdatedCaches: true,
          skipWaiting: false,
          clientsClaim: true,
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'MercadinhoSyS ERP',
          short_name: 'MercadinhoSyS',
          description: 'Seu ERP e PDV na palma da mão',
          theme_color: '#0b479e',
          background_color: '#ffffff',
          display: 'standalone',
          // Web Share Target (Android): o lojista lê o QR Code do cupom com a
          // câmera NATIVA do celular e toca em "Compartilhar → MercadinhoSyS".
          // Abre /entrada-nfe?url=...&text=... e a tela já consulta a nota.
          // (O app precisa estar instalado como PWA; iPhone não suporta share target.)
          share_target: {
            action: '/entrada-nfe',
            method: 'GET',
            params: { title: 'title', text: 'text', url: 'url' },
          },
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,           // porta INTERNA do container
      host: true,           // escuta em 0.0.0.0 (necessário no Docker)
      strictPort: true,
      // Cabeçalhos de segurança no dev server (paridade com vercel.json / nginx.conf).
      // camera/geolocation ficam (self): PontoPage usa câmera e PortalEntregador usa GPS.
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
        // CSP ativa, permissiva (calibrada p/ demo): connect-src https:/wss: cobre API Oracle,
        // Sentry, ViaCEP e futuras consultas externas. Backlog: apertar p/ allowlist explicita.
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; " +
          "media-src 'self' blob:; connect-src 'self' https://mercadinhosys-api.144.22.151.18.sslip.io https://o4511655329923072.ingest.us.sentry.io; " +
          "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
      },
      // Detecta mudanças de arquivo dentro do Docker (Windows/WSL precisa de polling)
      watch: {
        usePolling: true,
        interval: 100,
      },
      // HMR (hot reload) através do Docker:
      // o navegador acessa pela porta do HOST (ex.: 80), então o cliente HMR
      // precisa abrir o WebSocket nessa mesma porta — não na porta interna 5173.
      hmr: {
        host: 'localhost',
        clientPort: Number(process.env.VITE_HMR_CLIENT_PORT) || 80,
        protocol: 'ws',
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, '/api'),
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/uploads/, '/uploads'),
        },
      },
    },
  }
})
