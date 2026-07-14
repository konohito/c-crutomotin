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
