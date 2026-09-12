import { useEffect, useMemo, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { dbEnabled, wardLabel } from '../lib/db.js'
import { duplicatePairs, mergePlan, mergeUsers, undoMerge, loadMergeLog, measCount, wardSummary, wardIssues, applyWardChange, undoWardChange, setMeasurementProgram, undoMeasurementProgram } from '../lib/merge.js'
import { useAuth } from '../ui/AuthGate.jsx'
import { Card, Overline, ConfirmModal } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

/* 重複の統合 — 同じ方が複数の利用者として登録されているケースをまとめる画面。

   なぜ必要か: 参加者 ID は「地区コード + 連番」で採番するため、同じ方でも地区が違えば別 ID になる。
   測定は利用者 ID に紐づくので、利用者が 2 件に分かれていると測定履歴も 2 本に分断される。

   流れ: ①候補の一覧（台帳全体を地区をまたいで突き合わせ） → ②2 件を並べて差分確認
        → ③統合（測定を付け替え → 件数確認 → 消す側をアーカイブ → 記録）
   消す側は削除しない。記録（merges）から いつでも元に戻せる。 */

const LEVEL = {
  same: ['ほぼ同一人物', 'var(--danger-700, #b91c1c)', 'var(--danger-50, #fef2f2)'],
  likely: ['要確認', 'var(--warn-600, #b45309)', 'var(--warn-50, #fef3c7)'],
}

const dashIf = (v) => (v === null || v === undefined || v === '' ? '—' : String(v))

function Person({ u, tag, tagBg, tagFg }) {
  return (
    <div style={{ flex: 1, minWidth: 250, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: tagFg, background: tagBg, borderRadius: 999, padding: '2px 9px' }}>{tag}</span>
        <span className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>ID {u.id}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{u.name}<span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--fg-3)', marginLeft: 6 }}>{u.kana}</span></div>
      <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4, lineHeight: 1.7 }}>
        {u.muniName} · {u.venueName || '（' + wardLabel() + 'なし）'}<br />
        {u.sexLabel} · {dashIf(u.birthDate)}<br />
        測定 <b className="t-num">{measCount(u)}</b> 件{u.walkIn ? ' · 当日受付の仮登録' : ''}
      </div>
    </div>
  )
}

