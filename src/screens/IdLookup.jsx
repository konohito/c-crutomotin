/* 氏名＋生年月日のCSVから、台帳のIDをまとめて調べる画面（2026-09-23 ユーザー依頼）。

   「名前と生年月日のCSVをアップロードしたら、その人達のアプリ内でのIDが一括で
     検索結果として跳ね返ってくるようなシステムを追加してほしい」

   ★台帳には何も書かない。調べて返すだけ。
     取り込み画面（CsvImport）は読んだら必ず保存するので、分けてある。
   ★判定は merge.js の similarity をそのまま使う（登録時の重複チェックと同じ）。
     本番の台帳429名で自己照合したところ、428名が正しく見つかり、取り違えは0件だった。
     残り1名はふりがなも生年月日も無い方で、氏名だけでは決められない＝人に選んでもらう。 */
import React from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { Icon } from '../ui/icons.jsx'
import { lookupIdsFromCsv, resultCsv, yearOnlyCount } from '../lib/idLookup.js'

const STATUS = {
  found: { label: '見つかりました', fg: 'var(--ok-700, #2B6A46)', bg: 'var(--ok-50, #E8F3EC)', bd: 'var(--ok-300, #A8CDB8)' },
  multi: { label: '候補が複数', fg: 'var(--warn-800, #7A5A12)', bg: 'var(--warn-50, #FBF2E0)', bd: 'var(--warn-300, #E0CB99)' },
  none: { label: '見つかりません', fg: 'var(--fg-3)', bg: 'var(--bg-sunken)', bd: 'var(--border-default)' },
  invalid: { label: '氏名が空', fg: 'var(--fg-3)', bg: 'var(--bg-sunken)', bd: 'var(--border-default)' },
}

