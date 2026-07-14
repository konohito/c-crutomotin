import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { deltaOf, eraOf, fmtD, radarGeo, colsPlus, linePts, pathOf, dotsOf, muniBmiAvg } from '../lib/helpers.js'
import { RadioCard, CheckRow, Select, Overline } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const BASE = import.meta.env.BASE_URL

function commentFor(u, m, prev) {
  const NAMES = { walk: '歩行速度', balance: 'バランス', grip: '筋力（握力）', mobility: '複合動作（TUG）', body: '体格' }
  const ADVICE = { walk: '大股歩きを意識した散歩', balance: '机につかまっての片足立ち練習', grip: 'タオル絞りなどの手指の運動', mobility: '椅子からの立ち座り運動', body: '毎日の体重測定と食事の記録' }
  if (!prev) {
    const best = Object.keys(m.axes).reduce((a, b) => (m.axes[a] >= m.axes[b] ? a : b))
    const worst = Object.keys(m.axes).reduce((a, b) => (m.axes[a] <= m.axes[b] ? a : b))
    return '初回の測定おつかれさまでした。' + NAMES[best] + 'は良好です。' + NAMES[worst] + 'を伸ばすために、' + ADVICE[worst] + 'を週2〜3回続けてみましょう。'
  }
  const dts = Object.keys(m.axes).map(k => ({ k, d: m.axes[k] - prev.axes[k] }))
  const up = dts.slice().sort((a, b) => b.d - a.d)[0]
  const down = dts.slice().sort((a, b) => a.d - b.d)[0]
  let t = ''
  if (up.d > 0) t += NAMES[up.k] + 'が昨年より改善しています。この調子で続けましょう。'
  else t += '全体として昨年の水準を維持できています。'
  if (down.d < 0) t += NAMES[down.k] + 'は低下傾向のため、' + ADVICE[down.k] + 'がおすすめです。'
  else t += '無理のない範囲で活動量を保ちましょう。'
  return t + '次回もお待ちしています。'
}

function buildPage(state, u, y, i, total) {
  const g = radarGeo()
  const m = u.meas[y]
  const ys = Object.keys(u.meas).map(Number).filter(v => v <= y)
  const prevY = ys.length > 1 ? ys[ys.length - 2] : null
  const prev = prevY ? u.meas[prevY] : null
  const muniAgg = D.agg(x => x.muni === u.muni, y)
  const avgHead = u.muniName + '平均'
  const colsBmi = colsPlus()
  const rows = colsBmi.map(c => {
    const d = deltaOf(m.values[c.id], prev ? prev.values[c.id] : null, c.dec, c.better)
    const avg = c.id === 'bmi' ? muniBmiAvg(u.muni, y) : muniAgg.cols[c.id]
    return { id: c.id, label: c.label, unit: c.unit, cur: fmtD(m.values[c.id], c.dec), prev: prev ? fmtD(prev.values[c.id], c.dec) : '—', delta: d.txt, deltaFg: d.fg, avg: avg === null || avg === undefined ? '—' : fmtD(avg, c.dec) }
  })
  const pd = deltaOf(m.total, prev ? prev.total : null, 0, 'high')
  const ad = deltaOf(m.total, muniAgg.total || null, 1, 'high')
  const pts = linePts(D.YEARS.map(yy => ({ year: yy, v: u.meas[yy] && yy <= y ? u.meas[yy].total : null })), D.YEARS, 50, 630, 100, 0, 14, 113)
  const mpts = linePts(D.YEARS.map(yy => ({ year: yy, v: yy <= y ? (D.agg(x => x.muni === u.muni, yy).total || null) : null })), D.YEARS, 50, 630, 100, 0, 14, 113)
  return {
    era: eraOf(y), uid: u.id, date: m.date, issued: D.TODAY,
    name: u.name, kana: u.kana, birth: u.birthDate, age: y - u.birth, sex: u.sexLabel,
    muniVenue: u.muniName + ' · ' + u.venueName, avgHead, rows,
    total: m.total, prevDelta: pd.txt, prevDeltaFg: pd.fg,
    avgDelta: ad.txt, avgDeltaFg: ad.fg,
    rings: g.rings, axesGeo: g.axesGeo,
    polyCur: g.poly(m.axes), polyPrev: prev ? g.poly(prev.axes) : '', polyAvg: muniAgg.count ? g.poly(muniAgg.axes) : '',
    trendPath: pathOf(pts), muniPath: pathOf(mpts),
    trendDots: dotsOf(pts).map(d => ({ x: d.x, y: d.y, ly: d.y < 28 ? d.y + 16 : d.y - 8, v: d.v, year: eraOf(d.year) })),
    pageNo: i + 1,
    commentText: commentFor(u, m, prev),
  }
}

