import { useEffect, useState } from 'react'
import { loadTecho, saveTechoProfile, addTechoLog, sortLogs } from '../lib/techo.js'
import TechoBook from '../ui/techobook.jsx'
import { Icon } from '../ui/icons.jsx'
import { horizontalOrange } from '../ui/logos'

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

  /* ★高齢の利用者本人が読む画面なので、職員の画面より一段大きい文字で出す（large）。
     入力欄は 16px 以上（iOS のフォーカス時拡大を防ぐ）・押すものは 44px 以上。 */
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-canvas)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={horizontalOrange} alt="Cruto" style={{ height: 20, display: 'block' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Icon name="techo" size={16} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {u.name} さんの手帳
          </div>
          <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>介護予防手帳 · ID {u.id}</div>
        </div>
        <button className="btn btn-ghost" style={{ height: 44 }} onClick={onSignOut}>ログアウト</button>
      </header>
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '16px 12px 44px' }}>
        <TechoBook u={u} techo={techo} compact large canAddLog canDelete={false}
          onSaveProfile={onSaveProfile} onAddLog={onAddLog} onDeleteLog={() => {}} />
        <div style={{ fontSize: 13.5, color: 'var(--fg-3)', textAlign: 'center', marginTop: 20, lineHeight: 1.8 }}>
          体調がすぐれない日が続くときは、かかりつけ医や地域包括支援センターに相談しましょう。
        </div>
      </main>
    </div>
  )
}
