import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { deltaOf, eraOf, fmtD, colsPlus, linePts, pathOf, dotsOf, muniBmiAvg, frailtyOf, FRAIL_ITEMS, FRAIL_LEVELS } from '../lib/helpers.js'
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

// PDF 専用のレーダー（ラベルを大きく描くため広めの viewBox を使う）
function pdfRadarGeo() {
  const cx = 160, cy = 122, RR = 88
  const ang = (i) => (-90 + i * 72) * Math.PI / 180
  const pt = (i, r) => (cx + r * Math.cos(ang(i))).toFixed(1) + ',' + (cy + r * Math.sin(ang(i))).toFixed(1)
  const rings = [1, 2, 3, 4, 5].map(s => [0, 1, 2, 3, 4].map(i => pt(i, (RR * s) / 5)).join(' '))
  const labels = ['歩行速度', 'バランス', '筋力', '複合動作', '体格']
  const axesGeo = labels.map((label, i) => {
    const x2 = cx + RR * Math.cos(ang(i)), y2 = cy + RR * Math.sin(ang(i))
    const lx = cx + (RR + 27) * Math.cos(ang(i)), ly = cy + (RR + 27) * Math.sin(ang(i)) + 6
    return { x2: x2.toFixed(1), y2: y2.toFixed(1), lx: lx.toFixed(1), ly: ly.toFixed(1), label }
  })
  return { rings, axesGeo, poly: (ax) => [0, 1, 2, 3, 4].map(i => pt(i, (RR * Math.max(0.4, [ax.walk, ax.balance, ax.grip, ax.mobility, ax.body][i])) / 5)).join(' ') }
}
const PG = pdfRadarGeo()

function buildPage(state, u, y, i) {
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
  const pts = linePts(D.YEARS.map(yy => ({ year: yy, v: u.meas[yy] && yy <= y ? u.meas[yy].total : null })), D.YEARS, 56, 630, 100, 0, 16, 108)
  const mpts = linePts(D.YEARS.map(yy => ({ year: yy, v: yy <= y ? (D.agg(x => x.muni === u.muni, yy).total || null) : null })), D.YEARS, 56, 630, 100, 0, 16, 108)
  const frail = frailtyOf(u, y)
  const inbody = u.inbody && u.inbody[y] ? u.inbody[y] : null
  const ibPrevY = u.inbody ? Object.keys(u.inbody).map(Number).filter(v => v < y).sort((a, b) => b - a)[0] : null
  const inbodyPrev = ibPrevY ? u.inbody[ibPrevY] : null
  return {
    era: eraOf(y), uid: u.id, date: m.date, issued: D.TODAY,
    name: u.name, kana: u.kana, birth: u.birthDate, age: y - u.birth, sex: u.sexLabel, sexKey: u.sex,
    muniVenue: u.muniName + ' · ' + u.venueName, avgHead, rows,
    total: m.total, prevDelta: pd.txt, prevDeltaFg: pd.fg,
    polyCur: PG.poly(m.axes), polyPrev: prev ? PG.poly(prev.axes) : '', polyAvg: muniAgg.count ? PG.poly(muniAgg.axes) : '',
    trendPath: pathOf(pts), muniPath: pathOf(mpts),
    trendDots: dotsOf(pts).map(d => ({ x: d.x, y: d.y, ly: d.y < 34 ? d.y + 22 : d.y - 11, v: d.v, year: eraOf(d.year) })),
    pageNo: i + 1,
    commentText: commentFor(u, m, prev),
    frail, inbody, inbodyPrev,
  }
}

const PDF_LABELS = { walk5: '５ｍ歩行', balR: '片足立ち 右', balL: '片足立ち 左', gripR: '握力 右', gripL: '握力 左', tug: 'TUG', height: '身長', weight: '体重', bmi: 'BMI' }

const CELL_LABEL = { padding: '4px 10px', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 12, letterSpacing: '0.06em', color: 'var(--slate-600)' }

