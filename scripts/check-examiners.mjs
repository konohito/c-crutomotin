/* 測定者は「承認済み職員」から選ぶ（★2026-11-08 新設）
 *
 * ★何が起きていたか
 *   `src/data/engine.js` に測定者10名が**固定で書かれていた**。
 *     ① 本番のバンドルと**公開デモ（GitHub Pages）の両方**に、実在の職員の氏名が載っていた。
 *        CLAUDE.md は「公開デモはシードデータのみ・実データは一切含まない」と書いているのに、
 *        実際には**含まれていた**。
 *     ② 測定者の選択肢がこの10名に固定され、**実際に測定した人を記録できなかった**。
 *        職員の追加・解除の仕組み（承認済み職員＝Firestore の staff）は、ここでは使われていなかった。
 *
 * ★この検査が守ること
 *   1) 氏名の一覧をコードに書き戻していないこと
 *   2) 測定者の選択肢が、承認済み職員（state.staffList）から出ていること
 *   3) 古いID（st01〜st10）の氏名の対応表を**コードに持たない**こと
 *      （対応表は Firestore の config/legacyExaminers に置く。GitHub には個人情報を載せない）
 *   4) 対応が付かない古いIDを黙って消さないこと（人数が分からなくなる）
 *
 * 実行: node scripts/check-examiners.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${m}\n      期待: ${JSON.stringify(b)}\n      実際: ${JSON.stringify(a)}`)

const ENGINE = read('src/data/engine.js')
const STORE = read('src/store.jsx')
const MODAL = read('src/modals/EventModal.jsx')
const APP = read('src/App.jsx')
const DB = read('src/lib/db.js')
const DASH = read('src/screens/Dashboard.jsx')

console.log('== 氏名の一覧をコードに持たない ==')
{
  ok(!/export const STAFF\s*=/.test(ENGINE),
    '★測定者の氏名の一覧がコードに書き戻されている（公開デモにも載る）')
  /* 「id と name と role」が並んだ形＝人の一覧。別の名前にして逃げられないよう形で見る */
  ok(!/\{\s*id:\s*['"]st\d+['"]\s*,\s*name:/.test(ENGINE + STORE + MODAL),
    '★測定者の一覧が別の名前で復活している')
  /* 公開デモの見本の予定に測定者を入れない */
  ok(/time: '受付 9:30〜', staff: \[\] \}\)\)/.test(STORE),
    '★見本の予定に測定者を入れている（氏名が公開デモに出る）')
  /* 公開デモの掛け声に氏名を出さない */
  ok(!/D\.STAFF/.test(DASH + STORE + MODAL + APP),
    '★固定の測定者一覧をまだ参照している')
  ok(/const staffFamily = demo\s*\n\s*\? ''/.test(DASH),
    '★公開デモの掛け声に氏名を出している')
  /* ★公開デモのヘッダーにも実在の職員の氏名が1名書かれていた（2026-11-08）。
       見本のときの差し込み先に「姓 名」の形を書かない。
       氏名そのものは検査に書けないので、**形**で見る（漢字2〜4字＋空白＋漢字1〜4字）。 */
  ok(/: '職員'$/m.test(APP),
    '★見本のときのログイン名が「職員」になっていない')
  for (const [label, src] of [['App.jsx', APP], ['Dashboard.jsx', DASH], ['store.jsx', STORE], ['EventModal.jsx', MODAL], ['engine.js', ENGINE]]) {
    /* 文字列として書かれた「姓 名」を探す。見本データの氏名は作られる（SEI/MEI から合成）ので、
       直書きの「姓 名」が残っていたら、それは人の名前である可能性が高い。 */
    const hits = src.split('\n')
      /* 測定項目の見出し（例「握力 右」）は人の名前ではないので外す */
      .filter((ln) => !/\b(label|short|desc|unit|title|placeholder|hint)\s*[:=]/.test(ln))
      .flatMap((ln) => ln.match(/['"][一-鿿]{2,4}[ 　][一-鿿]{1,4}['"]/g) || [])
    ok(hits.length === 0, `★${label} に氏名らしい直書きが ${hits.length} 件ある（公開デモにも出る）`)
  }
}

console.log('== 選択肢は承認済み職員から出す ==')
{
  ok(/state\.staffList\.map\(st =>/.test(MODAL),
    '★測定者の選択肢が承認済み職員から出ていない（実際に測定した人を記録できない）')
  ok(/evStaff: sel \? s\.evStaff\.filter\(x => x !== st\.uid\) : s\.evStaff\.concat\(\[st\.uid\]\)/.test(MODAL),
    '★選んだ人を職員のIDで保存していない（誰が測ったか分からなくなる）')
  /* 1人もいないときに、作りの言葉ではなく次にやることを出す */
  ok(/選べる人がまだいません。「職員」の画面で追加してください。/.test(MODAL),
    '★選べる人がいないときの案内が無い、または次にやることが書かれていない')
  ok(!/スタッフマスタ/.test(MODAL),
    '★「マスタ」という作りの言葉を画面に出している（しかも実際は固定の一覧だった）')
  /* 読み込みの配線 */
  ok(/function useStaffBoot\(\)/.test(APP) && /\n  useStaffBoot\(\)/.test(APP),
    '★承認済み職員を読み込んでいない（選択肢が常に空になる）')
  ok(/listStaff\(\)/.test(APP), '★承認済み職員の一覧を取っていない')
  ok(/staffList: \[\], legacyExaminers: \{\}/.test(STORE),
    '★承認済み職員と対応表の置き場が無い')
}

console.log('== 古いIDの扱い（実物を切り出して動かす）==')
{
  ok(/export async function loadLegacyExaminers\(\)/.test(DB),
    '★古いIDの対応表を Firestore から読む仕組みが無い')
  ok(/fs\.doc\(db, 'config', 'legacyExaminers'\)/.test(DB),
    '★対応表の置き場が config/legacyExaminers になっていない')

  const m = /export const staffNames = [\s\S]*?\n\}\)\.filter\(Boolean\)/.exec(STORE)
  ok(!!m, '★staffNames が無い（測定者の氏名を出せない）')
  const iso = /export function isLegacyExaminerId\([\s\S]*?\n\}/.exec(ENGINE)
  ok(!!iso, '★古いIDの見分け方が無い')
  if (m && iso) {
    const js = iso[0].replace('export function', 'function') + '\n' +
      'const D = { isLegacyExaminerId };\n' +
      m[0].replace('export const', 'const') + '\n; return staffNames;'
    const fn = new Function(js)()

    const staffList = [{ uid: 'u1', name: '担当A' }, { uid: 'u2', name: '  ' }, { uid: 'u3', email: 'u3@example.test' }]
    /* 1) 承認済み職員は氏名で出る */
    eq(fn(['u1'], staffList, {}), ['担当A'], '★承認済み職員の氏名が出ない')
    /* 2) 氏名が空の職員は出さない（空白だけの行を出さない） */
    eq(fn(['u2'], staffList, {}), [], '★氏名が空の職員を空文字で出している')
    /* 3) 古いIDは、対応表があればそれを使う */
    eq(fn(['st01'], staffList, { st01: { name: '担当B' } }), ['担当B'],
      '★対応表があるのに使っていない')
    /* 4) 対応表が無いあいだは「以前の担当者」。黙って消さない（人数が分からなくなる） */
    eq(fn(['st01', 'st02'], staffList, {}), ['以前の担当者', '以前の担当者'],
      '★古いIDを黙って消している（測定者が0名に見える）')
    /* 5) 知らないIDは出さない（別人の名前を当てない） */
    eq(fn(['zzz'], staffList, {}), [], '★知らないIDで何か出している')
    /* 6) 読めない値で落ちない */
    for (const bad of [null, undefined, [], ['']]) {
      eq(fn(bad, staffList, {}), [], `読めない値（${JSON.stringify(bad)}）で何か出している`)
    }
    /* 職員の一覧がまだ読めていないときは、落ちずに何も出さない
       （知らないIDに名前を当てない。読めたら出る） */
    let threw = false
    try { eq(fn(['u1'], null, null), [], '★一覧が未読込なのに名前を出している') }
    catch { threw = true }
    ok(!threw, '★職員の一覧が未読込のときに落ちる')
    /* 7) 古いIDの見分けは形まで見る（st で始まる別のIDを巻き込まない） */
    const isLegacy = new Function(iso[0].replace('export function', 'function') + '; return isLegacyExaminerId;')()
    eq(isLegacy('st01'), true, '★古いIDを見分けられない')
    eq(isLegacy('st10'), true, '★古いIDを見分けられない')
    eq(isLegacy('staff01'), false, '★別のIDを古いIDと取り違えている')
    eq(isLegacy('st1'), false, '★桁数の違うIDを古いIDと取り違えている')
    eq(isLegacy(''), false, '空のIDを古いIDと取り違えている')
    eq(isLegacy(null), false, '値が無いときに落ちる')
  }
}

console.log(fail
  ? `\ncheck-examiners: ${pass} ok, ${fail} failed`
  : `\ncheck-examiners: ${pass} ok, 0 failed`)
process.exit(fail ? 1 : 0)
