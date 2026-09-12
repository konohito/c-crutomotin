import { useMemo, useState } from 'react'
import D from '../data/engine.js'
import { useStore } from '../store.jsx'
import { wardLabel } from '../lib/db.js'
import { districtOf } from '../lib/merge.js'
import { compactDate } from '../lib/realdata.js'
import { Card, Select, Overline, CheckRow } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

/* 請求突き合わせ — 期間を決めて、団体ごとに「何名測定したか」を数える画面。

   請求は 2 か月に 1 度で、そのとき「どの団体で測ったか」を請求報告の人数と照合する。
   集計分析は年度単位なので請求の周期に合わず、この用途には使えなかった。
   ここでは日付で区切って数える。短期集中予防（C型）と自治体依頼は請求の性質が
   違いうるので分けて数え、合計も出す。 */

const pad = (n) => String(n).padStart(2, '0')
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const compactIso = (iso) => String(iso || '').replace(/\D/g, '')
// 今日（デモでは engine の TODAY。実データでは実際の今日）
const today = () => new Date()
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }

const distinctSort = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'ja'))
const esc = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }

/* 期間内の測定を拾って団体ごとにまとめる。
   人数は「その団体でその期間に測定した実人数」（同じ方が 2 回測っても 1 名）。
   請求は人数で突き合わせるが、件数もずれの発見に要るので両方出す。 */
