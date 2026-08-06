import { useEffect, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { dbEnabled, wardLabel } from '../lib/db.js'
import { loadTecho, saveTechoProfile, addTechoLog, deleteTechoLog, issuePortalAccount, sortLogs } from '../lib/techo.js'
import TechoBook from '../ui/techobook.jsx'
import { Card, Select, Overline } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

/* 手帳一覧 — 利用者ごとの電子手帳。
   一覧から利用者を選ぶと、その方の電子手帳の中身(目標・体調/活動記録・からだの記録)を
   すべて閲覧・記入できる。利用者本人用のログインID・パスワードもここから発行する。 */

// 利用者本人がログインした時と同じ画面のプレビュー(スマホ枠)
function PortalPreview({ u, techo, onAddLog, onSaveProfile, onClose }) {
  return (
    <div className="noprint" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 90, display: 'grid', placeItems: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 94vw)', height: 'min(760px, 92vh)', background: 'var(--bg-canvas)', borderRadius: 26, boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '6px solid #1e293b', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="techo" size={18} strokeWidth={1.8} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{u.name} さんの手帳</div>
            <div className="t-num" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>ログインID {'u' + u.id} · 利用者画面のプレビュー</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>閉じる</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <TechoBook u={u} techo={techo} compact canAddLog canDelete={false} onAddLog={onAddLog} onSaveProfile={onSaveProfile} onDeleteLog={() => {}} />
        </div>
      </div>
    </div>
  )
}

function AccountCard({ u, onIssued }) {
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState(null) // { loginId, password } 発行直後のみ
  const [err, setErr] = useState('')
  const doIssue = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const r = await issuePortalAccount(u)
      setIssued(r)
      onIssued()
    } catch (e) { setErr((e && e.message) || '発行に失敗しました') } finally { setBusy(false) }
  }
  return (
    <Card style={{ padding: '16px 18px' }}>
      <Overline style={{ marginBottom: 8 }}>利用者ログイン（ID・パスワード）</Overline>
      {u.portal ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip" style={{ height: 22, fontSize: 11.5, background: 'var(--success-50)', color: 'var(--success-700)', fontWeight: 700 }}>発行済み</span>
            <span className="t-num" style={{ fontSize: 14, fontWeight: 700 }}>{u.portal.loginId}</span>
          </div>
          {issued && (
            <div style={{ marginTop: 10, border: '1px solid var(--success-500)', background: 'var(--success-50)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--success-700)' }}>初期パスワード（この画面でのみ表示されます）</div>
              <div className="t-num" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.08em', marginTop: 2 }}>{issued.password}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 4, lineHeight: 1.6 }}>メモして本人にお渡しください。閉じると再表示できません。</div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.7, marginTop: 10 }}>
            発行日: <span className="t-num">{u.portal.issuedAt || '—'}</span><br />
            利用者はログイン画面で「ログインID + パスワード」を入力すると、自分の手帳だけが表示されます。
            {dbEnabled()
              ? 'パスワードを忘れた場合は管理者(Firebase コンソール)で再設定してください。'
              : '(デモ環境のため、実際のログインアカウントは作成されていません)'}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.7 }}>
            この利用者に電子手帳のログインを発行します。ログインIDは <span className="t-num" style={{ fontWeight: 700 }}>{'u' + u.id}</span>、
            パスワードは自動生成され、発行時に 1 回だけ表示されます。
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--danger-700)', background: 'var(--danger-50)', borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>{err}</div>}
          <button className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={doIssue} disabled={busy}>
            {busy ? '発行中…' : 'アカウントを発行する'}
          </button>
        </>
      )}
    </Card>
  )
}

function BookScreen({ u }) {
  const { state, set, showToast } = useStore()
  const [techo, setTecho] = useState(null)
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    setTecho(null)
    let alive = true
    loadTecho(u).then(t => { if (alive) setTecho({ ...t, logs: sortLogs(t.logs) }) }).catch(() => { if (alive) setTecho({ goal: '', interests: [], logs: [], portal: null }) })
    return () => { alive = false }
  }, [u.id])

  const onSaveProfile = async (p) => {
    await saveTechoProfile(u, p)
    setTecho(t => ({ ...t, ...p }))
    showToast && showToast('手帳を保存しました')
  }
  const onAddLog = async (entry) => {
    const e = await addTechoLog(u, entry)
    setTecho(t => ({ ...t, logs: sortLogs([e, ...t.logs]) }))
  }
  const onDeleteLog = async (logId) => {
    if (!window.confirm('この記録を削除しますか？')) return
    await deleteTechoLog(u, logId)
    setTecho(t => ({ ...t, logs: t.logs.filter(l => l.id !== logId) }))
  }

  return (
    <div className="screen">
      <div>
        <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }} onClick={() => set({ tlId: null })}>
          <Icon name="back" size={16} />
          手帳一覧へ戻る
        </button>
      </div>

      <Card style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, var(--brand-50), var(--brand-100))', color: 'var(--brand-700)', display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 700, flexShrink: 0, boxShadow: 'inset 0 0 0 1px var(--brand-200)' }}>{u.name.charAt(0)}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{u.name} さんの電子手帳</span>
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{u.kana}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <span className="chip t-num" style={{ height: 21, fontSize: 11 }}>ID {u.id}</span>
            <span className="chip" style={{ height: 21, fontSize: 11 }}><span className="t-num">{u.age}</span> 歳</span>
            <span className="chip" style={{ height: 21, fontSize: 11 }}>{u.muniName}{u.venueName ? ' · ' + u.venueName : ''}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => set({ screen: 'det', detId: u.id })}>個人詳細</button>
          <button className="btn btn-outline" onClick={() => setPreview(true)} title="利用者本人がログインした時の画面を確認">
            利用者画面プレビュー
          </button>
          <button className="btn btn-primary" onClick={() => set({ screen: 'techo', thUser: u.id, thKind: 'record' })}>
            <Icon name="printer" size={16} strokeWidth={1.8} />
            印刷用の手帳
          </button>
        </div>
      </Card>

      <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        <TechoBook u={u} techo={techo} canAddLog canDelete onSaveProfile={onSaveProfile} onAddLog={onAddLog} onDeleteLog={onDeleteLog} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AccountCard u={u} onIssued={() => set({ rev: (state.rev || 0) + 1 })} />
          <Card style={{ padding: '16px 18px' }}>
            <Overline style={{ marginBottom: 8 }}>この手帳について</Overline>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.75 }}>
              電子手帳には <b>目標・興味関心</b>、毎日の<b>体調チェック・活動記録</b>、
              台帳の<b>測定結果・基本チェックリスト</b>がまとまっています。<br />
              利用者本人はログインすると自分の手帳だけを見て記録できます。
              職員はこの画面で代理入力・修正ができます。<br />
              紙で使う場合は「印刷用の手帳」から冊子を印刷してください。
            </div>
          </Card>
        </div>
      </div>

      {preview && techo && (
        <PortalPreview u={u} techo={techo} onAddLog={onAddLog} onSaveProfile={onSaveProfile} onClose={() => setPreview(false)} />
      )}
    </div>
  )
}