export default function IdLookup() {
  const { showToast } = useStore()
  const fileRef = React.useRef(null)
  const [res, setRes] = React.useState(null)
  const [fname, setFname] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [drag, setDrag] = React.useState(false)
  const [only, setOnly] = React.useState('all')   // all | found | multi | none

  /* ファイルの文字コードは、取り込み画面と同じやり方で解く（UTF-8で試して駄目ならShift-JIS）。 */
  const onFile = (file) => {
    if (!file) return
    if (!/\.csv$|text\/csv/i.test((file.name || '') + '|' + (file.type || ''))) {
      showToast('CSV ファイルを選んでください'); return
    }
    setBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      let text
      const buf = new Uint8Array(reader.result)
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) }
      catch { try { text = new TextDecoder('shift-jis').decode(buf) } catch { text = new TextDecoder().decode(buf) } }
      const r = lookupIdsFromCsv(text, D.users)
      setRes(r); setFname(file.name); setBusy(false)
      if (r.error) showToast(r.error)
      else showToast(`${r.counts.total} 名を照合しました`)
    }
    reader.onerror = () => { setBusy(false); showToast('ファイルを読めませんでした') }
    reader.readAsArrayBuffer(file)
  }

  const download = () => {
    if (!res || !res.rows.length) return
    const blob = new Blob([resultCsv(res.rows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (fname.replace(/\.csv$/i, '') || '照合結果') + '_ID.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const rows = res ? (only === 'all' ? res.rows : res.rows.filter((r) => r.status === only)) : []
  const yearOnly = res ? yearOnlyCount(res.rows) : 0

  const Chip = ({ k, n }) => {
    const s = STATUS[k] || STATUS.none
    const on = only === k
    return (
      <button onClick={() => setOnly(on ? 'all' : k)} disabled={!n}
        style={{ padding: '5px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: n ? 'pointer' : 'default',
          fontFamily: 'inherit', border: '1px solid ' + (on ? s.fg : s.bd),
          background: on ? s.fg : s.bg, color: on ? '#fff' : s.fg, opacity: n ? 1 : 0.45 }}>
        {s.label} {n}
      </button>
    )
  }

  return (
    <div className="screen" style={{ maxWidth: 940 }}>
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files && e.dataTransfer.files[0]) }}
        style={{
          background: drag ? 'var(--brand-50)' : 'var(--bg-surface)',
          border: `2px dashed ${drag ? 'var(--brand-500)' : 'var(--border-strong)'}`,
          borderRadius: 12, padding: '38px 24px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          cursor: 'pointer', textAlign: 'center',
        }}
      >
        <div style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center' }}>
          <Icon name="search" size={26} />
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 4 }}>氏名と生年月日のCSVをここにドラッグ＆ドロップ</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.8 }}>
          1行目に <b>氏名</b> と <b>生年月日</b> の見出しを入れてください（ふりがな・性別もあると精度が上がります）
          <br />Excel（Shift_JIS）でもそのまま読めます · <b>台帳には何も書き込みません</b>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 6 }} disabled={busy}>
          <Icon name="upload" size={15} strokeWidth={1.8} />
          {busy ? '照合中…' : 'ファイルを選択…'}
        </button>
        <input type="file" accept=".csv,text/csv" ref={fileRef} style={{ display: 'none' }}
          onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = '' }} />
      </div>

      {res && res.error && (
        <div style={{ marginTop: 16, padding: '13px 16px', borderRadius: 10, fontSize: 14, lineHeight: 1.8,
          background: 'var(--warn-50, #FBF2E0)', border: '1px solid var(--warn-300, #E0CB99)', color: 'var(--warn-800, #7A5A12)' }}>
          {res.error}
        </div>
      )}

      {res && !res.error && (
        <>
          <div style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--fg-3)', marginRight: 2 }}>{fname} · {res.counts.total} 名</span>
            <Chip k="found" n={res.counts.found} />
            <Chip k="multi" n={res.counts.multi} />
            <Chip k="none" n={res.counts.none} />
            {res.counts.invalid > 0 && <Chip k="invalid" n={res.counts.invalid} />}
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={download}>
              <Icon name="download" size={15} strokeWidth={1.8} />結果をCSVで保存
            </button>
          </div>

          {yearOnly > 0 && (
            <div style={{ marginTop: 12, padding: '11px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.8,
              background: 'var(--warn-50, #FBF2E0)', border: '1px solid var(--warn-300, #E0CB99)', color: 'var(--warn-800, #7A5A12)' }}>
              <b>{yearOnly} 名</b>は生年月日が「年」までしか入っていません。同じ氏名の方がいると見分けられず、候補が複数になります。
            </div>
          )}

          <div style={{ marginTop: 14, overflowX: 'auto', border: '1px solid var(--border-default)', borderRadius: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: 'var(--bg-sunken)' }}>
                  <th style={{ padding: '9px 10px', textAlign: 'right', width: 48 }}>行</th>
                  <th style={{ padding: '9px 10px', textAlign: 'left' }}>氏名</th>
                  <th style={{ padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap' }}>生年月日</th>
                  <th style={{ padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap' }}>ID</th>
                  <th style={{ padding: '9px 10px', textAlign: 'left' }}>結果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = STATUS[r.status] || STATUS.none
                  return (
                    <tr key={r.no} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--fg-3)', fontFamily: 'ui-monospace,Menlo,monospace' }}>{r.no}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{r.name || <span style={{ color: 'var(--fg-4)' }}>（空）</span>}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>{r.birthDate || '—'}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontFamily: 'ui-monospace,Menlo,monospace', fontWeight: 700 }}>
                        {r.id || <span style={{ color: 'var(--fg-4)', fontWeight: 400 }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                          color: s.fg, background: s.bg, border: '1px solid ' + s.bd, whiteSpace: 'nowrap' }}>{s.label}</span>
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-3)' }}>{r.note}</span>
                        {r.status === 'multi' && (r.candidates || []).length > 0 && (
                          <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {r.candidates.map((c) => (
                              <span key={c.user.id} title={c.reasons.join('・')}
                                style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999,
                                  border: '1px solid var(--border-default)', color: 'var(--fg-2)', background: 'var(--bg-surface)' }}>
                                {c.user.id} · {c.user.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.9 }}>
            「候補が複数」は機械では決めません。上のIDから、どの方かを人が選んでください。<br />
            旧字体（髙→高 など）・全角半角・カタカナとひらがなの違いは、あわせて照合しています。
          </div>
        </>
      )}
    </div>
  )
}
