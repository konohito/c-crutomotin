import D from '../data/engine.js'
import { useStore, memosFor } from '../store.jsx'
import { deltaOf, eraOf, fmtD, radarGeo, colsPlus, itemAvg, autoLines, muniBmiAvg, frailtyOf, FRAIL_LEVELS } from '../lib/helpers.js'
import { kclScore, kclLevel, KCL_LEVELS, KCL_DOMAINS } from '../data/kihon.js'
import { realDataEnabled } from '../lib/realdata.js'
import { Card, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

function LegendSwatch({ kind, color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)' }}>
      {kind === 'line' && <span style={{ width: 14, height: 3, borderRadius: 2, background: color }} />}
      {kind === 'dash' && <span style={{ width: 14, height: 0, borderTop: `2px dashed ${color}` }} />}
      {kind === 'dot' && <span style={{ width: 14, height: 0, borderTop: `2px dotted ${color}` }} />}
      {label}
    </span>
  )
}

export default function Detail() {
  const { state, set, setState, showToast } = useStore()
  const u = D.users.find(x => x.id === state.detId) || D.users[0]
  const ys = Object.keys(u.meas).map(Number)
  const last = ys.length ? u.meas[ys[ys.length - 1]] : null
  const lastY = ys.length ? ys[ys.length - 1] : D.CUR
  const prev = ys.length > 1 ? u.meas[ys[ys.length - 2]] : null
  const muniAgg = D.agg(x => x.muni === u.muni, lastY)
  const g = radarGeo()
  const td = deltaOf(last ? last.total : null, prev ? prev.total : null, 0, 'high')
  const colsBmi = colsPlus()

  const detRows = last ? colsBmi.map(c => {
    const d = deltaOf(last.values[c.id], prev ? prev.values[c.id] : null, c.dec, c.better)
    const avg = c.id === 'bmi' ? muniBmiAvg(u.muni, lastY) : muniAgg.cols[c.id]
    return { id: c.id, label: c.short || c.label, unit: c.unit, cur: fmtD(last.values[c.id], c.dec), delta: d.txt, deltaFg: d.fg, avg: avg === null || avg === undefined ? '—' : fmtD(avg, c.dec) }
  }) : []

  const mcol = state.detMetric === 'total' ? { id: 'total', label: '総合スコア', unit: '', dec: 0 } : (colsBmi.find(c => c.id === state.detMetric) || colsBmi[0])
  const pSeries = D.YEARS.map(y => ({ year: y, v: u.meas[y] ? (mcol.id === 'total' ? u.meas[y].total : u.meas[y].values[mcol.id]) : null }))
  const muniPool = D.users.filter(x => x.muni === u.muni)
  const mSeries = D.YEARS.map(y => ({ year: y, v: itemAvg(muniPool, y, mcol.id) }))
  const tAuto = autoLines([{ pts: pSeries }, { pts: mSeries }], D.YEARS, 56, 490, 18, 170)

  const detMult = D.COLS.map(c => {
    const vals = ys.filter(y => u.meas[y].values[c.id] !== null).map(y => u.meas[y].values[c.id])
    const d = deltaOf(last ? last.values[c.id] : null, prev ? prev.values[c.id] : null, c.dec, c.better)
    let spark = ''
    if (vals.length > 1) {
      const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1
      spark = vals.map((v, i) => (4 + (i * 112) / (vals.length - 1)).toFixed(1) + ',' + (29 - ((v - mn) * 24) / rg).toFixed(1)).join(' ')
    }
    return { id: c.id, label: c.label, unit: c.unit, val: last ? fmtD(last.values[c.id], c.dec) : '—', delta: d.txt, deltaFg: d.fg, spark }
  })

  const canEdit = realDataEnabled()
  const hist = D.YEARS.map(y => {
    const m = u.meas[y]
    const pre = y < u.joined
    const st = m ? ['測定', 'var(--success-50)', 'var(--success-700)'] : (pre ? ['登録前', 'transparent', 'var(--fg-4)'] : (y === D.CUR ? ['未測定', 'var(--warning-50)', 'var(--warning-700)'] : ['欠席', 'var(--slate-100)', 'var(--slate-600)']))
    return { era: eraOf(y), year: y, measured: !!m, review: !!(m && m.review), date: m ? m.date : '—', total: m ? m.total : '—', suffix: m ? '/100' : '', st }
  })

  const frail = last ? frailtyOf(u, lastY) : null
  const fl = frail ? FRAIL_LEVELS[frail.level] : null

  // ---- 基本チェックリスト（問診票） ----
  const kcl = kclScore(u, lastY)
  const kclL = kcl ? KCL_LEVELS[kclLevel(kcl.total)] : null
  const kclSeries = D.YEARS.map(y => ({ year: y, v: (u.kcl && u.kcl[y]) ? (kclScore(u, y) || {}).total : null }))
  const kclAuto = autoLines([{ pts: kclSeries }], D.YEARS, 40, 250, 12, 78)
  const kclLine = kclAuto.lines[0] || { path: '', pts: [] }

  const ibYears = Object.keys(u.inbody || {}).map(Number).sort((a, b) => a - b)
  const ibLast = ibYears.length ? u.inbody[ibYears[ibYears.length - 1]] : null
  const ibPrev = ibYears.length > 1 ? u.inbody[ibYears[ibYears.length - 2]] : null
  const ibLastY = ibYears.length ? ibYears[ibYears.length - 1] : null
  const smiCut = u.sex === 'M' ? 7.0 : 5.7

  const memos = memosFor(state, u)
  const memoAdd = () => {
    const t = state.memoDraft.trim()
    if (!t) return
    const arr = memos.concat([{ date: D.TODAY, text: t, by: '相馬' }])
    setState(s => ({ ...s, memos: { ...s.memos, [u.id]: arr }, memoDraft: '' }))
    showToast('気づきを登録しました')
  }

  const profile = [
    { k: '参加者 ID', v: u.id }, { k: '生年月日', v: u.birthDate }, { k: '電話番号', v: u.phone || '—' },
    { k: '会場', v: u.venueName }, { k: '参加開始', v: eraOf(u.joined) + '年度' }, { k: '備考', v: u.note || '—' },
  ]

  return (
    <div className="screen">
      <div>
        <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }} onClick={() => set({ screen: 'ros' })}>
          <Icon name="back" size={16} />
          利用者台帳へ戻る
        </button>
      </div>

      {/* プロフィールヘッダー */}
      <Card style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg, var(--brand-50), var(--brand-100))', color: 'var(--brand-700)', display: 'grid', placeItems: 'center', fontSize: 19, fontWeight: 700, flexShrink: 0, boxShadow: 'inset 0 0 0 1px var(--brand-200)' }}>{u.name.charAt(0)}</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{u.name}</span>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{u.kana}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span className="chip t-num" style={{ height: 22, fontSize: 11.5 }}>ID {u.id}</span>
            <span className="chip" style={{ height: 22, fontSize: 11.5 }}><span className="t-num">{u.age}</span> 歳 · {u.sexLabel}</span>
            <span className="chip" style={{ height: 22, fontSize: 11.5 }}>{u.muniName} · {u.venueName}</span>
            <span className="chip" style={{ height: 22, fontSize: 11.5, background: 'var(--brand-50)', color: 'var(--brand-700)' }}>測定 <span className="t-num" style={{ margin: '0 3px' }}>{ys.length}</span> 回</span>
            {frail && (
              <span className="chip" title={'該当: ' + (frail.hitShorts.join('・') || 'なし')} style={{ height: 22, fontSize: 11.5, background: fl.bg, color: fl.fg, fontWeight: 600 }}>
                {fl.label} <span className="t-num" style={{ marginLeft: 3 }}>{frail.n}/5</span>
              </span>
            )}
            {kcl && kcl.target && (
              <span className="chip" title={kcl.reasons.map(r => r.label).join(' / ')} style={{ height: 22, fontSize: 11.5, background: 'var(--danger-50)', color: 'var(--danger-700)', fontWeight: 600 }}>
                事業対象者 該当
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="t-overline">最新の総合スコア</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'flex-end' }}>
              <span className="t-num" style={{ fontSize: 30, fontWeight: 700, color: 'var(--brand-600)' }}>{last ? last.total : '—'}</span>
              <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>/100</span>
              <span className="t-num" style={{ fontSize: 12.5, fontWeight: 600, color: td.fg }}>{td.txt}</span>
            </div>
          </div>
          {canEdit && (
            <button className="btn btn-outline" onClick={() => set({ editUser: u.id })} title="基本情報を編集">
              <Icon name="ros" size={16} strokeWidth={1.8} />
              編集
            </button>
          )}
          <button className="btn btn-primary" onClick={() => set({ screen: 'pdf', pdfMode: 'single', pdfUser: u.id, pdfYear: lastY, pdfQ: '' })}>
            <Icon name="download" size={16} strokeWidth={1.8} />
            結果票 PDF
          </button>
        </div>
      </Card>

      <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
        {/* 左カラム */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card pad>
            <div className="t-h4">基本情報</div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
              {profile.map(p => (
                <div key={p.k} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'baseline' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{p.k}</div>
                  <div className="t-num" style={{ fontSize: 13 }}>{p.v}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card pad>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="t-h4">気づきメモ</div>
              <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{memos.length} 件</div>
            </div>
            {memos.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: '10px 0 2px', lineHeight: 1.6 }}>まだ登録がありません。測定時の様子や体調の変化を残せます。</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
              {memos.slice().reverse().map((mm, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{mm.text}</div>
                  <div className="t-num" style={{ fontSize: 10.5, color: 'var(--fg-4)', marginTop: 3 }}>{mm.date} · {mm.by}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input
                className="field" style={{ flex: 1, height: 36, fontSize: 12.5, minWidth: 0 }}
                value={state.memoDraft}
                onChange={(e) => set({ memoDraft: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') memoAdd() }}
                placeholder="例: 右膝の痛みを訴え"
              />
              <button className="btn btn-primary" style={{ height: 36, fontSize: 12.5, flexShrink: 0 }} onClick={memoAdd}>追加</button>
            </div>
          </Card>

          <Card pad>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="t-h4">参加履歴</div>
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{canEdit ? '測定した年をクリックで編集' : '年 1 回測定'}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
              {hist.map(h => {
                const editable = canEdit && h.measured
                return (
                  <div key={h.era} onClick={editable ? () => set({ editMeas: { id: u.id, year: h.year } }) : undefined}
                    title={editable ? `${h.era}年度の測定値を編集` : undefined}
                    style={{ display: 'grid', gridTemplateColumns: '58px 1fr 56px 74px 18px', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', cursor: editable ? 'pointer' : 'default', borderRadius: 6 }}
                    onMouseEnter={editable ? (e) => e.currentTarget.style.background = 'var(--bg-hover)' : undefined}
                    onMouseLeave={editable ? (e) => e.currentTarget.style.background = 'transparent' : undefined}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.era}</div>
                    <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {h.date}
                      {h.review && <span title="要確認（年度間で値が食い違います）" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--warning-700)', background: 'var(--warning-50)', borderRadius: 999, padding: '0 6px' }}>要確認</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="t-num" style={{ fontSize: 13, fontWeight: 600 }}>{h.total}</span>
                      <span style={{ fontSize: 10, color: 'var(--fg-4)' }}> {h.suffix}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: h.st[1], color: h.st[2] }}>{h.st[0]}</span>
                    </div>
                    <div style={{ textAlign: 'right', color: 'var(--fg-4)' }}>{editable && <Icon name="chevR" size={13} />}</div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card pad>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="t-h4">最新の測定値</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                {canEdit && last && (
                  <button className="btn btn-ghost btn-sm" style={{ height: 22, padding: '0 6px', fontSize: 11.5 }} onClick={() => set({ editMeas: { id: u.id, year: lastY } })}>編集</button>
                )}
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{last ? last.date : '—'}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 70px 60px', gap: 6, alignItems: 'center', marginTop: 12, paddingBottom: 6, borderBottom: '1px solid var(--border-default)' }}>
              <div className="t-overline">項目</div>
              <div className="t-overline" style={{ textAlign: 'right' }}>今回</div>
              <div className="t-overline" style={{ textAlign: 'right' }}>前回比</div>
              <div className="t-overline" style={{ textAlign: 'right' }}>市平均</div>
            </div>
            {detRows.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 70px 60px', gap: 6, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 12.5 }}>{r.label} <span style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>{r.unit}</span></div>
                <div className="t-num" style={{ fontSize: 13.5, fontWeight: 600, textAlign: 'right' }}>{r.cur}</div>
                <div className="t-num" style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', color: r.deltaFg }}>{r.delta}</div>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'right' }}>{r.avg}</div>
              </div>
            ))}
          </Card>

          {ibLast && (
            <Card pad>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div className="t-h4">体組成（InBody）</div>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{eraOf(ibLastY)}年度 · {ibLast.date}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
                {[
                  ['骨格筋量', ibLast.smm, 'kg', ibPrev?.smm, 'high', 1],
                  ['体脂肪率', ibLast.fatPct, '%', ibPrev?.fatPct, 'none', 1],
                  ['SMI（骨格筋指数）', ibLast.smi, 'kg/m²', ibPrev?.smi, 'high', 1],
                  ['InBody 点数', ibLast.score, '点', ibPrev?.score, 'high', 0],
                ].map(([label, v, unit, pv, better, dec]) => {
                  const d = deltaOf(v, pv ?? null, dec, better)
                  const low = String(label).startsWith('SMI') && v !== null && v < smiCut
                  return (
                    <div key={label} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 64px', gap: 6, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 12.5 }}>
                        {label} <span style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>{unit}</span>
                        {low && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--danger-700)', background: 'var(--danger-50)', borderRadius: 999, padding: '1px 7px' }}>基準未満</span>}
                      </div>
                      <div className="t-num" style={{ fontSize: 13.5, fontWeight: 600, textAlign: 'right', color: low ? 'var(--danger-700)' : 'var(--fg-1)' }}>{fmtD(v, dec)}</div>
                      <div className="t-num" style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', color: d.fg }}>{d.txt}</div>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.6 }}>SMI 男性 7.0 / 女性 5.7 kg/m² 未満は筋肉量低下（サルコペニア）の指標。CSV 取り込みで LookinBody の書き出しに対応しています。</div>
            </Card>
          )}

          {kcl && (
            <Card pad>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <div className="t-h4">基本チェックリスト（問診）</div>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{eraOf(lastY)}年度 · {kcl.date}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <div style={{ textAlign: 'center', minWidth: 74, padding: '8px 10px', borderRadius: 10, background: kclL.bg }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, justifyContent: 'center' }}>
                    <span className="t-num" style={{ fontSize: 26, fontWeight: 700, color: kclL.fg }}>{kcl.total}</span>
                    <span style={{ fontSize: 11, color: kclL.fg }}>/25</span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: kclL.fg }}>{kclL.label}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {kcl.target ? (
                    <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                      <span style={{ fontWeight: 700, color: 'var(--danger-700)' }}>事業対象者に該当</span><br />
                      <span style={{ color: 'var(--fg-3)', fontSize: 11.5 }}>{kcl.reasons.map(r => r.label).join(' / ')}</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>事業対象者の該当基準には当てはまりません</div>
                  )}
                </div>
              </div>

              {/* 領域別 該当項目数 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
                {KCL_DOMAINS.map(d => {
                  const c = kcl.domainCounts[d.id], max = d.nos.length
                  const hit = c > 0
                  return (
                    <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '68px 1fr 42px', gap: 10, alignItems: 'center' }}>
                      <div style={{ fontSize: 12, color: hit ? 'var(--fg-1)' : 'var(--fg-3)', fontWeight: hit ? 600 : 400 }}>{d.label}</div>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {Array.from({ length: max }, (_, i) => (
                          <div key={i} style={{ flex: 1, height: 7, borderRadius: 2, background: i < c ? kclL.bar : 'var(--slate-100)' }} />
                        ))}
                      </div>
                      <div className="t-num" style={{ fontSize: 11.5, color: 'var(--fg-3)', textAlign: 'right' }}>{c}/{max}</div>
                    </div>
                  )
                })}
              </div>

              {/* 合計点の推移 */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14 }}>
                <div className="t-overline">合計点の推移</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>点が低いほど良好</div>
              </div>
              <svg width="100%" height="88" viewBox="0 0 280 96" preserveAspectRatio="none" style={{ display: 'block', marginTop: 4 }}>
                {kclAuto.ticks.map((tk, i) => (
                  <g key={i}>
                    <line x1="26" y1={tk.y} x2="272" y2={tk.y} stroke="var(--slate-100)" strokeWidth="1" />
                    <text x="22" y={tk.y + 3.5} textAnchor="end" fontSize="9" fill="var(--slate-400)" fontFamily="Inter">{tk.v}</text>
                  </g>
                ))}
                <path d={kclLine.path} fill="none" stroke={kclL.bar} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                {kclLine.pts.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="3.2" fill="var(--bg-surface)" stroke={kclL.bar} strokeWidth="2" />
                    <text x={p.x} y={p.y < 20 ? p.y + 15 : p.y - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--slate-700)" fontFamily="Inter">{p.v}</text>
                  </g>
                ))}
                {D.YEARS.map((y, i) => (
                  <text key={y} x={Math.round(40 + (i * (250 - 40)) / 5)} y="92" textAnchor="middle" fontSize="9" fill="var(--slate-500)">{eraOf(y).replace('令和', 'R')}</text>
                ))}
              </svg>

              {/* 該当した設問 */}
              {kcl.hitQuestions.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                  <div className="t-overline" style={{ marginBottom: 6 }}>該当した設問（{kcl.hitQuestions.length} 件）</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {kcl.hitQuestions.map(q => (
                      <div key={q.no} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, lineHeight: 1.5 }}>
                        <span className="t-num" style={{ color: 'var(--fg-4)', flexShrink: 0, minWidth: 18 }}>{q.no}.</span>
                        <span style={{ color: 'var(--fg-2)' }}>{q.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: 'var(--fg-4)', marginTop: 10, lineHeight: 1.6 }}>設問により「はい／いいえ」どちらで1点かが異なります。No.12（BMI 18.5 未満）は測定値から自動判定。</div>
            </Card>
          )}
        </div>

        {/* 右カラム */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="radar-trend" style={{ display: 'grid', gridTemplateColumns: '290px 1fr', gap: 16, alignItems: 'stretch' }}>
            <Card pad>
              <div className="t-h4">5領域評価</div>
              <svg width="100%" viewBox="0 0 260 232" style={{ display: 'block', marginTop: 4 }}>
                {g.rings.map((rg, i) => <polygon key={i} points={rg} fill="none" stroke="var(--slate-100)" strokeWidth="1" />)}
                {g.axesGeo.map((ax, i) => (
                  <g key={i}>
                    <line x1="130" y1="112" x2={ax.x2} y2={ax.y2} stroke="var(--slate-200)" strokeWidth="1" />
                    <text x={ax.lx} y={ax.ly} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--slate-600)">{ax.label}</text>
                  </g>
                ))}
                {muniAgg.count > 0 && <polygon points={g.poly(muniAgg.axes)} fill="none" stroke="var(--info-500)" strokeWidth="1.5" strokeDasharray="3 3" />}
                {prev && <polygon points={g.poly(prev.axes)} fill="none" stroke="var(--slate-400)" strokeWidth="1.5" strokeDasharray="5 3" />}
                {last && <polygon points={g.poly(last.axes)} fill="rgba(242,106,31,0.14)" stroke="var(--brand-500)" strokeWidth="2" strokeLinejoin="round" />}
              </svg>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                <LegendSwatch kind="line" color="var(--brand-500)" label="今回" />
                <LegendSwatch kind="dash" color="var(--slate-400)" label="前回" />
                <LegendSwatch kind="dot" color="var(--info-500)" label="市町村平均" />
              </div>
            </Card>
            <Card pad style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div className="t-h4">年次推移</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Select sm value={state.detMetric} onChange={(e) => set({ detMetric: e.target.value })}
                    options={[{ v: 'total', l: '総合スコア' }].concat(colsBmi.map(c => ({ v: c.id, l: c.label })))} />
                  <LegendSwatch kind="line" color="var(--brand-500)" label="本人" />
                  <LegendSwatch kind="dash" color="var(--slate-300)" label="市町村平均" />
                </div>
              </div>
              <svg width="100%" height="196" viewBox="0 0 520 196" preserveAspectRatio="none" style={{ display: 'block', marginTop: 8 }}>
                {tAuto.ticks.map((tk, i) => (
                  <g key={i}>
                    <line x1="30" y1={tk.y} x2="508" y2={tk.y} stroke="var(--slate-100)" strokeWidth="1" />
                    <text x="24" y={tk.y + 3.5} textAnchor="end" fontSize="10" fill="var(--slate-400)" fontFamily="Inter">{fmtD(tk.v, mcol.dec)}</text>
                  </g>
                ))}
                {tAuto.lines[1] && <path d={tAuto.lines[1].path} fill="none" stroke="var(--slate-300)" strokeWidth="1.5" strokeDasharray="5 4" />}
                <path d={tAuto.lines[0].path} fill="none" stroke="var(--brand-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {tAuto.lines[0].pts.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-surface)" stroke="var(--brand-500)" strokeWidth="2" />
                    <text x={p.x} y={p.y < 36 ? p.y + 17 : p.y - 9} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--slate-700)" fontFamily="Inter">{fmtD(Math.round(p.v * 10) / 10, mcol.dec)}</text>
                  </g>
                ))}
                {D.YEARS.map((y, i) => (
                  <text key={y} x={Math.round(56 + (i * (490 - 56)) / 5)} y="189" textAnchor="middle" fontSize="10" fill="var(--slate-500)" fontFamily="Inter">{eraOf(y)}</text>
                ))}
              </svg>
            </Card>
          </div>

          <div className="quad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {detMult.map(m => (
              <Card key={m.id} style={{ padding: '12px 14px', minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', fontWeight: 500 }}>{m.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
                  <span className="t-num" style={{ fontSize: 19, fontWeight: 600 }}>{m.val}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>{m.unit}</span>
                  <span className="t-num" style={{ fontSize: 11, fontWeight: 600, color: m.deltaFg, marginLeft: 'auto' }}>{m.delta}</span>
                </div>
                <svg width="100%" height="34" viewBox="0 0 120 34" preserveAspectRatio="none" style={{ display: 'block', marginTop: 6 }}>
                  {m.spark && <polyline points={m.spark} fill="none" stroke="var(--brand-400)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
                </svg>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
