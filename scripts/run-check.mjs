/* 検査スクリプトの実行係。
   画面は .jsx なので Node からそのままは読めない。esbuild で 1 ファイルにまとめてから実行する。
   使い方: node scripts/run-check.mjs scripts/check-screens.mjs */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entry = process.argv[2]
if (!entry) { console.error('使い方: node scripts/run-check.mjs <検査スクリプト>'); process.exit(2) }

// 本番と同じ条件（実データ用のラベル・書式）で検査できるよう、.env.hosting の設定を読む
const envFile = new URL('../.env.hosting', import.meta.url).pathname
let cfg = ''
if (existsSync(envFile)) {
  const m = readFileSync(envFile, 'utf8').match(/VITE_FIREBASE_CONFIG=(.*)/)
  if (m) cfg = m[1].trim()
}
const out = join(mkdtempSync(join(tmpdir(), 'motion-check-')), 'bundle.cjs')

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',           // react-dom/server は CommonJS のため cjs で出す
  outfile: out,
  loader: { '.jsx': 'jsx' },
  jsx: 'automatic',
  external: ['firebase/*'],
  logLevel: 'warning',
  define: {
    'import.meta.env': JSON.stringify({
      VITE_FIREBASE_CONFIG: cfg, BASE_URL: '/', MODE: 'hosting', DEV: false, PROD: true,
    }),
  },
})

try {
  execFileSync(process.execPath, [out], { stdio: 'inherit' })
} catch (e) {
  process.exit(e.status || 1)
}
