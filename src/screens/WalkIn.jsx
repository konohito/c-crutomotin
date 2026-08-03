import { useEffect, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { dbEnabled, wardLabel, watchWalkins, updateWalkin, clearWalkInFlag, commitRecognition, commitKclRecognition, deleteSheetImage } from '../lib/db.js'
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
    setF({ name: e.ocrName || '', kana: e.ocrKana || '', sex: 'F', birth: '', ward: wards[0] || '' })
  }

  // 仮登録して取り込み: 利用者作成(walkIn) + 測定値の本登録
  const commitEntry = async (e) => {
    if (!f.name.trim()) { showToast('氏名を入力してください'); return }
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
            </div>

            {openId === e.id && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
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
            )}
          </Card>
        )
      })}
    </div>
  )
}