function PairCard({ pair, by, onDone, onOpenDetail }) {
  const { showToast } = useStore()
  const [open, setOpen] = useState(false)
  const [swap, setSwap] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const keepId = swap ? pair.lose.id : pair.keep.id
  const loseId = swap ? pair.keep.id : pair.lose.id
  const plan = useMemo(() => mergePlan(keepId, loseId), [keepId, loseId, open, swap])
  const [label, fg, bg] = LEVEL[pair.level] || LEVEL.likely
  if (!plan) return null

  const run = async () => {
    setBusy(true)
    try {
      const log = await mergeUsers({ keepId, loseId, by })
      showToast(`${log.keepName} さん（ID ${log.keepId}）に統合しました。測定 ${log.movedCount} 件を付け替え、ID ${log.loseId} をアーカイブしました`)
      setConfirm(false)
      onDone()
    } catch (e) { showToast('統合に失敗しました: ' + (e.message || '')) }
    setBusy(false)
  }

  return (
    <Card pad>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: fg, background: bg, borderRadius: 999, padding: '3px 10px' }}>{label}</span>
        <div style={{ fontSize: 12.5, color: 'var(--fg-2)', flex: 1, minWidth: 180 }}>{pair.reasons.join(' · ')}</div>
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>{open ? '閉じる' : '並べて確認する'}</button>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Person u={plan.keep} tag="残す" tagFg="var(--brand-700)" tagBg="var(--brand-50)" />
        <Person u={plan.lose} tag="アーカイブ" tagFg="var(--fg-3)" tagBg="var(--slate-100)" />
      </div>

      {open && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
          {/* どちらを残すか */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5 }}>残す側は <b>{plan.keep.name}（ID {plan.keep.id}・測定 {plan.keepMeas} 件）</b>（測定件数の多い方が既定）</div>
            <button className="btn btn-sm" onClick={() => setSwap(!swap)}>残す側を入れ替える</button>
          </div>

          {/* 項目ごとの差分。どちらを消しても情報が欠けないかを見る */}
          <Overline style={{ marginBottom: 6 }}>項目ごとの違い</Overline>
          {plan.diff.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>基本情報に違いはありません</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', fontSize: 12.5, border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '6px 10px', background: 'var(--bg-subtle)', fontWeight: 700 }}>項目</div>
              <div style={{ padding: '6px 10px', background: 'var(--bg-subtle)', fontWeight: 700 }}>残す側 {plan.keep.id}</div>
              <div style={{ padding: '6px 10px', background: 'var(--bg-subtle)', fontWeight: 700 }}>アーカイブ {plan.lose.id}</div>
              {plan.diff.map(r => (
                <div key={r.key} style={{ display: 'contents' }}>
                  <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border-subtle)' }}>{r.label}</div>
                  <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border-subtle)' }}>{dashIf(r.keep)}</div>
                  <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border-subtle)', color: plan.fill[r.key] !== undefined ? 'var(--brand-700)' : 'var(--fg-2)' }}>
                    {dashIf(r.lose)}{plan.fill[r.key] !== undefined ? ' → 残す側へ補完' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          {Object.keys(plan.fill).length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--brand-700)', marginTop: 6 }}>
              残す側が空欄の項目（{Object.keys(plan.fill).join('・')}）はアーカイブ側から補完します。既に入っている値は上書きしません
            </div>
          )}

          {/* 統合後の測定履歴（時系列） */}
          <Overline style={{ margin: '14px 0 6px' }}>統合後の測定履歴（{plan.totalMeas} 件・時系列）</Overline>
          {plan.timeline.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>測定はありません</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {plan.timeline.map((r, i) => {
                // 測定値が入っていない記録（問診票だけ届いた等）は、統合後スコアに数えない
                const empty = !r.values || Object.values(r.values).every(v => v === null || v === undefined)
                return (
                  <div key={r.key || i} style={{ display: 'grid', gridTemplateColumns: '110px 70px 1fr 96px', gap: 8, fontSize: 12.5, padding: '5px 8px', borderRadius: 6, background: r.from === plan.lose.id ? 'var(--warn-50, #fef3c7)' : 'var(--bg-subtle)' }}>
                    <span className="t-num">{r.date || '（評価日なし）'}</span>
                    <span className="t-num" style={{ color: 'var(--fg-3)' }}>{r.year} 年度</span>
                    <span style={{ color: 'var(--fg-3)' }}>元 ID {r.from}{r.from === plan.lose.id ? '（付け替え）' : ''}</span>
                    <span className="t-num" style={{ textAlign: 'right', color: empty ? 'var(--fg-4)' : 'inherit' }}>
                      {empty ? '測定値なし' : (r.total ? r.total + ' 点' : '—')}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* 地区の扱い */}
          <Overline style={{ margin: '14px 0 6px' }}>{wardLabel()}の扱い</Overline>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.8, background: 'var(--bg-subtle)', borderRadius: 8, padding: '8px 12px' }}>
            統合後の所属（最新）: <b>{plan.nextCurrent.muniName} · {plan.nextCurrent.ward || '—'}</b><br />
            {plan.historyAdd.map((h, i) => (
              <span key={i}>
                履歴として保持: <b>{h.muniName} · {h.ward || '—'}</b>（測定 {h.dates.length} 件分：{h.dates.join('、') || '評価日なし'}）<br />
              </span>
            ))}
            行政提出の CSV・結果票は、この履歴を見て「その測定を行った当時の{wardLabel()}」で出力します。{wardLabel()}の情報は失われません
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!dbEnabled()} onClick={() => setConfirm(true)}>この 2 件を統合する</button>
            <button className="btn" onClick={() => onOpenDetail(plan.keep.id)}>残す側の個人ページを見る</button>
            <button className="btn" onClick={() => onOpenDetail(plan.lose.id)}>アーカイブ側の個人ページを見る</button>
          </div>
          {!dbEnabled() && <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6 }}>公開デモでは統合できません（実データ環境でのみ実行できます）</div>}
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title="この 2 件を統合します"
          confirmLabel="統合する" busy={busy}
          body={(
            <>
              {plan.lose.name} さん（ID {plan.lose.id}）の測定 <b>{plan.loseMeas} 件</b>を {plan.keep.name} さん（ID {plan.keep.id}）へ付け替え、ID {plan.lose.id} を台帳からアーカイブします。
              <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                <li>測定は削除しません（付け替えるだけ）</li>
                <li>ID {plan.lose.id} も削除しません（アーカイブ）</li>
                <li>{wardLabel()}「{plan.lose.muniName} {plan.lose.venueName || '—'}」は履歴として残ります</li>
                <li>「統合の記録」からいつでも元に戻せます</li>
              </ul>
            </>
          )}
          onConfirm={run} onClose={() => !busy && setConfirm(false)} />
      )}
    </Card>
  )
}

