import { useState, useRef } from 'react'
import D from '../data/engine.js'
import { useStore, sheetsAll } from '../store.jsx'
import { dbEnabled, uploadSheetImage } from '../lib/db.js'
import { Card } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'
import IOSDevice from '../ui/IOSDevice.jsx'

const BASE = import.meta.env.BASE_URL

// 本番(実データ)は実際の一括アップロード画面、公開デモは従来のモックアップを表示する。
export default function Mobile() {
  return dbEnabled() ? <SheetUploader /> : <MobileDemo />
}

function Step({ n, title, desc }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div className="t-num" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--brand-50)', color: 'var(--brand-700)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{n}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 600 }}>{title}</span><br />
        <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>{desc}</span>
      </div>
    </div>
  )
}

function MobileDemo() {
  const { state, set } = useStore()
  const all = sheetsAll()
  const sheet = all.length ? all[(state.mShots + state.mSent) % all.length] : null
  const sheetName = sheet ? (D.users.find(x => x.id === sheet.userId) || { name: sheet.ocrName }).name : '田中ミツヱ'
  const sheetRows = sheet ? [
    { label: '５ｍ通常歩行', val: sheet.fields.walk5.raw, unit: '秒' },
    { label: '５ｍ最大歩行', val: sheet.fields.walk5max.raw, unit: '秒' },
    { label: '開眼片足立ち 右', val: sheet.fields.balR.raw, unit: '秒' },
    { label: '開眼片足立ち 左', val: sheet.fields.balL.raw, unit: '秒' },
    { label: '握力 右 / 左', val: sheet.fields.gripR.raw + ' / ' + sheet.fields.gripL.raw, unit: 'kg' },
    { label: 'TUG', val: sheet.fields.tug.raw, unit: '秒' },
    { label: '身長 / 体重', val: sheet.fields.height.raw + ' / ' + sheet.fields.weight.raw, unit: '' },
  ] : []

  return (
    <div className="screen mobile-grid" style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card style={{ padding: '20px 22px' }}>
          <div className="t-h4">現場スタッフ用 撮影アプリ</div>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.8, marginTop: 8 }}>
            測定会場で記録用紙を撮影すると、そのまま Cloud Storage へ送信され、読み取りキューに追加されます。会場での作業は撮影のみです。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
            <Step n={1} title="会場を選ぶ" desc="測定会の予定から会場を選択します" />
            <Step n={2} title="用紙をかざして連続撮影" desc="枠に合わせると自動で検出・台形補正されます" />
            <Step n={3} title="まとめて送信" desc="読み取りと照合は PC 側で自動実行されます" />
          </div>
        </Card>
        <Card style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--info-50)', color: 'var(--info-700)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="info" size={18} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>右のデモは操作できます。「撮影を開始」→ シャッター → 「送信」の順にお試しください。</div>
        </Card>
      </div>

      <div className="ios-zoom" style={{ display: 'flex', justifyContent: 'center' }}>
        <IOSDevice dark={state.mob === 'camera'}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--slate-50)', fontFamily: 'var(--font-sans)', overflow: 'hidden' }}>
            {/* ホーム */}
            {state.mob === 'home' && (
              <>
                <div style={{ background: 'linear-gradient(150deg, var(--brand-500), var(--brand-600))', padding: '54px 20px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={`${BASE}assets/logo-cruto-horizontal-white.png`} alt="Cruto" style={{ height: 24 }} />
                    <span className="t-display" style={{ fontSize: 12, color: '#fff', letterSpacing: '0.05em' }}>motion</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--brand-100)', marginTop: 12 }}>本日の測定会</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginTop: 2 }}>桜川市民体育館</div>
                  <div className="t-num" style={{ fontSize: 12, color: 'var(--brand-100)', marginTop: 2 }}>2025/09/24 · 受付 9:30〜</div>
                </div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                  <div style={{ background: '#fff', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>本日の撮影</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span className="t-num" style={{ fontSize: 26, fontWeight: 700 }}>{state.mShots}</span>
                        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>枚</span>
                      </div>
                    </div>
                    <div style={{ width: 1, background: 'var(--border-subtle)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>送信済み</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span className="t-num" style={{ fontSize: 26, fontWeight: 700 }}>{state.mSent}</span>
                        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>枚</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => set({ mob: 'camera' })}
                    style={{ height: 56, borderRadius: 12, border: 'none', background: 'var(--brand-500)', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: 'var(--shadow-sm)' }}
                  >
                    <Icon name="camera" size={20} strokeWidth={1.8} />
                    撮影を開始
                  </button>
                  <div style={{ background: '#fff', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '14px 16px' }}>
                    <div className="t-overline">撮影のコツ</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.8, marginTop: 6 }}>
                      ・用紙全体が枠に入るようにかざしてください<br />
                      ・影が数字にかからないようにしてください<br />
                      ・ブレても自動で再撮影を促します
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* カメラ */}
            {state.mob === 'camera' && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--slate-900)' }}>
                <div style={{ padding: '54px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => set({ mob: 'home' })} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'var(--slate-800)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }} aria-label="戻る">
                    <Icon name="chevL" size={16} strokeWidth={2} />
                  </button>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#fff' }}>桜川市民体育館</div>
                  <span className="t-num" style={{ height: 24, padding: '0 10px', borderRadius: 999, background: 'var(--slate-800)', color: '#fff', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{state.mShots} 枚</span>
                </div>
                <div style={{ flex: 1, position: 'relative', display: 'grid', placeItems: 'center', padding: '10px 18px' }}>
                  {/* 撮影中の用紙モック */}
                  <div style={{ width: 236, background: '#fff', padding: '14px 16px', transform: 'rotate(-1.2deg)', boxShadow: 'var(--shadow-lg)', position: 'relative' }}>
                    <div style={{ border: '2px solid var(--slate-800)', padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '2px solid var(--slate-800)', paddingBottom: 5 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>令和7年度 体力測定 記録用紙</div>
                        <div style={{ fontSize: 7, color: 'var(--slate-500)' }}>様式2</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, padding: '5px 0', borderBottom: '1px solid var(--slate-300)', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 8, color: 'var(--slate-500)' }}>氏名</span>
                        <span className="t-hand" style={{ fontSize: 13, color: 'var(--slate-800)' }}>{sheetName}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 8, color: 'var(--slate-500)' }}>ID</span>
                        <span className="t-hand" style={{ fontSize: 11, color: 'var(--slate-800)' }}>{sheet ? sheet.userId : '13093'}</span>
                      </div>
                      {sheetRows.map((sr, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'baseline', padding: '3.5px 0', borderBottom: '1px dotted var(--slate-300)' }}>
                          <span style={{ fontSize: 8.5, color: 'var(--slate-600)', flex: 1 }}>{sr.label}</span>
                          <span className="t-hand" style={{ fontSize: 13, color: 'var(--slate-800)' }}>{sr.val}</span>
                          <span style={{ fontSize: 7.5, color: 'var(--slate-400)', marginLeft: 3, width: 24 }}>{sr.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* ビューファインダー */}
                  <div style={{ position: 'absolute', left: 14, top: 8, width: 26, height: 26, borderLeft: '3px solid var(--brand-400)', borderTop: '3px solid var(--brand-400)', borderRadius: '2px 0 0 0' }} />
                  <div style={{ position: 'absolute', right: 14, top: 8, width: 26, height: 26, borderRight: '3px solid var(--brand-400)', borderTop: '3px solid var(--brand-400)' }} />
                  <div style={{ position: 'absolute', left: 14, bottom: 8, width: 26, height: 26, borderLeft: '3px solid var(--brand-400)', borderBottom: '3px solid var(--brand-400)' }} />
                  <div style={{ position: 'absolute', right: 14, bottom: 8, width: 26, height: 26, borderRight: '3px solid var(--brand-400)', borderBottom: '3px solid var(--brand-400)' }} />
                  <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 12px', borderRadius: 999, background: 'var(--success-500)', color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <Icon name="check" size={12} strokeWidth={2.5} />
                    用紙を検出 · 台形補正 ON
                  </div>
                </div>
                <div style={{ padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {state.mShots > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {Array.from({ length: Math.min(state.mShots, 4) }, (_, i) => (
                        <div key={i} style={{ width: 30, height: 40, borderRadius: 3, background: '#fff', border: '1px solid var(--slate-600)', display: 'grid', placeItems: 'center' }}>
                          <div style={{ width: 20, height: 2, background: 'var(--slate-300)', boxShadow: '0 5px 0 var(--slate-300), 0 10px 0 var(--slate-300), 0 -5px 0 var(--slate-300)' }} />
                        </div>
                      ))}
                      {state.mShots > 4 && <span className="t-num" style={{ fontSize: 11, color: 'var(--slate-300)', marginLeft: 4 }}>+{state.mShots - 4}</span>}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
                    <div />
                    <button
                      onClick={() => set(s => ({ mShots: Math.min(48, s.mShots + 1) }))}
                      title="シャッター"
                      style={{ width: 66, height: 66, borderRadius: '50%', border: '4px solid #fff', background: 'var(--brand-500)', cursor: 'pointer', boxShadow: 'var(--shadow-md)', transition: 'transform var(--dur-fast) var(--ease-spring)' }}
                      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)' }}
                      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {state.mShots > 0 && (
                        <button onClick={() => set(s => ({ mSent: s.mSent + s.mShots, mShots: 0, mob: 'done' }))}
                          style={{ height: 40, padding: '0 16px', borderRadius: 999, border: 'none', background: '#fff', color: 'var(--slate-900)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                          送信 <span className="t-num">{state.mShots}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 完了 */}
            {state.mob === 'done' && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, background: 'var(--slate-50)' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--success-50)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="check" size={34} strokeWidth={2} style={{ color: 'var(--success-500)' }} />
                </div>
                <div style={{ fontSize: 17, fontWeight: 700 }}><span className="t-num">{state.mSent}</span> 枚を送信しました</div>
                <div style={{ fontSize: 12.5, color: 'var(--fg-3)', textAlign: 'center', lineHeight: 1.7 }}>
                  読み取りと利用者照合は自動で実行されます。<br />結果は PC の「取り込み」画面でご確認ください。
                </div>
                <button onClick={() => set({ mob: 'home' })}
                  style={{ height: 44, padding: '0 24px', borderRadius: 999, border: '1px solid var(--border-default)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--fg-1)', cursor: 'pointer', marginTop: 8 }}>
                  ホームへ戻る
                </button>
              </div>
            )}
          </div>
        </IOSDevice>
      </div>
    </div>
  )
}

// ---- 本番: 記録用紙の一括アップロード（スマホ対応）----------------------------
// スマホのカメラ/写真から記録用紙を複数選んで Cloud Storage へアップロードすると、
// バックエンド(onSheetImageUpload)が Document AI で読み取り、PCの取り込み画面に並ぶ。
const pad2 = (n) => String(n).padStart(2, '0')
function newBatchId() {
  const d = new Date()
  const ymd = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
  return `${ymd}-${Math.random().toString(36).slice(2, 7)}`
}
const ST = {
  wait: { label: '未送信', bg: 'var(--slate-100)', fg: 'var(--fg-3)' },
  up: { label: '送信中', bg: 'var(--brand-50)', fg: 'var(--brand-700)' },
  done: { label: '完了', bg: 'var(--success-50)', fg: 'var(--success-700)' },
  err: { label: '失敗', bg: 'var(--danger-50)', fg: 'var(--danger-700)' },
}

function SheetUploader() {
  const { showToast } = useStore()
  const [batchId, setBatchId] = useState(newBatchId)
  const [label, setLabel] = useState('')
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const pickRef = useRef(null)
  const camRef = useRef(null)

  const addFiles = (fileList) => {
    const arr = Array.from(fileList || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|pdf)$/i.test(f.name))
    if (!arr.length) return
    setItems(prev => prev.concat(arr.map((f, i) => ({
      id: `${Date.now()}-${prev.length + i}-${Math.random().toString(36).slice(2, 6)}`,
      file: f, url: URL.createObjectURL(f), status: 'wait', err: '',
    }))))
  }
  const removeItem = (id) => setItems(prev => {
    const it = prev.find(x => x.id === id); if (it) URL.revokeObjectURL(it.url)
    return prev.filter(x => x.id !== id)
  })
  const startNew = () => {
    items.forEach(it => URL.revokeObjectURL(it.url))
    setItems([]); setLabel(''); setBatchId(newBatchId())
  }

  const uploadAll = async () => {
    if (busy) return
    setBusy(true)
    const pend = items.filter(it => it.status === 'wait' || it.status === 'err')
    let no = items.filter(it => it.status === 'done').length
    for (const it of pend) {
      no++
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, status: 'up', err: '' } : x))
      try {
        await uploadSheetImage(it.file, { batchId, no })
        setItems(prev => prev.map(x => x.id === it.id ? { ...x, status: 'done' } : x))
      } catch (e) {
        setItems(prev => prev.map(x => x.id === it.id ? { ...x, status: 'err', err: (e && e.message) || 'アップロードに失敗しました' } : x))
      }
    }
    setBusy(false)
    const failed = items.filter(it => it.status === 'err').length
    showToast(failed ? '一部の送信に失敗しました。再送してください' : 'アップロードが完了しました')
  }

  const doneN = items.filter(it => it.status === 'done').length
  const errN = items.filter(it => it.status === 'err').length
  const pendN = items.filter(it => it.status === 'wait' || it.status === 'err').length
  const today = new Date()
  const dateLabel = `${today.getFullYear()}/${pad2(today.getMonth() + 1)}/${pad2(today.getDate())}`

  return (
    <div className="screen" style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
      <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />

      {/* 見出し・セッション */}
      <Card pad>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="camera" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>記録用紙アップロード</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>撮影した記録用紙をまとめて送ると、自動で読み取ります</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>会場・{'行政区'}（任意メモ）</span>
            <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 上島公民館" />
          </label>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
            測定日 <span className="t-num">{dateLabel}</span> · セッション <span className="t-num">{batchId}</span>
          </div>
        </div>
      </Card>

      {/* 追加ボタン */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button className="btn btn-primary btn-lg" onClick={() => pickRef.current?.click()} disabled={busy} style={{ justifyContent: 'center' }}>
          <Icon name="upload" size={18} strokeWidth={1.8} /> 写真を選ぶ
        </button>
        <button className="btn btn-outline btn-lg" onClick={() => camRef.current?.click()} disabled={busy} style={{ justifyContent: 'center' }}>
          <Icon name="camera" size={18} strokeWidth={1.8} /> カメラで撮る
        </button>
      </div>

      {/* サムネイル一覧 */}
      {items.length === 0 ? (
        <Card pad>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 0', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--slate-50)', color: 'var(--slate-400)', display: 'grid', placeItems: 'center' }}>
              <Icon name="camera" size={26} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.7 }}>
              「写真を選ぶ」で複数枚まとめて選択、または「カメラで撮る」で 1 枚ずつ撮影できます。<br />1 枚 = 記録用紙 1 名分です。
            </div>
          </div>
        </Card>
      ) : (
        <Card pad>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="t-h4">選択中 <span className="t-num">{items.length}</span> 枚</div>
            <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>完了 {doneN}{errN ? ` · 失敗 ${errN}` : ''}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
            {items.map(it => (
              <div key={it.id} style={{ position: 'relative', aspectRatio: '3 / 4', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-default)', background: 'var(--slate-100)' }}>
                {/\.pdf$/i.test(it.file.name)
                  ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--slate-400)' }}><Icon name="file" size={26} /></div>
                  : <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                <div style={{ position: 'absolute', left: 4, bottom: 4, height: 18, padding: '0 6px', borderRadius: 999, background: ST[it.status].bg, color: ST[it.status].fg, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {it.status === 'done' && <Icon name="check" size={10} strokeWidth={3} />}
                  {it.status === 'err' && <Icon name="warn" size={10} />}
                  {ST[it.status].label}
                </div>
                {it.status !== 'up' && it.status !== 'done' && (
                  <button onClick={() => removeItem(it.id)} aria-label="削除"
                    style={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                    <Icon name="x" size={13} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 送信・完了 */}
      {items.length > 0 && (
        <Card pad>
          {pendN > 0 ? (
            <button className="btn btn-primary btn-lg" onClick={uploadAll} disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              <Icon name="upload" size={18} strokeWidth={1.8} />
              {busy ? '送信中…' : `${pendN} 枚をアップロード`}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success-700)', fontWeight: 700 }}>
                <Icon name="check" size={18} strokeWidth={2.4} /> {doneN} 枚を送信しました
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', lineHeight: 1.7 }}>
                読み取りと台帳照合は自動で行われます。結果は PC の「取り込み」画面でご確認ください。
              </div>
              <button className="btn btn-outline" onClick={startNew} style={{ marginTop: 4 }}>新しく撮影する</button>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 12, lineHeight: 1.6 }}>
            用紙全体が写るように明るい場所で撮影してください。1 枚ずつ別の用紙にしてください（1 枚 = 1 名分）。
          </div>
        </Card>
      )}
    </div>
  )
}
