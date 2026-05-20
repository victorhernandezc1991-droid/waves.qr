import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['logo-waves.png', 'icon-192.png', 'icon-512.png', 'vite.svg'],
      manifest: {
        name: 'Waves — Pedidos',
        short_name: 'Waves',
        description: 'Pedí desde tu celular: delivery o presencial',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'es-AR',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        runtimeCaching: [
          // Imágenes de Cloudinary — stale-while-revalidate
          {
            urlPattern: /^https:\/\/res\.cloudinary\.com\/.*\.(?:png|jpg|jpeg|webp|gif|svg)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cloudinary-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Firestore: NUNCA cachear (datos en tiempo real)
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__/, /^\/api/, /^\/assets/, /\.(?:png|jpg|jpeg|svg|json)$/],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Firebase: chunk separado para cachear independiente de la app
          'firebase': [
            'firebase/app',
            'firebase/firestore',
            'firebase/auth',
          ],
          // React solo (sin router, ya no usamos react-router-dom)
          'react-vendor': ['react', 'react-dom'],
          // jsbarcode (~30KB) — solo se usa al confirmar pedido
          'barcode': ['jsbarcode'],
        },
      },
    },
  },
})
