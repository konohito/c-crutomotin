/* 氏名＋生年月日のCSVから、台帳のIDをまとめて調べる（2026-09-23 ユーザー依頼）。

   「名前と生年月日のCSVをアップロードしたら、その人達のアプリ内でのIDが一括で
     検索結果として跳ね返ってくるようなシステムを追加してほしい」

   ★台帳には何も書かない。調べて返すだけ。
     いまの取り込み（store.jsx の importCsvText）は、読んだら必ず台帳へ保存する作りなので、
     そこに相乗りすると「調べるだけのつもりが登録されていた」が起こる。だから別にしている。
   ★突合の判定は merge.js の similarity / findExisting をそのまま使う。
     ここで別の判定を書くと、登録時の重複チェックと結果が食い違う。
   ★同姓同名は生年月日と性別で弾かれる（similarity の中で −4 点）。 */
import { csvSplit } from './helpers.js'
import { findExisting, normName, birthDigits } from './merge.js'

/* CSVの1行目から、どの列が何かを見つける。列の順番は問わない。
   取り込み画面（store.jsx）と同じ見つけ方に揃えてある。 */
export function pickColumns(header) {
  const h = (header || []).map((c) => String(c || '').replace(/[\s　"]/g, ''))
  const find = (re) => h.findIndex((c) => re.test(c))
  return {
    name: find(/氏名|名前|利用者名|お名前/),
    kana: find(/かな|カナ|ふりがな|フリガナ|ヨミ|よみ/),
    birth: find(/生年月日|生年|誕生日/),
    sex: find(/性別/),
  }
}

/* 1行ぶんの照合結果。
   status: 'found'（1人に決まった）/ 'multi'（候補が複数）/ 'none'（見つからない）/ 'invalid'（氏名が空） */
function judgeRow(row, cols, users) {
  const at = (i) => (i >= 0 && i < row.length ? String(row[i] || '').trim() : '')
  const name = at(cols.name), kana = at(cols.kana), birthDate = at(cols.birth), sex = at(cols.sex)
  if (!name) return { name, kana, birthDate, sex, status: 'invalid', id: '', note: '氏名が空です' }

  const hits = findExisting({ name, kana, birthDate, sex }, users)
  if (!hits.length) {
    return { name, kana, birthDate, sex, status: 'none', id: '', note: '台帳に見つかりません' }
  }
  /* どれを「決まった」とみなすか。
     ・merge.js が「ほぼ確実（same）」と言ったもの
     ・または **氏名が完全一致 かつ 生年月日（年月日まで）が完全一致** のもの

     2つめを足しているのは、この画面が「氏名＋生年月日だけのCSV」を受ける前提だから。
     merge.js の点数は ふりがな にも配点があり（登録画面ではふりがなを必ず入れる）、
     ふりがなが無いと 氏名+生年月日が完全に一致しても7点で「要確認」止まりになる。
     氏名と生年月日が年月日まで揃って一致していれば、別人である可能性は十分に低い。
     ★merge.js の点数そのものは変えない。あちらは登録時の重複チェックで使っており、
       基準を緩めると別の画面の挙動まで変わる。 */
  const strong = (x) => x.reasons.includes('氏名が一致') && x.reasons.includes('生年月日が一致')
  const sure = hits.filter((x) => x.level === 'same' || strong(x))
  if (sure.length === 1) {
    return { name, kana, birthDate, sex, status: 'found', id: sure[0].user.id,
      matched: sure[0].user, note: sure[0].reasons.join('・'), candidates: hits }
  }
  const why = sure.length > 1 ? '同じくらい近い方が ' + sure.length + ' 人います'
    : '確実とは言い切れません（' + hits[0].reasons.join('・') + '）'
  return { name, kana, birthDate, sex, status: 'multi', id: '', note: why, candidates: hits.slice(0, 5) }
}

/* CSVの中身 → 照合結果。台帳には何も書かない。
   @param text  CSVの中身（文字コードは呼び出し側で解決済み）
   @param users 台帳（D.users）
   @returns {{ cols, rows, counts, error }} */
export function lookupIdsFromCsv(text, users) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return { cols: null, rows: [], counts: zero(), error: 'ファイルが空です' }

  const header = csvSplit(lines[0])
  const cols = pickColumns(header)
  if (cols.name < 0) {
    return { cols, rows: [], counts: zero(),
      error: '「氏名」の列が見つかりません。1行目に 氏名 と 生年月日 の見出しを入れてください' }
  }
  const list = (users || []).filter((u) => u && u.name && !u.archived)
  const rows = lines.slice(1).map((l, i) => {
    const r = judgeRow(csvSplit(l), cols, list)
    return { no: i + 1, ...r }
  })
  const counts = zero()
  rows.forEach((r) => { counts[r.status] += 1; counts.total += 1 })
  return { cols, rows, counts, error: '' }
}
const zero = () => ({ total: 0, found: 0, multi: 0, none: 0, invalid: 0 })

/* 結果をCSVにする（入力した行＋見つかったID＋理由）。
   Excelで開けるよう BOM 付き・CRLF（既存のCSV出力と同じ作法）。 */
export function resultCsv(rows) {
  const head = ['行', '氏名', 'ふりがな', '生年月日', '性別', 'ID', '結果', '理由']
  const label = { found: '見つかりました', multi: '候補が複数', none: '見つかりません', invalid: '氏名が空' }
  const esc = (v) => {
    const s = String(v == null ? '' : v)
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const body = (rows || []).map((r) => [r.no, r.name, r.kana, r.birthDate, r.sex, r.id, label[r.status] || r.status, r.note].map(esc).join(','))
  return '﻿' + [head.join(','), ...body].join('\r\n') + '\r\n'
}

/* 生年月日が「年しか分からない」行の数。多いときは画面で注意を出す。
   年だけだと同姓同名を見分けられず、候補が複数になりやすい。 */
export function yearOnlyCount(rows) {
  return (rows || []).filter((r) => {
    const d = birthDigits(r.birthDate)
    return d.length > 0 && d.length < 8
  }).length
}

export { normName }
