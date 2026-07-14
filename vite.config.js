import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages のプロジェクトサイト配下で配信するため base を固定する
export default defineConfig({
  base: '/c-crutomotin/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
  },
})
