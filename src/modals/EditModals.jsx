import { useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { saveUserFields, saveMeasurement } from '../lib/realdata.js'
import { eraOf } from '../lib/helpers.js'
import { Modal, ModalHead, Select } from '../ui/kit.jsx'

const CARE_OPTS = [
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
    birthDate: u?.birthDate || '', muni: u?.muni || (D.MUNIS[0] && D.MUNIS[0].id) || '',
    venueName: u?.venueName || '', careLevel: u?.careLevel || '', phone: u?.phone || '',
  }))
  const [busy, setBusy] = useState(false)
  if (!u) return null
  const upd = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
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
        <Field label="市町村">
          <Select value={f.muni} onChange={upd('muni')} options={D.MUNIS.map(m => ({ v: m.id, l: m.name }))} style={{ width: '100%' }} />
        </Field>
        <Field label="行政区" hint="地区名（自由入力）">
          <input className="field" list="ward-list" value={f.venueName} onChange={upd('venueName')} />
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
    const v = (u && u.meas[em.year] && u.meas[em.year].values) || {}
    const o = {}; MEAS_FIELDS.forEach(([k]) => { o[k] = (v[k] == null ? '' : String(v[k])) }); return o
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
      await saveMeasurement(u.id, em.year, values)
      showToast(`${eraOf(em.year)}年度の測定値を保存しました`)
      set({ editMeas: null, rev: state.rev + 1 })
    } catch (e) { showToast('保存に失敗しました: ' + (e.message || '')); setBusy(false) }
  }
  return (
    <Modal onClose={close} width={440}>
      <ModalHead icon="sheet" iconBg="var(--brand-50)" iconFg="var(--brand-600)" title={`測定値を編集（${eraOf(em.year)}年度）`} sub={`${u.name} · ID ${u.id}`} onClose={close} />
      <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 20 }}>
        {MEAS_FIELDS.map(([k, label, unit]) => (
          <Field key={k} label={`${label}（${unit}）`}>
            <input className="field t-num" inputMode="decimal" value={f[k]} onChange={upd(k)} placeholder="—" />
          </Field>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', padding: '0 20px', lineHeight: 1.6 }}>BMI は身長・体重から自動計算されます。空欄は「未測定」として保存します。</div>
      <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 20px 20px' }}>
        <button className="btn btn-outline" onClick={close} disabled={busy}>キャンセル</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </Modal>
  )
}
