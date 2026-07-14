import D from '../data/engine.js'
import { useStore, pendingSheets, allEvents, staffNames, flagsFor, batchN, openSheetVals } from '../store.jsx'
import { mdw, addDays, eraOf, colsPlus, itemAvg, autoLines, betterNote, fmtD } from '../lib/helpers.js'
import { Card, Pill, Overline, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

function StatCard({ label, labelColor, value, valueColor, unit, foot, onClick }) {
  return (
    <Card pad clickable={!!onClick} onClick={onClick} style={{ padding: '16px 18px' }}>
      <Overline style={labelColor ? { color: labelColor } : undefined}>{label}</Overline>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 6 }}>
        <span className="t-num" style={{ fontSize: 28, fontWeight: 600, color: valueColor, letterSpacing: '-0.01em' }}>{value}</span>
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>{foot}</div>
    </Card>
  )
}

export default function Dashboard() {
  const { state, set, setState, showToast } = useStore()
  const cur = D.CUR
  const done = D.users.filter(u => u.meas[cur]).length
  const newN = D.users.filter(u => u.joined === cur).length
  const pend = pendingSheets(state)
  const ages = D.users.map(u => u.age)
  const statAge = Math.round((ages.reduce((a, b) => a + b, 0) / Math.max(1, ages.length)) * 10) / 10
  const statFRate = Math.round((D.users.filter(u => u.sex === 'F').length / Math.max(1, D.users.length)) * 100)
  const statOld = D.users.filter(u => u.age >= 85).length

  const muniProg = D.REGIONS.map(r => {
    const total = D.users.filter(u => u.region === r).length
    const d = D.users.filter(u => u.region === r && u.meas[cur]).length
    return { name: r, done: d, total, w: Math.round((d / Math.max(1, total)) * 100) + '%' }
  })

  const stMap = { done: ['本登録済', 'var(--success-50)', 'var(--success-700)'], wait: ['読み取り待ち', 'var(--warning-50)', 'var(--warning-700)'], review: ['確認待ち', 'var(--warning-50)', 'var(--warning-700)'] }
  const curSt = state.imp === 'committed' ? 'done' : (state.imp === 'scanned' ? (pend.length ? 'review' : 'done') : 'wait')
  const batches = [
    { date: '2025/09/24', venue: D.batchMeta.venue, count: batchN(), st: curSt },
    { date: '2025/09/18', venue: '高瀬市総合福祉会館', count: 41, st: 'done' },
    { date: '2025/09/12', venue: '美里町いきいきセンター', count: 35, st: 'done' },
    { date: '2025/09/05', venue: '若葉町公民館', count: 28, st: 'done' },
  ]

  const cbm = colsPlus()
  const dcol = cbm.find(c => c.id === state.dashItem) || cbm[3]
  const dSeries = D.YEARS.map(y => ({ year: y, v: itemAvg(D.users, y, dcol.id) }))
  const dAuto = autoLines([{ pts: dSeries }], D.YEARS, 70, 520, 24, 132)
  const dLine = dAuto.lines[0] || { path: '', pts: [] }

  const evsAll = allEvents(state)
  const dashEvCards = []
  ;[[D.TODAY, '本日'], [addDays(D.TODAY, 1), '明日']].forEach(([ds, when]) => {
    evsAll.filter(e => e.date === ds && e.kind === 'meas').forEach(e => {
      const parts = e.code ? D.users.filter(u => u.venueCode === e.code) : []
      const sn = staffNames(e.staff)
      dashEvCards.push({
        when, md: mdw(ds).replace(/（.）/, ''),
        title: '測定会 — ' + e.venue,
        sub: e.muni + ' · ' + (e.time || '') + (parts.length ? ' · 対象 ' + parts.length + ' 名' : '') + (sn.length ? ' · 測定者 ' + sn.join('・') : ''),
        names: parts.slice(0, 10).map(u => u.name),
        more: parts.length > 10 ? parts.length - 10 : 0,
      })
    })
  })

  const openFlagged = (no) => {
    const patch = openSheetVals(state, no)
    if (patch) setState(s => ({ ...s, screen: 'imp', ...patch }))
  }

  // ---- 今日のやること（作業キュー） ----
  const tasks = []
  if (state.imp === 'idle') {
    tasks.push({ icon: 'imp', bg: 'var(--brand-50)', fg: 'var(--brand-600)', title: `記録用紙 ${batchN()} 枚が読み取り待ち`, sub: `${D.batchMeta.venue} · モバイル撮影から受信済み`, go: () => set({ screen: 'imp' }) })
  } else if (state.imp === 'run') {
    tasks.push({ icon: 'imp', bg: 'var(--brand-50)', fg: 'var(--brand-600)', title: '手書き数値を読み取り中…', sub: `${state.impCount} / ${batchN()} 枚`, go: () => set({ screen: 'imp' }) })
  } else if (state.imp === 'scanned') {
    if (pend.length > 0) tasks.push({ icon: 'warn', bg: 'var(--warning-50)', fg: 'var(--warning-700)', title: `要確認の用紙 ${pend.length} 件`, sub: '読み取り結果の確認が必要です', go: () => openFlagged(pend[0].no) })
    else tasks.push({ icon: 'check', bg: 'var(--success-50)', fg: 'var(--success-700)', title: `${batchN()} 枚の本登録待ち`, sub: '確認が完了しました。本登録できます', go: () => set({ screen: 'imp' }) })
  }
  const tomorrowMeas = evsAll.filter(e => e.date === addDays(D.TODAY, 1) && e.kind === 'meas')
  if (tomorrowMeas.length > 0) {
    tasks.push({ icon: 'printer', bg: 'var(--info-50)', fg: 'var(--info-700)', title: `明日の測定会 ${tomorrowMeas.length} 件の用紙準備`, sub: tomorrowMeas.map(e => e.muni).join('・') + ' — 記録用紙を印刷', go: () => set({ screen: 'sheet' }) })
  }
  const [, tm, td] = D.TODAY.split('/').map(Number)
  const tw = '日月火水木金土'[new Date(D.TODAY).getDay()]

  return (
    <div className="screen">
      {/* 今日のやること */}
      <Card style={{ display: 'flex', alignItems: 'stretch', padding: 0, overflow: 'hidden', flexWrap: 'wrap' }}>
        {/* 日めくりブロック */}
        <div style={{ width: 128, background: 'linear-gradient(150deg, var(--brand-500), var(--brand-600))', color: '#fff', padding: '14px 16px', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <svg width="128" height="110" viewBox="0 0 128 110" style={{ position: 'absolute', right: -8, bottom: -10, opacity: 0.5 }} aria-hidden="true">
            <defs><pattern id="cmDots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#FF8A3C" /></pattern></defs>
            <rect width="128" height="110" fill="url(#cmDots)" />
          </svg>
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--brand-100)' }}>令和7年度</div>
            <div className="t-display t-num" style={{ fontSize: 30, lineHeight: 1.2, marginTop: 2 }}>{tm}/{td}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--brand-100)', marginTop: 1 }}>{tw}曜日</div>
          </div>
        </div>
        {/* 作業キュー */}
        <div style={{ flex: 1, minWidth: 320, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', flexWrap: 'wrap' }}>
          <div className="t-overline" style={{ writingMode: 'vertical-rl', letterSpacing: '0.22em', color: 'var(--brand-600)', flexShrink: 0, marginRight: 4 }}>やること</div>
          {tasks.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--success-50)', color: 'var(--success-700)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="check" size={16} strokeWidth={2} />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>本日のやることはありません</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>受信した用紙はすべて処理済みです</div>
              </div>
            </div>
          )}
          {tasks.map((t, i) => (
            <button key={i} onClick={t.go} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 8px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--slate-25)', cursor: 'pointer', textAlign: 'left', transition: 'background var(--dur-fast), border-color var(--dur-fast)', minWidth: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-default)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--slate-25)'; e.currentTarget.style.borderColor = 'var(--border-subtle)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: t.bg, color: t.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name={t.icon} size={16} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{t.sub}</div>
              </div>
              <Icon name="chevR" size={14} style={{ color: 'var(--slate-400)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
        {/* 年度進捗 */}
        <div style={{ width: 216, borderLeft: '1px solid var(--border-subtle)', padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div className="t-overline">年度の測定進捗</div>
            <span className="t-num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-600)' }}>{Math.round((done / Math.max(1, D.users.length)) * 100)}%</span>
          </div>
          <div className="meter"><div style={{ width: Math.round((done / Math.max(1, D.users.length)) * 100) + '%' }} /></div>
          <div className="t-num" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{done} / {D.users.length} 名 · 残り {D.users.length - done} 名</div>
        </div>
      </Card>

      {/* 統計カード */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="登録利用者" value={D.users.length} unit="名" foot={<>うち今年度の新規 <span className="t-num">{newN}</span> 名</>} />
        <StatCard label="令和7年度 測定済" value={done} unit="名" foot={<>参加率 <span className="t-num">{Math.round((done / Math.max(1, D.users.length)) * 100)}</span>%</>} />
        <StatCard label="要確認" labelColor="var(--warning-700)" value={pend.length} valueColor={pend.length ? 'var(--warning-700)' : 'var(--fg-1)'} unit="件" foot="読み取り結果の確認待ち" onClick={() => set({ screen: 'imp' })} />
        <StatCard label="参加者の平均年齢" value={statAge} unit="歳" foot={<>女性 <span className="t-num">{statFRate}</span>% · 85歳以上 <span className="t-num">{statOld}</span> 名</>} />
      </div>

      {/* 本日・明日の測定会 */}
      {dashEvCards.map((ec, i) => (
        <Card key={i} style={{ borderColor: 'var(--brand-200)', padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ width: 50, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-700)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '7px 0 8px', flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>{ec.when}</span>
            <span className="t-num" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2, marginTop: 1 }}>{ec.md}</span>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{ec.title}</span>
              <span className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{ec.sub}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
              {ec.names.map(nm => <span key={nm} className="chip">{nm}</span>)}
              {ec.more > 0 && <span className="t-num" style={{ height: 24, padding: '0 6px', color: 'var(--fg-3)', fontSize: 12, display: 'inline-flex', alignItems: 'center' }}>ほか {ec.more} 名</span>}
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => set({ screen: 'cal' })}>カレンダーで見る</button>
        </Card>
      ))}

      {/* 区域別 + 要確認 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16, alignItems: 'start' }}>
        <Card pad>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div className="t-h4">区域別の参加状況</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>令和7年度 測定済 / 登録</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
            {muniProg.map(m => (
              <div key={m.name} style={{ display: 'grid', gridTemplateColumns: '76px 1fr 84px', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                <div className="meter"><div style={{ width: m.w }} /></div>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'right' }}>{m.done} / {m.total} 名</div>
              </div>
            ))}
          </div>
        </Card>
        <Card pad>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div className="t-h4">確認が必要な用紙</div>
            <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{pend.length} 件</div>
          </div>
          {pend.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '26px 0 18px' }}>
              <svg width="72" height="48" viewBox="0 0 72 48" fill="none" aria-hidden="true">
                <rect x="14" y="4" width="36" height="40" rx="3" stroke="var(--slate-200)" strokeWidth="2" />
                <path d="M22 14h20M22 21h20M22 28h12" stroke="var(--slate-200)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="52" cy="34" r="11" fill="var(--bg-surface)" stroke="var(--brand-200)" strokeWidth="2" />
                <path d="m47.5 34 3 3 6-6" stroke="var(--brand-300)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div style={{ fontSize: 13, color: 'var(--fg-3)', textAlign: 'center', lineHeight: 1.6 }}>
                {state.imp === 'idle' ? '読み取りを開始すると、確認が必要な用紙がここに表示されます' : '確認待ちの用紙はありません'}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
            {pend.slice(0, 5).map(sh => {
              const u = D.users.find(x => x.id === sh.userId)
              return (
                <div key={sh.no} onClick={() => openFlagged(sh.no)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderRadius: 8, cursor: 'pointer' }} className="tbl-row clickable">
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--warning-50)', color: 'var(--warning-700)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name="warn" size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>用紙 No.{sh.no} — {u ? u.name : sh.ocrName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{flagsFor(sh)[0].message}</div>
                  </div>
                  <Icon name="chevR" size={16} style={{ color: 'var(--slate-400)' }} />
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* 直近の取り込み + 推移 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr', gap: 16, alignItems: 'start' }}>
        <Card pad>
          <div className="t-h4">直近の取り込み</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
            {batches.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)', width: 76 }}>{b.date}</div>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.venue}</div>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-2)' }}>{b.count} 枚</div>
                <Pill bg={stMap[b.st][1]} fg={stMap[b.st][2]}>{stMap[b.st][0]}</Pill>
              </div>
            ))}
          </div>
        </Card>
        <Card pad>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div className="t-h4">運動機能の推移（全体平均）</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Select sm value={state.dashItem} onChange={(e) => set({ dashItem: e.target.value })} options={cbm.map(c => ({ v: c.id, l: c.label }))} />
              <button className="btn btn-outline btn-sm" onClick={() => set({ screen: 'ana' })}>詳しく分析</button>
            </div>
          </div>
          <svg width="100%" height="170" viewBox="0 0 560 170" preserveAspectRatio="none" style={{ marginTop: 10, display: 'block' }}>
            {dAuto.ticks.map((tk, i) => (
              <g key={i}>
                <line x1="36" y1={tk.y} x2="548" y2={tk.y} stroke="var(--slate-100)" strokeWidth="1" />
                <text x="30" y={tk.y + 3.5} textAnchor="end" fontSize="10" fill="var(--slate-400)" fontFamily="Inter">{fmtD(tk.v, dcol.dec)}</text>
              </g>
            ))}
            <path d={dLine.path} fill="none" stroke="var(--brand-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {dLine.pts.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="3.5" fill="var(--bg-surface)" stroke="var(--brand-500)" strokeWidth="2" />
                <text x={p.x} y={p.y < 44 ? p.y + 17 : p.y - 9} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--slate-700)" fontFamily="Inter">{fmtD(Math.round(p.v * 10) / 10, dcol.dec)}</text>
                <text x={p.x} y="162" textAnchor="middle" fontSize="10" fill="var(--slate-500)" fontFamily="Inter">{eraOf(p.year)}</text>
              </g>
            ))}
          </svg>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            各年度に測定したすべての方の平均{dcol.unit ? ' · 単位 ' + dcol.unit : ''}{betterNote(dcol) ? ' · ' + betterNote(dcol) : ''} — 集団の入れ替わりを含むため、詳しくは集計分析へ
          </div>
        </Card>
      </div>
    </div>
  )
}
