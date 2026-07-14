import D from '../data/engine.js'
import { useStore, allEvents, allMunis } from '../store.jsx'
import { mdw } from '../lib/helpers.js'
import { RadioCard, Select, Overline } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const BASE = import.meta.env.BASE_URL
const SHEET_BOXES = { walk5: [1, 1], balR: [2, 1], balL: [2, 1], gripR: [2, 1], gripL: [2, 1], tug: [2, 1], height: [3, 1], weight: [3, 1] }

function sheetRowsFor(u) {
  const last = u ? Object.keys(u.meas).map(Number).sort((a, b) => b - a)[0] : null
  return D.SHEET_COLS.map(cid => {
    const col = D.COLS.find(c => c.id === cid)
    const def = SHEET_BOXES[cid]
    const boxes = []
    for (let i = 0; i < def[0]; i++) boxes.push({ d: true })
    boxes.push({ dot: true })
    for (let i = 0; i < def[1]; i++) boxes.push({ d: true })
    const pv = last && u.meas[last].values[cid] !== null && u.meas[last].values[cid] !== undefined ? D.fmt(u.meas[last].values[cid], col.dec) : null
    return { id: cid, label: col.label, unit: col.unit, boxes, prev: pv ? '前回 ' + pv : '初回' }
  })
}

const digitsOf = (id) => String(id || '').padStart(5, ' ').slice(-5).split('')
const stripOf = (id) => String(id || '').split('').reduce((acc, ch) => {
  const n = +ch || 0
  ;[8, 4, 2, 1].forEach(b => acc.push((n & b) ? 'var(--slate-900)' : 'transparent'))
  return acc
}, [])

const CELL_LABEL = { padding: '4px 10px', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-300)', fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--slate-600)' }

