/* 全画面をひととおり描画してみるスモークテスト（読み取り専用・書き込みなし）。

   「ビルドは通るのに画面を開くと落ちる」種類の不具合（実行時の未定義参照など）は
   vite build では見つからない。ここでは画面そのものを描画して確かめる。

   使い方:
     npm run check:screens                 … 同梱のデモデータで全画面を描画
     DATA=/path/to/data.json npm run check:screens
                                           … 本番から吸い出した JSON で描画（個人詳細を全員分）
     DATA の形式: { "users": [...], "measurements": [...] }（Firestore の文書に _id を足したもの） */
import { existsSync, readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import D, { setUsers, replaceMunis } from '../src/data/engine.js'
import { toEngineUser } from '../src/lib/realdata.js'
import { StoreProvider } from '../src/store.jsx'

import Dashboard from '../src/screens/Dashboard.jsx'
import ImportScreen from '../src/screens/Import.jsx'
import CsvImport from '../src/screens/CsvImport.jsx'
import CsvExport from '../src/screens/CsvExport.jsx'
import Roster from '../src/screens/Roster.jsx'
import Detail from '../src/screens/Detail.jsx'
import Analytics from '../src/screens/Analytics.jsx'
import Calendar from '../src/screens/Calendar.jsx'
import PdfExport from '../src/screens/PdfExport.jsx'
import SheetMaker from '../src/screens/SheetMaker.jsx'
import Techo from '../src/screens/Techo.jsx'
import TechoList from '../src/screens/TechoList.jsx'
import WalkIn from '../src/screens/WalkIn.jsx'
import Mobile from '../src/screens/Mobile.jsx'
import Staff from '../src/screens/Staff.jsx'
import MergeScreen from '../src/screens/Merge.jsx'
import Billing from '../src/screens/Billing.jsx'

const SCREENS = {
  'ダッシュボード': Dashboard, '取り込み': ImportScreen, '当日受付 取り込み': WalkIn,
  '利用者情報取り込み': CsvImport, 'カレンダー': Calendar, '用紙作成': SheetMaker,
  '手帳一覧': TechoList, '手帳作成': Techo, '利用者台帳': Roster, '重複の確認・統合': MergeScreen,
  '用紙アップロード': Mobile, '集計分析': Analytics, 'PDF 出力': PdfExport,
  'CSV 出力': CsvExport, '請求突き合わせ': Billing, '個人詳細': Detail, '職員管理': Staff,
}

// DATA が無ければ同梱のデモデータ（engine の初期値）で描画する
const RAW = (process.env.DATA && existsSync(process.env.DATA))
  ? JSON.parse(readFileSync(process.env.DATA, 'utf8'))
  : null
function load(order) {
  if (!RAW) {
    if (order) setUsers([...D.users.filter(order), ...D.users.filter(u => !order(u))])
    return D.users
  }
  const byUser = {}
  for (const m of RAW.measurements) (byUser[m.userId] ||= []).push(m)
  let list = RAW.users.map(u => toEngineUser({ ...u, id: u._id }, byUser[u._id] || []))
    .filter(u => u.name && !u.archived)
  if (order) list = [...list.filter(u => order(u)), ...list.filter(u => !order(u))]
  const muniIds = [...new Set(list.map(u => u.muni).filter(Boolean))]
    .sort((a, b) => list.filter(u => u.muni === b).length - list.filter(u => u.muni === a).length)
  let vc = 900
  const munis = muniIds.map((id) => {
    const us = list.filter(u => u.muni === id)
    const wards = [...new Set(us.map(u => u.venueName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
    return { id, name: us[0].muniName || String(id), region: us[0].region || '', tel: '', venues: wards.map(w => [vc++, w]) }
  })
  replaceMunis(munis)
  setUsers(list)
  return list
}

const render = (Comp) => renderToStaticMarkup(h(StoreProvider, null, h(Comp, null)))

let ng = 0, ok = 0
console.log('=== 全画面の描画（' + (RAW ? '本番データ ' : 'デモデータ ') + load().length + ' 名）===')
for (const [name, Comp] of Object.entries(SCREENS)) {
  try {
    const html = render(Comp)
    ok++
    console.log(`  OK  ${name}  (${html.length} 文字を描画)`)
  } catch (e) {
    ng++
    console.log(`  NG  ${name}  → ${e.message}`)
  }
}

// 個人詳細は利用者ごとに中身が変わるため、全員分を描画して確かめる
console.log('')
console.log('=== 個人詳細を全利用者で描画 ===')
const all = load()
let dOk = 0
const dNg = []
for (const u of all) {
  load((x) => x.id === u.id)   // 対象者を先頭にすると個人詳細がその人を開く
  try { render(Detail); dOk++ } catch (e) { dNg.push(`${u.id} ${u.name}: ${e.message}`) }
}
console.log(`  正常 ${dOk} 名 / エラー ${dNg.length} 名`)
dNg.slice(0, 20).forEach(x => console.log('   NG ' + x))

// 名指しの利用者（NAMES=氏名,氏名…）の個人詳細を、測定の並びつきで確認する
console.log('')
if (process.env.NAMES) console.log('=== 指定の利用者の個人詳細 ===')
for (const nm of (process.env.NAMES || '').split(',').filter(Boolean)) {
  const hits = all.filter(u => u.name.includes(nm))
  for (const u of hits) {
    load((x) => x.id === u.id)
    try {
      const html = render(Detail)
      const series = u.series.map(r => `${r.date || '評価日なし'}(${r.total}点)`).join(' / ')
      console.log(`  OK  ${u.name} ID ${u.id} ${u.muniName} ${u.venueName} — 測定 ${u.series.length} 件: ${series}`)
      if (!html.includes(u.name)) console.log('      ※ 氏名が描画結果に見当たりません')
    } catch (e) { console.log(`  NG  ${u.name} ID ${u.id} → ${e.message}`); ng++ }
  }
}
console.log('')
console.log(ng + dNg.length ? `失敗 ${ng + dNg.length} 件` : `すべて描画できました（画面 ${ok} 種 / 個人詳細 ${dOk} 名）`)
process.exit(ng + dNg.length ? 1 : 0)
