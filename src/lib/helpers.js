import D from '../data/engine.js'

export const eraOf = (y) => D.ERA[y] || String(y)

export const fmtD = (v, dec) => D.fmt(v, dec)

// 前回比の表示テキストと色（better: 'low' | 'high' | 'none'）
export function deltaOf(cur, prev, dec, better) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return { txt: '—', fg: 'var(--fg-4)' }
  const d = Math.round((cur - prev) * 10) / 10
  const txt = (d > 0 ? '+' : '') + fmtD(d, dec)
  if (d === 0) return { txt: '±0', fg: 'var(--fg-3)' }
  if (better === 'none') return { txt, fg: 'var(--fg-3)' }
  const good = better === 'low' ? d < 0 : d > 0
  return { txt, fg: good ? 'var(--success-700)' : 'var(--danger-700)' }
}

// '2025/09/24' → '9/24（水）'
export function mdw(ds) {
  const m = String(ds || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (!m) return String(ds || '')
  const dt = new Date(+m[1], +m[2] - 1, +m[3])
  return (+m[2]) + '/' + (+m[3]) + '（' + '日月火水木金土'[dt.getDay()] + '）'
}

export function addDays(ds, n) {
  const m = ds.split('/').map(Number)
  const dt = new Date(m[0], m[1] - 1, m[2] + n)
  return dt.getFullYear() + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + String(dt.getDate()).padStart(2, '0')
}

// ---- chart geometry ---------------------------------------------------------
export function linePts(series, years, x0, x1, vTop, vBot, yTop, yBot) {
  const n = years.length
  const xs = (i) => x0 + (n > 1 ? (i * (x1 - x0)) / (n - 1) : 0)
  const ys = (v) => yTop + ((vTop - v) * (yBot - yTop)) / (vTop - vBot)
  return series.filter(p => p.v !== null && p.v !== undefined).map(p => {
    const i = years.indexOf(p.year)
    return { x: Math.round(xs(i)), y: Math.round(Math.max(yTop - 6, Math.min(yBot + 4, ys(p.v)))), v: p.v, year: p.year }
  })
}
export const pathOf = (pts) => (pts.length ? pts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ') : '')
export const dotsOf = (pts) => pts.map(p => ({ x: p.x, y: p.y, ly: p.y < 34 ? p.y + 18 : p.y - 9, v: p.v, year: p.year }))

// 値域を自動決定してポリラインを作る
export function autoLines(seriesList, years, x0, x1, yTop, yBot) {
  const vals = []
  seriesList.forEach(sr => sr.pts.forEach(p => { if (p.v !== null && p.v !== undefined) vals.push(p.v) }))
  if (!vals.length) return { lines: seriesList.map(sr => ({ ...sr, path: '', pts: [] })), ticks: [] }
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (lo === hi) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.14; lo -= pad; hi += pad
  const xs = (i) => x0 + (years.length > 1 ? (i * (x1 - x0)) / (years.length - 1) : 0)
  const ys = (v) => yTop + ((hi - v) * (yBot - yTop)) / (hi - lo)
  const lines = seriesList.map(sr => {
    const pts = sr.pts.filter(p => p.v !== null && p.v !== undefined).map(p => ({ x: Math.round(xs(years.indexOf(p.year))), y: Math.round(ys(p.v)), v: p.v, year: p.year }))
    return { ...sr, path: pathOf(pts), pts }
  })
  const ticks = [0, 1, 2, 3].map(i => { const v = lo + ((hi - lo) * i) / 3; return { y: Math.round(ys(v)), v: Math.round(v * 10) / 10 } })
  return { lines, ticks }
}

// ---- radar geometry (260 × 232, 中心 130,112, 半径 84) -------------------------
let _rg = null
export function radarGeo() {
  if (_rg) return _rg
  const cx = 130, cy = 112, RR = 84
  const ang = (i) => (-90 + i * 72) * Math.PI / 180
  const pt = (i, r) => (cx + r * Math.cos(ang(i))).toFixed(1) + ',' + (cy + r * Math.sin(ang(i))).toFixed(1)
  const rings = [1, 2, 3, 4, 5].map(s => [0, 1, 2, 3, 4].map(i => pt(i, (RR * s) / 5)).join(' '))
  const labels = ['歩行速度', 'バランス', '筋力', '複合動作', '体格']
  const axesGeo = labels.map((label, i) => {
    const x2 = cx + RR * Math.cos(ang(i)), y2 = cy + RR * Math.sin(ang(i))
    const lx = cx + (RR + 22) * Math.cos(ang(i)), ly = cy + (RR + 22) * Math.sin(ang(i)) + 4
    return { x2: x2.toFixed(1), y2: y2.toFixed(1), lx: lx.toFixed(1), ly: ly.toFixed(1), label }
  })
  _rg = { rings, axesGeo, poly: (ax) => [0, 1, 2, 3, 4].map(i => pt(i, (RR * Math.max(0.4, [ax.walk, ax.balance, ax.grip, ax.mobility, ax.body][i])) / 5)).join(' ') }
  return _rg
}

// ---- metric helpers -----------------------------------------------------------
export const colsPlus = () => D.COLS.concat([{ id: 'bmi', label: 'BMI', short: 'BMI', unit: '', dec: 1, better: 'none' }])
export const betterNote = (col) => (col.better === 'low' ? '値が小さいほど良好' : col.better === 'high' ? '値が大きいほど良好' : '')

export function itemAvg(usersArr, y, cid) {
  let sum = 0, n = 0
  usersArr.forEach(u => {
    const m = u.meas[y]
    if (!m) return
    const v = cid === 'total' ? m.total : m.values[cid]
    if (v !== null && v !== undefined && !isNaN(v)) { sum += v; n++ }
  })
  return n ? sum / n : null
}

export function muniBmiAvg(muni, y) {
  const rows = D.users.filter(x => x.muni === muni && x.meas[y] && x.meas[y].values.bmi !== null)
  if (!rows.length) return null
  return rows.reduce((a, x) => a + x.meas[y].values.bmi, 0) / rows.length
}

// ---- CSV --------------------------------------------------------------------
export function csvSplit(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur); return out
}
export function parseBirthYear(sv) {
  let m = String(sv).match(/(\d{4})/); if (m) return +m[1]
  m = String(sv).match(/[SsＳ昭]\D*(\d{1,2})/); if (m) return 1925 + +m[1]
  m = String(sv).match(/[TtＴ大]\D*(\d{1,2})/); if (m) return 1911 + +m[1]
  return 1950
}

// ---- フレイル簡易評価（J-CHS 基準を参考にした体力測定版） -------------------------
// 測定値から判定できる 5 項目。3 項目以上該当でフレイル相当、1〜2 項目でプレフレイル相当。
// 問診（疲労感・活動量）を含む正式なフレイル診断ではない点に注意。
export const FRAIL_ITEMS = [
  { id: 'walk',   label: '歩行速度の低下', short: '歩行',    desc: '５ｍ通常歩行 1.0 秒/m 以上' },
  { id: 'grip',   label: '筋力の低下',    short: '筋力',    desc: '握力 男性 28kg / 女性 18kg 未満' },
  { id: 'bal',    label: 'バランスの低下', short: 'バランス', desc: '開眼片足立ち 5 秒未満' },
  { id: 'tug',    label: '複合動作の低下', short: '複合動作', desc: 'TUG 13.5 秒以上' },
  { id: 'weight', label: '低栄養の傾向',  short: '体重',    desc: 'BMI 18.5 未満 または 前年比 -2kg 以上' },
]

export const FRAIL_LEVELS = {
  frail: { label: 'フレイル相当', bg: 'var(--danger-50)', fg: 'var(--danger-700)', bar: 'var(--danger-500)' },
  pre:   { label: 'プレフレイル相当', bg: 'var(--warning-50)', fg: 'var(--warning-700)', bar: 'var(--warning-500)' },
  ok:    { label: '良好', bg: 'var(--success-50)', fg: 'var(--success-700)', bar: 'var(--success-500)' },
}

export function frailtyOf(u, y) {
  const m = u.meas[y]
  if (!m) return null
  const v = m.values
  const prevYs = Object.keys(u.meas).map(Number).filter(x => x < y).sort((a, b) => b - a)
  const prev = prevYs.length ? u.meas[prevYs[0]] : null
  const grip = Math.max(v.gripR ?? -1, v.gripL ?? -1)
  const bal = Math.max(v.balR ?? -1, v.balL ?? -1)
  const hits = {
    walk: v.walk5 !== null && v.walk5 !== undefined && v.walk5 >= 1.0,
    grip: grip >= 0 && grip < (u.sex === 'M' ? 28 : 18),
    bal: bal >= 0 && bal < 5,
    tug: v.tug !== null && v.tug !== undefined && v.tug >= 13.5,
    weight: (v.bmi !== null && v.bmi !== undefined && v.bmi < 18.5) ||
      (!!prev && v.weight !== null && prev.values.weight !== null && prev.values.weight - v.weight >= 2),
  }
  const n = Object.values(hits).filter(Boolean).length
  const level = n >= 3 ? 'frail' : n >= 1 ? 'pre' : 'ok'
  const hitShorts = FRAIL_ITEMS.filter(it => hits[it.id]).map(it => it.short)
  return { hits, n, pct: n * 20, level, hitShorts }
}

// 結果票・行政提出データ共通の総合コメント自動生成（前回測定との比較ベース）
// 結果票のコメント欄（罫線 2 行 ≒ 57 字）に収まる長さで生成する
export function commentFor(u, m, prev) {
  const NAMES = { walk: '歩行速度', balance: 'バランス', grip: '筋力（握力）', mobility: '複合動作（TUG）', body: '体格' }
  const ADVICE = { walk: '大股歩きを意識した散歩', balance: '机につかまっての片足立ち練習', grip: 'タオル絞りなどの手指の運動', mobility: '椅子からの立ち座り運動', body: '毎日の体重測定と食事の記録' }
  const tail = (t) => (t.length <= 44 ? t + '次回もお待ちしています。' : t)
  if (!prev) {
    const best = Object.keys(m.axes).reduce((a, b) => (m.axes[a] >= m.axes[b] ? a : b))
    const worst = Object.keys(m.axes).reduce((a, b) => (m.axes[a] <= m.axes[b] ? a : b))
    return tail('初回の測定おつかれさまでした。' + NAMES[best] + 'は良好です。' + NAMES[worst] + 'には' + ADVICE[worst] + 'がおすすめです。')
  }
  const dts = Object.keys(m.axes).map(k => ({ k, d: m.axes[k] - prev.axes[k] }))
  const up = dts.slice().sort((a, b) => b.d - a.d)[0]
  const down = dts.slice().sort((a, b) => a.d - b.d)[0]
  let t = up.d > 0 ? NAMES[up.k] + 'が昨年より改善しています。' : '全体として昨年の水準を維持できています。'
  t += down.d < 0 ? NAMES[down.k] + 'は低下傾向のため、' + ADVICE[down.k] + 'がおすすめです。' : '無理のない範囲で活動量を保ちましょう。'
  return tail(t)
}

// ログイン時刻と季節でひとことが変わる、さりげない掛け声。
// 時間帯(朝/昼/夕/夜/深夜) × 季節(春夏秋冬)で「あいさつ」と「ひとこと」を返す。
// 介護予防の現場向けに、体調を気づかう穏やかなトーンにしている。
export function loginGreeting(now = new Date()) {
  const h = now.getHours()
  const m = now.getMonth() + 1
  const time = h < 5 ? 'late' : h < 11 ? 'morning' : h < 17 ? 'day' : h < 21 ? 'evening' : 'night'
  const season = (m >= 3 && m <= 5) ? 'spring' : (m >= 6 && m <= 8) ? 'summer' : (m >= 9 && m <= 11) ? 'autumn' : 'winter'
  const hello = {
    morning: 'おはようございます',
    day: 'おつかれさまです',
    evening: 'おつかれさまです',
    night: 'こんばんは',
    late: '遅くまでおつかれさまです',
  }[time]
  const asides = {
    spring: { morning: '桜のころ、あたたかくなってきましたね', day: '春の陽気が心地よい一日です', evening: '日が長くなってきましたね', night: '夜風がやわらかい季節です', late: '朝晩はまだ冷えます、ご無理なく' },
    summer: { morning: '暑くなりそうです、水分補給をお忘れなく', day: '暑い日が続きます、こまめに休憩を', evening: '夕暮れが涼しくなってきますね', night: '寝苦しい頃です、お体を大切に', late: '暑さの残る夜、ご無理なく' },
    autumn: { morning: '秋晴れが気持ちいい朝ですね', day: '過ごしやすい季節になりました', evening: '日暮れが早くなってきましたね', night: '虫の音が心地よい頃ですね', late: '朝晩は冷えます、暖かくして' },
    winter: { morning: '冷え込む朝、暖かくしてどうぞ', day: '寒い日が続きます、ご自愛ください', evening: '早い日暮れ、足元にお気をつけて', night: '冷えますね、暖かくしてお過ごしを', late: '底冷えする夜、ご無理なく' },
  }
  return { hello, aside: asides[season][time], time, season }
}
