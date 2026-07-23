import { createContext, useContext, useEffect, useState } from 'react'
import { authEnabled, watchAuth, signOutUser } from '../lib/auth.js'
import Login from '../screens/Login.jsx'

const BASE = import.meta.env.BASE_URL

const AuthCtx = createContext({ user: null, enabled: false, signOut: () => {} })
export const useAuth = () => useContext(AuthCtx)

// 認証確認中のスプラッシュ
function AuthSplash() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-canvas)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--fg-3)' }}>
        <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 26, opacity: 0.9 }} />
        <div style={{ fontSize: 12.5 }}>読み込んでいます…</div>
      </div>
    </div>
  )
}

/* 認証ゲート。
   - Firebase 未設定（公開デモ）: enabled=false → そのまま本体を表示（ログイン不要）
   - Firebase 設定あり: 認証状態を購読し、未ログインならログイン画面を表示 */
export default function AuthGate({ children }) {
  const enabled = authEnabled()
  const [{ user, ready }, setState] = useState({ user: null, ready: !enabled })

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let unsub = () => {}
    watchAuth((s) => { if (alive) setState(s) }).then((u) => { if (alive) unsub = u; else u() })
    return () => { alive = false; unsub() }
  }, [enabled])

  if (!enabled) {
    return <AuthCtx.Provider value={{ user: null, enabled: false, signOut: signOutUser }}>{children}</AuthCtx.Provider>
  }
  if (!ready) return <AuthSplash />
  if (!user) return <Login />
  return <AuthCtx.Provider value={{ user, enabled: true, signOut: signOutUser }}>{children}</AuthCtx.Provider>
}