function SheetPage({ p }) {
  return (
    <div className="pdf-page" style={{ padding: '48px 52px' }}>
      {/* 四隅の位置合わせマーカー */}
      <div style={{ position: 'absolute', left: 22, top: 22, width: 17, height: 17, background: 'var(--slate-900)' }} />
      <div style={{ position: 'absolute', right: 22, top: 22, width: 17, height: 17, background: 'var(--slate-900)' }} />
      <div style={{ position: 'absolute', left: 22, bottom: 22, width: 17, height: 17, background: 'var(--slate-900)' }} />
      <div style={{ position: 'absolute', right: 22, bottom: 22, width: 17, height: 17, background: 'var(--slate-900)', borderRadius: '50%' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 26, display: 'block' }} />
            <span className="t-display" style={{ fontSize: 13, letterSpacing: '0.05em', color: 'var(--slate-800)' }}>motion</span>
            <div style={{ fontSize: 10.5, border: '1px solid var(--slate-800)', padding: '2px 8px', fontWeight: 600 }}>様式 R7-02</div>
            <div style={{ fontSize: 10.5, color: 'var(--slate-500)' }}>読み取り対応</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.04em', marginTop: 8 }}>令和7年度 体力測定 記録用紙</div>
          <div style={{ fontSize: 11, color: 'var(--slate-600)', marginTop: 3 }}>{p.muniVenue} · 測定日 <span className="t-num">{p.dateLabel}</span></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--slate-600)', marginBottom: 4 }}>参加者 ID</div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            {p.uidDigits.map((dg, i) => (
              <div key={i} className="t-num" style={{ width: 30, height: 36, border: '2px solid var(--slate-900)', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700 }}>{dg}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 1, justifyContent: 'flex-end', marginTop: 5 }}>
            {p.strip.map((bg, i) => (
              <div key={i} style={{ width: 7, height: 9, border: '0.5px solid var(--slate-300)', background: bg }} />
            ))}
          </div>
        </div>
      </div>

      {/* 基本情報 */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.1fr 0.6fr 0.6fr', border: '2px solid var(--slate-900)', marginTop: 14 }}>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-300)' }}>氏名（ふりがな）</div>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-300)' }}>生年月日</div>
        <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-300)' }}>年齢</div>
        <div style={CELL_LABEL}>性別</div>
        <div style={{ padding: '7px 10px 9px', borderRight: '1px solid var(--slate-300)', minHeight: 34 }}>
          <span style={{ fontSize: 9.5, color: 'var(--slate-500)' }}>{p.kana}</span><br />
          <span style={{ fontSize: 17, fontWeight: 700 }}>{p.name}</span>
        </div>
        <div className="t-num" style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-300)', alignSelf: 'center', fontSize: 13 }}>{p.birth}</div>
        <div className="t-num" style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-300)', alignSelf: 'center', fontSize: 13 }}>{p.age}</div>
        <div style={{ padding: '8px 10px', alignSelf: 'center', fontSize: 13 }}>{p.sex}</div>
      </div>

      {/* 記入例 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '8px 12px', background: 'var(--slate-50)', border: '1px solid var(--slate-200)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--slate-700)', flexShrink: 0 }}>記入例</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
          {['2', '4'].map((d, i) => (
            <div key={i} style={{ width: 26, height: 32, border: '2px solid var(--slate-800)', borderRadius: 2, display: 'grid', placeItems: 'center' }}>
              <span className="t-hand" style={{ fontSize: 19, color: 'var(--slate-800)' }}>{d}</span>
            </div>
          ))}
          <div style={{ fontSize: 16, fontWeight: 900, paddingBottom: 1 }}>.</div>
          <div style={{ width: 26, height: 32, border: '2px solid var(--slate-800)', borderRadius: 2, display: 'grid', placeItems: 'center' }}>
            <span className="t-hand" style={{ fontSize: 19, color: 'var(--slate-800)' }}>5</span>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--slate-600)', lineHeight: 1.6 }}>
          太枠の中に <b>1 マス 1 桁</b> ではっきりと記入してください。小数点は印字済みです。訂正は二重線を引き、枠の右の余白に書き直してください。未実施の項目は空欄のままにしてください。
        </div>
      </div>

      {/* 記入欄 */}
      <div style={{ marginTop: 14, borderTop: '2px solid var(--slate-900)', paddingTop: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px auto 64px', gap: 10, padding: '5px 0 3px', borderBottom: '1px solid var(--slate-300)', fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--slate-600)', alignItems: 'end' }}>
          <div>測定項目</div>
          <div>参考（前回値）</div>
          <div style={{ textAlign: 'right' }}>記入枠</div>
          <div>単位</div>
        </div>
        {p.rows.map(r => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 92px auto 64px', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--slate-200)', alignItems: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.label}</div>
            <div className="t-num" style={{ fontSize: 10.5, color: 'var(--slate-400)' }}>{r.prev}</div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
              {r.boxes.map((bx, i) => bx.d
                ? <div key={i} style={{ width: 34, height: 40, border: '2px solid var(--slate-800)', borderRadius: 2, background: '#fff' }} />
                : <div key={i} style={{ fontSize: 18, fontWeight: 900, paddingBottom: 2, width: 8, textAlign: 'center' }}>.</div>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--slate-500)' }}>{r.unit}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* 特記事項 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 12, marginTop: 14, alignItems: 'stretch' }}>
        <div style={{ border: '1px solid var(--slate-300)' }}>
          <div style={{ padding: '4px 10px', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--slate-600)' }}>特記事項（体調・中止項目など）</div>
          <div style={{ padding: '4px 12px 8px' }}>
            <div style={{ height: 24, borderBottom: '1px dotted var(--slate-300)' }} />
            <div style={{ height: 24, borderBottom: '1px dotted var(--slate-300)' }} />
          </div>
        </div>
        <div style={{ border: '1px solid var(--slate-300)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '4px 10px', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--slate-600)', textAlign: 'center' }}>測定者名</div>
          <div style={{ flex: 1, minHeight: 40 }} />
        </div>
      </div>

      {/* フッター */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, borderTop: '3px solid var(--brand-500)', paddingTop: 7 }}>
        <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 18, display: 'block' }} />
        <span className="t-display" style={{ fontSize: 11, letterSpacing: '0.05em', color: 'var(--slate-700)' }}>motion</span>
        <span style={{ fontSize: 9, color: 'var(--slate-500)' }}>スキャン読み取り対応様式 · 用紙は折らずにお持ちください</span>
        <span style={{ flex: 1 }} />
        <span className="t-num" style={{ fontSize: 9.5, color: 'var(--slate-500)' }}>{p.pageNo} / {p.total}</span>
      </div>
    </div>
  )
}

