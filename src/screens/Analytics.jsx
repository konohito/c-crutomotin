import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { deltaOf, eraOf, fmtD, colsPlus, itemAvg, autoLines, betterNote, frailtyOf, FRAIL_ITEMS, FRAIL_LEVELS } from '../lib/helpers.js'
import { kclScore, KCL_DOMAINS } from '../data/kihon.js'
import { Card, Select, Segmented } from '../ui/kit.jsx'

function heatBg(v) {
  if (v === null || v === undefined || !v) return 'var(--slate-50)'
  return v < 2 ? 'var(--slate-50)' : v < 2.6 ? 'var(--brand-50)' : v < 3.2 ? 'var(--brand-100)' : v < 3.7 ? 'var(--brand-200)' : v < 4.2 ? 'var(--brand-300)' : 'var(--brand-400)'
}

export default function Analytics() {
  const { state, set } = useStore()
  const y = state.anaYear
  const inScope = (u) => state.anaRegion === 'all' || u.region === state.anaRegion
  const scopeAgg = D.agg(inScope, y)
  const munis = D.MUNIS.filter(m => state.anaRegion === 'all' || m.region === state.anaRegion)
  const groups = state.anaUnit === 'region'
    ? D.REGIONS.filter(r => state.anaRegion === 'all' || r === state.anaRegion).map(r => ({ name: r, sub: '', filter: (u) => u.region === r }))
    : munis.map(m => ({ name: m.name, sub: m.region, filter: (u) => u.muni === m.id }))

  const barsRaw = groups.map(g => {
    const a = D.agg(g.filter, y)
    const p = D.agg(g.filter, y - 1)
    return { g, a, d: deltaOf(a.total || null, p.total || null, 1, 'high') }
  }).sort((x, z) => (z.a.total || 0) - (x.a.total || 0))

  const colors = ['var(--brand-500)', 'var(--info-500)', 'var(--success-500)']
  const cbm = colsPlus()
  const exCol = cbm.find(c => c.id === state.exItem) || cbm[3]
  const exYears = D.YEARS.filter(yy => yy >= state.exFrom)
  const exRegions = state.anaRegion === 'all' ? D.REGIONS : [state.anaRegion]
  const sexOk = (u) => state.exSex === 'all' || u.sex === state.exSex
  const ageOk = (u) => state.exAge === 'all' || (state.exAge === 'u75' ? u.age < 75 : state.exAge === 'a75' ? (u.age >= 75 && u.age < 85) : u.age >= 85)
  let cohortN = 0
  const seriesList = exRegions.map((r) => {
    let pool = D.users.filter(u => u.region === r && sexOk(u) && ageOk(u))
    if (state.exCohort === 'cohort') {
      pool = pool.filter(u => exYears.every(yy => u.meas[yy] && u.meas[yy].values[exCol.id] !== null && u.meas[yy].values[exCol.id] !== undefined))
      cohortN += pool.length
    }
    const n = state.exCohort === 'cohort' ? pool.length : pool.filter(u => u.meas[D.CUR]).length
    return { pts: exYears.map(yy => ({ year: yy, v: itemAvg(pool, yy, exCol.id) })), color: colors[D.REGIONS.indexOf(r)] || colors[0], label: r, n }
  })
  const exAuto = autoLines(seriesList, exYears, 46, 820, 18, 190)
  const exXs = (i) => Math.round(46 + (exYears.length > 1 ? (i * (820 - 46)) / (exYears.length - 1) : 0))

  const heatRows = [{ name: '全体', fw: 700, agg: scopeAgg }].concat(groups.map(g => ({ name: g.name, fw: 500, agg: D.agg(g.filter, y) })))
  const totals = D.users.filter(u => inScope(u) && u.meas[y]).map(u => u.meas[y].total).sort((a, b) => a - b)
  const median = totals.length ? totals[Math.floor(totals.length / 2)] : '—'
  const bins = Array.from({ length: 10 }, (_, i) => totals.filter(t => t >= i * 10 && (i === 9 ? t <= 100 : t < i * 10 + 10)).length)
  const mx = Math.max(1, ...bins)
  const medBin = median === '—' ? -1 : Math.min(9, Math.floor(median / 10))
  // ---- フレイル簡易評価の集計（報告用） ----
  const frailCount = (pool) => {
    const c = { frail: 0, pre: 0, ok: 0, total: 0 }
    pool.forEach(u => {
      const f = frailtyOf(u, y)
      if (f) { c[f.level]++; c.total++ }
    })
    return c
  }
  const frailScope = frailCount(D.users.filter(u => inScope(u) && u.meas[y]))
  const frailGroups = groups.map(g => ({ name: g.name, c: frailCount(D.users.filter(u => g.filter(u) && u.meas[y])) }))
  const pctOf = (n, total) => (total ? Math.round((n / total) * 100) : 0)

  // ---- 基本チェックリスト 事業対象者の集計（報告用） ----
  const kclCount = (pool) => {
    const c = { target: 0, total: 0, sum: 0, domains: {} }
    KCL_DOMAINS.forEach(d => { c.domains[d.id] = 0 })
    pool.forEach(u => {
      const s = kclScore(u, y)
      if (!s) return
      c.total++; c.sum += s.total
      if (s.target) c.target++
      KCL_DOMAINS.forEach(d => { if (s.domainCounts[d.id] > 0) c.domains[d.id]++ })
    })
    return c
  }
  const kclScopeC = kclCount(D.users.filter(u => inScope(u) && u.meas[y]))
  const kclGroups = groups.map(g => ({ name: g.name, c: kclCount(D.users.filter(u => g.filter(u) && u.meas[y])) }))
  const kclAvg = kclScopeC.total ? (kclScopeC.sum / kclScopeC.total).toFixed(1) : '—'

  const opt = (v, l) => ({ v, l })

  const cohortNote = state.exCohort === 'cohort'
    ? '【同一集団で比較中】' + eraOf(state.exFrom) + '〜令和7年度のすべての年度に「' + exCol.label + '」の記録がある ' + cohortN + ' 名だけで平均した推移です。同じ方々の変化を純粋に追跡できます。ただし継続して参加できている比較的元気な方に偏りやすい点にご注意ください。' + (state.exAge !== 'all' ? '（年代は令和7年度時点の年齢で区分）' : '')
    : '【全参加者で比較中】各年度に測定したすべての方の平均です。年度ごとに参加メンバーが入れ替わる（新規参加・欠席・転出など）ため、集団の構成変化の影響を含みます。同じ方々だけの純粋な変化を見たい場合は「同一集団」に切り替えてください。' + (state.exAge !== 'all' ? '（年代は令和7年度時点の年齢で区分）' : '')

  return (
    <div className="screen">
      {/* フィルタバー */}
      <Card style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Segmented value={state.anaUnit} onChange={(v) => set({ anaUnit: v })} options={[{ v: 'region', l: '圏域別' }, { v: 'muni', l: '市町村別' }]} />
        <Select value={state.anaYear} onChange={(e) => set({ anaYear: Number(e.target.value) })}
          options={D.YEARS.slice().reverse().map(yy => opt(yy, eraOf(yy) + '年度（' + yy + '）'))} />
        <Select value={state.anaRegion} onChange={(e) => set({ anaRegion: e.target.value })}
          options={[opt('all', '全圏域')].concat(D.REGIONS.map(r => opt(r, r)))} />
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
          対象 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{scopeAgg.count}</span> 名（{eraOf(y)}年度 測定済）
        </div>
      </Card>

      {/* 年次推移チャート */}
      <Card pad>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="t-h4" style={{ flex: 1, minWidth: 170 }}>運動機能の年次推移（区域別）</div>
          <Select sm value={state.exItem} onChange={(e) => set({ exItem: e.target.value })} options={cbm.map(c => ({ v: c.id, l: c.label }))} />
          <Select sm value={state.exSex} onChange={(e) => set({ exSex: e.target.value })} options={[opt('all', '男女計'), opt('F', '女性のみ'), opt('M', '男性のみ')]} />
          <Select sm value={state.exAge} onChange={(e) => set({ exAge: e.target.value })} options={[opt('all', '全年代'), opt('u75', '〜74歳'), opt('a75', '75〜84歳'), opt('a85', '85歳〜')]} />
          <Select sm value={String(state.exFrom)} onChange={(e) => set({ exFrom: +e.target.value })}
            options={[opt('2020', '全期間（令和2〜7）'), opt('2022', '令和4〜7年度'), opt('2023', '令和5〜7年度'), opt('2024', '令和6〜7年度')]} />
          <Segmented sm value={state.exCohort} onChange={(v) => set({ exCohort: v })} options={[{ v: 'all', l: '全参加者' }, { v: 'cohort', l: '同一集団' }]} />
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {seriesList.map(sr => (
            <span key={sr.label} className="t-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)' }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: sr.color }} />
              {sr.label}（{sr.n}名）
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{betterNote(exCol) ? '※ ' + exCol.label + ' は' + betterNote(exCol) + 'です' : ''}</span>
        </div>
        <svg width="100%" height="228" viewBox="0 0 880 228" preserveAspectRatio="none" style={{ display: 'block', marginTop: 6 }}>
          {exAuto.ticks.map((tk, i) => (
            <g key={i}>
              <line x1="46" y1={tk.y} x2="828" y2={tk.y} stroke="var(--slate-100)" strokeWidth="1" />
              <text x="40" y={tk.y + 3.5} textAnchor="end" fontSize="10" fill="var(--slate-400)" fontFamily="Inter">{fmtD(tk.v, exCol.dec)}</text>
            </g>
          ))}
          {exAuto.lines.map((ln, i) => (
            <g key={i}>
              <path d={ln.path} fill="none" stroke={ln.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              {ln.pts.length > 0 && (
                <text x={ln.pts[ln.pts.length - 1].x + 7} y={ln.pts[ln.pts.length - 1].y + 4} fontSize="11" fontWeight="700" fill={ln.color} fontFamily="Inter">
                  {fmtD(Math.round(ln.pts[ln.pts.length - 1].v * 10) / 10, exCol.dec)}
                </text>
              )}
            </g>
          ))}
          {exYears.map((yy, i) => (
            <text key={yy} x={exXs(i)} y="220" textAnchor="middle" fontSize="10" fill="var(--slate-500)" fontFamily="Inter">{eraOf(yy)}</text>
          ))}
        </svg>
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'var(--slate-25)', border: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.7 }}>
          {cohortNote}
        </div>
      </Card>

      {/* バー + ヒストグラム */}
      <div className="duo" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 16, alignItems: 'start' }}>
        <Card pad>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div className="t-h4">{state.anaUnit === 'region' ? '圏域別 平均総合スコア' : '市町村別 平均総合スコア'}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>前年差</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {barsRaw.map((b, i) => (
              <div key={b.g.name} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 42px 50px', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{b.g.name}</div>
                  <div className="t-num" style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>{(b.g.sub ? b.g.sub + ' · ' : '') + b.a.count + '名'}</div>
                </div>
                <div style={{ height: 18, borderRadius: 4, background: 'var(--slate-50)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 4, background: i === 0 ? 'var(--brand-500)' : 'var(--brand-300)', width: Math.max(4, Math.round(((b.a.total || 0) / 85) * 100)) + '%', transition: 'width var(--dur-slow) var(--ease-emphasized)' }} />
                </div>
                <div className="t-num" style={{ fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{b.a.total || '—'}</div>
                <div className="t-num" style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'right', color: b.d.fg }}>{b.d.txt}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card pad style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div className="t-h4">総合スコアの分布</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>中央値 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{median}</span></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150, marginTop: 16, padding: '0 4px' }}>
            {bins.map((c, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <div className="t-num" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{c || ''}</div>
                <div style={{ width: '100%', borderRadius: '4px 4px 2px 2px', background: i === medBin ? 'var(--brand-500)' : 'var(--brand-200)', height: Math.max(2, Math.round((c / mx) * 100)) + '%', transition: 'height var(--dur-slow) var(--ease-emphasized)' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '0 4px' }}>
            <span className="t-num" style={{ fontSize: 10, color: 'var(--fg-4)' }}>0</span>
            <span className="t-num" style={{ fontSize: 10, color: 'var(--fg-4)' }}>50</span>
            <span className="t-num" style={{ fontSize: 10, color: 'var(--fg-4)' }}>100</span>
          </div>
        </Card>
      </div>

      {/* ヒートマップ */}
      <Card pad style={{ overflowX: 'auto' }}>
        <div className="t-h4">{state.anaUnit === 'region' ? '評価領域 × 圏域（平均スコア）' : '評価領域 × 市町村（平均スコア）'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '86px repeat(5, 1fr)', gap: 4, marginTop: 14, minWidth: 460 }}>
          <div />
          {['歩行速度', 'バランス', '筋力', '複合動作', '体格'].map(h => (
            <div key={h} className="t-overline" style={{ textAlign: 'center' }}>{h}</div>
          ))}
          {heatRows.map(r => [
            <div key={r.name + '-label'} style={{ fontSize: 12.5, fontWeight: r.fw, alignSelf: 'center' }}>{r.name}</div>,
            ...D.AXES.map(a => (
              <div key={r.name + '-' + a.id} className="t-num" style={{ height: 34, borderRadius: 6, background: r.agg.count ? heatBg(r.agg.axes[a.id]) : 'var(--slate-50)', color: 'var(--slate-800)', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600 }}>
                {r.agg.count ? r.agg.axes[a.id].toFixed(1) : '—'}
              </div>
            )),
          ])}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>低 1.0</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {['var(--slate-50)', 'var(--brand-50)', 'var(--brand-100)', 'var(--brand-200)', 'var(--brand-300)'].map((c, i) => (
              <div key={i} style={{ width: 22, height: 10, borderRadius: 2, background: c }} />
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>高 5.0</span>
        </div>
      </Card>

      {/* フレイル簡易評価（報告用） */}
      <Card pad>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="t-h4">フレイル簡易評価 — {eraOf(y)}年度（報告用集計）</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>5 項目中 3 項目以上該当でフレイル相当（J-CHS 基準を参考にした測定値判定）</div>
        </div>

        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
          {[['frail', 'フレイル相当'], ['pre', 'プレフレイル相当'], ['ok', '良好']].map(([k, label]) => (
            <div key={k} style={{ borderRadius: 10, padding: '14px 16px', background: FRAIL_LEVELS[k].bg }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: FRAIL_LEVELS[k].fg }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
                <span className="t-num" style={{ fontSize: 28, fontWeight: 700, color: FRAIL_LEVELS[k].fg }}>{frailScope[k]}</span>
                <span style={{ fontSize: 12, color: FRAIL_LEVELS[k].fg }}>名</span>
                <span className="t-num" style={{ fontSize: 13, fontWeight: 600, color: FRAIL_LEVELS[k].fg, marginLeft: 'auto' }}>{pctOf(frailScope[k], frailScope.total)}%</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {frailGroups.map(g => (
            <div key={g.name} style={{ display: 'grid', gridTemplateColumns: '86px 1fr 168px', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</div>
              <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', background: 'var(--slate-50)' }}>
                {['frail', 'pre', 'ok'].map(k => (
                  g.c.total > 0 && g.c[k] > 0
                    ? <div key={k} style={{ width: (g.c[k] / g.c.total) * 100 + '%', background: FRAIL_LEVELS[k].bar, opacity: k === 'ok' ? 0.55 : 0.9 }} />
                    : null
                ))}
              </div>
              <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'right' }}>
                フレイル <b style={{ color: 'var(--danger-700)' }}>{g.c.frail}</b> · プレ <b style={{ color: 'var(--warning-700)' }}>{g.c.pre}</b> / {g.c.total} 名
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--slate-25)', border: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.7 }}>
          <b>判定基準（5 項目）</b>: {FRAIL_ITEMS.map(it => it.label + '（' + it.desc + '）').join(' / ')}。
          3 項目以上該当 = フレイル相当、1〜2 項目 = プレフレイル相当。測定値のみによる簡易判定であり、問診（疲労感・活動量）を含む正式なフレイル診断ではありません。個人結果票にも本人向けに掲載されます。
        </div>
      </Card>

      {/* 基本チェックリスト 事業対象者（報告用） */}
      <Card pad>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="t-h4">基本チェックリスト 事業対象者 — {eraOf(y)}年度（報告用集計）</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>25 項目の合計 平均 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{kclAvg}</span> 点</div>
        </div>

        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
          <div style={{ borderRadius: 10, padding: '14px 16px', background: 'var(--danger-50)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger-700)' }}>事業対象者 該当</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
              <span className="t-num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--danger-700)' }}>{kclScopeC.target}</span>
              <span style={{ fontSize: 12, color: 'var(--danger-700)' }}>名</span>
              <span className="t-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger-700)', marginLeft: 'auto' }}>{pctOf(kclScopeC.target, kclScopeC.total)}%</span>
            </div>
          </div>
          <div style={{ borderRadius: 10, padding: '14px 16px', background: 'var(--success-50)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success-700)' }}>非該当</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
              <span className="t-num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--success-700)' }}>{kclScopeC.total - kclScopeC.target}</span>
              <span style={{ fontSize: 12, color: 'var(--success-700)' }}>名</span>
              <span className="t-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--success-700)', marginLeft: 'auto' }}>{pctOf(kclScopeC.total - kclScopeC.target, kclScopeC.total)}%</span>
            </div>
          </div>
          <div style={{ borderRadius: 10, padding: '14px 16px', background: 'var(--slate-50)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>問診 回答者</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
              <span className="t-num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--fg-1)' }}>{kclScopeC.total}</span>
              <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>名</span>
            </div>
          </div>
        </div>

        {/* 圏域/市町村別 事業対象者率 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {kclGroups.map(g => (
            <div key={g.name} style={{ display: 'grid', gridTemplateColumns: '86px 1fr 132px', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</div>
              <div style={{ height: 16, borderRadius: 4, background: 'var(--slate-50)', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--danger-500)', opacity: 0.85, width: pctOf(g.c.target, g.c.total) + '%' }} />
              </div>
              <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'right' }}>
                該当 <b style={{ color: 'var(--danger-700)' }}>{g.c.target}</b> / {g.c.total} 名（{pctOf(g.c.target, g.c.total)}%）
              </div>
            </div>
          ))}
        </div>

        {/* 領域別 該当者数 */}
        <div className="t-overline" style={{ marginTop: 16, marginBottom: 8 }}>領域別の該当者数（1 項目以上該当）</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {KCL_DOMAINS.map(d => (
            <div key={d.id} style={{ flex: '1 1 120px', minWidth: 110, border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{d.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span className="t-num" style={{ fontSize: 18, fontWeight: 700 }}>{kclScopeC.domains[d.id]}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>名</span>
                <span className="t-num" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginLeft: 'auto' }}>{pctOf(kclScopeC.domains[d.id], kclScopeC.total)}%</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--slate-25)', border: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.7 }}>
          基本チェックリスト（25 項目）の合計点と、①No.1〜20の10項目以上 ②運動器3項目以上 ③栄養2項目 ④口腔2項目以上 ⑤閉じこもり(No.16該当) ⑥認知1項目以上 ⑦うつ2項目以上 のいずれかを満たす方を「事業対象者」として集計しています。※ ダミー回答による集計です。
        </div>
      </Card>
    </div>
  )
}
