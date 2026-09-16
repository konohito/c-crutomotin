/* 測定値の点検のテスト＋台帳の走査（読み取り専用・書き込みなし）。

   ねらい: 人が目で数えて見つけた誤りを、次からは機械が先に出せるようにする。
   ここで守っているのは次の 2 つ。
     1) あり得ない値（体重 591kg など）を必ず「要修正」として拾えること
        …… 実際に本番にあった値をそのままテストに入れてある（しきい値を緩めると落ちる）
     2) 正常な測定を誤って「要修正」にしないこと（現場の測定会を止めないため）

   使い方:
     npm run check:values                    … 同梱のデモデータで走らせる（テスト）
     DATA=/path/to/data.json npm run check:values
                                             … 本番から吸い出した JSON を全件走査して一覧を出す
     DATA の形式: { "users": [...], "measurements": [...] }（Firestore の文書に _id を足したもの） */
import { existsSync, readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import D, { setUsers } from '../src/data/engine.js'
import { StoreProvider } from '../src/store.jsx'
import { AuditPanel } from '../src/screens/Roster.jsx'
import { toEngineUser } from '../src/lib/realdata.js'
import { checkValues } from '../src/lib/validate.js'
import { auditUsers, auditSummary, KIND_LABEL } from '../src/lib/audit.js'

let ng = 0
const fail = (msg) => { ng++; console.log('  NG  ' + msg) }
const pass = (msg) => console.log('  OK  ' + msg)

// ---- 1) あり得ない値を必ず拾えること（実際に本番にあった値）--------------------
console.log('=== あり得ない値を拾えるか（本番で見つかった実例）===')
const MUST_CATCH = [
  ['友田尚子さんの体重', { height: 145, weight: 591 }, 'weight'],
  ['野口幸市さんの体重', { height: 170, weight: 530 }, 'weight'],
  ['西﨑悦子さんの身長', { height: 51.6, weight: 145.5 }, 'height'],
  ['西俊子さんの身長', { height: 66.2, weight: 66.2 }, 'height'],
  ['小林君子さんの握力', { gripR: 222, gripL: 222 }, 'gripR'],
  ['野口京子さんの５ｍ歩行', { walk5: 0, walk5max: 0, tug: 0 }, 'walk5'],
  ['春口末子さんの TUG', { tug: 0 }, 'tug'],
]
for (const [label, values, field] of MUST_CATCH) {
  const errs = checkValues(values).filter(x => x.level === 'error')
  if (errs.some(x => x.field === field)) pass(`${label} … 「要修正」として拾えました（${errs.find(x => x.field === field).message}）`)
  else fail(`${label} … 拾えませんでした（${field} が素通りしています）`)
}

// ---- 2) 正常な測定を誤って止めないこと ----------------------------------------
console.log('')
console.log('=== 正常な測定を誤って止めないか ===')
const MUST_PASS = [
  ['ごく標準的な女性', { height: 150, weight: 50, bmi: 22.2, gripR: 21, gripL: 20, walk5: 3.8, walk5max: 3, tug: 6.8, balR: 33, balL: 26 }],
  ['小柄でやせた高齢女性', { height: 130.5, weight: 27, bmi: 15.9, gripR: 9, gripL: 9, walk5: 6.5, walk5max: 5, tug: 14, balR: 2, balL: 1 }],
  ['大柄な男性', { height: 176, weight: 87.2, bmi: 28.2, gripR: 46, gripL: 44, walk5: 3.2, walk5max: 2.4, tug: 5.5, balR: 60, balL: 60 }],
  ['歩行がかなり遅い方', { height: 145, weight: 40, bmi: 19, gripR: 10, gripL: 10, walk5: 16.5, walk5max: 9.9, tug: 27.9, balR: 0, balL: 0 }],
  ['未測定（空欄）ばかりの記録', { height: null, weight: null, gripR: null }],
]
for (const [label, values] of MUST_PASS) {
  const errs = checkValues(values).filter(x => x.level === 'error')
  if (errs.length === 0) pass(`${label} … 止めませんでした`)
  else fail(`${label} … 誤って止めています（${errs.map(x => x.message).join(' / ')}）`)
}

// ---- 3) 取り違えの手がかりを拾えること ------------------------------------------
console.log('')
console.log('=== 取り違えの手がかりを拾えるか ===')
{
  const V = { height: 150, weight: 50, gripR: 20, gripL: 19, walk5: 4, walk5max: 3, tug: 7, balR: 30, balL: 25 }
  const mk = (id, name, values, date, year, inbodyWeight) => ({
    id, name, kana: '', venueName: '上島', archived: false,
    series: [{ date, year, values }],
    inbody: inbodyWeight == null ? {} : { [year]: { weight: inbodyWeight } },
  })
  // (a) 同じ日に測定値が完全に一致する 2 件
  const dup = auditUsers([mk('90001', 'あ', { ...V }, '2025/10/28', 2025), mk('90002', 'い', { ...V }, '2025/10/28', 2025)])
  if (dup.filter(x => x.kind === 'sameValues').length === 2) pass('同じ日に測定値が完全に一致する 2 件 … 両方を拾えました')
  else fail('同じ日に測定値が完全に一致する 2 件 … 拾えませんでした')
  // 日が違えば拾わない（別の日に同じ値が出ることはあり得る）
  const dup2 = auditUsers([mk('90001', 'あ', { ...V }, '2025/10/28', 2025), mk('90002', 'い', { ...V }, '2024/10/28', 2024)])
  if (dup2.filter(x => x.kind === 'sameValues').length === 0) pass('日が違う同じ値 … 誤って拾いませんでした')
  else fail('日が違う同じ値 … 誤って拾っています')
  // (b) 身長が前回から大きく変わる（杉本哲治さんの 144.2 → 165 と同じ形）
  const tall = auditUsers([{
    id: '90003', name: 'う', kana: '', venueName: '鯰', archived: false, inbody: {},
    series: [{ date: '2024/10/02', year: 2024, values: { ...V, height: 144.2 } }, { date: '2025/11/05', year: 2025, values: { ...V, height: 165 } }],
  }])
  if (tall.some(x => x.kind === 'heightJump')) pass('身長が 1 年で 20.8cm 変わる記録 … 拾えました')
  else fail('身長が 1 年で 20.8cm 変わる記録 … 拾えませんでした')
  // (c) 記録用紙と InBody の体重の食い違い（田中好美さんの 45.6 と 60.3 と同じ形）
  const ibw = auditUsers([mk('90004', 'え', { ...V, weight: 45.6 }, '2025/09/19', 2025, 60.3)])
  if (ibw.some(x => x.kind === 'inbodyWeight')) pass('記録用紙 45.6kg と InBody 60.3kg の食い違い … 拾えました')
  else fail('記録用紙と InBody の体重の食い違い … 拾えませんでした')
  // 誤差の範囲（1kg 違い）では拾わない
  const ibw2 = auditUsers([mk('90005', 'お', { ...V, weight: 50 }, '2025/09/19', 2025, 51)])
  if (!ibw2.some(x => x.kind === 'inbodyWeight')) pass('1kg の差 … 誤って拾いませんでした')
  else fail('1kg の差 … 誤って拾っています')
}

// ---- 4) 台帳の走査 -------------------------------------------------------------
const RAW = (process.env.DATA && existsSync(process.env.DATA))
  ? JSON.parse(readFileSync(process.env.DATA, 'utf8'))
  : null
if (RAW) {
  const byUser = {}
  for (const m of RAW.measurements) (byUser[m.userId] ||= []).push(m)
  const list = RAW.users.map(u => toEngineUser({ ...u, id: u._id, archived: u.archived }, byUser[u._id] || []))
  setUsers(list)
}
const users = D.users
console.log('')
console.log(`=== 台帳の走査（${RAW ? '本番データ' : 'デモデータ'} ${users.length} 名）===`)
const findings = auditUsers(users)
const sum = auditSummary(findings)
if (!findings.length) {
  console.log('  気になる記録はありませんでした')
} else {
  const groups = {}
  for (const f of findings) (groups[f.kind] ||= []).push(f)
  for (const [kind, arr] of Object.entries(groups)) {
    console.log(`  【${KIND_LABEL[kind] || kind}】${arr.length} 件`)
    for (const f of arr) {
      console.log(`    ${f.level === 'error' ? '要修正' : '要確認'} | ID ${f.userId} ${f.name}（${f.ward || '—'}）| ${f.date} | ${f.message}`)
    }
  }
  console.log(`  合計 ${findings.length} 件（要修正 ${sum.error} 件・要確認 ${sum.warn} 件／${sum.users} 名）`)
}

// ---- 5) 点検パネルが実際に描画できること（開いた状態） --------------------------
console.log('')
console.log('=== 点検パネルの描画（開いた状態）===')
try {
  // 必ず 1 件以上出る台帳にしてから描く（件数 0 だと一覧の描画が試せないため）
  const before = D.users
  setUsers([{
    id: '90009', name: '点検 太郎', kana: 'てんけん たろう', sex: 'M', sexLabel: '男', age: 80,
    muniName: '嘉島町', region: '嘉島町圏域', venueName: '上島', venueCode: 900, phone: '', careLevel: '',
    joined: 2025, archived: false, walkIn: false, flags: [], meas: {}, inbody: {}, kcl: {},
    series: [{ date: '2025/10/28', year: 2025, values: { height: 51.6, weight: 145.5 }, total: 0, axes: null }],
  }])
  const html = renderToStaticMarkup(h(StoreProvider, null, h(AuditPanel, { defaultOpen: true })))
  setUsers(before)
  if (html.includes('あり得ない')) pass(`点検パネルを開いた状態で描画できました（${html.length} 文字）`)
  else fail('点検パネルは描画できましたが、見つけた内容が出ていません')
} catch (e) {
  fail('点検パネルの描画に失敗しました → ' + e.message)
}

console.log('')
if (ng) { console.log(`失敗 ${ng} 件`); process.exit(1) }
console.log('測定値の点検は期待どおりに動いています')
