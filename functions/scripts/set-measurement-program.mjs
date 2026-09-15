#!/usr/bin/env node
/* 測定 1 件ずつの「事業区分（program）」を付け替える。

   なぜ要るか:
     同じ方が同じ年度に、短期集中予防サービス（C型）と自治体依頼（サロンの測定）の
     両方を受けることがある。地区名から C型 の印を移したときは利用者まるごと cType に
     したが、あとから「9 月のサロン分は熊本市からの依頼なので別扱い」と分かった。
     測定ごとに正しい区分へ直す。

   書き込むのは program の 1 項目だけ。測定値・評価日・年度・問診回答には触らない。
   元の値は prevProgram に控え、--undo で戻せる。

   使い方:
     node scripts/set-measurement-program.mjs plan.json            … 下見
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/set-measurement-program.mjs plan.json --write
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/set-measurement-program.mjs plan.json --undo --write
   plan.json の形:
     [{ "docId": "20205_20260907", "to": "city", "why": "9月のサロンは自治体依頼" }] */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const file = process.argv[2] || 'plan.json'
const WRITE = process.argv.includes('--write')
const UNDO = process.argv.includes('--undo')
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
const plan = JSON.parse(readFileSync(file, 'utf8'))

admin.initializeApp({ projectId })
const db = admin.firestore()

async function main() {
  console.log(`[prog] project=${projectId} ${UNDO ? '★元に戻します' : WRITE ? '★書き込みます' : '下見のみ(書き込みません)'} 対象 ${plan.length} 件`)
  const todo = []
  for (const p of plan) {
    const ref = db.collection('measurements').doc(p.docId)
    const snap = await ref.get()
    if (!snap.exists) { console.log(`   × ${p.docId} が見つかりません（飛ばします）`); continue }
    const m = snap.data()
    const to = UNDO ? (m.prevProgram || 'city') : p.to
    if ((m.program || 'city') === to) { console.log(`   － ${p.docId} はすでに ${to} です（変更なし）`); continue }
    todo.push({ ref, docId: p.docId, from: m.program || '(なし)', to, date: m.date, why: p.why || '' })
    console.log(`   ${p.docId}  評価日 ${m.date}  事業区分 ${m.program || '(なし)'} → ${to}  ${p.why || ''}`)
  }
  console.log(`[prog] 付け替える: ${todo.length} 件`)
  if (!WRITE) { console.log('[prog] 下見のみ。実行するには --write を付けてください'); return }
  for (const t of todo) {
    await t.ref.set(UNDO ? { program: t.to, prevProgram: null } : { program: t.to, prevProgram: t.from }, { merge: true })
    // 書けたことを読み直して確かめる。ついでに他の項目に触れていないことも見る
    const back = (await t.ref.get()).data()
    if (back.program !== t.to) { console.error(`[prog] ★中断: ${t.docId} に反映されていません`); process.exit(1) }
    console.log(`   済 ${t.docId} → ${t.to}`)
  }
  console.log(`[prog] 完了: ${todo.length} 件`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
