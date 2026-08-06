import { useEffect, useState } from 'react'
import D from '../data/engine.js'
import { kclScore } from '../data/kihon.js'
import { INTERESTS, MOODS, todayStr } from '../lib/techo.js'
import { Overline } from './kit.jsx'

/* 電子手帳の中身(画面表示)。職員の「手帳一覧」と利用者ポータルの両方から使う共有ビュー。
   - 私の目標・興味関心(編集可)
   - 今日の体調チェック・活動記録の追加フォーム + 記録一覧
   - 私のからだの記録(体力測定・基本チェックリストの年度別表) */

const num = (v) => (v === '' || v === null || v === undefined ? null : +v)
const CELL = { padding: '7px 10px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }

// 直近 3 回分の測定結果 + 基本チェックリスト点数
function BodyTable({ u }) {
  const ys = Object.keys(u.meas || {}).map(Number).sort((a, b) => a - b).slice(-3)
  if (!ys.length) return <div style={{ fontSize: 12.5, color: 'var(--fg-3)', padding: '4px 0' }}>体力測定の記録はまだありません。測定会に参加すると、ここに結果が表示されます。</div>
  const items = D.SHEET_COLS.map(cid => D.COLS.find(c => c.id === cid))
  const rows = items.map(col => [col.label + '（' + col.unit + '）', (y) => u.meas[y] ? D.fmt(u.meas[y].values[col.id], col.dec) : ''])
    .concat([
      ['BMI', (y) => u.meas[y] ? D.fmt(u.meas[y].values.bmi, 1) : ''],
      ['総合スコア', (y) => u.meas[y] ? u.meas[y].total + ' 点' : ''],
      ['基本チェックリスト', (y) => { const sc = kclScore(u, y); return sc ? sc.total + ' 点' : '—' }],
    ])
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `minmax(130px, 1.4fr) repeat(${ys.length}, 1fr)` }}>
        <div style={{ ...CELL, background: 'var(--bg-subtle)', fontWeight: 700, fontSize: 12 }}>測定項目</div>
        {ys.map(y => <div key={y} className="t-num" style={{ ...CELL, background: 'var(--bg-subtle)', fontWeight: 700, fontSize: 12, textAlign: 'center' }}>{D.ERA[y] || y}年度</div>)}
        {rows.map(([label, get], ri) => {
          const last = ri === rows.length - 1
          return [
            <div key={label} style={{ ...CELL, borderBottom: last ? 'none' : CELL.borderBottom, fontSize: 12.5, color: 'var(--fg-2)' }}>{label}</div>,
            ...ys.map(y => <div key={label + y} className="t-num" style={{ ...CELL, borderBottom: last ? 'none' : CELL.borderBottom, textAlign: 'center', fontWeight: 600 }}>{get(y) || '—'}</div>),
          ]
        })}
      </div>
    </div>
  )
}

