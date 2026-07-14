import D from '../data/engine.js'
import { useStore, sheetsAll, flagsFor, flaggedCols, pendingSheets, openSheetVals } from '../store.jsx'
import { fmtD } from '../lib/helpers.js'
import { Modal, ModalHead, Overline } from '../ui/kit.jsx'

export default function ReviewModal() {
  const { state, set, setState, showToast, timers } = useStore()
  const sheet = sheetsAll().find(x => x.no === state.mdNo)
  if (!sheet) return null

  const flags = flagsFor(sheet)
  const fcols = flaggedCols(sheet)
  const nameFlag = flags.find(f => f.type === 'name')
  const trueUser = D.users.find(x => x.id === sheet.userId)
  let nameCands = [{ u: trueUser, score: nameFlag ? 88 : sheet.nameConf }]
  if (nameFlag) {
    const others = D.users.filter(x => x.muni === trueUser.muni && x.id !== trueUser.id && x.sex === trueUser.sex).slice(0, 2)
    nameCands = nameCands.concat(others.map((u, i) => ({ u, score: 36 - i * 9 })))
  }
  const remaining = pendingSheets(state).filter(x => x.no !== state.mdNo).length
  const prevM = trueUser ? (trueUser.meas[2024] || trueUser.meas[2023]) : null

  const close = () => set({ mdNo: null })

  const save = () => {
    const values = {}
    let bad = false
    D.SHEET_COLS.forEach(cid => {
      const raw = (state.mdVals[cid] ?? '').trim()
      if (raw === '') { values[cid] = null; return }
      const n = parseFloat(raw)
      if (isNaN(n)) { bad = true; return }
      values[cid] = n
    })
    if (bad) { showToast('数値として読めない入力があります'); return }
    const resolved = { ...state.resolved, [sheet.no]: { values, userId: state.mdUser } }
    const nextPend = pendingSheets(state).filter(x => x.no !== sheet.no)
    setState(s => ({ ...s, resolved, mdNo: null }))
    showToast('用紙 No.' + sheet.no + ' を修正しました')
    if (nextPend.length > 0) {
      clearTimeout(timers.current.nextSheet)
      timers.current.nextSheet = setTimeout(() => {
        setState(s => {
          const patch = openSheetVals({ ...s, resolved }, nextPend[0].no)
          return patch ? { ...s, ...patch } : s
        })
      }, 160)
    }
  }

  const setVal = (cid, v) => setState(s => ({ ...s, mdVals: { ...s.mdVals, [cid]: v } }))

  return (
    <Modal onClose={close} width="min(940px, 96vw)" className="review-modal">
      <div style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', borderRadius: '16px 16px 0 0', zIndex: 2 }}>
          <ModalHead
            icon="warn" iconBg="var(--warning-50)" iconFg="var(--warning-700)"
            title={`読み取り結果の確認 — 用紙 No.${sheet.no}`}
            sub={flags[0] ? flags[0].message : ''}
            onClose={close}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 0 }}>
          {/* スキャン画像モック */}
          <div style={{ padding: 20, borderRight: '1px solid var(--border-subtle)', background: 'var(--slate-50)' }}>
            <Overline style={{ marginBottom: 10 }}>スキャン画像</Overline>
            <div style={{ background: '#fff', padding: '14px 16px', transform: 'rotate(-0.6deg)', boxShadow: 'var(--shadow-md)' }}>
              <div style={{ border: '2px solid var(--slate-800)', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '2px solid var(--slate-800)', paddingBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>令和7年度 体力測定 記録用紙</div>
                  <div style={{ fontSize: 8, color: 'var(--slate-500)' }}>様式2</div>
                </div>
                <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--slate-300)', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 9, color: 'var(--slate-500)' }}>氏名</span>
                  <span className="t-hand" style={{ fontSize: 16, color: 'var(--slate-800)', background: nameFlag ? 'var(--warning-50)' : 'transparent', borderRadius: 3, padding: '0 4px' }}>{sheet.ocrName}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 9, color: 'var(--slate-500)' }}>会場</span>
                  <span className="t-hand" style={{ fontSize: 11, color: 'var(--slate-800)' }}>桜川体育館</span>
                </div>
                {D.SHEET_COLS.map(cid => {
                  const col = D.COLS.find(c => c.id === cid)
                  return (
                    <div key={cid} style={{ display: 'flex', alignItems: 'baseline', padding: '4.5px 0', borderBottom: '1px dotted var(--slate-300)' }}>
                      <span style={{ fontSize: 9.5, color: 'var(--slate-600)', flex: 1 }}>{col.label}</span>
                      <span className="t-hand" style={{ fontSize: 15, color: 'var(--slate-800)', background: fcols.has(cid) ? 'var(--warning-50)' : 'transparent', borderRadius: 3, padding: '0 5px', minWidth: 30, textAlign: 'right' }}>
                        {sheet.fields[cid].raw === '' ? '(空欄)' : sheet.fields[cid].raw}
                      </span>
                      <span style={{ fontSize: 8, color: 'var(--slate-400)', marginLeft: 4, width: 26 }}>{col.unit}</span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid var(--danger-500)', color: 'var(--danger-500)', display: 'grid', placeItems: 'center', fontSize: 9, transform: 'rotate(-8deg)', opacity: 0.75 }}>済</div>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 12, lineHeight: 1.6 }}>波線 = 信頼度が低い読み取り箇所。原本画像は Cloud Storage に保存されています。</div>
          </div>

          {/* 修正フォーム */}
          <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <Overline style={{ marginBottom: 8 }}>利用者照合</Overline>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {nameCands.map(c => {
                  const on = state.mdUser === c.u.id
                  return (
                    <div key={c.u.id} className={`radio-card${on ? ' on' : ''}`} style={{ padding: '8px 12px' }} onClick={() => set({ mdUser: c.u.id })}>
                      <div className="radio-dot" style={{ width: 15, height: 15 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{c.u.name} <span style={{ fontWeight: 400, color: 'var(--fg-3)', fontSize: 11 }}>{c.u.kana}</span></div>
                        <div className="t-num" style={{ fontSize: 11, color: 'var(--fg-3)' }}>ID {c.u.id} · {c.u.age}歳 · {c.u.venueName}</div>
                      </div>
                      <span className="t-num" style={{ fontSize: 11.5, fontWeight: 600, color: c.score >= 70 ? 'var(--success-700)' : 'var(--fg-3)' }}>一致 {c.score}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <Overline style={{ marginBottom: 8 }}>測定値（読み取り信頼度つき）</Overline>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                {D.SHEET_COLS.map(cid => {
                  const col = D.COLS.find(c => c.id === cid)
                  const f = sheet.fields[cid]
                  const fl = flags.find(x => x.field === cid)
                  const flagged = fcols.has(cid)
                  const prevV = prevM && prevM.values[cid] !== null ? fmtD(prevM.values[cid], col.dec) : null
                  let hint = '', cands = []
                  if (fl) {
                    if (fl.type === 'blank') { hint = '前回値 ' + (prevV || '—') + '（欠測なら空欄のまま）'; if (prevV) cands = [prevV] }
                    else if (fl.type === 'range') { hint = '前回値 ' + (prevV || '—') + ' · 修正候補'; cands = fl.suggest === 'swap' ? [] : [fl.suggest] }
                    else if (fl.candidates) { hint = '読み取り候補'; cands = fl.candidates }
                    else { hint = '前回値 ' + (prevV || '—') }
                  }
                  return (
                    <div key={cid} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 8, background: flagged ? 'var(--warning-50)' : 'var(--slate-25)', border: `1px ${flagged ? 'dashed' : 'solid'} ${flagged ? 'var(--warning-500)' : 'var(--border-subtle)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--fg-2)', flex: 1 }}>{col.label} <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>{col.unit}</span></span>
                        <span className="t-num" style={{ fontSize: 10.5, fontWeight: 600, color: f.conf >= 90 ? 'var(--fg-3)' : f.conf >= 70 ? 'var(--warning-700)' : 'var(--danger-700)' }}>{f.conf}%</span>
                      </div>
                      <input
                        className="field t-num"
                        style={{ height: 34, fontSize: 14 }}
                        value={state.mdVals[cid] ?? ''}
                        inputMode="decimal"
                        onChange={(e) => setVal(cid, e.target.value)}
                      />
                      {hint && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{hint}</span>
                          {cands.map(v => (
                            <button key={v} className="t-num" onClick={() => setVal(cid, v)}
                              style={{ height: 20, padding: '0 8px', borderRadius: 999, border: '1px solid var(--brand-200)', background: 'var(--brand-50)', color: 'var(--brand-700)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
                              {v}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
              <div style={{ fontSize: 11.5, color: 'var(--fg-3)', flex: 1 }}>空欄のまま登録すると欠測として扱われます</div>
              <button className="btn btn-outline" style={{ height: 36, fontSize: 13 }} onClick={close}>キャンセル</button>
              <button className="btn btn-primary" style={{ height: 36, fontSize: 13 }} onClick={save}>
                {remaining > 0 ? `登録して次へ（残り ${remaining} 件）` : '登録する'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
