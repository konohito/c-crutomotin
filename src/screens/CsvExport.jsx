import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { eraOf, frailtyOf, FRAIL_LEVELS, commentFor } from '../lib/helpers.js'
import { kclScore, KCL_QUESTIONS, KCL_DOMAINS } from '../data/kihon.js'
import { wardLabel, dbEnabled } from '../lib/db.js'
import { Card, Select, CheckRow, Overline, Segmented } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const distinctSort = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
// 対象地域スコープ（圏域/市町村）に属する利用者だけを返す。行政区の選択肢作成にも使う。
const inScopeArea = (u, scope) => {
  if (scope === 'all') return true
  if (scope.startsWith('region:')) return u.region === scope.slice(7)
  if (scope.startsWith('muni:')) return u.muni === scope.slice(5)
  return true
}

// ---- 県報告用 CSV の列定義 -----------------------------------------------------
// 列構成は県の指定様式に合わせてここで調整する
const BASE_COLS = [
  ['年度', (u, y) => eraOf(y) + '年度'],
  ['圏域', (u) => u.region],
  ['市町村', (u) => u.muniName],
  [wardLabel(), (u) => u.venueName],
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

// ---- 行政提出書式（ファイルメーカー取込形式・79 列）------------------------------
// 提出様式の列名・列順に完全一致させる。分類1〜7 = 領域別該当数、分類8 = No.1〜20 の合計。
// 「通常5m」は所要秒（測定値 秒/m × 5m）、片脚立位・握力は左右の良い方の値で出力する。
const hira = (kana) => String(kana || '').replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/[\s　]/g, '')
const regionCode = (u) => String((D.REGIONS.indexOf(u.region) + 1) * 10)
const muniCode = (u) => String(D.MUNIS.findIndex(mu => mu.id === u.muni) + 1).padStart(2, '0')
// 実データの介護度（careLevel）を優先。無ければ従来の推定にフォールバック。
const careLevel = (u) => (u.careLevel && u.careLevel !== '自立')
  ? u.careLevel
  : (u.theta < -1.7 ? '要支援2' : u.theta < -1.3 ? '要支援1' : 'なし')
