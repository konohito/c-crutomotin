import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base の切り替え:
//  - 既定(production): GitHub Pages のプロジェクトサイト配下 '/c-crutomotin/'（公開デモ・無変更）
//  - mode=hosting: Firebase Hosting はルート配信のため '/'（本番・ログイン必須）
//    `vite build --mode hosting` のとき .env.hosting が読み込まれ VITE_FIREBASE_CONFIG が入る
export default defineConfig(({ mode }) => ({
  base: mode === 'hosting' ? '/' : '/c-crutomotin/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
  },
}))
