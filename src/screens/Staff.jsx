import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../ui/AuthGate.jsx'
import { listStaff, addStaff, revokeStaff, updateStaffName } from '../lib/staffAdmin.js'
import { Card } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

export default function Staff() {
  const { showToast } = useStore()
  const { user, refreshProfile } = useAuth()
  const [staff, setStaff] = useState(null)
  const [form, setForm] = useState({ email: '', password: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState({ uid: null, name: '' })

  const reload = () => listStaff().then(setStaff).catch(() => setStaff([]))
  useEffect(() => { reload() }, [])

  const saveName = async () => {
    const { uid, name } = edit
    try {
      await updateStaffName(uid, name.trim())
      if (user && user.uid === uid) refreshProfile()
      showToast('氏名を保存しました')
      setEdit({ uid: null, name: '' })
      await reload()
    } catch { showToast('保存に失敗しました') }
  }

  const add = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password || busy) return
    setBusy(true); setErr('')
    try {
      await addStaff(form)
      showToast('職員を追加しました')
      setForm({ email: '', password: '', name: '' })
      await reload()
    } catch (ex) { setErr(ex.message || '追加に失敗しました') }
    setBusy(false)
  }

  const revoke = async (s) => {
    if (!window.confirm(`${s.email} の閲覧権限を解除しますか？\n（アカウントは残りますが、ログインしてもデータは見られなくなります）`)) return
    try {
      await revokeStaff(s.uid)
      showToast('権限を解除しました')
      await reload()
    } catch { showToast('解除に失敗しました') }
  }

  return (
    <div className="screen" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
      {/* 追加フォーム */}
      <Card pad>
        <div className="t-h4">職員を追加</div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, lineHeight: 1.6 }}>
          メールとパスワードで職員アカウントを作成し、同時に閲覧を承認します。全職員が同じ権限です。
        </div>
        <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>メールアドレス</span>
            <input className="field" type="email" value={form.email} onChange={(e) => setForm(s => ({ ...s, email: e.target.value }))} placeholder="staff@example.jp" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>初期パスワード</span>
            <input className="field" type="text" value={form.password} onChange={(e) => setForm(s => ({ ...s, password: e.target.value }))} placeholder="6文字以上" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>氏名（任意）</span>
            <input className="field" value={form.name} onChange={(e) => setForm(s => ({ ...s, name: e.target.value }))} placeholder="山田 太郎" />
          </label>
          {err && <div style={{ fontSize: 12.5, color: 'var(--danger-700)', background: 'var(--danger-50)', border: '1px solid var(--danger-500)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy || !form.email || !form.password}>{busy ? '追加中…' : '職員を追加'}</button>
        </form>
      </Card>

      {/* 一覧 */}
      <Card pad>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div className="t-h4">承認済みの職員</div>
          <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{staff ? staff.length : '—'} 名</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
          {staff === null && <div style={{ fontSize: 12.5, color: 'var(--fg-3)', padding: '10px 0' }}>読み込み中…</div>}
          {staff && staff.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--fg-3)', padding: '10px 0' }}>まだ承認済みの職員がいません。</div>}
          {staff && staff.map(s => {
            const isMe = user && user.uid === s.uid
            const editing = edit.uid === s.uid
            return (
              <div key={s.uid} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  {editing ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input className="field" style={{ height: 32, fontSize: 13 }} value={edit.name} autoFocus placeholder="氏名（例: 山田 太郎）"
                        onChange={(e) => setEdit(v => ({ ...v, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEdit({ uid: null, name: '' }) }} />
                      <button className="btn btn-primary btn-sm" onClick={saveName}>保存</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ uid: null, name: '' })}>取消</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || '（氏名未設定）'}</span>
                      {isMe && <span style={{ fontSize: 10.5, color: 'var(--brand-700)', background: 'var(--brand-50)', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>自分</span>}
                      <button className="btn btn-ghost btn-sm" title="氏名を編集" onClick={() => setEdit({ uid: s.uid, name: s.name || '' })} style={{ flexShrink: 0, fontSize: 11.5, padding: '2px 8px' }}>編集</button>
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => revoke(s)} disabled={isMe} title={isMe ? '自分自身は解除できません' : '権限を解除'}>
                  <Icon name="logout" size={14} /> 解除
                </button>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 12, lineHeight: 1.6 }}>
          「解除」するとログインはできてもデータが見られなくなります（アカウント自体は Firebase に残ります）。パスワードのリセットは Firebase コンソール → Authentication から行えます。
        </div>
      </Card>
    </div>
  )
}
