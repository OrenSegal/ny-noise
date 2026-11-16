import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Each build stamps its data and tile URLs, so a new bundle never reads JSON cached from an older build.
  define: { __DATA_V__: JSON.stringify(Date.now().toString(36)) },
  build: { chunkSizeWarningLimit: 1600 },
})
