import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Somma Pedidos',
        short_name: 'Somma',
        description: 'Sistema de Pedidos Somma Gestão Comercial',
        theme_color: '#6D28D9',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Inclui o index.html no PRECACHE (junto com js/css). Assim a "casca" do app
        // fica sempre disponível offline E consistente com os bundles daquela build
        // (o precache é atômico por build; cleanupOutdatedCaches remove o antigo).
        // Isso resolve o offline e também o bug antigo de tela branca pós-deploy —
        // que acontecia porque o index.html ficava num cache SEPARADO dos bundles e
        // apontava para arquivos já removidos. Pré-cacheado, index + bundles batem.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Navegação (inclusive abrindo pelo ícone, offline) serve o index.html do precache.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache-v4',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 500, maxAgeSeconds: 1 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/pub-.*\.r2\.dev\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'r2-images-cache-v1',
              expiration: { maxEntries: 1000, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