export default function TechoBook({ u, techo, onSaveProfile, onAddLog, onDeleteLog, canAddLog = true, canDelete = false, compact = false }) {
  const [goal, setGoal] = useState('')
  const [ints, setInts] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const blank = { date: todayStr(), bpH: '', bpL: '', weight: '', sleep: '', meal: '', water: '', mood: '', steps: '', place: '', memo: '' }
  const [f, setF] = useState(blank)
  const [adding, setAdding] = useState(false)

  // 利用者の切替時と初回読込時のみ同期する(記録追加のたびに編集中の目標を消さないため)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setGoal((techo && techo.goal) || '')
    setInts((techo && techo.interests) || [])
    setDirty(false)
    setF(blank)
  }, [u.id, !techo])

  if (!techo) return <div style={{ padding: 24, color: 'var(--fg-3)', fontSize: 13 }}>手帳を読み込んでいます…</div>

  const setField = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const doSave = async () => {
    setSaving(true)
    try { await onSaveProfile({ goal, interests: ints }); setDirty(false) } finally { setSaving(false) }
  }
  const doAdd = async () => {
    if (adding) return
    setAdding(true)
    try {
      await onAddLog({
        date: f.date || todayStr(), bpH: num(f.bpH), bpL: num(f.bpL), weight: num(f.weight),
        sleep: num(f.sleep), meal: num(f.meal), water: num(f.water), mood: f.mood || '',
        steps: num(f.steps), place: f.place || '', memo: f.memo || '',
      })
      setF(s => ({ ...blank, date: s.date }))
    } finally { setAdding(false) }
  }
  const IN = { width: '100%', height: 34 }
  const lab = (t) => <span style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>{t}</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16 }}>
      {/* 目標・興味関心 */}
      <div className="card" style={{ padding: compact ? '14px 16px' : '16px 20px' }}>
        <Overline style={{ marginBottom: 8 }}>私の目標（なりたい姿）・興味関心</Overline>
        <textarea className="field" rows={2} value={goal} placeholder="例: 孫と旅行に行けるよう足腰を丈夫に保つ"
          onChange={(e) => { setGoal(e.target.value); setDirty(true) }} style={{ width: '100%', resize: 'vertical', lineHeight: 1.6 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {INTERESTS.map(t => {
            const on = ints.includes(t)
            return (
              <button key={t} className="chip" onClick={() => { setInts(s => on ? s.filter(x => x !== t) : [...s, t]); setDirty(true) }}
                style={{ height: 26, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--brand-500)' : 'var(--border-default)'), background: on ? 'var(--brand-50)' : 'transparent', color: on ? 'var(--brand-700)' : 'var(--fg-2)', fontWeight: on ? 700 : 400 }}>
                {t}
              </button>
            )
          })}
        </div>
        {dirty && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={doSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</button>
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>変更があります</span>
          </div>
        )}
      </div>

      {/* 今日の記録 */}
      {canAddLog && (
        <div className="card" style={{ padding: compact ? '14px 16px' : '16px 20px' }}>
          <Overline style={{ marginBottom: 10 }}>今日の体調チェック・活動記録</Overline>
          <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, gridColumn: compact ? 'span 3' : 'span 2' }}>{lab('日付')}
              <input className="field" style={IN} value={f.date} onChange={setField('date')} placeholder={todayStr()} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('血圧（上）')}
              <input className="field t-num" style={IN} inputMode="numeric" value={f.bpH} onChange={setField('bpH')} placeholder="128" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('血圧（下）')}
              <input className="field t-num" style={IN} inputMode="numeric" value={f.bpL} onChange={setField('bpL')} placeholder="76" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('体重（kg）')}
              <input className="field t-num" style={IN} inputMode="decimal" value={f.weight} onChange={setField('weight')} placeholder="52.5" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('歩数')}
              <input className="field t-num" style={IN} inputMode="numeric" value={f.steps} onChange={setField('steps')} placeholder="3000" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('睡眠（時間）')}
              <input className="field t-num" style={IN} inputMode="numeric" value={f.sleep} onChange={setField('sleep')} placeholder="7" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('食事（回）')}
              <input className="field t-num" style={IN} inputMode="numeric" value={f.meal} onChange={setField('meal')} placeholder="3" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('水分（杯）')}
              <input className="field t-num" style={IN} inputMode="numeric" value={f.water} onChange={setField('water')} placeholder="6" /></label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{lab('気分')}
              <div style={{ display: 'flex', gap: 4 }}>
                {MOODS.map(m => (
                  <button key={m} onClick={() => setF(s => ({ ...s, mood: s.mood === m ? '' : m }))}
                    style={{ flex: 1, height: 34, borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700, border: '1px solid ' + (f.mood === m ? 'var(--brand-500)' : 'var(--border-default)'), background: f.mood === m ? 'var(--brand-50)' : 'var(--bg-surface)', color: f.mood === m ? 'var(--brand-700)' : 'var(--fg-3)' }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, gridColumn: compact ? 'span 3' : 'span 2' }}>{lab('参加した場所・活動')}
              <input className="field" style={IN} value={f.place} onChange={setField('place')} placeholder="通いの場・散歩 など" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, gridColumn: compact ? 'span 3' : 'span 4' }}>{lab('メモ・気づき')}
              <input className="field" style={IN} value={f.memo} onChange={setField('memo')} placeholder="体調の変化など" /></label>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={doAdd} disabled={adding}>
            {adding ? '記録中…' : 'この内容で記録する'}
          </button>
        </div>
      )}

      {/* 記録一覧 */}
      <div className="card" style={{ padding: compact ? '14px 16px' : '16px 20px' }}>
        <Overline style={{ marginBottom: 8 }}>記録の一覧（新しい順）</Overline>
        {techo.logs.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', padding: '4px 0' }}>まだ記録がありません。上のフォームから今日の記録をつけましょう。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: compact ? 560 : 680 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `86px 64px 58px 44px 44px 44px 40px 60px 1fr${canDelete ? ' 30px' : ''}`, gap: 0, fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, borderBottom: '1px solid var(--border-default)', paddingBottom: 5 }}>
                <span>日付</span><span>血圧</span><span>体重</span><span>睡眠</span><span>食事</span><span>水分</span><span>気分</span><span>歩数</span><span>場所・メモ</span>{canDelete && <span />}
              </div>
              {techo.logs.map(l => (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: `86px 64px 58px 44px 44px 44px 40px 60px 1fr${canDelete ? ' 30px' : ''}`, alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', padding: '6px 0', fontSize: 12.5 }}>
                  <span className="t-num" style={{ fontWeight: 600 }}>{String(l.date || '').slice(5)}</span>
                  <span className="t-num">{l.bpH != null ? `${l.bpH}/${l.bpL != null ? l.bpL : '—'}` : '—'}</span>
                  <span className="t-num">{l.weight != null ? l.weight : '—'}</span>
                  <span className="t-num">{l.sleep != null ? l.sleep + 'h' : '—'}</span>
                  <span className="t-num">{l.meal != null ? l.meal + '回' : '—'}</span>
                  <span className="t-num">{l.water != null ? l.water + '杯' : '—'}</span>
                  <span style={{ fontWeight: 700, color: l.mood === '△' ? 'var(--warning-700)' : 'var(--brand-600)' }}>{l.mood || '—'}</span>
                  <span className="t-num">{l.steps != null ? l.steps : '—'}</span>
                  <span style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[l.place, l.memo].filter(Boolean).join(' · ') || '—'}</span>
                  {canDelete && (
                    <button className="btn btn-ghost btn-sm" title="この記録を削除" style={{ height: 24, padding: 0, justifyContent: 'center', color: 'var(--fg-3)' }} onClick={() => onDeleteLog(l.id)}>×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* からだの記録 */}
      <div className="card" style={{ padding: compact ? '14px 16px' : '16px 20px' }}>
        <Overline style={{ marginBottom: 8 }}>私のからだの記録（体力測定・基本チェックリスト）</Overline>
        <BodyTable u={u} />
      </div>
    </div>
  )
}
