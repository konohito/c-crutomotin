import { useState } from 'react'
import { useStore } from '../store.jsx'
import { changePassword } from '../lib/auth.js'
import { Modal, ModalHead } from '../ui/kit.jsx'

// 本人のパスワード変更（サイドバーの鍵アイコンから）。
// 初期パスワードでログインした職員が、自分の好きなパスワードに変えられる。
export default function PasswordModal() {
  const { set, showToast } = useStore()
  const [f, setF] = useState({ cur: '', next: '', next2: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const close = () => set({ pwOpen: false })
  const upd = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const save = async () => {
    if (f.next.length < 6) { setErr('新しいパスワードは6文字以上にしてください。'); return }
    if (f.next !== f.next2) { setErr('新しいパスワード（確認）が一致しません。'); return }
    setBusy(true); setErr('')
    try {
      await changePassword(f.cur, f.next)
      showToast('パスワードを変更しました')
      close()
    } catch (e) { setErr(e.message || '変更に失敗しました。'); setBusy(false) }
  }
  return (
    <Modal onClose={close} width={400}>
      <ModalHead icon="staff" iconBg="var(--brand-50)" iconFg="var(--brand-600)" title="パスワード変更" sub="次回から新しいパスワードでログインします" onClose={close} />
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>現在のパスワード</span>
          <input className="field" type="password" autoComplete="current-password" value={f.cur} onChange={upd('cur')} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>新しいパスワード（6文字以上）</span>
          <input className="field" type="password" autoComplete="new-password" value={f.next} onChange={upd('next')} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>新しいパスワード（確認）</span>
          <input className="field" type="password" autoComplete="new-password" value={f.next2} onChange={upd('next2')}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        </label>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger-700)', background: 'var(--danger-50)', borderRadius: 8, padding: '8px 12px' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="btn btn-outline" onClick={close} disabled={busy}>キャンセル</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !f.cur || !f.next}>{busy ? '変更中…' : '変更する'}</button>
        </div>
      </div>
    </Modal>
  )
}
