import { useEffect, useRef } from 'react'
import D from '../data/engine.js'
import { useStore, pendingSheets, sheetsAll, batchN, flagsFor, flaggedCols, needsReview, openSheetVals } from '../store.jsx'
import { fmtD } from '../lib/helpers.js'
import { Card, Pill } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const GRID = '42px 168px repeat(8, 1fr) 92px 88px'

export default function ImportScreen() {
  const { state, set, setState, showToast } = useStore()
  const scanT = useRef(null)
  const N = batchN()
  const shown = state.imp === 'idle' ? [] : sheetsAll().slice(0, state.imp === 'run' ? state.impCount : N)
  const pend = pendingSheets(state)

  useEffect(() => () => clearInterval(scanT.current), [])

  const startScan = () => {
    set({ imp: 'run', impCount: 0 })
    scanT.current = setInterval(() => {
      setState(s => {
        const n = s.impCount + 1
        if (n >= N) { clearInterval(scanT.current); return { ...s, impCount: n, imp: 'scanned' } }
        return { ...s, impCount: n }
      })
    }, 90)
  }

  const commitAll = () => {
    if (pendingSheets(state).length > 0) { showToast('要確認の用紙が残っています'); return }
    sheetsAll().forEach(sh => {
      const res = state.resolved[sh.no]
      let values = {}
      if (res) { values = res.values }
      else { D.SHEET_COLS.forEach(cid => { values[cid] = sh.fields[cid].raw === '' ? null : sh.fields[cid].value }) }
      D.commitSheet(res && res.userId ? { ...sh, userId: res.userId } : sh, values)
    })
    set(s => ({ imp: 'committed', rev: s.rev + 1 }))
    showToast(N + ' 件を本登録しました')
  }

  const openSheet = (no) => {
    const patch = openSheetVals(state, no)
    if (patch) set(patch)
  }

  return (
    <div className="screen">
      {/* バッチヘッダー */}
      <Card pad style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="imp" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{D.batchMeta.venue} — 令和7年度 測定会</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 2 }}>
            測定日 <span className="t-num">{D.batchMeta.date}</span> · 記録用紙 <span className="t-num">{N}</span> 枚 · モバイル撮影から受信済み
          </div>
        </div>
        {state.imp === 'idle' && (
          <button className="btn btn-primary" onClick={startScan}>読み取りを開始</button>
        )}
        {state.imp === 'run' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--brand-200)', borderTopColor: 'var(--brand-500)', animation: 'spin 700ms linear infinite' }} />
            <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>手書き数値を読み取り中 <span className="t-num" style={{ fontWeight: 600 }}>{state.impCount} / {N}</span></div>
          </div>
        )}
        {state.imp === 'scanned' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Pill lg bg="var(--success-50)" fg="var(--success-700)">自動判定 <span className="t-num" style={{ fontWeight: 600 }}>{shown.filter(sh => !needsReview(sh)).length}</span></Pill>
            <Pill lg bg="var(--warning-50)" fg="var(--warning-700)">要確認 <span className="t-num" style={{ fontWeight: 600 }}>{pend.length}</span></Pill>
            <button className={`btn${pend.length > 0 ? ' disabled' : ' btn-primary'}`} style={{ height: 36 }} onClick={commitAll}>本登録する</button>
          </div>
        )}
        {state.imp === 'committed' && (
          <Pill lg bg="var(--success-50)" fg="var(--success-700)" style={{ height: 28, padding: '0 12px', fontSize: 12.5 }}>
            <Icon name="check" size={14} strokeWidth={2} />
            {N} 件を本登録しました
          </Pill>
        )}
      </Card>

      {/* アイドル時のプレースホルダー */}
      {state.imp === 'idle' && (
        <div style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border-strong)', borderRadius: 12, padding: '44px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <svg width="88" height="60" viewBox="0 0 88 60" fill="none" aria-hidden="true">
            <rect x="27" y="4" width="34" height="52" rx="3" fill="var(--bg-surface)" stroke="var(--slate-300)" strokeWidth="2" />
            <path d="M34 14h20M34 21h20M34 28h12M34 46h14" stroke="var(--slate-200)" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 16V9a4 4 0 0 1 4-4h6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M76 16V9a4 4 0 0 0-4-4h-6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M12 44v7a4 4 0 0 0 4 4h6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M76 44v7a4 4 0 0 1-4 4h-6" stroke="var(--brand-300)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="16" y1="36" x2="72" y2="36" stroke="var(--brand-500)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 6" />
          </svg>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)' }}>受信済みの記録用紙 <span className="t-num">{N}</span> 枚が読み取りを待っています</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', textAlign: 'center', maxWidth: 480, lineHeight: 1.7 }}>
            「読み取りを開始」を押すと、Cloud Vision による手書き数値の認識が一括で実行されます。信頼度の低い読み取り結果は自動登録されず、確認の一覧に振り分けられます。
          </div>
        </div>
      )}

      {/* 読み取り結果テーブル */}
      {state.imp !== 'idle' && (
        <Card style={{ overflow: 'hidden' }}>
          <div className="tbl-head" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, padding: '0 12px', height: 40, alignItems: 'center' }}>
            <div className="t-overline">No</div>
            <div className="t-overline">氏名照合</div>
            {['5m歩行', '片足 右', '片足 左', '握力 右', '握力 左', 'TUG', '身長', '体重'].map(h => (
              <div key={h} className="t-overline" style={{ textAlign: 'right' }}>{h}</div>
            ))}
            <div className="t-overline" style={{ paddingLeft: 12 }}>状態</div>
            <div />
          </div>
          {shown.map(sh => {
            const res = state.resolved[sh.no]
            const flags = flagsFor(sh)
            const need = flags.length > 0 && !res
            const fcols = flaggedCols(sh)
            const nameFlag = flags.some(f => f.type === 'name')
            const u = D.users.find(x => x.id === ((res && res.userId) || sh.userId))
            let st
            if (need) st = ['要確認', 'var(--warning-50)', 'var(--warning-700)']
            else if (res) st = [state.imp === 'committed' ? '登録済' : '修正済', 'var(--success-50)', 'var(--success-700)']
            else st = [state.imp === 'committed' ? '登録済' : '自動判定', state.imp === 'committed' ? 'var(--success-50)' : 'var(--slate-100)', state.imp === 'committed' ? 'var(--success-700)' : 'var(--slate-600)']
            return (
              <div key={sh.no} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, padding: '5px 12px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', animation: 'rowIn 200ms var(--ease-standard)' }}>
                <div className="t-num" style={{ fontSize: 12, color: 'var(--fg-3)' }}>{sh.no}</div>
                <div style={{ minWidth: 0, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nameFlag && !res ? sh.ocrName : (u ? u.name : sh.ocrName)}
                  </div>
                  <div className="t-num" style={{ fontSize: 11, color: nameFlag && !res ? 'var(--danger-700)' : 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nameFlag && !res ? '照合エラー · 信頼度 ' + sh.nameConf + '%' : 'ID ' + ((res && res.userId) || sh.userId) + (res ? ' · 修正済' : ' · 照合 ' + sh.nameConf + '%')}
                  </div>
                </div>
                {D.SHEET_COLS.map(cid => {
                  const col = D.COLS.find(c => c.id === cid)
                  const f = sh.fields[cid]
                  let cell
                  if (res) {
                    const v = res.values[cid]
                    const fixed = fcols.has(cid)
                    cell = { raw: v === null ? '欠測' : fmtD(v, col.dec), bg: fixed ? 'var(--success-50)' : 'transparent', fg: fixed ? 'var(--success-700)' : (v === null ? 'var(--fg-4)' : 'var(--fg-1)'), bs: 'solid', bc: 'transparent' }
                  } else if (fcols.has(cid)) {
                    cell = { raw: f.raw === '' ? '—' : f.raw, bg: 'var(--warning-50)', fg: 'var(--warning-700)', bs: 'dashed', bc: 'var(--warning-500)' }
                  } else {
                    cell = { raw: f.raw, bg: 'transparent', fg: 'var(--fg-1)', bs: 'solid', bc: 'transparent' }
                  }
                  return (
                    <div key={cid} className="t-num" style={{ fontSize: 13, textAlign: 'right', padding: '5px 6px', borderRadius: 4, margin: '0 1px', background: cell.bg, color: cell.fg, border: `1px ${cell.bs} ${cell.bc}` }}>
                      {cell.raw}
                    </div>
                  )
                })}
                <div style={{ paddingLeft: 12 }}>
                  <Pill bg={st[1]} fg={st[2]}>{st[0]}</Pill>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {need && (
                    <button className="btn btn-outline btn-sm" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => openSheet(sh.no)}>確認する</button>
                  )}
                </div>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
