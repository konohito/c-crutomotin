import { useRef } from 'react'
import D from '../data/engine.js'
import { useStore, readCsvFile } from '../store.jsx'
import { Card, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

const CSV_COLS = ['参加者ID', '氏名', 'かな（ふりがな）', '生年月日', '性別', '電話番号', '５ｍ通常歩行', '開眼片足立ち 右', '開眼片足立ち 左', '握力 右', '握力 左', 'TUG', '身長', '体重', '骨格筋量 *', '体脂肪率 *', 'SMI *', 'InBody点数 *']

function Rule({ n, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div className="t-num" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--brand-50)', color: 'var(--brand-700)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{n}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

export default function CsvImport() {
  const { state, set, showToast } = useStore()
  const fileRef = useRef(null)

  const onFile = (file) => readCsvFile({ file, state, set, showToast })

  return (
    <div className="screen" style={{ maxWidth: 860 }}>
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!state.csvDrag) set({ csvDrag: true }) }}
        onDragLeave={() => set({ csvDrag: false })}
        onDrop={(e) => { e.preventDefault(); set({ csvDrag: false }); onFile(e.dataTransfer.files && e.dataTransfer.files[0]) }}
        style={{
          background: state.csvDrag ? 'var(--brand-50)' : 'var(--bg-surface)',
          border: `2px dashed ${state.csvDrag ? 'var(--brand-500)' : 'var(--border-strong)'}`,
          borderRadius: 12, padding: '42px 24px 36px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          cursor: 'pointer', textAlign: 'center',
          transition: 'background var(--dur-fast), border-color var(--dur-fast)',
        }}
      >
        <div style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center' }}>
          <Icon name="file" size={26} />
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 4 }}>名簿・記録・InBody の CSV をここにドラッグ＆ドロップ</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>Excel / LookinBody の書き出し（Shift_JIS / UTF-8）に対応 · 1 行 = 1 名 · 形式は自動判別</div>
        <button className="btn btn-primary" style={{ marginTop: 8 }}>
          <Icon name="upload" size={15} strokeWidth={1.8} />
          ファイルを選択…
        </button>
        <input type="file" accept=".csv,text/csv" ref={fileRef} onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = '' }} style={{ display: 'none' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16, alignItems: 'start' }}>
        <Card pad>
          <div className="t-h4">新規の方の登録先</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.6 }}>
            台帳に見つからない方を登録する市町村です。参加者 ID がある場合は ID の会場コードが優先されます。
          </div>
          <Select
            value={state.csvMuni}
            onChange={(e) => set({ csvMuni: e.target.value })}
            options={D.MUNIS.map(m => ({ v: m.id, l: m.name }))}
            style={{ height: 40, width: '100%', marginTop: 10, fontSize: 13.5 }}
          />
        </Card>
        <Card pad>
          <div className="t-h4">取り込みのルール</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <Rule n={1}><b>参加者 ID → 氏名</b> の順で台帳と自動照合し、既存の方は情報を更新します</Rule>
            <Rule n={2}>見つからない方は<b>新規登録</b>されます（ID は自動採番）</Rule>
            <Rule n={3}>測定値の列があれば<b>令和7年度の結果</b>として登録し、チャートに反映します</Rule>
            <Rule n={4}>骨格筋量・SMI などの列がある場合は <b>InBody（体組成）データ</b>として台帳に紐づけ、結果票に出力できます</Rule>
          </div>
        </Card>
      </div>

      <Card pad>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div className="t-h4">認識できる列（ヘッダー行）</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>順不同 · 一部だけでも OK · <b>*</b> = InBody 形式として取り込み</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {CSV_COLS.map(cc => <span key={cc} className="chip" style={{ height: 26, padding: '0 11px' }}>{cc}</span>)}
        </div>
      </Card>
    </div>
  )
}