export default function TechoList() {
  const { state, set } = useStore()
  const sel = state.tlId ? D.users.find(x => x.id === state.tlId) : null
  if (sel) return <BookScreen key={sel.id} u={sel} />

  const q = (state.tlQ || '').trim()
  const ward = state.tlWard || 'all'
  const acct = state.tlAcct || 'all'
  const wards = [...new Set(D.users.filter(u => !u.walkIn).map(u => u.venueName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
  let list = D.users.filter(u => !u.walkIn)
  if (ward !== 'all') list = list.filter(u => u.venueName === ward)
  if (acct === 'issued') list = list.filter(u => u.portal)
  if (acct === 'none') list = list.filter(u => !u.portal)
  if (q) {
    const nq = q.toLowerCase()
    list = list.filter(u => u.name.includes(q) || (u.kana || '').includes(q) || String(u.id).includes(nq))
  }
  list = list.slice().sort((a, b) => (a.kana || '').localeCompare(b.kana || '', 'ja'))
  const total = list.length
  const shown = list.slice(0, 100)
  const issuedCount = D.users.filter(u => !u.walkIn && u.portal).length

  return (
    <div className="screen">
      <Card style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input className="field" style={{ height: 36, width: 240 }} placeholder="氏名・かな・ID で検索"
          value={state.tlQ || ''} onChange={(e) => set({ tlQ: e.target.value })} />
        {wards.length > 0 && (
          <Select value={ward} onChange={(e) => set({ tlWard: e.target.value })}
            options={[{ v: 'all', l: 'すべての' + wardLabel() }].concat(wards.map(w => ({ v: w, l: w })))} />
        )}
        <Select value={acct} onChange={(e) => set({ tlAcct: e.target.value })}
          options={[{ v: 'all', l: 'アカウント: すべて' }, { v: 'issued', l: '発行済みのみ' }, { v: 'none', l: '未発行のみ' }]} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          対象 <span className="t-num" style={{ fontWeight: 700, color: 'var(--fg-1)' }}>{total}</span> 名 ·
          アカウント発行済み <span className="t-num" style={{ fontWeight: 700, color: 'var(--fg-1)' }}>{issuedCount}</span> 名
        </span>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 1fr 110px 150px', gap: 0, padding: '9px 18px', fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, borderBottom: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}>
          <span>氏名</span><span>ID</span><span>{wardLabel()}</span><span>直近の測定</span><span>手帳アカウント</span>
        </div>
        {shown.map(u => {
          const ys = Object.keys(u.meas || {}).map(Number)
          const lastY = ys.length ? Math.max(...ys) : null
          return (
            <div key={u.id} className="tbl-row clickable" onClick={() => set({ tlId: u.id })}
              style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 1fr 110px 150px', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{u.name}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.kana}</span>
              </span>
              <span className="t-num" style={{ fontSize: 12.5 }}>{u.id}</span>
              <span style={{ fontSize: 12.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.venueName || '—'}</span>
              <span className="t-num" style={{ fontSize: 12.5 }}>{lastY ? (D.ERA[lastY] || lastY) + '年度' : '—'}</span>
              <span>
                {u.portal
                  ? <span className="chip t-num" style={{ height: 22, fontSize: 11, background: 'var(--success-50)', color: 'var(--success-700)', fontWeight: 700 }}>{u.portal.loginId}</span>
                  : <span className="chip" style={{ height: 22, fontSize: 11, color: 'var(--fg-3)' }}>未発行</span>}
              </span>
            </div>
          )
        })}
        {total > shown.length && (
          <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--fg-3)' }}>
            先頭 {shown.length} 名を表示しています。検索や{wardLabel()}で絞り込んでください。
          </div>
        )}
        {total === 0 && <div style={{ padding: '18px', fontSize: 12.5, color: 'var(--fg-3)' }}>該当する利用者がいません。</div>}
      </Card>
    </div>
  )
}