const bestOf = (a, b) => (a === null || a === undefined ? b : (b === null || b === undefined ? a : Math.max(a, b)))
function ageAt(u, y, m) {
  // 評価日時点の満年齢（誕生日前後を考慮。日付が読めない場合は年度差で代用）
  const b = String(u.birthDate || '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  const d = m && String(m.date).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (!b || !d) return y - u.birth
  let age = +d[1] - +b[1]
  if (+d[2] < +b[2] || (+d[2] === +b[2] && +d[3] < +b[3])) age--
  return age
}
function prevMeas(u, y) {
  const ys = Object.keys(u.meas).map(Number).filter(x => x < y).sort((a, b) => b - a)
  return ys.length ? u.meas[ys[0]] : null
}
const GOV_COLS = [
  ['年度', (u, y) => y],
  ['ID', (u) => u.id],
  ['個人管理台帳::氏名', (u) => u.name],
  ['個人管理台帳::ふりがな', (u) => hira(u.kana)],
  ['性別', (u) => u.sexLabel],
  ['個人管理台帳::生年月日', (u) => u.birthDate],
  ['評価開始時年齢', (u, y, m) => ageAt(u, y, m)],
  ['個人管理台帳::圏域コード', (u) => regionCode(u)],
  ['個人管理台帳::市町村コード', (u) => muniCode(u)],
  ['個人管理台帳::地区コード', (u) => regionCode(u) + muniCode(u)],
  ['個人管理台帳::市町村名', (u) => u.muniName],
  ['個人管理台帳::地区所属団体', (u) => u.venueName],
  ['身長', (u, y, m) => m ? fmtCsv(m.values.height, 1) : ''],
  ['体重', (u, y, m) => m ? fmtCsv(m.values.weight, 1) : ''],
  ['BMI', (u, y, m) => m ? fmtCsv(m.values.bmi, 1) : ''],
  ['要介護度', (u) => careLevel(u)],
  ['新総合事業', () => '一般介護予防'],
  ['新総合事業_その他', () => ''],
  ['担当者', () => 'Cruto'],
]
KCL_QUESTIONS.forEach(q => {
  GOV_COLS.push(['基本チェックリスト' + q.no, (u, y, m, fr, ib, kc) => (kc ? kc.points[q.no] : '')])
})
KCL_DOMAINS.forEach((d, i) => {
  GOV_COLS.push(['基本チェックリスト分類' + (i + 1), (u, y, m, fr, ib, kc) => (kc ? kc.domainCounts[d.id] : '')])
})
GOV_COLS.push(
  ['基本チェックリスト分類8', (u, y, m, fr, ib, kc) => {
    if (!kc) return ''
    let s = 0
    for (let n = 1; n <= 20; n++) s += kc.points[n] || 0
    return s
  }],
  ['評価日_開始時', (u, y, m) => m ? m.date : ''],
  ['評価日_終了時', () => ''],
  ['測定者', (u, y, m) => (m && !dbEnabled()) ? D.STAFF[u.venueCode % D.STAFF.length].name : ''],
  ['訓練方法', (u, y, m) => m ? '集団' : ''],
  ['自己訓練有無', () => ''],
  ['補装具_開始時', (u, y, m) => m ? (u.note && u.note.includes('杖') ? '杖' : 'なし') : ''],
  ['補装具その他_開始時', () => ''],
  ['補装具_終了時', () => ''],
  ['補装具その他_終了時', () => ''],
  ['開眼片脚立位時間_開始時', (u, y, m) => m ? fmtCsv(bestOf(m.values.balR, m.values.balL), 1) : ''],
  ['開眼片脚立位時間_終了時', () => ''],
  ['TUG_開始時', (u, y, m) => m ? fmtCsv(m.values.tug, 1) : ''],
  ['TUG_終了時', () => ''],
  ['通常5m_開始時', (u, y, m) => (m && m.values.walk5 !== null && m.values.walk5 !== undefined) ? fmtCsv(m.values.walk5 * 5, 1) : ''],
  ['通常5m_終了時', () => ''],
  ['最大5m_開始時', () => ''],
  ['最大5m_終了時', () => ''],
  ['握力_開始時', (u, y, m) => m ? fmtCsv(bestOf(m.values.gripR, m.values.gripL), 1) : ''],
  ['握力_終了時', () => ''],
  ['MNA_開始時', () => ''],
  ['MNA_終了時', () => ''],
  ['SWEET_開始時', () => ''],
  ['SWEET_終了時', () => ''],
  ['開始時コメント', (u, y, m) => m ? commentFor(u, m, prevMeas(u, y)) : ''],
  ['終了時コメント', () => ''],
  ['目標', () => ''],
  ['自由記載', (u) => u.note || ''],
)

export function buildExport(state) {
  const y = state.expYear
  const scope = state.expScope
  const ward = state.expWard || 'all'
  const inScope = (u) => inScopeArea(u, scope) && (ward === 'all' || u.venueName === ward)
  let users = D.users.filter(inScope)
  if (state.expMeasuredOnly) users = users.filter(u => u.meas[y])
  users = users.slice().sort((a, b) => a.id.localeCompare(b.id))
  const cols = state.expFormat === 'gov'
    ? GOV_COLS
    : BASE_COLS.concat(state.expFrail ? FRAIL_COLS : [], state.expKcl ? KCL_COLS : [], state.expInbody ? INBODY_COLS : [])
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
  const ward = state.expWard && state.expWard !== 'all' ? ' · ' + state.expWard : ''
  if (state.expScope === 'all') return '全地域' + ward
  if (state.expScope.startsWith('region:')) return state.expScope.slice(7) + ward
  const mu = D.MUNIS.find(m => m.id === state.expScope.slice(5))
  return (mu ? mu.name : '全地域') + ward
}

export function fileNameOf(state) {
  const base = state.expFormat === 'gov' ? '行政提出用データ' : '体力測定データ'
  return `${base}_${eraOf(state.expYear)}年度_${scopeLabel(state)}.csv`
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
    a.download = fileNameOf(state)
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
  // 選択中の地域スコープに属する行政区の選択肢
  const scopeWards = distinctSort(D.users.filter(u => inScopeArea(u, state.expScope)).map(u => u.venueName))
  const expWard = state.expWard || 'all'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <Overline>書式</Overline>
          <Segmented value={state.expFormat} onChange={(v) => set({ expFormat: v })}
            options={[{ v: 'std', l: '標準形式（集計・確認用）' }, { v: 'gov', l: '行政提出書式（79 列）' }]} />
          {state.expFormat === 'gov' && (
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>ファイルメーカー取込形式 — 列名・列順は提出様式と同一です</span>
          )}
        </div>
        <div className="form-duo" style={{ display: 'grid', gridTemplateColumns: scopeWards.length ? '0.9fr 1.3fr 1fr 1fr' : '1fr 1.4fr 1fr', gap: 14, marginTop: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">年度</div>
            <Select value={state.expYear} onChange={(e) => set({ expYear: Number(e.target.value) })}
              options={D.YEARS.slice().reverse().map(yy => opt(yy, eraOf(yy) + '年度（' + yy + '）'))} style={{ height: 40 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">対象地域</div>
            <Select value={state.expScope} onChange={(e) => set({ expScope: e.target.value, expWard: 'all' })} options={scopeOpts} style={{ height: 40 }} />
          </div>
          {scopeWards.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="form-label">{wardLabel()}</div>
              <Select value={expWard} onChange={(e) => set({ expWard: e.target.value })}
                options={[opt('all', 'すべての' + wardLabel())].concat(scopeWards.map(w => opt(w, w)))} style={{ height: 40 }} />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">対象者</div>
            <Select value={state.expMeasuredOnly ? 'measured' : 'everyone'} onChange={(e) => set({ expMeasuredOnly: e.target.value === 'measured' })}
              options={[opt('measured', '年度の測定済のみ'), opt('everyone', '登録者全員（未測定含む）')]} style={{ height: 40 }} />
          </div>
        </div>
        {state.expFormat === 'std' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12, flexWrap: 'wrap' }}>
            <Overline style={{ marginRight: 8 }}>追加の列</Overline>
            <CheckRow on={state.expFrail} label="フレイル簡易評価（該当数・判定・該当項目）" onClick={() => set({ expFrail: !state.expFrail })} />
            <CheckRow on={state.expKcl} label="基本チェックリスト（合計点・事業対象者判定・領域別）" onClick={() => set({ expKcl: !state.expKcl })} />
            <CheckRow on={state.expInbody} label="InBody（骨格筋量・体脂肪率・SMI・点数）" onClick={() => set({ expInbody: !state.expInbody })} />
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--fg-3)' }}>
            列構成は提出様式で固定です（基本チェックリスト 25 問の回答 0/1 と分類 1〜8 を含む 79 列）
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            <span className="t-num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)' }}>{count}</span> 名 ·
            <span className="t-num" style={{ marginLeft: 4 }}>{header.length}</span> 列
            <span style={{ color: 'var(--fg-3)', marginLeft: 10, fontSize: 12 }}>{fileNameOf(state)}</span>
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
        {state.expFormat === 'gov' ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.8, marginTop: 8 }}>
            ・列名・列順は行政提出様式（ファイルメーカー取込形式・79 列）と同一です<br />
            ・「通常5m」は測定値（秒/m）を 5 m 所要秒に換算して出力します。「開眼片脚立位時間」「握力」は左右の良い方の値です<br />
            ・基本チェックリストは 25 問の回答（該当 = 1）と、分類 1〜7（領域別該当数）・分類 8（No.1〜20 の合計）を出力します<br />
            ・最大5m・MNA・SWEET は未測定のため空欄です（様式上、未入力でも取り込み可能な項目）。「終了時」列は年度内の再評価データ取り込み後に対応します<br />
            ・圏域・市町村・地区コードは台帳側の設定値です。提出先のファイルメーカー設定に合わせて調整できます<br />
            ・BOM 付き UTF-8 のため Excel でダブルクリックしてもそのまま開けます
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.8, marginTop: 8 }}>
            ・列構成は県の指定様式に合わせて調整できます（現在は 基本情報 + 測定 8 項目 + BMI + 総合スコア{state.expFrail ? ' + フレイル評価' : ''}{state.expInbody ? ' + InBody' : ''}）<br />
            ・未測定の項目は空欄で出力されます（欠測扱い）<br />
            ・BOM 付き UTF-8 のため Excel でダブルクリックしてもそのまま開けます。県のシステムが Shift_JIS 指定の場合は Excel の「名前を付けて保存」で変換してください
          </div>
        )}
      </Card>
    </div>
  )
}