const CELL_LABEL = { padding: '5px 10px', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--slate-600)' }

function PdfPage({ p, state, count }) {
  return (
    <div className="pdf-page" style={{ padding: '52px 56px' }}>
      <div className="retro-corner tl" /><div className="retro-corner tr" /><div className="retro-corner bl" /><div className="retro-corner br" />
      {/* ヘッダー */}
      <div style={{ borderTop: '4px solid var(--brand-500)', paddingTop: 3 }}>
        <div style={{ borderTop: '1px solid var(--slate-900)', paddingTop: 16, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <img src={`${BASE}assets/logo-cruto-mark-only.png`} alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--brand-600)' }}>介護予防事業 · 体力測定</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.02em', marginTop: 1 }}>{p.era}年度 個人結果票</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', border: '1px solid var(--slate-300)', fontSize: 10.5 }}>
            <div style={{ ...CELL_LABEL, borderBottom: '1px solid var(--slate-200)' }}>参加者 ID</div>
            <div className="t-num" style={{ padding: '4px 10px', borderBottom: '1px solid var(--slate-200)', fontWeight: 600 }}>{p.uid}</div>
            <div style={{ ...CELL_LABEL, borderBottom: '1px solid var(--slate-200)' }}>測定日</div>
            <div className="t-num" style={{ padding: '4px 10px', borderBottom: '1px solid var(--slate-200)' }}>{p.date}</div>
            <div style={{ ...CELL_LABEL, borderBottom: 'none' }}>発行日</div>
            <div className="t-num" style={{ padding: '4px 10px' }}>{p.issued}</div>
          </div>
        </div>
      </div>

      {/* 基本情報 */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.7fr 0.7fr 1.6fr', border: '1px solid var(--slate-300)', marginTop: 18 }}>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-200)' }}>氏名</div>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-200)' }}>生年月日</div>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-200)' }}>年齢</div>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-200)' }}>性別</div>
        <div style={CELL_LABEL}>市町村 · 会場</div>
        <div style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-200)' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
          <span style={{ fontSize: 10, color: 'var(--slate-500)', marginLeft: 8 }}>{p.kana}</span>
        </div>
        <div className="t-num" style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-200)', alignSelf: 'center', fontSize: 12 }}>{p.birth}</div>
        <div className="t-num" style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-200)', alignSelf: 'center', fontSize: 12 }}>{p.age} 歳</div>
        <div style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-200)', alignSelf: 'center', fontSize: 12 }}>{p.sex}</div>
        <div style={{ padding: '8px 10px', alignSelf: 'center', fontSize: 11.5 }}>{p.muniVenue}</div>
      </div>

      {/* 測定結果 + レーダー */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 236px', gap: 20, marginTop: 18, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, borderBottom: '2px solid var(--slate-900)', paddingBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>測定結果</span>
            <span style={{ fontSize: 10, color: 'var(--slate-500)' }}>実測値</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.9fr 0.9fr 0.9fr 0.9fr', borderBottom: '1px solid var(--slate-200)', padding: '6px 0 4px', color: 'var(--slate-500)', fontSize: 10, letterSpacing: '0.06em' }}>
            <div>項目</div>
            <div style={{ textAlign: 'right' }}>今回</div>
            <div style={{ textAlign: 'right' }}>前回</div>
            <div style={{ textAlign: 'right' }}>前回比</div>
            <div style={{ textAlign: 'right' }}>{p.avgHead}</div>
          </div>
          {p.rows.map(r => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.9fr 0.9fr 0.9fr 0.9fr', fontSize: 12, borderBottom: '1px solid var(--slate-100)', padding: '5.5px 0', alignItems: 'baseline' }}>
              <div>{r.label} <span style={{ fontSize: 9.5, color: 'var(--slate-400)' }}>{r.unit}</span></div>
              <div className="t-num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.cur}</div>
              <div className="t-num" style={{ textAlign: 'right', color: 'var(--slate-500)' }}>{r.prev}</div>
              <div className="t-num" style={{ textAlign: 'right', fontWeight: 600, color: r.deltaFg }}>{r.delta}</div>
              <div className="t-num" style={{ textAlign: 'right', color: 'var(--slate-500)' }}>{r.avg}</div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'stretch' }}>
            <div style={{ flex: 1, border: '1px solid var(--slate-300)', padding: '10px 14px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--slate-600)' }}>総合スコア</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="t-display" style={{ fontSize: 40, color: 'var(--brand-600)' }}>{p.total}</span>
                <span style={{ fontSize: 11, color: 'var(--slate-500)' }}>/100</span>
              </div>
            </div>
            {state.incPrev && (
              <div style={{ flex: 1, border: '1px solid var(--slate-200)', padding: '10px 14px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--slate-600)' }}>前回比</div>
                <div className="t-num" style={{ fontSize: 22, fontWeight: 700, color: p.prevDeltaFg, marginTop: 6 }}>{p.prevDelta}</div>
              </div>
            )}
            {state.incAvg && (
              <div style={{ flex: 1, border: '1px solid var(--slate-200)', padding: '10px 14px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--slate-600)' }}>{p.avgHead}との差</div>
                <div className="t-num" style={{ fontSize: 22, fontWeight: 700, color: p.avgDeltaFg, marginTop: 6 }}>{p.avgDelta}</div>
              </div>
            )}
          </div>
        </div>
        {state.incRadar && (
          <div style={{ border: '1px solid var(--slate-200)', padding: '12px 10px 8px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--slate-600)', textAlign: 'center' }}>5領域評価（5点満点）</div>
            <svg width="100%" viewBox="0 0 260 232" style={{ display: 'block' }}>
              {p.rings.map((rg, i) => <polygon key={i} points={rg} fill="none" stroke="var(--slate-100)" strokeWidth="1" />)}
              {p.axesGeo.map((ax, i) => (
                <g key={i}>
                  <line x1="130" y1="112" x2={ax.x2} y2={ax.y2} stroke="var(--slate-200)" strokeWidth="1" />
                  <text x={ax.lx} y={ax.ly} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--slate-600)">{ax.label}</text>
                </g>
              ))}
              {p.polyAvg && <polygon points={p.polyAvg} fill="none" stroke="var(--info-500)" strokeWidth="1.3" strokeDasharray="3 3" />}
              {p.polyPrev && <polygon points={p.polyPrev} fill="none" stroke="var(--slate-400)" strokeWidth="1.3" strokeDasharray="5 3" />}
              <polygon points={p.polyCur} fill="rgba(242,106,31,0.14)" stroke="var(--brand-500)" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--slate-600)' }}><span style={{ width: 12, height: 3, background: 'var(--brand-500)' }} />今回</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--slate-600)' }}><span style={{ width: 12, height: 0, borderTop: '2px dashed var(--slate-400)' }} />前回</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--slate-600)' }}><span style={{ width: 12, height: 0, borderTop: '2px dotted var(--info-500)' }} />{p.avgHead}</span>
            </div>
          </div>
        )}
      </div>

      {/* 推移グラフ */}
      {state.incTrend && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, borderBottom: '2px solid var(--slate-900)', paddingBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>総合スコアの推移</span>
            <span style={{ fontSize: 10, color: 'var(--slate-500)' }}>実線 = 本人 / 破線 = {p.avgHead}</span>
          </div>
          <svg width="100%" height="150" viewBox="0 0 660 150" preserveAspectRatio="none" style={{ display: 'block', marginTop: 8 }}>
            {[['100', 14], ['75', 47], ['50', 80], ['25', 113]].map(([lb, yy]) => (
              <g key={lb}>
                <line x1="26" y1={yy} x2="650" y2={yy} stroke={yy === 113 ? 'var(--slate-200)' : 'var(--slate-100)'} strokeWidth="1" />
                <text x="21" y={yy + 4} textAnchor="end" fontSize="9" fill="var(--slate-400)" fontFamily="Inter">{lb}</text>
              </g>
            ))}
            <path d={p.muniPath} fill="none" stroke="var(--slate-300)" strokeWidth="1.3" strokeDasharray="5 4" />
            <path d={p.trendPath} fill="none" stroke="var(--brand-500)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            {p.trendDots.map((d, i) => (
              <g key={i}>
                <circle cx={d.x} cy={d.y} r="3.5" fill="#fff" stroke="var(--brand-500)" strokeWidth="1.8" />
                <text x={d.x} y={d.ly} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--slate-700)" fontFamily="Inter">{d.v}</text>
                <text x={d.x} y="140" textAnchor="middle" fontSize="9" fill="var(--slate-500)" fontFamily="Inter">{d.year}</text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* コメント */}
      {state.incComment && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 14, marginTop: 16, alignItems: 'stretch' }}>
          <div style={{ border: '1px solid var(--slate-300)' }}>
            <div style={{ ...CELL_LABEL, letterSpacing: '0.1em' }}>総合コメント</div>
            <div style={{ padding: '4px 12px 10px', position: 'relative', minHeight: 80 }}>
              {[26, 52, 78].map(t => <div key={t} style={{ position: 'absolute', left: 12, right: 12, top: t, borderBottom: '1px dotted var(--slate-300)' }} />)}
              <div className="t-hand" style={{ position: 'relative', fontSize: 13.5, lineHeight: '26px', color: 'var(--slate-800)' }}>{p.commentText}</div>
            </div>
          </div>
          <div style={{ border: '1px solid var(--slate-300)', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ borderRight: '1px solid var(--slate-200)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '4px 0', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--slate-600)', textAlign: 'center' }}>記入者</div>
              <div className="t-hand" style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 44, fontSize: 14, color: 'var(--slate-800)' }}>相馬</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '4px 0', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--slate-600)', textAlign: 'center' }}>確認印</div>
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 44 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', display: 'grid', placeItems: 'center', fontSize: 13, transform: 'rotate(-6deg)', opacity: 0.8, fontFamily: 'serif' }}>相馬</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* フッター */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--slate-900)', paddingTop: 3 }}>
        <div style={{ borderTop: '3px solid var(--brand-500)', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="t-display" style={{ fontSize: 12, letterSpacing: '0.05em', color: 'var(--slate-700)' }}>Cruto motion</span>
          <span style={{ fontSize: 9.5, color: 'var(--slate-500)' }}>介護予防・体力測定管理システム — Community Station</span>
          <span style={{ flex: 1 }} />
          <span className="t-num" style={{ fontSize: 10, color: 'var(--slate-500)' }}>{p.pageNo} / {count}</span>
        </div>
      </div>
    </div>
  )
}

