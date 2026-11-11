/* 「体力測定なし」の印が古くなった測定を見つけて、印を外す（★2026-11-11 新設）
 *
 * ★何を直すか
 *   `inbodyOnly: true` は「この記録には体力測定が無い」という印。
 *   InBody（体組成）だけ先に取り込まれた年に付く。
 *   ところが、あとから紙の測定値をその記録へ足すと、**印が残ったまま**になる。
 *   印が残っていると画面はその記録を丸ごと読み飛ばすので、
 *   **値は入っているのに推移グラフにも結果用紙にも 1 つも出ない**。
 *
 *   2026-11-11 に本番で 20 件（R7・2025年度）見つかった。
 *   現場報告「経年変化の折れ線グラフの R7年が出ていない」の直接の原因。
 *
 * ★アプリ側は 2026-11-11 に直してある（`src/lib/realdata.js` の `isInbodyOnlyRecord`）。
 *   値があれば印を無視するので、このスクリプトを流さなくても画面には出る。
 *   それでもデータ側の印を外しておくのは、**データを見た人が取り違えないため**。
 *   「印は付いているが測定はある」という矛盾した記録を残さない。
 *
 * ★安全のきまり
 *   ・既定は**下見だけ**。実際に書くには `--write --yes` の 2 つが要る
 *   ・触るのは `inbodyOnly` の 1 項目だけ（updateMask で固定。ほかは 1 文字も変えない）
 *   ・`inbody`（体組成の値）も `values` も `kclAnswers` も**消さない**
 *   ・利用者 ID をこのファイルに書かない（対象は値を見て決める）
 *   ・氏名は読まないし出さない
 *
 * ★使い方
 *     node scripts/fix-stale-inbody-only.mjs                 # 下見（何も書かない）
 *     node scripts/fix-stale-inbody-only.mjs --write --yes   # 実行
 *   ADC が要る: gcloud auth application-default login
 */
import { execFileSync } from 'node:child_process'
import { FITNESS_KEYS, hasFitnessValues } from '../src/lib/realdata.js'

const PROJECT = 'cruto-motion'
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`

const args = process.argv.slice(2)
const APPLY = args.includes('--write') && args.includes('--yes')

let token
try { token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim() }
catch { console.log('ADC が取れません。gcloud auth application-default login を先に実行してください。'); process.exit(1) }
if (!token || token.length < 40) { console.log('ADC が取れません（期限切れの可能性）。'); process.exit(1) }

const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT }

/* Firestore の値 → ふつうの値 */
function plain(f) {
  if (!f) return null
  if ('stringValue' in f) return f.stringValue
  if ('booleanValue' in f) return f.booleanValue
  if ('integerValue' in f) return Number(f.integerValue)
  if ('doubleValue' in f) return f.doubleValue
  if ('nullValue' in f) return null
  if ('mapValue' in f) {
    const o = {}
    for (const [k, v] of Object.entries(f.mapValue.fields || {})) o[k] = plain(v)
    return o
  }
  return null
}

/* measurements を全件めくる（読み取りのみ） */
async function scan() {
  const hits = []
  let pageToken = null, total = 0, flagged = 0
  do {
    const url = `${BASE}/measurements?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`
    const res = await fetch(url, { headers: H })
    if (!res.ok) { console.log('読めませんでした（' + res.status + '）: ' + (await res.text()).slice(0, 200)); process.exit(1) }
    const body = await res.json()
    for (const doc of body.documents || []) {
      total++
      const f = doc.fields || {}
      if (plain(f.inbodyOnly) !== true) continue
      flagged++
      const values = plain(f.values) || {}
      if (!hasFitnessValues(values)) continue          // 本当に InBody 単独。触らない
      hits.push({
        id: doc.name.split('/').pop(),
        year: plain(f.year),
        date: plain(f.date),
        source: plain(f.source) || '',
        n: FITNESS_KEYS.filter((k) => values[k] !== null && values[k] !== undefined && values[k] !== '').length,
      })
    }
    pageToken = body.nextPageToken || null
  } while (pageToken)
  return { hits, total, flagged }
}

const { hits, total, flagged } = await scan()

console.log(`measurements 全件 ${total} 件 / 「体力測定なし」の印が付いているもの ${flagged} 件`)
console.log(`★印が古くなっているもの（体力測定の値があるのに画面に出ない）= ${hits.length} 件\n`)
if (hits.length) {
  console.log('測定ID              年度   測定日        体力測定の項目   取り込み元')
  for (const h of hits.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`${h.id.padEnd(20)}${String(h.year).padEnd(7)}${String(h.date || '—').padEnd(14)}${String(h.n + '/' + FITNESS_KEYS.length).padEnd(17)}${h.source}`)
  }
  console.log('')
}

if (!hits.length) { console.log('直すものはありません。'); process.exit(0) }

if (!APPLY) {
  console.log('下見だけで終わりました。**何も書き込んでいません。**')
  console.log('実際に外すには --write --yes を両方つけてください。')
  process.exit(0)
}

let done = 0, ng = 0
for (const h of hits) {
  const url = `${BASE}/measurements/${encodeURIComponent(h.id)}?updateMask.fieldPaths=inbodyOnly`
  const res = await fetch(url, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ fields: { inbodyOnly: { booleanValue: false } } }),
  })
  if (res.ok) done++
  else { ng++; console.log(`  × ${h.id}（${res.status}）: ${(await res.text()).slice(0, 160)}`) }
}
console.log(`\n外しました: ${done} 件${ng ? ` / 失敗: ${ng} 件` : ''}`)

/* 読み直して確かめる（書いたつもりで終わらせない） */
const after = await scan()
console.log(`読み直し: 印が古いままのもの ${after.hits.length} 件`)
process.exit(after.hits.length === 0 && ng === 0 ? 0 : 1)
