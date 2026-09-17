/* 測定の保存まわりの動作確認（Firestore には一切つながない・メモリ内だけで検査）。

   ここで守っているのは、2026/09/17 に実際に起きた事故の再発防止:
   - 現場が「本日の測定を登録したあと、昨年の測定も足したい」とき、
     以前は今ある測定を開いて評価日を書き換えるしかなく、その測定そのものが
     昨年へ引っ越して本日の記録が消えた。
   - 年度を評価日と別に選べたため、「評価日は本日・年度は昨年」という
     食い違った記録が作れてしまっていた。

   使い方: node scripts/check-measure-save.mjs
   （import.meta.env が無い素の node で動くため dbEnabled() は false になり、
     Firestore への書き込みは起きない） */
import D, { setUsers } from '../src/data/engine.js'
import { toEngineUser, saveMeasurement, measKey } from '../src/lib/realdata.js'

let ng = 0
const ok = (m) => console.log('  OK  ' + m)
const fail = (m) => { ng++; console.log('  NG  ' + m) }
const V = (o = {}) => ({ height: 150, weight: 50, gripR: 20, gripL: 19, walk5: 4, walk5max: 3, tug: 7, balR: 30, balL: 25, ...o })

// 本日の測定を 1 件だけ持つ利用者を用意する
function freshUser() {
  const u = toEngineUser(
    { id: '99001', name: '検査 太郎', kana: 'けんさ たろう', sex: 'F', birth: 1945, muniName: '熊本市東区', ward: '検査会場' },
    [{ _id: '99001_20260917', userId: '99001', date: '2026/09/17', year: 2026, values: V() }],
  )
  setUsers([u])
  return D.users[0]
}

console.log('=== 昨年の測定を足しても、本日の測定が残るか ===')
{
  const u = freshUser()
  const before = u.series.length
  // 画面と同じ呼び出し方: 年度は評価日から決める（2025/02/27 → 令和6年度）
  const y = D.fiscalYearOfDate('2025/02/27')
  await saveMeasurement(u.id, y, V({ height: 149, weight: 48 }), '2025/02/27', undefined, { create: true })
  const today = u.series.find(r => r.date === '2026/09/17')
  const added = u.series.find(r => r.date === '2025/02/27')
  if (u.series.length === before + 1) ok(`測定が ${before} 件 → ${u.series.length} 件に増えました`)
  else fail(`測定の件数が ${before} → ${u.series.length}（1 件増えるはず）`)
  if (today && today.values.height === 150 && today.values.weight === 50) ok('本日の測定がそのまま残っています（身長150・体重50）')
  else fail('★本日の測定が消えた、または値が変わりました')
  if (added && added.values.height === 149) ok('追加した昨年の測定が入りました（身長149）')
  else fail('追加した測定が入っていません')
  if (added && added.year === 2024) ok(`年度は評価日から自動で決まりました（2025/02/27 → ${added.year} 年度）`)
  else fail(`年度が自動で決まっていません（${added && added.year}）`)
  if (added && added.key === measKey(u.id, '2025/02/27')) ok(`測定キーが {利用者ID}_{測定日} です（${added.key}）`)
  else fail(`測定キーが想定と違います（${added && added.key}）`)
  if (u.meas[2026] && u.meas[2026].date === '2026/09/17') ok('令和8年度の代表は本日の測定のままです')
  else fail('★令和8年度の代表が入れ替わりました')
  if (u.meas[2024] && u.meas[2024].date === '2025/02/27') ok('令和6年度の代表に追加分が入りました')
  else fail('令和6年度の代表が入っていません')
}

console.log('')
console.log('=== 同じ年度にもう 1 件足しても、前の分が消えないか ===')
{
  const u = freshUser()
  const y = D.fiscalYearOfDate('2026/05/20')   // 本日と同じ令和8年度
  await saveMeasurement(u.id, y, V({ weight: 44 }), '2026/05/20', undefined, { create: true })
  const today = u.series.find(r => r.date === '2026/09/17')
  if (u.series.length === 2 && today && today.values.weight === 50) ok('同じ年度でも 2 件が並んで残ります（上書きされません）')
  else fail('★同じ年度に足すと前の測定が消えます')
}

console.log('')
console.log('=== 既存の測定を編集したときは増えないか ===')
{
  const u = freshUser()
  await saveMeasurement(u.id, 2026, V({ weight: 51 }), '2026/09/17', '99001_20260917', {})
  if (u.series.length === 1) ok('編集では件数が増えません（1 件のまま）')
  else fail(`★編集で件数が増えました（${u.series.length} 件）`)
  if (u.series[0].values.weight === 51) ok('編集した値が反映されました（体重51）')
  else fail('編集した値が反映されていません')
}

console.log('')
console.log('=== 評価日を変えると年度も一緒に動くか（食い違いが起きないこと）===')
{
  const u = freshUser()
  const y = D.fiscalYearOfDate('2025/02/27')
  await saveMeasurement(u.id, y, V(), '2025/02/27', '99001_20260917', {})
  const r = u.series[0]
  if (u.series.length === 1) ok('移動なので件数は増えません')
  else fail(`★件数が増えました（${u.series.length} 件）`)
  if (r.date === '2025/02/27' && r.year === 2024) ok(`評価日と年度が揃っています（${r.date} / ${r.year} 年度）`)
  else fail(`★評価日と年度が食い違っています（${r.date} / ${r.year} 年度）`)
  if (!u.meas[2026]) ok('移動元の令和8年度には、もう残っていません')
  else fail('★移動したのに元の年度にも残っています')
}

console.log('')
if (ng) { console.log(`失敗 ${ng} 件`); process.exit(1) }
console.log('測定の保存は期待どおりに動いています')
