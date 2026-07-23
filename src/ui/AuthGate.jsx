import { createContext, useContext, useEffect, useState } from 'react'
import { authEnabled, watchAuth, signOutUser } from '../lib/auth.js'
import { loadRealData } from '../lib/realdata.js'
import Login from '../screens/Login.jsx'

const BASE = import.meta.env.BASE_URL

const AuthCtx = createContext({ user: null, enabled: false, signOut: () => {} })
export const useAuth = () => useContext(AuthCtx)

// 認証確認中／実データ読込中のスプラッシュ
function AuthSplash({ label = '読み込んでいます…' }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-canvas)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--fg-3)' }}>
        <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 26, opacity: 0.9 }} />
        <div style={{ fontSize: 12.5 }}>{label}</div>
      </div>
    </div>
  )
}

// 権限がない（未承認の職員）ときの画面
function NoAccess() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-canvas)' }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 26, marginBottom: 18 }} />
        <div className="card" style={{ padding: '24px 26px' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>閲覧権限がありません</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.7 }}>
            このアカウントは職員として承認されていません。<br />管理者にアカウントの承認を依頼してください。
          </div>
          <button className="btn btn-outline" style={{ marginTop: 18 }} onClick={() => signOutUser()}>ログアウト</button>
        </div>
      </div>
    </div>
  )
}

// 認証後に実データ（Firestore）を読み込んでから本体を表示する。
// 実データが無ければ従来のシードのまま表示する。権限が無ければ NoAccess を表示する。
function RealDataBoot({ children }) {
  const [res, setRes] = useState(null)
  useEffect(() => {
    let alive = true
    loadRealData().catch(() => ({ loaded: false })).then((r) => { if (alive) setRes(r || { loaded: false }) })
    return () => { alive = false }
  }, [])
  if (!res) return <AuthSplash label="データを読み込んでいます…" />
  if (res.denied) return <NoAccess />
  return children
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
  return (
    <AuthCtx.Provider value={{ user, enabled: true, signOut: signOutUser }}>
      <RealDataBoot>{children}</RealDataBoot>
    </AuthCtx.Provider>
  )
}
