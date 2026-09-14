import { useEffect, useMemo, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { dbEnabled, loadCertConfig, saveCertConfig, CERT_DEFAULT } from '../lib/db.js'
import { ctypeRows } from '../lib/ctype.js'
import { certificateList, certificateOf, waDate } from '../lib/certificate.js'
import { eraOf } from '../lib/helpers.js'
import { Overline, CheckRow, Select } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

/* 卒業証書 — 短期集中予防サービス（C型）を修了された方へお渡しする 1 枚。

   ・載せる数字はすべて実測値（開始時 → 終了時）。総合スコアは使わない
     （C型 は終了時に身長・体重・基本チェックリストを測らないため、項目ごとに比べる）
   ・一番伸びた項目に応じた称号を贈る。伸びなかった方には「皆勤の心意気賞」
   ・A4 縦。印刷は既存の用紙と同じ仕組み（window.print → PDF に保存） */

const SEAL = '#b4462c'   // 朱色（枠・印章まわり）
const INK = '#1d2a33'

function Field({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>{label}</span>
      <input className="field" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

/* 証書 1 枚。A4 縦（794×1123px ＝ 210×297mm 相当）。 */
export function CertPage({ cert, cfg, issueDate }) {
  const { row, badge, highlights, kept } = cert
  const u = row.user
  const lines = highlights.length ? highlights : kept
  return (
    <div className="pdf-page" style={{ padding: 0, position: 'relative', background: '#fff' }}>
      {/* 二重枠 */}
      <div style={{ position: 'absolute', inset: 26, border: `4px double ${SEAL}` }} />
      <div style={{ position: 'absolute', inset: 40, border: `1px solid ${SEAL}55` }} />
      <div style={{ position: 'relative', padding: '56px 76px 44px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', color: INK }}>

        <div style={{ textAlign: 'center', fontSize: 40, fontWeight: 700, letterSpacing: '0.34em', textIndent: '0.34em', color: SEAL }}>卒 業 証 書</div>
        <div style={{ textAlign: 'center', fontSize: 15, marginTop: 10, letterSpacing: '0.08em', color: '#5a6b76' }}>
          短期集中予防サービス（通所型サービスC）修了
        </div>

        {/* 氏名 */}
        <div style={{ marginTop: 26, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16 }}>
          <span style={{ fontSize: 38, fontWeight: 700, letterSpacing: '0.1em', borderBottom: `2px solid ${SEAL}44`, paddingBottom: 6 }}>{u.name}</span>
          <span style={{ fontSize: 22 }}>様</span>
        </div>
        <div style={{ textAlign: 'center', fontSize: 15, color: '#5a6b76', marginTop: 10 }}>
          {/* 団体名の「（C型）」は事業の区分なので、お渡しする証書では外す */}
          {u.muniName}　{String(u.venueName || '').replace(/[（(]\s*C型\s*[)）]/g, '').trim()}
        </div>

        {/* 本文 */}
        <div style={{ marginTop: 24, fontSize: 17, lineHeight: 1.95, textAlign: 'left' }}>{cert.body}</div>

        {/* 称号 */}
        <div style={{ marginTop: 22, textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: '0.3em', color: '#5a6b76' }}>贈 る 称 号</div>
          <div style={{ marginTop: 8, display: 'inline-block', border: `3px solid ${SEAL}`, borderRadius: 10, padding: '10px 32px' }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: SEAL, letterSpacing: '0.08em' }}>{badge.title}</span>
          </div>
          <div style={{ fontSize: 15.5, lineHeight: 1.85, marginTop: 12, color: '#33434d' }}>{badge.praise}</div>
        </div>

        {/* 実測値 */}
        <div style={{ marginTop: 18, border: `1px solid ${SEAL}44`, borderRadius: 8, padding: '12px 20px' }}>
          <div style={{ fontSize: 13, letterSpacing: '0.16em', color: SEAL, fontWeight: 700, marginBottom: 7 }}>
            {highlights.length ? 'この期間で良くなったこと' : 'この期間で保てたこと'}
          </div>
          {lines.length === 0 ? (
            <div style={{ fontSize: 17 }}>最後まで通い続けられました。</div>
          ) : lines.slice(0, 5).map(h => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'baseline', gap: 14, fontSize: 17, lineHeight: 1.8 }}>
              <span style={{ color: SEAL, fontSize: 15 }}>●</span>
              <span className="t-num" style={{ flex: 1 }}>{h.text}</span>
              <span className="t-num" style={{ fontWeight: 700, color: SEAL }}>{h.delta}</span>
            </div>
          ))}
        </div>

        {/* 期間 */}
        <div style={{ marginTop: 12, fontSize: 14.5, color: '#5a6b76', textAlign: 'center' }} className="t-num">
          取り組まれた期間　{row.startDate} 〜 {row.endDate}{row.days ? `（${row.days}日間）` : ''}
        </div>

        <div style={{ flex: 1 }} />

        {/* 日付・発行者 */}
        <div style={{ fontSize: 16, textAlign: 'center' }} className="t-num">{waDate(issueDate, D.eraLabel)}</div>
        <div style={{ marginTop: 10, textAlign: 'center', lineHeight: 1.8 }}>
          {cfg.corpName && <div style={{ fontSize: 17 }}>{cfg.corpName}</div>}
          {cfg.officeName && <div style={{ fontSize: 21, fontWeight: 700 }}>{cfg.officeName}</div>}
          {(cfg.issuerTitle || cfg.issuerName) && (
            <div style={{ fontSize: 19, marginTop: 4 }}>
              {cfg.issuerTitle}　{cfg.issuerName}
              <span style={{ display: 'inline-block', width: 44, height: 44, border: `2px solid ${SEAL}`, borderRadius: 6, color: SEAL, fontSize: 11, lineHeight: 1.15, marginLeft: 14, verticalAlign: 'middle', padding: 4, boxSizing: 'border-box' }}>印</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Certificate() {
  const { state, set, showToast } = useStore()
  const [cfg, setCfg] = useState({ ...CERT_DEFAULT })
  const [cfgOpen, setCfgOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (dbEnabled()) loadCertConfig().then(setCfg).catch(() => {}) }, [])

  const year = state.certYear || 'all'
  const all = useMemo(() => ctypeRows(D.users), [state.rev])
  const rows = year === 'all' ? all : all.filter(r => Number(r.year) === Number(year))
  const { ready, notYet } = certificateList(rows)
  const years = [...new Set(all.map(r => Number(r.year)))].sort()

  const picked = state.certPicked || {}
  const chosen = ready.filter(x => picked[x.row.user.id + '-' + x.row.year])
  const issueDate = state.certDate || D.TODAY
  const toggle = (k) => set({ certPicked: { ...picked, [k]: !picked[k] } })
  const allOn = ready.length > 0 && chosen.length === ready.length
  const toggleAll = () => {
    const next = {}
    if (!allOn) ready.forEach(x => { next[x.row.user.id + '-' + x.row.year] = true })
    set({ certPicked: next })
  }

  const saveCfg = async () => {
    setSaving(true)
    try { await saveCertConfig(cfg); showToast('発行者の情報を保存しました') }
    catch (e) { showToast('保存に失敗しました: ' + (e.message || '')) }
    setSaving(false)
  }

  return (
    <div className="print-screen panel-screen" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: '100%', minHeight: 0 }}>
      {/* 設定パネル */}
      <div className="noprint side-panel" style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <Overline style={{ marginBottom: 8 }}>年度</Overline>
          <Select value={String(year)} onChange={(e) => set({ certYear: e.target.value })}
            options={[{ v: 'all', l: 'すべての年度' }].concat(years.map(y => ({ v: String(y), l: eraOf(y) + '年度' })))} style={{ width: '100%' }} />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Overline>お渡しする方</Overline>
            <span style={{ flex: 1 }} />
            {ready.length > 0 && <button className="btn btn-sm" onClick={toggleAll}>{allOn ? 'すべて外す' : 'すべて選ぶ'}</button>}
          </div>
          {ready.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.8 }}>
              発行できる方がいません。短期集中予防サービスの開始時と終了時の測定が両方そろうと、ここに出ます
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {ready.map(x => {
              const k = x.row.user.id + '-' + x.row.year
              return (
                <CheckRow key={k} on={!!picked[k]} onClick={() => toggle(k)}
                  label={`${x.row.user.name}（${x.cert.badge.title}）`} />
              )
            })}
          </div>
          {notYet.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--fg-3)' }}>まだ発行できません（終了時が未測定）</div>
              {notYet.map(x => (
                <div key={x.row.user.id + '-' + x.row.year} style={{ fontSize: 12.5, color: 'var(--fg-3)', padding: '3px 0' }}>
                  {x.row.user.name}<span className="t-num" style={{ marginLeft: 6 }}>（開始 {x.row.startDate}）</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 4, lineHeight: 1.6 }}>
                終了時の測定を取り込むと発行できるようになります
              </div>
            </div>
          )}
        </div>

        <div>
          <Overline style={{ marginBottom: 8 }}>証書の日付</Overline>
          <input className="field t-num" type="date" style={{ width: '100%' }}
            value={String(issueDate).replace(/\//g, '-')}
            onChange={(e) => set({ certDate: e.target.value.replace(/-/g, '/') })} />
        </div>

        <div>
          <button className="btn btn-sm" style={{ width: '100%' }} onClick={() => setCfgOpen(!cfgOpen)}>
            発行者（法人名・事業所名）を{cfgOpen ? '閉じる' : '設定する'}
          </button>
          {cfgOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              <Field label="法人名" value={cfg.corpName} onChange={(v) => setCfg({ ...cfg, corpName: v })} placeholder="例: 株式会社◯◯" />
              <Field label="事業所名" value={cfg.officeName} onChange={(v) => setCfg({ ...cfg, officeName: v })} placeholder="例: ◯◯介護予防センター" />
              <Field label="肩書" value={cfg.issuerTitle} onChange={(v) => setCfg({ ...cfg, issuerTitle: v })} placeholder="例: 管理者" />
              <Field label="氏名" value={cfg.issuerName} onChange={(v) => setCfg({ ...cfg, issuerName: v })} placeholder="例: 熊本 太郎" />
              <button className="btn btn-primary btn-sm" disabled={saving || !dbEnabled()} onClick={saveCfg}>{saving ? '保存中…' : '保存する'}</button>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                一度保存すると、次からこの内容で証書に刷られます。空欄の項目は証書に出ません
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
            <span className="t-num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)' }}>{chosen.length}</span> 名 · A4 縦
          </div>
          <button className="btn btn-primary btn-lg" disabled={!chosen.length} onClick={() => window.print()}>
            <Icon name="printer" size={17} strokeWidth={1.8} />
            印刷 / PDF に保存
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.6 }}>
            印刷ダイアログで「PDF に保存」を選べばファイルになります。1 名 1 枚で出ます
          </div>
        </div>
      </div>

      {/* プレビュー */}
      <div className="pdf-stage">
        <div className="pdf-pages">
          {chosen.length === 0 ? (
            <div className="noprint" style={{ padding: 60, color: 'var(--fg-3)', fontSize: 13.5, textAlign: 'center', lineHeight: 2 }}>
              左の一覧からお渡しする方を選んでください。<br />選ぶとここに証書が表示されます
            </div>
          ) : chosen.map(x => (
            <CertPage key={x.row.user.id + '-' + x.row.year} cert={x.cert} cfg={cfg} issueDate={issueDate} />
          ))}
        </div>
      </div>
    </div>
  )
}
