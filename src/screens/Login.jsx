/* 職員ログイン（Firebase Auth）。
   VITE_FIREBASE_CONFIG 設定時のみ有効で、未ログインならアプリ全体の手前でこの画面を出す。
   未設定（GitHub Pages のデモ）ではゲートは素通しになり、従来どおり動く。 */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { dbEnabled, watchAuth, signIn, signOutStaff } from '../lib/db.js'
import { Icon } from '../ui/icons.jsx'

const BASE = import.meta.env.BASE_URL

const AuthCtx = createContext(null)
// ログイン中の職員（Firebase User）。デモ環境（Firebase 未設定）では null。
export const useAuthUser = () => useContext(AuthCtx)
export { signOutStaff }

// Firebase Auth のエラーコード → 利用者向けの日本語メッセージ
const ERROR_JA = {
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません',
  'auth/user-not-found': 'このメールアドレスの職員アカウントが見つかりません',
  'auth/wrong-password': 'パスワードが正しくありません',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/user-disabled': 'このアカウントは停止されています。管理者にお問い合わせください',
  'auth/too-many-requests': '試行回数の上限に達しました。しばらく待ってからお試しください',
  'auth/network-request-failed': 'ネットワークに接続できません。通信環境をご確認ください',
  'auth/missing-password': 'パスワードを入力してください',
}
const loginErrorJa = (err) => ERROR_JA[err && err.code] || 'ログインに失敗しました。もう一度お試しください'

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 36, display: 'block' }} />
      <div className="t-display" style={{ fontSize: 15, letterSpacing: '0.05em', color: 'var(--slate-800)', background: 'var(--slate-100)', borderRadius: 5, padding: '1px 7px 2px 6px' }}>motion</div>
    </div>
  )
}

// 認証状態の確認中に一瞬だけ出すスプラッシュ（ちらつき防止）
function Splash() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg-canvas)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, animation: 'fadeIn 400ms var(--ease-standard)' }}>
        <Brand />
        <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid var(--brand-200)', borderTopColor: 'var(--brand-500)', animation: 'spin 700ms linear infinite' }} aria-label="読み込み中" />
      </div>
    </div>
  )
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const emailRef = useRef(null)

  useEffect(() => { emailRef.current && emailRef.current.focus() }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!email.trim()) { setError('メールアドレスを入力してください'); emailRef.current && emailRef.current.focus(); return }
    if (!pw) { setError('パスワードを入力してください'); return }
    setBusy(true); setError('')
    try { await signIn(email.trim(), pw) } // 成功すると watchAuth 経由でアプリ本体へ切り替わる
    catch (err) { setError(loginErrorJa(err)); setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg-canvas)', padding: 20, position: 'relative' }}>
      <div className="retro-corner tl" /><div className="retro-corner tr" />
      <div className="retro-corner bl" /><div className="retro-corner br" />
      <div style={{ width: '100%', maxWidth: 400, animation: 'popIn 320ms var(--ease-spring)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', marginBottom: 22 }}>
          <Brand />
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>介護予防・体力測定 業務システム</div>
        </div>
        <form onSubmit={submit} className="card" style={{ padding: '26px 26px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="lock" size={17} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>職員ログイン</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>交付された職員アカウントでログインしてください</div>
            </div>
          </div>

          {error && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--danger-700)', background: 'var(--danger-50)', borderRadius: 8, padding: '9px 12px' }}>
              <Icon name="warn" size={15} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="form-label">メールアドレス</span>
            <input
              ref={emailRef} className="field" type="email" autoComplete="username" inputMode="email"
              placeholder="staff@example.jp" value={email} disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="form-label">パスワード</span>
            <div style={{ position: 'relative' }}>
              <input
                className="field" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                placeholder="••••••••" value={pw} disabled={busy} style={{ paddingRight: 42 }}
                onChange={(e) => setPw(e.target.value)}
              />
              <button
                type="button" className="icon-btn" tabIndex={-1}
                aria-label={showPw ? 'パスワードを隠す' : 'パスワードを表示'}
                title={showPw ? 'パスワードを隠す' : 'パスワードを表示'}
                onClick={() => setShowPw(v => !v)}
                style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32 }}
              >
                <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
          </label>

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy} style={{ marginTop: 4, justifyContent: 'center' }}>
            {busy ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 15, height: 15, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', animation: 'spin 700ms linear infinite' }} />
                ログイン中…
              </span>
            ) : 'ログイン'}
          </button>

          <div style={{ fontSize: 11.5, color: 'var(--fg-4)', textAlign: 'center', lineHeight: 1.7 }}>
            パスワードを忘れた場合は管理者に再設定を依頼してください。<br />
            このシステムは登録された職員のみ利用できます。
          </div>
        </form>
      </div>
    </div>
  )
}

/* アプリ全体を包む認証ゲート。
   - Firebase 未設定（デモ）: 素通し
   - 確認中: スプラッシュ / 未ログイン: ログイン画面 / ログイン済み: 本体（user をコンテキスト提供） */
export default function AuthGate({ children }) {
  const [user, setUser] = useState(() => (dbEnabled() ? undefined : null))
  useEffect(() => {
    if (!dbEnabled()) return
    let dead = false, unsub = () => {}
    watchAuth(u => setUser(u)).then(fn => { if (dead) fn(); else unsub = fn })
    return () => { dead = true; unsub() }
  }, [])
  if (!dbEnabled()) return children
  if (user === undefined) return <Splash />
  if (!user) return <LoginScreen />
  return <AuthCtx.Provider value={user}>{children}</AuthCtx.Provider>
}
