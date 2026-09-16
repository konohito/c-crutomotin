import { useMemo, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { wardLabel } from '../lib/db.js'
import { auditUsers, auditSummary, KIND_LABEL } from '../lib/audit.js'
import { Card, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const GRID = '76px 1.5fr 96px 1.3fr 128px 110px 30px'
const PER = 12

/* データの点検 — あり得ない値・取り違えの疑いを台帳の上に出す。
   見つけて並べるだけで、データは書き換えない（直すかどうかは原本を見た職員が決める）。
   既定は閉じた状態にして、いつもの台帳の見た目を変えない。 */
export function AuditPanel({ defaultOpen = false }) {
  const { set } = useStore()
  const [open, setOpen] = useState(defaultOpen)
  // 台帳が大きいので、開いたときだけ点検する（毎回の描画で走らせない）
  const findings = useMemo(() => (open ? auditUsers(D.users) : []), [open])
  const sum = auditSummary(findings)
  const groups = useMemo(() => {
    const g = {}
    for (const f of findings) (g[f.kind] = g[f.kind] || []).push(f)
    return g
  }, [findings])

  return (
    <Card style={{ padding: '10px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <Icon name="chevR" size={16} style={{ color: 'var(--slate-400)', transform: open ? 'rotate(90deg)' : 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>データの点検</span>
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          {open
            ? (findings.length === 0 ? '気になる記録はありませんでした' : `${sum.users} 名・${findings.length} 件（要修正 ${sum.error} 件）`)
            : 'あり得ない値や、取り違えの疑いがある記録を探します'}
        </span>
      </div>
      {open && findings.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border-default)', paddingTop: 10 }}>
          {Object.entries(groups).map(([kind, list]) => (
            <div key={kind} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{KIND_LABEL[kind] || kind}（{list.length} 件）</div>
              {list.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.7, color: f.level === 'error' ? 'var(--danger-700)' : 'var(--fg-2)' }}>
                  <span role="button" tabIndex={0} onClick={() => set({ screen: 'det', detId: f.userId })}
                    style={{ color: 'var(--brand-600)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    {f.name}（ID {f.userId}）
                  </span>
                  <span style={{ color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{f.date}</span>
                  <span>{f.message}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.6 }}>
            ここに出た記録は自動では直しません。記録用紙・評価用紙の原本を確かめたうえで、個人詳細から修正してください。
          </div>
        </div>
      )}
    </Card>
  )
}

// フィルタ選択肢は実データ（D.users）から動的に作る。編集で市町村・行政区を追加すれば自動で増える。
const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
export const muniOptions = (region) =>
  distinct(D.users.filter(u => region === 'all' || u.region === region).map(u => u.muniName))
export const wardOptions = (muniName) =>
  distinct(D.users.filter(u => muniName === 'all' || u.muniName === muniName).map(u => u.venueName))

export function filteredUsers(state) {
  const q = state.q.trim().toLowerCase()
  let list = D.users.filter(u => {
    if (u.walkIn) return false // 当日受付の仮登録は正式登録まで台帳に出さない
    if (state.rosRegion !== 'all' && u.region !== state.rosRegion) return false
    if (state.rosMuni !== 'all' && u.muniName !== state.rosMuni) return false
    if (state.rosWard !== 'all' && u.venueName !== state.rosWard) return false
    if (state.rosStatus === 'measured' && !u.meas[D.CUR]) return false
    if (state.rosStatus === 'unmeasured' && u.meas[D.CUR]) return false
    if (state.rosStatus === 'new' && u.joined !== D.CUR) return false
    if (q && !(u.name.toLowerCase().includes(q) || u.kana.toLowerCase().includes(q) || u.id.includes(q))) return false
    return true
  })
  if (state.rosSort === 'kana') list = list.slice().sort((a, b) => a.kana.localeCompare(b.kana, 'ja'))
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
      <AuditPanel />
      {/* フィルタバー */}
      <Card style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Select value={state.rosMuni} onChange={(e) => set({ rosMuni: e.target.value, rosWard: 'all', rosPage: 0 })}
          options={[opt('all', 'すべての市町村')].concat(muniOptions(state.rosRegion).map(m => opt(m, m)))} />
        <Select value={state.rosWard} onChange={(e) => set({ rosWard: e.target.value, rosPage: 0 })}
          options={[opt('all', 'すべての' + wardLabel())].concat(wardOptions(state.rosMuni).map(w => opt(w, w)))} />
        <Select value={state.rosStatus} onChange={(e) => set({ rosStatus: e.target.value, rosPage: 0 })}
          options={[opt('all', 'すべての状態'), opt('measured', '今年度 測定済'), opt('unmeasured', '今年度 未測定'), opt('new', '今年度の新規')]} />
        <Select value={state.rosSort} onChange={(e) => set({ rosSort: e.target.value, rosPage: 0 })}
          options={[opt('id', 'ID 順'), opt('kana', 'ふりがな順'), opt('age', '年齢が高い順')]} />
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
            <div className="t-overline">市町村・{wardLabel()}</div>
            <div className="t-overline">電話番号</div>
            <div className="t-overline">最新測定</div>
            <div />
          </div>
          {rows.map(u => {
            const ys = Object.keys(u.meas)
            const last = ys.length ? u.meas[ys[ys.length - 1]] : null
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
