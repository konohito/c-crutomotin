/* 問診票の回答が測定の保存で消されないこと（2026-10-02 現場報告）。
 *
 * 【何が起きたか】
 *   「cruto-motionで問診票の内容が反映されていないようです」
 *   問診票(commitKclRecognition)と測定記録用紙(commitRecognition)は
 *   **同じ measurements 文書**に入る（どちらも measKeyOf = `{利用者ID}_{評価日}`）。
 *   問診票は { merge: true } で書くのに、測定側は merge 無しの set だったため、
 *   「問診票を先に登録 → 同じ方の測定を登録」の順で **kclAnswers が丸ごと消えていた**。
 *   取り込む順は受付キュー次第なので、消える人と残る人が混ざる。
 *
 * 【ここで縛ること】
 *   ・measurements へ書くところは**すべて merge: true**
 *   ・測定側は毎回すべての列を書く（merge でも古い値が残らない前提を保つ）
 *   ・2つの保存が同じキーを使っていることを明示（別キーにすると今度は測定が2件に増える）
 *
 * 実行: node scripts/check-kcl-preserved.mjs */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/* ★measurements へ書くファイルは db.js だけではない。
   realdata.js の saveMeasurement（引っ越し経路）でも同じ消え方をしていた。
   新しく書く場所が増えたときに見落とさないよう、src/lib の全ファイルを見る。 */
const FILES = ['src/lib/db.js', 'src/lib/realdata.js']
const SRC = readFileSync(join(root, 'src/lib/db.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL ' + m)) }

/* コメントを外した本文で判定する（経緯の説明に当たる誤判定を避ける） */
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

console.log('== measurements への書き込みは必ず merge（src/lib 全体） ==')
let writes = 0
for (const f of FILES) {
  const body = readFileSync(join(root, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const lines = body.split('\n')
  lines.forEach((ln, i) => {
    if (!/(set|setDoc)\s*\(\s*(firestore\.|fs\.)?doc\(\s*db\s*,\s*['"]measurements['"]/.test(ln)) return
    writes++
    /* set(...) が複数行にまたがるので、その行から 6 行ぶんを見る */
    const blk = lines.slice(i, i + 6).join(' ')
    ok(/\{\s*merge:\s*true\s*\}/.test(blk),
      `${f}:${i + 1} の measurements への書き込みに merge: true が無い（別機能の項目を消す）`)
  })
}
ok(writes >= 4, `measurements への書き込みを見つけた（${writes}か所）`)

console.log('== 引っ越し経路で無効化の印が残らないこと ==')
const RD = readFileSync(join(root, 'src/lib/realdata.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
ok(/voided: false \}, \{ merge: true \}/.test(RD),
  '引っ越し先に voided: false を明示していない（merge だと古い無効化の印が残る）')

console.log('== 測定側は毎回すべての列を書く（merge でも古い値が残らない） ==')
ok(/SHEET_COLS\.forEach\(/.test(code), 'buildMeasurementDoc が SHEET_COLS を全部まわしている')
const bd = code.slice(code.indexOf('function buildMeasurementDoc'), code.indexOf('export async function commitKclRecognition'))
ok(/v\[cid\] = \(x === null \|\| x === undefined \|\| x === ''\) \? null :/.test(bd),
  '値が無い列にも null を入れている（列を飛ばすと merge で古い値が残る）')

console.log('== 問診票と測定が同じキーを使っている ==')
const kcl = code.slice(code.indexOf('export async function commitKclRecognition'), code.indexOf('export async function commitRecognition'))
const rec = code.slice(code.indexOf('export async function commitRecognition'))
ok(/measKeyOf\(/.test(kcl), '問診票が measKeyOf を使っている')
ok(/measKeyOf\(/.test(rec.slice(0, 900)), '測定が measKeyOf を使っている')
/* 片方だけ年度キーに戻すと、同じ測定が2件に増える事故が再発する（コメントに実例あり） */
ok(!/`\$\{user\.id\}_\$\{(y|year)\}`/.test(kcl), '問診票が年度キーに戻っていない')

console.log('== 問診票は測定の項目を消さない（逆方向） ==')
ok(/kclAnswers: clean/.test(kcl) && /\{ merge: true \}/.test(kcl), '問診票は merge で kclAnswers だけ足している')

console.log(`\ncheck-kcl-preserved: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
