import D from '../data/engine.js'
import { useStore, allMunis, EV_KINDS } from '../store.jsx'
import { mdw } from '../lib/helpers.js'
import { Modal, ModalHead, Select } from '../ui/kit.jsx'

function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-label">{label} {hint && <span className="opt-hint">{hint}</span>}</div>
      {children}
    </div>
  )
}

export default function EventModal() {
  const { state, set, setState, showToast } = useStore()
  const close = () => set({ evOpen: false })

  const save = () => {
    const m = String(state.evDate).match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/)
    if (!m) { showToast('日付は 2025/10/05 の形式で入力してください'); return }
    if (!state.evVenue.trim() && !state.evTitle.trim()) { showToast('タイトルまたは会場を入力してください'); return }
    const ds = m[1] + '/' + String(m[2]).padStart(2, '0') + '/' + String(m[3]).padStart(2, '0')
    let muniName = ''
    let customMunis = state.customMunis
    if (state.evMuni === '__new') {
      const nm = state.evNewMuni.trim()
      if (!nm) { showToast('市町村・地域名を入力してください'); return }
      const rg = state.evNewRegion.trim() || 'その他圏域'
      customMunis = customMunis.concat([{ id: '_c' + Date.now(), name: nm, region: rg, venues: [] }])
      muniName = nm
    } else {
      const muni = allMunis(state).find(x => x.id === state.evMuni)
      muniName = muni ? muni.name : ''
    }
    const ev = { date: ds, kind: state.evKind, title: state.evTitle.trim() || EV_KINDS[state.evKind][0], venue: state.evVenue.trim(), muni: muniName, time: state.evTime.trim(), staff: state.evStaff.slice() }
    setState(s => ({ ...s, customMunis, customEvents: s.customEvents.concat([ev]), evOpen: false, calY: +m[1], calM: +m[2] }))
    showToast('予定を登録しました')
  }

  return (
    <Modal onClose={close} width="min(460px, 94vw)">
      <ModalHead title="予定の登録" sub={mdw(state.evDate)} onClose={close} />
      <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="日付">
            <input className="field t-num" value={state.evDate} onChange={(e) => set({ evDate: e.target.value })} placeholder="2025/10/05" />
          </Field>
          <Field label="種別">
            <Select value={state.evKind} onChange={(e) => set({ evKind: e.target.value })}
              options={Object.keys(EV_KINDS).map(k => ({ v: k, l: EV_KINDS[k][0] }))} style={{ height: 40, fontSize: 13.5 }} />
          </Field>
        </div>
        <Field label="タイトル" hint="(optional)">
          <input className="field" value={state.evTitle} onChange={(e) => set({ evTitle: e.target.value })} placeholder="例: 秋の体力測定会" />
        </Field>
        <Field label="市町村（地域）">
          <Select value={state.evMuni} onChange={(e) => set({ evMuni: e.target.value })}
            options={allMunis(state).map(m => ({ v: m.id, l: m.name + '（' + m.region + '）' })).concat([{ v: '__new', l: '＋ 新しい地域を追加…' }])}
            style={{ height: 40, fontSize: 13.5 }} />
          {state.evMuni === '__new' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 2, padding: '10px 12px', borderRadius: 8, background: 'var(--brand-50)', border: '1px dashed var(--brand-300)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--fg-2)' }}>市町村名</div>
                <input className="field" style={{ height: 36, fontSize: 13 }} value={state.evNewMuni} onChange={(e) => set({ evNewMuni: e.target.value })} placeholder="例: 東雲町" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--fg-2)' }}>圏域（地域）</div>
                <input className="field" style={{ height: 36, fontSize: 13 }} value={state.evNewRegion} onChange={(e) => set({ evNewRegion: e.target.value })} placeholder="例: 東部圏域" />
              </div>
            </div>
          )}
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
          <Field label="会場">
            <input className="field" value={state.evVenue} onChange={(e) => set({ evVenue: e.target.value })} placeholder="例: 桜川市民体育館" />
          </Field>
          <Field label="時間">
            <input className="field t-num" value={state.evTime} onChange={(e) => set({ evTime: e.target.value })} placeholder="9:30〜11:30" />
          </Field>
        </div>
        <Field label="測定者" hint={<>スタッフマスタから選択 · <span className="t-num">{state.evStaff.length}</span> 名</>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {D.STAFF.map(st => {
              const sel = state.evStaff.includes(st.id)
              return (
                <button key={st.id}
                  onClick={() => set(s => ({ evStaff: sel ? s.evStaff.filter(x => x !== st.id) : s.evStaff.concat([st.id]) }))}
                  style={{
                    height: 30, padding: '0 11px', borderRadius: 999,
                    border: `1px solid ${sel ? 'var(--brand-500)' : 'var(--border-default)'}`,
                    background: sel ? 'var(--brand-50)' : 'var(--bg-surface)',
                    color: sel ? 'var(--brand-700)' : 'var(--fg-2)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                    transition: 'all var(--dur-fast)',
                  }}>
                  {st.name}
                  <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.65 }}>{st.role}</span>
                </button>
              )
            })}
          </div>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          <button className="btn btn-outline" onClick={close}>キャンセル</button>
          <button className="btn btn-primary" onClick={save}>登録する</button>
        </div>
      </div>
    </Modal>
  )
}
