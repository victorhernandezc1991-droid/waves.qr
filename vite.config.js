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
      includeAssets: ['logo-waves.png', 'afa-logo.png', 'vite.svg'],
      manifest: {
        name: 'Waves — Pedidos QR',
        short_name: 'Waves',
        description: 'Menú digital y sistema de pedidos para restaurantes',
        theme_color: '#0f0f17',
        background_color: '#0f0f17',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/waves',
        lang: 'es-AR',
        icons: [
          { src: '/logo-waves.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/logo-waves.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precachea los assets generados por la build
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        // Excluye chunks raros y el archivo de FCM SW (lo manejamos aparte)
        globIgnores: ['**/firebase-messaging-sw.js'],
        // Estrategias en runtime
        runtimeCaching: [
          // Imágenes de Cloudinary — stale-while-revalidate
          {
            urlPattern: /^https:\/\/res\.cloudinary\.com\/.*\.(?:png|jpg|jpeg|webp|gif|svg)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cloudinary-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 días
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts CSS
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
        // Navegaciones SPA → index.html
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
          // Firebase es ~250KB. Lo aislamos en su propio chunk para que sea
          // cacheable independientemente del código de la app.
          'firebase': [
            'firebase/app',
            'firebase/firestore',
            'firebase/auth',
            'firebase/storage',
            'firebase/messaging',
          ],
          // React + Router juntos (~140KB). Casi nunca cambia entre deploys.
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // jsbarcode (~30KB) — solo se usa al confirmar pedido.
          'barcode': ['jsbarcode'],
        },
      },
    },
  },
})