export function billingRows({ from, to, region, muni, users = D.users }) {
  const f = compactIso(from), t = compactIso(to)
  const groups = {}
  for (const u of users) {
    for (const r of (u.series || [])) {
      if (!r.values || Object.values(r.values).every(v => v === null || v === undefined)) continue
      const d = compactDate(r.date)
      if (!d || (f && d < f) || (t && d > t)) continue
      // 団体・市町村は「その測定当時の地区」で数える（統合しても過去の請求とずれない）
      const a = districtOf(u, r)
      if (region !== 'all' && a.region !== region) continue
      if (muni !== 'all' && a.muniName !== muni) continue
      const key = `${a.muniName}|${a.ward || '（未設定）'}`
      const g = (groups[key] ||= {
        muniName: a.muniName, region: a.region, ward: a.ward || '（未設定）',
        city: new Set(), cType: new Set(), all: new Set(),
        count: 0, byDate: {}, people: [],
      })
      const isC = r.program === 'cType'
      ;(isC ? g.cType : g.city).add(u.id)
      g.all.add(u.id)
      g.count++
      const dl = r.date
      ;(g.byDate[dl] ||= new Set()).add(u.id)
      g.people.push({ id: u.id, name: u.name, date: r.date, program: isC ? 'C型' : '自治体', total: r.total })
    }
  }
  return Object.values(groups)
    .map(g => ({
      ...g,
      cityN: g.city.size, cTypeN: g.cType.size, allN: g.all.size,
      dates: Object.entries(g.byDate).map(([d, s]) => ({ date: d, n: s.size }))
        .sort((a, b) => compactDate(a.date).localeCompare(compactDate(b.date))),
      people: g.people.sort((a, b) => compactDate(a.date).localeCompare(compactDate(b.date)) || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.muniName.localeCompare(b.muniName, 'ja') || a.ward.localeCompare(b.ward, 'ja'))
}

export function billingCsv(rows, { from, to }) {
  const header = ['期間開始', '期間終了', '圏域', '市町村', wardLabel() + '（団体）',
    '自治体依頼 人数', '短期集中予防C型 人数', '合計人数', '測定件数', '測定日の内訳']
  const body = rows.map(g => [from, to, g.region, g.muniName, g.ward,
    g.cityN, g.cTypeN, g.allN, g.count, g.dates.map(d => `${d.date}(${d.n}名)`).join(' / ')])
  const t = rows.reduce((s, g) => ({
    city: s.city + g.cityN, ct: s.ct + g.cTypeN, all: s.all + g.allN, cnt: s.cnt + g.count,
  }), { city: 0, ct: 0, all: 0, cnt: 0 })
  body.push([from, to, '', '', '合計', t.city, t.ct, t.all, t.cnt, ''])
  return { header, rows: body }
}

export default function Billing() {
  const { state, set, showToast } = useStore()
  const [showNames, setShowNames] = useState(false)
  const from = state.bilFrom || toIso(addMonths(today(), -2))
  const to = state.bilTo || toIso(today())
  const region = state.bilRegion || 'all'
  const muni = state.bilMuni || 'all'

  const regions = distinctSort(D.users.map(u => u.region))
  const munis = distinctSort(D.users.filter(u => region === 'all' || u.region === region).map(u => u.muniName))
  const rows = useMemo(() => billingRows({ from, to, region, muni }), [from, to, region, muni, state.rev])
  const total = rows.reduce((s, g) => ({
    city: s.city + g.cityN, ct: s.ct + g.cTypeN, all: s.all + g.allN, cnt: s.cnt + g.count,
  }), { city: 0, ct: 0, all: 0, cnt: 0 })

  const quick = (n, label) => (
    <button key={label} className="btn btn-sm" onClick={() => {
      const t = today()
      set({ bilFrom: toIso(addMonths(t, -n)), bilTo: toIso(t) })
    }}>{label}</button>
  )
  const thisMonth = () => {
    const t = today()
    set({ bilFrom: toIso(new Date(t.getFullYear(), t.getMonth(), 1)), bilTo: toIso(new Date(t.getFullYear(), t.getMonth() + 1, 0)) })
  }
  const lastMonth = () => {
    const t = today()
    set({ bilFrom: toIso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), bilTo: toIso(new Date(t.getFullYear(), t.getMonth(), 0)) })
  }

  const download = () => {
    const { header, rows: body } = billingCsv(rows, { from, to })
    const lines = [header, ...body].map(r => r.map(esc).join(','))
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `請求突き合わせ_${from}〜${to}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    showToast(`${rows.length} 団体・のべ ${total.all} 名分の CSV を出力しました`)
  }

  const TH = { padding: '7px 8px', fontSize: 12, fontWeight: 700, background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-default)', textAlign: 'left', whiteSpace: 'nowrap' }
  const TD = { padding: '7px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' }

  return (
    <div className="screen" style={{ maxWidth: 1040 }}>
      <Card pad style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="billing" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>請求突き合わせ</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 2 }}>
            期間を決めて、団体ごとに「何名測定したか」を数えます。請求報告の人数と照らし合わせてください
          </div>
        </div>
        <button className="btn btn-primary" onClick={download}>
          <Icon name="csvout" size={15} /> CSV 出力
        </button>
      </Card>

      {/* 期間と絞り込み */}
      <Card pad>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">期間の開始</div>
            <input type="date" className="field t-num" style={{ height: 40 }} value={from} onChange={(e) => set({ bilFrom: e.target.value })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">期間の終了</div>
            <input type="date" className="field t-num" style={{ height: 40 }} value={to} onChange={(e) => set({ bilTo: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 2 }}>
            {quick(2, '直近2か月')}{quick(1, '直近1か月')}
            <button className="btn btn-sm" onClick={thisMonth}>今月</button>
            <button className="btn btn-sm" onClick={lastMonth}>先月</button>
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">圏域</div>
            <Select value={region} onChange={(e) => set({ bilRegion: e.target.value, bilMuni: 'all' })}
              options={[{ v: 'all', l: 'すべての圏域' }].concat(regions.map(r => ({ v: r, l: r })))} style={{ height: 40 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="form-label">市町村</div>
            <Select value={muni} onChange={(e) => set({ bilMuni: e.target.value })}
              options={[{ v: 'all', l: 'すべての市町村' }].concat(munis.map(m => ({ v: m, l: m })))} style={{ height: 40 }} />
          </div>
        </div>
      </Card>

      {/* 合計 */}
      <Card pad>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div><Overline>団体数</Overline><div className="t-num" style={{ fontSize: 26, fontWeight: 700 }}>{rows.length}</div></div>
          <div><Overline>自治体依頼</Overline><div className="t-num" style={{ fontSize: 26, fontWeight: 700 }}>{total.city}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 3 }}>名</span></div></div>
          <div><Overline>短期集中予防（C型）</Overline><div className="t-num" style={{ fontSize: 26, fontWeight: 700, color: 'var(--brand-600)' }}>{total.ct}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 3 }}>名</span></div></div>
          <div><Overline>合計</Overline><div className="t-num" style={{ fontSize: 26, fontWeight: 700 }}>{total.all}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 3 }}>名</span></div></div>
          <div><Overline>測定件数</Overline><div className="t-num" style={{ fontSize: 26, fontWeight: 700 }}>{total.cnt}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 3 }}>件</span></div></div>
          <span style={{ flex: 1 }} />
          <CheckRow on={showNames} label="氏名まで表示する" onClick={() => setShowNames(!showNames)} />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.7 }}>
          人数は「その期間にその団体で測定した実人数」です（同じ方が期間内に 2 回測っても 1 名と数えます）。
          件数は測定の回数なので、人数と件数が食い違う団体は同じ方を 2 回測っています。
          合計の人数は団体ごとの人数を足したものです（同じ方が別の団体でも測っていれば、それぞれで数えます）。
        </div>
      </Card>

      {rows.length === 0 && (
        <Card pad style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: 40 }}>
          この期間に測定の記録はありません（{from} 〜 {to}）
        </Card>
      )}

      {rows.length > 0 && (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={TH}>市町村</th>
                <th style={TH}>{wardLabel()}（団体）</th>
                <th style={{ ...TH, textAlign: 'right' }}>自治体依頼</th>
                <th style={{ ...TH, textAlign: 'right' }}>C型</th>
                <th style={{ ...TH, textAlign: 'right' }}>合計人数</th>
                <th style={{ ...TH, textAlign: 'right' }}>測定件数</th>
                <th style={TH}>測定日の内訳</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(g => (
                <tr key={g.muniName + g.ward}>
                  <td style={TD}>{g.muniName}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{g.ward}</td>
                  <td style={{ ...TD, textAlign: 'right' }} className="t-num">{g.cityN || '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', color: g.cTypeN ? 'var(--brand-700)' : 'inherit', fontWeight: g.cTypeN ? 700 : 400 }} className="t-num">{g.cTypeN || '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }} className="t-num">{g.allN}</td>
                  <td style={{ ...TD, textAlign: 'right', color: g.count !== g.allN ? 'var(--warn-600, #b45309)' : 'inherit' }} className="t-num">{g.count}</td>
                  <td style={TD}>
                    <div className="t-num" style={{ fontSize: 12 }}>{g.dates.map(d => `${d.date}（${d.n}名）`).join(' / ')}</div>
                    {showNames && (
                      <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 4, lineHeight: 1.7 }}>
                        {g.people.map((p, i) => (
                          <span key={p.id + p.date + i}>{p.name}<span className="t-num">（{p.id}・{p.date}・{p.program}）</span>{i < g.people.length - 1 ? '、' : ''}</span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ ...TD, fontWeight: 700, background: 'var(--bg-subtle)' }} colSpan={2}>合計</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700, background: 'var(--bg-subtle)' }} className="t-num">{total.city}</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700, background: 'var(--bg-subtle)' }} className="t-num">{total.ct}</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700, background: 'var(--bg-subtle)' }} className="t-num">{total.all}</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700, background: 'var(--bg-subtle)' }} className="t-num">{total.cnt}</td>
                <td style={{ ...TD, background: 'var(--bg-subtle)' }} />
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
