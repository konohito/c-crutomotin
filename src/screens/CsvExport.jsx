import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { eraOf, fmtD, frailtyOf, FRAIL_LEVELS } from '../lib/helpers.js'
import { kclScore, KCL_DOMAINS } from '../data/kihon.js'
import { Card, Select, CheckRow, Overline } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

// ---- 県報告用 CSV の列定義 -----------------------------------------------------
// 列構成は県の指定様式に合わせてここで調整する
const BASE_COLS = [
  ['年度', (u, y) => eraOf(y) + '年度'],
  ['圏域', (u) => u.region],
  ['市町村', (u) => u.muniName],
  ['会場', (u) => u.venueName],
  ['参加者ID', (u) => u.id],
  ['氏名', (u) => u.name],
  ['ふりがな', (u) => u.kana],
  ['性別', (u) => u.sexLabel],
  ['生年月日', (u) => u.birthDate],
  ['年齢', (u, y) => y - u.birth],
  ['測定日', (u, y, m) => m ? m.date : ''],
  ['５ｍ通常歩行(秒/m)', (u, y, m) => m ? fmtCsv(m.values.walk5, 1) : ''],
  ['開眼片足立ち右(秒)', (u, y, m) => m ? fmtCsv(m.values.balR, 1) : ''],
  ['開眼片足立ち左(秒)', (u, y, m) => m ? fmtCsv(m.values.balL, 1) : ''],
  ['握力右(kg)', (u, y, m) => m ? fmtCsv(m.values.gripR, 1) : ''],
  ['握力左(kg)', (u, y, m) => m ? fmtCsv(m.values.gripL, 1) : ''],
  ['TUG(秒)', (u, y, m) => m ? fmtCsv(m.values.tug, 1) : ''],
  ['身長(cm)', (u, y, m) => m ? fmtCsv(m.values.height, 1) : ''],
  ['体重(kg)', (u, y, m) => m ? fmtCsv(m.values.weight, 1) : ''],
  ['BMI', (u, y, m) => m ? fmtCsv(m.values.bmi, 1) : ''],
  ['総合スコア', (u, y, m) => m ? m.total : ''],
]
const FRAIL_COLS = [
  ['フレイル該当項目数', (u, y, m, fr) => fr ? fr.n : ''],
  ['フレイル判定', (u, y, m, fr) => fr ? FRAIL_LEVELS[fr.level].label : ''],
  ['フレイル該当項目', (u, y, m, fr) => fr ? fr.hitShorts.join('・') : ''],
]
const INBODY_COLS = [
  ['骨格筋量(kg)', (u, y, m, fr, ib) => ib ? fmtCsv(ib.smm, 1) : ''],
  ['体脂肪率(%)', (u, y, m, fr, ib) => ib ? fmtCsv(ib.fatPct, 1) : ''],
  ['SMI(kg/m2)', (u, y, m, fr, ib) => ib ? fmtCsv(ib.smi, 1) : ''],
  ['InBody点数', (u, y, m, fr, ib) => ib ? ib.score : ''],
]
const KCL_COLS = [
  ['基本CL合計点', (u, y, m, fr, ib, kc) => kc ? kc.total : ''],
  ['事業対象者判定', (u, y, m, fr, ib, kc) => kc ? (kc.target ? '該当' : '非該当') : ''],
  ['該当理由', (u, y, m, fr, ib, kc) => kc ? kc.reasons.map(r => r.label).join('・') : ''],
].concat(KCL_DOMAINS.map(d => [
  'CL_' + d.label, (u, y, m, fr, ib, kc) => kc ? kc.domainCounts[d.id] : '',
]))

