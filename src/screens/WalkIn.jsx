import { useEffect, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { dbEnabled, wardLabel, watchWalkins, updateWalkin, deleteWalkin, clearWalkInFlag, commitRecognition, commitKclRecognition, deleteSheetImage, sheetImageUrl } from '../lib/db.js'
import { createUserDoc, saveMeasurement } from '../lib/realdata.js'
import { Card, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'
import { KclAnswerChips } from '../ui/kclanswers.jsx'

/* 当日受付 取り込み — 台帳に登録の無い当日参加者の受付キュー。
   当日受付用の記録用紙・問診票(様式 R7-02W / R7-03W)をスキャンすると、通常の取り込みではなくここに届く。
   流れ: pending(受付待ち)
     → 仮登録して取り込み(利用者を walkIn フラグ付きで作成 + 測定値を本登録。台帳一覧にはまだ出ない)
     → この時点で結果用紙(PDF 出力)が使える
     → 正式登録(walkIn フラグを外す)で利用者台帳に載る */

const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
// RegisterModal と同じ採番規則: 行政区の既存 ID の先頭 2 桁から新規コードを推定
function wardIdCode(ward) {
  if (!ward) return null
  const cnt = {}
  D.users.filter(u => u.venueName === ward && /^\d{5}$/.test(String(u.id))).forEach(u => {
    const c = String(u.id).slice(0, 2)
    cnt[c] = (cnt[c] || 0) + 1
  })
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]
  return top ? +top[0] : null
}

// 公開デモ用のサンプル(Firebase 未設定時のみ。流れを画面上で試せる)
const DEMO_ENTRIES = [
  {
    id: 'demo-1', walkinStatus: 'pending', batchId: 'demo', ocrName: '当日 一郎', ocrKana: 'とうじつ いちろう',
    fields: { height: { value: 158.2 }, weight: { value: 54.0 }, gripR: { value: 28.5 }, gripL: { value: 27.0 }, walk5: { value: 3.4 }, walk5max: { value: 2.8 }, tug: { value: 7.9 }, balR: { value: 42.0 }, balL: { value: 38.5 } },
  },
]

const CHIP = {
  pending: ['受付待ち', 'var(--warn-600, #b45309)', 'var(--warn-50, #fef3c7)'],
  committed: ['仮登録済み（結果出力可）', 'var(--brand-600)', 'var(--brand-50)'],
  registered: ['台帳登録済み', 'var(--success-600, #047857)', 'var(--success-50, #ecfdf5)'],
}

function ValueSummary({ fields }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--fg-2)' }}>
      {D.SHEET_COLS.map(cid => {
        const col = D.COLS.find(c => c.id === cid)
        const v = fields && fields[cid] ? fields[cid].value : null
        return <span key={cid}>{col.label} <b className="t-num">{v === null || v === undefined ? '—' : v}</b></span>
      })}
    </div>
  )
}

