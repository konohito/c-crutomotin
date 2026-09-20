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
import { readdirSync, readFileSync } from 'node:fs'
import D, { setUsers, eraLabel, fiscalYearOfDate } from '../src/data/engine.js'
import { toEngineUser, saveMeasurement, measKey } from '../src/lib/realdata.js'
import { batchDate } from '../src/lib/helpers.js'

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
console.log('=== 編集画面で評価日を変えたとき、既定の「追加」で本日が残るか ===')
{
  const u = freshUser()
  // 画面の既定（mode='add'）と同じ呼び出し: key を渡さず create:true
  const y = D.fiscalYearOfDate('2025/02/27')
  await saveMeasurement(u.id, y, V({ height: 148 }), '2025/02/27', undefined, { create: true })
  const today = u.series.find(r => r.date === '2026/09/17')
  const added = u.series.find(r => r.date === '2025/02/27')
  if (u.series.length === 2) ok('測定が 2 件になりました（追加された）')
  else fail(`★件数が ${u.series.length} 件（2 件になるはず）`)
  if (today && today.values.height === 150) ok('本日の測定が残っています')
  else fail('★本日の測定が消えました')
  if (added && added.values.height === 148) ok('変えた日付の測定が別の記録として入りました')
  else fail('★追加されていません')
}

console.log('')
console.log('=== 「この測定の日付を直す」を選んだときは移動になるか ===')
{
  const u = freshUser()
  const y = D.fiscalYearOfDate('2025/02/27')
  await saveMeasurement(u.id, y, V(), '2025/02/27', '99001_20260917', { create: false })
  if (u.series.length === 1 && u.series[0].date === '2025/02/27') ok('選んだときだけ移動になります（1 件のまま）')
  else fail('★移動になっていません')
}

console.log('')
console.log('=== 元号の換算（令和N = 西暦 - 2018。2019年＝令和元年）===')
for (const [y, want] of [[2018, '2018'], [2019, '令和1'], [2024, '令和6'], [2025, '令和7'], [2026, '令和8'], [2027, '令和9']]) {
  const got = eraLabel(y)
  if (got === want) ok(`${y} 年度 → ${got}`)
  else fail(`★${y} 年度 → ${got}（${want} のはず）`)
}
console.log('')
console.log('=== 評価日 → 年度（4月はじまり）===')
for (const [d, wantY, wantEra] of [
  ['2025/02/27', 2024, '令和6'],   // 2月なので前の年度
  ['2025/03/31', 2024, '令和6'],
  ['2025/04/01', 2025, '令和7'],
  ['2025/09/16', 2025, '令和7'],
  ['2026/02/27', 2025, '令和7'],   // 2026年でも2月は令和7年度
  ['2026/03/31', 2025, '令和7'],
  ['2026/04/01', 2026, '令和8'],
  ['2026/09/17', 2026, '令和8'],
]) {
  const y = fiscalYearOfDate(d)
  if (y === wantY && eraLabel(y) === wantEra) ok(`${d} → ${eraLabel(y)}年度`)
  else fail(`★${d} → ${eraLabel(y)}年度（${wantEra}年度 のはず）`)
}

/* ここから下は「読み取り結果の本登録（取込画面・当日受付）」の再発防止。
   本登録は Firestore に 2 回書く（commitRecognition → saveMeasurement）。
   2 回目に測定日と保存先キーを渡していなかったため、2 回目が
   「その年度の代表（＝前回の測定）」を書き換え先だと解釈し、前の測定を
   今回の日付へ引っ越して無効化していた。
   画面と同じ引数の並びで saveMeasurement を呼んで、消えないことを確かめる。 */
const commitLikeScreen = (u, batchId, values) => {
  const date = batchDate(batchId)
  const year = fiscalYearOfDate(date) ?? D.CUR
  return saveMeasurement(u.id, year, values, date, measKey(u.id, date, year), { force: false })
}

console.log('')
console.log('=== 本登録を 2 回しても、前の測定が消えないか（取込画面・当日受付）===')
{
  const u = freshUser()   // 2026/09/17 の測定を 1 件持っている
  // 同じ年度の別の日に測った用紙を本登録する（C型の開始時・終了時はこの形になる）
  await commitLikeScreen(u, '20261120-ab12x', V({ weight: 47 }))
  const first = u.series.find(r => r.date === '2026/09/17')
  const second = u.series.find(r => r.date === '2026/11/20')
  if (u.series.length === 2) ok(`測定が 2 件そろっています（${u.series.map(r => r.date).join(' / ')}）`)
  else fail(`★測定が ${u.series.length} 件（2 件のはず。前の測定が消えています）`)
  if (first && first.values.weight === 50) ok('前の測定の値がそのまま残っています（体重50）')
  else fail('★前の測定の値が書き換わりました')
  if (second && second.values.weight === 47) ok('本登録した測定が入りました（体重47）')
  else fail('★本登録した測定が入っていません')
  if (second && second.year === 2026) ok(`年度は測定日から決まりました（2026/11/20 → ${second.year} 年度）`)
  else fail(`★年度が測定日から決まっていません（${second && second.year}）`)

  // さらにもう 1 枚（3 回目）本登録しても、前の 2 件は残る
  await commitLikeScreen(u, '20270210-cd34y', V({ weight: 46 }))
  if (u.series.length === 3) ok(`3 回目の本登録でも前の分が残ります（${u.series.length} 件）`)
  else fail(`★3 回目で測定が ${u.series.length} 件になりました（3 件のはず）`)
  const feb = u.series.find(r => r.date === '2027/02/10')
  if (feb && feb.year === 2026) ok('2027/02/10 は令和8年度（年度またぎでも測定日基準）')
  else fail(`★2027/02/10 の年度が ${feb && feb.year}（2026 のはず）`)
}

