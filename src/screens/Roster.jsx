import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { deltaOf } from '../lib/helpers.js'
import { Card, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const GRID = '72px 1.5fr 92px 1.2fr 116px 96px 170px 30px'
const PER = 12

export function filteredUsers(state) {
  const q = state.q.trim().toLowerCase()
  let list = D.users.filter(u => {
    if (state.rosRegion !== 'all' && u.region !== state.rosRegion) return false
    if (state.rosMuni !== 'all' && u.muni !== state.rosMuni) return false
    if (state.rosStatus === 'measured' && !u.meas[D.CUR]) return false
    if (state.rosStatus === 'unmeasured' && u.meas[D.CUR]) return false
    if (state.rosStatus === 'new' && u.joined !== D.CUR) return false
    if (q && !(u.name.toLowerCase().includes(q) || u.kana.toLowerCase().includes(q) || u.id.includes(q))) return false
    return true
  })
  const latest = (u) => { const ys = Object.keys(u.meas); return ys.length ? u.meas[ys[ys.length - 1]] : null }
  const dlt = (u) => { const ys = Object.keys(u.meas); return ys.length > 1 ? u.meas[ys[ys.length - 1]].total - u.meas[ys[ys.length - 2]].total : 999 }
  if (state.rosSort === 'score') list = list.slice().sort((a, b) => ((latest(b) || {}).total || -1) - ((latest(a) || {}).total || -1))
  else if (state.rosSort === 'decline') list = list.slice().sort((a, b) => dlt(a) - dlt(b))
  else if (state.rosSort === 'age') list = list.slice().sort((a, b) => b.age - a.age)
  else list = list.slice().sort((a, b) => a.id.localeCompare(b.id))
  return list
}

export default function Roster() {
  const { state, set } = useStore()
  const list = filteredUsers(state)
  const maxPage = Math.max(0, Math.ceil(list.length / PER) - 1)
  const page = Math.min(state.rosPage, maxPage)
  const rows = list.slice(page * PER, page * PER + PER)
  const opt = (v, l) => ({ v, l })

  return (
    <div className="screen">
      {/* フィルタバー */}
      <Card style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Select value={state.rosRegion} onChange={(e) => set({ rosRegion: e.target.value, rosMuni: 'all', rosPage: 0 })}
          options={[opt('all', 'すべての圏域')].concat(D.REGIONS.map(r => opt(r, r)))} />
        <Select value={state.rosMuni} onChange={(e) => set({ rosMuni: e.target.value, rosPage: 0 })}
          options={[opt('all', 'すべての市町村')].concat(D.MUNIS.filter(m => state.rosRegion === 'all' || m.region === state.rosRegion).map(m => opt(m.id, m.name)))} />
        <Select value={state.rosStatus} onChange={(e) => set({ rosStatus: e.target.value, rosPage: 0 })}
          options={[opt('all', 'すべての状態'), opt('measured', '令和7年度 測定済'), opt('unmeasured', '令和7年度 未測定'), opt('new', '今年度の新規')]} />
        <Select value={state.rosSort} onChange={(e) => set({ rosSort: e.target.value, rosPage: 0 })}
          options={[opt('id', 'ID 順'), opt('score', '総合スコアが高い順'), opt('decline', '低下が大きい順'), opt('age', '年齢が高い順')]} />
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
          <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{list.length}</span> 名
        </div>
      </Card>

      {/* 一覧 */}
      <Card style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 960 }}>
          <div className="tbl-head" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '0 16px', height: 40, alignItems: 'center', whiteSpace: 'nowrap' }}>
            <div className="t-overline">ID</div>
            <div className="t-overline">氏名</div>
            <div className="t-overline">年齢・性別</div>
            <div className="t-overline">市町村・会場</div>
            <div className="t-overline">電話番号</div>
            <div className="t-overline">最新測定</div>
            <div className="t-overline">総合スコア・推移</div>
            <div />
          </div>
          {rows.map(u => {
            const ys = Object.keys(u.meas)
            const last = ys.length ? u.meas[ys[ys.length - 1]] : null
            const prev = ys.length > 1 ? u.meas[ys[ys.length - 2]] : null
            const d = deltaOf(last ? last.total : null, prev ? prev.total : null, 0, 'high')
            const totals = ys.map(y => u.meas[y].total)
            const spark = totals.length > 1
              ? totals.map((v, i) => (4 + (i * 56) / (totals.length - 1)).toFixed(1) + ',' + (19 - ((Math.max(20, Math.min(95, v)) - 20) * 16) / 75).toFixed(1)).join(' ')
              : ''
            return (
              <div key={u.id} className="tbl-row clickable" onClick={() => set({ screen: 'det', detId: u.id })}
                style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 16px', alignItems: 'center' }}>
                <div className="t-num" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{u.id}</div>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.kana}</div>
                  </div>
                  {u.joined === D.CUR && (
                    <span style={{ height: 18, padding: '0 7px', borderRadius: 999, background: 'var(--info-50)', color: 'var(--info-700)', fontSize: 10.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>新規</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}><span className="t-num">{u.age}</span> 歳 · {u.sexLabel}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5 }}>{u.muniName}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.venueName}</div>
                </div>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{u.phone || '—'}</div>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-2)' }}>{last ? last.date : '未測定'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="t-num" style={{ fontSize: 15, fontWeight: 600, width: 30, textAlign: 'right' }}>{last ? last.total : '—'}</span>
                  <svg width="64" height="22" viewBox="0 0 64 22" style={{ flexShrink: 0 }}>
                    {spark && <polyline points={spark} fill="none" stroke="var(--brand-400)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
                  </svg>
                  <span className="t-num" style={{ fontSize: 11.5, fontWeight: 600, color: d.fg }}>{d.txt}</span>
                </div>
                <Icon name="chevR" size={16} style={{ color: 'var(--slate-400)' }} />
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>
            <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              {list.length ? (page * PER + 1) + '–' + Math.min(list.length, (page + 1) * PER) + ' / ' + list.length + ' 名' : '0 名'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => set({ rosPage: Math.max(0, page - 1) })}>前へ</button>
              <button className="btn btn-outline btn-sm" onClick={() => set({ rosPage: Math.min(maxPage, page + 1) })}>次へ</button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