export default function WalkIn() {
  const { state, set, showToast } = useStore()
  const [entries, setEntries] = useState(dbEnabled() ? [] : DEMO_ENTRIES)
  const [busy, setBusy] = useState('')
  // 仮登録フォーム(開いているエントリ 1 件分)
  const [openId, setOpenId] = useState('')
  const [f, setF] = useState({ name: '', kana: '', sex: 'F', birth: '', ward: '' })
  // 原本画像(エントリIDごとにキャッシュ)と拡大表示・台帳検索
  const [imgs, setImgs] = useState({})
  const [zoomImg, setZoomImg] = useState('')
  const [linkQ, setLinkQ] = useState('')

  useEffect(() => {
    if (!dbEnabled()) return
    let unsub = () => {}
    watchWalkins(setEntries).then(fn => { unsub = fn }).catch(() => {})
    return () => unsub()
  }, [])

  const mu = D.MUNIS[0]
  const wards = distinct(D.users.map(u => u.venueName))
  const openForm = (e) => {
    setOpenId(e.id)
    setLinkQ('')
    setF({ name: e.ocrName || '', kana: e.ocrKana || '', sex: 'F', birth: '', ward: wards[0] || '' })
    // 原本画像を読み込む(手書きの氏名を見ながら登録・紐づけできるように)
    if (e.storagePath && !imgs[e.id]) {
      sheetImageUrl(e.storagePath)
        .then(u => setImgs(prev => ({ ...prev, [e.id]: u || 'none' })))
        .catch(() => setImgs(prev => ({ ...prev, [e.id]: 'none' })))
    }
  }

  /* 同一人物の紐づけ用の道具。
     当日受付は 1 人につき用紙が最大 3 枚(記録用紙 + 問診票おもて/うら)届き、
     1 枚ずつ氏名を打ち直すと打ち間違いで別人として登録される事故が起きやすい。
     2 枚目以降は「本日仮登録した人」への紐づけボタンで取り込めるようにする。 */
  const dayOf = (bid) => String(bid || '').slice(0, 8)
  // 氏名の比較用の正規化(空白除去・カタカナ→ひらがな)
  const nrm = (s) => String(s || '').replace(/[\s　]/g, '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
  // エントリの読み取り氏名と利用者の近さ(大きいほど近い。0 = 手がかりなし)
  const nameScore = (e, u) => {
    const n = nrm(e.ocrName), k = nrm(e.ocrKana), un = nrm(u.name), uk = nrm(u.kana)
    if (n && n === un) return 4
    if (k && uk && k === uk) return 3
    if (n && un && (un.includes(n) || n.includes(un))) return 2
    if (k && uk && (uk.includes(k) || k.includes(uk))) return 1
    return 0
  }
  // このエントリと同じ日に仮登録/紐づけした人(重複なし・名前の近い順)
  const sameDayUsers = (e) => {
    const seen = new Set()
    const out = []
    for (const x of entries) {
      if (x.id === e.id || !x.userId || seen.has(x.userId)) continue
      if (dayOf(x.batchId) !== dayOf(e.batchId)) continue
      seen.add(x.userId)
      const u = D.users.find(uu => uu.id === x.userId)
      if (u) out.push(u)
    }
    return out.sort((a, b) => nameScore(e, b) - nameScore(e, a))
  }

  // 既存の利用者にこの用紙を紐づけて取り込む(新規の利用者は作らない)
  const commitToUser = async (e, u) => {
    if (!u || busy) return
    setBusy(e.id)
    try {
      if (e.kcl) {
        if (dbEnabled()) await commitKclRecognition({ batchId: e.batchId, recognitionId: e.recognitionId || e.id, user: u, answers: e.kcl.answers, year: D.CUR })
        const clean = {}
        Object.entries(e.kcl.answers || {}).forEach(([k, v]) => { if (v === 'yes' || v === 'no') clean[k] = v })
        u.kcl[D.CUR] = { raw: { ...((u.kcl[D.CUR] || {}).raw || {}), ...clean }, date: (u.kcl[D.CUR] || {}).date || null }
      } else {
        const finalValues = {}
        D.SHEET_COLS.forEach(cid => { finalValues[cid] = e.fields && e.fields[cid] ? e.fields[cid].value : null })
        if (dbEnabled()) await commitRecognition({ batchId: e.batchId, recognitionId: e.recognitionId || e.id, user: u, finalValues, meta: { year: D.CUR } })
        const nums = {}
        D.SHEET_COLS.forEach(cid => { nums[cid] = finalValues[cid] == null ? null : Math.round(parseFloat(finalValues[cid]) * 10) / 10 })
        await saveMeasurement(u.id, D.CUR, nums)
      }
      // 台帳登録済みの利用者に紐づけた場合は、このエントリの正式登録も済んだ扱いにする
      const st = u.walkIn ? 'committed' : 'registered'
      await updateWalkin(e.id, { walkinStatus: st, userId: u.id, userName: u.name })
      deleteSheetImage(e.storagePath).catch(() => {})
      if (!dbEnabled()) setEntries(prev => prev.map(x => x.id === e.id ? { ...x, walkinStatus: st, userId: u.id, userName: u.name } : x))
      setOpenId('')
      set(s2 => ({ rev: s2.rev + 1 }))
      showToast(`${u.name} さん（ID ${u.id}）として${e.kcl ? '問診回答' : '測定値'}を取り込みました`)
    } catch (err) { showToast('取り込みに失敗しました: ' + (err.message || '')) }
    setBusy('')
  }

  // 仮登録して取り込み: 利用者作成(walkIn) + 測定値の本登録
  const commitEntry = async (e) => {
    if (!f.name.trim()) { showToast('氏名を入力してください'); return }
    // 同じ日に同じ名前の方を仮登録済みなら、別人としての二重登録でないか確認する
    const dup = sameDayUsers(e).find(u => nrm(u.name) === nrm(f.name))
    if (dup && !window.confirm(`同じ名前の「${dup.name}」さん（ID ${dup.id}）を本日すでに仮登録しています。\n同じ人なら「キャンセル」を押し、上の「${dup.name} さんとして取り込む」を使ってください。\n別人として新規登録しますか？`)) return
    setBusy(e.id)
    try {
      const ward = (f.ward || '').trim()
      const code = wardIdCode(ward) ?? (mu.venues && mu.venues[0] ? mu.venues[0][0] : 900)
      const by = parseInt(f.birth, 10)
      const birth = isNaN(by) ? 1950 : by
      const u = {
        id: D.newUserId(code), name: f.name.trim(), kana: f.kana.trim(),
        sex: f.sex, sexLabel: f.sex === 'M' ? '男' : '女', birth,
        birthDate: f.birth.trim() || '—', age: D.CUR - birth,
        muni: mu.id, muniName: mu.name, region: mu.region,
        venueCode: code, venueName: ward, phone: '', careLevel: '',
        joined: D.CUR, isNew: true, walkIn: true, theta: 0, meas: {}, inbody: {}, kcl: {},
      }
      D.users.push(u)
      await createUserDoc(u)
      // 問診票(R7-03W)の読み取りは回答を保存して終了(測定値は記録用紙側で登録)
      if (e.kcl) {
        if (dbEnabled()) await commitKclRecognition({ batchId: e.batchId, recognitionId: e.recognitionId || e.id, user: u, answers: e.kcl.answers, year: D.CUR })
        const clean = {}
        Object.entries(e.kcl.answers || {}).forEach(([k, v]) => { if (v === 'yes' || v === 'no') clean[k] = v })
        u.kcl[D.CUR] = { raw: clean, date: null }
        await updateWalkin(e.id, { walkinStatus: 'committed', userId: u.id, userName: u.name })
        deleteSheetImage(e.storagePath).catch(() => {})
        if (!dbEnabled()) setEntries(prev => prev.map(x => x.id === e.id ? { ...x, walkinStatus: 'committed', userId: u.id, userName: u.name } : x))
        setOpenId('')
        set(s2 => ({ rev: s2.rev + 1 }))
        showToast(`仮登録して問診回答を取り込みました（ID ${u.id}）`)
        setBusy('')
        return
      }
      const finalValues = {}
      D.SHEET_COLS.forEach(cid => { finalValues[cid] = e.fields && e.fields[cid] ? e.fields[cid].value : null })
      if (dbEnabled()) {
        await commitRecognition({ batchId: e.batchId, recognitionId: e.recognitionId || e.id, user: u, finalValues, meta: { year: D.CUR } })
      }
      const nums = {}
      D.SHEET_COLS.forEach(cid => { nums[cid] = finalValues[cid] == null ? null : Math.round(parseFloat(finalValues[cid]) * 10) / 10 })
      await saveMeasurement(u.id, D.CUR, nums)
      await updateWalkin(e.id, { walkinStatus: 'committed', userId: u.id, userName: u.name })
      deleteSheetImage(e.storagePath).catch(() => {})
      if (!dbEnabled()) setEntries(prev => prev.map(x => x.id === e.id ? { ...x, walkinStatus: 'committed', userId: u.id, userName: u.name } : x))
      setOpenId('')
      set(s => ({ rev: s.rev + 1 }))
      showToast(`仮登録して測定値を取り込みました（ID ${u.id}）。結果用紙が出力できます`)
    } catch (err) { showToast('仮登録に失敗しました: ' + (err.message || '')) }
    setBusy('')
  }

  // 正式登録: walkIn フラグを外して利用者台帳へ
  const registerEntry = async (e) => {
    setBusy(e.id)
    try {
      const u = D.users.find(x => x.id === e.userId)
      if (u) u.walkIn = false
      await clearWalkInFlag(e.userId)
      await updateWalkin(e.id, { walkinStatus: 'registered' })
      if (!dbEnabled()) setEntries(prev => prev.map(x => x.id === e.id ? { ...x, walkinStatus: 'registered' } : x))
      set(s => ({ rev: s.rev + 1 }))
      showToast('利用者台帳に登録しました')
    } catch (err) { showToast('登録に失敗しました: ' + (err.message || '')) }
    setBusy('')
  }

  const resultSheet = (e) => set({ screen: 'pdf', pdfMode: 'single', pdfUser: e.userId })

  // エントリの削除(誤スキャン・重複・テスト読み取りの整理)。画像も削除する。
  // 仮登録済みの利用者データ(測定値・回答)は消さない — エントリ(受付キュー)のみ消える。
  const deleteEntry = async (e) => {
    const warn = e.walkinStatus === 'pending'
      ? 'この読み取りを削除しますか？\n（スキャン画像も削除され、元に戻せません）'
      : 'このエントリを一覧から削除しますか？\n（仮登録した利用者と測定データは残ります）'
    if (!window.confirm(warn)) return
    setBusy(e.id)
    try {
      await deleteWalkin(e.id)
      deleteSheetImage(e.storagePath).catch(() => {})
      if (!dbEnabled()) setEntries(prev => prev.filter(x => x.id !== e.id))
      if (openId === e.id) setOpenId('')
      showToast('エントリを削除しました')
    } catch (err) { showToast('削除に失敗しました: ' + (err.message || '')) }
    setBusy('')
  }

  const list = entries.filter(e => e.walkinStatus !== 'dismissed')
  const nPending = list.filter(e => e.walkinStatus === 'pending').length

  return (
    <div className="screen" style={{ maxWidth: 980 }}>
      <Card pad style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="walkin" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>当日受付 取り込み</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 2 }}>
            当日受付用の記録用紙・問診票（様式 R7-02W / R7-03W）のスキャン結果がここに届きます。仮登録 → 結果用紙出力 → 正式登録の順に進めます
          </div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>受付待ち <b className="t-num" style={{ fontSize: 18 }}>{nPending}</b> 件</div>
      </Card>

      {!dbEnabled() && (
        <Card pad style={{ fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.7 }}>
          デモ環境のためサンプル 1 件を表示しています。本番では、様式 R7-02W / R7-03W をアップロードすると自動でここに振り分けられます。
        </Card>
      )}

      {list.length === 0 && (
        <Card pad style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: 40 }}>
          当日受付の読み取りはまだありません。用紙作成の「当日受付用 記録用紙」（R7-02W / R7-03W）を印刷し、記入後にアップロードしてください。
        </Card>
      )}

      {list.map(e => {
        const [label, fg, bg] = CHIP[e.walkinStatus] || CHIP.pending
        return (
          <Card key={e.id} pad>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700 }}>
                  {e.userName || e.ocrName || '（氏名 読み取りなし）'}
                  {e.ocrKana ? <span style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 400, marginLeft: 8 }}>（{e.ocrKana}）</span> : null}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>読み取り元: {e.batchId}{e.userId ? ` · ID ${e.userId}` : ''}</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: fg, background: bg, borderRadius: 999, padding: '4px 12px' }}>{label}</span>
            </div>
            <div style={{ marginTop: 10 }}>{e.kcl ? <KclAnswerChips kcl={e.kcl} /> : <ValueSummary fields={e.fields} />}</div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {e.walkinStatus === 'pending' && openId !== e.id && (
                <button className="btn btn-primary" onClick={() => openForm(e)}>仮登録して取り込み</button>
              )}
              {(e.walkinStatus === 'committed' || e.walkinStatus === 'registered') && (
                <button className="btn" onClick={() => resultSheet(e)}>
                  <Icon name="pdf" size={15} strokeWidth={1.8} /> 結果用紙を出力
                </button>
              )}
              {e.walkinStatus === 'committed' && (
                <button className="btn btn-primary" disabled={busy === e.id} onClick={() => registerEntry(e)}>正式登録（台帳へ）</button>
              )}
              {e.walkinStatus === 'registered' && (
                <button className="btn" onClick={() => set({ screen: 'ros' })}>台帳で確認</button>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn btn-ghost" disabled={busy === e.id} onClick={() => deleteEntry(e)}
                style={{ color: 'var(--danger-700, #b91c1c)' }} title="このエントリを削除">
                削除
              </button>
            </div>

            {openId === e.id && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {/* 原本画像: 手書きの氏名を見ながら「誰の用紙か」を確かめられるようにする */}
                {imgs[e.id] && imgs[e.id] !== 'none' && (
                  <div style={{ flexShrink: 0 }}>
                    <img src={imgs[e.id]} alt="用紙の原本" onClick={() => setZoomImg(imgs[e.id])}
                      style={{ maxWidth: 250, maxHeight: 330, borderRadius: 8, border: '1px solid var(--border-subtle)', cursor: 'zoom-in', objectFit: 'contain', background: 'var(--bg-subtle)' }} />
                    <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 4, textAlign: 'center' }}>クリックで拡大（手書きの氏名を確認）</div>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 300 }}>
                {/* 紐づけ候補: 1 人の用紙は最大 3 枚届くため、2 枚目以降は打ち直さずワンクリックで同じ人に */}
                {(() => {
                  const cands = sameDayUsers(e)
                  const candIds = new Set(cands.map(u => u.id))
                  const qt = linkQ.trim().toLowerCase()
                  // 検索対象は台帳の利用者 + 本日仮登録した人(他日の仮登録中の人は誤紐づけ防止のため除く)
                  const found = qt ? D.users.filter(u => (!u.walkIn || candIds.has(u.id))
                    && (u.name.toLowerCase().includes(qt) || u.kana.toLowerCase().includes(qt) || String(u.id).includes(qt))).slice(0, 5) : []
                  return (
                    <div style={{ background: 'var(--brand-50)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>同じ人の別の用紙ではありませんか？</div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                        1 人の用紙は最大 3 枚（記録用紙・問診票おもて/うら）届きます。下のボタンで紐づければ氏名を打ち直す必要がなく、別人としての二重登録を防げます
                      </div>
                      {cands.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {cands.slice(0, 8).map(u => (
                            <button key={u.id} className="btn btn-sm" disabled={busy === e.id}
                              style={nameScore(e, u) >= 2 ? { borderColor: 'var(--brand-500)', color: 'var(--brand-700)', fontWeight: 700 } : {}}
                              onClick={() => commitToUser(e, u)}>
                              {u.name} さんとして取り込む{nameScore(e, u) >= 2 ? '（名前が一致）' : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      {cands.length === 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginTop: 6 }}>本日仮登録した人はまだいません（この用紙が 1 枚目なら下のフォームで仮登録してください）</div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input className="field" style={{ maxWidth: 240, height: 32, fontSize: 12.5 }}
                          placeholder="台帳から検索して紐づけ（氏名・ID）"
                          value={linkQ} onChange={(ev) => setLinkQ(ev.target.value)} />
                        {found.map(u => (
                          <button key={u.id} className="btn btn-sm" disabled={busy === e.id} onClick={() => commitToUser(e, u)}>
                            {u.name}（ID {u.id}）として取り込む
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>該当が無ければ、新しい人として仮登録:</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <div>
                  <div className="form-label">氏名（用紙の手書きを確認）</div>
                  <input className="field" value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />
                </div>
                <div>
                  <div className="form-label">ふりがな</div>
                  <input className="field" value={f.kana} onChange={(ev) => setF({ ...f, kana: ev.target.value })} />
                </div>
                <div>
                  <div className="form-label">性別</div>
                  <Select value={f.sex} onChange={(ev) => setF({ ...f, sex: ev.target.value })} options={[{ v: 'F', l: '女' }, { v: 'M', l: '男' }]} style={{ width: '100%' }} />
                </div>
                <div>
                  <div className="form-label">生年（西暦・任意）</div>
                  <input className="field t-num" value={f.birth} onChange={(ev) => setF({ ...f, birth: ev.target.value })} placeholder="例: 1948" />
                </div>
                <div>
                  <div className="form-label">{wardLabel()}</div>
                  <Select value={f.ward} onChange={(ev) => setF({ ...f, ward: ev.target.value })} options={wards.map(w => ({ v: w, l: w }))} style={{ width: '100%' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <button className="btn btn-primary" disabled={busy === e.id} onClick={() => commitEntry(e)}>この内容で仮登録</button>
                  <button className="btn" onClick={() => setOpenId('')}>閉じる</button>
                </div>
                </div>
                </div>
              </div>
            )}
          </Card>
        )
      })}

      {/* 原本画像の拡大表示 */}
      {zoomImg && (
        <div onClick={() => setZoomImg('')}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.82)', zIndex: 300, display: 'grid', placeItems: 'center', cursor: 'zoom-out', padding: 20 }}>
          <img src={zoomImg} alt="用紙の原本" style={{ maxWidth: '96vw', maxHeight: '94vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