console.log('')
console.log('=== 測定日が違えば別の文書になるか／同じ日なら同じ文書か ===')
{
  const u = freshUser()
  await commitLikeScreen(u, '20261120-ab12x', V({ weight: 47 }))
  const keys = u.series.map(r => r.key)
  if (new Set(keys).size === keys.length) ok(`測定日ごとに別のキーです（${keys.join(' / ')}）`)
  else fail(`★キーが重複しています（${keys.join(' / ')}）`)
  if (keys.includes('99001_20261120')) ok('キーは {利用者ID}_{測定日} の形です（99001_20261120）')
  else fail(`★キーの形が違います（${keys.join(' / ')}）`)

  // 同じ日の 2 枚目（表・裏の撮り直し等）は、同じ測定として 1 件のまま更新される
  const before = u.series.length
  await commitLikeScreen(u, '20261120-zz99z', V({ weight: 48 }))
  const same = u.series.find(r => r.date === '2026/11/20')
  if (u.series.length === before) ok(`同じ測定日の再登録では増えません（${u.series.length} 件のまま）`)
  else fail(`★同じ測定日なのに ${u.series.length} 件に増えました`)
  if (same && same.values.weight === 48) ok('同じ測定日の再登録は、その測定の値を更新します（体重48）')
  else fail('★同じ測定日の再登録が反映されていません')
}

/* 画面側の呼び出しが、また測定日・保存先キーを渡さない形に戻っていないかを見張る。
   ここが抜けると上のテストが通っていても本番では測定が消える（呼ぶ側の不具合のため）。 */
console.log('')
console.log('=== 画面の saveMeasurement 呼び出しが、測定日と保存先キーを渡しているか ===')
{
  const roots = ['src/screens', 'src/modals', 'src']
  const seen = new Set()
  const files = []
  for (const r of roots) {
    for (const f of readdirSync(new URL('../' + r, import.meta.url), { withFileTypes: true })) {
      if (!f.isFile() || !/\.(js|jsx)$/.test(f.name)) continue
      const p = r + '/' + f.name
      if (seen.has(p)) continue
      seen.add(p); files.push(p)
    }
  }
  let calls = 0
  for (const p of files) {
    const src = readFileSync(new URL('../' + p, import.meta.url), 'utf8')
    for (const line of src.split('\n')) {
      const i = line.indexOf('saveMeasurement(')
      if (i < 0 || /function saveMeasurement/.test(line)) continue
      // 1 行ぶんの引数を括弧の対応で切り出し、いちばん外側のカンマで割る
      let depth = 0, args = [''], j = i + 'saveMeasurement('.length
      for (; j < line.length; j++) {
        const c = line[j]
        if (c === '(' || c === '{' || c === '[') depth++
        else if (c === ')' && depth === 0) break
        else if (c === ')' || c === '}' || c === ']') depth--
        if (c === ',' && depth === 0) { args.push(''); continue }
        args[args.length - 1] += c
      }
      const a = args.map(s => s.trim())
      const where = `${p}: ${a[0]}`
      calls++
      if (!a[3] || a[3] === 'undefined') fail(`★測定日を渡していない呼び出しがあります（${where}）`)
      else if (!a[4] || a[4] === 'undefined') {
        // opts.create=true（過去の測定を新しく足す）はキー無しが正しい
        if (/create:\s*true/.test(a[5] || '')) ok(`過去の測定の追加なのでキー無しで正しい（${where}）`)
        else fail(`★保存先の測定を名指ししていない呼び出しがあります（${where}）`)
      } else ok(`測定日と保存先キーを渡しています（${where}）`)
    }
  }
  if (calls >= 4) ok(`画面の呼び出しを ${calls} 件みました`)
  else fail(`★呼び出しが ${calls} 件しか見つかりません（検査が空振りしている可能性）`)

  /* 問診票(commitKclRecognition)も同じ。date を渡さないと「今日」の文書に入り、
     同じ測定会の測定（撮影日の文書）と別々に分かれて余分な記録になる
     （2026-09-17 に実際に 18 件できた）。 */
  let kcl = 0
  for (const p of files) {
    const src = readFileSync(new URL('../' + p, import.meta.url), 'utf8')
    for (const line of src.split('\n')) {
      if (!line.includes('commitKclRecognition(') || /export async function/.test(line)) continue
      kcl++
      if (/\bdate:/.test(line)) ok(`問診票の本登録が測定日を渡しています（${p}）`)
      else fail(`★問診票の本登録が測定日を渡していません（${p}）`)
    }
  }
  if (kcl >= 3) ok(`問診票の呼び出しを ${kcl} 件みました`)
  else fail(`★問診票の呼び出しが ${kcl} 件しか見つかりません（検査が空振りしている可能性）`)
}

console.log('')
if (ng) { console.log(`失敗 ${ng} 件`); process.exit(1) }
console.log('測定の保存は期待どおりに動いています')