export default function SheetMaker() {
  const { state, set } = useStore()
  const evs = allEvents(state).filter(e => e.kind === 'meas' && e.code && e.date.slice(0, 4) === '2025').sort((a, b) => a.date.localeCompare(b.date))
  const defEv = evs.find(e => e.date >= D.TODAY) || evs[0]
  const evKey = state.shEvent || (defEv ? defEv.code + '@' + defEv.date : '')
  const code = +evKey.split('@')[0]
  const ev = evs.find(e => e.code === code && e.date === evKey.split('@')[1])
  let parts, venue, muni, dateLabel
  if (state.shMode === 'muni') {
    const mu = allMunis(state).find(x => x.id === state.shMuni) || D.MUNIS[0]
    parts = D.users.filter(u => u.muni === mu.id)
    venue = ''; muni = mu.name; dateLabel = ''
  } else {
    parts = ev ? D.users.filter(u => u.venueCode === ev.code) : []
    venue = ev ? ev.venue : ''; muni = ev ? ev.muni : ''; dateLabel = ev ? ev.date : ''
  }
  parts = parts.slice().sort((a, b) => a.kana.localeCompare(b.kana, 'ja'))

  const mk = (u, i, total) => ({
    pageNo: i + 1, total,
    uid: u ? u.id : '', uidDigits: u ? digitsOf(u.id) : ['', '', '', '', ''],
    strip: u ? stripOf(u.id) : Array.from({ length: 20 }, () => 'transparent'),
    name: u ? u.name : '', kana: u ? u.kana : '',
    birth: u ? u.birthDate : '', age: u ? String(u.age) : '', sex: u ? u.sexLabel : '',
    muniVenue: (muni || '') + (venue ? ' · ' + venue : ''), dateLabel: dateLabel || '　　　/　　/　　',
    rows: sheetRowsFor(u),
  })
  const withBlanks = parts.slice(0, Math.max(0, 30 - state.shBlank))
  const total = withBlanks.length + state.shBlank
  const pages = withBlanks.map((u, i) => mk(u, i, total)).concat(Array.from({ length: state.shBlank }, (_, j) => mk(null, withBlanks.length + j, total)))

  return (
    <div className="print-screen" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', minHeight: 0 }}>
      {/* 設定パネル */}
      <div className="noprint" style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <Overline style={{ marginBottom: 8 }}>作成対象</Overline>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <RadioCard on={state.shMode === 'event'} label="測定会から選ぶ" desc="会場の参加者全員分を作成" onClick={() => set({ shMode: 'event' })} />
            <RadioCard on={state.shMode === 'muni'} label="市町村から選ぶ" desc="市町村の登録者全員分を作成" onClick={() => set({ shMode: 'muni' })} />
          </div>
        </div>
        {state.shMode === 'event' && (
          <div>
            <Overline style={{ marginBottom: 8 }}>測定会</Overline>
            <Select value={evKey} onChange={(e) => set({ shEvent: e.target.value })}
              options={evs.map(e => ({ v: e.code + '@' + e.date, l: mdw(e.date) + ' ' + e.muni + ' ' + e.venue }))} style={{ width: '100%' }} />
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>会場の参加者 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{parts.length}</span> 名（五十音順）</div>
          </div>
        )}
        {state.shMode === 'muni' && (
          <div>
            <Overline style={{ marginBottom: 8 }}>市町村</Overline>
            <Select value={state.shMuni} onChange={(e) => set({ shMuni: e.target.value })} options={D.MUNIS.map(m => ({ v: m.id, l: m.name }))} style={{ width: '100%' }} />
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>登録者 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{parts.length}</span> 名（五十音順）</div>
          </div>
        )}
        <div>
          <Overline style={{ marginBottom: 8 }}>予備の空欄用紙</Overline>
          <Select value={String(state.shBlank)} onChange={(e) => set({ shBlank: +e.target.value })}
            options={[{ v: '0', l: '追加しない' }, { v: '3', l: '3 枚追加' }, { v: '5', l: '5 枚追加' }, { v: '10', l: '10 枚追加' }]} style={{ width: '100%' }} />
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.6 }}>当日の新規参加の方用に、氏名・ID が空欄の用紙を末尾に追加します</div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
            <span className="t-num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)' }}>{total}</span> 枚 · A4 縦 · 1 名 1 枚
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => window.print()}>
            <Icon name="printer" size={17} strokeWidth={1.8} />
            印刷する
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.6 }}>四隅の黒マーカーと 1 マス 1 桁の記入枠が、スキャン時の位置合わせと数字認識の基準になります。</div>
        </div>
      </div>

      {/* プレビュー */}
      <div className="pdf-stage">
        <div className="pdf-pages">
          {pages.map((p, i) => <SheetPage key={i} p={p} />)}
        </div>
      </div>
    </div>
  )
}
