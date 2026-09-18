import { useMemo, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { wardLabel } from '../lib/db.js'
import { auditUsers, auditUnassigned, auditSummary, KIND_LABEL } from '../lib/audit.js'
import { unassignedMeasurements, realDataEnabled } from '../lib/realdata.js'
import { planUserDeletion, deleteUsersBulk } from '../lib/deletion.js'
import { eraOf } from '../lib/helpers.js'
import { useAuth } from '../ui/AuthGate.jsx'
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
  const findings = useMemo(
    () => (open ? auditUnassigned(unassignedMeasurements()).concat(auditUsers(D.users)) : []),
    [open],
  )
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
                  {f.userId
                    ? (
                      <span role="button" tabIndex={0} onClick={() => set({ screen: 'det', detId: f.userId })}
                        style={{ color: 'var(--brand-600)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        {f.name}（ID {f.userId}）
                      </span>
                    )
                    // 所属者未確定の測定は開く先の個人ページが無い
                    : <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{f.name}</span>}
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
      {realDataEnabled() && <BulkDeletePanel />}
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

/* まとめて削除。特定できない方を何人か選んで、一度に台帳から消すための画面。

   利用者台帳の一覧そのものには手を入れていない（並びも列も従来どおり）。
   チェックボックスをこのパネルの中だけに置いてあるのは、
   台帳の表に選択列を足すと、日常の閲覧のたびに削除が目に入るため。
   既定は閉じた状態で、開かないと何も選べない。

   1 人失敗しても残りは続ける（全員やり直しにしない）。 */
export function BulkDeletePanel() {
  const { set, showToast } = useStore()
  const { user, profile } = useAuth()
  const byName = (profile && profile.name) || (user && (user.email || user.uid)) || '職員'
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([])
  const [plans, setPlans] = useState(null)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const qt = q.trim().toLowerCase()
  const list = useMemo(() => {
    const base = D.users.filter(u => u && u.name && !u.archived && !u.walkIn)
    if (!qt) return base.slice(0, 30)
    return base.filter(u => u.name.toLowerCase().includes(qt) || (u.kana || '').toLowerCase().includes(qt) || String(u.id).includes(qt)).slice(0, 30)
  }, [qt, open, result])

  const toggle = (id) => { setPlans(null); setTyped(''); setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.concat([id]))) }
  const preview = async () => {
    setPlans(null)
    try { setPlans(await Promise.all(picked.map(id => planUserDeletion(id)))) }
    catch (e) { showToast('確認に失敗しました: ' + (e.message || '')) }
  }
  const run = async () => {
    setBusy(true); setResult(null)
    try {
      const r = await deleteUsersBulk(picked, { by: (user && user.uid) || null, byName, reason: reason.trim() || null })
      setResult(r)
      setPicked([]); setPlans(null); setTyped('')
      showToast(r.failed.length ? `${r.done.length} 名を削除（${r.failed.length} 名は失敗）` : `${r.done.length} 名を削除しました`)
      set(s => ({ rev: s.rev + 1 }))
    } catch (e) { showToast('削除に失敗しました: ' + (e.message || '')) }
    setBusy(false)
  }

  const totalMeas = plans ? plans.reduce((a, p) => a + p.measurements.length, 0) : 0
  const pastYears = plans ? [...new Set(plans.flatMap(p => p.pastYears))].sort() : []
  const confirmWord = `${picked.length}名削除`
  const canRun = plans && picked.length > 0 && typed.replace(/[\s　]/g, '') === confirmWord

  return (
    <Card style={{ padding: '10px 16px', borderColor: open ? 'var(--danger-200, #f3c2c2)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <Icon name="chevR" size={16} style={{ color: 'var(--slate-400)', transform: open ? 'rotate(90deg)' : 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>まとめて削除</span>
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          特定できない方を選んで台帳から消します（消す前に控えが自動で保存されます）
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border-default)', paddingTop: 10 }}>
          <input className="field" style={{ height: 34, fontSize: 12.5 }} value={q}
            onChange={(e) => setQ(e.target.value)} placeholder="氏名・ふりがな・ID で絞り込む" />
          <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8, border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
            {list.map(u => (
              <label key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
                <span className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)', width: 56 }}>{u.id}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{u.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{u.muniName} {u.venueName}</span>
                <span className="t-num" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>測定 {(u.series || []).length} 件</span>
              </label>
            ))}
            {!list.length && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--fg-3)' }}>該当する方がいません</div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5 }}><b>{picked.length}</b> 名を選択中</span>
            <button className="btn btn-outline btn-sm" onClick={preview} disabled={!picked.length || busy}>何が消えるか確認する</button>
            {picked.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { setPicked([]); setPlans(null); setTyped('') }} disabled={busy}>選択を解除</button>}
          </div>

          {plans && (
            <div style={{ marginTop: 10, borderRadius: 8, padding: '10px 12px', lineHeight: 1.7,
              border: '1px solid var(--danger-200, #f3c2c2)', background: 'var(--danger-50, #fdf2f2)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>次の {plans.length} 名と、測定 {totalMeas} 件を削除します</div>
              <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
                {plans.map(p => (
                  <div key={p.userId} style={{ fontSize: 12 }}>
                    ・{p.name}（ID {p.userId}）… 測定 {p.measurements.length} 件
                    {p.years.length ? `（${p.years.map(y => eraOf(y) + '年度').join('・')}）` : ''}
                    {p.walkinCount ? ` / 当日受付の用紙 ${p.walkinCount} 枚は取り込み待ちに戻ります` : ''}
                  </div>
                ))}
              </div>
              {pastYears.length > 0 && (
                <div style={{ marginTop: 8, borderRadius: 6, padding: '8px 10px', fontSize: 12,
                  border: '1px solid var(--warning-200, #f0dcae)', background: 'var(--warning-50)' }}>
                  {pastYears.map(y => eraOf(y) + '年度').join('・')}の集計に入っています。
                  提出が済んでいる場合は、提出先への訂正のご連絡が必要です。
                </div>
              )}
              <input className="field" style={{ marginTop: 8, height: 32, fontSize: 12.5 }} value={reason}
                onChange={(e) => setReason(e.target.value)} placeholder="消す理由（任意・記録に残ります）" />
              <div style={{ fontSize: 12, marginTop: 8 }}>間違いなければ「<b>{confirmWord}</b>」と入力してください。</div>
              <input className="field" style={{ marginTop: 6, height: 34, fontSize: 13 }} value={typed}
                onChange={(e) => setTyped(e.target.value)} placeholder={confirmWord} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-outline" onClick={() => { setPlans(null); setTyped('') }} disabled={busy}>やめる</button>
                <button className="btn" style={{ background: 'var(--danger-600, #c0392b)', color: '#fff', opacity: canRun ? 1 : 0.5 }}
                  onClick={run} disabled={busy || !canRun}>{busy ? '削除中…' : `${picked.length} 名を削除する`}</button>
              </div>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 10, borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.7,
              border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}>
              <div><b>削除できた {result.done.length} 名</b>{result.done.length ? '：' + result.done.map(x => x.name).join('・') : ''}</div>
              {result.failed.length > 0 && (
                <div style={{ color: 'var(--danger-700)', marginTop: 4 }}>
                  <b>できなかった {result.failed.length} 名</b>（この方々は消えていません。もう一度お試しください）
                  {result.failed.map(x => <div key={x.userId}>・{x.name}（ID {x.userId}）… {x.error}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