/* 地区（行政区）の整理。
   人の重複とは別に、同じ地区が 2 つの名前で並んでいたり（改称）、
   1 つの地区に複数の市町村が混ざっていたり（登録時の取り違え）することがある。 */
function WardTools({ by, onDone }) {
  const { showToast } = useStore()
  const issues = useMemo(() => wardIssues(D.users), [D.users.length, by])
  const sum = useMemo(() => wardSummary(D.users), [D.users.length, by])
  const [sel, setSel] = useState(null)      // { fromWards, toWard, muniName }
  const [busy, setBusy] = useState(false)
  // 「（C型）」付きの地区をまとめるときは、地区名から C型 が消えてしまうため、
  // 先にその団体の測定へ「短期集中予防サービス」の印を移す（既定 ON）
  const [keepC, setKeepC] = useState(true)
  const isCWard = (w) => /[（(]\s*C型\s*[)）]/.test(w || '')
  const munis = [...new Set(D.users.map(u => u.muniName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
  const regionOf = (mn) => (D.users.find(u => u.muniName === mn) || {}).region || ''
  const byWard = Object.fromEntries(sum.map(s => [s.ward, s]))

  const run = async () => {
    if (!sel || !sel.toWard) return
    const from = sel.fromWards.filter(Boolean)
    const affected = D.users.filter(u => from.includes(u.venueName))
    const cUsers = affected.filter(u => isCWard(u.venueName))
    const msg = `${from.join('・')} の ${affected.length} 名を「${sel.toWard}」にまとめます。\n`
      + (sel.muniName ? `市町村は「${sel.muniName}」に揃えます。\n` : '')
      + (cUsers.length && keepC ? `「（C型）」の ${cUsers.length} 名の測定に、短期集中予防サービスの印を付けてから地区名を変えます。\n` : '')
      + `\n・利用者も測定も削除しません（地区名だけ変えます）\n・旧い地区名は履歴として残ります\n・「統合の記録」から元に戻せます\n\n実行しますか？`
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      // 先に C型 の印を測定へ移す（地区名を変えると「（C型）」が消えるため、順番が大事）
      if (cUsers.length && keepC) {
        await setMeasurementProgram({
          userIds: cUsers.map(u => u.id), program: 'cType', by,
          note: `地区「${from.filter(isCWard).join('・')}」の統合にともなう引き継ぎ`,
        })
      }
      const log = await applyWardChange({
        fromWards: from, toWard: sel.toWard, mode: 'rename', by,
        muniName: sel.muniName || undefined, muni: sel.muniName || undefined,
        region: sel.muniName ? regionOf(sel.muniName) : undefined,
      })
      showToast(`${log.changedCount} 名の地区を「${sel.toWard}」にまとめました`)
      setSel(null)
      onDone()
    } catch (e) { showToast('地区の整理に失敗しました: ' + (e.message || '')) }
    setBusy(false)
  }

  return (
    <>
      <Overline style={{ margin: '16px 0 -4px' }}>{wardLabel()}の整理</Overline>
      <Card pad style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.8 }}>
        同じ地区が 2 つの名前で並んでいると（例: 名前が変わった団体）、台帳も提出用データも 2 つに割れてしまいます。
        ここでまとめると、地区名が 1 つに揃い、<b>旧い地区名は履歴として残ります</b>。利用者も測定も削除しません。
      </Card>

      {issues.length === 0 && (
        <Card pad style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: 30 }}>
          気になる{wardLabel()}は見つかりませんでした
        </Card>
      )}

      {issues.map((is, i) => (
        <Card pad key={i}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>
            {is.kind === 'rename' ? `名前の似た${wardLabel()}が ${is.wards.length} つあります（改称・分割かもしれません）` : `1 つの${wardLabel()}に複数の市町村が混ざっています`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
            {is.wards.map(w => (
              <div key={w.ward} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', gap: 8, padding: '5px 8px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>{w.ward}</span>
                <span className="t-num">{w.users.length} 名 / 測定 {w.meas} 件</span>
                <span style={{ color: Object.keys(w.munis).length > 1 ? 'var(--danger-700, #b91c1c)' : 'var(--fg-3)' }}>
                  {Object.entries(w.munis).map(([m, n]) => `${m} ${n}名`).join(' · ')}
                </span>
              </div>
            ))}
          </div>
          {is.kind === 'rename' && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5 }}>まとめ先の{wardLabel()}:</span>
              {is.wards.map(w => (
                <button key={w.ward} className="btn btn-sm"
                  style={sel && sel.toWard === w.ward ? { borderColor: 'var(--brand-500)', color: 'var(--brand-700)', fontWeight: 700 } : {}}
                  onClick={() => setSel({
                    toWard: w.ward,
                    fromWards: is.wards.map(x => x.ward).filter(x => x !== w.ward),
                    muniName: Object.entries(w.munis).sort((a, b) => b[1] - a[1])[0][0],
                  })}>{w.ward}</button>
              ))}
            </div>
          )}
          {sel && is.wards.some(w => w.ward === sel.toWard) && (
            <div style={{ marginTop: 10, border: '1px solid var(--brand-200, #ddd)', borderRadius: 8, padding: '10px 12px', background: 'var(--brand-50)' }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                <b>{sel.fromWards.join('・')}</b> の利用者を <b>{sel.toWard}</b> にまとめます
                （対象 <b className="t-num">{D.users.filter(u => sel.fromWards.includes(u.venueName)).length}</b> 名 ·
                測定 <b className="t-num">{D.users.filter(u => sel.fromWards.includes(u.venueName)).reduce((s, u) => s + measCount(u), 0)}</b> 件）
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ fontSize: 12.5 }}>市町村を揃える:</span>
                <select className="field" style={{ height: 32, fontSize: 12.5, width: 160 }}
                  value={sel.muniName} onChange={(e) => setSel({ ...sel, muniName: e.target.value })}>
                  <option value="">（変更しない）</option>
                  {munis.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                {sel.muniName && byWard[sel.toWard] && Object.keys(byWard[sel.toWard].munis).some(m => m !== sel.muniName) && (
                  <span style={{ fontSize: 11.5, color: 'var(--danger-700, #b91c1c)' }}>
                    ※ 市町村が変わる方がいます。提出用 CSV の出力先（市町村）も変わります
                  </span>
                )}
              </div>
              {sel.fromWards.some(isCWard) && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={keepC} onChange={(e) => setKeepC(e.target.checked)} style={{ marginTop: 3 }} />
                  <span style={{ fontSize: 12.5 }}>
                    <b>「（C型）」の情報を測定に引き継ぐ</b>（推奨）<br />
                    <span style={{ color: 'var(--fg-3)', fontSize: 11.5 }}>
                      地区名をまとめると「（C型）」の文字が消えます。外す前に、その団体の測定へ
                      「短期集中予防サービス」の印を付けておきます。市への報告で C型 として出すために必要です
                    </span>
                  </span>
                </label>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" disabled={busy || !dbEnabled()} onClick={run}>この内容でまとめる</button>
                <button className="btn btn-sm" onClick={() => setSel(null)}>やめる</button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </>
  )
}

export default function Merge() {
  const { state, set, showToast } = useStore()
  const { user, profile } = useAuth()
  const by = (profile && profile.name) || (user && (user.email || user.uid)) || '職員'
  const [log, setLog] = useState([])
  const [undoing, setUndoing] = useState('')
  const pairs = useMemo(() => duplicatePairs(D.users), [state.rev])

  const reload = () => {
    loadMergeLog().then(setLog).catch(() => setLog([]))
  }
  useEffect(() => { if (dbEnabled()) reload() }, [])

  const onDone = () => { set(s => ({ rev: s.rev + 1 })); reload() }
  const onOpenDetail = (id) => set({ screen: 'det', detId: id })

  const doUndo = async (l) => {
    const msg = l.kind === 'ward'
      ? `${l.changedCount} 名の${wardLabel()}を「${(l.fromWards || []).join('・')}」に戻しますか？`
      : l.kind === 'program'
        ? `測定 ${l.changedCount} 件の事業区分の印を外しますか？`
        : `ID ${l.loseId}（${l.loseName}）を元に戻しますか？\n測定 ${l.movedCount} 件を ID ${l.loseId} に戻し、台帳に復帰させます`
    if (!window.confirm(msg)) return
    setUndoing(l.mergeId)
    try {
      if (l.kind === 'ward') await undoWardChange(l)
      else if (l.kind === 'program') await undoMeasurementProgram(l)
      else await undoMerge(l)
      showToast('元に戻しました。画面を再読み込みすると台帳に反映されます')
      set(s => ({ rev: s.rev + 1 }))
      reload()
    } catch (e) { showToast('元に戻せませんでした: ' + (e.message || '')) }
    setUndoing('')
  }

  const same = pairs.filter(p => p.level === 'same')
  const likely = pairs.filter(p => p.level === 'likely')

  return (
    <div className="screen" style={{ maxWidth: 980 }}>
      <Card pad style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="merge" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>重複の確認・統合</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 2 }}>
            同じ方が複数の利用者として登録されていないかを、{wardLabel()}・市町村をまたいで台帳全体から探します
          </div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>候補 <b className="t-num" style={{ fontSize: 18 }}>{pairs.length}</b> 件</div>
      </Card>

      <Card pad style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.8 }}>
        参加者 ID は{wardLabel()}ごとに採番されるため、同じ方でも{wardLabel()}が違うと別の ID になります。
        測定は利用者 ID に紐づくので、利用者が 2 件に分かれていると<b>測定履歴も 2 本に分断され、推移が正しく見えません</b>。
        ここで統合すると履歴が 1 本につながります。<br />
        統合しても<b>何も削除しません</b>。測定は付け替えるだけ、アーカイブ側の利用者も残ります。下の「統合の記録」からいつでも元に戻せます。
      </Card>

      {pairs.length === 0 && (
        <Card pad style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: 40 }}>
          重複の候補は見つかりませんでした（台帳 {D.users.length} 名を突き合わせ）
        </Card>
      )}

      {same.length > 0 && <Overline style={{ margin: '4px 0 -4px' }}>ほぼ同一人物（{same.length} 件）</Overline>}
      {same.map(p => <PairCard key={p.id} pair={p} by={by} onDone={onDone} onOpenDetail={onOpenDetail} />)}
      {likely.length > 0 && <Overline style={{ margin: '10px 0 -4px' }}>要確認（{likely.length} 件）</Overline>}
      {likely.map(p => <PairCard key={p.id} pair={p} by={by} onDone={onDone} onOpenDetail={onOpenDetail} />)}

      <WardTools by={by} onDone={onDone} />

      {/* 操作ログ = 元に戻すための台帳 */}
      {dbEnabled() && (
        <>
          <Overline style={{ margin: '16px 0 -4px' }}>統合の記録</Overline>
          <Card pad>
            {log.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>統合の記録はまだありません</div>
            ) : log.map(l => (
              <div key={l.mergeId} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ flex: 1, minWidth: 240, fontSize: 12.5, lineHeight: 1.7 }}>
                  {l.kind === 'program' ? (
                    <>
                      <b>事業区分の記録</b>：{l.keepName} の印を測定 {l.changedCount} 件に付与（{(l.userIds || []).length} 名）<br />
                      <span style={{ color: 'var(--fg-3)' }}>{l.note || ''} · {String(l.at).slice(0, 16).replace('T', ' ')} · {l.by || '—'}</span>
                    </>
                  ) : l.kind === 'ward' ? (
                    <>
                      <b>{wardLabel()}の整理</b>：{(l.fromWards || []).join('・')} → <b>{l.toWard}</b>{l.muniName ? `（市町村を ${l.muniName} に）` : ''}<br />
                      <span style={{ color: 'var(--fg-3)' }}>{l.changedCount} 名の地区を変更 · {String(l.at).slice(0, 16).replace('T', ' ')} · {l.by || '—'}</span>
                    </>
                  ) : (
                    <>
                      <b>{l.loseName}</b>（ID {l.loseId} · {l.loseDistrict}） → <b>{l.keepName}</b>（ID {l.keepId} · {l.keepDistrict}）<br />
                      <span style={{ color: 'var(--fg-3)' }}>測定 {l.movedCount} 件を付け替え · {String(l.at).slice(0, 16).replace('T', ' ')} · {l.by || '—'}</span>
                    </>
                  )}
                </div>
                {l.status === 'merged'
                  ? <button className="btn btn-sm" disabled={undoing === l.mergeId} onClick={() => doUndo(l)}>元に戻す</button>
                  : <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>取り消し済み</span>}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
