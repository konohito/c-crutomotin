// ================================================================
// NewVersionBar — 「新しい版が出ています」の帯（★2026-11-24 全アプリ共通で横展開）
//
// 現場の端末は画面を開きっぱなしにするため、新しい版を配信しても読み直すまで
// 古い画面のまま使い続けてしまう（エラーにならないので気づけない）。
// そこで、ときどき入口の index.html を取りに行き、読み込んでいるファイルの名前
// （Vite のハッシュ付き /assets/index-xxxx.js）が変わっていたら帯を出す。
// ・最初の1回は「いまの版」を覚えるだけ。
// ・画面に戻ってきたとき・10分おきに取り直す。勝手には読み直さない（入力途中かもしれない）。
// ・取りに行くのは入口の HTML だけ。失敗したら黙って見送る。
// ================================================================
import { useEffect, useState } from 'react'

function versionOf(html) {
  const buildId = /"buildId"\s*:\s*"([^"]+)"/.exec(html)
  const refs = html.match(/[A-Za-z0-9._/-]+\.(?:js|css)(?:\?v=\d+)?/g) || []
  return (buildId ? buildId[1] + '|' : '') + refs.sort().join('|')
}

const CHECK_MS = 10 * 60 * 1000

export default function NewVersionBar() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let alive = true
    let mine = null

    const fetchVersion = async () => {
      try {
        const res = await fetch(`${window.location.origin}/index.html`, { cache: 'no-store' })
        if (!res.ok) return null
        return versionOf(await res.text())
      } catch { return null }
    }
    const check = async () => {
      if (!alive || stale) return
      const v = await fetchVersion()
      if (!alive || !v) return
      if (mine == null) { mine = v; return }
      if (v !== mine) setStale(true)
    }

    check()
    const timer = window.setInterval(check, CHECK_MS)
    const onShow = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [stale])

  if (!stale) return null

  return (
    <div role="status" className="noprint" style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '12px 16px', background: 'var(--brand-600, #2F6F4F)', color: '#fff',
      boxShadow: '0 -2px 12px rgba(0,0,0,0.18)', fontSize: 14, lineHeight: 1.6,
    }}>
      <span style={{ flex: 1, minWidth: 200, fontWeight: 700 }}>
        新しい版が出ています。読み込み直すと最新の画面になります。
      </span>
      <button onClick={() => { try { window.location.reload() } catch { /* noop */ } }} style={{
        height: 40, padding: '0 20px', borderRadius: 10, border: 'none',
        background: '#fff', color: 'var(--brand-600, #2F6F4F)',
        fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer',
      }}>読み込み直す</button>
      <button onClick={() => setStale(false)} style={{
        height: 40, padding: '0 14px', borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.6)', background: 'transparent', color: '#fff',
        fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
      }}>あとで</button>
    </div>
  )
}
