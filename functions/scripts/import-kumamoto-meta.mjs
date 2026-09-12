#!/usr/bin/env node
/* 熊本市「個人管理台帳」にしか無い記入項目だけを、既存の測定ドキュメントに追記する。

   なぜ専用の取り込みが要るか:
     測定値そのものは取り込み済みで、そこにアプリ(OCR・手入力)で足した測定も混ざっている。
     台帳を丸ごと入れ直すと、アプリで入れた値を古い台帳の値で上書きしてしまう。
     ここでは「台帳にしか無い項目」だけを、評価日で特定した既存の文書に足す。

   書き込む項目(これだけ。値・評価日・年度・問診回答・事業区分には触れない):
     examiner       測定者
     trainingType   訓練方法
     selfTraining   自己訓練有無
     assistive      補装具            (開始時・終了時それぞれ)
     assistiveOther 補装具その他      (開始時・終了時それぞれ)
     comment        コメント          (開始時・終了時それぞれ)
     goal           目標
     freeNote       自由記載
   台帳が空欄の項目は書きません(推測で埋めない)。

   使い方:
     node scripts/import-kumamoto-meta.mjs normalized-kumamoto.json           … 下見(書き込まない)
     node scripts/import-kumamoto-meta.mjs normalized-kumamoto.json --write    … 実行
   本番へは ADC が必要: gcloud auth application-default login
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/import-kumamoto-meta.mjs ... --write */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const file = process.argv[2] || 'normalized-kumamoto.json'
const WRITE = process.argv.includes('--write')
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
const data = JSON.parse(readFileSync(file, 'utf8'))

// 台帳にしか無い項目だけ。ここに無いキーは絶対に書かない
const META = ['examiner', 'trainingType', 'selfTraining', 'assistive', 'assistiveOther', 'comment', 'goal', 'freeNote']

admin.initializeApp({ projectId })
const db = admin.firestore()

const compact = (d) => {
  const m = String(d || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0') : ''
}

async function main() {
  console.log(`[meta] project=${projectId} file=${file} ${WRITE ? '★書き込みます' : '下見のみ(書き込みません)'}`)
  const plan = []
  for (const u of data) {
    for (const m of Object.values(u.meas || {})) {
      const c = compact(m.date)
      if (!c) continue                       // 評価日が無い測定は文書が特定できないので触らない
      const patch = {}
      for (const k of META) if (m[k]) patch[k] = m[k]
      if (!Object.keys(patch).length) continue
      plan.push({ docId: `${u.id}_${c}`, userId: String(u.id), name: u.name, date: m.date, patch })
    }
  }
  console.log(`[meta] 台帳から追記できる測定: ${plan.length} 件`)

  let found = 0, missing = [], changed = 0, same = 0
  const fieldCount = {}
  const writes = []
  for (const p of plan) {
    const ref = db.collection('measurements').doc(p.docId)
    const snap = await ref.get()
    if (!snap.exists) { missing.push(p); continue }
    found++
    const cur = snap.data()
    // 値・評価日・年度・問診・事業区分に触れていないことを、書く直前にも確かめる
    const diff = {}
    for (const [k, v] of Object.entries(p.patch)) {
      if (!META.includes(k)) throw new Error('想定外の項目を書こうとしました: ' + k)
      if (cur[k] !== v) diff[k] = v
    }
    if (!Object.keys(diff).length) { same++; continue }
    changed++
    for (const k of Object.keys(diff)) fieldCount[k] = (fieldCount[k] || 0) + 1
    writes.push({ ref, diff, p })
  }

  console.log(`[meta] 既存の測定と一致: ${found} 件 / 文書が見つからない: ${missing.length} 件`)
  console.log(`[meta] 追記が必要: ${changed} 件 / すでに同じ内容: ${same} 件`)
  console.log('[meta] 項目ごとの追記件数:', fieldCount)
  if (missing.length) {
    console.log('[meta] 見つからなかった測定(評価日が台帳と違う・未取り込みなど):')
    missing.slice(0, 20).forEach(p => console.log(`   ${p.docId} ${p.name} ${p.date}`))
  }

  if (!WRITE) { console.log('[meta] 下見のみ。実行するには --write を付けてください'); return }

  let batch = db.batch(), n = 0
  for (const w of writes) {
    batch.set(w.ref, w.diff, { merge: true })   // merge=指定した項目だけ。値は触らない
    if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0 }
  }
  if (n) await batch.commit()
  console.log(`[meta] 完了: ${writes.length} 件に追記しました`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
