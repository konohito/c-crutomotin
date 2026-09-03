import { useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { saveUserFields, saveMeasurement, saveKclAnswers, moveMeasurementYear } from '../lib/realdata.js'
import { eraOf } from '../lib/helpers.js'
import { Modal, ModalHead, Select } from '../ui/kit.jsx'
import { kclSideList } from '../ui/kclanswers.jsx'

export const CARE_OPTS = [
  { v: '', l: '（自立・未設定）' }, { v: '要支援1', l: '要支援1' }, { v: '要支援2', l: '要支援2' },
  { v: '要介護1', l: '要介護1' }, { v: '要介護2', l: '要介護2' }, { v: '要介護3', l: '要介護3' },
]

function Field({ label, children, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>{hint}</span>}
    </label>
  )
}

// ---- 基本情報の編集 ----
export function EditUserModal() {
  const { state, set, showToast } = useStore()
  const u = D.users.find(x => x.id === state.editUser)
  const [f, setF] = useState(() => ({
    name: u?.name || '', kana: u?.kana || '', sex: u?.sex || 'F',
    birthDate: u?.birthDate || '', muniName: u?.muniName || '',
    venueName: u?.venueName || '', careLevel: u?.careLevel || '', phone: u?.phone || '',
  }))
  const [busy, setBusy] = useState(false)
  if (!u) return null
  const upd = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const munis = [...new Set(D.users.map(x => x.muniName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
  const wards = [...new Set(D.users.map(x => x.venueName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
  const close = () => set({ editUser: null })
  const save = async () => {
    setBusy(true)
    try {
      await saveUserFields(u.id, f)
      showToast('基本情報を保存しました')
      set({ editUser: null, rev: state.rev + 1 })
    } catch (e) { showToast('保存に失敗しました: ' + (e.message || '')) ; setBusy(false) }
  }
  return (
    <Modal onClose={close} width={460}>
      <ModalHead icon="ros" iconBg="var(--brand-50)" iconFg="var(--brand-600)" title="基本情報を編集" sub={`ID ${u.id}`} onClose={close} />
      <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 20 }}>
        <Field label="氏名"><input className="field" value={f.name} onChange={upd('name')} /></Field>
        <Field label="ふりがな"><input className="field" value={f.kana} onChange={upd('kana')} /></Field>
        <Field label="性別">
          <Select value={f.sex} onChange={upd('sex')} options={[{ v: 'F', l: '女' }, { v: 'M', l: '男' }]} style={{ width: '100%' }} />
        </Field>
        <Field label="生年月日" hint="例: 1947/07/30"><input className="field t-num" value={f.birthDate} onChange={upd('birthDate')} placeholder="YYYY/MM/DD" /></Field>
        <Field label="市町村" hint="新しい市町村名も入力できます">
          <input className="field" list="muni-list" value={f.muniName} onChange={upd('muniName')} placeholder="例: 嘉島町" />
          <datalist id="muni-list">{munis.map(m => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="行政区" hint="新しい地区名も入力できます">
          <input className="field" list="ward-list" value={f.venueName} onChange={upd('venueName')} placeholder="例: 上島" />
          <datalist id="ward-list">{wards.map(w => <option key={w} value={w} />)}</datalist>
        </Field>
        <Field label="介護度">
          <Select value={f.careLevel} onChange={upd('careLevel')} options={CARE_OPTS} style={{ width: '100%' }} />
        </Field>
        <Field label="電話番号"><input className="field t-num" value={f.phone} onChange={upd('phone')} /></Field>
      </div>
      <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 20px' }}>
        <button className="btn btn-outline" onClick={close} disabled={busy}>キャンセル</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !f.name}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </Modal>
  )
}

// ---- 測定値の編集（1 年度分） ----
const MEAS_FIELDS = [
  ['walk5', '５ｍ通常歩行', '秒'], ['walk5max', '５ｍ最大歩行', '秒'],
  ['balR', '開眼片足立ち 右', '秒'], ['balL', '開眼片足立ち 左', '秒'],
  ['gripR', '握力 右', 'kg'], ['gripL', '握力 左', 'kg'],
  ['tug', 'TUG', '秒'], ['height', '身長', 'cm'], ['weight', '体重', 'kg'],
]
export function EditMeasModal() {
  const { state, set, showToast } = useStore()
  const em = state.editMeas
  const u = em && D.users.find(x => x.id === em.id)
  const [f, setF] = useState(() => {
    const m = (u && u.meas[em.year]) || {}
    const v = m.values || {}
    const o = { year: String(em.year), date: m.date || '' }
    MEAS_FIELDS.forEach(([k]) => { o[k] = (v[k] == null ? '' : String(v[k])) }); return o
  })
  const [busy, setBusy] = useState(false)
  if (!u) return null
  const upd = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const close = () => set({ editMeas: null })
  const save = async () => {
    setBusy(true)
    try {
      const values = {}
      MEAS_FIELDS.forEach(([k]) => { const x = f[k].trim(); values[k] = x === '' ? null : Math.round(parseFloat(x) * 100) / 100 })
      if (values.height && values.weight) values.bmi = Math.round((values.weight / Math.pow(values.height / 100, 2)) * 10) / 10
      // 評価年を変えた場合は記録一式(測定値・問診回答・InBody・評価日)を移してから保存する
      const newY = parseInt(f.year, 10) || em.year
      if (newY !== em.year) await moveMeasurementYear(u.id, em.year, newY)
      await saveMeasurement(u.id, newY, values, f.date)
      showToast(`${eraOf(newY)}年度の測定値を保存しました`)
      set({ editMeas: null, rev: state.rev + 1 })
    } catch (e) { showToast('保存に失敗しました: ' + (e.message || '')); setBusy(false) }
  }
  return (
    <Modal onClose={close} width={440}>
      <ModalHead icon="sheet" iconBg="var(--brand-50)" iconFg="var(--brand-600)" title={`測定値を編集（${eraOf(em.year)}年度）`} sub={`${u.name} · ID ${u.id}`} onClose={close} />
      <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 20 }}>
        <Field label="評価年（年度）" hint="変えると記録一式が移ります">
          <Select value={f.year} onChange={upd('year')} options={D.YEARS.map(y => ({ v: String(y), l: eraOf(y) + '年度' }))} style={{ width: '100%' }} />
        </Field>
        <Field label="評価日" hint="例: 2025/09/02"><input className="field t-num" value={f.date} onChange={upd('date')} placeholder="YYYY/MM/DD" /></Field>
        {MEAS_FIELDS.map(([k, label, unit]) => (
          <Field key={k} label={`${label}（${unit}）`}>
            <input className="field t-num" inputMode="decimal" value={f[k]} onChange={upd(k)} placeholder="—" />
          </Field>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', padding: '0 20px', lineHeight: 1.6 }}>BMI は身長・体重から自動計算されます。空欄は「未測定」として保存します。評価年を変えた場合、この年度の問診回答・InBody・評価日もまとめて移動します（移動先に既にデータがある年度へは移せません）。</div>
      <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 20px 20px' }}>
        <button className="btn btn-outline" onClick={close} disabled={busy}>キャンセル</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </Modal>
  )
}

// ---- 基本チェックリスト回答の編集（1 年度分） ----
// 読み取りミスのまま本登録した「はい/いいえ」を、個人ページから後追いで訂正するためのモーダル。
export function EditKclModal() {
  const { state, set, showToast } = useStore()
  const ek = state.editKcl
  const u = ek && D.users.find(x => x.id === ek.id)
  const years = u ? Object.keys(u.kcl || {}).map(Number).sort((a, b) => b - a) : []
  const initFor = (uu, yy) => {
    const raw = (((uu || {}).kcl || {})[yy] || {}).raw || {}
    const o = {}
    kclSideList().forEach(q => { const v = raw[q.no]; o[q.no] = (v === 'yes' || v === 'no') ? v : null })
    return o
  }
  const dateFor = (uu, yy) => ((((uu || {}).kcl || {})[yy] || {}).date) || ''
  const [y, setY] = useState(() => (ek && ek.year) || years[0] || D.CUR)
  const [ans, setAns] = useState(() => initFor(u, (ek && ek.year) || years[0] || D.CUR))
  const [dt, setDt] = useState(() => dateFor(u, (ek && ek.year) || years[0] || D.CUR))
  const [busy, setBusy] = useState(false)
  if (!u) return null
  const changeYear = (e) => { const ny = +e.target.value; setY(ny); setAns(initFor(u, ny)); setDt(dateFor(u, ny)) }
  const close = () => set({ editKcl: null })
  const save = async () => {
    setBusy(true)
    try {
      await saveKclAnswers(u.id, y, ans, dt)
      showToast(`${eraOf(y)}年度の問診回答を保存しました`)
      set({ editKcl: null, rev: state.rev + 1 })
    } catch (e2) { showToast('保存に失敗しました: ' + (e2.message || '')); setBusy(false) }
  }
  return (
    <Modal onClose={close} width={560}>
      <ModalHead icon="sheet" iconBg="var(--brand-50)" iconFg="var(--brand-600)" title="基本チェックリスト回答を編集" sub={`${u.name} · ID ${u.id}`} onClose={close} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>年度</span>
        <Select value={String(y)} onChange={changeYear}
          options={[...new Set(D.YEARS.concat(years).concat([y]))].sort((a, b) => b - a).map(yy => ({ v: String(yy), l: eraOf(yy) + '年度' }))} />
        <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600, marginLeft: 4 }}>評価日</span>
        <input className="field t-num" style={{ width: 120, height: 32, fontSize: 12.5 }} value={dt}
          onChange={(e) => setDt(e.target.value)} placeholder="YYYY/MM/DD" />
        <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>番号は用紙の印刷どおり（おもて①〜⑬・うら⑭〜㉔・運動習慣）</span>
      </div>
      <div className="modal-body" style={{ padding: '12px 20px 4px', maxHeight: '58vh', overflowY: 'auto' }}>
        {kclSideList().map(({ no, paper, text }) => {
          const v = ans[no] ?? null
          const seg = (val, lb) => (
            <button key={lb} onClick={() => setAns(prev => ({ ...prev, [no]: val }))}
              style={{ height: 26, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${v === val ? 'var(--brand-500)' : 'var(--border-default)'}`,
                background: v === val ? 'var(--brand-50)' : 'var(--bg-surface)',
                color: v === val ? 'var(--brand-700)' : 'var(--fg-2)' }}>{lb}</button>
          )
          return (
            <div key={no} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span className="t-num" title={no.startsWith('ex') ? '' : `公式 No.${no}`} style={{ fontSize: 12.5, fontWeight: 700 }}>{paper}</span>
              <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>{text}</span>
              <span style={{ display: 'flex', gap: 4 }}>{seg('yes', 'はい')}{seg('no', 'いいえ')}{seg(null, '未回答')}</span>
            </div>
          )
        })}
        <div style={{ fontSize: 11, color: 'var(--fg-4)', padding: '8px 0 4px', lineHeight: 1.6 }}>
          公式 No.12「BMIが18.5未満ですか」は本人が回答する設問ではないため一覧になく、身長・体重の測定値から自動で採点されます。
        </div>
      </div>
      <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 20px' }}>
        <button className="btn btn-outline" onClick={close} disabled={busy}>キャンセル</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </Modal>
  )
}