function fmtCsv(v, dec) {
  return v === null || v === undefined ? '' : Number(v).toFixed(dec)
}
function esc(v) {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildExport(state) {
  const y = state.expYear
  const scope = state.expScope
  const inScope = (u) => {
    if (scope === 'all') return true
    if (scope.startsWith('region:')) return u.region === scope.slice(7)
    if (scope.startsWith('muni:')) return u.muni === scope.slice(5)
    return true
  }
  let users = D.users.filter(inScope)
  if (state.expMeasuredOnly) users = users.filter(u => u.meas[y])
  users = users.slice().sort((a, b) => a.id.localeCompare(b.id))
  const cols = BASE_COLS.concat(state.expFrail ? FRAIL_COLS : [], state.expKcl ? KCL_COLS : [], state.expInbody ? INBODY_COLS : [])
  const header = cols.map(c => c[0])
  const rows = users.map(u => {
    const m = u.meas[y] || null
    const fr = m ? frailtyOf(u, y) : null
    const ib = u.inbody && u.inbody[y] ? u.inbody[y] : null
    const kc = kclScore(u, y)
    return cols.map(c => c[1](u, y, m, fr, ib, kc))
  })
  return { header, rows, count: users.length }
}

export function scopeLabel(state) {
  if (state.expScope === 'all') return '全地域'
  if (state.expScope.startsWith('region:')) return state.expScope.slice(7)
  const mu = D.MUNIS.find(m => m.id === state.expScope.slice(5))
  return mu ? mu.name : '全地域'
}

export default function CsvExport() {
  const { state, set, showToast } = useStore()
  const { header, rows, count } = buildExport(state)

  const download = () => {
    const lines = [header, ...rows].map(r => r.map(esc).join(','))
    // BOM 付き UTF-8: Excel でそのまま文字化けせずに開ける
    const blob = new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `体力測定データ_${eraOf(state.expYear)}年度_${scopeLabel(state)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    showToast(`${count} 名分の CSV を出力しました（${eraOf(state.expYear)}年度 · ${scopeLabel(state)}）`)
  }

  const opt = (v, l) => ({ v, l })
  const scopeOpts = [opt('all', '全地域（すべての圏域・市町村）')]
    .concat(D.REGIONS.map(r => opt('region:' + r, '圏域: ' + r)))
    .concat(D.MUNIS.map(m => opt('muni:' + m.id, '市町村: ' + m.name)))

  const previewCols = Math.min(header.length, 12)

  return (
    <div className="screen" style={{ maxWidth: 980 }}>
      {/* 出力条件 */}
      <Card pad>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="csvout" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>県報告用 CSV 出力</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 2 }}>年度と地域を指定して、指定様式の CSV を出力します（BOM 付き UTF-8 · Excel 対応）</div>
          </div>
        </div>
        <div className="form-duo" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', gap: 14, marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">年度</div>
            <Select value={state.expYear} onChange={(e) => set({ expYear: Number(e.target.value) })}
              options={D.YEARS.slice().reverse().map(yy => opt(yy, eraOf(yy) + '年度（' + yy + '）'))} style={{ height: 40 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">対象地域</div>
            <Select value={state.expScope} onChange={(e) => set({ expScope: e.target.value })} options={scopeOpts} style={{ height: 40 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">対象者</div>
            <Select value={state.expMeasuredOnly ? 'measured' : 'everyone'} onChange={(e) => set({ expMeasuredOnly: e.target.value === 'measured' })}
              options={[opt('measured', '年度の測定済のみ'), opt('everyone', '登録者全員（未測定含む）')]} style={{ height: 40 }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12, flexWrap: 'wrap' }}>
          <Overline style={{ marginRight: 8 }}>追加の列</Overline>
          <CheckRow on={state.expFrail} label="フレイル簡易評価（該当数・判定・該当項目）" onClick={() => set({ expFrail: !state.expFrail })} />
          <CheckRow on={state.expKcl} label="基本チェックリスト（合計点・事業対象者判定・領域別）" onClick={() => set({ expKcl: !state.expKcl })} />
          <CheckRow on={state.expInbody} label="InBody（骨格筋量・体脂肪率・SMI・点数）" onClick={() => set({ expInbody: !state.expInbody })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            <span className="t-num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)' }}>{count}</span> 名 ·
            <span className="t-num" style={{ marginLeft: 4 }}>{header.length}</span> 列
            <span style={{ color: 'var(--fg-3)', marginLeft: 10, fontSize: 12 }}>体力測定データ_{eraOf(state.expYear)}年度_{scopeLabel(state)}.csv</span>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-lg" onClick={download} disabled={count === 0}>
            <Icon name="download" size={17} strokeWidth={1.8} />
            CSV をダウンロード
          </button>
        </div>
      </Card>

      {/* プレビュー */}
      <Card style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px 10px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div className="t-h4">プレビュー（先頭 8 行）</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{header.length > previewCols ? `全 ${header.length} 列中 ${previewCols} 列を表示` : `全 ${header.length} 列`}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                {header.slice(0, previewCols).map(h => (
                  <th key={h} style={{ padding: '7px 10px', background: 'var(--slate-25)', borderBottom: '1px solid var(--border-default)', borderRight: '1px solid var(--border-subtle)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>{h}</th>
                ))}
                {header.length > previewCols && <th style={{ padding: '7px 10px', background: 'var(--slate-25)', borderBottom: '1px solid var(--border-default)', color: 'var(--fg-4)', fontWeight: 500 }}>…</th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  {r.slice(0, previewCols).map((c, j) => (
                    <td key={j} className="t-num" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>{c}</td>
                  ))}
                  {header.length > previewCols && <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--fg-4)' }}>…</td>}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={previewCols} style={{ padding: '22px 10px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 12.5 }}>条件に一致するデータがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card pad>
        <div className="t-h4">様式について</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.8, marginTop: 8 }}>
          ・列構成は県の指定様式に合わせて調整できます（現在は 基本情報 + 測定 8 項目 + BMI + 総合スコア{state.expFrail ? ' + フレイル評価' : ''}{state.expInbody ? ' + InBody' : ''}）<br />
          ・未測定の項目は空欄で出力されます（欠測扱い）<br />
          ・BOM 付き UTF-8 のため Excel でダブルクリックしてもそのまま開けます。県のシステムが Shift_JIS 指定の場合は Excel の「名前を付けて保存」で変換してください
        </div>
      </Card>
    </div>
  )
}
