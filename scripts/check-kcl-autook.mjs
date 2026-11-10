/* 問診票を「職員の確認なしで本登録してよいか」の判定（kclAutoOk）の検査。
 *
 * 【なぜこの検査があるか】
 *   取り込み画面には「自動判定 N 件を一括本登録」がある（Import.jsx の commitReady）。
 *   ここを通った用紙は **1 枚も人が開かずに** measurements へ書かれる。
 *   問診票の行は needsReview を見ておらず（Import.jsx の autoOk）、
 *   ゲートは kclAutoOk だけなので、ここが緩むと
 *   誤った回答が誰の目にも触れずに登録される。
 *
 * 【2026-11-10 に塞いだ穴】
 *   ビジョン AI 単独で読んだ用紙（via: 'vision'）は、幾何ロジックの検算
 *   （四隅マーカー → 用紙座標 → 設問行と はい/いいえ 列見出しで突き合わせ）を
 *   一度も通っていない。にもかかわらず「きれいに全問読めている」と自動で通っていた。
 *   実測で、職員が答えを直した率は幾何ロジック 0% に対し AI 単独 14.2%。
 *   ★OCR_ENGINE=gemini では全問診票が via:'vision' になるため、
 *     ここが「Gemini の読みが無確認で登録される」のを止める唯一の場所になる。
 *
 * 実行: node scripts/run-check.mjs scripts/check-kcl-autook.mjs
 */
import { kclAutoOk } from '../src/ui/kclanswers.jsx'

let ok = 0, ng = 0
const pass = (m) => { ok++; console.log('  ' + m) }
const fail = (m) => { ng++; console.log('  FAIL ' + m) }
const is = (got, want, m) => (got === want ? pass(m) : fail(`${m}（期待 ${want} / 実際 ${got}）`))

// おもて面の公式 No（12=BMI は用紙に無い）。全問 yes の「完璧に読めた」用紙を作る。
const FRONT_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14]
const BACK_KEYS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 'ex1', 'ex2']
const sheet = (via, keys, val) => ({
  side: keys === FRONT_KEYS ? 'front' : 'back',
  readable: true, reason: null, via,
  answers: Object.fromEntries(keys.map((k) => [String(k), val])),
})
const front = (via) => sheet(via, FRONT_KEYS, 'yes')
const back = (via) => sheet(via, BACK_KEYS, 'no')

console.log('== 幾何ロジックの検算を通った用紙は自動で通る（従来どおり）==')
for (const via of ['markers', 'rows', 'markers+vision', 'rows+vision']) {
  is(kclAutoOk(front(via)), true, `via=${via} は自動で通る`)
}

console.log('== ビジョンAI単独は、全問きれいに読めていても自動では通さない ==')
is(kclAutoOk(front('vision')), false,
  'おもて面 via=vision を自動で通さない（検算なしの読みを無確認で登録しない）')
is(kclAutoOk(back('vision')), false, 'うら面 via=vision を自動で通さない')

console.log('== 読取不可・中身なしは通さない ==')
is(kclAutoOk({ ...front('markers'), readable: false }), false, '読取不可は通さない')
is(kclAutoOk(null), false, 'null は通さない')
is(kclAutoOk(undefined), false, 'undefined は通さない')
is(kclAutoOk({}), false, '空の object は通さない')

console.log('== 二重塗り・読み落としがあれば通さない ==')
{
  const k = front('markers'); k.answers['3'] = 'multi'
  is(kclAutoOk(k), false, '二重塗りが1つでもあれば通さない')
}
{
  const k = front('markers'); delete k.answers['3']
  is(kclAutoOk(k), false, '読めていない設問があれば通さない')
}
{
  const k = front('markers')
  for (const key of ['1', '2', '3']) delete k.answers[key]
  is(kclAutoOk(k), false, '読取率が 85% を下回れば通さない（10/13）')
}

console.log('')
if (ng) { console.log(`check-kcl-autook: ${ok} ok, ${ng} failed`); process.exit(1) }
console.log(`check-kcl-autook: ${ok} ok, 0 failed`)
