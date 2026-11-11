/* 「体力測定なし」の印が残ったせいで、測定値が画面に 1 つも出ない状態を防ぐ。
 *
 * 【何が起きたか（2026-11-11 本番で実測）】
 *   現場報告「11/6 上仲間、11/9 井寺の結果用紙で、下にある経年変化の折れ線グラフの
 *             R7年が出ていない」
 *
 *   R7（2025年度）の測定 20 件を取り込んだが、**グラフには 1 件も出なかった**。
 *   原因は、その 20 件が先に InBody（体組成）単独の記録として作られており、
 *   `inbodyOnly: true` の印が付いたままだったこと。
 *   `toEngineUser` は印だけを見て `continue` していたので、
 *   **あとから入れた体力測定の値は読まれもしなかった**。
 *
 *   実測: いまの本番データで R7 が推移グラフに出る人 0/20 →（印を無視すると）20/20。
 *
 * 【印の本来の意味】
 *   `inbodyOnly` は「この記録には体力測定が無い」という印で、
 *   スコア 0 の点が推移グラフに出るのを防ぐために付ける
 *   （merge.js / functions/scripts/etl-inbody.py / src/lib/db.js が付ける）。
 *   **値が入ったあとは、この印は古い。** だから値のほうを先に見る。
 *
 * 【ここで縛ること】
 *   1) 判定は `isInbodyOnlyRecord` / `hasFitnessValues` の 1 か所だけ（2 か所に書かない）
 *   2) 体力測定の値がある記録は、印が付いていても測定として数える
 *   3) 体力測定の値が無い記録は、今までどおり印に従って数えない（退行させない）
 *   4) 身長・体重・BMI だけの記録は「体力測定あり」にしない（InBody 単独の記録がこれ）
 *   5) InBody の表示は印を外しても消えない
 *
 * 実行: node scripts/check-inbody-only.mjs */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toEngineUser, hasFitnessValues, isInbodyOnlyRecord, FITNESS_KEYS } from '../src/lib/realdata.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/* ★コメントを外してから見る。説明文そのものに当たって素通り/誤検知するのを防ぐ。 */
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')
const read = (p) => strip(readFileSync(join(root, p), 'utf8'))

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}（期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}）`)

/* 利用者と測定を組み立てる小道具（氏名は使わない） */
const USER = { id: '10001', sex: 'F', name: '', kana: '' }
const FIT = { walk5: 4.2, walk5max: 3.1, balR: 30, balL: 30, gripR: 22, gripL: 22, tug: 7.5 }
const BODY = { height: 150, weight: 48, bmi: 21.3 }
const rec = (over = {}) => ({ userId: USER.id, year: 2025, date: '2025/11/10', values: { ...BODY }, ...over })
/* その年度が推移グラフに出るか（PdfExport.jsx の `u.meas[yy].total` と同じ見方） */
const onGraph = (list, y = 2025) => {
  const m = (toEngineUser(USER, list).meas || {})[y]
  return !!(m && m.total != null)
}

console.log('== 1. 判定は 1 か所だけ ==')
{
  const rd = read('src/lib/realdata.js')
  /* 印を直に見る書き方が戻っていないか（realdata.js の中） */
  ok(!/if\s*\(\s*m\.inbodyOnly\s*\)\s*continue/.test(rd),
    'realdata.js が印だけを見て飛ばしている（値があっても読まれない状態に戻っている）')
  ok(/if\s*\(\s*isInbodyOnlyRecord\(m\)\s*\)\s*continue/.test(rd),
    'isInbodyOnlyRecord を通していない')
  ok(/export function hasFitnessValues/.test(rd), 'hasFitnessValues が公開されていない')
  ok(/export function isInbodyOnlyRecord/.test(rd), 'isInbodyOnlyRecord が公開されていない')
  /* 印を見て「出す／出さない」を決めてよいのは realdata.js だけ。
     ほかの場所が印を見て飛ばすと、同じ判定が 2 つになって必ず食い違う。
     （印を**書く**側 — merge.js / db.js — はここの対象外。書くのは正しい動き） */
  const SKIP = /\binbodyOnly\b[^\n]{0,80}\b(continue|return|filter|skip)\b|\b(continue|return)\b[^\n]{0,40}\binbodyOnly\b/
  const readers = ['src/screens/PdfExport.jsx', 'src/screens/Detail.jsx', 'src/screens/Roster.jsx',
    'src/screens/Analytics.jsx', 'src/screens/Certificate.jsx', 'src/lib/ctype.js', 'src/lib/techo.js']
    .filter((p) => { try { return SKIP.test(read(p)) } catch { return false } })
  eq(readers, [], '印を見て飛ばす判定が realdata.js の外にもある（判定は 1 か所に）')
}

console.log('== 2. 値があれば、印が付いていても測定として数える ==')
{
  /* これが現場で起きていた形: InBody 単独で先に作られ、あとから測定値を足した */
  const after = [rec({ inbodyOnly: true, inbody: { smi: 5.8 }, values: { ...BODY, ...FIT } })]
  ok(onGraph(after), '★値を入れてもグラフに出ない（現場報告そのものの状態）')
  ok(!isInbodyOnlyRecord(after[0]), '値があるのに「体力測定なし」と判定している')
  /* 1 項目だけでも測定として扱う（読めた項目を捨てない） */
  for (const k of FITNESS_KEYS) {
    ok(onGraph([rec({ inbodyOnly: true, values: { ...BODY, [k]: FIT[k] } })]), `${k} だけの記録が数えられていない`)
  }
  /* 0 は「測った結果が 0」。欠測ではないので数える（握力 0 の方が実在した） */
  ok(onGraph([rec({ inbodyOnly: true, values: { ...BODY, ...FIT, gripR: 0, gripL: 0 } })]),
    '0 を欠測として捨てている（測った結果の 0 が消える）')
}

console.log('== 3. 値が無いときは今までどおり数えない ==')
{
  ok(!onGraph([rec({ inbodyOnly: true, inbody: { smi: 5.8 } })]),
    'InBody 単独の記録がスコア 0 の点としてグラフに出ている（退行）')
  ok(isInbodyOnlyRecord(rec({ inbodyOnly: true })), '値の無い記録を測定として数えている')
  ok(isInbodyOnlyRecord(rec({ inbodyOnly: true, values: {} })), '値が空の記録を測定として数えている')
  ok(isInbodyOnlyRecord(rec({ inbodyOnly: true, values: null })), 'values が無い記録で落ちている')
  /* 印が無ければ、そもそも飛ばさない（従来どおり） */
  ok(!isInbodyOnlyRecord(rec({})), '印が無いのに飛ばしている')
  ok(!isInbodyOnlyRecord(rec({ inbodyOnly: false, values: { ...BODY, ...FIT } })), '印が false なのに飛ばしている')
  /* 無効化した記録は、値があっても出さない（voided の扱いを壊していないか） */
  ok(!onGraph([rec({ voided: true, values: { ...BODY, ...FIT } })]),
    '無効化した記録がグラフに出ている')
}

console.log('== 4. 身長・体重・BMI は「体力測定あり」にしない ==')
{
  ok(!hasFitnessValues(BODY), '身長・体重・BMI だけで体力測定ありと判定している')
  ok(!hasFitnessValues({}), '空で体力測定ありと判定している')
  ok(!hasFitnessValues(null), 'null で落ちている')
  ok(!hasFitnessValues({ walk5: null, tug: undefined, gripR: '' }), '空の項目を値ありと数えている')
  ok(!hasFitnessValues({ walk5: 'あ' }), '数字でないものを値ありと数えている')
  ok(hasFitnessValues({ tug: 7.5 }), '数字を値ありと数えていない')
  ok(hasFitnessValues({ tug: '7.5' }), '文字で入った数字を値ありと数えていない')
  ok(hasFitnessValues({ balR: 0 }), '0 を値なしと数えている')
}

console.log('== 5. InBody の表示は消えない ==')
{
  const withIb = [rec({ inbodyOnly: true, inbody: { smi: 5.8, smm: 17.2 }, values: { ...BODY, ...FIT } })]
  const eu = toEngineUser(USER, withIb)
  ok(!!(eu.inbody && eu.inbody[2025]), '測定として数えたら InBody の表示が消えた')
  eq((eu.inbody[2025] || {}).smi, 5.8, 'InBody の値が変わっている')
  /* 問診票の回答も消えない */
  const withKcl = [rec({ inbodyOnly: true, kclAnswers: { q1: 1 }, values: { ...BODY, ...FIT } })]
  ok(!!(toEngineUser(USER, withKcl).kcl || {})[2025], '問診票の回答が読まれなくなっている')

  /* ★ここが肝。**本当に InBody 単独の記録**（体力測定の値が無い）でも、
       InBody と問診票は読めていること。
       読み取りを飛ばす判定より後ろに置くと、この 1 件だけが黙って消える。 */
  const only = [rec({ inbodyOnly: true, inbody: { smi: 5.8 }, kclAnswers: { q1: 1 } })]
  const eo = toEngineUser(USER, only)
  ok(!!(eo.inbody || {})[2025], 'InBody 単独の記録で InBody の表示が消えている（読み取りが飛ばす判定の後ろにある）')
  ok(!!(eo.kcl || {})[2025], 'InBody 単独の記録で問診票の回答が消えている')
  ok(!onGraph(only), 'InBody 単独の記録がグラフに出ている')
  /* 旧形式（inbodySmi）も同じ */
  const old = [rec({ inbodyOnly: true, inbodySmi: 5.8 })]
  ok(!!(toEngineUser(USER, old).inbody || {})[2025], '旧形式の InBody が読まれなくなっている')
}

console.log(`\ncheck-inbody-only: ${pass} ok, ${fail} failed`)
process.exit(fail ? 1 : 0)
