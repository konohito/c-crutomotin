import { useEffect, useRef, useState } from 'react'
import D from '../data/engine.js'
import { useStore, pendingSheets, sheetsAll, batchN, flagsFor, flaggedCols, needsReview, openSheetVals, CONF_THRESHOLD } from '../store.jsx'
import { fmtD } from '../lib/helpers.js'
import { ocrEnabled, recognizeSheet, matchUser } from '../lib/ocr.js'
import { dbEnabled, watchBatches, watchRecognitions, commitRecognition, rejectRecognition } from '../lib/db.js'
import { saveMeasurement } from '../lib/realdata.js'
import { Card, Pill, Modal, ModalHead, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'


const GRID = '42px 168px repeat(8, 1fr) 92px 128px'

// バッチID(例: 20260724-ab12x)から測定日を推定する。読めなければ今日。
function batchDate(batchId) {
  const m = String(batchId || '').match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}/${m[2]}/${m[3]}`
  const d = new Date()
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

// 実バックエンド(Document AI)で 1 枚読み取るライブ確認パネル。
// VITE_OCR_ENDPOINT が設定されている時だけ表示される(デモ環境では非表示)。
function LiveOcrCard() {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const onPick = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setBusy(true); setError(''); setResult(null)
    try { setResult(await recognizeSheet(file)) }
    catch (err) { setError(err.message || '認識に失敗しました') }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  return (
    <Card pad style={{ borderColor: 'var(--brand-200)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="camera" size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>実データで読み取り（Document AI）</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 1 }}>記録用紙の写真を 1 枚選ぶと、実際のバックエンドで認識します</div>
        </div>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onPick} style={{ display: 'none' }} />
        <button className="btn btn-primary" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
          {busy ? '認識中…' : '画像を選ぶ'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--danger-700)', background: 'var(--danger-50)', borderRadius: 8, padding: '8px 12px' }}>{error}</div>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{result.ocrName || '（氏名未取得）'}</span>
            {result.ocrKana && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{result.ocrKana}</span>}
            {result.matched
              ? <Pill bg="var(--success-50)" fg="var(--success-700)">台帳照合 OK · ID {result.userId}</Pill>
              : <Pill bg="var(--warning-50)" fg="var(--warning-700)">台帳に一致なし</Pill>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
            {D.SHEET_COLS.map(cid => {
              const col = D.COLS.find(c => c.id === cid)
              const f = result.fields[cid]
              const low = f.conf > 0 && f.conf < CONF_THRESHOLD
              const blank = f.value === null
              return (
                <div key={cid} style={{ border: `1px solid ${low ? 'var(--warning-500)' : 'var(--border-subtle)'}`, background: low ? 'var(--warning-50)' : 'var(--bg-surface)', borderRadius: 8, padding: '7px 10px' }}>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{col.short}</div>
                  <div className="t-num" style={{ fontSize: 16, fontWeight: 700, color: blank ? 'var(--fg-4)' : 'var(--fg-1)' }}>
                    {blank ? '—' : fmtD(f.value, col.dec)}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--fg-4)', marginLeft: 2 }}>{col.unit}</span>
                  </div>
                  <div className="t-num" style={{ fontSize: 10, color: low ? 'var(--warning-700)' : 'var(--fg-4)' }}>信頼度 {f.conf}%</div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 10 }}>
            信頼度 {CONF_THRESHOLD}% 未満の項目（黄色）は、本番フローでは自動で「要確認」に振り分けられます。
          </div>
        </div>
      )}
    </Card>
  )
}

// ---- 本番: 読み取りキューの確認・修正・本登録 --------------------------------
// スマホ「用紙アップロード」→ Storage → onSheetImageUpload(Document AI) → batches/{id}/recognitions
// に届いた読み取り結果を、職員が確認して本登録する画面。
function RecReviewModal({ rec, batchId, onClose, onDone }) {
  const { showToast } = useStore()
  const auto = matchUser(rec)
  const [uid, setUid] = useState(auto ? auto.id : '')
  const [q, setQ] = useState('')
  const [vals, setVals] = useState(() => {
    const o = {}
    D.SHEET_COLS.forEach(cid => { const f = rec.fields && rec.fields[cid]; o[cid] = f && f.value != null ? String(f.value) : '' })
    return o
  })
  const [busy, setBusy] = useState(false)
  const sel = D.users.find(u => u.id === uid)
  const qt = q.trim().toLowerCase()
  const cands = qt ? D.users.filter(u => u.name.toLowerCase().includes(qt) || u.kana.toLowerCase().includes(qt) || u.id.includes(qt)).slice(0, 6) : []

  const save = async () => {
    if (!sel) { showToast('本登録する利用者を選択してください'); return }
    setBusy(true)
    const finalValues = {}
    D.SHEET_COLS.forEach(cid => { const t = String(vals[cid] ?? '').trim(); finalValues[cid] = t === '' ? null : t })
    try {
      await commitRecognition({ batchId, recognitionId: rec.id, user: sel, finalValues, meta: { year: D.CUR, date: batchDate(batchId) } })
      // メモリの台帳にも反映（個人詳細・台帳の表示を即時更新）
      const nums = {}
      D.SHEET_COLS.forEach(cid => { nums[cid] = finalValues[cid] === null ? null : Math.round(parseFloat(finalValues[cid]) * 10) / 10 })
      await saveMeasurement(sel.id, D.CUR, nums)
      showToast(`${sel.name} さんを本登録しました`)
      onDone()
      onClose()
    } catch (e) { showToast('本登録に失敗しました: ' + (e.message || '')); setBusy(false) }
  }

  return (
    <Modal onClose={onClose} width={560}>
      <ModalHead icon="imp" iconBg="var(--brand-50)" iconFg="var(--brand-600)"
        title={`読み取り結果の確認（No.${rec.no ?? '—'}）`} sub={`読み取り氏名: ${rec.ocrName || '（未取得）'}${rec.ocrId ? ' · ID ' + rec.ocrId : ''}`} onClose={onClose} />
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 利用者照合 */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 6 }}>本登録する利用者</div>
          {sel ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--success-50)', border: '1px solid var(--success-500)' }}>
              <Icon name="check" size={15} strokeWidth={2.4} style={{ color: 'var(--success-700)' }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{sel.name}</span>
                <span className="t-num" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginLeft: 8 }}>ID {sel.id} · {sel.venueName || sel.muniName}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setUid('')}>変更</button>
            </div>
          ) : (
            <div>
              <input className="field" placeholder="氏名・かな・ID で台帳を検索…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
                {cands.map(u => (
                  <div key={u.id} onClick={() => { setUid(u.id); setQ('') }}
                    style={{ display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', alignItems: 'baseline' }} className="tbl-row clickable">
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</span>
                    <span className="t-num" style={{ fontSize: 11, color: 'var(--fg-3)' }}>ID {u.id} · {u.venueName || ''}</span>
                  </div>
                ))}
                {qt && !cands.length && <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: '6px 2px' }}>一致する利用者がいません</div>}
              </div>
            </div>
          )}
        </div>
        {/* 測定値（読み取り結果を修正できる） */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 6 }}>測定値（信頼度の低い項目は黄色。空欄 = 未測定）</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {D.SHEET_COLS.map(cid => {
              const col = D.COLS.find(c => c.id === cid)
              const f = rec.fields && rec.fields[cid]
              const low = f && f.conf > 0 && f.conf < CONF_THRESHOLD
              return (
                <label key={cid} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: low ? 'var(--warning-700)' : 'var(--fg-3)' }}>
                    {col.short || col.label}（{col.unit}）{f ? ` · ${f.conf}%` : ''}
                  </span>
                  <input className="field t-num" inputMode="decimal" value={vals[cid]}
                    onChange={(e) => setVals(s => ({ ...s, [cid]: e.target.value }))}
                    style={low ? { borderColor: 'var(--warning-500)', background: 'var(--warning-50)' } : undefined} placeholder="—" />
                </label>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>キャンセル</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !sel}>{busy ? '登録中…' : 'この内容で本登録'}</button>
        </div>
      </div>
    </Modal>
  )
}

function ProdImport() {
  const { set, showToast } = useStore()
  const [batches, setBatches] = useState(null)
  const [batchId, setBatchId] = useState('')
  const [queue, setQueue] = useState([])
  const [review, setReview] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    let unsub = () => {}
    watchBatches((list) => {
      setBatches(list)
      setBatchId(prev => prev || (list[0] ? list[0].id : ''))
    }).then(fn => { unsub = fn }).catch(() => setBatches([]))
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!batchId) { setQueue([]); return }
    let unsub = () => {}
    watchRecognitions(batchId, setQueue).then(fn => { unsub = fn }).catch(() => {})
    return () => unsub()
  }, [batchId])

  // 却下済みは一覧から隠す（文書は監査のため Firestore に残る）
  const enriched = queue.filter(r => r.status !== 'rejected').map(rec => ({ rec, u: matchUser(rec) }))
  const nDone = enriched.filter(x => x.rec.status === 'committed').length
  const nErr = enriched.filter(x => x.rec.status === 'error').length
  const ready = enriched.filter(x => x.rec.status === 'recognized' && x.u && !x.rec.needsReview)
  const nNeed = enriched.filter(x => x.rec.status === 'recognized' && (!x.u || x.rec.needsReview)).length

  const reject = async (rec) => {
    if (!window.confirm(`No.${rec.no ?? '—'} の読み取りを却下しますか？\n（関係ない画像・誤アップロードなどを一覧から取り除きます）`)) return
    try {
      await rejectRecognition({ batchId, recognitionId: rec.id })
      showToast('読み取りを却下しました')
    } catch (e) { showToast('却下に失敗しました: ' + (e.message || '')) }
  }

  const commitOne = async ({ rec, u }) => {
    const finalValues = {}
    D.SHEET_COLS.forEach(cid => { finalValues[cid] = rec.fields && rec.fields[cid] ? rec.fields[cid].value : null })
    await commitRecognition({ batchId, recognitionId: rec.id, user: u, finalValues, meta: { year: D.CUR, date: batchDate(batchId) } })
    const nums = {}
    D.SHEET_COLS.forEach(cid => { nums[cid] = finalValues[cid] == null ? null : Math.round(parseFloat(finalValues[cid]) * 10) / 10 })
    await saveMeasurement(u.id, D.CUR, nums)
  }

  const commitReady = async () => {
    if (!ready.length || bulkBusy) return
    setBulkBusy(true)
    let ok = 0, ng = 0
    for (const x of ready) {
      try { await commitOne(x); ok++ } catch { ng++ }
    }
    setBulkBusy(false)
    set(s => ({ rev: s.rev + 1 }))
    showToast(`${ok} 件を本登録しました${ng ? `（失敗 ${ng} 件）` : ''}`)
  }

  return (
    <div className="screen">
      {/* バッチ選択 */}
      <Card pad style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="imp" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>読み取りキュー</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 2 }}>
            スマホの「用紙アップロード」から送信すると、自動読み取りの結果がここに届きます
          </div>
        </div>
        {batches && batches.length > 0 && (
          <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}
            options={batches.map(b => ({ v: b.id, l: `${batchDate(b.id)} · ${b.id}（${b.sheetCount || 0} 枚）` }))} />
        )}
        {queue.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Pill lg bg="var(--success-50)" fg="var(--success-700)">登録済 <span className="t-num" style={{ fontWeight: 600 }}>{nDone}</span></Pill>
            <Pill lg bg="var(--warning-50)" fg="var(--warning-700)">要確認 <span className="t-num" style={{ fontWeight: 600 }}>{nNeed}</span></Pill>
            {nErr > 0 && <Pill lg bg="var(--danger-50)" fg="var(--danger-700)">エラー <span className="t-num" style={{ fontWeight: 600 }}>{nErr}</span></Pill>}
            {ready.length > 0 && (
              <button className="btn btn-primary" style={{ height: 36 }} disabled={bulkBusy} onClick={commitReady}>
                {bulkBusy ? '登録中…' : `自動判定 ${ready.length} 件を一括本登録`}
              </button>
            )}
          </div>
        )}
      </Card>

      {/* 空状態 */}
      {batches !== null && batches.length === 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border-strong)', borderRadius: 12, padding: '44px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Icon name="camera" size={30} style={{ color: 'var(--slate-300)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)' }}>まだ取り込みがありません</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', textAlign: 'center', maxWidth: 460, lineHeight: 1.7 }}>
            スマホでログインし「用紙アップロード」から記録用紙の写真を送信してください。自動読み取りが終わると、このページに確認リストが表示されます。
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => set({ screen: 'mob' })}>用紙アップロードを開く</button>
        </div>
      )}

      {/* キュー一覧 */}
      {queue.length > 0 && (
        <Card style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1060 }}>
            <div className="tbl-head" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, padding: '0 12px', height: 40, alignItems: 'center' }}>
              <div className="t-overline">No</div>
              <div className="t-overline">氏名照合</div>
              {['身長', '体重', '握力 右', '握力 左', '5m通常', '5m最大', 'TUG', '片足 右/左'].map(h => (
                <div key={h} className="t-overline" style={{ textAlign: 'right' }}>{h}</div>
              ))}
              <div className="t-overline" style={{ paddingLeft: 12 }}>状態</div>
              <div />
            </div>
            {enriched.map(({ rec, u }) => {
              const st = rec.status === 'committed' ? ['登録済', 'var(--success-50)', 'var(--success-700)']
                : rec.status === 'error' ? ['エラー', 'var(--danger-50)', 'var(--danger-700)']
                : (!u || rec.needsReview) ? ['要確認', 'var(--warning-50)', 'var(--warning-700)']
                : ['自動判定', 'var(--slate-100)', 'var(--slate-600)']
              const cellIds = ['height', 'weight', 'gripR', 'gripL', 'walk5', 'walk5max', 'tug']
              return (
                <div key={rec.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, padding: '5px 12px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{rec.no ?? '—'}</div>
                  <div style={{ minWidth: 0, paddingRight: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u ? u.name : (rec.ocrName || '（氏名未取得）')}</div>
                    <div className="t-num" style={{ fontSize: 11, color: u ? 'var(--fg-3)' : 'var(--danger-700)' }}>{u ? `ID ${u.id} · 照合 OK` : '台帳に一致なし'}</div>
                  </div>
                  {cellIds.map(cid => {
                    const f = rec.fields && rec.fields[cid]
                    const low = f && f.conf > 0 && f.conf < CONF_THRESHOLD
                    return (
                      <div key={cid} className="t-num" style={{ fontSize: 13, textAlign: 'right', padding: '5px 6px', borderRadius: 4, margin: '0 1px', background: low ? 'var(--warning-50)' : 'transparent', color: low ? 'var(--warning-700)' : (f && f.value != null ? 'var(--fg-1)' : 'var(--fg-4)') }}>
                        {f && f.value != null ? fmtD(f.value, 1) : '—'}
                      </div>
                    )
                  })}
                  <div className="t-num" style={{ fontSize: 12, textAlign: 'right', padding: '5px 6px', color: 'var(--fg-2)' }}>
                    {['balR', 'balL'].map(cid => {
                      const f = rec.fields && rec.fields[cid]
                      return f && f.value != null ? fmtD(f.value, 1) : '—'
                    }).join(' / ')}
                  </div>
                  <div style={{ paddingLeft: 12 }}>
                    <Pill bg={st[1]} fg={st[2]}>{st[0]}</Pill>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    {rec.status === 'recognized' && (
                      <button className="btn btn-outline btn-sm" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => setReview(rec)}>確認する</button>
                    )}
                    {rec.status !== 'committed' && (
                      <button className="btn btn-ghost btn-sm" title="この読み取りを却下（一覧から取り除く）"
                        style={{ height: 28, padding: '0 8px', fontSize: 12, color: 'var(--danger-700)' }} onClick={() => reject(rec)}>却下</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {review && (
        <RecReviewModal rec={review} batchId={batchId} onClose={() => setReview(null)}
          onDone={() => set(s => ({ rev: s.rev + 1 }))} />
      )}
    </div>
  )
}

function DemoImport() {
  const { state, set, setState, showToast } = useStore()
  const scanT = useRef(null)
  const N = batchN()
  const shown = state.imp === 'idle' ? [] : sheetsAll().slice(0, state.imp === 'run' ? state.impCount : N)
  const pend = pendingSheets(state)

  useEffect(() => () => clearInterval(scanT.current), [])

  const startScan = () => {
    set({ imp: 'run', impCount: 0 })
    scanT.current = setInterval(() => {
      setState(s => {
        const n = s.impCount + 1
        if (n >= N) { clearInterval(scanT.current); return { ...s, impCount: n, imp: 'scanned' } }
        return { ...s, impCount: n }
      })
    }, 90)
  }

  const commitAll = () => {
    if (pendingSheets(state).length > 0) { showToast('要確認の用紙が残っています'); return }
    sheetsAll().forEach(sh => {
      const res = state.resolved[sh.no]
      let values = {}
      if (res) { values = res.values }
      else { D.SHEET_COLS.forEach(cid => { values[cid] = sh.fields[cid].raw === '' ? null : sh.fields[cid].value }) }
      D.commitSheet(res && res.userId ? { ...sh, userId: res.userId } : sh, values)
    })
    set(s => ({ imp: 'committed', rev: s.rev + 1 }))
    showToast(N + ' 件を本登録しました')
  }

  const openSheet = (no) => {
    const patch = openSheetVals(state, no)
    if (patch) set(patch)
  }

  return (
    <div className="screen">
      {/* Document AI エンドポイントのみ設定時の単票読み取り（キュー未使用時の確認用） */}
      {ocrEnabled() && !dbEnabled() && <LiveOcrCard />}

      {/* バッチヘッダー */}
      <Card pad style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="imp" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{D.batchMeta.venue} — 令和7年度 測定会</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 2 }}>
            測定日 <span className="t-num">{D.batchMeta.date}</span> · 記録用紙 <span className="t-num">{N}</span> 枚 · モバイル撮影から受信済み
          </div>
        </div>
        {state.imp === 'idle' && (
          <button className="btn btn-primary" onClick={startScan}>読み取りを開始</button>
        )}
        {state.imp === 'run' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--brand-200)', borderTopColor: 'var(--brand-500)', animation: 'spin 700ms linear infinite' }} />
            <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>手書き数値を読み取り中 <span className="t-num" style={{ fontWeight: 600 }}>{state.impCount} / {N}</span></div>
          </div>
        )}
        {state.imp === 'scanned' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Pill lg bg="var(--success-50)" fg="var(--success-700)">自動判定 <span className="t-num" style={{ fontWeight: 600 }}>{shown.filter(sh => !needsReview(sh)).length}</span></Pill>
            <Pill lg bg="var(--warning-50)" fg="var(--warning-700)">要確認 <span className="t-num" style={{ fontWeight: 600 }}>{pend.length}</span></Pill>
            <button className={`btn${pend.length > 0 ? ' disabled' : ' btn-primary'}`} style={{ height: 36 }} onClick={commitAll}>本登録する</button>
          </div>
        )}
        {state.imp === 'committed' && (
          <Pill lg bg="var(--success-50)" fg="var(--success-700)" style={{ height: 28, padding: '0 12px', fontSize: 12.5 }}>
            <Icon name="check" size={14} strokeWidth={2} />
            {N} 件を本登録しました
          </Pill>
        )}
      </Card>

      {/* アイドル時のプレースホルダー */}
      {state.imp === 'idle' && (
        <div style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border-strong)', borderRadius: 12, padding: '44px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <svg width="88" height="60" viewBox="0 0 88 60" fill="none" aria-hidden="true">
            <rect x="27" y="4" width="34" height="52" rx="3" fill="var(--bg-surface)" stroke="var(--slate-300)" strokeWidth="2" />
            <path d="M34 14h20M34 21h20M34 28h12M34 46h14" stroke="var(--slate-200)" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 16V9a4 4 0 0 1 4-4h6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M76 16V9a4 4 0 0 0-4-4h-6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M12 44v7a4 4 0 0 0 4 4h6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M76 44v7a4 4 0 0 1-4 4h-6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="16" y1="36" x2="72" y2="36" stroke="var(--brand-500)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 6" />
          </svg>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)' }}>受信済みの記録用紙 <span className="t-num">{N}</span> 枚が読み取りを待っています</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', textAlign: 'center', maxWidth: 480, lineHeight: 1.7 }}>
            「読み取りを開始」を押すと、Cloud Vision による手書き数値の認識が一括で実行されます。信頼度の低い読み取り結果は自動登録されず、確認の一覧に振り分けられます。
          </div>
        </div>
      )}

      {/* 読み取り結果テーブル */}
      {state.imp !== 'idle' && (
        <Card style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1060 }}>
          <div className="tbl-head" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, padding: '0 12px', height: 40, alignItems: 'center' }}>
            <div className="t-overline">No</div>
            <div className="t-overline">氏名照合</div>
            {['5m歩行', '片足 右', '片足 左', '握力 右', '握力 左', 'TUG', '身長', '体重'].map(h => (
              <div key={h} className="t-overline" style={{ textAlign: 'right' }}>{h}</div>
            ))}
            <div className="t-overline" style={{ paddingLeft: 12 }}>状態</div>
            <div />
          </div>
          {shown.map(sh => {
            const res = state.resolved[sh.no]
            const flags = flagsFor(sh)
            const need = flags.length > 0 && !res
            const fcols = flaggedCols(sh)
            const nameFlag = flags.some(f => f.type === 'name')
            const u = D.users.find(x => x.id === ((res && res.userId) || sh.userId))
            let st
            if (need) st = ['要確認', 'var(--warning-50)', 'var(--warning-700)']
            else if (res) st = [state.imp === 'committed' ? '登録済' : '修正済', 'var(--success-50)', 'var(--success-700)']
            else st = [state.imp === 'committed' ? '登録済' : '自動判定', state.imp === 'committed' ? 'var(--success-50)' : 'var(--slate-100)', state.imp === 'committed' ? 'var(--success-700)' : 'var(--slate-600)']
            return (
              <div key={sh.no} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, padding: '5px 12px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', animation: 'rowIn 200ms var(--ease-standard)' }}>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{sh.no}</div>
                <div style={{ minWidth: 0, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nameFlag && !res ? sh.ocrName : (u ? u.name : sh.ocrName)}
                  </div>
                  <div className="t-num" style={{ fontSize: 11, color: nameFlag && !res ? 'var(--danger-700)' : 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nameFlag && !res ? '照合エラー · 信頼度 ' + sh.nameConf + '%' : 'ID ' + ((res && res.userId) || sh.userId) + (res ? ' · 修正済' : ' · 照合 ' + sh.nameConf + '%')}
                  </div>
                </div>
                {D.SHEET_COLS.map(cid => {
                  const col = D.COLS.find(c => c.id === cid)
                  const f = sh.fields[cid]
                  let cell
                  if (res) {
                    const v = res.values[cid]
                    const fixed = fcols.has(cid)
                    cell = { raw: v === null ? '欠測' : fmtD(v, col.dec), bg: fixed ? 'var(--success-50)' : 'transparent', fg: fixed ? 'var(--success-700)' : (v === null ? 'var(--fg-4)' : 'var(--fg-1)'), bs: 'solid', bc: 'transparent' }
                  } else if (fcols.has(cid)) {
                    cell = { raw: f.raw === '' ? '—' : f.raw, bg: 'var(--warning-50)', fg: 'var(--warning-700)', bs: 'dashed', bc: 'var(--warning-500)' }
                  } else {
                    cell = { raw: f.raw, bg: 'transparent', fg: 'var(--fg-1)', bs: 'solid', bc: 'transparent' }
                  }
                  return (
                    <div key={cid} className="t-num" style={{ fontSize: 13, textAlign: 'right', padding: '5px 6px', borderRadius: 4, margin: '0 1px', background: cell.bg, color: cell.fg, border: `1px ${cell.bs} ${cell.bc}` }}>
                      {cell.raw}
                    </div>
                  )
                })}
                <div style={{ paddingLeft: 12 }}>
                  <Pill bg={st[1]} fg={st[2]}>{st[0]}</Pill>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {need && (
                    <button className="btn btn-outline btn-sm" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => openSheet(sh.no)}>確認する</button>
                  )}
                </div>
              </div>
            )
          })}
          </div>
        </Card>
      )}
    </div>
  )
}

export default function ImportScreen() {
  // 本番(実データ)は読み取りキュー画面、公開デモは従来の演出付きデモを表示する
  return dbEnabled() ? <ProdImport /> : <DemoImport />
}
