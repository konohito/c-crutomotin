/* 折れ線グラフの共通部品。
   - useChartWidth: コンテナの実測幅で viewBox を作る（preserveAspectRatio="none" の文字潰れ対策）
   - ChartDots: 測定時点のプロット + 常時数値ラベル + ホバーで年度・数値のツールチップ
   - YearFmtSwitch: X軸の 令和 / 西暦 切り替え（store.yearFmt） */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { eraOf, fmtD } from '../lib/helpers.js'
import { Segmented } from './kit.jsx'

export function useChartWidth(fallback = 560) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export const yearLabel = (y, fmt) => (fmt === 'west' ? String(y) : eraOf(y))

export function YearFmtSwitch() {
  const { state, set } = useStore()
  return (
    <Segmented sm value={state.yearFmt} onChange={(v) => set({ yearFmt: v })}
      options={[{ v: 'era', l: '令和' }, { v: 'west', l: '西暦' }]} />
  )
}

/* 数字は桁が揃わないと比べられない（8 と 1 で幅が違うと縦に波打つ） */
const NUM_STYLE = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' }

/* グラフの軸（全アプリ共通ルール・2026-11-11 ユーザー確定。docs/design/design-quality-brief.md §7.5）
   ① 目盛りは必ず外向き ② 補助線（グリッド線）は引かない ③ 軸ははっきりした黒
   ⑤ 縦軸の上端は目盛りと同じ長さの短い横線で蓋をする
   （④ ホバーで数字 は ChartDots が担う）
   ★このアプリの全グラフがこれを使う。軸をその場で描き足さないこと（1 本ずつ見た目がずれる）。 */
export function AxisFrame({ x0, xEnd, yTop, yBottom, yTicks = [], xTicks = [], tick = 5 }) {
  const AXIS = 'var(--slate-900)'
  return (
    <g shapeRendering="crispEdges">
      <line x1={x0} y1={yTop} x2={x0} y2={yBottom} stroke={AXIS} strokeWidth="1.5" />
      <line x1={x0} y1={yBottom} x2={xEnd} y2={yBottom} stroke={AXIS} strokeWidth="1.5" />
      {yTicks.map((y, i) => <line key={'y' + i} x1={x0 - tick} y1={y} x2={x0} y2={y} stroke={AXIS} strokeWidth="1.25" />)}
      {xTicks.map((x, i) => <line key={'x' + i} x1={x} y1={yBottom} x2={x} y2={yBottom + tick} stroke={AXIS} strokeWidth="1.25" />)}
      {/* 蓋。目盛りと同じ長さで、軸の上端を閉じる */}
      <line x1={x0 - tick / 2} y1={yTop} x2={x0 + tick / 2} y2={yTop} stroke={AXIS} strokeWidth="1.5" />
    </g>
  )
}

function Tip({ p, dec, unit, yearFmt, chartW }) {
  // 測定日ごとの推移では label（例「令7.10/2」）が入る。年度単位のグラフは従来どおり年度表示
  const year = p.label != null ? p.label : yearLabel(p.year, yearFmt) + '年度'
  const val = `${fmtD(p.v, dec)}${unit ? ' ' + unit : ''}`
  const w = Math.max(year.length * 10.5, val.length * 8.5) + 24
  const above = p.y > 66
  const x = Math.min(Math.max(p.x - w / 2, 4), Math.max(4, chartW - w - 4))
  const y = above ? p.y - 60 : p.y + 14
  return (
    <g pointerEvents="none">
      {/* 枠線だけだと背景の線と混ざる。紙が1枚浮いた程度の弱い影で区切る */}
      <rect x={x + 1} y={y + 2} width={w} height={46} rx="9" fill="rgba(15,20,34,0.10)" />
      <rect x={x} y={y} width={w} height={46} rx="9" fill="var(--bg-surface)" stroke="var(--border-default)" />
      <text x={x + 12} y={y + 18} fontSize="10.5" fill="var(--fg-3)" fontFamily="Inter" style={NUM_STYLE}>{year}</text>
      <text x={x + 12} y={y + 36} fontSize="13.5" fontWeight="700" fill="var(--fg-1)" fontFamily="Inter" style={NUM_STYLE}>{val}</text>
    </g>
  )
}

export function ChartDots({ pts, color = 'var(--brand-500)', dec = 0, unit = '', yearFmt = 'era', chartW, showLabels = true, topFlip = 46 }) {
  const [hov, setHov] = useState(null)
  const lastIdx = pts.length - 1
  return (
    <>
      {pts.map((p, i) => {
        /* いちばん新しい点（＝いまの状態）だけ塗りを反転して強調する。
           全部同じ見た目だと「どれが最新か」を凡例無しで読み取れない。 */
        const latest = i === lastIdx
        return (
          <g key={i}>
            {latest && <circle cx={p.x} cy={p.y} r="8" fill={color} opacity="0.14" />}
            <circle cx={p.x} cy={p.y} r={latest ? 4.5 : 4}
              fill={latest ? color : 'var(--bg-surface)'}
              stroke={latest ? 'var(--bg-surface)' : color}
              strokeWidth={latest ? 2 : 2.2} />
            {showLabels && (
              <text x={p.x} y={p.y < topFlip ? p.y + 18 : p.y - 10} textAnchor="middle"
                fontSize="11.5" fontWeight={latest ? 800 : 700}
                fill={latest ? 'var(--slate-900)' : 'var(--slate-700)'}
                fontFamily="Inter" style={NUM_STYLE}>
                {fmtD(Math.round(p.v * 10) / 10, dec)}
              </text>
            )}
          </g>
        )
      })}
      {/* ホバー判定（見た目の点より広めに取り、タップでも反応しやすく） */}
      {pts.map((p, i) => (
        <circle key={'h' + i} cx={p.x} cy={p.y} r="14" fill="transparent"
          onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
          onClick={() => setHov(i)} style={{ cursor: 'pointer' }} />
      ))}
      {hov !== null && pts[hov] && <Tip p={pts[hov]} dec={dec} unit={unit} yearFmt={yearFmt} chartW={chartW} />}
    </>
  )
}
