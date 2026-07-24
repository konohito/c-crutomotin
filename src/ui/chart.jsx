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

function Tip({ p, dec, unit, yearFmt, chartW }) {
  const year = yearLabel(p.year, yearFmt) + '年度'
  const val = `${fmtD(p.v, dec)}${unit ? ' ' + unit : ''}`
  const w = Math.max(year.length * 10.5, val.length * 8.5) + 22
  const above = p.y > 66
  const x = Math.min(Math.max(p.x - w / 2, 4), Math.max(4, chartW - w - 4))
  const y = above ? p.y - 58 : p.y + 14
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={44} rx="8" fill="var(--bg-surface)" stroke="var(--border-default)" />
      <text x={x + 11} y={y + 17} fontSize="10.5" fill="var(--fg-3)" fontFamily="Inter">{year}</text>
      <text x={x + 11} y={y + 34} fontSize="13" fontWeight="700" fill="var(--fg-1)" fontFamily="Inter">{val}</text>
    </g>
  )
}

export function ChartDots({ pts, color = 'var(--brand-500)', dec = 0, unit = '', yearFmt = 'era', chartW, showLabels = true, topFlip = 46 }) {
  const [hov, setHov] = useState(null)
  return (
    <>
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-surface)" stroke={color} strokeWidth="2.2" />
          {showLabels && (
            <text x={p.x} y={p.y < topFlip ? p.y + 18 : p.y - 10} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--slate-700)" fontFamily="Inter">
              {fmtD(Math.round(p.v * 10) / 10, dec)}
            </text>
          )}
        </g>
      ))}
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
