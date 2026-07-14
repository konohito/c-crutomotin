import D from '../data/engine.js'
import { useStore, sheetsAll } from '../store.jsx'
import { Card } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'
import IOSDevice from '../ui/IOSDevice.jsx'

const BASE = import.meta.env.BASE_URL

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

export default function Mobile() {
  const { state, set } = useStore()
  const all = sheetsAll()
  const sheet = all.length ? all[(state.mShots + state.mSent) % all.length] : null
  const sheetName = sheet ? (D.users.find(x => x.id === sheet.userId) || { name: sheet.ocrName }).name : '田中ミツヱ'
  const sheetRows = sheet ? [
    { label: '５ｍ通常歩行', val: sheet.fields.walk5.raw, unit: '秒/m' },
    { label: '開眼片足立ち 右', val: sheet.fields.balR.raw, unit: '秒' },
    { label: '開眼片足立ち 左', val: sheet.fields.balL.raw, unit: '秒' },
    { label: '握力 右 / 左', val: sheet.fields.gripR.raw + ' / ' + sheet.fields.gripL.raw, unit: 'kg' },
    { label: 'TUG', val: sheet.fields.tug.raw, unit: '秒' },
    { label: '身長 / 体重', val: sheet.fields.height.raw + ' / ' + sheet.fields.weight.raw, unit: '' },
  ] : []

  return (
    <div className="screen" style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, alignItems: 'start' }}>
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

      <div style={{ display: 'flex', justifyContent: 'center' }}>
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
