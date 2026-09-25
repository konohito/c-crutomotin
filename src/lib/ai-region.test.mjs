/* motion が使う AI は国内リージョンで呼ぶ（2026-09-25 ユーザー指示
   「motionで使用しているAIはすべて国内リージョンにしてください」）。

   直す前は locations/global を使っており、Google 自身が
   「global はどのリージョンで処理されるか制御も把握もできない」と明記している。
   ここへ送っているのは**利用者の氏名が入った用紙の写真**。

   ★2026-10-15 から 3.x 系は Durable Caching（最大24時間の保存）が既定で有効になる。
     東京に寄せておけば保存先も東京になる。global のままだと保存先も分からない。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const vision = fs.readFileSync(path.join(root, 'functions/src/visionread.js'), 'utf8')

test('ビジョンAIは東京のリージョンエンドポイントを叩く', () => {
  assert.match(vision, /const REGION = 'asia-northeast1'/)
  // ホスト名にも locations にも東京が入っていること（片方だけだと global へ流れる）
  assert.match(vision, /https:\/\/\$\{REGION\}-aiplatform\.googleapis\.com/)
  assert.match(vision, /\/locations\/\$\{REGION\}\//)
})

test('global が残っていない（コメントでの説明は除く）', () => {
  /* 「何をやめたのか」は説明として書いてある。見るのはコードだけ。 */
  const code = vision.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/locations\/global/.test(code), 'locations/global が残っている')
  assert.ok(!/https:\/\/aiplatform\.googleapis\.com/.test(code),
    'リージョン名の付かない aiplatform ホストが残っている（= global）')
})

test('候補モデルは東京で呼べるものだけ', () => {
  const m = /const MODELS = \[\.\.\.new Set\(\[([\s\S]*?)\]\)\]/.exec(vision)
  assert.ok(m, 'MODELS を読み取れない')
  const models = [...m[1].matchAll(/'([a-z0-9.\-]+)'/g)].map(x => x[1])
  assert.ok(models.length > 0, '候補が空')
  /* 東京で呼べることを確認済みのものだけを許す。
     増やすときは、実際に東京で呼べるか確かめてからこの表に足すこと。
     東京に無いモデルを足すと 404 で次の候補へ流れ、静かに精度だけ下がる。 */
  const TOKYO_OK = new Set(['gemini-3.5-flash', 'gemini-2.5-flash'])
  for (const x of models) {
    assert.ok(TOKYO_OK.has(x), `東京で呼べると確認していないモデル: ${x}`)
  }
  assert.equal(models[0], 'gemini-3.5-flash', '先頭は 3.5-flash（国内処理が明記されているもの）')
})

test('preview のモデルを本番の既定にしていない', () => {
  const code = vision.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/preview/.test(code), 'preview 版が残っている（提供保証が無い）')
})

test('なぜ東京にしたかが書いてある', () => {
  assert.match(vision, /国内リージョン/)
  assert.match(vision, /global/)   // 何をやめたのかが分かる
})

test('Document AI のリージョン設定がどこにあるか分かる', () => {
  /* Document AI は日本リージョンが存在しない（us / eu / ムンバイ / シンガポール等のみ）。
     ここは設定で切り替える作りなので、値そのものは検査しない。
     「切り替えられる場所がある」ことだけ固定し、判断はユーザーに残す。 */
  const cfg = fs.readFileSync(path.join(root, 'functions/src/config.js'), 'utf8')
  assert.match(cfg, /DOCAI_LOCATION/)
  assert.match(cfg, /Document AI のロケーション/)
})