function ScoreBox({ label, children, border = 'var(--slate-300)', flex = 1 }) {
  return (
    <div style={{ flex, border: `1px solid ${border}`, padding: '6px 14px 8px', minWidth: 0 }}>
      <div style={{ fontSize: 13, letterSpacing: '0.08em', color: 'var(--slate-600)' }}>{label}</div>
      {children}
    </div>
  )
}

function PdfPage({ p, state, count }) {
  const fl = p.frail ? FRAIL_LEVELS[p.frail.level] : null
  const smiCut = p.sexKey === 'M' ? 7.0 : 5.7
  const ibRows = p.inbody ? [
    ['骨格筋量', p.inbody.smm, 'kg', p.inbodyPrev?.smm],
    ['体脂肪率', p.inbody.fatPct, '%', p.inbodyPrev?.fatPct],
    ['SMI（骨格筋指数）', p.inbody.smi, 'kg/m²', p.inbodyPrev?.smi],
    ['InBody 点数', p.inbody.score, '点', p.inbodyPrev?.score],
  ] : []
  return (
    <div className="pdf-page" style={{ padding: '34px 44px', lineHeight: 1.35 }}>
      <div className="retro-corner tl" /><div className="retro-corner tr" /><div className="retro-corner bl" /><div className="retro-corner br" />

      {/* ヘッダー */}
      <div style={{ borderTop: '4px solid var(--brand-500)', paddingTop: 3 }}>
        <div style={{ borderTop: '1px solid var(--slate-900)', paddingTop: 9, display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src={`${BASE}assets/logo-cruto-mark-only.png`} alt="" style={{ width: 42, height: 42, objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--brand-600)' }}>介護予防事業 · 体力測定</div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.02em' }}>{p.era}年度 個人結果票</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', border: '1px solid var(--slate-300)', fontSize: 12 }}>
            <div style={{ ...CELL_LABEL }}>参加者 ID</div>
            <div className="t-num" style={{ padding: '4px 10px', borderBottom: '1px solid var(--slate-200)', fontWeight: 600 }}>{p.uid}</div>
            <div style={{ ...CELL_LABEL }}>測定日</div>
            <div className="t-num" style={{ padding: '4px 10px', borderBottom: '1px solid var(--slate-200)' }}>{p.date}</div>
            <div style={{ ...CELL_LABEL, borderBottom: 'none' }}>会場</div>
            <div style={{ padding: '4px 10px', fontSize: 11.5 }}>{p.muniVenue}</div>
          </div>
        </div>
      </div>

      {/* 基本情報 — 本人が読む行は大きく */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.05fr 0.62fr 0.55fr', border: '1px solid var(--slate-300)', marginTop: 9 }}>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-200)' }}>氏名</div>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-200)' }}>生年月日</div>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-200)' }}>年齢</div>
        <div style={CELL_LABEL}>性別</div>
        <div style={{ padding: '5px 12px 7px', borderRight: '1px solid var(--slate-200)' }}>
          <span style={{ fontSize: 25, fontWeight: 700 }}>{p.name}</span>
          <span style={{ fontSize: 13, color: 'var(--slate-500)', marginLeft: 10 }}>{p.kana}</span>
        </div>
        <div className="t-num" style={{ padding: '7px 12px', borderRight: '1px solid var(--slate-200)', alignSelf: 'center', fontSize: 17 }}>{p.birth}</div>
        <div className="t-num" style={{ padding: '7px 12px', borderRight: '1px solid var(--slate-200)', alignSelf: 'center', fontSize: 17 }}>{p.age} 歳</div>
        <div style={{ padding: '7px 12px', alignSelf: 'center', fontSize: 17 }}>{p.sex}</div>
      </div>

      {/* 測定結果 + レーダー */}
      <div style={{ display: 'grid', gridTemplateColumns: state.incRadar ? '1fr 238px' : '1fr', gap: 12, marginTop: 9, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '2px solid var(--slate-900)', paddingBottom: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>測定結果</span>
            <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>実測値</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: state.incAvg ? '1.1fr 0.78fr 0.68fr 0.74fr 0.74fr' : '1.3fr 0.85fr 0.75fr 0.8fr', borderBottom: '1px solid var(--slate-200)', padding: '4px 0 3px', color: 'var(--slate-600)', fontSize: 12.5, fontWeight: 600 }}>
            <div>項目</div>
            <div style={{ textAlign: 'right' }}>今回</div>
            <div style={{ textAlign: 'right' }}>前回</div>
            <div style={{ textAlign: 'right' }}>前回比</div>
            {state.incAvg && <div style={{ textAlign: 'right' }}>{p.avgHead}</div>}
          </div>
          {p.rows.map(r => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: state.incAvg ? '1.1fr 0.78fr 0.68fr 0.74fr 0.74fr' : '1.3fr 0.85fr 0.75fr 0.8fr', borderBottom: '1px solid var(--slate-100)', padding: '3px 0', alignItems: 'baseline' }}>
              <div style={{ fontSize: 21, fontWeight: 500, whiteSpace: 'nowrap' }}>{PDF_LABELS[r.id] || r.label} <span style={{ fontSize: 12, color: 'var(--slate-400)' }}>{r.unit}</span></div>
              <div className="t-num" style={{ textAlign: 'right', fontWeight: 700, fontSize: 21 }}>{r.cur}</div>
              <div className="t-num" style={{ textAlign: 'right', color: 'var(--slate-500)', fontSize: 17 }}>{r.prev}</div>
              <div className="t-num" style={{ textAlign: 'right', fontWeight: 700, fontSize: 17.5, color: r.deltaFg }}>{r.delta}</div>
              {state.incAvg && <div className="t-num" style={{ textAlign: 'right', color: 'var(--slate-500)', fontSize: 16 }}>{r.avg}</div>}
            </div>
          ))}
        </div>
        {state.incRadar && (
          <div style={{ border: '1px solid var(--slate-200)', padding: '10px 8px 6px' }}>
            <div style={{ fontSize: 13, letterSpacing: '0.08em', color: 'var(--slate-600)', textAlign: 'center' }}>5領域評価（5点満点）</div>
            <svg width="100%" viewBox="0 0 320 252" style={{ display: 'block' }}>
              {PG.rings.map((rg, i) => <polygon key={i} points={rg} fill="none" stroke="var(--slate-100)" strokeWidth="1" />)}
              {PG.axesGeo.map((ax, i) => (
                <g key={i}>
                  <line x1="160" y1="122" x2={ax.x2} y2={ax.y2} stroke="var(--slate-200)" strokeWidth="1" />
                  <text x={ax.lx} y={ax.ly} textAnchor="middle" fontSize="17" fontWeight="600" fill="var(--slate-700)">{ax.label}</text>
                </g>
              ))}
              {p.polyAvg && <polygon points={p.polyAvg} fill="none" stroke="var(--info-500)" strokeWidth="1.3" strokeDasharray="3 3" />}
              {p.polyPrev && <polygon points={p.polyPrev} fill="none" stroke="var(--slate-400)" strokeWidth="1.3" strokeDasharray="5 3" />}
              <polygon points={p.polyCur} fill="rgba(242,106,31,0.14)" stroke="var(--brand-500)" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 2 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--slate-600)' }}><span style={{ width: 13, height: 3, background: 'var(--brand-500)' }} />今回</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--slate-600)' }}><span style={{ width: 13, height: 0, borderTop: '2px dashed var(--slate-400)' }} />前回</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--slate-600)' }}><span style={{ width: 13, height: 0, borderTop: '2px dotted var(--info-500)' }} />{p.avgHead}</span>
            </div>
          </div>
        )}
      </div>

      {/* 総合スコア / 前回比 / フレイル簡易評価 */}
      <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'stretch' }}>
        <ScoreBox label="総合スコア" flex={0.85}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="t-display" style={{ fontSize: 42, lineHeight: 1.1, color: 'var(--brand-600)' }}>{p.total}</span>
            <span style={{ fontSize: 14, color: 'var(--slate-500)' }}>/100</span>
          </div>
        </ScoreBox>
        {state.incPrev && (
          <ScoreBox label="前回比" border="var(--slate-200)" flex={0.6}>
            <div className="t-num" style={{ fontSize: 28, fontWeight: 700, color: p.prevDeltaFg, marginTop: 6 }}>{p.prevDelta}</div>
          </ScoreBox>
        )}
        {state.incFrail && p.frail && (
          <ScoreBox label="フレイル簡易評価（測定値による簡易判定）" flex={2}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 3 }}>
              <span className="t-num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>
                該当 {p.frail.n}<span style={{ fontSize: 15, fontWeight: 600, color: 'var(--slate-500)' }}> / 5 項目</span>
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, padding: '1px 12px 2px', borderRadius: 999, background: fl.bg, color: fl.fg, whiteSpace: 'nowrap' }}>{fl.label}</span>
              <span style={{ fontSize: 13.5, color: 'var(--slate-600)' }}>{p.frail.n > 0 ? '該当: ' + p.frail.hitShorts.join('・') : '該当なし'}</span>
            </div>
          </ScoreBox>
        )}
      </div>

      {/* InBody 体組成 */}
      {state.incInbody && p.inbody && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '2px solid var(--slate-900)', paddingBottom: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>体組成（InBody）</span>
            <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>SMI 男性 7.0 / 女性 5.7 kg/m² 未満は筋肉量低下（サルコペニア）の指標です</span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {ibRows.map(([label, v, unit, pv]) => {
              const low = label.startsWith('SMI') && v !== null && v < smiCut
              const d = deltaOf(v, pv ?? null, 1, label === '体脂肪率' ? 'none' : 'high')
              return (
                <div key={label} style={{ flex: 1, border: `1px solid ${low ? 'var(--danger-500)' : 'var(--slate-200)'}`, padding: '5px 12px 6px', background: low ? 'var(--danger-50)' : 'transparent' }}>
                  <div style={{ fontSize: 12, color: 'var(--slate-600)', whiteSpace: 'nowrap' }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span className="t-num" style={{ fontSize: 23, fontWeight: 700, color: low ? 'var(--danger-700)' : 'var(--slate-900)' }}>{v === null ? '—' : fmtD(v, label === 'InBody 点数' ? 0 : 1)}</span>
                    <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>{unit}</span>
                    <span className="t-num" style={{ fontSize: 13, fontWeight: 600, color: d.fg, marginLeft: 'auto' }}>{d.txt}</span>
                  </div>
                  {low && <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--danger-700)' }}>基準値未満</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 推移グラフ */}
      {state.incTrend && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '2px solid var(--slate-900)', paddingBottom: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>総合スコアの推移</span>
            <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>実線 = 本人 / 破線 = {p.avgHead}</span>
          </div>
          <svg width="100%" height="108" viewBox="0 0 660 148" preserveAspectRatio="none" style={{ display: 'block', marginTop: 4 }}>
            {[['100', 16], ['75', 47], ['50', 78], ['25', 108]].map(([lb, yy]) => (
              <g key={lb}>
                <line x1="30" y1={yy} x2="650" y2={yy} stroke={yy === 108 ? 'var(--slate-200)' : 'var(--slate-100)'} strokeWidth="1" />
                <text x="25" y={+yy + 5} textAnchor="end" fontSize="13" fill="var(--slate-400)" fontFamily="Inter">{lb}</text>
              </g>
            ))}
            <path d={p.muniPath} fill="none" stroke="var(--slate-300)" strokeWidth="1.5" strokeDasharray="5 4" />
            <path d={p.trendPath} fill="none" stroke="var(--brand-500)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            {p.trendDots.map((d, i) => (
              <g key={i}>
                <circle cx={d.x} cy={d.y} r="4" fill="#fff" stroke="var(--brand-500)" strokeWidth="2" />
                <text x={d.x} y={d.ly} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--slate-700)" fontFamily="Inter">{d.v}</text>
                <text x={d.x} y="142" textAnchor="middle" fontSize="13" fill="var(--slate-500)">{d.year}</text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* コメント */}
      {state.incComment && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 148px', gap: 12, marginTop: 12, alignItems: 'stretch' }}>
          <div style={{ border: '1px solid var(--slate-300)' }}>
            <div style={{ ...CELL_LABEL, letterSpacing: '0.08em' }}>総合コメント</div>
            <div style={{ padding: '2px 14px 6px', position: 'relative', minHeight: 92 }}>
              {[36, 68].map(t => <div key={t} style={{ position: 'absolute', left: 14, right: 14, top: t, borderBottom: '1px dotted var(--slate-300)' }} />)}
              <div className="t-hand" style={{ position: 'relative', fontSize: 19, lineHeight: '33px', color: 'var(--slate-800)' }}>{p.commentText}</div>
            </div>
          </div>
          <div style={{ border: '1px solid var(--slate-300)', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ borderRight: '1px solid var(--slate-200)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '4px 0', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 11, letterSpacing: '0.1em', color: 'var(--slate-600)', textAlign: 'center' }}>記入者</div>
              <div className="t-hand" style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 44, fontSize: 16, color: 'var(--slate-800)' }}>相馬</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '4px 0', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 11, letterSpacing: '0.1em', color: 'var(--slate-600)', textAlign: 'center' }}>確認印</div>
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 44 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', display: 'grid', placeItems: 'center', fontSize: 14, transform: 'rotate(-6deg)', opacity: 0.8, fontFamily: 'serif' }}>相馬</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* フッター */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--slate-900)', paddingTop: 3 }}>
        <div style={{ borderTop: '3px solid var(--brand-500)', paddingTop: 7, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="t-display" style={{ fontSize: 12, letterSpacing: '0.05em', color: 'var(--slate-700)' }}>Cruto motion</span>
          <span style={{ fontSize: 10, color: 'var(--slate-500)' }}>介護予防・体力測定管理システム — Community Station</span>
          <span style={{ flex: 1 }} />
          <span className="t-num" style={{ fontSize: 11, color: 'var(--slate-500)' }}>発行 {p.issued} · {p.pageNo} / {count}</span>
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
  const pages = scope.slice(0, 30).map((u, i) => buildPage(state, u, y, i))
  const q = state.pdfQ.trim().toLowerCase()
  const cands = D.users.filter(u => u.meas[y] && (!q || u.name.toLowerCase().includes(q) || u.kana.toLowerCase().includes(q) || u.id.includes(q))).slice(0, 7)
  const opt = (v, l) => ({ v, l })
  const modes = [
    { id: 'single', label: '1 名を選んで出力', desc: '個人結果票 1 ページ' },
    { id: 'muni', label: '市町村ごとに一括出力', desc: '対象者全員分をまとめて' },
    { id: 'all', label: '全員を一括出力', desc: '年度の測定済 全員分' },
  ]
  const incs = [
    ['incRadar', 'レーダーチャート'], ['incTrend', '時系列の推移グラフ'], ['incPrev', '前回との比較'], ['incAvg', '市町村平均の列'],
    ['incFrail', 'フレイル簡易評価'], ['incInbody', 'InBody（体組成）'], ['incComment', '総合コメント欄'],
  ]

  return (
    <div className="print-screen panel-screen" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', minHeight: 0 }}>
      {/* 設定パネル */}
      <div className="noprint side-panel" style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                    <div className="t-num" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{u.id} · {u.muniName}{u.inbody && u.inbody[y] ? ' · InBody あり' : ''}</div>
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
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.6 }}>InBody はデータが紐づいている方のページにのみ掲載されます。本文の文字は印刷時 16pt 以上です。</div>
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