export default function PdfExport() {
  const { state, set } = useStore()
  const y = state.pdfYear
  const pdfUser = state.pdfUser || (D.users.find(u => u.meas[y]) || {}).id
  let scope
  if (state.pdfMode === 'single') { const u = D.users.find(x => x.id === pdfUser && x.meas[y]); scope = u ? [u] : [] }
  else if (state.pdfMode === 'muni') scope = D.users.filter(u => u.muni === state.pdfMuni && u.meas[y])
  else scope = D.users.filter(u => u.meas[y])
  const pages = scope.slice(0, 30).map((u, i) => buildPage(state, u, y, i, Math.min(scope.length, 30)))
  const q = state.pdfQ.trim().toLowerCase()
  const cands = D.users.filter(u => u.meas[y] && (!q || u.name.toLowerCase().includes(q) || u.kana.toLowerCase().includes(q) || u.id.includes(q))).slice(0, 7)
  const opt = (v, l) => ({ v, l })
  const modes = [
    { id: 'single', label: '1 名を選んで出力', desc: '個人結果票 1 ページ' },
    { id: 'muni', label: '市町村ごとに一括出力', desc: '対象者全員分をまとめて' },
    { id: 'all', label: '全員を一括出力', desc: '年度の測定済 全員分' },
  ]
  const incs = [
    ['incRadar', 'レーダーチャート'], ['incTrend', '時系列の推移グラフ'], ['incPrev', '前回との比較'], ['incAvg', '市町村平均との比較'], ['incComment', '総合コメント欄'],
  ]

  return (
    <div className="print-screen" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', minHeight: 0 }}>
      {/* 設定パネル */}
      <div className="noprint" style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <Overline style={{ marginBottom: 8 }}>出力対象</Overline>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {modes.map(mo => (
              <RadioCard key={mo.id} on={state.pdfMode === mo.id} label={mo.label} desc={mo.desc} onClick={() => set({ pdfMode: mo.id })} />
            ))}
          </div>
        </div>
        {state.pdfMode === 'single' && (
          <div>
            <Overline style={{ marginBottom: 8 }}>利用者を選択</Overline>
            <input className="field" style={{ height: 38, fontSize: 13 }} placeholder="氏名・ID で絞り込み…" value={state.pdfQ} onChange={(e) => set({ pdfQ: e.target.value })} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
              {cands.map(u => (
                <div key={u.id} onClick={() => set({ pdfUser: u.id })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: u.id === pdfUser ? 'var(--brand-50)' : 'transparent', cursor: 'pointer' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                    <div className="t-num" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{u.id} · {u.muniName}</div>
                  </div>
                  {u.id === pdfUser && <Icon name="check" size={15} strokeWidth={2.2} style={{ color: 'var(--brand-600)' }} />}
                </div>
              ))}
            </div>
          </div>
        )}
        {state.pdfMode === 'muni' && (
          <div>
            <Overline style={{ marginBottom: 8 }}>市町村</Overline>
            <Select value={state.pdfMuni} onChange={(e) => set({ pdfMuni: e.target.value })} options={D.MUNIS.map(m => opt(m.id, m.name))} style={{ width: '100%' }} />
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.6 }}>
              {eraOf(y)}年度 測定済 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{scope.length}</span> 名が対象です（プレビューは先頭 30 名）
            </div>
          </div>
        )}
        {state.pdfMode === 'all' && (
          <div style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.7 }}>
            {eraOf(y)}年度 測定済の全 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{scope.length}</span> 名が対象です（プレビューは先頭 30 名。実運用では市町村ごとの分割出力を推奨します）
          </div>
        )}
        <div>
          <Overline style={{ marginBottom: 8 }}>年度</Overline>
          <Select value={state.pdfYear} onChange={(e) => set({ pdfYear: Number(e.target.value) })}
            options={D.YEARS.slice().reverse().map(yy => opt(yy, eraOf(yy) + '年度（' + yy + '）'))} style={{ width: '100%' }} />
        </div>
        <div>
          <Overline style={{ marginBottom: 8 }}>掲載内容</Overline>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {incs.map(([k, label]) => (
              <CheckRow key={k} on={state[k]} label={label} onClick={() => set({ [k]: !state[k] })} />
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
            <span className="t-num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)' }}>{pages.length}</span> 名 · <span className="t-num">{pages.length}</span> ページ · A4 縦
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => window.print()}>
            <Icon name="download" size={17} strokeWidth={1.8} />
            PDF に出力
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.6 }}>印刷ダイアログで「PDF に保存」を選択してください。1 名 1 ページで出力されます。</div>
        </div>
      </div>

      {/* プレビュー */}
      <div className="pdf-stage">
        <div className="pdf-pages">
          {pages.map(p => <PdfPage key={p.uid} p={p} state={state} count={pages.length} />)}
        </div>
      </div>
    </div>
  )
}
