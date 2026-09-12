/* 短期集中予防サービス（通所型サービスC。以下 C型）まわりの共通処理。

   測定には目的の違う 2 種類がある（現場の運用を実データで確認済み）。
     city  … 自治体（熊本市・嘉島町など）からの依頼。エリアごとに対象者の最新の状態を
             把握・報告するのが主目的。年 1 回の測定で、翌年また測る（間隔は約 1 年）。
     cType … 短期集中予防サービス。介入の前後を比べるのが主目的で、市へ報告書を出す。
             同じ年度のうちに 2 回測る（実データでは 77〜155 日間隔）。

   どちらの目的かは「測定」の属性（measurements の program）として持つ。
   同じ方が自治体依頼と C型 の両方を受けうるため、利用者に持たせると表せない。
   利用者が C型 対象者かどうかは、この測定側の印から導く（realdata.js の cType）。

   開始時・終了時は保存しない。同じ年度・同じ目的の測定を日付順に並べた
   「最初」と「最後」が開始時・終了時（測定を足せば自動で正しくなる）。 */
import D from '../data/engine.js'
import { compactDate } from './realdata.js'
import { kclScore } from '../data/kihon.js'

export const PROGRAMS = {
  city: '自治体依頼（一般介護予防）',
  cType: '短期集中予防サービス（通所型サービスC）',
}
// 行政提出 CSV の「新総合事業」欄に入れる文言
export const PROGRAM_GOV = { city: '一般介護予防', cType: '短期集中予防サービス' }

const sortKey = (r) => compactDate(r && r.date) || `${r && r.year}0000`

/* その年度の測定を日付順で返す。program を渡すとその目的のものだけに絞る。 */
export function measOfYear(u, year, program) {
  return ((u && u.series) || [])
    .filter(r => Number(r.year) === Number(year) && (!program || r.program === program))
    .slice()
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))
}

/* その年度の「開始時」「終了時」。1 回しか測っていない年は終了時なし（null）。
   提出様式の 評価日_開始時 / 評価日_終了時 はこの組で埋める。 */
export function startEnd(u, year, program) {
  const list = measOfYear(u, year, program)
  if (!list.length) return { start: null, end: null, count: 0 }
  return { start: list[0], end: list.length > 1 ? list[list.length - 1] : null, count: list.length }
}

// 開始時と終了時の日数差
export function daysBetween(a, b) {
  const pa = compactDate(a && a.date), pb = compactDate(b && b.date)
  if (!pa || !pb) return null
  const d = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))
  return Math.round((d(pb) - d(pa)) / 86400000)
}

// 左右のある項目は良い方を採る（提出様式と同じ扱い）
const bestOf = (a, b) => (a === null || a === undefined ? b : (b === null || b === undefined ? a : Math.max(a, b)))

/* 前後比較で見る項目。better は「どちらへ動けば良くなったか」。 */
export const CTYPE_ITEMS = [
  { id: 'walk5', label: '通常5m歩行', unit: '秒', dec: 1, better: 'low', get: (v) => v.walk5 },
  { id: 'walk5max', label: '最大5m歩行', unit: '秒', dec: 1, better: 'low', get: (v) => v.walk5max },
  { id: 'bal', label: '開眼片脚立位', unit: '秒', dec: 1, better: 'high', get: (v) => bestOf(v.balR, v.balL) },
  { id: 'grip', label: '握力', unit: 'kg', dec: 1, better: 'high', get: (v) => bestOf(v.gripR, v.gripL) },
  { id: 'tug', label: 'TUG', unit: '秒', dec: 1, better: 'low', get: (v) => v.tug },
  { id: 'weight', label: '体重', unit: 'kg', dec: 1, better: 'none', get: (v) => v.weight },
  { id: 'bmi', label: 'BMI', unit: '', dec: 1, better: 'none', get: (v) => v.bmi },
]

// 改善・維持・低下の判定（総合スコアの差で見る）
export const verdictOf = (diff) => (diff === null || diff === undefined ? '—' : diff > 0 ? '改善' : diff < 0 ? '低下' : '維持')

const num = (v, dec) => (v === null || v === undefined ? '' : Number(v).toFixed(dec))
const delta = (a, b, dec) => (a === null || a === undefined || b === null || b === undefined ? '' : (b - a >= 0 ? '+' : '') + (b - a).toFixed(dec))

/* C型 の対象者について、年度ごとに「開始時 → 終了時」の 1 行を作る。
   市へ出す報告書・横断共有のもと。終了時がまだ無い方も、そのことが分かるよう 1 行出す。 */
export function ctypeRows(users = D.users) {
  const rows = []
  for (const u of users) {
    if (!u.cType) continue
    const years = [...new Set((u.series || []).filter(r => r.program === 'cType').map(r => Number(r.year)))].sort()
    for (const y of years) {
      const { start, end, count } = startEnd(u, y, 'cType')
      if (!start) continue
      const sv = start.values || {}, ev = (end && end.values) || {}
      const kc = kclScore(u, y)
      const items = CTYPE_ITEMS.map(it => {
        const a = it.get(sv), b = end ? it.get(ev) : null
        return { ...it, start: a, end: b, diff: (a == null || b == null) ? null : Math.round((b - a) * 100) / 100 }
      })
      const totalDiff = end ? end.total - start.total : null
      rows.push({
        user: u, year: y, count,
        startRec: start, endRec: end,
        startDate: start.date || '', endDate: (end && end.date) || '',
        days: end ? daysBetween(start, end) : null,
        totalStart: start.total, totalEnd: end ? end.total : null, totalDiff,
        verdict: end ? verdictOf(totalDiff) : '終了時 未測定',
        items, kclTotal: kc ? kc.total : null,
        improved: items.filter(it => it.diff !== null && it.better !== 'none'
          && ((it.better === 'high' && it.diff > 0) || (it.better === 'low' && it.diff < 0))).length,
        measured: items.filter(it => it.diff !== null && it.better !== 'none').length,
      })
    }
  }
  return rows.sort((a, b) => (a.year - b.year) || a.user.id.localeCompare(b.user.id))
}

/* C型 経過一覧の CSV（市への報告・横断共有用）。 */
export function ctypeCsv(rows) {
  const header = ['年度', '市町村', '行政区（団体）', '参加者ID', '氏名', 'ふりがな', '性別', '生年月日', '年齢',
    '開始日', '終了日', '期間(日)', '測定回数', '総合スコア_開始', '総合スコア_終了', '総合スコア_変化', '判定',
    '改善した項目数', '評価した項目数', '基本CL合計点']
  CTYPE_ITEMS.forEach(it => header.push(`${it.label}_開始${it.unit ? '(' + it.unit + ')' : ''}`,
    `${it.label}_終了${it.unit ? '(' + it.unit + ')' : ''}`, `${it.label}_変化`))
  const body = rows.map(r => {
    const u = r.user
    const line = [r.year, u.muniName, u.venueName, u.id, u.name, u.kana, u.sexLabel, u.birthDate,
      (u.birth ? r.year - u.birth : ''), r.startDate, r.endDate, r.days ?? '', r.count,
      r.totalStart ?? '', r.totalEnd ?? '', r.totalDiff === null ? '' : (r.totalDiff >= 0 ? '+' : '') + r.totalDiff,
      r.verdict, r.improved, r.measured, r.kclTotal ?? '']
    r.items.forEach(it => line.push(num(it.start, it.dec), num(it.end, it.dec), delta(it.start, it.end, it.dec)))
    return line
  })
  return { header, rows: body }
}
