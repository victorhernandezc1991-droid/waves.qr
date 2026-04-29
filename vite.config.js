import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
