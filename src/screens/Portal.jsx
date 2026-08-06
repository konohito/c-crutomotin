import { useEffect, useState } from 'react'
import { loadTecho, saveTechoProfile, addTechoLog, sortLogs } from '../lib/techo.js'
import TechoBook from '../ui/techobook.jsx'
import { Icon } from '../ui/icons.jsx'

const BASE = import.meta.env.BASE_URL

/* 利用者ポータル — 発行された「ログインID + パスワード」でログインした利用者本人の画面。
   自分の電子手帳(目標・体調/活動記録・からだの記録)だけが見える。スマホでの利用を想定した 1 カラム。 */
export default function Portal({ user: u, onSignOut }) {
  const [techo, setTecho] = useState(null)
  useEffect(() => {
    let alive = true
    loadTecho(u).then(t => { if (alive) setTecho({ ...t, logs: sortLogs(t.logs) }) })
      .catch(() => { if (alive) setTecho({ goal: '', interests: [], logs: [], portal: null }) })
    return () => { alive = false }
  }, [u.id])

  const onSaveProfile = async (p) => {
    await saveTechoProfile(u, p)
    setTecho(t => ({ ...t, ...p }))
  }
  const onAddLog = async (entry) => {
    const e = await addTechoLog(u, entry)
    setTecho(t => ({ ...t, logs: sortLogs([e, ...t.logs]) }))
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-canvas)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 20, display: 'block' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Icon name="techo" size={15} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            {u.name} さんの手帳
          </div>
          <div className="t-num" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>介護予防手帳 · ID {u.id}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onSignOut}>ログアウト</button>
      </header>
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '14px 12px 40px' }}>
        <TechoBook u={u} techo={techo} compact canAddLog canDelete={false}
          onSaveProfile={onSaveProfile} onAddLog={onAddLog} onDeleteLog={() => {}} />
        <div style={{ fontSize: 11, color: 'var(--fg-4)', textAlign: 'center', marginTop: 18, lineHeight: 1.7 }}>
          体調がすぐれない日が続くときは、かかりつけ医や地域包括支援センターに相談しましょう。
        </div>
      </main>
    </div>
  )
}
