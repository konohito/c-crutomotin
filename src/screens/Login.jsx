import { useState } from 'react'
import { signIn, authErrorMessage } from '../lib/auth.js'

const BASE = import.meta.env.BASE_URL

/* 職員ログイン画面。Firebase Auth（メール＋パスワード）。
   VITE_FIREBASE_CONFIG がある本番構成でのみ表示される（公開デモでは出ない）。 */
export default function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!email || !pw || busy) return
    setBusy(true); setErr('')
    try {
      await signIn(email, pw)
      // 成功すると onAuthStateChanged が発火し、AuthGate が本体を描画する
    } catch (ex) {
      setErr(authErrorMessage(ex))
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-canvas)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 22 }}>
          <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 30, display: 'block' }} />
          <span className="t-display" style={{ fontSize: 15, letterSpacing: '0.05em', color: 'var(--slate-800)', background: 'var(--slate-100)', borderRadius: 5, padding: '1px 8px 2px' }}>motion</span>
        </div>
        <div className="card" style={{ padding: '26px 26px 28px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }}>職員ログイン</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', textAlign: 'center', marginTop: 5, lineHeight: 1.6 }}>
            介護予防・体力測定管理システム<br />登録された職員アカウントでログインしてください
          </div>
          <form onSubmit={submit} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>メールアドレス</span>
              <input className="field" type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.jp" autoFocus />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>パスワード</span>
              <input className="field" type="password" autoComplete="current-password" value={pw}
                onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
            </label>
            {err && (
              <div style={{ fontSize: 12.5, color: 'var(--danger-700)', background: 'var(--danger-50)', border: '1px solid var(--danger-500)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
                {err}
              </div>
            )}
            <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !email || !pw} style={{ marginTop: 4, width: '100%' }}>
              {busy ? 'ログイン中…' : 'ログイン'}
            </button>
          </form>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-4)', textAlign: 'center', marginTop: 14, lineHeight: 1.6 }}>
          アカウントの発行は事務局にお問い合わせください
        </div>
      </div>
    </div>
  )
}
