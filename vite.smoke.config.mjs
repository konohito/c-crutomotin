import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: '/smoke/',
  plugins: [react()],
  build: { outDir: 'dist-smoke', rollupOptions: { input: 'smoke.html' } },
})
