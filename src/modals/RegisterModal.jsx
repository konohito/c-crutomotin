import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { createUserDoc } from '../lib/realdata.js'
import { wardLabel } from '../lib/db.js'
import { Modal, ModalHead, Select } from '../ui/kit.jsx'

const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))

function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-label">{label} {hint && <span className="opt-hint">{hint}</span>}</div>
      {children}
    </div>
  )
}

export default function RegisterModal() {
  const { state, set, showToast } = useStore()
  const close = () => set({ regOpen: false })

  // 実データでは市町村マスタが 1 件（嘉島町）に置き換わるため、初期値が見つからなくても先頭にフォールバック
  const mu = D.MUNIS.find(x => x.id === state.regMuni) || D.MUNIS[0]
  const wards = distinct(D.users.filter(u => u.muni === mu.id).map(u => u.venueName))

  const save = async () => {
    if (!state.regName.trim() || !state.regKana.trim()) { set({ regError: '氏名（漢字・かな）を入力してください' }); return }
    const ward = (state.regWard || '').trim()
    const matched = ward ? (mu.venues || []).find(v => v[1] === ward) : null
    const code = matched ? matched[0] : (mu.venues && mu.venues[0] ? mu.venues[0][0] : 900)
    const venueName = ward || (mu.venues && mu.venues[0] ? mu.venues[0][1] : '')
    const by = parseInt(state.regBirth, 10)
    const birth = isNaN(by) ? 1950 : by
    const u = {
      id: D.newUserId(code), name: state.regName.trim(), kana: state.regKana.trim(),
      sex: state.regSex, sexLabel: state.regSex === 'M' ? '男' : '女', birth,
      birthDate: state.regBirth.trim() || '—', age: D.CUR - birth,
      muni: mu.id, muniName: mu.name, region: mu.region,
      venueCode: code, venueName, phone: state.regPhone.trim(),
      joined: D.CUR, isNew: true, theta: 0, meas: {},
    }
    D.users.push(u)
    try { await createUserDoc(u) } catch (e) { showToast('保存に失敗しました: ' + (e.message || '')) }
    set(s => ({
      regOpen: false, regName: '', regKana: '', regBirth: '', regPhone: '', regWard: '',
      screen: 'ros', rosMuni: 'all', rosRegion: 'all', rosWard: 'all', rosStatus: 'new', rosSort: 'id', rosPage: 0,
      rev: s.rev + 1,
    }))
    showToast('利用者を登録しました')
  }

  const sexBtn = (on) => ({
    flex: 1, height: 40, borderRadius: 8,
    border: `1px solid ${on ? 'var(--brand-500)' : 'var(--border-default)'}`,
    background: on ? 'var(--brand-50)' : 'var(--bg-surface)',
    color: on ? 'var(--brand-700)' : 'var(--fg-2)',
    fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
    transition: 'all var(--dur-fast)',
  })

  return (
    <Modal onClose={close} width="min(520px, 94vw)">
      <ModalHead title="利用者の新規登録" sub={`参加者 ID は${wardLabel()}に応じて自動で採番されます`} onClose={close} />
      <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-duo" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="氏名（漢字）">
            <input className="field" value={state.regName} onChange={(e) => set({ regName: e.target.value })} placeholder="例: 山田花子" />
          </Field>
          <Field label="氏名（かな）">
            <input className="field" value={state.regKana} onChange={(e) => set({ regKana: e.target.value })} placeholder="例: ヤマダ ハナコ" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="生年月日">
            <input className="field t-num" value={state.regBirth} onChange={(e) => set({ regBirth: e.target.value })} placeholder="例: 1948/5/12" />
          </Field>
          <Field label="性別">
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={sexBtn(state.regSex === 'F')} onClick={() => set({ regSex: 'F' })}>女</button>
              <button style={sexBtn(state.regSex === 'M')} onClick={() => set({ regSex: 'M' })}>男</button>
            </div>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="市町村">
            <Select value={mu.id} onChange={(e) => set({ regMuni: e.target.value, regWard: '' })} options={D.MUNIS.map(m => ({ v: m.id, l: m.name }))} style={{ height: 40, fontSize: 13.5 }} />
          </Field>
          <Field label={wardLabel()} hint="(optional)">
            <input className="field" list="reg-ward-list" value={state.regWard} onChange={(e) => set({ regWard: e.target.value })} placeholder="例: 上島" />
            <datalist id="reg-ward-list">{wards.map(w => <option key={w} value={w} />)}</datalist>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="電話番号" hint="(optional)">
            <input className="field t-num" value={state.regPhone} onChange={(e) => set({ regPhone: e.target.value })} placeholder="例: 096-237-0000" />
          </Field>
        </div>
        {state.regError && (
          <div style={{ fontSize: 12, color: 'var(--danger-700)', background: 'var(--danger-50)', borderRadius: 8, padding: '8px 12px' }}>{state.regError}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          <button className="btn btn-outline" onClick={close}>キャンセル</button>
          <button className="btn btn-primary" onClick={save}>登録する</button>
        </div>
      </div>
    </Modal>
  )
}
