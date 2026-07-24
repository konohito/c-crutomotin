import D from '../data/engine.js'
import { useStore, allEvents, allMunis } from '../store.jsx'
import { mdw } from '../lib/helpers.js'
import { wardLabel } from '../lib/db.js'
import { RadioCard, Select, Overline } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const BASE = import.meta.env.BASE_URL
// 会場＝行政区。利用者の基本情報 venueName に行政区を持たせているので、そこから選択肢を作る。
const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
const SHEET_BOXES = { walk5: [1, 1], walk5max: [1, 1], balR: [2, 1], balL: [2, 1], gripR: [2, 1], gripL: [2, 1], tug: [2, 1], height: [3, 1], weight: [3, 1] }
// 2 回測定する項目は下書きスペース(①②)を設ける
const DRAFT_COLS = ['gripR', 'gripL', 'walk5', 'walk5max', 'tug', 'balR', 'balL']

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
    return { id: cid, label: col.label, unit: col.unit, boxes, prev: pv ? '前回 ' + pv : '初回', draft: DRAFT_COLS.includes(cid) }
  })
}

const digitsOf = (id) => String(id || '').padStart(5, ' ').slice(-5).split('')
const stripOf = (id) => String(id || '').split('').reduce((acc, ch) => {
  const n = +ch || 0
  ;[8, 4, 2, 1].forEach(b => acc.push((n & b) ? 'var(--slate-900)' : 'transparent'))
  return acc
}, [])

const CELL_LABEL = { padding: '4px 10px', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-300)', fontSize: 12.5, letterSpacing: '0.06em', color: 'var(--slate-600)' }

