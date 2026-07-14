import D from '../data/engine.js'
import { useStore, allEvents, muniByName, staffNames, EV_KINDS } from '../store.jsx'
import { mdw } from '../lib/helpers.js'
import { Card } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

export default function Calendar() {
  const { state, set } = useStore()
  const evs = allEvents(state)
  const y = state.calY, m = state.calM
  const off = new Date(y, m - 1, 1).getDay()
  const dim = new Date(y, m, 0).getDate()
  const pad2 = (n) => String(n).padStart(2, '0')
  const cells = []
  for (let i = 0; i < Math.ceil((off + dim) / 7) * 7; i++) {
    const dnum = i - off + 1
    const inM = dnum >= 1 && dnum <= dim
    const ds = inM ? y + '/' + pad2(m) + '/' + pad2(dnum) : null
    const dayEvs = inM ? evs.filter(e => e.date === ds) : []
    cells.push({ dnum, inM, ds, dayEvs, isToday: ds === D.TODAY })
  }
  const upcoming = evs.filter(e => e.date >= D.TODAY).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6)

  const openEvModal = (ds) => set({
    evOpen: true, evDate: ds, evKind: 'meas', evTitle: '', evVenue: '', evMuni: 'sakuragawa', evTime: '',
    evNewMuni: '', evNewRegion: '', evStaff: [],
  })

  return (
    <div className="screen cal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 288px', gap: 16, alignItems: 'start' }}>
      <Card style={{ overflow: 'hidden' }}>
        {/* カレンダーヘッダー */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-default)' }}>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => set(s => (s.calM <= 1 ? { calM: 12, calY: s.calY - 1 } : { calM: s.calM - 1 }))} aria-label="前の月">
            <Icon name="chevL" size={15} strokeWidth={2} />
          </button>
          <div className="t-num" style={{ fontSize: 16, fontWeight: 700, minWidth: 118, textAlign: 'center' }}>{y}年 {m}月</div>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => set(s => (s.calM >= 12 ? { calM: 1, calY: s.calY + 1 } : { calM: s.calM + 1 }))} aria-label="次の月">
            <Icon name="chevR" size={15} strokeWidth={2} />
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => set({ calY: 2025, calM: 9 })}>今日</button>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>日付をクリックすると予定を追加できます</div>
        </div>
        {/* 曜日ヘッダー */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--slate-25)', borderBottom: '1px solid var(--border-default)' }}>
          {['日', '月', '火', '水', '木', '金', '土'].map((l, i) => (
            <div key={l} style={{ padding: '6px 0', textAlign: 'center', fontSize: 11, fontWeight: 600, color: i === 0 ? 'var(--danger-700)' : i === 6 ? 'var(--info-700)' : 'var(--slate-500)' }}>{l}</div>
          ))}
        </div>
        {/* 日セル */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((c, i) => (
            <div key={i}
              onClick={c.inM ? () => openEvModal(c.ds) : undefined}
              className="cal-day"
              style={{
                minHeight: 94,
                borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)',
                padding: 6, cursor: c.inM ? 'pointer' : 'default',
                background: c.inM ? 'var(--bg-surface)' : 'var(--slate-25)',
                minWidth: 0, transition: 'background var(--dur-fast)',
              }}
              onMouseEnter={(e) => { if (c.inM) e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { if (c.inM) e.currentTarget.style.background = 'var(--bg-surface)' }}
            >
              <span className="t-num" style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, background: c.isToday ? 'var(--brand-500)' : 'transparent', color: c.isToday ? '#fff' : (c.inM ? 'var(--fg-2)' : 'var(--fg-4)') }}>
                {c.inM ? c.dnum : ''}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {c.dayEvs.slice(0, 2).map((e, j) => {
                  const mu = e.muni ? muniByName(state, e.muni) : null
                  return (
                    <div key={j} style={{ padding: '3px 6px 4px', borderRadius: 4, background: EV_KINDS[e.kind][1], minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: EV_KINDS[e.kind][2], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.kind === 'meas' ? '測定会 · ' + e.muni : e.title}
                      </div>
                      <div style={{ fontSize: 9.5, fontWeight: 500, color: EV_KINDS[e.kind][2], opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {(mu ? mu.region + ' · ' : '') + (e.venue || '')}
                      </div>
                    </div>
                  )
                })}
                {c.dayEvs.length > 2 && (
                  <div className="t-num" style={{ fontSize: 10, color: 'var(--fg-3)', paddingLeft: 2 }}>+{c.dayEvs.length - 2} 件</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* サイド */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={() => openEvModal(D.TODAY)}>
          <Icon name="plus" size={16} strokeWidth={2} />
          新しい予定
        </button>
        <Card pad>
          <div className="t-h4">今後の予定</div>
          {upcoming.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: '10px 0 2px' }}>今後の予定はありません</div>}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
            {upcoming.map((e, i) => {
              const mu = e.muni ? muniByName(state, e.muni) : null
              const sn = staffNames(e.staff)
              return (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
                  <div className="t-num" style={{ minWidth: 62, fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', paddingTop: 1 }}>{mdw(e.date)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.kind === 'meas' ? '測定会 — ' + e.muni : e.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(mu ? mu.region + ' · ' : '') + (e.venue ? e.venue + ' · ' : '') + (e.time || '')}
                    </div>
                    {sn.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>測定者: {sn.join('・')}</div>
                    )}
                  </div>
                  <span style={{ height: 20, padding: '0 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: EV_KINDS[e.kind][1], color: EV_KINDS[e.kind][2], display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{EV_KINDS[e.kind][0]}</span>
                </div>
              )
            })}
          </div>
        </Card>
        <Card style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div className="t-overline">凡例</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-2)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--brand-100)', border: '1px solid var(--brand-300)' }} />測定会</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-2)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--info-50)', border: '1px solid var(--info-500)' }} />体操教室</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-2)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--slate-100)', border: '1px solid var(--slate-300)' }} />会議・研修 / その他</div>
        </Card>
      </div>
    </div>
  )
}
