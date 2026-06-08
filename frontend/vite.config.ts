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
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Desativa o fallback de navegação pré-cacheado (index.html). Por padrão o
        // Workbox serve um index.html "congelado" do cache para qualquer navegação —
        // mas esse HTML aponta para os arquivos JS/CSS com hash da build em que foi
        // gerado. A cada novo deploy esses arquivos antigos são removidos do servidor,
        // então abrir o app (inclusive pelo ícone na tela de início do iPad/Android)
        // carregava um index.html cacheado apontando para um bundle que não existe
        // mais (404) e a página ficava em branco, sem o React nunca montar.
        // Com `navigateFallback` desligado e a rota abaixo, a navegação sempre busca
        // o index.html mais recente da rede primeiro (com cache só como reserva).
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache-v2',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 5, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
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