function SheetPage({ p }) {
  return (
    <div className="pdf-page" style={{ padding: '44px 52px 40px' }}>
      {/* 四隅の位置合わせマーカー */}
      <div style={{ position: 'absolute', left: 22, top: 22, width: 17, height: 17, background: 'var(--slate-900)' }} />
      <div style={{ position: 'absolute', right: 22, top: 22, width: 17, height: 17, background: 'var(--slate-900)' }} />
      <div style={{ position: 'absolute', left: 22, bottom: 22, width: 17, height: 17, background: 'var(--slate-900)' }} />
      <div style={{ position: 'absolute', right: 22, bottom: 22, width: 17, height: 17, background: 'var(--slate-900)', borderRadius: '50%' }} />

      {/* ヘッダー(右はスタッフ記入欄。利用者が記載しないよう明記) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 26, display: 'block' }} />
            <span className="t-display" style={{ fontSize: 13, letterSpacing: '0.05em', color: 'var(--slate-800)' }}>motion</span>
            <div style={{ fontSize: 10.5, border: '1px solid var(--slate-800)', padding: '2px 8px', fontWeight: 600 }}>様式 R7-02</div>
            <div style={{ fontSize: 9.5, color: 'var(--slate-500)', lineHeight: 1.5 }}>スキャン読み取り対応様式<br />用紙は折らずにお持ちください</div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.04em', marginTop: 7 }}>令和7年度 体力測定 記録用紙</div>
          <div style={{ fontSize: 13.5, color: 'var(--slate-600)', marginTop: 2 }}>{p.muniVenue} · 測定日 <span className="t-num">{p.dateLabel}</span></div>
        </div>
        <div style={{ color: 'var(--danger-500)', paddingTop: 2, flexShrink: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 900, letterSpacing: '0.04em', textAlign: 'right' }}>【スタッフ記入用】</div>
          <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, fontWeight: 600 }}>
            {[['ペースメーカー', '（ 有 ・ 無 ）'], ['人工骨 等', '（ 有 ・ 無 ）'], ['InBody', '（ 済 ・ 不可 ）']].map(([lb, opts]) => (
              <div key={lb} style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
                <span style={{ width: 104 }}>・{lb}</span>
                <span style={{ letterSpacing: '0.02em' }}>{opts}</span>
                <span style={{ width: 54, borderBottom: '1px solid var(--danger-500)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 基本情報(ID・氏名は左にまとめる) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', border: '2px solid var(--slate-900)', marginTop: 11 }}>
        <div style={{ borderRight: '1px solid var(--slate-900)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', borderBottom: '1px solid var(--slate-300)' }}>
            <div style={{ padding: '6px 10px', background: 'var(--slate-50)', borderRight: '1px solid var(--slate-300)', fontSize: 12.5, letterSpacing: '0.06em', color: 'var(--slate-600)', display: 'flex', alignItems: 'center' }}>参加者 ID</div>
            <div style={{ padding: '6px 10px 5px' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {p.uidDigits.map((dg, i) => (
                  <div key={i} className="t-num" style={{ width: 28, height: 34, border: '2px solid var(--slate-900)', display: 'grid', placeItems: 'center', fontSize: 19, fontWeight: 700 }}>{dg}</div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 1, marginTop: 4 }}>
                {p.strip.map((bg, i) => (
                  <div key={i} style={{ width: 7, height: 9, border: '0.5px solid var(--slate-300)', background: bg }} />
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr' }}>
            <div style={{ padding: '6px 8px', background: 'var(--slate-50)', borderRight: '1px solid var(--slate-300)', color: 'var(--slate-600)', display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 12.5, letterSpacing: '0.06em' }}>氏名</span>
              <span style={{ fontSize: 10.5 }}>（ふりがな）</span>
            </div>
            <div style={{ padding: '4px 10px 7px' }}>
              <span style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>{p.kana ? '（' + p.kana + '）' : ''}</span><br />
              <span style={{ fontSize: 23, fontWeight: 700 }}>{p.name}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.55fr 0.5fr 0.9fr', gridTemplateRows: 'auto 1fr' }}>
          <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-300)' }}>生年月日</div>
          <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-300)' }}>年齢</div>
          <div style={{ ...CELL_LABEL, borderRight: '1px solid var(--slate-300)' }}>性別</div>
          <div style={CELL_LABEL}>{wardLabel()}</div>
          <div className="t-num" style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-300)', alignSelf: 'center', fontSize: 17 }}>{p.birth}</div>
          <div className="t-num" style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-300)', alignSelf: 'center', fontSize: 17 }}>{p.age}</div>
          <div style={{ padding: '8px 10px', borderRight: '1px solid var(--slate-300)', alignSelf: 'center', fontSize: 17 }}>{p.sex}</div>
          <div style={{ padding: '8px 10px', alignSelf: 'center', fontSize: p.ward.length > 5 ? 12.5 : 15, lineHeight: 1.3 }}>{p.ward}</div>
        </div>
      </div>

      {/* 記入欄(書き直し用に右余白を広めに設ける) */}
      <div style={{ marginTop: 11, borderTop: '2px solid var(--slate-900)', paddingTop: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '164px 1fr 80px auto 44px 58px', gap: 10, padding: '4px 0 3px', borderBottom: '1px solid var(--slate-300)', fontSize: 12.5, letterSpacing: '0.06em', color: 'var(--slate-600)', alignItems: 'end' }}>
          <div>測定項目</div>
          <div />
          <div style={{ whiteSpace: 'nowrap' }}>前回値</div>
          <div style={{ textAlign: 'right' }}>記入枠</div>
          <div>単位</div>
          <div />
        </div>
        {p.rows.map(r => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '164px 1fr 80px auto 44px 58px', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--slate-200)', alignItems: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.label}</div>
            {/* 2 回測定の項目は下書きスペース(①は線の上・②は線の下に書く。線は 1 本だけ) */}
            {r.draft ? (
              <div style={{ display: 'flex', flexDirection: 'column', paddingRight: 14, alignSelf: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid var(--slate-300)' }}>
                  <span style={{ fontSize: 11, color: 'var(--slate-500)', lineHeight: 1, padding: '0 0 2px 2px' }}>①</span>
                  <span style={{ flex: 1, height: 16 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11, color: 'var(--slate-500)', lineHeight: 1, padding: '3px 0 0 2px' }}>②</span>
                  <span style={{ flex: 1, height: 16 }} />
                </div>
              </div>
            ) : <div />}
            <div className="t-num" style={{ fontSize: 14, color: 'var(--slate-500)' }}>{r.prev}</div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
              {r.boxes.map((bx, i) => bx.d
                ? (
                  <div key={i} style={{ width: 38, height: 46, border: '2px solid var(--slate-800)', borderRadius: 2, background: '#fff', display: 'grid', placeItems: 'center' }}>
                    {/* 文字サイズのガイド(薄いグレー・枠いっぱいに) */}
                    <span className="t-num" style={{ fontSize: 36, fontWeight: 700, color: 'var(--slate-200)', lineHeight: 1 }}>8</span>
                  </div>
                )
                : <div key={i} style={{ fontSize: 22, fontWeight: 900, paddingBottom: 2, width: 10, textAlign: 'center' }}>.</div>
              )}
            </div>
            <div style={{ fontSize: 15, color: 'var(--slate-600)' }}>{r.unit}</div>
            {/* 書き直し用の右余白 */}
            <div />
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* スタッフ向け注意事項(注意事項は全て下にまとめる) */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '2.5px solid var(--brand-500)', paddingBottom: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--danger-500)' }}>スタッフ向け注意事項</span>
          <span style={{ flex: 1 }} />
          <span className="t-num" style={{ fontSize: 10, color: 'var(--slate-500)' }}>{p.pageNo} / {p.total}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 26, marginTop: 9 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>【記入について】</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger-500)' }}>※必ず<span style={{ textDecoration: 'underline' }}>マッキー</span>を使用</span>
            </div>
            {/* 訂正例: 二重線で消して右の余白に書き直す。数字は皆が真似して書くため太字ゴシックで */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 7 }}>
              <div style={{ position: 'relative', display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                {['2', '4'].map((d, i) => (
                  <div key={i} style={{ width: 25, height: 31, border: '1.5px solid var(--slate-800)', borderRadius: 2, display: 'grid', placeItems: 'center' }}>
                    <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--slate-800)' }}>{d}</span>
                  </div>
                ))}
                <div style={{ fontSize: 13, fontWeight: 900, paddingBottom: 1 }}>.</div>
                <div style={{ width: 25, height: 31, border: '1.5px solid var(--slate-800)', borderRadius: 2, display: 'grid', placeItems: 'center' }}>
                  <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--slate-800)' }}>5</span>
                </div>
                <div style={{ position: 'absolute', left: -4, right: -4, top: '44%', height: 5, borderTop: '1.5px solid var(--slate-800)', borderBottom: '1.5px solid var(--slate-800)' }} />
              </div>
              <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--slate-900)' }}>25.0</span>
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.7, marginTop: 7, color: 'var(--slate-800)' }}>
              ①太枠の中に 1 マス 1 桁ではっきりと記入。<br />
              ②訂正時は二重線を引き、枠の右の余白に書き直す。<br />
              ③未実施の項目は空欄のままに。
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>【InBody について】</div>
            <div style={{ fontSize: 11, lineHeight: 1.65, color: 'var(--danger-600)', marginTop: 7 }}>
              ペースメーカー・心電計・人工肺などの医療用電子機器を装着していると測定が出来ません。<br />
              また、体内に人工骨や金属プレートが入っている場合は、金属は電気を通しやすいため、実際の体水分量や筋肉量と異なる結果（誤差）が出ることがあります。
            </div>
          </div>
        </div>
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
  // 「市町村から選ぶ」用: 選択中の市町村と、その市町村に属する行政区の選択肢
  const mu = allMunis(state).find(x => x.id === state.shMuni) || D.MUNIS[0]
  const muniUsers = D.users.filter(u => u.muni === mu.id)
  const wardOpts = distinct(muniUsers.map(u => u.venueName))
  const ward = state.shWard || 'all'
  let parts, venue, muni, dateLabel
  if (state.shMode === 'muni') {
    parts = muniUsers.filter(u => ward === 'all' || u.venueName === ward)
    venue = ward === 'all' ? '' : ward; muni = mu.name; dateLabel = ''
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
    ward: u ? (u.venueName || '') : '',
    muniVenue: (muni || '') + (venue ? ' · ' + venue : ''), dateLabel: dateLabel || '　　　/　　/　　',
    rows: sheetRowsFor(u),
  })
  const withBlanks = parts.slice(0, Math.max(0, 30 - state.shBlank))
  const total = withBlanks.length + state.shBlank
  const pages = withBlanks.map((u, i) => mk(u, i, total)).concat(Array.from({ length: state.shBlank }, (_, j) => mk(null, withBlanks.length + j, total)))

  return (
    <div className="print-screen panel-screen" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', minHeight: 0 }}>
      {/* 設定パネル */}
      <div className="noprint side-panel" style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
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
            <Select value={state.shMuni} onChange={(e) => set({ shMuni: e.target.value, shWard: 'all' })} options={D.MUNIS.map(m => ({ v: m.id, l: m.name }))} style={{ width: '100%' }} />
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>登録者 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{muniUsers.length}</span> 名</div>
          </div>
        )}
        {state.shMode === 'muni' && wardOpts.length > 0 && (
          <div>
            <Overline style={{ marginBottom: 8 }}>{wardLabel()}</Overline>
            <Select value={ward} onChange={(e) => set({ shWard: e.target.value })}
              options={[{ v: 'all', l: 'すべての' + wardLabel() }].concat(wardOpts.map(w => ({ v: w, l: w })))} style={{ width: '100%' }} />
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>{ward === 'all' ? '全' + wardLabel() : ward} · 対象 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{parts.length}</span> 名（五十音順）</div>
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
