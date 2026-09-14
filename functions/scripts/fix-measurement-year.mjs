#!/usr/bin/env node
/* 測定の「年度」を評価日から付け直す。

   なぜ要るか:
     年度は日本の年度＝4 月 1 日開始だが、保存されている year が評価日と合っていない。
     原因は 2 つ:
       1) アプリの「今年度」が D.CUR = 2025 の固定値だった。画面から登録した測定は
          評価日に関係なく year=2025 で保存されていた（令和8年度に入っても 2025 のまま）。
       2) 熊本市の取り込み(etl-kumamoto.py)が、その固定値に合わせるため年度を -1 して
          いた。2025-10-02 の測定が year=2024（令和6年度）で入っている。
     どちらもアプリ側を日付ベースに直したので、過去に入った測定の year を直す。

   直し方:
     year 項目だけを書き換える。評価日・測定値・問診回答・事業区分には触らない。
     文書 ID は評価日キーなので変わらない（＝測定が移動・消失しない）。
     元の year は prevYear に控える（戻せるようにするため）。

   使い方:
     node scripts/fix-measurement-year.mjs                 … 下見(書き込まない)
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/fix-measurement-year.mjs --write
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/fix-measurement-year.mjs --undo   … 元に戻す */
import admin from 'firebase-admin'

const WRITE = process.argv.includes('--write')
const UNDO = process.argv.includes('--undo')
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
admin.initializeApp({ projectId })
const db = admin.firestore()

// 評価日 → 年度（4 月 1 日開始）。2026/03/31 は 2025 年度、2026/04/01 は 2026 年度
const fiscalYearOfDate = (ds) => {
  const m = String(ds || '').match(/(\d{4})\D+(\d{1,2})/)
  return m ? +m[1] - (+m[2] < 4 ? 1 : 0) : null
}
const era = (y) => (y >= 2019 ? `令和${y - 2018}` : String(y))

async function main() {
  console.log(`[year] project=${projectId} ${UNDO ? '★元に戻します' : WRITE ? '★書き込みます' : '下見のみ(書き込みません)'}`)
  const snap = await db.collection('measurements').get()
  const plan = []
  for (const d of snap.docs) {
    const m = d.data()
    if (UNDO) {
      if (m.prevYear == null) continue
      plan.push({ id: d.id, from: m.year, to: m.prevYear, date: m.date, voided: !!m.voided })
      continue
    }
    const want = fiscalYearOfDate(m.date)
    if (want == null) continue              // 評価日が無い測定は判断できないので触らない
    if (Number(m.year) === want) continue
    plan.push({ id: d.id, from: Number(m.year), to: want, date: m.date, voided: !!m.voided, source: m.source || '' })
  }
  console.log(`[year] 測定 ${snap.size} 件 / 年度が評価日と合っていない: ${plan.length} 件`)

  // どの年度からどの年度へ動くか
  const moves = {}
  plan.forEach(p => { const k = `${era(p.from)}(${p.from}) → ${era(p.to)}(${p.to})`; moves[k] = (moves[k] || 0) + 1 })
  console.log('[year] 付け替えの内訳:')
  Object.entries(moves).sort().forEach(([k, v]) => console.log(`   ${k}  ${v} 件`))
  const live = plan.filter(p => !p.voided)
  console.log(`[year] うち有効な測定（提出に出るもの）: ${live.length} 件 / 無効(voided): ${plan.length - live.length} 件`)
  const bySrc = {}
  live.forEach(p => { bySrc[p.source || '(なし)'] = (bySrc[p.source || '(なし)'] || 0) + 1 })
  console.log('[year] 取り込み経路の内訳:', bySrc)
  console.log('[year] 例:')
  live.slice(0, 10).forEach(p => console.log(`   ${p.id}  評価日 ${p.date}  ${era(p.from)} → ${era(p.to)}`))

  if (!WRITE && !UNDO) { console.log('[year] 下見のみ。実行するには --write を付けてください'); return }
  if (UNDO && !WRITE) { console.log('[year] 戻すときも --write が要ります'); return }

  let batch = db.batch(), n = 0
  for (const p of plan) {
    const ref = db.collection('measurements').doc(p.id)
    batch.set(ref, UNDO ? { year: p.to, prevYear: null } : { year: p.to, prevYear: p.from }, { merge: true })
    if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0 }
  }
  if (n) await batch.commit()
  console.log(`[year] 完了: ${plan.length} 件の年度を付け替えました`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
